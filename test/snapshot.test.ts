import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { outlineHash, scanFormMetadata, scanFormOutline } from '../src/collectors/forms';
import {
  alreadyAttempted,
  captureFormSnapshot,
  encodeCanvas,
  mountSanitizedClone,
  requestFormSnapshot,
  resetSnapshotState,
  sanitizeClone,
  snapshotAllowed,
} from '../src/core/snapshot';
import { resetState, state } from '../src/core/state';
import { fnv1a } from '../src/utils/hash';

const WEBP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

function page(): HTMLFormElement {
  document.body.innerHTML = `
    <main class="shell"><section id="join-box" class="card">
      <form id="join" class="signup" action="/api/join" method="post">
        <label for="em">Work email</label><input id="em" type="email" name="email" value="jane@example.com">
        <label>Password <input type="password" name="pw" value="hunter2"></label>
        <input type="checkbox" name="tos" checked> <textarea name="notes">secret notes</textarea>
        <select name="plan"><option>Free</option><option selected>Pro</option></select>
        <div contenteditable="true">typed text</div>
        <img src="https://x.test/logo.png" srcset="a 1x" alt="logo"><iframe src="https://x.test/frame"></iframe>
        <button type="submit">Create account</button>
      </form>
    </section></main>`;
  return document.getElementById('join') as HTMLFormElement;
}

function fetchMock(response: Record<string, unknown> = { stored: true }, ok = true) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/identity-key')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    return Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(response) } as Response);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetState();
  resetSnapshotState();
  sessionStorage.clear();
  delete (window as { htmlToImage?: unknown }).htmlToImage;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});
afterEach(() => vi.useRealTimers());

describe('outline hash', () => {
  it('is a stable 8-hex FNV-1a that changes when the form changes', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    const form = page();
    const hash = outlineHash(form, scanFormOutline(form));
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
    expect(scanFormMetadata(form).outline_hash).toBe(hash);
    document.querySelector('label[for="em"]')!.textContent = 'Email address';
    expect(outlineHash(form, scanFormOutline(form))).not.toBe(hash);
    expect(outlineHash(form, null)).toBeNull();
  });
});

describe('sanitised clone', () => {
  it('blanks every value and strips media, leaving labels and placeholders', () => {
    const form = page();
    const clone = form.cloneNode(true) as HTMLElement;
    sanitizeClone(clone);
    const html = clone.outerHTML;
    expect(html).not.toMatch(/jane@example|hunter2|secret notes|typed text|x\.test|logo/);
    expect((clone.querySelector('input[name=email]') as HTMLInputElement).value).toBe('');
    expect((clone.querySelector('input[name=tos]') as HTMLInputElement).checked).toBe(false);
    expect((clone.querySelector('select') as HTMLSelectElement).selectedIndex).toBe(0);
    expect(clone.querySelector('iframe')).toBeNull();
    expect(clone.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/gif/);
    expect(html).toContain('Work email');
    expect(html).toContain('Create account');
    // The live form is untouched.
    expect((form.querySelector('input[name=email]') as HTMLInputElement).value).toBe('jane@example.com');
  });

  it('mounts the clone off-screen inside shallow copies of its ancestors', () => {
    const form = page();
    const { container, node } = mountSanitizedClone(form);
    expect(container.isConnected).toBe(true);
    expect(container.style.left).toBe('-100000px');
    expect(node.closest('section#join-box.card')).not.toBeNull();
    expect(node.closest('main.shell')).not.toBeNull();
    expect(node.closest('main.shell')!.children).toHaveLength(1);
    container.remove();
  });
});

