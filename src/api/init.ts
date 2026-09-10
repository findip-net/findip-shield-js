import type { FindIPConfig } from '../core/config';
import { parseScriptTagConfig, resolveConfig, SDK_VERSION } from '../core/config';
import { applyConsent, isTrackingAllowed } from '../core/consent';
import {
  hasSessionStarted,
  initializeSessionIds,
  markSessionStarted,
  refreshSessionId,
} from '../core/session-ids';
import { state } from '../core/state';
import {
  attachFormListeners,
  inferFormEvent,
  observeFormViews,
  scanFormMetadata,
} from '../collectors/forms';
import { inferPageEvent } from '../collectors/url-inference';
import { isGtmPresent } from '../collectors/gtm';
import { hasIdentity, resolveIdentity, type IdentifyOptions } from '../core/identify';
import { trackEvent } from './track';
import { attachEnforcement, resolveFormEvent } from '../core/enforcement';
import { debug } from '../utils/logger';

let unloadHandlerAttached = false;

export function init(options: FindIPConfig): void {
  const scriptConfig = parseScriptTagConfig();
  const merged = { ...scriptConfig, ...options };
  const config = resolveConfig(merged);

  state.config = config;
  state.effectivePrivacyMode = config.privacyMode;
  state.initialized = true;

  applyConsent(state.consent.details ?? state.consent.granted);

  if (hasIdentity(config.identify)) identify(config.identify);

  initializeSessionIds(config);
  attachUnloadHandler();

  debug('Initialized', {
    privacyMode: state.effectivePrivacyMode,
    gtm: isGtmPresent(),
  });

  if (!isTrackingAllowed()) {
    debug('Tracking disabled by consent');
    return;
  }

  // Before the form tracking listener: enforcement runs first on a submit.
  attachEnforcement();

  if (config.autoTrack) {
    void sendAutoPageEvents();
  }

  if (config.autoDetectForms) {
    setupFormDetection();
  }
}

/**
 * Tell Shield who the visitor is. The user ID and email are hashed in the
 * browser (SHA-256) and, once the site's identity key is known, encrypted
 * with it so the Shield dashboard can show them; the plain values are never
 * sent. Call it from init({ identify }) or later, e.g. after a login. Pass
 * null to forget the identity (e.g. on logout).
 */
export function identify(options: IdentifyOptions | null): void {
  const previous = state.identityReady;
  state.identityOptions = options;
  state.identityEncryption = null;
  state.identityReady = previous
    .catch(() => undefined)
    .then(() => resolveIdentity(options))
    .then((identity) => {
      state.identity = identity;
      debug('Identity set', Object.keys(identity));
    });
}

async function sendAutoPageEvents(): Promise<void> {
  if (state.pageViewSent) return;
  state.pageViewSent = true;

  if (state.config && !hasSessionStarted(state.config)) {
    markSessionStarted(state.config);
    await trackEvent('session_start', { source: 'auto' });
  }
  await trackEvent('page_view', { source: 'auto' });

  const inference = inferPageEvent();
  if (inference?.event && inference.confidence >= 0.5) {
    await trackEvent(inference.event, {
      source: 'auto_url_detect',
      auto_detected: true,
      confidence: inference.confidence,
      detection_method: inference.detection_method,
    });
  }
}

function setupFormDetection(): void {
  if (state.formListenersAttached) return;
  state.formListenersAttached = true;

  attachFormListeners((form) => {
    if (!isTrackingAllowed()) return;

    const inference = inferFormEvent(form);
    // The customer's correction (dashboard) beats the heuristics; an ignored
    // form is still counted, as an unrecognised submit.
    const resolved = resolveFormEvent(form, inference);
    void trackEvent(resolved.eventName, {
      source: 'auto_form_detect',
      auto_detected: true,
      confidence: resolved.overridden ? 1 : inference.confidence,
      detection_method: resolved.overridden ? 'customer_override' : inference.detection_method,
      formMeta: inference.metadata,
      useBeacon: true,
    });
  });

  observeFormViews((form) => {
    if (!isTrackingAllowed()) return;

    const metadata = scanFormMetadata(form);
    const inference = inferFormEvent(form);
    const viewEvent = mapFormToViewEvent(resolveFormEvent(form, inference).eventName);

    if (viewEvent) {
      void trackEvent(viewEvent, {
        source: 'auto_form_detect',
        auto_detected: true,
        confidence: Math.min(inference.confidence, 0.85),
        detection_method: 'form_visibility',
        formMeta: metadata,
      });
    }
  });
}

function mapFormToViewEvent(eventName: string): string | null {
  const map: Record<string, string> = {
    signup_attempt: 'signup_view',
    login_attempt: 'login_view',
    lead_submitted: 'lead_form_view',
    checkout_started: 'checkout_view',
    payment_attempt: 'checkout_view',
    password_reset_attempt: 'password_reset_view',
  };
  return map[eventName] ?? 'form_view';
}

function attachUnloadHandler(): void {
  if (unloadHandlerAttached || typeof window === 'undefined') return;
  unloadHandlerAttached = true;

  window.addEventListener('pagehide', () => {
    if (state.config) refreshSessionId(state.config);
  });
}

export function autoInitFromScript(): void {
  const scriptConfig = parseScriptTagConfig();
  if (scriptConfig.siteKey && !state.initialized) {
    init(scriptConfig as FindIPConfig);
  }
}

export { SDK_VERSION as version };
