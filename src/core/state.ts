import type { ConsentState, PrivacyMode, ResolvedConfig } from './config';

export interface SessionInfo {
  sessionId: string;
  visitorId: string | null;
}

export interface QueuedEvent {
  payload: unknown;
  attempts: number;
  useBeacon?: boolean;
}

export interface SDKState {
  initialized: boolean;
  config: ResolvedConfig | null;
  effectivePrivacyMode: PrivacyMode;
  consent: {
    granted: boolean;
    source: string;
    details?: ConsentState;
  };
  session: SessionInfo;
  trackingEnabled: boolean;
  queue: QueuedEvent[];
  formListenersAttached: boolean;
  pageViewSent: boolean;
}

export const state: SDKState = {
  initialized: false,
  config: null,
  effectivePrivacyMode: 'balanced',
  consent: {
    granted: true,
    source: 'default',
  },
  session: {
    sessionId: '',
    visitorId: null,
  },
  trackingEnabled: true,
  queue: [],
  formListenersAttached: false,
  pageViewSent: false,
};

export function resetState(): void {
  state.initialized = false;
  state.config = null;
  state.effectivePrivacyMode = 'balanced';
  state.consent = { granted: true, source: 'default' };
  state.session = { sessionId: '', visitorId: null };
  state.trackingEnabled = true;
  state.queue = [];
  state.formListenersAttached = false;
  state.pageViewSent = false;
}
