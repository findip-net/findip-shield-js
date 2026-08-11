import { ALLOWED_CONTEXT_FIELDS } from '../core/config';
import { isPlainObject } from './object';

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_PATTERN = /^[+]?[\d\s().-]{7,}$/;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;

export function sanitizeCustomerContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    user_id_hash: null,
    email_hash: null,
    email_domain: null,
    account_age_days: null,
    plan: null,
    transaction_amount: null,
    currency: null,
    form_name: null,
    lead_source: null,
    custom: {},
  };

  for (const [key, value] of Object.entries(context)) {
    if (!ALLOWED_CONTEXT_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;

    if (key === 'custom') {
      if (isPlainObject(value)) {
        result.custom = sanitizeCustomObject(value);
      }
      continue;
    }

    const sanitized = sanitizeFieldValue(key, value);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

function sanitizeFieldValue(key: string, value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (key.endsWith('_hash')) {
    return isLikelyHash(trimmed) ? trimmed : undefined;
  }

  if (key === 'email_domain') {
    return isValidEmailDomain(trimmed) ? trimmed.toLowerCase() : undefined;
  }

  if (key === 'currency') {
    return /^[A-Z]{3}$/.test(trimmed) ? trimmed : undefined;
  }

  if (containsSensitivePattern(trimmed)) return undefined;

  return trimmed.slice(0, 256);
}

function sanitizeCustomObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let count = 0;

  for (const [key, value] of Object.entries(obj)) {
    if (count >= 20) break;
    if (typeof key !== 'string' || key.length > 64) continue;

    if (typeof value === 'boolean' || typeof value === 'number') {
      result[key] = value;
      count++;
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || containsSensitivePattern(trimmed)) continue;
      if (trimmed.length <= 256) {
        result[key] = trimmed;
        count++;
      }
    }
  }

  return result;
}

function isLikelyHash(value: string): boolean {
  return /^[a-f0-9]{32,128}$/i.test(value) || /^[A-Za-z0-9+/=]{32,}$/.test(value);
}

function isValidEmailDomain(value: string): boolean {
  if (value.includes('@')) return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

export function containsSensitivePattern(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) return true;
  if (PHONE_PATTERN.test(value)) return true;
  if (CREDIT_CARD_PATTERN.test(value)) return true;
  return false;
}

export function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('password') ||
    lower.includes('passwd') ||
    lower.includes('credit') ||
    lower.includes('card') ||
    lower.includes('cvv') ||
    lower.includes('cvc') ||
    lower.includes('ssn') ||
    lower.includes('social') ||
    lower.includes('secret')
  );
}
