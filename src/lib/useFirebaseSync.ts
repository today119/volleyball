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
 * RTDB는 배열을 0,1,2… 키 객체로 저장하고, 경로단위 update(예: games/<id>/…)가
 * 섞이면 배열이 "키 객체"로 변질된다. 그때 Array.isArray로 버리면 경기가 통째로
 * 사라져(흰 화면/데이터 소실처럼 보임) → 객체도 Object.values로 배열 복원한다.
 */
function toArr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

/**
 * Normalize remote data to handle missing/legacy fields.
 * Firebase may strip empty arrays or have data from older schema.
 */
function normalizeData(raw: any): AppData {
  raw = raw || {};
  return {
    teams: toArr(raw.teams).map((t: any) => ({
      id: t.id ?? `team_${Math.random()}`,
      name: t.name ?? '팀',
      players: toArr(t.players),
    })),
    // games/sets가 객체로 변질돼도 배열로 복원 — 경기 소실 방지.
    games: toArr(raw.games).map((g: any) => ({
      ...g,
      sets: toArr(g.sets).map((s: any) => ({
        ...s,
        playerStats: s.playerStats ?? {},
        scoreEvents: toArr(s.scoreEvents),
        courtA: toArr(s.courtA),
        courtB: toArr(s.courtB),
      })),
    })),
    events: toArr(raw.events).map((e: any) => ({
      ...e,
      teamIds: toArr(e.teamIds),
      matches: toArr(e.matches),
    })),
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

/** games 노드의 게임 수 (배열/keyed-object 모두). */
function countGames(o: any): number {
  if (!o || !o.games) return 0;
  return Array.isArray(o.games) ? o.games.length : Object.keys(o.games).length;
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
  // 클라우드(원격)의 현재 게임 수 — 스냅샷마다 갱신. write 전 "줄어들면 차단" 가드에 사용.
  const lastRemoteGamesRef = useRef(0);
  // 이 세션에서 관찰된 게임 수 최고치(로컬/원격) — 빈 게임으로의 파괴적 전체저장 차단용.
  const everSeenGamesRef = useRef(0);
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
      // 원격 게임 수를 항상 최신으로 기록(채택 여부와 무관) — write 가드용.
      lastRemoteGamesRef.current = countGames(remoteData);
      if (lastRemoteGamesRef.current > everSeenGamesRef.current) everSeenGamesRef.current = lastRemoteGamesRef.current;

      if (!hasInitialized.current) {
        // First snapshot — "콘텐츠 풍부함" 기준 머지 (타임스탬프 단독 신뢰 금지).
        //
        // 과거 버그: 로컬 ts는 persistence effect가 마운트마다 Date.now()로 갱신해
        // 항상 "최신"이 됐다. 그래서 게임이 비어 있는(혹은 더 적은) 로컬이 ts가 최신이라는
        // 이유로 원격을 거부하고, write effect가 그 빈 로컬을 클라우드에 덮어써서
        // 전체 경기 데이터가 통째로 날아갔다.
        //
        // 새 규칙: 게임 수(레코드 풍부함)를 우선 비교한다.
        //  - 원격이 더 많으면 → 원격 채택 (빈/적은 로컬이 클라우드를 절대 못 덮음).
        //  - 로컬이 더 많으면 → 로컬 유지 → write effect가 클라우드 복구.
        //  - 동수면 → ts 최신 우선.
        const remoteGames = countGames(remoteData);
        let localGames = 0;
        try { localGames = countGames(JSON.parse(localStorage.getItem('spike_log_v1') || '{}')); } catch { /* ignore */ }
        const remoteTs = (remoteData && remoteData.lastUpdate) || 0;
        const localTs = Number(localStorage.getItem('spike_log_v1_ts') || 0);
        const adoptRemote =
          !!remoteData &&
          (remoteGames > localGames || (remoteGames === localGames && remoteTs >= localTs));
        if (adoptRemote) {
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

    // ★ 게임 소실 방지 가드: 로컬 게임 수가 클라우드보다 적으면 전체 쓰기를 막는다.
    // (빈/적은 로컬이 whole-tree set 으로 클라우드 games 를 통째로 덮어써 전부 날아가던 사고 차단.)
    // 게임 추가/통계 기록은 게임 수가 유지·증가하므로 통과. 게임 삭제만 막힘(안전 우선).
    const localGames = countGames(data);
    if (localGames > everSeenGamesRef.current) everSeenGamesRef.current = localGames;
    if (localGames < lastRemoteGamesRef.current) {
      console.warn(`[firebase-sync] write BLOCKED — local games(${localGames}) < cloud games(${lastRemoteGamesRef.current}); 클라우드 보호.`);
      return;
    }
    // 파괴 차단: 이전에 게임이 있었는데 지금 0개로 전체저장하려 하면 무조건 막는다.
    // (배열↔객체 변질로 게임이 일시적으로 []로 읽혀도 클라우드를 비우지 않게.)
    if (localGames === 0 && everSeenGamesRef.current > 0) {
      console.warn(`[firebase-sync] write BLOCKED — empty games would wipe ${everSeenGamesRef.current} known game(s); 클라우드 보호.`);
      return;
    }

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
