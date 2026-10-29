import { afterEach, describe, expect, it } from 'vitest';
import { parseScriptTagConfig, resolveConfig } from '../src/core/config';

describe('WebView pages (Shield app sites)', () => {
  afterEach(() => {
    document.head.querySelectorAll('script[data-site-key]').forEach((s) => s.remove());
  });

  it('read the app id and the webview integration from the script tag', () => {
    const script = document.createElement('script');
    script.dataset.siteKey = 'pub_test';
    script.dataset.integration = 'webview';
    script.dataset.appId = 'com.example.app';
    document.head.appendChild(script);

    const parsed = parseScriptTagConfig();
    expect(parsed.appId).toBe('com.example.app');
    const config = resolveConfig({ siteKey: 'pub_test', ...parsed });
    expect(config.integration).toBe('webview');
    expect(config.appId).toBe('com.example.app');
  });

  it('leave a website without an app id', () => {
    expect(resolveConfig({ siteKey: 'pub_test' }).appId).toBeNull();
  });
});
