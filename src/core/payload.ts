import {
  ALLOWED_CONTEXT_FIELDS,
  SDK_NAME,
  SDK_VERSION,
  VALID_EVENTS,
  type PrivacyMode,
} from './config';
import { getEffectivePrivacyMode, getRetentionHint } from './consent';
import { state } from './state';
import { collectBrowserContext } from '../collectors/browser';
import { collectPageContext } from '../collectors/page';
import type { FormMetadata } from '../collectors/forms';
import { sanitizeCustomerContext } from '../utils/safe';

export interface EventMeta {
  name: string;
  source?: string;
  auto_detected?: boolean;
  confidence?: number;
  detection_method?: string;
}

export function normalizeEventName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (VALID_EVENTS.has(normalized)) return normalized;
  return 'custom';
}

export function buildPayload(
  event: EventMeta,
  formMeta?: FormMetadata | null,
  customerContext?: Record<string, unknown>,
): Record<string, unknown> {
  const config = state.config!;
  const privacyMode = getEffectivePrivacyMode();

  const payload: Record<string, unknown> = {
    site_key: config.siteKey,
    sdk: {
      name: SDK_NAME,
      version: SDK_VERSION,
      integration: detectIntegration(),
    },
    event: {
      name: normalizeEventName(event.name),
      timestamp: new Date().toISOString(),
      source: event.source ?? 'manual',
      ...(event.auto_detected !== undefined && { auto_detected: event.auto_detected }),
      ...(event.confidence !== undefined && { confidence: event.confidence }),
      ...(event.detection_method && { detection_method: event.detection_method }),
    },
    page: collectPageContext(),
    session: {
      session_id: state.session.sessionId,
      visitor_id: state.session.visitorId,
    },
    browser: collectBrowserContext(privacyMode),
    customer_context: sanitizeCustomerContext(customerContext ?? {}),
    privacy: {
      mode: privacyMode,
      retention_hint: getRetentionHint(),
      consent: {
        granted: state.consent.granted,
        source: state.consent.source,
      },
    },
  };

  if (formMeta) {
    payload.form = {
      field_count: formMeta.field_count,
      has_email_field: formMeta.has_email_field,
      has_password_field: formMeta.has_password_field,
      has_phone_field: formMeta.has_phone_field,
      has_payment_field: formMeta.has_payment_field,
      has_message_field: formMeta.has_message_field,
      submit_text_type: formMeta.submit_text_type,
    };
  }

  return payload;
}

export function enforcePayloadSize(
  payload: Record<string, unknown>,
  maxBytes: number,
): Record<string, unknown> {
  let serialized = JSON.stringify(payload);
  if (encodedLength(serialized) <= maxBytes) return payload;

  const trimmed = { ...payload };
  const custom = trimmed.customer_context as Record<string, unknown> | undefined;
  if (custom?.custom && typeof custom.custom === 'object') {
    trimmed.customer_context = {
      ...custom,
      custom: { _truncated: true },
    };
    serialized = JSON.stringify(trimmed);
    if (encodedLength(serialized) <= maxBytes) return trimmed;
  }

  delete trimmed.form;
  serialized = JSON.stringify(trimmed);
  if (encodedLength(serialized) <= maxBytes) return trimmed;

  trimmed.browser = collectMinimalBrowser();
  return trimmed;
}

function collectMinimalBrowser(): Record<string, unknown> {
  return {
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    timezone: getTimezone(),
  };
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function encodedLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function detectIntegration(): string {
  if (typeof window === 'undefined') return 'javascript';
  const w = window as Window & { google_tag_manager?: unknown; dataLayer?: unknown[] };
  if (w.google_tag_manager || w.dataLayer) return 'gtm';
  return 'javascript';
}

export function isValidContextField(key: string): boolean {
  return ALLOWED_CONTEXT_FIELDS.has(key);
}

export function getPrivacyModeForPayload(): PrivacyMode {
  return getEffectivePrivacyMode();
}
