import { isTrackingAllowed } from './consent';
import { state } from './state';

/**
 * Opt-in (`linkSession`): carry the session ID across a link click for a
 * browser that does not keep the session cookie.
 *
 * At click time a same-origin link gets `_fip=<session id>.<time>` added to
 * its address. The page that opens reads the token, removes it from the
 * address bar straight away and continues the session. This is what holds a
 * visit together when the link opens in a new tab, or when the tab's
 * window.name is not ours to use.
 *
 * Kept narrow on purpose:
 * - nothing is added while the session cookie works;
 * - only same-origin http(s) links, and only clicks the page did not handle
 *   itself (a single-page app's router keeps its own addresses);
 * - a token is good for two minutes and only when the page was reached from
 *   the same origin, so a pasted, shared or crafted link starts no session.
 */

export const LINK_PARAM = '_fip';
const TOKEN = /^(sess_[A-Za-z0-9_-]{8,120})\.(\d{10,16})$/;
const PARAM_IN_SEARCH = /([?&])_fip=([^&]*)(&|$)/;
const MAX_AGE_MS = 120_000;

let attached = false;

function sameOriginReferrer(): boolean {
  try {
    return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Run once at init, before the session ID is resolved: takes the token out
 * of the address bar and, when it is fresh and came from this origin,
 * remembers the session it names.
 */
export function consumeLinkToken(): void {
  state.linkSessionId = null;
  if (!state.config?.linkSession || typeof window === 'undefined') return;

  const match = PARAM_IN_SEARCH.exec(window.location.search);
  if (!match) return;

  // Leave every other parameter exactly as it was written.
  const search = window.location.search.replace(PARAM_IN_SEARCH, (_m, pre: string, _v, post: string) =>
    post === '&' ? pre : '',
  );
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  } catch {
    // the address stays as it is; the token expires on its own
  }

  const token = TOKEN.exec(match[2]);
  if (!token || !sameOriginReferrer()) return;
  const age = Date.now() - Number(token[2]);
  if (age < 0 || age > MAX_AGE_MS) return;
  state.linkSessionId = token[1];
}

/** The link's address with the token added, or null when this link is not one to carry it. */
export function decorateHref(href: string, sessionId: string, now: number = Date.now()): string | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin !== window.location.origin) return null;
  // A jump inside the current page loads nothing.
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
    return null;
  }
  if (PARAM_IN_SEARCH.test(url.search)) return null;

  const hashAt = href.indexOf('#');
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}${LINK_PARAM}=${sessionId}.${now}${hash}`;
}

function onClick(event: MouseEvent): void {
  // Reached only after the page's own handlers: a click they took over is theirs.
  if (event.defaultPrevented || event.button > 1) return;
  if (!state.config?.linkSession || state.sessionPersistence === 'cookie' || !isTrackingAllowed()) return;
  const sessionId = state.session.sessionId;
  if (!sessionId || !(event.target instanceof Element)) return;

  const link = event.target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;

  const original = link.getAttribute('href');
  if (original === null) return;
  const decorated = decorateHref(original, sessionId);
  if (!decorated) return;

  // The browser follows the link right after this handler; the page's own
  // markup is put back so a later "copy link" never carries the token.
  link.setAttribute('href', decorated);
  setTimeout(() => link.setAttribute('href', original), 0);
}

export function attachLinkSession(): void {
  if (attached || typeof window === 'undefined' || !state.config?.linkSession) return;
  attached = true;
  window.addEventListener('click', onClick);
  window.addEventListener('auxclick', onClick);
}

/** Test hook. */
export function detachLinkSession(): void {
  if (!attached || typeof window === 'undefined') return;
  window.removeEventListener('click', onClick);
  window.removeEventListener('auxclick', onClick);
  attached = false;
}
