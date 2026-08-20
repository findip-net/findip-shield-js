import {
  SESSION_COOKIE_NAME,
  SESSION_STARTED_COOKIE_NAME,
  SESSION_STARTED_STORAGE_KEY,
  VISITOR_COOKIE_NAME,
  type ResolvedConfig,
} from './config';
import { getCookie, setCookie } from './cookies';
import { ensureSessionId, ensureVisitorId } from './ids';
import { shouldCollectVisitorId } from './consent';
import {
  getMemoryFallback,
  getSessionStorage,
  SESSION_STORAGE_KEY,
  setMemoryFallback,
  setSessionStorage,
} from './storage';
import { state } from './state';

export function initializeSessionIds(config: ResolvedConfig): void {
  state.session.sessionId = resolveSessionId(config);
  state.session.visitorId = shouldCollectVisitorId()
    ? resolveVisitorId(config)
    : null;
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

  const newId = ensureSessionId();
  setCookie(SESSION_COOKIE_NAME, newId, maxAge);
  setSessionStorage(SESSION_STORAGE_KEY, newId);
  setMemoryFallback(SESSION_STORAGE_KEY, newId);
  return newId;
}

function resolveVisitorId(config: ResolvedConfig): string {
  const maxAge = config.visitorCookieDurationDays * 24 * 60 * 60;

  const fromCookie = getCookie(VISITOR_COOKIE_NAME);
  if (fromCookie) {
    setCookie(VISITOR_COOKIE_NAME, fromCookie, maxAge);
    return fromCookie;
  }

  const newId = ensureVisitorId();
  setCookie(VISITOR_COOKIE_NAME, newId, maxAge);
  return newId;
}

export function refreshSessionId(config: ResolvedConfig): void {
  state.session.sessionId = resolveSessionId(config);
}
