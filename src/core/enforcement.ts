import { identityKeyEndpoint } from './config';
import { state } from './state';
import type { TrackResponse } from './transport';
import { inferFormEvent } from '../collectors/forms';
import { trackEvent } from '../api/track';
import { debug } from '../utils/logger';

/**
 * In-page enforcement (Shield dashboard → Settings → Enforcement).
 *
 * The setting arrives inside /track responses, so there is no extra request
 * and nothing list-like ever reaches the browser: the API decides per event
 * (risk.recommendation), the page only acts on that decision for the forms
 * in scope. Friction, not a security boundary — anyone posting directly or
 * disabling JavaScript bypasses it; the verify endpoint is the hard check.
 *
 * Fail open everywhere: no setting, no recommendation yet, Turnstile down →
 * the submit goes through.
 */
export type EnforcementScope = 'signup' | 'login' | 'checkout' | 'lead' | 'password_reset';
export type EnforcementAction = 'stop' | 'slow' | 'challenge' | 'redirect';
export type EnforcementOutcome =
  | 'blocked'
  | 'delayed'
  | 'challenged'
  | 'passed'
  | 'failed'
  | 'redirected';

/** Narrows a scope category to specific forms; every given key must match. */
export interface FormFilter {
  path?: string;
  id?: string;
  name?: string;
  action?: string;
}

export interface EnforcementConfig {
  actions: {
    block: 'stop' | 'redirect' | 'none';
    challenge: 'challenge' | 'slow' | 'stop' | 'none';
    monitor: 'slow' | 'none';
  };
  scope: EnforcementScope[];
  /** Per category: only these forms (absent/empty = every form of the category). */
  form_filters?: Partial<Record<EnforcementScope, FormFilter[]>>;
  message: string;
  redirect_url: string | null;
  slow_down_seconds: number;
  turnstile_site_key: string | null;
}

export interface EnforcementReport {
  action: EnforcementAction;
  outcome: EnforcementOutcome;
}

const CHALLENGE_PASSED_KEY = '_fip_cp';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const NOTICE_CLASS = 'findip-shield-notice';
const DEFAULT_MESSAGE =
  'We could not accept this submission from your current connection. Please try again later or contact support.';

const SCOPE_BY_EVENT: Record<string, EnforcementScope> = {
  signup_attempt: 'signup',
  login_attempt: 'login',
  checkout_started: 'checkout',
  payment_attempt: 'checkout',
  lead_submitted: 'lead',
  password_reset_attempt: 'password_reset',
};

// Forms whose next submit event must pass through untouched (our own
// re-submit after a delay or a passed challenge).
const approved = new WeakSet<HTMLFormElement>();
// Forms currently counting down / showing a widget.
const pending = new WeakSet<HTMLFormElement>();
let attached = false;
let redirected = false;
let turnstileLoading: Promise<TurnstileApi | null> | null = null;

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ): string;
  reset(widgetId?: string): void;
}

/** Test hook: where 'redirect' sends the visitor. */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export function isEnforcementConfig(value: unknown): value is EnforcementConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const actions = v.actions as Record<string, unknown> | undefined;
  return Boolean(
    actions &&
    typeof actions.block === 'string' &&
    typeof actions.challenge === 'string' &&
    typeof actions.monitor === 'string' &&
    Array.isArray(v.scope),
  );
}

/** Called for every /track response: remembers the setting and the decision. */
export function applyTrackResponse(response: TrackResponse): void {
  if (isEnforcementConfig(response.enforcement)) {
    state.enforcement = response.enforcement;
  }
  const recommendation = response.risk?.recommendation;
  if (typeof recommendation === 'string') state.lastRecommendation = recommendation;

  // 'redirect' acts as soon as the page is known to be blocked, not only on
  // a submit — but never from the redirect target itself (loop guard).
  const config = state.enforcement;
  if (
    config &&
    state.lastRecommendation === 'block' &&
    config.actions.block === 'redirect' &&
    config.redirect_url &&
    !redirected &&
    !onRedirectTarget(config.redirect_url)
  ) {
    redirect(config.redirect_url, null);
  }
}

