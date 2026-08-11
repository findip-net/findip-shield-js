import { state } from '../core/state';

export function debug(...args: unknown[]): void {
  if (state.config?.debug) {
    console.debug('[FindIP]', ...args);
  }
}

export function warn(...args: unknown[]): void {
  if (state.config?.debug) {
    console.warn('[FindIP]', ...args);
  }
}

export function error(...args: unknown[]): void {
  if (state.config?.debug) {
    console.error('[FindIP]', ...args);
  }
}
