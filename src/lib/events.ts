/**
 * Event logic — round-robin schedule generation, standings calculation.
 *
 * Round-robin uses the "circle method":
 * with N teams, fix team 0 at top, rotate the rest. N-1 rounds, N/2 matches per round.
 * If N is odd, add a "BYE" team so each real team sits out once per round.
 */

import type { Event, Match, TeamId, Game, AppData } from '../types';

function generateId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a single round-robin (everyone plays everyone once).
 * Returns matches without round field set yet.
 */
function generateSingleRound(teamIds: TeamId[]): Array<{ teamAId: TeamId; teamBId: TeamId }> {
  const ids = [...teamIds];
  const n = ids.length;
  if (n < 2) return [];

  // For odd N, add a sentinel that means "bye" - filter out at the end
  const BYE = '__BYE__';
  const useBye = n % 2 === 1;
  if (useBye) ids.push(BYE);

  const totalTeams = ids.length;
  const numRoundsInternal = totalTeams - 1;
  const halfSize = totalTeams / 2;

  const allMatches: Array<{ teamAId: TeamId; teamBId: TeamId }> = [];

  // Circle method: rotate everyone except first slot
  // teams arranged in two rows; pair across
  let arr = [...ids];
  for (let r = 0; r < numRoundsInternal; r++) {
    for (let i = 0; i < halfSize; i++) {
      const a = arr[i];
      const b = arr[totalTeams - 1 - i];
      if (a !== BYE && b !== BYE) {
        allMatches.push({ teamAId: a, teamBId: b });
      }
    }
    // rotate: keep arr[0] fixed, rotate the rest clockwise
    arr = [arr[0], arr[totalTeams - 1], ...arr.slice(1, totalTeams - 1)];
  }

  return allMatches;
}

/**
 * Generate full round-robin schedule for N rounds.
 * Each round repeats the full single round-robin.
 */
export function generateRoundRobinSchedule(
  teamIds: TeamId[],
  rounds: number,
): Match[] {
  const matches: Match[] = [];
  const singleRound = generateSingleRound(teamIds);

  for (let r = 1; r <= rounds; r++) {
    for (const m of singleRound) {
      matches.push({
        id: generateId(),
        round: r,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        gameId: null,
      });
    }
  }

  return matches;
}

/**
 * When user adds rounds to an in-progress event, append new matches.
 */
export function addRoundsToEvent(event: Event, additionalRounds: number): Event {
  const newSingleRound = generateSingleRound(event.teamIds);
  const startRound = event.rounds + 1;
  const newMatches: Match[] = [];
  for (let r = 0; r < additionalRounds; r++) {
    for (const m of newSingleRound) {
      newMatches.push({
        id: generateId(),
        round: startRound + r,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        gameId: null,
      });
    }
  }
  return {
    ...event,
    rounds: event.rounds + additionalRounds,
    matches: [...event.matches, ...newMatches],
  };
}

/**
 * Match result derived from the Game (if any).
 * Returns null if game doesn't exist or hasn't started.
 */
export interface MatchResult {
  status: 'pending' | 'inProgress' | 'finished';
  setsA: number;       // sets won by team A
  setsB: number;
  pointsA: number;     // total points scored
  pointsB: number;
  winner: 'A' | 'B' | null;
}

export function getMatchResult(match: Match, games: Game[]): MatchResult {
  if (!match.gameId) {
    return { status: 'pending', setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, winner: null };
  }
  const game = games.find(g => g.id === match.gameId);
  if (!game) {
    return { status: 'pending', setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, winner: null };
  }
  let setsA = 0, setsB = 0, pointsA = 0, pointsB = 0;
  for (const s of game.sets) {
    pointsA += s.scoreA;
    pointsB += s.scoreB;
    if (s.scoreA > s.scoreB) setsA++;
    else if (s.scoreB > s.scoreA) setsB++;
  }
  const isFinished = !!game.endedAt;
  const winner = setsA > setsB ? 'A' : setsB > setsA ? 'B' : null;
  return {
    status: isFinished ? 'finished' : 'inProgress',
    setsA, setsB, pointsA, pointsB,
    winner: isFinished ? winner : null,
  };
}

/**
 * Compute standings for an event.
 * 승점: 승=3, 패=0 (무승부 없음 가정)
 * 동률 시: 세트 득실 → 직접 대결
 */
export interface StandingsRow {
  teamId: TeamId;
  played: number;        // 진행한 경기 수 (종료된 것만)
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  setDiff: number;
  pointsScored: number;
  pointsAgainst: number;
  points: number;        // 승점
}

export function computeStandings(event: Event, games: Game[]): StandingsRow[] {
  const rows: Map<TeamId, StandingsRow> = new Map();
  for (const tid of event.teamIds) {
    rows.set(tid, {
      teamId: tid,
      played: 0, wins: 0, losses: 0,
      setsWon: 0, setsLost: 0, setDiff: 0,
      pointsScored: 0, pointsAgainst: 0,
      points: 0,
    });
  }

  for (const match of event.matches) {
    const res = getMatchResult(match, games);
    if (res.status !== 'finished') continue;

    const rowA = rows.get(match.teamAId);
    const rowB = rows.get(match.teamBId);
    if (!rowA || !rowB) continue;

    rowA.played++;
    rowB.played++;
    rowA.setsWon += res.setsA;
    rowA.setsLost += res.setsB;
    rowB.setsWon += res.setsB;
    rowB.setsLost += res.setsA;
    rowA.pointsScored += res.pointsA;
    rowA.pointsAgainst += res.pointsB;
    rowB.pointsScored += res.pointsB;
    rowB.pointsAgainst += res.pointsA;
    if (res.winner === 'A') {
      rowA.wins++;
      rowA.points += 3;
      rowB.losses++;
    } else if (res.winner === 'B') {
      rowB.wins++;
      rowB.points += 3;
      rowA.losses++;
    }
  }

  // Update setDiff
  rows.forEach(r => { r.setDiff = r.setsWon - r.setsLost; });

  // Tiebreaker: points → setDiff → head-to-head (simplified: setsWon)
  const sorted = Array.from(rows.values()).sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.setDiff !== x.setDiff) return y.setDiff - x.setDiff;
    if (y.setsWon !== x.setsWon) return y.setsWon - x.setsWon;
    return (y.pointsScored - y.pointsAgainst) - (x.pointsScored - x.pointsAgainst);
  });

  return sorted;
}

/**
 * Progress summary for an event.
 */
export function eventProgress(event: Event, games: Game[]): {
  total: number;
  finished: number;
  inProgress: number;
  pending: number;
} {
  let finished = 0, inProgress = 0, pending = 0;
  for (const m of event.matches) {
    const r = getMatchResult(m, games);
    if (r.status === 'finished') finished++;
    else if (r.status === 'inProgress') inProgress++;
    else pending++;
  }
  return { total: event.matches.length, finished, inProgress, pending };
}
