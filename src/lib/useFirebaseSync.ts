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

/** 스크롤 컨테이너만 저장/복원 (전체 DOM `*` 스캔 제거 — 매 동기화 리플로우·플리커 방지) */
function saveScrollPositions(): Map<Element, number> {
  const map = new Map<Element, number>();
  document.querySelectorAll('.overflow-y-auto, .overflow-auto, [data-scrollable]').forEach(el => {
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
  const hasInitialized = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 마지막으로 반영/송신한 데이터의 정규화 JSON.
  // 원격 스냅샷·로컬 쓰기 양쪽에서 이 값과 비교해, 내용이 같으면 setData/write를 건너뛴다.
  // → 자기 쓰기가 echo로 돌아와도 무시 → "스냅샷→setData→write→echo→setData…" 피드백 루프 차단
  //   → 모달 떠 있는 동안 800ms 주기 리렌더(=플리커) 제거.
  const lastJsonRef = useRef<string>('');

  // ── Subscribe to remote updates ─────────────────────────────────────
  useEffect(() => {
    if (!enabled || !sessionId) return;

    hasInitialized.current = false;
    const ref = database.ref(`spikelog/${sessionId}`);

    /** 내용이 바뀐 경우에만 setData. 동일 스냅샷(자기 echo 포함)은 무시. */
    const applyIfChanged = (cleanData: any) => {
      const normalized = normalizeData(cleanData);
      const json = JSON.stringify(normalized);
      if (json === lastJsonRef.current) return; // 변화 없음 → 리렌더 안 함
      lastJsonRef.current = json;
      const scrollPos = saveScrollPositions();
      setData(normalized);
      restoreScrollPositions(scrollPos);
    };

    const handler = ref.on('value', (snapshot) => {
      const remoteData = snapshot.val();

      if (!hasInitialized.current) {
        // First snapshot for this session — lastUpdate 최신 우선 머지.
        const remoteTs = (remoteData && remoteData.lastUpdate) || 0;
        const localTs = Number(localStorage.getItem('spike_log_v1_ts') || 0);
        if (remoteData && remoteTs >= localTs) {
          const { lastUpdate, ...cleanData } = remoteData;
          applyIfChanged(cleanData);
        }
        hasInitialized.current = true;
        return;
      }

      if (!remoteData) return;

      // Subsequent remote update (from another device or our own echo)
      const { lastUpdate, ...cleanData } = remoteData;
      applyIfChanged(cleanData);
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

    // 내용이 직전 동기화 상태와 동일하면(=원격에서 막 반영된 데이터) 쓰지 않는다 → echo 루프 차단.
    const json = JSON.stringify(normalizeData(data));
    if (json === lastJsonRef.current) return;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      lastJsonRef.current = json; // echo로 되돌아올 동일 데이터를 미리 무시 등록
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
