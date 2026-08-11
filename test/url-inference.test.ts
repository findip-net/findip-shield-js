import { describe, it, expect } from 'vitest';
import { inferPageEvent } from '../src/collectors/url-inference';
import { parseUtm } from '../src/collectors/page';

describe('url-inference', () => {
  it('infers signup_view from path', () => {
    const result = inferPageEvent('/signup', '');
    expect(result?.event).toBe('signup_view');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('infers login_view from path', () => {
    const result = inferPageEvent('/login', '');
    expect(result?.event).toBe('login_view');
  });

  it('infers checkout_view from path', () => {
    const result = inferPageEvent('/checkout', '');
    expect(result?.event).toBe('checkout_view');
  });

  it('infers lead_form_view from path', () => {
    const result = inferPageEvent('/contact', '');
    expect(result?.event).toBe('lead_form_view');
  });

  it('infers password_reset_view from path', () => {
    const result = inferPageEvent('/reset-password', '');
    expect(result?.event).toBe('password_reset_view');
  });

  it('infers from page title when path is ambiguous', () => {
    const result = inferPageEvent('/page', 'Create Account - Example');
    expect(result?.event).toBe('signup_view');
    expect(result?.detection_method).toBe('page_title');
  });

  it('returns null for unrecognized pages', () => {
    expect(inferPageEvent('/about', 'About Us')).toBeNull();
  });
});

describe('utm parsing', () => {
  it('parses UTM parameters', () => {
    const utm = parseUtm('?utm_source=google&utm_medium=cpc&utm_campaign=test&gclid=abc');
    expect(utm.utm_source).toBe('google');
    expect(utm.utm_medium).toBe('cpc');
    expect(utm.gclid_present).toBe(true);
    expect(utm.fbclid_present).toBe(false);
  });
});
