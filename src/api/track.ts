import { QUEUE_MAX_SIZE } from '../core/config';
import { isTrackingAllowed } from '../core/consent';
import { buildPayload, enforcePayloadSize, type EventMeta } from '../core/payload';
import { getSession, refreshSessionId } from '../core/session-ids';
import { state } from '../core/state';
import {
  getRetryDelay,
  sendPayload,
  shouldRetry,
  type TrackResponse,
} from '../core/transport';
import { pushRiskResult, readDataLayerContext } from '../collectors/gtm';
import type { FormMetadata } from '../collectors/forms';
import { sanitizeCustomerContext } from '../utils/safe';
import { debug } from '../utils/logger';

export interface TrackOptions {
  source?: string;
  auto_detected?: boolean;
  confidence?: number;
  detection_method?: string;
  formMeta?: FormMetadata | null;
  useBeacon?: boolean;
}

export async function trackEvent(
  eventName: string,
  options: TrackOptions = {},
): Promise<TrackResponse | null> {
  if (!state.initialized || !state.config) {
    debug('track called before init');
    return null;
  }

  if (!isTrackingAllowed()) {
    debug('Tracking not allowed');
    return null;
  }

  refreshSessionId(state.config);

  const event: EventMeta = {
    name: eventName,
    source: options.source,
    auto_detected: options.auto_detected,
    confidence: options.confidence,
    detection_method: options.detection_method,
  };

  const gtmContext = readDataLayerContext();
  const payload = enforcePayloadSize(
    buildPayload(event, options.formMeta, gtmContext),
    state.config.maxPayloadBytes,
  );

  return enqueueAndSend(payload, options.useBeacon ?? false);
}

export async function track(
  eventName: string,
  context: Record<string, unknown> = {},
): Promise<TrackResponse | null> {
  if (!state.initialized || !state.config) {
    debug('track called before init');
    return null;
  }

  if (!isTrackingAllowed()) return null;

  refreshSessionId(state.config);

  const sanitizedContext = sanitizeCustomerContext(context);
  const event: EventMeta = {
    name: eventName,
    source: 'manual',
  };

  const payload = enforcePayloadSize(
    buildPayload(event, null, sanitizedContext),
    state.config.maxPayloadBytes,
  );

  return enqueueAndSend(payload, false);
}

async function enqueueAndSend(
  payload: Record<string, unknown>,
  useBeacon: boolean,
): Promise<TrackResponse | null> {
  if (state.queue.length >= QUEUE_MAX_SIZE) {
    debug('Dropped event because the queue is full');
    return null;
  }

  return new Promise((resolve) => {
    state.queue.push({ payload, attempts: 0, useBeacon, resolve });
    void processQueue();
  });
}

async function processQueue(): Promise<void> {
  if (state.queueProcessing) return;

  state.queueProcessing = true;
  const endpoint = state.config!.endpoint;

  try {
    while (state.queue.length > 0) {
      const item = state.queue[0];
      const response = await sendPayload(
        endpoint,
        item.payload,
        item.useBeacon,
      );

      if (response !== null || item.useBeacon) {
        state.queue.shift();
        item.resolve(response);
        if (response) pushRiskResult(response);
      } else {
        item.attempts += 1;
        if (shouldRetry(item.attempts)) {
          await sleep(getRetryDelay(item.attempts - 1));
          continue;
        }
        state.queue.shift();
        item.resolve(null);
        debug('Dropped event after retries');
      }
    }
  } finally {
    state.queueProcessing = false;

    if (state.queue.length > 0) {
      void processQueue();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { getSession };
