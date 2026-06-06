/**
 * useGameLogic — central game state hook.
 *
 * 두 가지 쓰기 경로:
 *   - 솔로(cloudWrite=false): 기존대로 setData로 로컬 세트를 통째 갱신.
 *   - collab(cloudWrite=true): RTDB에 "경로 단위 update + ServerValue.increment
 *     + scoreEvents push"로만 씀. 로컬 setData는 하지 않고, 스냅샷 리스너가
 *     서버값을 되돌려 반영(서버가 진실) → A·B 기록자 동시 기록 시 분실 없음.
 */
import { useCallback, useRef } from 'react';
import type {
  AppData, Game, GameSet, PlayerStats, PlayerId,
  ActionCategory,
} from '../types';
import { EMPTY_STATS, ACTION_OUTCOMES } from '../types';
import firebase, { database } from './firebase';
import { computeScoringOps, type Op } from './cloudOps';

interface UseGameLogicArgs {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  currentGame: Game | null;
  currentSetIdx: number;
  /** collab 세션 id (RTDB 경로). */
  sessionId?: string | null;
  /** true면 RTDB 경로단위 쓰기, false면 로컬 setData. */
  cloudWrite?: boolean;
}

export function useGameLogic({
  data, setData, currentGame, currentSetIdx, sessionId, cloudWrite,
}: UseGameLogicArgs) {

  const useCloud = !!cloudWrite && !!sessionId;
  // 자기(이 클라이언트)가 올린 득점 액션 스택 — undo 자기액션 한정용.
  const ownActions = useRef<Array<{ gameId: string; setIdx: number; scoreField: 'scoreA' | 'scoreB' | null; eventKey: string | null }>>([]);

  const setPath = (gid: string, i: number) => `spikelog/${sessionId}/games/${gid}/sets/${i}`;

  /** Op[]를 RTDB에 멀티패스 update로 적용. push는 key 생성 후 같은 update에 포함. */
  const applyOpsToRtdb = (gid: string, i: number, ops: Op[]): string | null => {
    const base = database.ref(setPath(gid, i));
    const updates: Record<string, any> = {};
    let lastKey: string | null = null;
    for (const op of ops) {
      if (op.kind === 'inc') {
        updates[op.path] = firebase.database.ServerValue.increment(op.by);
      } else if (op.kind === 'set') {
        updates[op.path] = op.value;
      } else if (op.kind === 'push') {
        const k = base.child(op.path).push().key as string;
        updates[`${op.path}/${k}`] = op.value;
        lastKey = k;
      }
    }
    base.update(updates);
    return lastKey;
  };

  const updateCurrentSet = useCallback((
    mutate: (set: GameSet, game: Game) => GameSet
  ) => {
    if (!currentGame) return;
    setData(prev => ({
      ...prev,
      games: prev.games.map(g => {
        if (g.id !== currentGame.id) return g;
        const sets = g.sets.map((s, i) => i === currentSetIdx ? mutate(s, g) : s);
        return { ...g, sets };
      }),
    }));
  }, [currentGame, currentSetIdx, setData]);

  const getStats = (set: GameSet, playerId: PlayerId): PlayerStats =>
    set.playerStats?.[playerId] ?? { ...EMPTY_STATS };

  const teamOf = useCallback((playerId: PlayerId): 'A' | 'B' | null => {
    if (!currentGame) return null;
    const teamA = data.teams.find(t => t.id === currentGame.teamAId);
    const teamB = data.teams.find(t => t.id === currentGame.teamBId);
    if (teamA?.players.some(p => p.id === playerId)) return 'A';
    if (teamB?.players.some(p => p.id === playerId)) return 'B';
    return null;
  }, [currentGame, data.teams]);

  const recordAction = useCallback((
    playerId: PlayerId,
    category: ActionCategory,
    outcomeKey: keyof PlayerStats,
    assistingSetterId?: PlayerId,
  ) => {
    const team = teamOf(playerId);
    if (!team) return;
    const outcome = ACTION_OUTCOMES[category].find(o => o.key === outcomeKey);
    if (!outcome) return;

    // ── collab: 경로단위 update + increment + push ──────────────────────
    if (useCloud && currentGame) {
      const set = currentGame.sets[currentSetIdx];
      if (!set) return;
      const ops = computeScoringOps(set, {
        playerId, team, outcomeKey,
        scoringTeam: outcome.scoringTeam,
        assistingSetterId,
      });
      const lastKey = applyOpsToRtdb(currentGame.id, currentSetIdx, ops);
      const scoreInc = ops.find(o => o.kind === 'inc' && (o.path === 'scoreA' || o.path === 'scoreB')) as Op | undefined;
      const scoreField = scoreInc && scoreInc.kind === 'inc' ? (scoreInc.path as 'scoreA' | 'scoreB') : null;
      ownActions.current.push({ gameId: currentGame.id, setIdx: currentSetIdx, scoreField, eventKey: lastKey });
      return;
    }

    // ── 솔로: 기존 로컬 갱신 ────────────────────────────────────────────
    updateCurrentSet((set) => {
      const newStats = { ...(set.playerStats ?? {}) };
      const playerStats = getStats(set, playerId);
      newStats[playerId] = { ...playerStats, [outcomeKey]: (playerStats[outcomeKey] ?? 0) + 1 };
      if (outcomeKey === 'spikeSuccess' && assistingSetterId) {
        const setterStats = getStats(set, assistingSetterId);
        newStats[assistingSetterId] = { ...setterStats, setAssist: setterStats.setAssist + 1 };
      }
      let scoreA = set.scoreA, scoreB = set.scoreB;
      let servingTeam = set.servingTeam, serverIdxA = set.serverIdxA, serverIdxB = set.serverIdxB;
      let scoringTeam: 'A' | 'B' | null = null;
      if (outcome.scoringTeam === 'self') scoringTeam = team;
      else if (outcome.scoringTeam === 'other') scoringTeam = team === 'A' ? 'B' : 'A';
      if (scoringTeam === 'A') scoreA += 1;
      if (scoringTeam === 'B') scoreB += 1;
      if (scoringTeam && scoringTeam !== servingTeam) {
        const losingTeam = servingTeam;
        servingTeam = scoringTeam;
        if (losingTeam === 'A') serverIdxA = (serverIdxA + 1) % Math.max(set.courtA.length, 1);
        else serverIdxB = (serverIdxB + 1) % Math.max(set.courtB.length, 1);
      }
      const scoreEvents = scoringTeam
        ? [...(set.scoreEvents ?? []), { timestamp: Date.now(), team: scoringTeam, playerId: outcome.scoringTeam === 'self' ? playerId : undefined, scoreA, scoreB }]
        : set.scoreEvents;
      return { ...set, playerStats: newStats, scoreA, scoreB, servingTeam, serverIdxA, serverIdxB, scoreEvents };
    });
  }, [teamOf, updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  const undoLastScore = useCallback(() => {
    // ── collab: 자기(이 클라이언트)가 올린 마지막 득점만 되돌림 ──────────
    if (useCloud && currentGame) {
      for (let k = ownActions.current.length - 1; k >= 0; k--) {
        const a = ownActions.current[k];
        if (a.gameId === currentGame.id && a.setIdx === currentSetIdx) {
          ownActions.current.splice(k, 1);
          const base = database.ref(setPath(a.gameId, a.setIdx));
          const updates: Record<string, any> = {};
          if (a.scoreField) updates[a.scoreField] = firebase.database.ServerValue.increment(-1);
          if (a.eventKey) updates[`scoreEvents/${a.eventKey}`] = null; // 제거
          if (Object.keys(updates).length) base.update(updates);
          return;
        }
      }
      return; // 내가 올린 게 없으면 아무것도 안 함
    }

    // ── 솔로: 기존 동작 ────────────────────────────────────────────────
    updateCurrentSet((set) => {
      const evts = set.scoreEvents ?? [];
      if (evts.length === 0) return set;
      const prevScore = evts[evts.length - 2];
      return {
        ...set,
        scoreA: prevScore?.scoreA ?? 0,
        scoreB: prevScore?.scoreB ?? 0,
        scoreEvents: evts.slice(0, -1),
      };
    });
  }, [updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  const adjustStat = useCallback((playerId: PlayerId, key: keyof PlayerStats, delta: number) => {
    if (useCloud && currentGame) {
      const set = currentGame.sets[currentSetIdx];
      const cur = set?.playerStats?.[playerId];
      const path = `${setPath(currentGame.id, currentSetIdx)}/playerStats/${playerId}`;
      if (cur) {
        const next = Math.max(0, (cur[key] ?? 0) + delta);
        database.ref(`${path}/${key}`).set(next); // 클램프 포함하므로 절대값 set
      } else if (delta > 0) {
        database.ref(path).set({ ...EMPTY_STATS, [key]: delta });
      }
      return;
    }
    updateCurrentSet((set) => {
      const stats = getStats(set, playerId);
      return { ...set, playerStats: { ...set.playerStats, [playerId]: { ...stats, [key]: Math.max(0, (stats[key] ?? 0) + delta) } } };
    });
  }, [updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  const setServingTeam = useCallback((team: 'A' | 'B') => {
    if (useCloud && currentGame) { database.ref(`${setPath(currentGame.id, currentSetIdx)}/servingTeam`).set(team); return; }
    updateCurrentSet((set) => ({ ...set, servingTeam: team }));
  }, [updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  const substitute = useCallback((team: 'A' | 'B', outPlayerId: PlayerId, inPlayerId: PlayerId) => {
    if (useCloud && currentGame) {
      const set = currentGame.sets[currentSetIdx];
      const courtKey = team === 'A' ? 'courtA' : 'courtB';
      const court = (set?.[courtKey] ?? []) as string[];
      const idx = court.indexOf(outPlayerId);
      if (idx === -1) return;
      const newCourt = [...court]; newCourt[idx] = inPlayerId;
      database.ref(`${setPath(currentGame.id, currentSetIdx)}/${courtKey}`).set(newCourt);
      return;
    }
    updateCurrentSet((set) => {
      const courtKey = team === 'A' ? 'courtA' : 'courtB';
      const court = set[courtKey];
      const idx = court.indexOf(outPlayerId);
      if (idx === -1) return set;
      const newCourt = [...court]; newCourt[idx] = inPlayerId;
      return { ...set, [courtKey]: newCourt };
    });
  }, [updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  const rotateServer = useCallback((team: 'A' | 'B', dir: 1 | -1 = 1) => {
    if (useCloud && currentGame) {
      const set = currentGame.sets[currentSetIdx];
      if (!set) return;
      const court = team === 'A' ? (set.courtA ?? []) : (set.courtB ?? []);
      const len = Math.max(court.length, 1);
      const cur = team === 'A' ? (set.serverIdxA ?? 0) : (set.serverIdxB ?? 0);
      const nv = ((cur + dir) % len + len) % len;
      database.ref(`${setPath(currentGame.id, currentSetIdx)}/serverIdx${team}`).set(nv);
      return;
    }
    updateCurrentSet((set) => {
      if (team === 'A') {
        const len = Math.max(set.courtA.length, 1);
        return { ...set, serverIdxA: ((set.serverIdxA + dir) % len + len) % len };
      }
      const len = Math.max(set.courtB.length, 1);
      return { ...set, serverIdxB: ((set.serverIdxB + dir) % len + len) % len };
    });
  }, [updateCurrentSet, useCloud, currentGame, currentSetIdx]);

  return { recordAction, undoLastScore, adjustStat, setServingTeam, rotateServer, substitute, teamOf };
}
