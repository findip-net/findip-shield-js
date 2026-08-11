export function generateId(prefix: string): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex.slice(0, 16)}`;
}

export function ensureSessionId(existing?: string | null): string {
  if (existing && existing.startsWith('sess_')) return existing;
  return generateId('sess');
}

export function ensureVisitorId(existing?: string | null): string {
  if (existing && existing.startsWith('vis_')) return existing;
  return generateId('vis');
}
