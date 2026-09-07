import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { identify, init } from '../src/api/init';
import { track, trackEvent } from '../src/api/track';
import { identityKeyEndpoint, parseScriptTagConfig } from '../src/core/config';
import {
  encryptIdentityValue,
  importIdentityKey,
  isIdentityCiphertext,
  resolveIdentity,
} from '../src/core/identify';
import { applyConsent } from '../src/core/consent';
import { resetState, state } from '../src/core/state';

// Known digests (also verified in a real browser against WebCrypto).
const USER_HASH = '443d71e54221ce0889ab87795f7a9ad8e7a48524a7e79ebad13711c9bac55548'; // sha256('pepper:12345')
const EMAIL_HASH = '76dc6e362477ff579ac3d2c5ddaae9c40165816c3f997197c267a212912cc974'; // sha256('pepper:jane.doe@gmail.com')

function ensureWebCrypto(): void {
  const g = globalThis as { crypto?: Crypto };
  if (!g.crypto || !g.crypto.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
}

function okResponse(): Response {
  return { ok: true, json: () => Promise.resolve({ request_id: 'req_1' }) } as Response;
}

const KEY_ID = 'ik_0123456789abcdef';

/** A site identity key pair the way findip-shield-api generates it. */
async function generateSiteKey(): Promise<{ identityKey: string; privateKey: CryptoKey }> {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  return { identityKey: `fk1.${KEY_ID}.${spki}`, privateKey: pair.privateKey };
}

/** What the dashboard does with a ciphertext. */
async function decrypt(privateKey: CryptoKey, ciphertext: string): Promise<string> {
  const [prefix, keyId, b64] = ciphertext.split('.');
  expect(prefix).toBe('fk1');
  expect(keyId).toBe(KEY_ID);
  const plain = await webcrypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, Buffer.from(b64, 'base64'));
  return new TextDecoder().decode(plain);
}

/** fetch mock that serves the identity-key endpoint and accepts track posts. */
function fetchServing(identityKey: string | null): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/identity-key')) {
      return Promise.resolve(
        identityKey
          ? ({ ok: true, status: 200, json: () => Promise.resolve({ key: identityKey }) } as Response)
          : ({ ok: false, status: 404, json: () => Promise.resolve({ error: 'no_identity_key' }) } as Response),
      );
    }
    return Promise.resolve(okResponse());
  });
}

function trackCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((call) => !String(call[0]).includes('/identity-key'));
}

function sentContexts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return trackCalls(fetchMock).map((call) => {
    const body = JSON.parse((call[1] as RequestInit).body as string) as {
      customer_context: Record<string, unknown>;
    };
    return body.customer_context;
  });
}

