/**
 * Derived statistics + evaluation score calculations.
 *
 * Pure functions over PlayerStats / Game / PeerEval data.
 * No side effects, no React.
 */
import type { 
  PlayerStats, Game, GameSet, PlayerId, TeamId, 
  EvaluationCriteria, PeerEval, AppData, Player, RecordSheet 
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
  serveMetric: number;    // (ace*3 + ok*2) / total — 2026-2학기 계획서 기준
  spikeTotal: number;
  spikePct: number;       // success / total × 100
  setTotal: number;
  setEffective: number;   // (success + assist) / total × 100
}

/**
 * 공격 시도 수 = 득점 + 연결 + 상대블록 + 실책.
 * spikeInPlay(연결)는 나중에 추가된 항목이라 구버전 기록엔 없다 → 반드시 ?? 0.
 */
export function spikeAttempts(s: PlayerStats): number {
  return (s.spikeSuccess ?? 0) + (s.spikeInPlay ?? 0) + (s.spikeBlocked ?? 0) + (s.spikeError ?? 0);
}

export function deriveRates(s: PlayerStats): DerivedRates {
  const serveTotal = s.serveOk + s.serveAce + s.serveFail;
  const spikeTotal = spikeAttempts(s);
  const setTotal = s.setSuccess + s.setAssist + s.setError;

  return {
    serveTotal,
    servePct: serveTotal > 0 
      ? ((s.serveOk + s.serveAce) / serveTotal) * 100 
      : 0,
    // 평가계획서: 서브 득점 3점 · 서브 성공 2점 · 서브 실패 0점
    serveMetric: serveTotal > 0
      ? (s.serveAce * 3 + s.serveOk * 2) / serveTotal
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
export function lookupCriteriaScore(
  metric: number, 
  thresholds: { min: number; score: number }[]
): number {
  // 구버전 저장 데이터에는 없는 기준이 있어 undefined로 들어올 수 있다 → 방어.
  if (!Array.isArray(thresholds) || thresholds.length === 0) return 0;
  // Thresholds are typically sorted high-to-low; find first whose min ≤ metric
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (metric >= t.min) return t.score;
  }
  return sorted[sorted.length - 1]?.score ?? 0;
}

// ── League standings ───────────────────────────────────────────────────

/** 한 경기에서 특정 사이드가 이긴 세트 수. 평가계획서의 「승점」이 곧 이긴 세트 수다. */
export function setsWonBySide(g: Game, side: 'A' | 'B'): number {
  let n = 0;
  for (const st of g.sets ?? []) {
    if (st.scoreA === st.scoreB) continue;          // 동점 세트는 승점 없음
    const aWon = st.scoreA > st.scoreB;
    if ((side === 'A') === aWon) n++;
  }
  return n;
}

/**
 * 이 경기에서 선수가 어느 사이드로 뛰었는지.
 * 경기별 로스터(rosterA/rosterB)가 있으면 그것을 우선하고, 없으면 기본 소속팀으로 판정한다.
 * 뛰지 않았으면 null.
 */
export function sideOfPlayerInGame(g: Game, playerId: PlayerId, defaultTeamId?: TeamId): 'A' | 'B' | null {
  if (g.rosterA?.length || g.rosterB?.length) {
    if (g.rosterA?.includes(playerId)) return 'A';
    if (g.rosterB?.includes(playerId)) return 'B';
    return null;                                     // 로스터가 지정된 경기인데 명단에 없음 = 미출전
  }
  // 로스터 미지정 → 코트 기록으로 판정 (실제로 뛴 흔적)
  for (const st of g.sets ?? []) {
    if (st.courtA?.includes(playerId)) return 'A';
    if (st.courtB?.includes(playerId)) return 'B';
  }
  // 그래도 없으면 기본 소속팀
  if (defaultTeamId) {
    if (g.teamAId === defaultTeamId) return 'A';
    if (g.teamBId === defaultTeamId) return 'B';
  }
  return null;
}

/** Compute total win-points and games-played for a team across all games. */
export function teamLeagueStanding(
  games: Game[],
  teamId: TeamId
): { wins: number; losses: number; played: number; pointsAvg: number } {
  let wins = 0, losses = 0, played = 0, totalPts = 0;
  for (const g of games) {
    if (g.teamAId !== teamId && g.teamBId !== teamId) continue;
    if (!g.winnerTeamId) continue; // unfinished
    played++;
    if (g.winnerTeamId === teamId) wins++;
    else losses++;
    totalPts += setsWonBySide(g, g.teamAId === teamId ? 'A' : 'B');
  }
  // 평가계획서: 승점 = 이긴 세트 수 (3:0 → 3·0, 2:1 → 2·1)
  const pointsAvg = played > 0 ? totalPts / played : 0;
  return { wins, losses, played, pointsAvg };
}

/**
 * ★ 개인 기준 리그 성적.
 * 출결 때문에 다른 팀에서 뛴 경기까지 「그날 뛴 사이드」로 승점을 붙이고,
 * 본인이 실제로 뛴 경기 수로만 나눈다. (계획서: 승점 ÷ 경기수)
 */
export function playerLeagueStanding(
  games: Game[],
  playerId: PlayerId,
  defaultTeamId?: TeamId
): { wins: number; losses: number; played: number; pointsAvg: number; totalPts: number } {
  let wins = 0, losses = 0, played = 0, totalPts = 0;
  for (const g of games) {
    if (!g.winnerTeamId) continue;
    const side = sideOfPlayerInGame(g, playerId, defaultTeamId);
    if (!side) continue;                              // 안 뛴 경기는 아예 제외
    played++;
    const myTeamId = side === 'A' ? g.teamAId : g.teamBId;
    if (g.winnerTeamId === myTeamId) wins++; else losses++;
    totalPts += setsWonBySide(g, side);
  }
  return { wins, losses, played, totalPts, pointsAvg: played > 0 ? totalPts / played : 0 };
}

/** 경기 기록지 5항목 충족 개수 → 점수 (미제출은 0) */
export function recordSheetScore(
  sheet: RecordSheet | undefined,
  criteria: { min: number; score: number }[]
): number {
  if (!sheet || sheet.notSubmitted) return 0;
  const n = sheet.items.filter(Boolean).length;
  return lookupCriteriaScore(n, criteria);
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
  /** 개인 기록 40점 */
  serveMetric: number;
  serveScore: number;
  /** 경기 수행 30점 */
  leagueAvg: number;
  leagueScore: number;
  leaguePlayed: number;     // 본인이 실제로 뛴 경기 수
  leaguePts: number;        // 이긴 세트 수 합계
  /** 경기 분석 및 피드백 30점 */
  recordItems: number;      // 5항목 중 충족 개수
  recordScore: number;
  recordSubmitted: boolean;
  /** 합계 /100 */
  total: number;
  rawStats: PlayerStats;
  rates: DerivedRates;
}

/**
 * 2026학년도 2학기 「스포츠 경기 분석」 평가계획 기준 산출.
 *   경기 수행 30 (승점 평균) + 개인 기록 40 (서브 평균) + 경기 분석 30 (기록지) = 100
 */
export function calculatePlayerEvaluation(
  data: AppData,
  player: Player,
): PlayerEvaluation {
  const allStats = aggregatePlayerStatsAllGames(data.games, player.id);
  const rates = deriveRates(allStats);

  // ── 개인 기록 40점 : 서브 평균 = (득점×3 + 성공×2) / 서브 횟수
  const serveScore = lookupCriteriaScore(rates.serveMetric, data.criteria?.serve);

  // ── 경기 수행 30점 : 승점(이긴 세트 수) ÷ 본인이 뛴 경기 수
  const standing = playerLeagueStanding(data.games, player.id, player.teamId);
  const leagueScore = lookupCriteriaScore(standing.pointsAvg, data.criteria?.league);

  // ── 경기 분석 및 피드백 30점 : 기록지 5항목
  const sheet = data.recordSheets?.[player.id];
  const recordScore = recordSheetScore(sheet, data.criteria?.gameRecord);
  const recordItems = sheet && !sheet.notSubmitted ? sheet.items.filter(Boolean).length : 0;

  return {
    playerId: player.id,
    serveMetric: rates.serveMetric,
    serveScore,
    leagueAvg: standing.pointsAvg,
    leagueScore,
    leaguePlayed: standing.played,
    leaguePts: standing.totalPts,
    recordItems,
    recordScore,
    recordSubmitted: !!sheet && !sheet.notSubmitted,
    total: serveScore + leagueScore + recordScore,
    rawStats: allStats,
    rates,
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
