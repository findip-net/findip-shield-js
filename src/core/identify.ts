import { identityKeyEndpoint } from './config';
import { state } from './state';
import { debug } from '../utils/logger';

/**
 * Who the current visitor is, in the customer's own terms. Nothing here is
 * sent as given: the user ID and email are turned into SHA-256 hashes, and —
 * once the site's identity public key is known — into RSA-OAEP ciphertext
 * that only the Shield dashboard (holding the site's private key) can open.
 * Shield's ingest and storage never see the plain values.
 */
export interface IdentifyOptions {
  /** The customer's internal user ID for the logged-in visitor. */
  userId?: string | number | null;
  /** The visitor's email address; only its SHA-256, its domain and its ciphertext are sent. */
  email?: string | null;
  /** Optional plan or tier label, e.g. "free", "pro". */
  plan?: string | null;
  /**
   * Optional secret mixed into both hashes as SHA-256(salt + ':' + value), so
   * they cannot be reproduced by guessing user IDs. Use the same salt when
   * resolving a hash from the dashboard.
   */
  salt?: string | null;
}

export interface IdentityContext {
  user_id_hash?: string;
  email_hash?: string;
  email_domain?: string;
  plan?: string;
  /** RSA-OAEP ciphertext, "fk1.<key id>.<base64>" — dashboard-only. */
  email_enc?: string;
  user_id_enc?: string;
}

// Wire format shared with the API (api/src/services/identityCiphertext.ts):
// the public key arrives as "fk1.<key id>.<base64 SPKI DER>" and every
// ciphertext carries the same prefix + key id, so a rotated key keeps
// historic events readable.
const IDENTITY_FORMAT_PREFIX = 'fk1';
const IDENTITY_KEY_PATTERN = /^fk1\.(ik_[a-f0-9]{16})\.([A-Za-z0-9+/]+={0,2})$/;
const CIPHERTEXT_PATTERN = /^fk1\.ik_[a-f0-9]{16}\.[A-Za-z0-9+/]{300,}={0,2}$/;
const MAX_CIPHERTEXT_LENGTH = 700;
// RSA-OAEP-2048/SHA-256 carries at most 190 bytes per value.
const MAX_ENCRYPTABLE_BYTES = 190;
const KEY_FETCH_TIMEOUT_MS = 3000;

function clean(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  // GTM renders unset {{variables}} as these literals inside Custom HTML.
  return text === 'undefined' || text === 'null' ? '' : text;
}

function subtleCrypto(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && c.subtle ? c.subtle : null;
}

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = subtleCrypto();
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    debug('sha256 failed', err);
    return null;
  }
}

export function hasIdentity(options: IdentifyOptions | null | undefined): boolean {
  if (!options) return false;
  return Boolean(clean(options.userId) || clean(options.email) || clean(options.plan));
}

/** True when identify() carried a value the dashboard could reveal. */
export function needsEncryption(options: IdentifyOptions | null | undefined): boolean {
  if (!options) return false;
  return Boolean(clean(options.userId) || normalizeEmail(options.email));
}

export function isIdentityCiphertext(value: string): boolean {
  return value.length <= MAX_CIPHERTEXT_LENGTH && CIPHERTEXT_PATTERN.test(value);
}

