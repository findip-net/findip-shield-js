import type { ConsentState, PrivacyMode, ResolvedConfig } from './config';
import type { IdentityContext } from './identify';
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
  // distinguishes a dataLayer the SDK created (for pushRiskResult) from one
  // the page already had — only the latter indicates a GTM installation
  dataLayerCreatedBySdk: boolean;
  // hashed identity merged into every event's customer_context
  identity: IdentityContext;
  // resolves once the current identify() call has finished hashing
  identityReady: Promise<void>;
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
  dataLayerCreatedBySdk: false,
  identity: {},
  identityReady: Promise.resolve(),
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
  state.dataLayerCreatedBySdk = false;
  state.identity = {};
  state.identityReady = Promise.resolve();
}
