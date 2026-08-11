import { state } from '../core/state';
import type { TrackResponse } from '../core/transport';

export interface DataLayerEntry {
  event: string;
  findip_session_id: string;
  findip_visitor_id: string | null;
  findip_request_id: string | null;
  findip_risk_score: number | null;
  findip_risk_level: string | null;
  findip_recommendation: string | null;
  findip_is_vpn: boolean | null;
  findip_is_proxy: boolean | null;
  findip_is_tor: boolean | null;
  findip_is_relay: boolean | null;
  findip_is_hosting: boolean | null;
  findip_is_malicious: boolean | null;
  findip_country: string | null;
  findip_asn: number | null;
}

export function ensureDataLayer(): unknown[] {
  if (typeof window === 'undefined') return [];
  const w = window as Window & { dataLayer?: unknown[] };
  if (!w.dataLayer) w.dataLayer = [];
  return w.dataLayer;
}

export function pushRiskResult(response: TrackResponse | null): void {
  if (!state.config?.pushToDataLayer || !response) return;

  const entry: DataLayerEntry = {
    event: 'findip_risk_result',
    findip_session_id: response.session_id ?? state.session.sessionId,
    findip_visitor_id: state.session.visitorId,
    findip_request_id: response.request_id ?? null,
    findip_risk_score: response.risk?.score ?? null,
    findip_risk_level: response.risk?.level ?? null,
    findip_recommendation: response.risk?.recommendation ?? null,
    findip_is_vpn: response.ip?.is_vpn ?? null,
    findip_is_proxy: response.ip?.is_proxy ?? null,
    findip_is_tor: response.ip?.is_tor ?? null,
    findip_is_relay: response.ip?.is_relay ?? null,
    findip_is_hosting: response.ip?.is_hosting ?? null,
    findip_is_malicious: response.ip?.is_malicious ?? null,
    findip_country: response.ip?.country ?? null,
    findip_asn: response.ip?.asn ?? null,
  };

  ensureDataLayer().push(entry);
}

export function isGtmPresent(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { google_tag_manager?: unknown; dataLayer?: unknown[] };
  return Boolean(w.google_tag_manager || w.dataLayer);
}

export function readDataLayerContext(): Record<string, unknown> {
  const layer = ensureDataLayer();
  const result: Record<string, unknown> = {};

  const allowedKeys = [
    'user_id_hash',
    'email_hash',
    'email_domain',
    'plan',
    'transaction_amount',
    'currency',
    'form_name',
    'lead_source',
  ];

  for (const item of layer) {
    if (!item || typeof item !== 'object') continue;
    for (const key of allowedKeys) {
      const value = (item as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && result[key] === undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}
