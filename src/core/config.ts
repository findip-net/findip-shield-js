declare const __SDK_VERSION__: string;

import type { IdentifyOptions } from './identify';
import { resolveSessionFieldName } from './session-field';

export const SDK_NAME = 'findip-shield-js';
export const SDK_VERSION = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '1.0.0';

export type PrivacyMode = 'strict' | 'balanced' | 'advanced';
export type NoConsentMode = 'strict' | 'disabled';
export type Integration = 'javascript' | 'gtm' | 'wordpress' | 'woocommerce' | 'shopify' | 'webview';

export type ConsentState =
  | boolean
  | {
      security_storage?: 'granted' | 'denied';
      analytics_storage?: 'granted' | 'denied';
      ad_storage?: 'granted' | 'denied';
    };

export interface FindIPConfig {
  siteKey: string;
  privacyMode?: PrivacyMode;
  autoTrack?: boolean;
  autoDetectForms?: boolean;
  pushToDataLayer?: boolean;
  consentRequired?: boolean;
  noConsentMode?: NoConsentMode;
  integration?: string;
  /**
   * For a page inside a mobile app's WebView (Capacitor, Ionic, Cordova, a
   * native WebView): the iOS bundle identifier or Android applicationId of
   * the app, as registered on a Shield app site. Sent with every event so
   * Shield can match it; use it with `integration: 'webview'`. An app site
   * refuses WebView events without it.
   */
  appId?: string;
  /** Who the visitor is; hashed and encrypted in the browser, see IdentifyOptions. */
  identify?: IdentifyOptions | null;
  /**
   * The site's identity public key ("fk1.<key id>.<base64 SPKI>") used to
   * encrypt the email and user ID for the dashboard. Normally omitted: the SDK
   * fetches it from Shield once per page when identify() carries values.
   */
  identityKey?: string | null;
  endpoint?: string;
  /**
   * Let Shield ask this browser for a picture of a form it has not seen yet
   * (a sanitised clone, values blanked; see core/snapshot.ts). Default true;
   * never in strict privacy mode.
   */
  captureFormSnapshots?: boolean;
  /** Where the DOM-to-canvas renderer is loaded from, only when a picture is wanted. */
  snapshotRendererUrl?: string;
  debug?: boolean;
  maxPayloadBytes?: number;
  sessionCookieDurationMinutes?: number;
  visitorCookieDurationDays?: number;
  /**
   * Add a hidden field with the Shield session ID to the page's forms, so
   * your server can verify the session without the `_fip_sid` cookie.
   * `true` names it `findip_session`; a string sets the name. Only forms
   * that POST to the page's own origin get it. Default off.
   */
  sessionField?: boolean | string;
  /**
   * For a browser that does not keep the session cookie: add a short-lived
   * `_fip` token to same-origin links at click time, so the next page (also
   * in a new tab) continues the session. The token is removed from the
   * address bar as soon as that page loads. Default off.
   */
  linkSession?: boolean;
}

export interface ResolvedConfig extends Required<
  Omit<
    FindIPConfig,
    | 'siteKey'
    | 'sessionField'
    | 'privacyMode'
    | 'autoTrack'
    | 'autoDetectForms'
    | 'pushToDataLayer'
    | 'integration'
    | 'identify'
    | 'identityKey'
    | 'appId'
  >
> {
  siteKey: string;
  privacyMode: PrivacyMode;
  autoTrack: boolean;
  autoDetectForms: boolean;
  pushToDataLayer: boolean;
  // null = infer from the page environment (gtm vs javascript) per event
  integration: Integration | null;
  identify: IdentifyOptions | null;
  // null = fetch from the identity-key endpoint next to `endpoint`
  identityKey: string | null;
  // the app a WebView page runs in; null = a website
  appId: string | null;
  // name of the hidden session field; null = off
  sessionField: string | null;
}

export const DEFAULT_ENDPOINT = 'https://shield.findip.net/v1/shield/track';

/** The identity-key endpoint lives next to the track endpoint. */
export function identityKeyEndpoint(trackEndpoint: string): string {
  return trackEndpoint.replace(/\/track\/?$/, '/identity-key');
}
/** The form snapshot upload endpoint lives next to the track endpoint. */
export function snapshotEndpoint(trackEndpoint: string): string {
  return trackEndpoint.replace(/\/track\/?$/, '/snapshot');
}
export const DEFAULT_SNAPSHOT_RENDERER_URL = 'https://cdn.findip.net/shield/vendor/html-to-image-1.11.13.min.js';
export const DEFAULT_MAX_PAYLOAD_BYTES = 32_768;
export const SESSION_COOKIE_NAME = '_fip_sid';
export const SESSION_STARTED_COOKIE_NAME = '_fip_ss';
export const VISITOR_COOKIE_NAME = '_fip_vid';
export const SESSION_STORAGE_KEY = '_fip_sid';
export const SESSION_STARTED_STORAGE_KEY = '_fip_ss';
export const VISITOR_STORAGE_KEY = '_fip_vid';
export const QUEUE_MAX_SIZE = 20;