function onRedirectTarget(url: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const target = new URL(url, window.location.href);
    return target.origin === window.location.origin && target.pathname === window.location.pathname;
  } catch {
    return true;
  }
}

export function attachEnforcement(): void {
  if (attached || typeof document === 'undefined') return;
  attached = true;
  restoreChallengePassed();
  // Capture phase, registered before the tracking listener in init(): a
  // stopped submit never reaches the page's own handlers.
  document.addEventListener('submit', onSubmit, true);
}

/** Test hook. */
export function detachEnforcement(): void {
  if (!attached || typeof document === 'undefined') return;
  document.removeEventListener('submit', onSubmit, true);
  attached = false;
  redirected = false;
  turnstileLoading = null;
}

function restoreChallengePassed(): void {
  try {
    const stored = sessionStorage.getItem(CHALLENGE_PASSED_KEY);
    if (stored && stored === state.session.sessionId) state.challengePassed = true;
  } catch {
    // storage unavailable
  }
}

function rememberChallengePassed(): void {
  state.challengePassed = true;
  try {
    sessionStorage.setItem(CHALLENGE_PASSED_KEY, state.session.sessionId);
  } catch {
    // storage unavailable
  }
}

function formMatchesFilters(
  form: HTMLFormElement,
  meta: { form_id: string | null; form_name: string | null; form_action: string | null },
  filters: FormFilter[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return true;
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return filters.some((f) => {
    if (!f || typeof f !== 'object') return false;
    const keys = (['path', 'id', 'name', 'action'] as const).filter(
      (k) => typeof f[k] === 'string' && f[k],
    );
    if (keys.length === 0) return false;
    return keys.every((k) => {
      switch (k) {
        case 'path':
          return f.path === path;
        case 'id':
          return f.id === (meta.form_id ?? form.id);
        case 'name':
          return f.name === meta.form_name;
        case 'action':
          return f.action === meta.form_action;
      }
    });
  });
}

function scopeFor(eventName: string): EnforcementScope | null {
  return SCOPE_BY_EVENT[eventName] ?? null;
}

function resolveAction(config: EnforcementConfig): EnforcementAction | null {
  switch (state.lastRecommendation) {
    case 'block':
      return config.actions.block === 'none' ? null : config.actions.block;
    case 'challenge': {
      if (config.actions.challenge === 'none') return null;
      if (config.actions.challenge === 'challenge' && !config.turnstile_site_key) return 'slow';
      return config.actions.challenge;
    }
    case 'monitor':
      return config.actions.monitor === 'none' ? null : config.actions.monitor;
    default:
      return null;
  }
}

function onSubmit(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (approved.has(form)) {
    approved.delete(form);
    return;
  }
  const config = state.enforcement;
  if (!config || !state.lastRecommendation || state.challengePassed) return;

  const inference = inferFormEvent(form);
  const scope = scopeFor(inference.eventName);
  if (!scope || !config.scope.includes(scope)) return;
  if (!formMatchesFilters(form, inference.metadata, config.form_filters?.[scope])) return;

  const action = resolveAction(config);
  if (!action) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (pending.has(form)) return;

  const report = (outcome: EnforcementOutcome, useBeacon = false) =>
    void trackEvent(inference.eventName, {
      source: 'enforcement',
      auto_detected: true,
      confidence: inference.confidence,
      detection_method: inference.detection_method,
      formMeta: inference.metadata,
      enforcement: { action, outcome },
      useBeacon,
    });

  debug('Enforcement', action, 'on', inference.eventName);
  switch (action) {
    case 'stop':
      showNotice(form, config.message || DEFAULT_MESSAGE);
      report('blocked');
      return;
    case 'redirect':
      if (config.redirect_url) {
        redirect(config.redirect_url, () => report('redirected', true));
      } else {
        showNotice(form, config.message || DEFAULT_MESSAGE);
        report('blocked');
      }
      return;
    case 'slow':
      slowDown(form, config.slow_down_seconds, () => report('delayed'));
      return;
    case 'challenge':
      challenge(form, config, report);
      return;
  }
}

function redirect(url: string, beforeLeave: (() => void) | null): void {
  if (redirected) return;
  redirected = true;
  if (beforeLeave) beforeLeave();
  navigation.assign(url);
}

function slowDown(form: HTMLFormElement, seconds: number, onDelayed: () => void): void {
  pending.add(form);
  const total = Math.max(1, Math.round(seconds));
  let remaining = total;
  const notice = showNotice(form, countdownText(remaining));
  onDelayed();
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      notice.textContent = countdownText(remaining);
      return;
    }
    clearInterval(timer);
    notice.remove();
    pending.delete(form);
    resubmit(form);
  }, 1000);
}