describe('resolveIdentity', () => {
  beforeEach(ensureWebCrypto);

  it('hashes the user id and email with the salt and keeps the domain and plan', async () => {
    const identity = await resolveIdentity({
      userId: 12345,
      email: ' Jane.Doe@Gmail.com ',
      plan: 'pro',
      salt: 'pepper',
    });
    expect(identity).toEqual({
      user_id_hash: USER_HASH,
      email_hash: EMAIL_HASH,
      email_domain: 'gmail.com',
      plan: 'pro',
    });
  });

  it('ignores empty values and GTM placeholders rendered as "undefined"', async () => {
    expect(await resolveIdentity({ userId: 'undefined', email: 'null', plan: '' })).toEqual({});
    expect(await resolveIdentity(null)).toEqual({});
  });

  it('rejects malformed emails', async () => {
    const identity = await resolveIdentity({ email: 'not-an-email' });
    expect(identity).toEqual({});
  });

  it('keeps plan and domain when WebCrypto is unavailable', async () => {
    const original = (globalThis as { crypto?: Crypto }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const identity = await resolveIdentity({ userId: '1', email: 'a@b.co', plan: 'free' });
      expect(identity).toEqual({ email_domain: 'b.co', plan: 'free' });
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('identify via init and identify()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    ensureWebCrypto();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('attaches the hashed identity to the first automatic event and never the raw values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    init({
      siteKey: 'pub_test',
      autoDetectForms: false,
      identify: { userId: 12345, email: 'Jane.Doe@Gmail.com', plan: 'pro', salt: 'pepper' },
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await state.identityReady;

    const contexts = sentContexts(fetchMock);
    expect(contexts[0]).toMatchObject({
      user_id_hash: USER_HASH,
      email_hash: EMAIL_HASH,
      email_domain: 'gmail.com',
      plan: 'pro',
    });

    const bodies = trackCalls(fetchMock).map((call) => (call[1] as RequestInit).body as string);
    for (const body of bodies) {
      expect(body).not.toContain('12345');
      expect(body.toLowerCase()).not.toContain('jane.doe@gmail.com');
    }
  });

  it('merges the identity into manual events, with explicit context winning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
    identify({ userId: 12345, plan: 'pro', salt: 'pepper' });

    await track('checkout_started', { plan: 'enterprise', currency: 'USD' });

    const [context] = sentContexts(fetchMock);
    expect(context).toMatchObject({ user_id_hash: USER_HASH, plan: 'enterprise', currency: 'USD' });
  });

  it('beats dataLayer values and can be cleared with null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [{ plan: 'from_datalayer' }];

    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, identify: { plan: 'pro' } });
    // automatic events are the ones that read the dataLayer
    await trackEvent('page_view', { source: 'auto' });
    identify(null);
    await trackEvent('page_view', { source: 'auto' });

    const contexts = sentContexts(fetchMock);
    expect(contexts[0].plan).toBe('pro');
    expect(contexts[1].plan).toBe('from_datalayer');
  });

  it('reads identification from script tag data attributes', () => {
    const script = document.createElement('script');
    script.dataset.siteKey = 'pub_test';
    script.dataset.userId = '42';
    script.dataset.userEmail = 'a@b.co';
    script.dataset.plan = 'free';
    script.dataset.hashSalt = 's';
    document.head.appendChild(script);

    expect(parseScriptTagConfig().identify).toEqual({
      userId: '42',
      email: 'a@b.co',
      plan: 'free',
      salt: 's',
    });
  });
});

