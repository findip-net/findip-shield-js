import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '../src/api/track';
import { resolveConfig } from '../src/core/config';
import { resetState, state } from '../src/core/state';

function successfulResponse(requestId: string): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ request_id: requestId }),
  } as Response;
}

describe('event queue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    state.config = resolveConfig({
      siteKey: 'pub_test',
      autoTrack: false,
      autoDetectForms: false,
    });
    state.initialized = true;
    state.session = { sessionId: 'sess_test', visitorId: null };
  });

  it('serializes concurrent tracking calls without sending an event twice', async () => {
    let resolveFirstRequest: ((response: Response) => void) | undefined;
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(successfulResponse('req_form'));
    vi.stubGlobal('fetch', fetchMock);

    const sessionResult = trackEvent('session_start', { source: 'auto' });
    const formResult = trackEvent('form_view', {
      source: 'auto_form_detect',
      auto_detected: true,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFirstRequest?.(successfulResponse('req_session'));

    await expect(sessionResult).resolves.toMatchObject({ request_id: 'req_session' });
    await expect(formResult).resolves.toMatchObject({ request_id: 'req_form' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const eventNames = fetchMock.mock.calls.map((call) => {
      const request = call[1] as RequestInit;
      return JSON.parse(request.body as string).event.name as string;
    });
    expect(eventNames).toEqual(['session_start', 'form_view']);
  });
});
