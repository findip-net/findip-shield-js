import { describe, it, expect } from 'vitest';
import { inferFormEvent, scanFormMetadata } from '../src/collectors/forms';

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
