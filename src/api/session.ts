import type { ConsentState } from '../core/config';
import { applyConsent } from '../core/consent';
import { getSession } from '../core/session-ids';

export function setConsent(consent: ConsentState): void {
  applyConsent(consent);
}

export { getSession };
