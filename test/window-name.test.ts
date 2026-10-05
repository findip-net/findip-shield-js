import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { SESSION_COOKIE_NAME, VISITOR_COOKIE_NAME } from '../src/core/config';
import { deleteCookie } from '../src/core/cookies';
import { detachEnforcement } from '../src/core/enforcement';
import { buildPayload } from '../src/core/payload';
import { resetState, state } from '../src/core/state';
import { clearMemoryStore } from '../src/core/storage';
import { readWindowNameSession, writeWindowNameSession } from '../src/core/window-name';

type SessionBlock = { session_id: string; visitor_id: string | null; storage: string };
const sessionBlock = () => buildPayload({ name: 'page_view' }).session as SessionBlock;

function blockCookiesAndStorage(): void {
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => undefined });
  const refuse = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
}

/** A new page in the same tab: the SDK starts from nothing, window.name stays. */
function nextPage(siteKey = 'pub_test'): void {
  detachEnforcement();
  resetState();
  clearMemoryStore();
  init({ siteKey, autoTrack: false, autoDetectForms: false });
}

describe('session ID in window.name', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetState();
    clearMemoryStore();
    sessionStorage.clear();
    localStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);
    deleteCookie(VISITOR_COOKIE_NAME);
    window.name = '';
  });

  afterEach(() => {
    delete (document as unknown as { cookie?: string }).cookie;
    window.name = '';
  });

  it('is not used while the cookie works', () => {
    nextPage();
    expect(sessionBlock().storage).toBe('cookie');
    expect(window.name).toBe('');
  });

  it('carries the session across page loads when cookies and storage are refused', () => {
    blockCookiesAndStorage();
    nextPage();
    const first = sessionBlock();
    expect(first.storage).toBe('window_name');
    expect(window.name).toContain(first.session_id);

    nextPage();
    const second = sessionBlock();
    expect(second.session_id).toBe(first.session_id);
    expect(second.storage).toBe('window_name');
  });

  it('leaves a window name the page or its opener is using', () => {
    blockCookiesAndStorage();
    window.name = 'checkout-popup';
    nextPage();
    expect(window.name).toBe('checkout-popup');
    expect(sessionBlock().storage).toBe('memory');
  });

  it('does not read a session another site wrote', () => {
    blockCookiesAndStorage();
    nextPage('pub_other');
    const other = sessionBlock().session_id;

    nextPage('pub_test');
    expect(sessionBlock().session_id).not.toBe(other);
    expect(window.name).toContain('pub_test.');
  });

  it('starts a new session once the carried one has expired', () => {
    blockCookiesAndStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    nextPage();
    const first = sessionBlock().session_id;

    vi.setSystemTime(new Date('2026-10-06T10:31:00Z'));
    nextPage();
    expect(sessionBlock().session_id).not.toBe(first);
  });

  it('remembers a passed challenge for the same session only', () => {
    expect(writeWindowNameSession('pub_test', { sessionId: 'sess_0123456789abcdef', challengePassed: true })).toBe(true);
    expect(readWindowNameSession('pub_test', 1800)).toEqual({ sessionId: 'sess_0123456789abcdef', challengePassed: true });
    expect(readWindowNameSession('pub_other', 1800)).toBeNull();
  });

  it('restores a passed challenge on the next page', async () => {
    blockCookiesAndStorage();
    nextPage();
    const { sessionId } = state.session;
    writeWindowNameSession('pub_test', { sessionId, challengePassed: true });

    nextPage();
    expect(state.session.sessionId).toBe(sessionId);
    expect(state.challengePassed).toBe(true);
    // Later events keep the flag in window.name.
    sessionBlock();
    expect(readWindowNameSession('pub_test', 1800)?.challengePassed).toBe(true);
  });

  it('gives window.name back once the cookie works again', () => {
    blockCookiesAndStorage();
    nextPage();
    expect(window.name).not.toBe('');

    delete (document as unknown as { cookie?: string }).cookie;
    vi.restoreAllMocks();
    nextPage();
    expect(sessionBlock().storage).toBe('cookie');
    expect(window.name).toBe('');
  });
});
