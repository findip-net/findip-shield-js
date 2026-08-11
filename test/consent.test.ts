import { describe, it, expect, beforeEach } from 'vitest';
import { resolveConfig } from '../src/core/config';
import { applyConsent, isTrackingAllowed, shouldCollectVisitorId } from '../src/core/consent';
import { resetState, state } from '../src/core/state';

describe('consent', () => {
  beforeEach(() => {
    resetState();
    state.config = resolveConfig({ siteKey: 'pub_test' });
  });

  it('allows tracking by default', () => {
    applyConsent(true);
    expect(isTrackingAllowed()).toBe(true);
  });

  it('forces strict mode when consent is false and noConsentMode is strict', () => {
    applyConsent(false);
    expect(state.effectivePrivacyMode).toBe('strict');
    expect(isTrackingAllowed()).toBe(true);
    expect(shouldCollectVisitorId()).toBe(false);
  });

  it('disables tracking when consent is false and noConsentMode is disabled', () => {
    state.config!.noConsentMode = 'disabled';
    state.config!.consentRequired = true;
    applyConsent(false);
    expect(state.trackingEnabled).toBe(false);
    expect(isTrackingAllowed()).toBe(false);
  });

  it('handles granular consent', () => {
    applyConsent({ security_storage: 'granted', analytics_storage: 'denied' });
    expect(state.consent.granted).toBe(true);
    expect(state.consent.source).toBe('granular');
  });
});
