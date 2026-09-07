declare const __SDK_VERSION__: string;

import type { IdentifyOptions } from './identify';

export const SDK_NAME = 'findip-shield-js';
export const SDK_VERSION = typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '1.0.0';

export type PrivacyMode = 'strict' | 'balanced' | 'advanced';
export type NoConsentMode = 'strict' | 'disabled';
export type Integration = 'javascript' | 'gtm' | 'wordpress' | 'woocommerce' | 'shopify';

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
  /** Who the visitor is; hashed and encrypted in the browser, see IdentifyOptions. */
  identify?: IdentifyOptions | null;
  /**
   * The site's identity public key ("fk1.<key id>.<base64 SPKI>") used to
   * encrypt the email and user ID for the dashboard. Normally omitted: the SDK
   * fetches it from Shield once per page when identify() carries values.
   */
  identityKey?: string | null;
  endpoint?: string;
  debug?: boolean;
  maxPayloadBytes?: number;
  sessionCookieDurationMinutes?: number;
  visitorCookieDurationDays?: number;
}

export interface ResolvedConfig extends Required<
  Omit<
    FindIPConfig,
    | 'siteKey'
    | 'privacyMode'
    | 'autoTrack'
    | 'autoDetectForms'
    | 'pushToDataLayer'
    | 'integration'
    | 'identify'
    | 'identityKey'
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
}

export const DEFAULT_ENDPOINT = 'https://shield.findip.net/v1/shield/track';

/** The identity-key endpoint lives next to the track endpoint. */
export function identityKeyEndpoint(trackEndpoint: string): string {
  return trackEndpoint.replace(/\/track\/?$/, '/identity-key');
}
export const DEFAULT_MAX_PAYLOAD_BYTES = 32_768;
export const SESSION_COOKIE_NAME = '_fip_sid';
export const SESSION_STARTED_COOKIE_NAME = '_fip_ss';
export const VISITOR_COOKIE_NAME = '_fip_vid';
export const SESSION_STORAGE_KEY = '_fip_sid';
export const SESSION_STARTED_STORAGE_KEY = '_fip_ss';
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
    identify: partial.identify ?? null,
    identityKey: partial.identityKey ?? null,
    endpoint: partial.endpoint ?? DEFAULT_ENDPOINT,
    debug: partial.debug ?? false,
    maxPayloadBytes: partial.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    sessionCookieDurationMinutes: partial.sessionCookieDurationMinutes ?? 30,
    visitorCookieDurationDays: partial.visitorCookieDurationDays ?? 30,
  };
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
  if (dataset.debug !== undefined) config.debug = dataset.debug === 'true';
  if (dataset.endpoint) config.endpoint = dataset.endpoint;
  if (dataset.identityKey) config.identityKey = dataset.identityKey;

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
