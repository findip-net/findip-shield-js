import { describe, it, expect, beforeEach } from 'vitest';
import { getCookie, setCookie, deleteCookie } from '../src/core/cookies';

describe('cookies', () => {
  beforeEach(() => {
    deleteCookie('_fip_sid');
    deleteCookie('_fip_vid');
  });

  it('sets and gets a cookie', () => {
    setCookie('_fip_sid', 'sess_test123', 1800);
    expect(getCookie('_fip_sid')).toBe('sess_test123');
  });

  it('returns null for missing cookie', () => {
    expect(getCookie('_fip_missing')).toBeNull();
  });

  it('deletes a cookie', () => {
    setCookie('_fip_sid', 'sess_test123', 1800);
    deleteCookie('_fip_sid');
    expect(getCookie('_fip_sid')).toBeNull();
  });
});
