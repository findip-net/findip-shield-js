import { debug } from '../utils/logger';

/**
 * Who the current visitor is, in the customer's own terms. Everything here is
 * turned into hashes (or a bare domain) before it leaves the page: Shield
 * never receives the raw user ID or email address.
 */
export interface IdentifyOptions {
  /** The customer's internal user ID for the logged-in visitor. */
  userId?: string | number | null;
  /** The visitor's email address; only its SHA-256 and domain are sent. */
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
}

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

/**
 * Turn identify options into the customer_context fields the API accepts.
 * Without WebCrypto (HTTP pages, very old browsers) the hashes are skipped
 * and only the plan and email domain are kept.
 */
export async function resolveIdentity(
  options: IdentifyOptions | null | undefined,
): Promise<IdentityContext> {
  const context: IdentityContext = {};
  if (!options) return context;

  const userId = clean(options.userId);
  const email = clean(options.email).toLowerCase();
  const plan = clean(options.plan);
  const salt = clean(options.salt);
  const prefix = salt ? `${salt}:` : '';

  const at = email.lastIndexOf('@');
  const emailIsValid = at > 0 && at < email.length - 1;

  if (plan) context.plan = plan;
  if (emailIsValid) context.email_domain = email.slice(at + 1);

  if (userId) {
    const hash = await sha256Hex(prefix + userId);
    if (hash) context.user_id_hash = hash;
  }
  if (emailIsValid) {
    const hash = await sha256Hex(prefix + email);
    if (hash) context.email_hash = hash;
  }

  if ((userId || emailIsValid) && !subtleCrypto()) {
    debug('WebCrypto unavailable: identity hashes skipped');
  }

  return context;
}
