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

  it('passes identity ciphertext through and blocks anything else in the _enc fields', () => {
    const ciphertext = `fk1.ik_0123456789abcdef.${'A'.repeat(342)}==`;
    const result = sanitizeCustomerContext({
      email_enc: ciphertext,
      user_id_enc: 'jane@example.com',
    });
    expect(result.email_enc).toBe(ciphertext);
    expect(result.user_id_enc).toBeNull();
    expect(
      sanitizeCustomerContext({ email_enc: `fk1.bad.${'A'.repeat(344)}` }).email_enc,
    ).toBeNull();
    expect(
      sanitizeCustomerContext({ email_enc: `fk1.ik_0123456789abcdef.${'A'.repeat(800)}` })
        .email_enc,
    ).toBeNull();
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
