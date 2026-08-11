import type { ConsentState, NoConsentMode, PrivacyMode } from './config';
import { state } from './state';

export function normalizeConsent(consent: ConsentState): {
  granted: boolean;
  source: string;
  details?: ConsentState;
} {
  if (typeof consent === 'boolean') {
    return {
      granted: consent,
      source: 'explicit',
      details: consent,
    };
  }

  const securityGranted = consent.security_storage !== 'denied';
  const analyticsGranted = consent.analytics_storage === 'granted';
  const granted = securityGranted || analyticsGranted;

  return {
    granted,
    source: 'granular',
    details: consent,
  };
}

export function applyConsent(consent: ConsentState): void {
  state.consent = normalizeConsent(consent);

  if (!state.config) return;

  if (!state.consent.granted) {
    if (state.config.noConsentMode === 'disabled') {
      state.trackingEnabled = false;
    } else {
      state.trackingEnabled = true;
      state.effectivePrivacyMode = 'strict';
    }
  } else if (state.config) {
    state.trackingEnabled = true;
    state.effectivePrivacyMode = state.config.privacyMode;
  }
}

export function isTrackingAllowed(): boolean {
  if (!state.config) return false;
  if (state.config.consentRequired && !state.consent.granted) {
    return state.config.noConsentMode !== 'disabled';
  }
  return state.trackingEnabled;
}

export function getEffectivePrivacyMode(): PrivacyMode {
  return state.effectivePrivacyMode;
}

export function shouldCollectVisitorId(): boolean {
  return getEffectivePrivacyMode() !== 'strict';
}

export function getRetentionHint(): string {
  const mode = getEffectivePrivacyMode();
  if (mode === 'strict') return 'session';
  if (mode === 'advanced') return 'extended';
  return 'standard';
}

export function resolveNoConsentBehavior(mode: NoConsentMode): 'strict' | 'disabled' {
  return mode === 'disabled' ? 'disabled' : 'strict';
}
