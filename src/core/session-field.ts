import { isTrackingAllowed } from './consent';
import { state } from './state';

/**
 * Opt-in (`sessionField`): a hidden input carrying the Shield session ID in
 * the site's own forms, so the server that receives the form can ask Shield
 * about the session (server verification) without reading the `_fip_sid`
 * cookie, which a browser that blocks cookies never has.
 *
 * Only forms that POST to the page's own origin get the field: a GET form
 * would put the ID in a URL, and another origin has no use for it.
 */

export const DEFAULT_SESSION_FIELD = 'findip_session';
const OWN_ATTRIBUTE = 'data-findip-session-field';

let attached = false;

/** `true` → the default name; a string → that name, when it is a plain field name. */
export function resolveSessionFieldName(option: boolean | string | undefined | null): string | null {
  if (option === true) return DEFAULT_SESSION_FIELD;
  if (typeof option !== 'string') return null;
  const name = option.trim();
  if (name === 'true') return DEFAULT_SESSION_FIELD;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) && name !== 'false' ? name : null;
}

function postsToOwnOrigin(form: HTMLFormElement): boolean {
  if ((form.getAttribute('method') ?? 'get').trim().toLowerCase() !== 'post') return false;
  try {
    return new URL(form.getAttribute('action') || window.location.href, window.location.href).origin
      === window.location.origin;
  } catch {
    return false;
  }
}

/** Adds the field to the form, or brings its value up to date. */
export function ensureSessionField(form: HTMLFormElement): void {
  const name = state.config?.sessionField;
  const sessionId = state.session.sessionId;
  if (!name || !sessionId || !isTrackingAllowed() || !postsToOwnOrigin(form)) return;

  let input = form.querySelector<HTMLInputElement>(`input[${OWN_ATTRIBUTE}]`);
  if (!input) {
    // A field of that name the page put there itself is left alone.
    const taken = Array.from(form.elements).some((el) => (el as HTMLInputElement).name === name);
    if (taken) return;
    input = document.createElement('input');
    input.type = 'hidden';
    input.setAttribute(OWN_ATTRIBUTE, '');
    form.appendChild(input);
  }
  input.name = name;
  input.value = sessionId;
}

function onFormEvent(event: Event): void {
  const target = event.target;
  const form = target instanceof HTMLFormElement
    ? target
    : target instanceof Element
      ? target.closest('form')
      : null;
  if (form) ensureSessionField(form);
}

/**
 * On submit (capture phase, so the page's own handlers and FormData see the
 * field) and when the visitor first focuses a field, which covers forms the
 * page submits itself with form.submit().
 */
export function attachSessionField(): void {
  if (attached || typeof document === 'undefined' || !state.config?.sessionField) return;
  attached = true;
  document.addEventListener('submit', onFormEvent, true);
  document.addEventListener('focusin', onFormEvent, true);
}

/** Test hook. */
export function detachSessionField(): void {
  if (!attached || typeof document === 'undefined') return;
  document.removeEventListener('submit', onFormEvent, true);
  document.removeEventListener('focusin', onFormEvent, true);
  attached = false;
}
