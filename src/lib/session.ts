/**
 * Session management via URL parameters.
 *
 *   ?session=abc123              → solo mode (no firebase)
 *   ?session=abc123&mode=collab  → 양방향 동기화 (편집 + 실시간 반영)
 *   ?session=abc123&mode=share   → 읽기 전용 공유
 *
 * Same URL-param pattern as MatchMaker Pro.
 */

export type SessionMode = 'solo' | 'collab' | 'share';

export interface SessionParams {
  sessionId: string | null;
  mode: SessionMode;
}

export function getSessionParams(): SessionParams {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  const rawMode = params.get('mode');

  const mode: SessionMode =
    rawMode === 'share' ? 'share'
    : rawMode === 'collab' ? 'collab'
    : 'solo';

  return { sessionId, mode };
}

export function generateSessionId(): string {
  // 9 chars from random + 6 chars from timestamp = unique enough for classroom use
  return (
    Math.random().toString(36).substring(2, 11) +
    Date.now().toString(36).slice(-6)
  );
}

/**
 * Update the URL with session info without reloading.
 * Uses replaceState so the browser back button isn't polluted.
 */
export function setSessionUrl(sessionId: string, mode: 'collab' | 'share' = 'collab') {
  const url = new URL(window.location.href);
  url.searchParams.set('session', sessionId);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url.toString());
}

export function clearSessionUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('session');
  url.searchParams.delete('mode');
  window.history.replaceState({}, '', url.toString());
}

/**
 * Build a read-only share URL for the current session.
 */
export function buildShareUrl(sessionId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('session', sessionId);
  url.searchParams.set('mode', 'share');
  return url.toString();
}
