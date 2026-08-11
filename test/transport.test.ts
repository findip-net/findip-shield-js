import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPayload, shouldRetry, getRetryDelay } from '../src/core/transport';

describe('transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends payload via fetch', async () => {
    const mockResponse = {
      request_id: 'req_123',
      risk: { score: 10, level: 'low' },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const result = await sendPayload('https://api.example.com/track', { test: true });
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/track',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
      }),
    );
  });

  it('sends text/plain so the POST stays a CORS simple request (no preflight, beacon-safe)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await sendPayload('https://api.example.com/track', { test: true });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(/^text\/plain/);
  });

  it('returns null on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await sendPayload('https://api.example.com/track', { test: true });
    expect(result).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const result = await sendPayload('https://api.example.com/track', { test: true });
    expect(result).toBeNull();
  });

  it('calculates retry delays', () => {
    expect(getRetryDelay(0)).toBe(1000);
    expect(getRetryDelay(1)).toBe(2000);
    expect(getRetryDelay(5)).toBe(4000);
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
  });
});
