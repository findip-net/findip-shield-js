import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { trackEvent } from '../src/api/track';
import {
  applyTrackResponse,
  detachEnforcement,
  navigation,
  type EnforcementConfig,
} from '../src/core/enforcement';
import { resetState, state } from '../src/core/state';

const CONFIG: EnforcementConfig = {
  actions: { block: 'stop', challenge: 'challenge', monitor: 'slow' },
  scope: ['signup', 'login', 'checkout', 'lead', 'password_reset'],
  message: 'Blocked by test.',
  redirect_url: null,
  slow_down_seconds: 2,
  turnstile_site_key: '1x00000000000000000000AA',
};

type Body = {
  event: { name: string; source: string };
  enforcement?: { action: string; outcome: string };
};

function responses(fetchMock: ReturnType<typeof vi.fn>): Body[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes('/track'))
    .map((call) => JSON.parse((call[1] as RequestInit).body as string) as Body);
}

function fetchWith(
  recommendation: string,
  enforcement: EnforcementConfig | null = CONFIG,
  rule?: { name: string; in_page?: Record<string, unknown> },
) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/challenge')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ passed: true }),
      } as Response);
    }
    if (String(url).includes('/identity-key')) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          request_id: 'req_1',
          risk: { score: 90, level: 'critical', recommendation, ...(rule ? { rule } : {}) },
          ...(enforcement ? { enforcement } : {}),
        }),
    } as Response);
  });
}

function signupForm(): HTMLFormElement {
  document.body.innerHTML = `
    <form id="f" action="/signup" method="post">
      <input type="email" name="email" value="a@b.co">
      <input type="password" name="password" value="x">
      <button type="submit">Create account</button>
    </form>`;
  const form = document.getElementById('f') as HTMLFormElement;
  // jsdom lacks requestSubmit; emulate it by dispatching a submit event.
  form.requestSubmit = () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
  return form;
}

function submit(form: HTMLFormElement): Event {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

async function boot(
  recommendation: string,
  enforcement: EnforcementConfig | null = CONFIG,
  rule?: { name: string; in_page?: Record<string, unknown> },
) {
  const fetchMock = fetchWith(recommendation, enforcement, rule);
  vi.stubGlobal('fetch', fetchMock);
  // autoDetectForms off: the tracking submit listener would accumulate on
  // document across tests (init re-attaches it) and reorder ahead of ours.
  init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
  // one page-load event brings the setting + decision
  await trackEvent('page_view', { source: 'auto' });
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  detachEnforcement();
  resetState();
  sessionStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  detachEnforcement();
});

describe('enforcement setting and decision', () => {
  it('remembers the setting and the recommendation from track responses', async () => {
    await boot('challenge');
    expect(state.enforcement).toEqual(CONFIG);
    expect(state.lastRecommendation).toBe('challenge');
  });

  it('does nothing without a setting or on allow', async () => {
    await boot('block', null);
    const form = signupForm();
    expect(submit(form).defaultPrevented).toBe(false);

    await boot('allow');
    expect(submit(signupForm()).defaultPrevented).toBe(false);
  });

  it('ignores forms outside the scope', async () => {
    await boot('block');
    document.body.innerHTML = `<form id="g"><input name="q"><button type="submit">Search</button></form>`;
    const form = document.getElementById('g') as HTMLFormElement;
    expect(submit(form).defaultPrevented).toBe(false);
  });
});

describe('stop', () => {
  it('blocks the submit, shows the message and reports it', async () => {
    const fetchMock = await boot('block');
    const form = signupForm();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    const notice = form.querySelector('.findip-shield-notice');
    expect(notice?.textContent).toBe('Blocked by test.');

    await vi.waitFor(() => expect(responses(fetchMock).length).toBe(2));
    const report = responses(fetchMock)[1];
    expect(report.event).toMatchObject({ name: 'signup_attempt', source: 'enforcement' });
    expect(report.enforcement).toEqual({ action: 'stop', outcome: 'blocked' });
  });
});

describe('slow', () => {
  it('delays the submit and resubmits once after the countdown', async () => {
    const fetchMock = await boot('monitor');
    vi.useFakeTimers();
    const form = signupForm();
    const resubmits: boolean[] = [];
    form.addEventListener('submit', (e) => resubmits.push(e.defaultPrevented));

    expect(submit(form).defaultPrevented).toBe(true);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toMatch(/wait 2 seconds/);
    vi.advanceTimersByTime(1000);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toMatch(
      /wait 1 seconds before/,
    );
    vi.advanceTimersByTime(1000);
    // only the re-submit reached the form's own listener (the first was
    // stopped in the capture phase) and it passed through unprevented
    expect(resubmits).toEqual([false]);
    expect(form.querySelector('.findip-shield-notice')).toBeNull();
    vi.useRealTimers();

    await vi.waitFor(() => expect(responses(fetchMock).length).toBeGreaterThanOrEqual(2));
    expect(responses(fetchMock)[1].enforcement).toEqual({ action: 'slow', outcome: 'delayed' });
  });
});