function normalizeEmail(raw: unknown): string {
  const email = clean(raw).toLowerCase();
  const at = email.lastIndexOf('@');
  return at > 0 && at < email.length - 1 ? email : '';
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

/**
 * Imports the site's identity public key. Returns null for a malformed key or
 * without WebCrypto (HTTP pages): identity then stays hash-only.
 */
export async function importIdentityKey(
  identityKey: string,
): Promise<{ keyId: string; key: CryptoKey } | null> {
  const subtle = subtleCrypto();
  const match = IDENTITY_KEY_PATTERN.exec(identityKey.trim());
  if (!subtle || !match) return null;
  try {
    const key = await subtle.importKey(
      'spki',
      base64ToBytes(match[2]),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
    return { keyId: match[1], key };
  } catch (err) {
    debug('identity key import failed', err);
    return null;
  }
}

export async function encryptIdentityValue(
  imported: { keyId: string; key: CryptoKey },
  value: string,
): Promise<string | null> {
  const subtle = subtleCrypto();
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(value);
  if (bytes.length === 0 || bytes.length > MAX_ENCRYPTABLE_BYTES) return null;
  try {
    const ciphertext = await subtle.encrypt({ name: 'RSA-OAEP' }, imported.key, bytes);
    return `${IDENTITY_FORMAT_PREFIX}.${imported.keyId}.${bytesToBase64(ciphertext)}`;
  } catch (err) {
    debug('identity encryption failed', err);
    return null;
  }
}

/**
 * Turn identify options into the customer_context fields the API accepts.
 * Without WebCrypto (HTTP pages, very old browsers) the hashes are skipped
 * and only the plan and email domain are kept. With an imported identity key
 * the encrypted fields are added as well.
 */
export async function resolveIdentity(
  options: IdentifyOptions | null | undefined,
  imported?: { keyId: string; key: CryptoKey } | null,
): Promise<IdentityContext> {
  const context: IdentityContext = {};
  if (!options) return context;

  const userId = clean(options.userId);
  const email = normalizeEmail(options.email);
  const plan = clean(options.plan);
  const salt = clean(options.salt);
  const prefix = salt ? `${salt}:` : '';

  if (plan) context.plan = plan;
  if (email) context.email_domain = email.slice(email.lastIndexOf('@') + 1);

  if (userId) {
    const hash = await sha256Hex(prefix + userId);
    if (hash) context.user_id_hash = hash;
    if (imported) {
      const enc = await encryptIdentityValue(imported, userId);
      if (enc) context.user_id_enc = enc;
    }
  }
  if (email) {
    const hash = await sha256Hex(prefix + email);
    if (hash) context.email_hash = hash;
    if (imported) {
      const enc = await encryptIdentityValue(imported, email);
      if (enc) context.email_enc = enc;
    }
  }

  if ((userId || email) && !subtleCrypto()) {
    debug('WebCrypto unavailable: identity hashes skipped');
  }

  return context;
}

/**
 * The site's identity public key: the configured one, or fetched from Shield
 * once per page. null when the site has none (identity reveal off, key not
 * generated yet) or the fetch fails — identity then stays hash-only.
 */
export function loadIdentityKey(): Promise<string | null> {
  if (state.identityKeyPromise) return state.identityKeyPromise;
  const config = state.config;
  if (!config) return Promise.resolve(null);

  if (config.identityKey) {
    state.identityKeyPromise = Promise.resolve(config.identityKey);
    return state.identityKeyPromise;
  }

  state.identityKeyPromise = fetchIdentityKey(config.endpoint, config.siteKey);
  return state.identityKeyPromise;
}

async function fetchIdentityKey(trackEndpoint: string, siteKey: string): Promise<string | null> {
  if (typeof fetch !== 'function') return null;
  const url = `${identityKeyEndpoint(trackEndpoint)}?site_key=${encodeURIComponent(siteKey)}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      signal: controller?.signal,
    });
    if (!response.ok) {
      debug('No identity key for this site', response.status);
      return null;
    }
    const body = (await response.json()) as { key?: unknown };
    return typeof body.key === 'string' && IDENTITY_KEY_PATTERN.test(body.key) ? body.key : null;
  } catch (err) {
    debug('Identity key fetch failed', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Adds email_enc / user_id_enc to the current identity, once per identify()
 * call. Runs from the tracking path so it is consent-gated like every other
 * request; concurrent events share the same attempt. Never throws.
 */
export function ensureIdentityEncrypted(): Promise<void> {
  if (state.identityEncryption) return state.identityEncryption;

  const options = state.identityOptions;
  if (!needsEncryption(options) || state.identity.email_enc || state.identity.user_id_enc) {
    state.identityEncryption = Promise.resolve();
    return state.identityEncryption;
  }

  state.identityEncryption = (async () => {
    const identityKey = await loadIdentityKey();
    if (!identityKey) return;
    const imported = await importIdentityKey(identityKey);
    if (!imported) return;
    // identify() may have been called again while the key was loading.
    if (state.identityOptions !== options) return;
    const identity = await resolveIdentity(options, imported);
    if (state.identityOptions !== options) return;
    state.identity = identity;
    debug('Identity encrypted', Object.keys(identity));
  })().catch((err) => {
    debug('Identity encryption failed', err);
  });
  return state.identityEncryption;
}
