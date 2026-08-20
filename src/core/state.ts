import type { ConsentState, PrivacyMode, ResolvedConfig } from './config';
import type { TrackResponse } from './transport';

export interface SessionInfo {
  sessionId: string;
  visitorId: string | null;
}

export interface QueuedEvent {
  payload: unknown;
  attempts: number;
  useBeacon?: boolean;
  resolve: (response: TrackResponse | null) => void;
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
  queueProcessing: boolean;
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
  queueProcessing: false,
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
  state.queueProcessing = false;
  state.formListenersAttached = false;
  state.pageViewSent = false;
}
