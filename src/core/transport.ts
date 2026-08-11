import { debug, warn } from '../utils/logger';

export interface TrackResponse {
  request_id?: string;
  session_id?: string;
  risk?: {
    score?: number;
    level?: string;
    recommendation?: string;
    reasons?: string[];
  };
  ip?: {
    country?: string;
    asn?: number;
    asn_name?: string;
    is_vpn?: boolean;
    is_proxy?: boolean;
    is_tor?: boolean;
    is_relay?: boolean;
    is_hosting?: boolean;
    is_malicious?: boolean;
  };
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function sendPayload(
  endpoint: string,
  payload: unknown,
  useBeacon = false,
): Promise<TrackResponse | null> {
  const body = JSON.stringify(payload);

  // text/plain keeps the POST a CORS "simple request": no preflight round-trip,
  // and sendBeacon is never dropped by Chromium's no-preflight rule (which it
  // would be with application/json). The API parses JSON regardless of type.
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      navigator.sendBeacon(endpoint, blob);
      return null;
    } catch (err) {
      debug('sendBeacon failed', err);
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      credentials: 'omit',
      keepalive: true,
    });

    if (!response.ok) {
      warn(`Track request failed with status ${response.status}`);
      return null;
    }

    return (await response.json()) as TrackResponse;
  } catch (err) {
    debug('Fetch failed', err);
    return null;
  }
}

export function getRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

export function shouldRetry(attempt: number): boolean {
  return attempt < RETRY_DELAYS_MS.length;
}
