import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { getSession, setConsent } from '../src/api/session';
import { SESSION_COOKIE_NAME, VISITOR_COOKIE_NAME, VISITOR_STORAGE_KEY } from '../src/core/config';
import { deleteCookie, getCookie } from '../src/core/cookies';
import { buildPayload } from '../src/core/payload';
import { resetState, state } from '../src/core/state';
import { clearMemoryStore } from '../src/core/storage';

type SessionBlock = { session_id: string; visitor_id: string | null; storage: string; visitor_storage: string };

function sessionBlock(): SessionBlock {
  return buildPayload({ name: 'page_view' }).session as SessionBlock;
}

/** A browser that refuses cookies: writes are dropped and nothing reads back. */
function blockCookies(): void {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: () => undefined,
  });
}

/** A browser that refuses site storage too (what "block all cookies" does), in a tab whose name is taken. */
function blockStorage(): void {
  window.name = 'named-by-the-page';
  const refuse = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
}

function start(): void {
  init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
}

describe('when cookies are blocked', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    clearMemoryStore();
    sessionStorage.clear();
    localStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);
    deleteCookie(VISITOR_COOKIE_NAME);
  });

  afterEach(() => {
    delete (document as unknown as { cookie?: string }).cookie;
    window.name = '';
    vi.unstubAllGlobals();
  });

  it('keeps the visitor ID in the cookie and in localStorage when both work', () => {
    start();
    const session = sessionBlock();
    expect(session.storage).toBe('cookie');
    expect(session.visitor_storage).toBe('cookie');
    expect(session.visitor_id).toMatch(/^vis_/);
    expect(getCookie(VISITOR_COOKIE_NAME)).toBe(session.visitor_id);
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toMatch(new RegExp(`^${session.visitor_id}\\.\\d+$`));
  });

  it('restores the visitor ID from localStorage when only the cookie was removed', () => {
    start();
    const first = sessionBlock().visitor_id;
    deleteCookie(VISITOR_COOKIE_NAME);

    resetState();
    start();
    expect(sessionBlock().visitor_id).toBe(first);
    expect(getCookie(VISITOR_COOKIE_NAME)).toBe(first);
  });

  it('restores the visitor ID from the cookie when only localStorage was cleared', () => {
    start();
    const first = sessionBlock().visitor_id;
    localStorage.clear();

    resetState();
    start();
    expect(sessionBlock().visitor_id).toBe(first);
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toContain(first);
  });

  it('removes the visitor ID from both stores when consent is withdrawn', () => {
    start();
    setConsent(true);
    expect(sessionBlock().visitor_id).toMatch(/^vis_/);

    setConsent(false);
    expect(sessionBlock().visitor_id).toBeNull();
    expect(sessionBlock().visitor_storage).toBe('none');
    expect(getCookie(VISITOR_COOKIE_NAME)).toBeNull();
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBeNull();

    // Agreeing again starts a new visitor; the old ID is gone.
    setConsent(true);
    expect(sessionBlock().visitor_id).toMatch(/^vis_/);
  });

  it('gives a new visitor ID after consent was withdrawn and given again', () => {
    start();
    setConsent(true);
    const first = sessionBlock().visitor_id;
    setConsent(false);
    setConsent(true);
    expect(sessionBlock().visitor_id).not.toBe(first);
  });

  it('keeps a returning visitor when the page starts from denied and then gets consent', () => {
    start();
    const first = sessionBlock().visitor_id;

    // Next page load: the consent tool answers "denied" first, then "granted".
    resetState();
    start();
    setConsent(false);
    expect(sessionBlock().visitor_id).toBeNull();
    setConsent(true);
    expect(sessionBlock().visitor_id).toBe(first);
  });

  it('keeps the visitor ID in localStorage across page loads', () => {
    blockCookies();
    start();
    const first = sessionBlock();
    expect(first.storage).toBe('session_storage');
    expect(first.visitor_storage).toBe('local_storage');
    expect(first.visitor_id).toMatch(/^vis_/);

    resetState();
    start();
    const second = sessionBlock();
    expect(second.visitor_id).toBe(first.visitor_id);
    expect(second.session_id).toBe(first.session_id);
  });

  it('ignores a stored visitor ID that has expired', () => {
    blockCookies();
    localStorage.setItem(VISITOR_STORAGE_KEY, `vis_0123456789abcdef.${Date.now() - 1000}`);
    start();
    expect(sessionBlock().visitor_id).not.toBe('vis_0123456789abcdef');
  });

  it('does not use localStorage in strict privacy mode', () => {
    blockCookies();
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, privacyMode: 'strict' });
    expect(sessionBlock().visitor_id).toBeNull();
    expect(sessionBlock().visitor_storage).toBe('none');
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBeNull();
  });

  it('sends no visitor ID when nothing can be stored', () => {
    blockCookies();
    blockStorage();
    start();
    const session = sessionBlock();
    expect(session.storage).toBe('memory');
    expect(session.visitor_storage).toBe('none');
    expect(session.visitor_id).toBeNull();
    expect(session.session_id).toMatch(/^sess_/);
  });

  it('adopts the session ID Shield answers with when nothing can be stored', async () => {
    blockCookies();
    blockStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ request_id: 'req_test', session_id: 'sess_cl_0123456789abcdef0123' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    init({ siteKey: 'pub_test', autoTrack: true, autoDetectForms: false });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getSession().sessionId).toBe('sess_cl_0123456789abcdef0123'));

    // The next event names the adopted session and still says nothing persists.
    const session = sessionBlock();
    expect(session.session_id).toBe('sess_cl_0123456789abcdef0123');
    expect(session.storage).toBe('memory');
  });

  it('keeps its own session ID when it is stored in the browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ request_id: 'req_test', session_id: 'sess_cl_0123456789abcdef0123' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    init({ siteKey: 'pub_test', autoTrack: true, autoDetectForms: false });
    const own = state.session.sessionId;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(getSession().sessionId).toBe(own);
  });
});
