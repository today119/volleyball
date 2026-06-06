/**
 * Firebase Realtime Database sync hook.
 *
 * Implements the same race-condition protection as MatchMaker Pro:
 *   - `isRemoteUpdate` flag prevents the write effect from echoing
 *     remote-originated state changes back to the server.
 *   - `hasInitialized` flag prevents the local snapshot from
 *     overwriting existing remote data on first connection.
 *   - 300ms debounce keeps rapid rally recording from spamming RTDB.
 *
 * For volleyball recording specifically: every rally fires a state
 * update. Without debouncing + the remote-update guard, two devices
 * recording the same court would clobber each other.
 */
import { useEffect, useRef } from 'react';
import { database } from './firebase';
import type { AppData } from '../types';

interface UseFirebaseSyncOptions {
  sessionId: string | null;
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  readOnly: boolean;
  enabled: boolean;
}

export interface SyncStatus {
  connected: boolean;
  lastSync: number | null;
  error: string | null;
}

/**
 * Normalize remote data to handle missing/legacy fields.
 * Firebase may strip empty arrays or have data from older schema.
 */
function normalizeData(raw: any): AppData {
  return {
    teams: Array.isArray(raw.teams)
      ? raw.teams.map((t: any) => ({
          id: t.id ?? `team_${Math.random()}`,
          name: t.name ?? '팀',
          players: Array.isArray(t.players) ? t.players : [],
        }))
      : [],
    games: Array.isArray(raw.games)
      ? raw.games.map((g: any) => ({
          ...g,
          // 세트 필수 필드 보강 — collab(원격) 데이터에 playerStats·scoreEvents가
          // 없으면 통계 집계 시 화면이 죽거나 멈추던 문제 방지(로컬 로드와 동일 처리).
          sets: Array.isArray(g.sets)
            ? g.sets.map((s: any) => ({
                ...s,
                playerStats: s.playerStats ?? {},
                scoreEvents: Array.isArray(s.scoreEvents) ? s.scoreEvents : [],
                courtA: Array.isArray(s.courtA) ? s.courtA : [],
                courtB: Array.isArray(s.courtB) ? s.courtB : [],
              }))
            : [],
        }))
      : [],
    events: Array.isArray(raw.events)
      ? raw.events.map((e: any) => ({
          ...e,
          teamIds: Array.isArray(e.teamIds) ? e.teamIds : [],
          matches: Array.isArray(e.matches) ? e.matches : [],
        }))
      : [],
    criteria: raw.criteria ?? {},
    gasUrl: raw.gasUrl ?? '',
    peerEvals: raw.peerEvals ?? {},
  };
}

/** 현재 페이지의 스크롤 가능한 요소 위치 저장/복원 */
function saveScrollPositions(): Map<Element, number> {
  const map = new Map<Element, number>();
  document.querySelectorAll('*').forEach(el => {
    if ((el as HTMLElement).scrollTop > 0) map.set(el, (el as HTMLElement).scrollTop);
  });
  return map;
}

function restoreScrollPositions(saved: Map<Element, number>) {
  requestAnimationFrame(() => {
    saved.forEach((top, el) => {
      if (document.contains(el)) (el as HTMLElement).scrollTop = top;
    });
  });
}

export function useFirebaseSync({
  sessionId,
  data,
  setData,
  readOnly,
  enabled,
}: UseFirebaseSyncOptions) {
  const isRemoteUpdate = useRef(false);
  const hasInitialized = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Subscribe to remote updates ─────────────────────────────────────
  useEffect(() => {
    if (!enabled || !sessionId) return;

    hasInitialized.current = false;
    const ref = database.ref(`spikelog/${sessionId}`);

    const handler = ref.on('value', (snapshot) => {
      const remoteData = snapshot.val();

      if (!hasInitialized.current) {
        // First snapshot for this session — lastUpdate 최신 우선 머지.
        const remoteTs = (remoteData && remoteData.lastUpdate) || 0;
        const localTs = Number(localStorage.getItem('spike_log_v1_ts') || 0);
        if (remoteData && remoteTs >= localTs) {
          // 원격이 더 최신(또는 동급) → 원격으로 교체
          const { lastUpdate, ...cleanData } = remoteData;
          const scrollPos = saveScrollPositions();
          isRemoteUpdate.current = true;
          setData(normalizeData(cleanData));
          queueMicrotask(() => {
            isRemoteUpdate.current = false;
          });
          restoreScrollPositions(scrollPos);
        }
        // 원격이 비었거나 로컬이 더 최신이면 → 아래 write effect가 로컬을 push
        hasInitialized.current = true;
        return;
      }

      if (!remoteData) return;

      // Subsequent remote update (from another device)
      const { lastUpdate, ...cleanData } = remoteData;
      const scrollPos = saveScrollPositions();
      isRemoteUpdate.current = true;
      setData(normalizeData(cleanData));
      queueMicrotask(() => {
        isRemoteUpdate.current = false;
      });
      restoreScrollPositions(scrollPos);
    });

    return () => {
      ref.off('value', handler);
      hasInitialized.current = false;
    };
  }, [sessionId, enabled, setData]);

  // ── Write local changes to remote (debounced) ───────────────────────
  useEffect(() => {
    if (!enabled || !sessionId || readOnly) return;
    if (!hasInitialized.current) return; // wait for initial pull
    if (isRemoteUpdate.current) return;  // don't echo remote updates back

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      const ref = database.ref(`spikelog/${sessionId}`);
      ref
        .set({ ...data, lastUpdate: Date.now() })
        .catch((err) => {
          console.error('[firebase-sync] write failed:', err);
        });
    }, 800);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [data, sessionId, enabled, readOnly]);
}
