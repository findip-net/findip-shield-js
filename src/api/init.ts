import type { FindIPConfig } from '../core/config';
import {
  parseScriptTagConfig,
  resolveConfig,
  SDK_VERSION,
} from '../core/config';
import { applyConsent, isTrackingAllowed } from '../core/consent';
import {
  hasSessionStarted,
  initializeSessionIds,
  markSessionStarted,
  refreshSessionId,
} from '../core/session-ids';
import { state } from '../core/state';
import { attachFormListeners, inferFormEvent, observeFormViews, scanFormMetadata } from '../collectors/forms';
import { inferPageEvent } from '../collectors/url-inference';
import { isGtmPresent } from '../collectors/gtm';
import { trackEvent } from './track';
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

  if (config.autoTrack) {
    void sendAutoPageEvents();
  }

  if (config.autoDetectForms) {
    setupFormDetection();
  }
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
    void trackEvent(inference.eventName, {
      source: 'auto_form_detect',
      auto_detected: true,
      confidence: inference.confidence,
      detection_method: inference.detection_method,
      formMeta: inference.metadata,
      useBeacon: true,
    });
  });

  observeFormViews((form) => {
    if (!isTrackingAllowed()) return;

    const metadata = scanFormMetadata(form);
    const inference = inferFormEvent(form);
    const viewEvent = mapFormToViewEvent(inference.eventName);

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