describe('when a picture may be taken', () => {
  it('needs a config, no strict mode and no data saver', () => {
    expect(snapshotAllowed()).toBe(false);
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
    expect(snapshotAllowed()).toBe(true);
    state.config!.privacyMode = 'strict';
    expect(snapshotAllowed()).toBe(false);
    state.config!.privacyMode = 'balanced';
    state.config!.captureFormSnapshots = false;
    expect(snapshotAllowed()).toBe(false);
    state.config!.captureFormSnapshots = true;
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    expect(snapshotAllowed()).toBe(false);
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });

  it('encodes WebP when the browser can, JPEG otherwise, and gives up over the cap', () => {
    const canvas = (urls: Record<string, string>) => ({ toDataURL: (mime: string) => urls[mime] ?? 'data:image/png;base64,iVBOR' }) as unknown as HTMLCanvasElement;
    expect(encodeCanvas(canvas({ 'image/webp': WEBP }))).toBe(WEBP);
    expect(encodeCanvas(canvas({ 'image/jpeg': 'data:image/jpeg;base64,/9j/4AAQ' }))).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(encodeCanvas(canvas({ 'image/webp': `data:image/webp;base64,${'A'.repeat(400_000)}`, 'image/jpeg': `data:image/jpeg;base64,${'A'.repeat(400_000)}` }))).toBeNull();
  });
});

describe('capture and upload', () => {
  it('renders the sanitised clone, posts it next to /track with the fingerprint and hash, and cleans up', async () => {
    const fetch = fetchMock();
    vi.stubGlobal('fetch', fetch);
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, endpoint: 'https://shield.test/v1/shield/track' });
    const rendered: HTMLElement[] = [];
    (window as { htmlToImage?: unknown }).htmlToImage = {
      toCanvas: (node: HTMLElement) => {
        rendered.push(node);
        expect(node.isConnected).toBe(true);
        expect(node.outerHTML).not.toContain('hunter2');
        return Promise.resolve({ toDataURL: () => WEBP } as unknown as HTMLCanvasElement);
      },
    };
    const form = page();
    const meta = scanFormMetadata(form);
    expect(await captureFormSnapshot(form, meta, meta.outline_hash!)).toBe(true);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].isConnected).toBe(false);
    const call = fetch.mock.calls.find((c) => String(c[0]).endsWith('/v1/shield/snapshot'))!;
    expect(call).toBeDefined();
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      site_key: 'pub_test',
      page: { path: '/' },
      form: { form_id: 'join', form_name: null, form_action: '/api/join', outline_hash: meta.outline_hash },
      image: WEBP,
    });
    expect(body.width).toBeGreaterThan(0);
    expect(alreadyAttempted(meta.outline_hash!)).toBe(true);
  });

  it('tries once per form version per session, and not at all when the renderer is missing', async () => {
    const fetch = fetchMock();
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, snapshotRendererUrl: 'https://cdn.test/hti.js' });
    const form = page();
    const meta = scanFormMetadata(form);
    requestFormSnapshot(form, meta, meta.outline_hash!);
    await vi.advanceTimersByTimeAsync(2000);
    // The renderer script was injected, not yet loaded: nothing rendered, nothing posted.
    expect(document.querySelector('script[src="https://cdn.test/hti.js"]')).not.toBeNull();
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/snapshot'))).toBe(false);
    expect(alreadyAttempted(meta.outline_hash!)).toBe(true);
    requestFormSnapshot(form, meta, meta.outline_hash!);
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelectorAll('script').length).toBe(1);
  });

  it('waits for a hidden tab to be shown before rendering', async () => {
    const fetch = fetchMock();
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
    let visibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
    (window as { htmlToImage?: unknown }).htmlToImage = { toCanvas: () => Promise.resolve({ toDataURL: () => WEBP } as unknown as HTMLCanvasElement) };
    const form = page();
    const meta = scanFormMetadata(form);
    requestFormSnapshot(form, meta, meta.outline_hash!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/snapshot'))).toBe(false);
    expect(alreadyAttempted(meta.outline_hash!)).toBe(false);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/snapshot'))).toBe(true);
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  });

  it('does nothing in strict privacy mode', async () => {
    const fetch = fetchMock();
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, privacyMode: 'strict' });
    const form = page();
    const meta = scanFormMetadata(form);
    requestFormSnapshot(form, meta, meta.outline_hash!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('script')).toBeNull();
    expect(alreadyAttempted(meta.outline_hash!)).toBe(false);
  });
});
