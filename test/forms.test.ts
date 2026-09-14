import { describe, it, expect } from 'vitest';
import { inferFormEvent, scanFormMetadata, scanFormOutline } from '../src/collectors/forms';

function createForm(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  return document.querySelector('form')!;
}

describe('forms', () => {
  it('detects signup form metadata without reading values', () => {
    const form = createForm(`
      <form>
        <input type="email" name="email" value="secret@example.com" />
        <input type="password" name="password" value="supersecret" />
        <button type="submit">Create Account</button>
      </form>
    `);

    const meta = scanFormMetadata(form);
    expect(meta.has_email_field).toBe(true);
    expect(meta.has_password_field).toBe(true);
    expect(meta.submit_text_type).toBe('signup');

    const inference = inferFormEvent(form, '/signup', 'Create Account');
    expect(inference.eventName).toBe('signup_attempt');
    expect(inference.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects login form', () => {
    const form = createForm(`
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button type="submit">Sign In</button>
      </form>
    `);

    const inference = inferFormEvent(form, '/login', 'Login');
    expect(inference.eventName).toBe('login_attempt');
  });

  it('detects lead form', () => {
    const form = createForm(`
      <form>
        <input type="text" name="name" />
        <input type="email" name="email" />
        <textarea name="message"></textarea>
        <button type="submit">Send Message</button>
      </form>
    `);

    const inference = inferFormEvent(form, '/contact', 'Contact Us');
    expect(inference.eventName).toBe('lead_submitted');
  });

  it('detects payment form', () => {
    const form = createForm(`
      <form>
        <input type="text" name="card_number" autocomplete="cc-number" />
        <input type="text" name="cvv" />
        <button type="submit">Pay Now</button>
      </form>
    `);

    const inference = inferFormEvent(form, '/checkout', 'Checkout');
    expect(inference.eventName).toBe('payment_attempt');
  });

  it('falls back to form_submitted for ambiguous forms', () => {
    const form = createForm(`
      <form>
        <input type="text" name="query" />
        <button type="submit">Go</button>
      </form>
    `);

    const inference = inferFormEvent(form, '/search', 'Search');
    expect(inference.eventName).toBe('form_submitted');
  });
});

describe('form outline (SDK 1.8.0)', () => {
  it('captures field types with their labels and the button text, never values', () => {
    const form = createForm(`
      <form>
        <label for="em">Work email</label>
        <input id="em" type="email" name="email" value="secret@example.com" />
        <label>Password <input type="password" name="password" value="hunter2" /></label>
        <input type="text" name="company" placeholder="Company name" value="ACME" />
        <select aria-label="Team size"><option>1-10</option></select>
        <textarea name="notes">private notes</textarea>
        <input type="hidden" name="csrf" value="tok" />
        <button type="submit">  Create
          account </button>
      </form>
    `);
    expect(scanFormOutline(form)).toEqual({
      fields: [
        { type: 'email', label: 'Work email' },
        { type: 'password', label: 'Password' },
        { type: 'text', label: 'Company name' },
        { type: 'select', label: 'Team size' },
        { type: 'textarea', label: 'notes' },
      ],
      button: 'Create account',
    });
    expect(JSON.stringify(scanFormMetadata(form))).not.toMatch(/secret@|hunter2|ACME|private notes|tok/);
  });

  it('caps the field count and text length and drops labels that look like values', () => {
    const inputs = Array.from({ length: 15 }, (_, i) => `<input type="text" name="f${i}" />`).join('');
    const form = createForm(`
      <form>
        ${inputs}
        <input type="text" aria-label="Reply to jane@example.com" />
        <input type="text" placeholder="${'x'.repeat(60)}" />
        <button type="submit">Call +1 555 123 4567</button>
      </form>
    `);
    const outline = scanFormOutline(form)!;
    expect(outline.fields).toHaveLength(12);
    expect(outline.fields[0]).toEqual({ type: 'text', label: 'f0' });
    expect(outline.button).toBeNull();
    const long = createForm(`<form><input type="text" placeholder="${'x'.repeat(60)}" /><button type="submit">Go</button></form>`);
    expect(scanFormOutline(long)!.fields[0].label).toHaveLength(40);
    const sensitive = createForm(`<form><input type="text" aria-label="Reply to jane@example.com" /><button type="submit">Go</button></form>`);
    expect(scanFormOutline(sensitive)!.fields[0].label).toBeNull();
    expect(scanFormOutline(createForm('<form></form>'))).toBeNull();
  });
});
