/**
 * useGameLogic — central game state hook.
 *
 * Responsibilities:
 *   - Apply an action: increments stat slot + updates team score + appends scoreEvent
 *   - Auto-link setter assist when an attack succeeds (if a setter was tagged)
 *   - Server rotation when sideout happens
 *   - Undo last scoring event (rewinds score + removes the matching stat)
 *
 * Race-condition note (slot model):
 *   Two recorders writing different keys of `playerStats[playerId]` is safe
 *   under Firebase RTDB if we use update() with deep paths. But the App
 *   currently passes whole AppData through useFirebaseSync. That's fine for
 *   classroom use (clicks rarely collide within 300ms), but if collisions
 *   become a real problem we'll move to per-field updates.
 */
import { useCallback } from 'react';
import type { 
  AppData, Game, GameSet, PlayerStats, PlayerId, TeamId,
  ActionCategory 
} from '../types';
import { EMPTY_STATS, ACTION_OUTCOMES } from '../types';

interface UseGameLogicArgs {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  currentGame: Game | null;
  currentSetIdx: number;
}

export function useGameLogic({ 
  data, setData, currentGame, currentSetIdx 
}: UseGameLogicArgs) {

  /** Mutate a specific game's set by index, then save back into AppData. */
  const updateCurrentSet = useCallback((
    mutate: (set: GameSet, game: Game) => GameSet
  ) => {
    if (!currentGame) return;
    setData(prev => ({
      ...prev,
      games: prev.games.map(g => {
        if (g.id !== currentGame.id) return g;
        const sets = g.sets.map((s, i) => 
          i === currentSetIdx ? mutate(s, g) : s
        );
        return { ...g, sets };
      }),
    }));
  }, [currentGame, currentSetIdx, setData]);

  /** Get/create empty stats for a player. */
  const getStats = (set: GameSet, playerId: PlayerId): PlayerStats =>
    set.playerStats?.[playerId] ?? { ...EMPTY_STATS };

  /** Which team is a given player on? Returns 'A' | 'B' | null. */
  const teamOf = useCallback((playerId: PlayerId): 'A' | 'B' | null => {
    if (!currentGame) return null;
    const teamA = data.teams.find(t => t.id === currentGame.teamAId);
    const teamB = data.teams.find(t => t.id === currentGame.teamBId);
    if (teamA?.players.some(p => p.id === playerId)) return 'A';
    if (teamB?.players.some(p => p.id === playerId)) return 'B';
    return null;
  }, [currentGame, data.teams]);

  /**
   * Main action recorder.
   * tap-player → tap-result UX: caller passes the chosen outcome.
   *
   * @param playerId who performed the action
   * @param category which action group (serve/attack/defense/setter/block/error)
   * @param outcomeKey specific outcome (e.g., 'spikeSuccess', 'serveFail')
   * @param assistingSetterId optional — if an attack scored, which setter assisted
   */
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

    updateCurrentSet((set) => {
      const newStats = { ...(set.playerStats ?? {}) };
      
      // 1. Increment the player's outcome counter
      const playerStats = getStats(set, playerId);
      newStats[playerId] = {
        ...playerStats,
        [outcomeKey]: (playerStats[outcomeKey] ?? 0) + 1,
      };

      // 2. If attack scored AND a setter is tagged, increment setter's assist
      if (outcomeKey === 'spikeSuccess' && assistingSetterId) {
        const setterStats = getStats(set, assistingSetterId);
        newStats[assistingSetterId] = {
          ...setterStats,
          setAssist: setterStats.setAssist + 1,
        };
      }

      // 3. Compute new score
      let scoreA = set.scoreA;
      let scoreB = set.scoreB;
      let servingTeam = set.servingTeam;
      let serverIdxA = set.serverIdxA;
      let serverIdxB = set.serverIdxB;

      let scoringTeam: 'A' | 'B' | null = null;
      if (outcome.scoringTeam === 'self') {
        scoringTeam = team;
      } else if (outcome.scoringTeam === 'other') {
        scoringTeam = team === 'A' ? 'B' : 'A';
      }

      if (scoringTeam === 'A') scoreA += 1;
      if (scoringTeam === 'B') scoreB += 1;

      // 4. Side-out: if the scoring team WASN'T the serving team, serve passes.
      //    Volleyball rule: the team that just GAINED serve serves with its
      //    current rotation position (its first server stays index 0). The team
      //    that LOST serve advances its own rotation, so that next time it earns
      //    serve back the next player serves. (Previously this incorrectly
      //    rotated the team that gained serve, skipping its #1 server.)
      if (scoringTeam && scoringTeam !== servingTeam) {
        const losingTeam = servingTeam; // the team that just lost the serve
        servingTeam = scoringTeam;
        if (losingTeam === 'A') {
          serverIdxA = (serverIdxA + 1) % Math.max(set.courtA.length, 1);
        } else {
          serverIdxB = (serverIdxB + 1) % Math.max(set.courtB.length, 1);
        }
      }

      // 5. Score event for cumulative graph (only on scoring events)
      const scoreEvents = scoringTeam
        ? [
            ...(set.scoreEvents ?? []),
            {
              timestamp: Date.now(),
              team: scoringTeam,
              playerId: outcome.scoringTeam === 'self' ? playerId : undefined,
              scoreA, scoreB,
            }
          ]
        : set.scoreEvents;

      return { 
        ...set, 
        playerStats: newStats, 
        scoreA, scoreB, 
        servingTeam, serverIdxA, serverIdxB,
        scoreEvents,
      };
    });
  }, [teamOf, updateCurrentSet]);

  /** 
   * Undo the most recent action. 
   * We don't keep a global action log (per the slot-based model), so undo 
   * only rewinds the last *scoring* event. Non-scoring stats (receive/dig/
   * serveOk/setSuccess) can't be undone via this — use the −1 button on 
   * the player card instead.
   */
  const undoLastScore = useCallback(() => {
    updateCurrentSet((set) => {
      const evts = set.scoreEvents ?? [];
      if (evts.length === 0) return set;

      const prevScore = evts[evts.length - 2];
      const newScoreA = prevScore?.scoreA ?? 0;
      const newScoreB = prevScore?.scoreB ?? 0;

      // Note: we can't perfectly reverse which stat was incremented without
      // storing the action details in scoreEvents. For now, undo only rewinds
      // score+events. Stat correction needs the −1 button.
      return {
        ...set,
        scoreA: newScoreA,
        scoreB: newScoreB,
        scoreEvents: evts.slice(0, -1),
      };
    });
  }, [updateCurrentSet]);

  /** 
   * Manual stat adjustment — for fixing recorder mistakes after the fact. 
   * Does NOT change the team score (use only for non-scoring stats, 
   * or after undoLastScore).
   */
  const adjustStat = useCallback((
    playerId: PlayerId,
    key: keyof PlayerStats,
    delta: number,
  ) => {
    updateCurrentSet((set) => {
      const stats = getStats(set, playerId);
      return {
        ...set,
        playerStats: {
          ...set.playerStats,
          [playerId]: {
            ...stats,
            [key]: Math.max(0, (stats[key] ?? 0) + delta),
          },
        },
      };
    });
  }, [updateCurrentSet]);

  /** Switch serving team manually (e.g., recorder corrects a misread). */
  const setServingTeam = useCallback((team: 'A' | 'B') => {
    updateCurrentSet((set) => ({ ...set, servingTeam: team }));
  }, [updateCurrentSet]);

  /** 
   * Substitute a court player with a bench player.
   * Preserves the rotation position (the bench player takes the court player's slot).
   */
  const substitute = useCallback((
    team: 'A' | 'B',
    outPlayerId: PlayerId,
    inPlayerId: PlayerId,
  ) => {
    updateCurrentSet((set) => {
      const courtKey = team === 'A' ? 'courtA' : 'courtB';
      const court = set[courtKey];
      const idx = court.indexOf(outPlayerId);
      if (idx === -1) return set;
      const newCourt = [...court];
      newCourt[idx] = inPlayerId;
      return { ...set, [courtKey]: newCourt };
    });
  }, [updateCurrentSet]);

  /** Manually rotate a team's server. dir=1 forward, dir=-1 backward */
  const rotateServer = useCallback((team: 'A' | 'B', dir: 1 | -1 = 1) => {
    updateCurrentSet((set) => {
      if (team === 'A') {
        const len = Math.max(set.courtA.length, 1);
        return { 
          ...set, 
          serverIdxA: ((set.serverIdxA + dir) % len + len) % len 
        };
      }
      const len = Math.max(set.courtB.length, 1);
      return { 
        ...set, 
        serverIdxB: ((set.serverIdxB + dir) % len + len) % len 
      };
    });
  }, [updateCurrentSet]);

  return {
    recordAction,
    undoLastScore,
    adjustStat,
    setServingTeam,
    rotateServer,
    substitute,
    teamOf,
  };
}