describe('identity encryption', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    ensureWebCrypto();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('derives the identity-key endpoint from the track endpoint', () => {
    expect(identityKeyEndpoint('https://shield.findip.net/v1/shield/track')).toBe(
      'https://shield.findip.net/v1/shield/identity-key',
    );
    expect(identityKeyEndpoint('http://localhost:3000/v1/shield/track/')).toBe(
      'http://localhost:3000/v1/shield/identity-key',
    );
  });

  it('encrypts values only the site private key can open', async () => {
    const { identityKey, privateKey } = await generateSiteKey();
    const imported = await importIdentityKey(identityKey);
    expect(imported?.keyId).toBe(KEY_ID);

    const ciphertext = await encryptIdentityValue(imported!, 'jane.doe@gmail.com');
    expect(ciphertext).toMatch(/^fk1\.ik_[a-f0-9]{16}\.[A-Za-z0-9+/]+=*$/);
    expect(isIdentityCiphertext(ciphertext!)).toBe(true);
    expect(ciphertext).not.toContain('jane');
    expect(await decrypt(privateKey, ciphertext!)).toBe('jane.doe@gmail.com');

    // randomized: the same value never yields the same ciphertext
    expect(await encryptIdentityValue(imported!, 'jane.doe@gmail.com')).not.toBe(ciphertext);
    // too long for RSA-OAEP-2048 → skipped, never truncated
    expect(await encryptIdentityValue(imported!, 'x'.repeat(191))).toBeNull();
    // malformed keys are ignored
    expect(await importIdentityKey('fk1.bad.QUJD')).toBeNull();
    expect(await importIdentityKey(`fk1.${KEY_ID}.not-base64!`)).toBeNull();
  });

  it('resolveIdentity adds the encrypted fields next to the hashes', async () => {
    const { identityKey, privateKey } = await generateSiteKey();
    const imported = await importIdentityKey(identityKey);
    const identity = await resolveIdentity(
      { userId: 12345, email: ' Jane.Doe@Gmail.com ', plan: 'pro', salt: 'pepper' },
      imported,
    );
    expect(identity).toMatchObject({
      user_id_hash: USER_HASH,
      email_hash: EMAIL_HASH,
      email_domain: 'gmail.com',
      plan: 'pro',
    });
    expect(await decrypt(privateKey, identity.email_enc!)).toBe('jane.doe@gmail.com');
    expect(await decrypt(privateKey, identity.user_id_enc!)).toBe('12345');
  });

  it('fetches the site key once per page and attaches ciphertext to every event', async () => {
    const { identityKey, privateKey } = await generateSiteKey();
    const fetchMock = fetchServing(identityKey);
    vi.stubGlobal('fetch', fetchMock);

    init({
      siteKey: 'pub_test',
      autoDetectForms: false,
      identify: { userId: 42, email: 'Jane.Doe@Gmail.com', plan: 'pro' },
    });
    await vi.waitFor(() => expect(trackCalls(fetchMock).length).toBeGreaterThanOrEqual(1));
    await track('checkout_started', { currency: 'USD' });

    const keyFetches = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/identity-key'));
    expect(keyFetches).toHaveLength(1);
    expect(String(keyFetches[0][0])).toBe(
      'https://shield.findip.net/v1/shield/identity-key?site_key=pub_test',
    );

    const contexts = sentContexts(fetchMock);
    expect(contexts.length).toBeGreaterThanOrEqual(2);
    for (const context of contexts) {
      expect(context.email_hash).toEqual(expect.any(String));
      expect(await decrypt(privateKey, context.email_enc as string)).toBe('jane.doe@gmail.com');
      expect(await decrypt(privateKey, context.user_id_enc as string)).toBe('42');
    }
    // the same ciphertext is reused across the page's events
    expect(new Set(contexts.map((c) => c.email_enc)).size).toBe(1);

    for (const call of trackCalls(fetchMock)) {
      const body = ((call[1] as RequestInit).body as string).toLowerCase();
      expect(body).not.toContain('jane.doe@gmail.com');
      expect(body).not.toContain('"42"');
    }
  });

  it('stays hash-only when the site has no identity key', async () => {
    const fetchMock = fetchServing(null);
    vi.stubGlobal('fetch', fetchMock);

    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, identify: { email: 'a@b.co' } });
    await trackEvent('page_view', { source: 'auto' });
    await trackEvent('page_view', { source: 'auto' });

    const contexts = sentContexts(fetchMock);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].email_hash).toEqual(expect.any(String));
    expect(contexts[0].email_enc).toBeNull();
    expect(contexts[0].user_id_enc).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/identity-key'))).toHaveLength(1);
  });

  it('uses a configured identityKey without fetching, and drops it on identify(null)', async () => {
    const { identityKey, privateKey } = await generateSiteKey();
    const fetchMock = fetchServing(null);
    vi.stubGlobal('fetch', fetchMock);

    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, identityKey });
    identify({ email: 'jane@example.com' });
    await trackEvent('page_view', { source: 'auto' });
    identify(null);
    await trackEvent('page_view', { source: 'auto' });

    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/identity-key'))).toHaveLength(0);
    const contexts = sentContexts(fetchMock);
    expect(await decrypt(privateKey, contexts[0].email_enc as string)).toBe('jane@example.com');
    expect(contexts[1].email_enc).toBeNull();
    expect(contexts[1].email_hash).toBeNull();
  });

  it('never fetches the key or sends anything while tracking is not allowed', async () => {
    const fetchMock = fetchServing(null);
    vi.stubGlobal('fetch', fetchMock);
    init({
      siteKey: 'pub_test',
      autoTrack: false,
      autoDetectForms: false,
      consentRequired: true,
      noConsentMode: 'disabled',
      identify: { email: 'jane@example.com' },
    });
    applyConsent(false);
    await trackEvent('page_view', { source: 'auto' });
    await state.identityReady;
    expect(fetchMock).not.toHaveBeenCalled();

    // Consent granted later: the key fetch and the event go out together.
    applyConsent(true);
    await trackEvent('page_view', { source: 'auto' });
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/identity-key'))).toHaveLength(1);
    expect(sentContexts(fetchMock)).toHaveLength(1);
  });

  it('reads data-identity-key from the script tag', () => {
    const script = document.createElement('script');
    script.dataset.siteKey = 'pub_test';
    script.dataset.identityKey = `fk1.${KEY_ID}.QUJD`;
    document.head.appendChild(script);
    expect(parseScriptTagConfig().identityKey).toBe(`fk1.${KEY_ID}.QUJD`);
  });
});
