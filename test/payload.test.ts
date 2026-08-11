import { describe, it, expect, beforeEach } from 'vitest';
import { resolveConfig } from '../src/core/config';
import { resetState, state } from '../src/core/state';
import { buildPayload, normalizeEventName, enforcePayloadSize } from '../src/core/payload';

describe('payload', () => {
  beforeEach(() => {
    resetState();
    state.config = resolveConfig({ siteKey: 'pub_test' });
    state.session = { sessionId: 'sess_abc', visitorId: 'vis_xyz' };
  });

  it('builds a complete payload', () => {
    const payload = buildPayload({ name: 'page_view', source: 'auto' });
    expect(payload.site_key).toBe('pub_test');
    expect((payload.sdk as { name: string }).name).toBe('findip-shield-js');
    expect((payload.event as { name: string }).name).toBe('page_view');
    expect((payload.session as { session_id: string }).session_id).toBe('sess_abc');
    expect((payload.privacy as { mode: string }).mode).toBe('balanced');
  });

  it('normalizes invalid event names to custom', () => {
    expect(normalizeEventName('unknown_event')).toBe('custom');
    expect(normalizeEventName('signup_attempt')).toBe('signup_attempt');
  });

  it('includes form metadata when provided', () => {
    const payload = buildPayload(
      { name: 'signup_attempt' },
      {
        field_count: 3,
        has_email_field: true,
        has_password_field: true,
        has_phone_field: false,
        has_payment_field: false,
        has_message_field: false,
        submit_text_type: 'signup',
      },
    );
    expect((payload.form as { has_email_field: boolean }).has_email_field).toBe(true);
  });

  it('enforces payload size limit', () => {
    const payload = buildPayload({ name: 'page_view' }, null, {
      custom: { big: 'x'.repeat(50_000) },
    });
    const limited = enforcePayloadSize(payload, 1024);
    const size = JSON.stringify(limited).length;
    expect(size).toBeLessThanOrEqual(2048);
  });
});
