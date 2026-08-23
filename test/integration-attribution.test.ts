import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '../src/api/track';
import { resolveConfig } from '../src/core/config';
import { resetState, state } from '../src/core/state';

type GtmWindow = Window & { google_tag_manager?: unknown; dataLayer?: unknown[] };

function successfulResponse(requestId: string): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ request_id: requestId }),
  } as Response;
}

function setup(configOverrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
  state.config = resolveConfig({
    siteKey: 'pub_test',
    autoTrack: false,
    autoDetectForms: false,
    ...configOverrides,
  });
  state.initialized = true;
  state.session = { sessionId: 'sess_test', visitorId: null };

  const fetchMock = vi.fn().mockResolvedValue(successfulResponse('req_1'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentIntegration(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  const request = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(request.body as string).sdk.integration as string;
}

describe('integration attribution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    const w = window as GtmWindow;
    delete w.google_tag_manager;
    delete w.dataLayer;
  });

  it('reports javascript on a plain site even after the SDK creates the dataLayer', async () => {
    const fetchMock = setup();

    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock, 0)).toBe('javascript');

    // the first event caused ensureDataLayer() to create window.dataLayer;
    // that must not flip later events to gtm
    expect((window as GtmWindow).dataLayer).toBeDefined();
    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock, 1)).toBe('javascript');
  });

  it('reports gtm when the GTM container global is present', async () => {
    (window as GtmWindow).google_tag_manager = {};
    const fetchMock = setup();

    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock)).toBe('gtm');
  });

  it('reports gtm when the page already had a dataLayer before the SDK ran', async () => {
    (window as GtmWindow).dataLayer = [];
    const fetchMock = setup();

    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock)).toBe('gtm');
  });

  it('honors an explicit integration override even when a dataLayer exists', async () => {
    (window as GtmWindow).dataLayer = [];
    const fetchMock = setup({ integration: 'wordpress' });

    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock)).toBe('wordpress');
  });

  it('accepts every first-party integration value', () => {
    for (const value of ['javascript', 'gtm', 'wordpress', 'woocommerce', 'shopify']) {
      expect(resolveConfig({ siteKey: 'pub_test', integration: value }).integration).toBe(value);
    }
    expect(resolveConfig({ siteKey: 'pub_test', integration: ' WordPress ' }).integration).toBe(
      'wordpress',
    );
  });

  it('falls back to auto-detection for unknown override values', async () => {
    const fetchMock = setup({ integration: 'my-custom-cms' });
    expect(state.config?.integration).toBeNull();

    await trackEvent('page_view', { source: 'auto' });
    expect(sentIntegration(fetchMock)).toBe('javascript');
  });
});
