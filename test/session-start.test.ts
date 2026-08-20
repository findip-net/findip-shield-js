import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import {
  SESSION_COOKIE_NAME,
  SESSION_STARTED_COOKIE_NAME,
  SESSION_STARTED_STORAGE_KEY,
} from '../src/core/config';
import { deleteCookie } from '../src/core/cookies';
import {
  hasSessionStarted,
  markSessionStarted,
} from '../src/core/session-ids';
import { resetState, state } from '../src/core/state';
import { clearMemoryStore } from '../src/core/storage';

function successfulResponse(): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ request_id: 'req_test' }),
  } as Response;
}

function eventNames(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => {
    const request = call[1] as RequestInit;
    return JSON.parse(request.body as string).event.name as string;
  });
}

describe('automatic session_start tracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    clearMemoryStore();
    sessionStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);
    deleteCookie(SESSION_STARTED_COOKIE_NAME);
  });

  it('sends session_start once across full page loads in the same session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    init({
      siteKey: 'pub_test',
      autoTrack: true,
      autoDetectForms: false,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resetState();
    init({
      siteKey: 'pub_test',
      autoTrack: true,
      autoDetectForms: false,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(eventNames(fetchMock)).toEqual([
      'session_start',
      'page_view',
      'page_view',
    ]);
  });

  it('sends session_start again when a new session ID is created', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse());
    vi.stubGlobal('fetch', fetchMock);

    init({
      siteKey: 'pub_test',
      autoTrack: true,
      autoDetectForms: false,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resetState();
    clearMemoryStore();
    sessionStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);

    init({
      siteKey: 'pub_test',
      autoTrack: true,
      autoDetectForms: false,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(eventNames(fetchMock)).toEqual([
      'session_start',
      'page_view',
      'session_start',
      'page_view',
    ]);
  });

  it('recognizes session and memory storage markers when cookies are absent', () => {
    const config = {
      siteKey: 'pub_test',
      privacyMode: 'strict' as const,
      autoTrack: true,
      autoDetectForms: false,
      pushToDataLayer: false,
      consentRequired: false,
      noConsentMode: 'strict' as const,
      endpoint: 'https://shield.findip.net/v1/shield/track',
      debug: false,
      maxPayloadBytes: 32_768,
      sessionCookieDurationMinutes: 30,
      visitorCookieDurationDays: 30,
    };
    state.session.sessionId = 'sess_test';

    markSessionStarted(config);
    deleteCookie(SESSION_STARTED_COOKIE_NAME);
    expect(hasSessionStarted(config)).toBe(true);

    deleteCookie(SESSION_STARTED_COOKIE_NAME);
    sessionStorage.removeItem(SESSION_STARTED_STORAGE_KEY);
    expect(hasSessionStarted(config)).toBe(true);
  });
});
