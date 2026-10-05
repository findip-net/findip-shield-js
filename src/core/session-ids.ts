import {
  SESSION_COOKIE_NAME,
  SESSION_STARTED_COOKIE_NAME,
  SESSION_STARTED_STORAGE_KEY,
  VISITOR_COOKIE_NAME,
  VISITOR_STORAGE_KEY,
  type ResolvedConfig,
} from './config';
import { deleteCookie, getCookie, setCookie } from './cookies';
import { ensureSessionId, ensureVisitorId } from './ids';
import { getEffectivePrivacyMode, shouldCollectVisitorId } from './consent';
import {
  getLocalStorage,
  getMemoryFallback,
  getSessionStorage,
  removeLocalStorage,
  SESSION_STORAGE_KEY,
  sessionStorageHolds,
  setLocalStorage,
  setMemoryFallback,
  setSessionStorage,
} from './storage';
import { state, type SessionPersistence } from './state';
import {
  clearWindowNameSession,
  readWindowNameSession,
  writeWindowNameSession,
} from './window-name';

export function initializeSessionIds(config: ResolvedConfig): void {
  state.session.sessionId = resolveSessionId(config);
  state.sessionPersistence = persistSession(config, state.session.sessionId);
  syncVisitorId(config);
}

/** Brings the visitor ID in line with the current privacy mode (init, and every consent change). */
export function syncVisitorId(config: ResolvedConfig): void {
  if (shouldCollectVisitorId()) {
    state.session.visitorId = resolveVisitorId(config);
  } else {
    state.session.visitorId = null;
    state.visitorPersistence = 'none';
  }
}

/**
 * Removes the visitor ID from the browser. Called when a visitor who had
 * agreed withdraws consent, so the ID cannot come back from the other store.
 */
export function forgetVisitorId(): void {
  deleteCookie(VISITOR_COOKIE_NAME);
  removeLocalStorage(VISITOR_STORAGE_KEY);
  state.session.visitorId = null;
  state.visitorPersistence = 'none';
}

export function getSession(): { sessionId: string; visitorId: string | null } {
  return { ...state.session };
}

export function hasSessionStarted(config: ResolvedConfig): boolean {
  const sessionId = state.session.sessionId;
  const maxAge = config.sessionCookieDurationMinutes * 60;
  const marker =
    getCookie(SESSION_STARTED_COOKIE_NAME) ??
    getSessionStorage(SESSION_STARTED_STORAGE_KEY) ??
    getMemoryFallback(SESSION_STARTED_STORAGE_KEY);

  if (!sessionId || marker !== sessionId) return false;

  setCookie(SESSION_STARTED_COOKIE_NAME, sessionId, maxAge);
  setSessionStorage(SESSION_STARTED_STORAGE_KEY, sessionId);
  setMemoryFallback(SESSION_STARTED_STORAGE_KEY, sessionId);
  return true;
}

export function markSessionStarted(config: ResolvedConfig): void {
  const sessionId = state.session.sessionId;
  if (!sessionId) return;

  const maxAge = config.sessionCookieDurationMinutes * 60;
  setCookie(SESSION_STARTED_COOKIE_NAME, sessionId, maxAge);
  setSessionStorage(SESSION_STARTED_STORAGE_KEY, sessionId);
  setMemoryFallback(SESSION_STARTED_STORAGE_KEY, sessionId);
}

function resolveSessionId(config: ResolvedConfig): string {
  const maxAge = config.sessionCookieDurationMinutes * 60;

  const fromCookie = getCookie(SESSION_COOKIE_NAME);
  if (fromCookie) {
    setCookie(SESSION_COOKIE_NAME, fromCookie, maxAge);
    setSessionStorage(SESSION_STORAGE_KEY, fromCookie);
    return fromCookie;
  }

  const fromStorage = getSessionStorage(SESSION_STORAGE_KEY);
  if (fromStorage) {
    setCookie(SESSION_COOKIE_NAME, fromStorage, maxAge);
    return fromStorage;
  }

  const fromMemory = getMemoryFallback(SESSION_STORAGE_KEY);
  if (fromMemory) return fromMemory;

  const fromLink = state.linkSessionId;
  if (fromLink) {
    setCookie(SESSION_COOKIE_NAME, fromLink, maxAge);
    setSessionStorage(SESSION_STORAGE_KEY, fromLink);
    setMemoryFallback(SESSION_STORAGE_KEY, fromLink);
    return fromLink;
  }

  const fromWindow = readWindowNameSession(config.siteKey, maxAge);
  if (fromWindow) {
    setCookie(SESSION_COOKIE_NAME, fromWindow.sessionId, maxAge);
    setSessionStorage(SESSION_STORAGE_KEY, fromWindow.sessionId);
    setMemoryFallback(SESSION_STORAGE_KEY, fromWindow.sessionId);
    return fromWindow.sessionId;
  }

  const newId = ensureSessionId();
  setCookie(SESSION_COOKIE_NAME, newId, maxAge);
  setSessionStorage(SESSION_STORAGE_KEY, newId);
  setMemoryFallback(SESSION_STORAGE_KEY, newId);
  return newId;
}

