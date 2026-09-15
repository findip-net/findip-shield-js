import { containsSensitivePattern, isSensitiveFieldName } from '../utils/safe';
import { fnv1a } from '../utils/hash';
import { inferPageEvent, mapViewToAttemptEvent, mapViewToPaymentAttempt } from './url-inference';
import { getPagePath, getPageTitle } from './page';

export type SubmitTextType =
  | 'signup'
  | 'login'
  | 'lead'
  | 'checkout'
  | 'payment'
  | 'reset'
  | 'generic';

export interface FormMetadata {
  field_count: number;
  has_email_field: boolean;
  has_password_field: boolean;
  has_phone_field: boolean;
  has_payment_field: boolean;
  has_message_field: boolean;
  submit_text_type: SubmitTextType;
  // Fingerprint (metadata only, never values): lets the dashboard list the
  // forms it has seen and scope enforcement to specific ones.
  form_id: string | null;
  form_name: string | null;
  form_action: string | null;
  // What the form looks like (SDK 1.8.0): field types with their labels and
  // the submit button's text, so the dashboard can draw a recognisable mock.
  // Page markup only, never values; capped and filtered like the fingerprint.
  outline: FormOutline | null;
  // Change detector for the form's picture (SDK 1.9.0): hash of the outline,
  // the form's classes and its width bucket. A new hash means a new snapshot.
  outline_hash: string | null;
}

export interface FormOutlineField {
  /** input type, or "select" / "textarea". */
  type: string;
  /** The field's label, aria-label, placeholder or name; null when none. */
  label: string | null;
}

export interface FormOutline {
  fields: FormOutlineField[];
  button: string | null;
}

const FINGERPRINT_MAX = 200;
const OUTLINE_MAX_FIELDS = 12;
const OUTLINE_TEXT_MAX = 40;
const OUTLINE_TYPE_MAX = 20;

function fingerprintValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.slice(0, FINGERPRINT_MAX) : null;
}

/** The form's action as a path (no query string, no host). */
export function formActionPath(form: HTMLFormElement): string | null {
  const raw = form.getAttribute('action');
  if (raw === null || raw.trim() === '') return null;
  try {
    return fingerprintValue(new URL(raw, window.location.href).pathname);
  } catch {
    return null;
  }
}

export function formFingerprint(
  form: HTMLFormElement,
): Pick<FormMetadata, 'form_id' | 'form_name' | 'form_action'> {
  return {
    form_id: fingerprintValue(form.id),
    form_name: fingerprintValue(form.getAttribute('name')),
    form_action: formActionPath(form),
  };
}

export interface FormInferenceResult {
  eventName: string;
  confidence: number;
  detection_method: string;
  metadata: FormMetadata;
}

const EMAIL_HINTS = /email|e-mail|mail/i;
const PHONE_HINTS = /phone|tel|mobile|cell/i;
const PAYMENT_HINTS = /card|cvv|cvc|billing|payment|credit|debit|expir/i;
const MESSAGE_HINTS = /message|comment|notes|description|inquiry/i;
const NAME_HINTS = /name|company|organization|org/i;

const SUBMIT_PATTERNS: { pattern: RegExp; type: SubmitTextType; weight: number }[] = [
  { pattern: /sign\s?up|register|create\s?account|join/i, type: 'signup', weight: 0.25 },
  { pattern: /log\s?in|sign\s?in/i, type: 'login', weight: 0.25 },
  { pattern: /contact|request\s?demo|get\s?quote|send|submit/i, type: 'lead', weight: 0.2 },
  { pattern: /pay|place\s?order|checkout|complete\s?purchase/i, type: 'payment', weight: 0.25 },
  { pattern: /reset\s?password|forgot/i, type: 'reset', weight: 0.25 },
];

/** Page text as the outline carries it: trimmed, capped, never anything that looks like a value. */
function outlineText(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const capped = text.length > OUTLINE_TEXT_MAX ? `${text.slice(0, OUTLINE_TEXT_MAX - 1)}…` : text;
  // Anything that looks like a value, even embedded in a sentence: an email,
  // or a run of seven or more digits (a phone or card number).
  if (containsSensitivePattern(text) || EMBEDDED_NUMBER.test(text)) return null;
  return capped;
}
const EMBEDDED_NUMBER = /\d[\d\s().-]{5,}\d/;