export const VALID_EVENTS = new Set([
  'page_view',
  'session_start',
  'form_view',
  'form_submitted',
  'signup_view',
  'signup_attempt',
  'signup_success',
  'login_view',
  'login_attempt',
  'login_success',
  'login_failed',
  'password_reset_view',
  'password_reset_attempt',
  'checkout_view',
  'checkout_started',
  'payment_attempt',
  'payment_failed',
  'lead_form_view',
  'lead_submitted',
  'api_request',
  'custom',
]);

export const VALID_INTEGRATIONS = new Set<Integration>([
  'javascript',
  'gtm',
  'wordpress',
  'woocommerce',
  'shopify',
  // A page inside a mobile app's WebView; sent with appId (Shield app sites).
  'webview',
]);

export const ALLOWED_CONTEXT_FIELDS = new Set([
  'user_id_hash',
  'email_hash',
  'email_domain',
  // RSA-OAEP ciphertext under the site's identity key — only the Shield
  // dashboard can open it; see core/identify.ts
  'email_enc',
  'user_id_enc',
  'account_age_days',
  'plan',
  'transaction_amount',
  'currency',
  'form_name',
  'lead_source',
  'custom',
]);

export function resolveConfig(partial: FindIPConfig): ResolvedConfig {
  if (!partial.siteKey) {
    throw new Error('FindIP: siteKey is required');
  }

  return {
    siteKey: partial.siteKey,
    privacyMode: partial.privacyMode ?? 'balanced',
    autoTrack: partial.autoTrack ?? true,
    autoDetectForms: partial.autoDetectForms ?? true,
    pushToDataLayer: partial.pushToDataLayer ?? true,
    consentRequired: partial.consentRequired ?? false,
    noConsentMode: partial.noConsentMode ?? 'strict',
    integration: normalizeIntegration(partial.integration),
    appId: normalizeAppId(partial.appId),
    identify: partial.identify ?? null,
    identityKey: partial.identityKey ?? null,
    endpoint: partial.endpoint ?? DEFAULT_ENDPOINT,
    captureFormSnapshots: partial.captureFormSnapshots ?? true,
    snapshotRendererUrl: partial.snapshotRendererUrl ?? DEFAULT_SNAPSHOT_RENDERER_URL,
    debug: partial.debug ?? false,
    maxPayloadBytes: partial.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    sessionCookieDurationMinutes: partial.sessionCookieDurationMinutes ?? 30,
    visitorCookieDurationDays: partial.visitorCookieDurationDays ?? 30,
    sessionField: resolveSessionFieldName(partial.sessionField),
    linkSession: partial.linkSession ?? false,
  };
}

/** Same shape Shield accepts for a registered app id: reverse-DNS characters, at most 160. */
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/;

function normalizeAppId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return APP_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeIntegration(value: string | undefined): Integration | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase() as Integration;
  return VALID_INTEGRATIONS.has(normalized) ? normalized : null;
}

export function parseScriptTagConfig(): Partial<FindIPConfig> {
  if (typeof document === 'undefined') return {};

  const script =
    document.currentScript ??
    Array.from(document.querySelectorAll('script[data-site-key]')).pop();

  if (!script || !(script instanceof HTMLScriptElement)) return {};

  const dataset = script.dataset;
  const config: Partial<FindIPConfig> = {};

  if (dataset.siteKey) config.siteKey = dataset.siteKey;
  if (dataset.privacyMode) config.privacyMode = dataset.privacyMode as PrivacyMode;
  if (dataset.autoTrack !== undefined) config.autoTrack = dataset.autoTrack !== 'false';
  if (dataset.autoDetectForms !== undefined) {
    config.autoDetectForms = dataset.autoDetectForms !== 'false';
  }
  if (dataset.pushToDataLayer !== undefined) {
    config.pushToDataLayer = dataset.pushToDataLayer !== 'false';
  }
  if (dataset.consentRequired !== undefined) {
    config.consentRequired = dataset.consentRequired === 'true';
  }
  if (dataset.noConsentMode) config.noConsentMode = dataset.noConsentMode as NoConsentMode;
  if (dataset.integration) config.integration = dataset.integration;
  if (dataset.appId) config.appId = dataset.appId;
  if (dataset.debug !== undefined) config.debug = dataset.debug === 'true';
  if (dataset.endpoint) config.endpoint = dataset.endpoint;
  if (dataset.identityKey) config.identityKey = dataset.identityKey;
  if (dataset.sessionField !== undefined) config.sessionField = dataset.sessionField || true;
  if (dataset.linkSession !== undefined) config.linkSession = dataset.linkSession !== 'false';

  // data-user-id / data-user-email / data-plan / data-hash-salt
  if (
    dataset.userId !== undefined ||
    dataset.userEmail !== undefined ||
    dataset.plan !== undefined ||
    dataset.hashSalt !== undefined
  ) {
    config.identify = {
      userId: dataset.userId,
      email: dataset.userEmail,
      plan: dataset.plan,
      salt: dataset.hashSalt,
    };
  }

  return config;
}
