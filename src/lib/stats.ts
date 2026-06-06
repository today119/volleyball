/**
 * Derived statistics + evaluation score calculations.
 *
 * Pure functions over PlayerStats / Game / PeerEval data.
 * No side effects, no React.
 */
import type { 
  PlayerStats, Game, GameSet, PlayerId, TeamId, 
  EvaluationCriteria, PeerEval, AppData, Player 
} from '../types';
import { EMPTY_STATS } from '../types';

/** Sum stats across all sets of a game for one player. */
export function aggregatePlayerStatsInGame(
  game: Game, 
  playerId: PlayerId
): PlayerStats {
  const totals = { ...EMPTY_STATS };
  for (const set of game.sets) {
    const s = set.playerStats?.[playerId];
    if (!s) continue;
    (Object.keys(totals) as Array<keyof PlayerStats>).forEach(k => {
      totals[k] += s[k] ?? 0;
    });
  }
  return totals;
}

/** Sum stats across ALL games for one player. */
export function aggregatePlayerStatsAllGames(
  games: Game[], 
  playerId: PlayerId
): PlayerStats {
  const totals = { ...EMPTY_STATS };
  for (const g of games) {
    const gameTotals = aggregatePlayerStatsInGame(g, playerId);
    (Object.keys(totals) as Array<keyof PlayerStats>).forEach(k => {
      totals[k] += gameTotals[k];
    });
  }
  return totals;
}

// ── Derived rates ──────────────────────────────────────────────────────

export interface DerivedRates {
  serveTotal: number;
  servePct: number;       // (ace + ok) / total × 100
  serveMetric: number;    // (ace*2 + ok*1) / total — for criteria
  spikeTotal: number;
  spikePct: number;       // success / total × 100
  setTotal: number;
  setEffective: number;   // (success + assist) / total × 100
}

export function deriveRates(s: PlayerStats): DerivedRates {
  const serveTotal = s.serveOk + s.serveAce + s.serveFail;
  const spikeTotal = s.spikeSuccess + s.spikeBlocked + s.spikeError;
  const setTotal = s.setSuccess + s.setAssist + s.setError;

  return {
    serveTotal,
    servePct: serveTotal > 0 
      ? ((s.serveOk + s.serveAce) / serveTotal) * 100 
      : 0,
    serveMetric: serveTotal > 0 
      ? (s.serveAce * 2 + s.serveOk) / serveTotal 
      : 0,
    spikeTotal,
    spikePct: spikeTotal > 0 
      ? (s.spikeSuccess / spikeTotal) * 100 
      : 0,
    setTotal,
    setEffective: setTotal > 0 
      ? ((s.setSuccess + s.setAssist) / setTotal) * 100 
      : 0,
  };
}

// ── Threshold lookup ───────────────────────────────────────────────────

/** Find the score that matches a metric value against criteria thresholds. */
function lookupCriteriaScore(
  metric: number, 
  thresholds: { min: number; score: number }[]
): number {
  // Thresholds are typically sorted high-to-low; find first whose min ≤ metric
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (metric >= t.min) return t.score;
  }
  return sorted[sorted.length - 1]?.score ?? 0;
}

// ── League standings ───────────────────────────────────────────────────

/** Compute total win-points and games-played for a team across all games. */
export function teamLeagueStanding(
  games: Game[], 
  teamId: TeamId
): { wins: number; losses: number; played: number; pointsAvg: number } {
  let wins = 0, losses = 0, played = 0;
  for (const g of games) {
    if (g.teamAId !== teamId && g.teamBId !== teamId) continue;
    if (!g.winnerTeamId) continue; // unfinished
    played++;
    if (g.winnerTeamId === teamId) wins++;
    else losses++;
  }
  const totalPts = wins * 3; // 패=0
  const pointsAvg = played > 0 ? totalPts / played : 0;
  return { wins, losses, played, pointsAvg };
}

// ── Peer eval ──────────────────────────────────────────────────────────

export function avgPeerLevel(evals: PeerEval[] = []): number {
  if (evals.length === 0) return 0;
  const sum = evals.reduce((acc, e) => acc + e.level, 0);
  return sum / evals.length;
}

// ── Per-player final evaluation score ──────────────────────────────────

export interface PlayerEvaluation {
  playerId: PlayerId;
  serveMetric: number;
  serveScore: number;       // 11-20
  leagueAvg: number;
  leagueScore: number;      // 11-20
  perfLevel: number;
  perfScore: number;        // 22-40
  gameRecordScore: number;  // fixed (e.g. 20)
  total: number;            // /100
  // Raw stats for transparency
  rawStats: PlayerStats;
  rates: DerivedRates;
  peerEvalCount: number;
}

export function calculatePlayerEvaluation(
  data: AppData,
  player: Player,
): PlayerEvaluation {
  const allStats = aggregatePlayerStatsAllGames(data.games, player.id);
  const rates = deriveRates(allStats);

  // Serve
  const serveScore = lookupCriteriaScore(rates.serveMetric, data.criteria.serve);

  // League — based on the player's TEAM standing across all games
  const standing = teamLeagueStanding(data.games, player.teamId);
  const leagueScore = lookupCriteriaScore(standing.pointsAvg, data.criteria.league);

  // Performance — peer eval avg → mapped to criteria.performance
  const peerEvals = data.peerEvals[player.id] ?? [];
  const perfLevel = avgPeerLevel(peerEvals);
  // criteria.performance has shape [{ level, score }]; pick closest level ≤ avg
  const perfSorted = [...data.criteria.performance].sort((a, b) => b.level - a.level);
  let perfScore = 0;
  for (const c of perfSorted) {
    if (perfLevel >= c.level) { perfScore = c.score; break; }
  }
  if (perfScore === 0 && perfSorted.length > 0) {
    perfScore = perfSorted[perfSorted.length - 1].score;
  }

  // Game record — fixed if player participated in any game
  const participated = data.games.some(g =>
    g.sets.some(s => s.playerStats?.[player.id])
  );
  const gameRecordScore = participated ? data.criteria.gameRecord : 0;

  const total = serveScore + leagueScore + perfScore + gameRecordScore;

  return {
    playerId: player.id,
    serveMetric: rates.serveMetric,
    serveScore,
    leagueAvg: standing.pointsAvg,
    leagueScore,
    perfLevel,
    perfScore,
    gameRecordScore,
    total,
    rawStats: allStats,
    rates,
    peerEvalCount: peerEvals.length,
  };
}

/** Calculate evaluations for all players grouped by org (학년반). */
export function calculateAllEvaluations(
  data: AppData
): Record<string, Array<{ player: Player; evaluation: PlayerEvaluation }>> {
  const grouped: Record<string, Array<{ player: Player; evaluation: PlayerEvaluation }>> = {};
  
  for (const team of data.teams) {
    for (const player of team.players) {
      const evaluation = calculatePlayerEvaluation(data, player);
      const org = player.org ?? '미지정';
      if (!grouped[org]) grouped[org] = [];
      grouped[org].push({ player, evaluation });
    }
  }
  
  // Sort each group by player number
  for (const org of Object.keys(grouped)) {
    grouped[org].sort((a, b) => 
      a.player.number.localeCompare(b.player.number, undefined, { numeric: true })
    );
  }
  
  return grouped;
}