/** The visible label of a field: <label for>, an enclosing <label>, aria-label, placeholder, then its name. */
function fieldLabel(form: HTMLFormElement, el: HTMLElement): string | null {
  const id = el.getAttribute('id');
  if (id) {
    const explicit = form.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
    const text = outlineText(explicit?.textContent);
    if (text) return text;
  }
  const wrapper = el.closest('label');
  if (wrapper) {
    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
    const text = outlineText(clone.textContent);
    if (text) return text;
  }
  return (
    outlineText(el.getAttribute('aria-label')) ??
    outlineText(el.getAttribute('placeholder')) ??
    outlineText(el.getAttribute('name'))
  );
}

function fieldType(el: HTMLElement): string {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  const type = (el.getAttribute('type') ?? 'text').trim().toLowerCase();
  return (type || 'text').slice(0, OUTLINE_TYPE_MAX);
}

/** The form's outline (SDK 1.8.0): up to 12 visible fields with their labels, plus the submit text. */
export function scanFormOutline(form: HTMLFormElement): FormOutline | null {
  const fields = getFormFields(form)
    .slice(0, OUTLINE_MAX_FIELDS)
    .map((el) => ({ type: fieldType(el), label: fieldLabel(form, el) }));
  const button = outlineText(getSubmitButtonText(form));
  if (fields.length === 0 && !button) return null;
  return { fields, button };
}

/**
 * How snapshots are rendered; bumped when the picture changes for the same
 * form (a new hash makes Shield ask for a fresh picture of every form once).
 * 2 = 1.9.1: layout-neutral ancestors, embed placeholders, page background, 2×.
 */
export const SNAPSHOT_FORMAT = 2;

/** The outline hash: what the form looks like, structurally, in 8 hex characters. */
export function outlineHash(form: HTMLFormElement, outline: FormOutline | null): string | null {
  if (!outline) return null;
  const width = typeof form.getBoundingClientRect === 'function' ? Math.round((form.getBoundingClientRect().width || 0) / 50) : 0;
  return fnv1a(`${SNAPSHOT_FORMAT}|${JSON.stringify(outline)}|${form.className}|${width}`);
}

export function scanFormMetadata(form: HTMLFormElement): FormMetadata {
  const fields = getFormFields(form);
  const submitText = getSubmitButtonText(form);
  const outline = scanFormOutline(form);

  return {
    field_count: fields.length,
    has_email_field: fields.some((f) => isEmailField(f)),
    has_password_field: fields.some((f) => isPasswordField(f)),
    has_phone_field: fields.some((f) => isPhoneField(f)),
    has_payment_field: fields.some((f) => isPaymentField(f)),
    has_message_field: fields.some((f) => isMessageField(f)),
    submit_text_type: classifySubmitText(submitText),
    ...formFingerprint(form),
    outline,
    outline_hash: outlineHash(form, outline),
  };
}

function getFormFields(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll('input, select, textarea')).filter(
    (el) => !isHiddenField(el),
  ) as HTMLElement[];
}

function isHiddenField(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return el.type === 'hidden' || el.type === 'submit' || el.type === 'button';
  }
  return false;
}

function getFieldIdentifier(el: HTMLElement): string {
  const parts = [
    el.getAttribute('name') ?? '',
    el.getAttribute('id') ?? '',
    el.getAttribute('type') ?? '',
    el.getAttribute('autocomplete') ?? '',
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('aria-label') ?? '',
  ];
  return parts.join(' ').toLowerCase();
}

function isEmailField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'email') return true;
  }
  return EMAIL_HINTS.test(getFieldIdentifier(el));
}

function isPasswordField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  return isSensitiveFieldName(getFieldIdentifier(el));
}

function isPhoneField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === 'tel') return true;
  return PHONE_HINTS.test(getFieldIdentifier(el));
}

function isPaymentField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (['cc-number', 'cc-exp', 'cc-csc', 'cc-name'].includes(el.autocomplete)) return true;
  }
  return PAYMENT_HINTS.test(getFieldIdentifier(el));
}

function isMessageField(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  return MESSAGE_HINTS.test(getFieldIdentifier(el));
}

