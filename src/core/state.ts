import type { ConsentState, PrivacyMode, ResolvedConfig } from './config';
import type { IdentifyOptions, IdentityContext } from './identify';
import type { EnforcementConfig, RuleInPageOverride } from './enforcement';
import type { TrackResponse } from './transport';

export interface SessionInfo {
  sessionId: string;
  visitorId: string | null;
}

/**
 * Where the session ID lives: 'cookie' is the normal case, 'session_storage'
 * means the cookie could not be written, 'window_name' means sessionStorage
 * was refused too and the tab's window.name carries it, 'link' means it
 * reached this page in a link token and nothing else keeps it, 'memory'
 * means nothing keeps it at all (it is lost on the next page load).
 */
export type SessionPersistence = 'cookie' | 'session_storage' | 'window_name' | 'link' | 'memory';

/** Where the visitor ID is kept: the cookie (the localStorage copy rides along), localStorage alone, or nowhere. */
export type VisitorPersistence = 'cookie' | 'local_storage' | 'none';

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
  // setConsent() was last called with a grant (init's own default is not one)
  consentAgreed: boolean;
  session: SessionInfo;
  sessionPersistence: SessionPersistence;
  visitorPersistence: VisitorPersistence;
  // session ID this page was handed in a link token (core/link-session.ts)
  linkSessionId: string | null;
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
  // what identify() was last given — kept so the encrypted fields can be
  // added once the site's identity key is known (consent-gated, see
  // ensureIdentityEncrypted); the page already holds these values
  identityOptions: IdentifyOptions | null;
  // one encryption attempt per identify() call
  identityEncryption: Promise<void> | null;
  // the site's identity public key, fetched once per page (null = none)
  identityKeyPromise: Promise<string | null> | null;
  // in-page enforcement setting from the latest /track response (null = off)
  enforcement: EnforcementConfig | null;
  // latest risk.recommendation the API returned for this page
  lastRecommendation: string | null;
  // the custom rule behind lastRecommendation, if any (with in-page overrides)
  lastRule: { name: string; inPage: RuleInPageOverride | null } | null;
  // a Turnstile challenge verified by Shield for this session
  challengePassed: boolean;
}

export const state: SDKState = {
  initialized: false,
  config: null,
  effectivePrivacyMode: 'balanced',
  consent: {
    granted: true,
    source: 'default',
  },
  consentAgreed: false,
  session: {
    sessionId: '',
    visitorId: null,
  },
  sessionPersistence: 'cookie',
  visitorPersistence: 'none',
  linkSessionId: null,
  trackingEnabled: true,
  queue: [],
  queueProcessing: false,
  formListenersAttached: false,
  pageViewSent: false,
  dataLayerCreatedBySdk: false,
  identity: {},
  identityReady: Promise.resolve(),
  identityOptions: null,
  identityEncryption: null,
  identityKeyPromise: null,
  enforcement: null,
  lastRecommendation: null,
  lastRule: null,
  challengePassed: false,
};

export function resetState(): void {
  state.initialized = false;
  state.config = null;
  state.effectivePrivacyMode = 'balanced';
  state.consent = { granted: true, source: 'default' };
  state.session = { sessionId: '', visitorId: null };
  state.sessionPersistence = 'cookie';
  state.visitorPersistence = 'none';
  state.linkSessionId = null;
  state.consentAgreed = false;
  state.trackingEnabled = true;
  state.queue = [];
  state.queueProcessing = false;
  state.formListenersAttached = false;
  state.pageViewSent = false;
  state.dataLayerCreatedBySdk = false;
  state.identity = {};
  state.identityReady = Promise.resolve();
  state.identityOptions = null;
  state.identityEncryption = null;
  state.identityKeyPromise = null;
  state.enforcement = null;
  state.lastRecommendation = null;
  state.lastRule = null;
  state.challengePassed = false;
}
