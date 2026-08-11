export interface PageContext {
  url: string;
  path: string;
  title: string;
  referrer: string;
  utm: UtmContext;
}

export interface UtmContext {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid_present: boolean;
  fbclid_present: boolean;
}

export function collectPageContext(): PageContext {
  if (typeof window === 'undefined' || typeof location === 'undefined') {
    return {
      url: '',
      path: '',
      title: '',
      referrer: '',
      utm: emptyUtm(),
    };
  }

  return {
    url: location.href,
    path: location.pathname,
    title: typeof document !== 'undefined' ? document.title : '',
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    utm: parseUtm(location.search),
  };
}

export function parseUtm(search: string): UtmContext {
  const params = new URLSearchParams(search);
  return {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_term: params.get('utm_term'),
    utm_content: params.get('utm_content'),
    gclid_present: params.has('gclid'),
    fbclid_present: params.has('fbclid'),
  };
}

function emptyUtm(): UtmContext {
  return {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    gclid_present: false,
    fbclid_present: false,
  };
}

export function getPagePath(): string {
  if (typeof location === 'undefined') return '';
  return location.pathname.toLowerCase();
}

export function getPageTitle(): string {
  if (typeof document === 'undefined') return '';
  return document.title.toLowerCase();
}
