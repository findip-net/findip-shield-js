import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { observeFormViews } from '../src/collectors/forms';
import { resetState } from '../src/core/state';

/**
 * A synchronous script in <head> runs before the parser has created <body>.
 * jsdom has no IntersectionObserver, so the tests bring a small one that
 * reports every observed form as visible.
 */
class VisibleIntersectionObserver {
  static observed: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    VisibleIntersectionObserver.observed.push(target);
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** Lets a test stop the observers the SDK started, so none outlives the test. */
const mutationObservers: MutationObserver[] = [];
const NativeMutationObserver = MutationObserver;
class TrackedMutationObserver extends NativeMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    mutationObservers.push(this);
  }
}

function removeBody(): HTMLElement {
  const body = document.body;
  body.remove();
  expect(document.body).toBeNull();
  return body;
}

/** What the parser does once it reaches <body>, then the end of the document. */
function finishLoading(body: HTMLElement, html: string): void {
  body.innerHTML = html;
  document.documentElement.appendChild(body);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

const SIGNUP_FORM = `
  <form id="signup">
    <input type="email" name="email" value="secret@example.com" />
    <input type="password" name="password" value="supersecret" />
    <button type="submit">Create account</button>
  </form>`;

describe('init() before <body> exists', () => {
  let readyState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetState();
    document.body.innerHTML = '';
    VisibleIntersectionObserver.observed = [];
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
    vi.stubGlobal('MutationObserver', TrackedMutationObserver);
    readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  });

  afterEach(() => {
    mutationObservers.splice(0).forEach((observer) => observer.disconnect());
    if (!document.body) document.documentElement.appendChild(document.createElement('body'));
    vi.unstubAllGlobals();
  });

  it('does not throw when called from a head script', () => {
    const body = removeBody();
    try {
      expect(() => init({ siteKey: 'pub_test', autoTrack: false })).not.toThrow();
    } finally {
      finishLoading(body, '');
    }
  });

  it('reports the forms present at DOMContentLoaded, with metadata only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ request_id: 'req_test' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const body = removeBody();
    init({ siteKey: 'pub_test', autoTrack: false });
    expect(fetchMock).not.toHaveBeenCalled();

    finishLoading(body, SIGNUP_FORM);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const sent = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(JSON.parse(sent).event.name).toBe('signup_view');
    expect(sent).not.toMatch(/secret@example\.com|supersecret/);
  });

  it('sees forms added after the body exists', async () => {
    const seen: HTMLFormElement[] = [];
    const body = removeBody();
    observeFormViews((form) => seen.push(form));

    finishLoading(body, SIGNUP_FORM);
    expect(seen.map((form) => form.id)).toEqual(['signup']);

    const late = document.createElement('form');
    late.id = 'late';
    document.body.appendChild(late);
    await vi.waitFor(() => expect(seen.map((form) => form.id)).toEqual(['signup', 'late']));
  });

  it('reports each form once when the body already exists', async () => {
    readyState.mockReturnValue('complete');
    document.body.innerHTML = SIGNUP_FORM;
    const seen: HTMLFormElement[] = [];
    observeFormViews((form) => seen.push(form));
    document.dispatchEvent(new Event('DOMContentLoaded'));

    document.body.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(1);
  });

  it('still starts on a finished document that has no body', async () => {
    readyState.mockReturnValue('complete');
    const seen: HTMLFormElement[] = [];
    const body = removeBody();
    expect(() => observeFormViews((form) => seen.push(form))).not.toThrow();

    body.innerHTML = SIGNUP_FORM;
    document.documentElement.appendChild(body);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
  });
});
