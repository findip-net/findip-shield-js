/**
 * Form snapshots (SDK 1.9.0): a real picture of a form for the dashboard's
 * preview, taken in the visitor's browser only when Shield asks for one —
 * the /track response for a form view says `form_snapshot.wanted` when no
 * picture exists for this form's current outline hash, or the one it has is
 * older than the server's TTL. One browser per site answers; every other
 * visitor pays nothing.
 *
 * What is rendered is never the live form: a sanitised clone with every
 * value blanked, images and embeds stripped, wrapped in shallow clones of
 * its ancestors so the page's CSS still applies. Rendered off-screen with a
 * lazily loaded DOM-to-canvas renderer from the FindIP CDN, encoded small,
 * and posted to Shield next to /track. Skipped in strict privacy mode, on
 * data-saver connections, in hidden tabs, and when the site opts out.
 */
import type { FormMetadata } from '../collectors/forms';
import { snapshotEndpoint } from './config';
import { state } from './state';
import { debug } from '../utils/logger';

export const SNAPSHOT_MAX_BYTES = 200_000;
const MAX_WIDTH = 900;
const MAX_HEIGHT = 1200;
/** Rendered at twice the CSS size so the picture is crisp on high-density screens; halved when it would not fit the cap. */
export const RENDER_SCALE = 2;
const ATTEMPTED_KEY = '_fip_snap';
const RENDERER_TIMEOUT_MS = 10_000;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

interface Renderer {
  toCanvas(node: HTMLElement, options?: Record<string, unknown>): Promise<HTMLCanvasElement>;
}

declare global {
  interface Window {
    htmlToImage?: Renderer;
  }
  interface Navigator {
    connection?: { saveData?: boolean };
  }
}

let rendererLoading: Promise<Renderer | null> | null = null;

/** Test hook. */
export function resetSnapshotState(): void {
  rendererLoading = null;
}

/** Whether this browser may take a snapshot at all (a hidden tab waits, see requestFormSnapshot). */
export function snapshotAllowed(): boolean {
  const config = state.config;
  if (!config || config.captureFormSnapshots === false) return false;
  if (config.privacyMode === 'strict') return false;
  if (typeof document === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return false;
  return true;
}

function tabVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function attemptedKey(hash: string): string {
  return `${ATTEMPTED_KEY}:${hash}`;
}

/** One try per browser session per form version, whatever the outcome. */
export function alreadyAttempted(hash: string): boolean {
  try {
    return sessionStorage.getItem(attemptedKey(hash)) !== null;
  } catch {
    return false;
  }
}

function markAttempted(hash: string): void {
  try {
    sessionStorage.setItem(attemptedKey(hash), '1');
  } catch {
    // storage unavailable
  }
}

const VALUE_FREE_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'hidden', 'image']);
/** Embedded content the renderer cannot draw: replaced by a blank box of the same size (a captcha widget, a video). */
const EMBEDS = 'iframe, video, audio, canvas, object, embed';
const REMOVED = 'script, noscript, picture source';
/** Embeds smaller than this (hidden frames) just go. */
const PLACEHOLDER_MIN_PX = 8;
/**
 * The ancestor shells exist only so the page's descendant selectors still
 * match the form; their own layout (grid columns, card padding, flex
 * centring, fixed modals) must not squeeze or move it.
 */
const NEUTRAL_LAYOUT: Record<string, string> = {
  display: 'block',
  position: 'static',
  float: 'none',
  transform: 'none',
  width: 'auto',
  'min-width': '0',
  'max-width': 'none',
  height: 'auto',
  'min-height': '0',
  'max-height': 'none',
  margin: '0',
  padding: '0',
  border: '0',
  inset: 'auto',
  overflow: 'visible',
  opacity: '1',
  visibility: 'visible',
  animation: 'none',
  transition: 'none',
  columns: 'auto',
};
/** The form itself fills the mount at its rendered width, whatever its CSS says about margins or positioning. */
const FORM_LAYOUT: Record<string, string> = {
  'box-sizing': 'border-box',
  'min-width': '0',
  'max-width': 'none',
  margin: '0',
  position: 'static',
  float: 'none',
  transform: 'none',
};

function setImportant(el: HTMLElement, styles: Record<string, string>): void {
  for (const [property, value] of Object.entries(styles)) el.style.setProperty(property, value, 'important');
}

