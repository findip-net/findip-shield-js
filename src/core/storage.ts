import type { PrivacyMode } from './config';
import { SESSION_STORAGE_KEY } from './config';

const memoryStore = new Map<string, string>();

export function canUseLocalStorage(privacyMode: PrivacyMode): boolean {
  return privacyMode !== 'strict';
}

export function getSessionStorage(key: string): string | null {
  if (typeof sessionStorage === 'undefined') return memoryStore.get(key) ?? null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

export function setSessionStorage(key: string, value: string): boolean {
  if (typeof sessionStorage === 'undefined') {
    memoryStore.set(key, value);
    return true;
  }
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    memoryStore.set(key, value);
    return false;
  }
}

export function getLocalStorage(key: string, privacyMode: PrivacyMode): string | null {
  if (!canUseLocalStorage(privacyMode)) return null;
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setLocalStorage(key: string, value: string, privacyMode: PrivacyMode): boolean {
  if (!canUseLocalStorage(privacyMode)) return false;
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function getMemoryFallback(key: string): string | null {
  return memoryStore.get(key) ?? null;
}

export function setMemoryFallback(key: string, value: string): void {
  memoryStore.set(key, value);
}

export function clearMemoryStore(): void {
  memoryStore.clear();
}

export { SESSION_STORAGE_KEY };
