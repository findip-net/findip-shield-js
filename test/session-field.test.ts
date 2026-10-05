import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../src/api/init';
import { setConsent } from '../src/api/session';
import { resolveConfig, SESSION_COOKIE_NAME } from '../src/core/config';
import { deleteCookie } from '../src/core/cookies';
import { detachSessionField, resolveSessionFieldName } from '../src/core/session-field';
import { resetState, state } from '../src/core/state';
import { clearMemoryStore } from '../src/core/storage';

function addForm(html: string): HTMLFormElement {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild as HTMLFormElement;
}

function submit(form: HTMLFormElement): void {
  form.addEventListener('submit', (e) => e.preventDefault());
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

const field = (form: HTMLFormElement, name = 'findip_session') =>
  form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);

function start(sessionField?: boolean | string): void {
  init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, sessionField });
}

describe('hidden session field', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    detachSessionField();
    resetState();
    clearMemoryStore();
    sessionStorage.clear();
    deleteCookie(SESSION_COOKIE_NAME);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    detachSessionField();
  });

  it('is off unless asked for', () => {
    expect(resolveConfig({ siteKey: 'pub_test' }).sessionField).toBeNull();
    start();
    const form = addForm('<form method="post" action="/signup"><input name="email"></form>');
    submit(form);
    expect(form.querySelector('input[type="hidden"]')).toBeNull();
  });

  it('accepts true, a name, and refuses names that are not plain field names', () => {
    expect(resolveSessionFieldName(true)).toBe('findip_session');
    expect(resolveSessionFieldName('true')).toBe('findip_session');
    expect(resolveSessionFieldName('shield_sid')).toBe('shield_sid');
    expect(resolveSessionFieldName(false)).toBeNull();
    expect(resolveSessionFieldName('false')).toBeNull();
    expect(resolveSessionFieldName('a b"><script>')).toBeNull();
  });

  it('adds the session ID to a form that posts to the same origin', () => {
    start(true);
    const form = addForm('<form method="post" action="/signup"><input name="email"></form>');
    submit(form);
    expect(field(form)?.value).toBe(state.session.sessionId);
    expect(new FormData(form).get('findip_session')).toBe(state.session.sessionId);
  });

  it('adds it when the visitor first touches the form, for forms the page submits itself', () => {
    start(true);
    const form = addForm('<form method="POST"><input name="email"></form>');
    form.querySelector('input')!.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(field(form)?.value).toBe(state.session.sessionId);
  });

  it('uses the configured name and keeps one field, with the current session ID', () => {
    start('shield_sid');
    const form = addForm('<form method="post"><input name="email"></form>');
    submit(form);
    state.session.sessionId = 'sess_cl_0123456789abcdef0123';
    submit(form);
    expect(form.querySelectorAll('input[type="hidden"]')).toHaveLength(1);
    expect(field(form, 'shield_sid')?.value).toBe('sess_cl_0123456789abcdef0123');
  });

  it('leaves GET forms alone, so the ID never lands in a URL', () => {
    start(true);
    const noMethod = addForm('<form action="/search"><input name="q"></form>');
    const get = addForm('<form method="get" action="/search"><input name="q"></form>');
    submit(noMethod);
    submit(get);
    expect(field(noMethod)).toBeNull();
    expect(field(get)).toBeNull();
  });

  it('leaves forms that post to another origin alone', () => {
    start(true);
    const form = addForm('<form method="post" action="https://lists.example.net/subscribe"><input name="email"></form>');
    submit(form);
    expect(field(form)).toBeNull();
  });

  it('does not touch a field of the same name the page put there', () => {
    start(true);
    const form = addForm('<form method="post"><input type="hidden" name="findip_session" value="theirs"></form>');
    submit(form);
    expect(form.querySelectorAll('input[name="findip_session"]')).toHaveLength(1);
    expect(field(form)?.value).toBe('theirs');
  });

  it('adds nothing when tracking is switched off by consent', () => {
    init({ siteKey: 'pub_test', autoTrack: false, autoDetectForms: false, sessionField: true, consentRequired: true, noConsentMode: 'disabled' });
    setConsent(false);
    const form = addForm('<form method="post"><input name="email"></form>');
    submit(form);
    expect(field(form)).toBeNull();
  });
});
