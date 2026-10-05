/**
 * The session ID in window.name, for a browser that refuses both the cookie
 * and sessionStorage. window.name belongs to the tab: it survives a
 * navigation and ends when the tab closes, so it carries a session and
 * nothing longer.
 *
 * Rules that keep it out of the page's way:
 * - only an empty window.name is written (a page or an opener may be using
 *   the name to address this window), and only our own value is replaced;
 * - the value names the site key, so a session written on one site is never
 *   read on another;
 * - it carries its last-seen time and expires like the session cookie.
 */

const MARKER = '_fip_sid=';
const PATTERN = /^_fip_sid=([A-Za-z0-9_]{1,64})\.(sess_[A-Za-z0-9_-]{8,120})\.(\d{10,16})(\.c)?$/;

export interface WindowNameSession {
  sessionId: string;
  challengePassed: boolean;
}

function currentName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return typeof window.name === 'string' ? window.name : null;
  } catch {
    return null;
  }
}

/** The session this tab carries for this site, if it has not expired. */
export function readWindowNameSession(siteKey: string, maxAgeSeconds: number): WindowNameSession | null {
  const match = PATTERN.exec(currentName() ?? '');
  if (!match || match[1] !== siteKey) return null;
  const lastSeen = Number(match[3]);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > maxAgeSeconds * 1000) return null;
  return { sessionId: match[2], challengePassed: match[4] === '.c' };
}

/** Writes the session into window.name. False when the name is in use by someone else. */
export function writeWindowNameSession(siteKey: string, session: WindowNameSession): boolean {
  const name = currentName();
  if (name === null || (name !== '' && !name.startsWith(MARKER))) return false;
  const value = `${MARKER}${siteKey}.${session.sessionId}.${Date.now()}${session.challengePassed ? '.c' : ''}`;
  if (!PATTERN.test(value)) return false;
  try {
    window.name = value;
    return window.name === value;
  } catch {
    return false;
  }
}

/** Removes our value (and only ours) once the cookie or sessionStorage holds the session. */
export function clearWindowNameSession(): void {
  const name = currentName();
  if (!name || !name.startsWith(MARKER)) return;
  try {
    window.name = '';
  } catch {
    // not ours to change
  }
}
