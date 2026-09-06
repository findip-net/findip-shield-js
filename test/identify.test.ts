import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { identify, init } from '../src/api/init';
import { track, trackEvent } from '../src/api/track';
import { parseScriptTagConfig } from '../src/core/config';
import { resolveIdentity } from '../src/core/identify';
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

function sentContexts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => {
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

    const bodies = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).body as string);
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