function placeholderFor(rect: DOMRect): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText =
    `display:inline-block;box-sizing:border-box;width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;` +
    'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;vertical-align:top;';
  return box;
}

/**
 * Blanks every value and strips embedded media from a cloned form. Given the
 * live form, every stripped embed leaves a blank box of its rendered size so
 * the layout stays true (a captcha widget keeps its place instead of leaving
 * a hole).
 */
export function sanitizeClone(node: HTMLElement, live?: HTMLElement): void {
  node.querySelectorAll('input').forEach((input) => {
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      input.checked = false;
      input.removeAttribute('checked');
      return;
    }
    if (type === 'image') {
      input.setAttribute('src', TRANSPARENT_PIXEL);
      return;
    }
    if (VALUE_FREE_INPUT_TYPES.has(type)) return;
    input.value = '';
    input.removeAttribute('value');
  });
  node.querySelectorAll('textarea').forEach((area) => {
    area.value = '';
    area.textContent = '';
  });
  node.querySelectorAll('select').forEach((select) => {
    select.querySelectorAll('option').forEach((option) => option.removeAttribute('selected'));
    select.selectedIndex = 0;
  });
  node.querySelectorAll('[contenteditable]').forEach((el) => {
    el.textContent = '';
  });
  node.querySelectorAll('img').forEach((img) => {
    img.setAttribute('src', TRANSPARENT_PIXEL);
    img.removeAttribute('srcset');
    img.removeAttribute('alt');
  });
  const liveEmbeds = live ? Array.from(live.querySelectorAll(EMBEDS)) : [];
  node.querySelectorAll(EMBEDS).forEach((el, i) => {
    const rect = liveEmbeds[i]?.getBoundingClientRect();
    if (rect && rect.width >= PLACEHOLDER_MIN_PX && rect.height >= PLACEHOLDER_MIN_PX) el.replaceWith(placeholderFor(rect));
    else el.remove();
  });
  node.querySelectorAll(REMOVED).forEach((el) => el.remove());
}

/** The page's colour behind the form: the nearest background that is not transparent, white when there is none. */
export function backgroundBehind(form: HTMLElement): string {
  for (let el: HTMLElement | null = form; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (!color || color === 'transparent') continue;
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color);
    if (!m) return color;
    if (m[4] === undefined || parseFloat(m[4]) > 0) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
  }
  return '#ffffff';
}

/**
 * The form cloned and sanitised, wrapped in shallow clones of its ancestors
 * (so descendant CSS selectors still match) whose own layout is neutralised,
 * mounted off-screen at the form's own rendered width. Caller removes
 * `container` when done.
 */
