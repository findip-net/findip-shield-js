import { describe, it, expect } from 'vitest';
import { sanitizeCustomerContext, containsSensitivePattern } from '../src/utils/safe';

describe('safe context sanitization', () => {
  it('allows safe context fields', () => {
    const result = sanitizeCustomerContext({
      email_domain: 'gmail.com',
      plan: 'free',
      user_id_hash: 'a'.repeat(64),
    });
    expect(result.email_domain).toBe('gmail.com');
    expect(result.plan).toBe('free');
    expect(result.user_id_hash).toBe('a'.repeat(64));
  });

  it('blocks raw email addresses', () => {
    const result = sanitizeCustomerContext({
      email_domain: 'user@gmail.com',
      custom: { note: 'contact me at user@example.com' },
    });
    expect(result.email_domain).toBeNull();
    expect((result.custom as Record<string, unknown>).note).toBeUndefined();
  });

  it('blocks phone numbers in custom fields', () => {
    const result = sanitizeCustomerContext({
      custom: { phone: '+1 555 123 4567' },
    });
    expect((result.custom as Record<string, unknown>).phone).toBeUndefined();
  });

  it('rejects non-allowlisted fields', () => {
    const result = sanitizeCustomerContext({
      password: 'secret123',
      email: 'user@example.com',
    } as Record<string, unknown>);
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('email');
  });

  it('detects sensitive patterns', () => {
    expect(containsSensitivePattern('user@example.com')).toBe(true);
    expect(containsSensitivePattern('gmail.com')).toBe(false);
  });
});