describe('challenge', () => {
  it('renders Turnstile, verifies the token with Shield and resubmits', async () => {
    const fetchMock = await boot('challenge');
    const render = vi.fn((_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      setTimeout(() => opts.callback('tok-123'), 0);
      return 'w1';
    });
    vi.stubGlobal('turnstile', { render, reset: vi.fn() });
    const form = signupForm();
    const resubmits: boolean[] = [];
    form.addEventListener('submit', (e) => resubmits.push(e.defaultPrevented));

    expect(submit(form).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(resubmits).toEqual([false]));

    const challengeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/challenge'));
    expect(String(challengeCall![0])).toBe('https://shield.findip.net/v1/shield/challenge');
    const sent = JSON.parse((challengeCall![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ site_key: 'pub_test', token: 'tok-123' });
    expect(sent.session_id).toBe(state.session.sessionId);
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: '1x00000000000000000000AA' });

    // the pass sticks for the session: the next submit goes straight through
    expect(state.challengePassed).toBe(true);
    expect(sessionStorage.getItem('_fip_cp')).toBe(state.session.sessionId);
    expect(submit(form).defaultPrevented).toBe(false);

    const outcomes = responses(fetchMock)
      .filter((r) => r.enforcement)
      .map((r) => r.enforcement!.outcome);
    expect(outcomes).toEqual(['challenged', 'passed']);
  });

  it('falls back to slow-down when no Turnstile key is configured', async () => {
    await boot('challenge', { ...CONFIG, turnstile_site_key: null });
    const form = signupForm();
    expect(submit(form).defaultPrevented).toBe(true);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toMatch(/Please wait/);
  });
});

describe('redirect', () => {
  it('redirects blocked visitors as soon as the decision arrives, never from the target page', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    await boot('block', {
      ...CONFIG,
      actions: { ...CONFIG.actions, block: 'redirect' },
      redirect_url: 'https://example.com/blocked',
    });
    expect(assign).toHaveBeenCalledWith('https://example.com/blocked');

    // Same origin + path as the current page → loop guard, no redirect.
    assign.mockClear();
    resetState();
    detachEnforcement();
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false });
    applyTrackResponse({
      risk: { recommendation: 'block' },
      enforcement: {
        ...CONFIG,
        actions: { ...CONFIG.actions, block: 'redirect' },
        redirect_url: window.location.href,
      },
    });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('per-form scope (form_filters)', () => {
  it('only enforces forms matching a filter of their category and reports the fingerprint', async () => {
    const fetchMock = await boot('block', {
      ...CONFIG,
      form_filters: {
        signup: [
          { path: '/', id: 'other' },
          { action: '/signup', name: 'join' },
        ],
      },
    });
    const form = signupForm(); // id "f", action "/signup", no name
    expect(submit(form).defaultPrevented).toBe(false);

    form.setAttribute('name', 'join');
    expect(submit(form).defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(responses(fetchMock).length).toBe(2));
    const report = responses(fetchMock)[1] as Body & { form?: Record<string, unknown> };
    expect(report.form).toMatchObject({ form_id: 'f', form_name: 'join', form_action: '/signup' });
  });

  it('treats an empty filter list as every form of the category', async () => {
    await boot('block', { ...CONFIG, form_filters: { signup: [] } });
    expect(submit(signupForm()).defaultPrevented).toBe(true);
  });
});

describe('apply switches and rule overrides', () => {
  it('skips rule verdicts when apply.rules is off, and score verdicts when apply.verdicts is off', async () => {
    await boot('block', { ...CONFIG, apply: { verdicts: true, rules: false } }, { name: 'r1' });
    expect(submit(signupForm()).defaultPrevented).toBe(false);

    await boot('block', { ...CONFIG, apply: { verdicts: false, rules: true } });
    expect(submit(signupForm()).defaultPrevented).toBe(false);

    await boot('block', { ...CONFIG, apply: { verdicts: false, rules: true } }, { name: 'r1' });
    expect(submit(signupForm()).defaultPrevented).toBe(true);
  });

  it("applies a rule's in-page overrides: action, delay and message", async () => {
    vi.useFakeTimers();
    // site says stop on block; the rule says slow for 2 s with its own text
    await boot('block', CONFIG, {
      name: 'gentle',
      in_page: { action: 'slow', slow_down_seconds: 2 },
    });
    const form = signupForm();
    expect(submit(form).defaultPrevented).toBe(true);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toMatch(/wait 2 seconds/);
    vi.useRealTimers();

    await boot('challenge', CONFIG, {
      name: 'firm',
      in_page: { action: 'stop', message: 'Rule says no.' },
    });
    const form2 = signupForm();
    expect(submit(form2).defaultPrevented).toBe(true);
    expect(form2.querySelector('.findip-shield-notice')?.textContent).toBe('Rule says no.');

    await boot('block', CONFIG, { name: 'off', in_page: { action: 'none' } });
    expect(submit(signupForm()).defaultPrevented).toBe(false);
  });

  it('uses a rule redirect URL and ignores malformed overrides', async () => {
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    await boot('block', CONFIG, {
      name: 'out',
      in_page: {
        action: 'redirect',
        redirect_url: 'https://example.com/rule',
        slow_down_seconds: -3,
        bogus: 1,
      },
    });
    expect(assign).toHaveBeenCalledWith('https://example.com/rule');
    expect(state.lastRule).toEqual({
      name: 'out',
      inPage: { action: 'redirect', redirect_url: 'https://example.com/rule' },
    });
  });
});

describe('custom challenge and slow-down text', () => {
  it('uses the site texts, with {seconds} replaced, and rule overrides beat them', async () => {
    vi.useFakeTimers();
    await boot('monitor', { ...CONFIG, slow_down_message: 'Hold on {seconds}s…' });
    const form = signupForm();
    submit(form);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toBe('Hold on 2s…');
    vi.advanceTimersByTime(1000);
    expect(form.querySelector('.findip-shield-notice')?.textContent).toBe('Hold on 1s…');
    vi.useRealTimers();

    await boot(
      'challenge',
      { ...CONFIG, challenge_message: 'Site: prove you are human.' },
      {
        name: 'r',
        in_page: { challenge_message: 'Rule: quick check please.' },
      },
    );
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'w'), reset: vi.fn() });
    const form2 = signupForm();
    submit(form2);
    await vi.waitFor(() =>
      expect(form2.querySelector('.findip-shield-notice')?.firstChild?.textContent).toBe(
        'Rule: quick check please.',
      ),
    );
  });
});
