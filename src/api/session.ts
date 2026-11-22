import type { ConsentState } from '../core/config.js';
import { applyConsent } from '../core/consent.js';
import { forgetVisitorId, getSession, syncVisitorId } from '../core/session-ids.js';
import { state } from '../core/state.js';

export function setConsent(consent: ConsentState): void {
  // A visitor who had agreed and now refuses: the visitor ID leaves the
  // browser. A page that starts from "denied" before its consent tool has
  // answered is not a withdrawal, so a returning visitor keeps their ID.
  const hadAgreed = state.consentAgreed;
  applyConsent(consent);
  state.consentAgreed = state.consent.granted;
  if (hadAgreed && !state.consent.granted) forgetVisitorId();
  if (state.initialized && state.config) syncVisitorId(state.config);
}

export { getSession };
