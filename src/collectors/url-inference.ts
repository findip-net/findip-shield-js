import { getPagePath, getPageTitle } from './page';

export type InferredPageEvent =
  | 'signup_view'
  | 'login_view'
  | 'checkout_view'
  | 'lead_form_view'
  | 'password_reset_view'
  | null;

export interface UrlInferenceResult {
  event: InferredPageEvent;
  confidence: number;
  detection_method: string;
}

interface PathRule {
  patterns: RegExp[];
  event: NonNullable<InferredPageEvent>;
  weight: number;
}

const PATH_RULES: PathRule[] = [
  {
    patterns: [/\/signup\b/i, /\/register\b/i, /\/create-account\b/i, /\/join\b/i],
    event: 'signup_view',
    weight: 0.95,
  },
  {
    patterns: [/\/login\b/i, /\/signin\b/i, /\/auth\b/i],
    event: 'login_view',
    weight: 0.95,
  },
  {
    patterns: [/\/checkout\b/i, /\/cart\b/i, /\/payment\b/i, /\/billing\b/i],
    event: 'checkout_view',
    weight: 0.92,
  },
  {
    patterns: [/\/contact\b/i, /\/demo\b/i, /\/request-demo\b/i, /\/quote\b/i, /\/lead\b/i],
    event: 'lead_form_view',
    weight: 0.9,
  },
  {
    patterns: [/\/forgot-password\b/i, /\/reset-password\b/i, /\/password-recovery\b/i],
    event: 'password_reset_view',
    weight: 0.93,
  },
];

const TITLE_KEYWORDS: Record<NonNullable<InferredPageEvent>, RegExp[]> = {
  signup_view: [/sign\s?up/i, /register/i, /create\s?account/i],
  login_view: [/log\s?in/i, /sign\s?in/i],
  checkout_view: [/checkout/i, /payment/i, /billing/i, /cart/i],
  lead_form_view: [/contact/i, /demo/i, /quote/i, /lead/i],
  password_reset_view: [/reset\s?password/i, /forgot\s?password/i],
};

export function inferPageEvent(path?: string, title?: string): UrlInferenceResult | null {
  const normalizedPath = (path ?? getPagePath()).toLowerCase();
  const normalizedTitle = (title ?? getPageTitle()).toLowerCase();

  for (const rule of PATH_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedPath))) {
      return {
        event: rule.event,
        confidence: rule.weight,
        detection_method: 'url_path',
      };
    }
  }

  for (const [event, patterns] of Object.entries(TITLE_KEYWORDS) as [
    NonNullable<InferredPageEvent>,
    RegExp[],
  ][]) {
    if (patterns.some((pattern) => pattern.test(normalizedTitle))) {
      return {
        event,
        confidence: 0.75,
        detection_method: 'page_title',
      };
    }
  }

  return null;
}

export function mapViewToAttemptEvent(viewEvent: InferredPageEvent): string | null {
  switch (viewEvent) {
    case 'signup_view':
      return 'signup_attempt';
    case 'login_view':
      return 'login_attempt';
    case 'checkout_view':
      return 'checkout_started';
    case 'lead_form_view':
      return 'lead_submitted';
    case 'password_reset_view':
      return 'password_reset_attempt';
    default:
      return null;
  }
}

export function mapViewToPaymentAttempt(viewEvent: InferredPageEvent, hasPaymentField: boolean): string {
  if (viewEvent === 'checkout_view' && hasPaymentField) return 'payment_attempt';
  if (viewEvent === 'checkout_view') return 'checkout_started';
  return 'form_submitted';
}