/**
 * Says where the session ID is kept, and uses the tab's window.name when the
 * cookie and sessionStorage both refused it (core/window-name.ts).
 */
function persistSession(config: ResolvedConfig, sessionId: string): SessionPersistence {
  const inCookie = getCookie(SESSION_COOKIE_NAME) === sessionId;
  if (inCookie || sessionStorageHolds(SESSION_STORAGE_KEY, sessionId)) {
    clearWindowNameSession();
    return inCookie ? 'cookie' : 'session_storage';
  }
  // A flag carried from an earlier page is kept until enforcement has read it.
  const written = writeWindowNameSession(config.siteKey, {
    sessionId,
    challengePassed: state.challengePassed || challengeCarried(config, sessionId),
  });
  if (written) return 'window_name';
  return state.linkSessionId === sessionId ? 'link' : 'memory';
}

/** A challenge this tab's session passed on an earlier page, for a browser that keeps only window.name. */
export function challengePassedInWindowName(config: ResolvedConfig): boolean {
  return challengeCarried(config, state.session.sessionId);
}

function challengeCarried(config: ResolvedConfig, sessionId: string): boolean {
  const carried = readWindowNameSession(config.siteKey, config.sessionCookieDurationMinutes * 60);
  return carried?.sessionId === sessionId && carried.challengePassed;
}

/**
 * The visitor ID is kept in two places with the same lifetime: a cookie and
 * localStorage. Whichever still holds it is read (the cookie first) and both
 * are written again, so losing one of them does not start a new visitor.
 * When neither can be written there is no visitor ID (null) rather than a
 * new random one on every page.
 */
function resolveVisitorId(config: ResolvedConfig): string | null {
  const maxAge = config.visitorCookieDurationDays * 24 * 60 * 60;
  const privacyMode = getEffectivePrivacyMode();

  const id =
    getCookie(VISITOR_COOKIE_NAME) ??
    readStoredVisitorId(getLocalStorage(VISITOR_STORAGE_KEY, privacyMode)) ??
    ensureVisitorId();
  const inCookie = setCookie(VISITOR_COOKIE_NAME, id, maxAge);
  const inStorage = setLocalStorage(
    VISITOR_STORAGE_KEY,
    `${id}.${Date.now() + maxAge * 1000}`,
    privacyMode,
  );
  state.visitorPersistence = inCookie ? 'cookie' : inStorage ? 'local_storage' : 'none';
  return inCookie || inStorage ? id : null;
}

/** Stored as `<visitor id>.<expiry in ms>`; an expired or malformed value is ignored. */
function readStoredVisitorId(raw: string | null): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const expiresAt = Number(raw.slice(dot + 1));
  if (!id.startsWith('vis_') || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return id;
}

export function refreshSessionId(config: ResolvedConfig): void {
  state.session.sessionId = resolveSessionId(config);
  state.sessionPersistence = persistSession(config, state.session.sessionId);
}

/**
 * With nothing in the browser to keep the session ID, Shield answers with
 * one it derives itself, the same on every page of the visit. Adopt it so
 * getSession(), the challenge check and form snapshots name the session
 * Shield stored the events under.
 */
export function adoptServerSessionId(sessionId: string | undefined): void {
  if (state.sessionPersistence !== 'memory') return;
  if (!sessionId || !sessionId.startsWith('sess_') || sessionId === state.session.sessionId) return;
  state.session.sessionId = sessionId;
  setMemoryFallback(SESSION_STORAGE_KEY, sessionId);
}