export function mountSanitizedClone(form: HTMLFormElement): { container: HTMLElement; node: HTMLElement; width: number } {
  const width = Math.max(1, Math.min(MAX_WIDTH * 2, Math.round(form.getBoundingClientRect().width) || 600));
  const node = form.cloneNode(true) as HTMLElement;
  sanitizeClone(node, form);
  setImportant(node, { ...FORM_LAYOUT, width: `${width}px` });
  const display = getComputedStyle(form).display;
  if (display === 'inline' || display === 'contents' || display === 'none') node.style.setProperty('display', 'block', 'important');
  let wrapper: HTMLElement = node;
  let ancestor = form.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const shell = ancestor.cloneNode(false) as HTMLElement;
    setImportant(shell, NEUTRAL_LAYOUT);
    shell.appendChild(wrapper);
    wrapper = shell;
    ancestor = ancestor.parentElement;
  }
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;pointer-events:none;z-index:-1;overflow:hidden;`;
  container.appendChild(wrapper);
  document.body.appendChild(container);
  return { container, node, width };
}

function loadRenderer(url: string): Promise<Renderer | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  if (rendererLoading) return rendererLoading;
  rendererLoading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = url;
    script.crossOrigin = 'anonymous';
    const timer = setTimeout(() => finish(null), RENDERER_TIMEOUT_MS);
    const finish = (value: Renderer | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    script.onload = () => finish(window.htmlToImage ?? null);
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
  return rendererLoading;
}

/** Encodes a canvas small: WebP where the browser can, JPEG otherwise; null when it cannot fit the cap. */
export function encodeCanvas(canvas: HTMLCanvasElement): string | null {
  const attempts: [string, number][] = [['image/webp', 0.8], ['image/jpeg', 0.8], ['image/jpeg', 0.55]];
  for (const [mime, quality] of attempts) {
    let url: string;
    try {
      url = canvas.toDataURL(mime, quality);
    } catch {
      return null;
    }
    if (!url.startsWith(`data:${mime};base64,`)) continue;
    if (url.length <= SNAPSHOT_MAX_BYTES * 1.37) return url;
  }
  return null;
}

/** Half-size copy of a canvas, for when the full one does not fit the cap. */
function halve(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(canvas.width / 2));
  small.height = Math.max(1, Math.round(canvas.height / 2));
  const context = small.getContext('2d');
  if (!context) return null;
  context.drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}

/** Encodes the canvas within the cap: at full size, or at half size when the full one is too big. */
export function encodeSnapshot(canvas: HTMLCanvasElement): string | null {
  const full = encodeCanvas(canvas);
  if (full) return full;
  const small = halve(canvas);
  return small ? encodeCanvas(small) : null;
}

/** Takes and uploads the snapshot; resolves true when Shield stored it. */
export async function captureFormSnapshot(
  form: HTMLFormElement,
  meta: FormMetadata,
  hash: string,
): Promise<boolean> {
  const config = state.config;
  if (!config || !snapshotAllowed() || !tabVisible() || !form.isConnected) return false;
  markAttempted(hash);
  const renderer = await loadRenderer(config.snapshotRendererUrl);
  if (!renderer) return false;

  let mounted: ReturnType<typeof mountSanitizedClone> | null = null;
  let image: string | null = null;
  let width = 0;
  let height = 0;
  try {
    mounted = mountSanitizedClone(form);
    width = Math.min(mounted.width, MAX_WIDTH);
    const scale = width / mounted.width;
    // The renderer lays the clone out again with inlined styles and fallback
    // fonts, so it can come out a few pixels taller: leave room at the bottom.
    const fullHeight = Math.ceil(Math.max(mounted.node.scrollHeight, mounted.node.getBoundingClientRect().height)) + 16;
    height = Math.min(Math.round(fullHeight * scale) || width, MAX_HEIGHT);
    const canvas = await renderer.toCanvas(mounted.node, {
      width: mounted.width,
      height: Math.min(fullHeight, Math.round(MAX_HEIGHT / scale)),
      pixelRatio: scale * RENDER_SCALE,
      backgroundColor: backgroundBehind(form),
      skipFonts: true,
      cacheBust: false,
      includeQueryParams: false,
    });
    image = encodeSnapshot(canvas);
  } catch (err) {
    debug('form snapshot failed', err);
    return false;
  } finally {
    mounted?.container.remove();
  }
  if (!image) return false;

  const body = JSON.stringify({
    site_key: config.siteKey,
    session_id: state.session.sessionId,
    page: { path: window.location.pathname.toLowerCase() },
    form: {
      form_id: meta.form_id,
      form_name: meta.form_name,
      form_action: meta.form_action,
      outline_hash: hash,
    },
    image,
    width,
    height,
  });
  try {
    const response = await fetch(snapshotEndpoint(config.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      credentials: 'omit',
      keepalive: false,
    });
    return response.ok;
  } catch (err) {
    debug('form snapshot upload failed', err);
    return false;
  }
}

/**
 * Schedules a capture when the browser is idle; one per form version per
 * session. A background tab waits until it is shown (a tab that never is
 * takes no picture).
 */
export function requestFormSnapshot(form: HTMLFormElement, meta: FormMetadata, hash: string): void {
  if (!hash || !snapshotAllowed() || alreadyAttempted(hash)) return;
  const run = () => void captureFormSnapshot(form, meta, hash);
  const whenIdle = () => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
        .requestIdleCallback(run, { timeout: 5000 });
    } else {
      setTimeout(run, 1500);
    }
  };
  if (tabVisible()) {
    whenIdle();
    return;
  }
  const onVisible = () => {
    if (!tabVisible()) return;
    document.removeEventListener('visibilitychange', onVisible);
    if (!alreadyAttempted(hash)) whenIdle();
  };
  document.addEventListener('visibilitychange', onVisible);
}
