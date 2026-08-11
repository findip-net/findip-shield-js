import type { PrivacyMode } from '../core/config';

export interface BrowserContext {
  user_agent: string;
  language: string;
  languages?: string[];
  timezone: string;
  platform?: string;
  cookie_enabled?: boolean;
  screen?: {
    width: number;
    height: number;
    color_depth: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
  touch_support?: boolean;
}

export function collectBrowserContext(privacyMode: PrivacyMode): BrowserContext {
  if (typeof navigator === 'undefined') {
    return { user_agent: '', language: '', timezone: '' };
  }

  if (privacyMode === 'strict') {
    return {
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone: getTimezone(),
    };
  }

  const context: BrowserContext = {
    user_agent: navigator.userAgent,
    language: navigator.language,
    languages: [...(navigator.languages ?? [navigator.language])],
    timezone: getTimezone(),
    platform: navigator.platform,
    cookie_enabled: navigator.cookieEnabled,
    touch_support: getTouchSupport(),
  };

  if (typeof screen !== 'undefined') {
    context.screen = {
      width: screen.width,
      height: screen.height,
      color_depth: screen.colorDepth,
    };
  }

  if (typeof window !== 'undefined') {
    context.viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  if (privacyMode === 'advanced') {
    context.touch_support = getTouchSupport();
  }

  return context;
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function getTouchSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as Navigator & { msMaxTouchPoints?: number }).msMaxTouchPoints! > 0
  );
}
