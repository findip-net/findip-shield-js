import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { SESSION_COOKIE_NAME, VISITOR_COOKIE_NAME } from '../src/core/config';
import { deleteCookie } from '../src/core/cookies';
import { decorateHref, detachLinkSession } from '../src/core/link-session';
import { buildPayload } from '../src/core/payload';
import { resetState, state } from '../src/core/state';
import { clearMemoryStore } from '../src/core/storage';

type SessionBlock = { session_id: string; visitor_id: string | null; storage: string };
const sessionBlock = () => buildPayload({ name: 'page_view' }).session as SessionBlock;
const ORIGIN = window.location.origin;

/** Cookies and site storage refused, and the tab's name taken: nothing in the browser keeps the session. */
function blockEverything(): void {
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => undefined });
  const refuse = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  window.name = 'named-by-the-page';
}

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => value });
}

function openPage(path: string, linkSession = true): void {
  detachLinkSession();
  resetState();
  clearMemoryStore();
  window.history.replaceState(null, '', path);
  init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, linkSession });
}

/** Clicks the link and returns the address the browser would follow. */
function click(link: HTMLAnchorElement, type: 'click' | 'auxclick' = 'click', button = 0): string {
  let followed = '';
  const capture = (event: Event) => {
    followed = link.getAttribute('href') ?? '';
    event.preventDefault();
  };
  window.addEventListener(type, capture);
  link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }));
  window.removeEventListener(type, capture);
  return followed;
}

function addLink(href: string, attributes = ''): HTMLAnchorElement {
  document.body.insertAdjacentHTML('beforeend', `<a href="${href}" ${attributes}>link</a>`);
  return document.body.lastElementChild as HTMLAnchorElement;
}

describe('session ID in a link token', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);
    deleteCookie(VISITOR_COOKIE_NAME);
    window.name = '';
    document.body.innerHTML = '';
    setReferrer('');
  });

  afterEach(() => {
    detachLinkSession();
    delete (document as unknown as { cookie?: string }).cookie;
    delete (document as unknown as { referrer?: string }).referrer;
    window.name = '';
    window.history.replaceState(null, '', '/');
  });

  it('is off unless asked for', () => {
    blockEverything();
    openPage('/', false);
    expect(click(addLink('/pricing'))).toBe('/pricing');
  });

  it('adds nothing while the session cookie works', () => {
    openPage('/');
    expect(sessionBlock().storage).toBe('cookie');
    expect(click(addLink('/pricing'))).toBe('/pricing');
  });

  it('adds the token to a same-origin link at click time and puts the link back afterwards', async () => {
    blockEverything();
    openPage('/');
    const link = addLink('/pricing?plan=pro#faq');
    const followed = click(link);
    expect(followed).toMatch(new RegExp(`^/pricing\\?plan=pro&_fip=${state.session.sessionId}\\.\\d+#faq$`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(link.getAttribute('href')).toBe('/pricing?plan=pro#faq');
  });

  it('covers a middle click, which opens a new tab', () => {
    blockEverything();
    openPage('/');
    expect(click(addLink('/pricing'), 'auxclick', 1)).toContain('_fip=');
  });

  it('leaves other origins, downloads, in-page jumps and non-web links alone', () => {
    blockEverything();
    openPage('/docs');
    expect(click(addLink('https://other.example/page'))).toBe('https://other.example/page');
    expect(click(addLink('/file.pdf', 'download'))).toBe('/file.pdf');
    expect(click(addLink('#section'))).toBe('#section');
    expect(click(addLink('mailto:someone@example.com'))).toBe('mailto:someone@example.com');
  });

  it('leaves a click the page handled itself alone', () => {
    blockEverything();
    openPage('/');
    const link = addLink('/app/route');
    link.addEventListener('click', (event) => event.preventDefault());
    expect(click(link)).toBe('/app/route');
  });

  it('continues the session on the next page and takes the token out of the address', () => {
    blockEverything();
    openPage('/');
    const first = sessionBlock();
    expect(first.storage).toBe('memory');
    const followed = click(addLink('/pricing?plan=pro#faq'));

    setReferrer(`${ORIGIN}/`);
    openPage(followed);
    const second = sessionBlock();
    expect(second.session_id).toBe(first.session_id);
    expect(second.storage).toBe('link');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/pricing?plan=pro#faq');
  });

  it('carries the session into a new tab when window.name is free', () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => undefined });
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    openPage('/');
    const first = sessionBlock();
    expect(first.storage).toBe('window_name');
    const followed = click(addLink('/pricing'));

    // The new tab starts with an empty window.name.
    window.name = '';
    setReferrer(`${ORIGIN}/`);
    openPage(followed);
    expect(sessionBlock()).toMatchObject({ session_id: first.session_id, storage: 'window_name' });
  });

  it('ignores a token on a page that was not reached from this origin, and still removes it', () => {
    blockEverything();
    const token = `sess_0123456789abcdef.${Date.now()}`;
    for (const referrer of ['', 'https://other.example/']) {
      setReferrer(referrer);
      openPage(`/pricing?_fip=${token}`);
      expect(sessionBlock().session_id).not.toBe('sess_0123456789abcdef');
      expect(window.location.search).toBe('');
    }
  });

  it('ignores a token older than two minutes or one that is malformed', () => {
    blockEverything();
    setReferrer(`${ORIGIN}/`);
    openPage(`/pricing?_fip=sess_0123456789abcdef.${Date.now() - 121_000}`);
    expect(sessionBlock().session_id).not.toBe('sess_0123456789abcdef');
    openPage('/pricing?a=1&_fip=not-a-token&b=2');
    expect(window.location.search).toBe('?a=1&b=2');
  });

  it('leaves the address alone when the option is off', () => {
    setReferrer(`${ORIGIN}/`);
    openPage(`/pricing?_fip=sess_0123456789abcdef.${Date.now()}`, false);
    expect(window.location.search).toContain('_fip=');
    expect(sessionBlock().session_id).not.toBe('sess_0123456789abcdef');
  });

  it('prefers a session the browser itself kept over the token', () => {
    openPage('/');
    const own = sessionBlock().session_id;
    setReferrer(`${ORIGIN}/`);
    openPage(`/pricing?_fip=sess_0123456789abcdef.${Date.now()}`);
    expect(sessionBlock()).toMatchObject({ session_id: own, storage: 'cookie' });
  });

  it('does not decorate a link that already carries a token', () => {
    expect(decorateHref('/pricing?_fip=x', 'sess_0123456789abcdef')).toBeNull();
  });
});