function isNameField(el: HTMLElement): boolean {
  return NAME_HINTS.test(getFieldIdentifier(el));
}

function getSubmitButtonText(form: HTMLFormElement): string {
  const submit = form.querySelector('[type="submit"], button:not([type="button"])');
  if (!submit) return '';
  return (submit.textContent ?? submit.getAttribute('value') ?? '').trim();
}

function classifySubmitText(text: string): SubmitTextType {
  for (const { pattern, type } of SUBMIT_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'generic';
}

export function inferFormEvent(
  form: HTMLFormElement,
  path?: string,
  title?: string,
): FormInferenceResult {
  const metadata = scanFormMetadata(form);
  const submitText = getSubmitButtonText(form);
  const pageInference = inferPageEvent(path ?? getPagePath(), title ?? getPageTitle());
  const hasNameField = getFormFields(form).some((f) => isNameField(f));

  let confidence = 0.4;
  const detectionParts: string[] = [];
  let eventName = 'form_submitted';

  if (metadata.has_password_field && metadata.has_email_field) {
    if (metadata.submit_text_type === 'login' || pageInference?.event === 'login_view') {
      eventName = 'login_attempt';
      confidence += 0.35;
      detectionParts.push('login_fields');
    } else {
      eventName = 'signup_attempt';
      confidence += 0.35;
      detectionParts.push('signup_fields');
    }
  } else if (metadata.has_email_field && !metadata.has_password_field) {
    eventName = 'lead_submitted';
    confidence += 0.3;
    detectionParts.push('lead_fields');
    if (hasNameField) confidence += 0.05;
  }

  if (metadata.has_payment_field || metadata.submit_text_type === 'payment') {
    eventName = mapViewToPaymentAttempt('checkout_view', metadata.has_payment_field);
    confidence += 0.35;
    detectionParts.push('payment_fields');
  } else if (metadata.submit_text_type === 'checkout') {
    eventName = 'checkout_started';
    confidence += 0.25;
    detectionParts.push('checkout_button');
  }

  if (metadata.submit_text_type === 'reset') {
    eventName = 'password_reset_attempt';
    confidence += 0.3;
    detectionParts.push('reset_button');
  }

  for (const { pattern, type, weight } of SUBMIT_PATTERNS) {
    if (pattern.test(submitText)) {
      confidence += weight;
      detectionParts.push(`button_${type}`);
      break;
    }
  }

  if (pageInference) {
    const attemptEvent = mapViewToAttemptEvent(pageInference.event);
    if (attemptEvent) {
      if (pageInference.event === 'checkout_view' && metadata.has_payment_field) {
        eventName = 'payment_attempt';
      } else {
        eventName = attemptEvent;
      }
      confidence += pageInference.confidence * 0.3;
      detectionParts.push('url');
    }
  }

  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  if (confidence < 0.5) {
    eventName = 'form_submitted';
    confidence = Math.max(confidence, 0.4);
  }

  return {
    eventName,
    confidence,
    detection_method: detectionParts.length
      ? `form_fields_button_text_${detectionParts.join('_')}`
      : 'form_fields',
    metadata,
  };
}

export function attachFormListeners(onSubmit: (form: HTMLFormElement) => void): void {
  if (typeof document === 'undefined') return;

  document.addEventListener(
    'submit',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLFormElement)) return;
      onSubmit(target);
    },
    true,
  );
}

export function observeFormViews(onView: (form: HTMLFormElement) => void): void {
  if (typeof document === 'undefined' || typeof IntersectionObserver === 'undefined') return;

  const seen = new WeakSet<HTMLFormElement>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target instanceof HTMLFormElement) {
          if (!seen.has(entry.target)) {
            seen.add(entry.target);
            onView(entry.target);
          }
        }
      }
    },
    { threshold: 0.25 },
  );

  const forms = document.querySelectorAll('form');
  forms.forEach((form) => observer.observe(form));

  if (typeof MutationObserver !== 'undefined') {
    const mutation = new MutationObserver(() => {
      document.querySelectorAll('form').forEach((form) => {
        if (!seen.has(form)) observer.observe(form);
      });
    });
    mutation.observe(document.body, { childList: true, subtree: true });
  }
}
