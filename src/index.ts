import { init, identify, autoInitFromScript, version } from './api/init';
import { track } from './api/track';
import { getSession, setConsent } from './api/session';

export interface FindIPGlobal {
  init: typeof init;
  identify: typeof identify;
  track: typeof track;
  getSession: typeof getSession;
  setConsent: typeof setConsent;
  version: string;
}

const FindIP: FindIPGlobal = {
  init,
  identify,
  track,
  getSession,
  setConsent,
  version,
};

if (typeof window !== 'undefined') {
  (window as Window & { FindIP?: FindIPGlobal }).FindIP = FindIP;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitFromScript);
  } else {
    autoInitFromScript();
  }
}

export { init, identify, track, getSession, setConsent, version };
export type { IdentifyOptions } from './core/identify';