function countdownText(seconds: number): string {
  return `Please wait ${seconds} second${seconds === 1 ? '' : 's'} before submitting.`;
}

function challenge(
  form: HTMLFormElement,
  config: EnforcementConfig,
  report: (outcome: EnforcementOutcome) => void,
): void {
  const siteKey = config.turnstile_site_key;
  if (!siteKey) {
    slowDown(form, config.slow_down_seconds, () => report('delayed'));
    return;
  }
  pending.add(form);
  const notice = showNotice(form, 'Please complete the quick verification below to continue.');
  const container = document.createElement('div');
  container.className = `${NOTICE_CLASS}-widget`;
  notice.appendChild(container);
  report('challenged');

  const finish = (passed: boolean) => {
    if (passed) {
      rememberChallengePassed();
      notice.remove();
      pending.delete(form);
      report('passed');
      resubmit(form);
    } else {
      report('failed');
      notice.firstChild!.textContent = 'Verification failed. Please try again.';
    }
  };

  void loadTurnstile().then((turnstile) => {
    if (!turnstile) {
      // Turnstile could not load: fail open.
      notice.remove();
      pending.delete(form);
      resubmit(form);
      return;
    }
    // Holder rather than a const: Turnstile may invoke callbacks before
    // render() returns the widget id.
    const widget: { id?: string } = {};
    widget.id = turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => {
        void verifyChallenge(token).then((passed) => {
          if (!passed && widget.id !== undefined) turnstile.reset(widget.id);
          finish(passed);
        });
      },
      'error-callback': () => finish(false),
      'expired-callback': () => {
        if (widget.id !== undefined) turnstile.reset(widget.id);
      },
    });
  });
}

async function verifyChallenge(token: string): Promise<boolean> {
  const config = state.config;
  if (!config || typeof fetch !== 'function') return true;
  const url = identityKeyEndpoint(config.endpoint).replace(/\/identity-key$/, '/challenge');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        site_key: config.siteKey,
        session_id: state.session.sessionId,
        token,
      }),
      credentials: 'omit',
    });
    if (!response.ok) return response.status >= 500; // server trouble → fail open
    const body = (await response.json()) as { passed?: boolean };
    return body.passed === true;
  } catch (err) {
    debug('Challenge verification failed — failing open', err);
    return true;
  }
}

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (turnstileLoading) return turnstileLoading;
  const w = window as Window & { turnstile?: TurnstileApi };
  if (w.turnstile) {
    turnstileLoading = Promise.resolve(w.turnstile);
    return turnstileLoading;
  }
  turnstileLoading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve(w.turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return turnstileLoading;
}

function resubmit(form: HTMLFormElement): void {
  approved.add(form);
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    form.submit();
  }
}

function showNotice(form: HTMLFormElement, text: string): HTMLElement {
  let notice = form.querySelector<HTMLElement>(`.${NOTICE_CLASS}`);
  if (!notice) {
    notice = document.createElement('div');
    notice.className = NOTICE_CLASS;
    notice.setAttribute('role', 'alert');
    notice.style.cssText =
      'margin:8px 0;padding:10px 12px;border-radius:6px;background:#fff7ed;color:#7c2d12;border:1px solid #fdba74;font:inherit;font-size:14px;line-height:1.4;';
    form.appendChild(notice);
  }
  const textNode = document.createTextNode(text);
  notice.replaceChildren(textNode);
  return notice;
}
