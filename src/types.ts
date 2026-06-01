export type TeamId = string;
export type PlayerId = string;
export type GameId = string;
export type SetId = number;

export interface Player {
  id: PlayerId;
  name: string;
  number: string;
  org?: string;       // 학년반 (예: "2-3")
  teamId: TeamId;
  /** 세터 포지션이면 true (세터 카드만 따로 표시) */
  isSetter?: boolean;
}

export interface Team {
  id: TeamId;
  name: string;
  players: Player[];
}

/**
 * Per-player stat slots within a set.
 *
 * UX pattern: every action follows tap-player → tap-result.
 * That means every category has an "attempt" implied by the
 * sum of its outcomes; we don't store attempts separately.
 *
 *   serve total   = serveOk + serveAce + serveFail
 *   spike total   = spikeSuccess + spikeBlocked + spikeError
 *   set total     = setSuccess + setAssist + setError
 *
 * Score-affecting actions (which increment team score):
 *   - serveAce, spikeSuccess, block, setAssist  → our team +1
 *   - serveFail, spikeError, error, setError    → other team +1
 *   - spikeBlocked = our spike was blocked       → other team +1
 *
 * Non-scoring actions (stats only):
 *   - serveOk, spike (when not directly killing), receive, dig, set, setSuccess
 *
 * Note on naming:
 *   - "spikeSuccess" = spike that scored a point
 *   - "spikeBlocked" = our spike was blocked by opponent
 *   - "spikeError" = our spike out / into net (self-error)
 *   - "setSuccess" = toss received and attacked cleanly (no points)
 *   - "setAssist" = toss that directly led to a spike kill
 *   - "setError" = toss out of bounds / unattackable
 */
export interface PlayerStats {
  // Serve (3 outcomes after tap)
  serveOk: number;       // landed in, opponent received (no point)
  serveAce: number;      // direct point — our team +1
  serveFail: number;     // fault — other team +1

  // Attack (3 outcomes after tap)
  spikeSuccess: number;  // killed — our team +1
  spikeBlocked: number;  // opponent blocked — other team +1
  spikeError: number;    // out/net — other team +1

  // Block (success only — failed blocks aren't recorded)
  block: number;         // our team +1

  // Defense (stats only, no scoring)
  receive: number;       // serve receive
  dig: number;           // dug a hard-driven ball

  // Setter (3 outcomes after tap)
  setSuccess: number;    // toss received and attacked
  setAssist: number;     // toss → kill (auto-counted via attack flow)
  setError: number;      // bad toss → other team +1

  // Generic error (anything that doesn't fit above)
  error: number;         // other team +1
}

export const EMPTY_STATS: PlayerStats = {
  serveOk: 0, serveAce: 0, serveFail: 0,
  spikeSuccess: 0, spikeBlocked: 0, spikeError: 0,
  block: 0,
  receive: 0, dig: 0,
  setSuccess: 0, setAssist: 0, setError: 0,
  error: 0,
};

/** 
 * Roles for collaborative input. Each role only sees its own action buttons.
 * Both teams are always visible — recorders track the full court. 
 */
export type EvaluatorRole = 
  | 'teacher'    // full access (all buttons + setup + dashboard)
  | 'serve'      // serve actions
  | 'attack'     // spike + block
  | 'defense'    // receive + dig
  | 'setter'     // setter actions (toss/assist/error)
  | 'error'      // generic error button
  | 'peer';      // peer evaluation only

export interface GameSet {
  number: number;
  scoreA: number;
  scoreB: number;
  courtA: PlayerId[];     // rotation order on court (6 players)
  courtB: PlayerId[];
  serverIdxA: number;
  serverIdxB: number;
  servingTeam: 'A' | 'B';
  /** Per-player stat counters, keyed by playerId. */
  playerStats: Record<PlayerId, PlayerStats>;
  /** 
   * Scoring timeline for the cumulative graph.
   * Each entry = a scoring event in chronological order.
   */
  scoreEvents: Array<{
    timestamp: number;
    team: 'A' | 'B';
    playerId?: PlayerId;   // who scored (if attributable)
    scoreA: number;        // snapshot after this event
    scoreB: number;
  }>;
}

export interface Game {
  id: GameId;
  date: string;
  teamAId: TeamId;
  teamBId: TeamId;
  mode: 'single' | 'league' | 'tournament';
  format: string;
  courtN: number;
  setTarget: number;
  deuceGap: number;
  deadPoint: number;
  /** Max sets to play. 1 = single set, 3 = best-of-3 (2 wins), 5 = best-of-5 (3 wins). */
  maxSets?: number;
  sets: GameSet[];
  winnerTeamId?: TeamId | null;
  endedAt?: string;  // ISO timestamp when teacher pressed "저장 후 종료"
  leagueId?: string;
  matchId?: string;
}

export interface PeerEval {
  evaluatorId: string;    // 학번
  evaluatorName?: string;
  level: 1 | 2 | 3 | 4;
  timestamp: number;
}

export interface EvaluationCriteria {
  /** Serve metric: (ace*2 + ok*1) / total_serves */
  serve: { min: number; score: number }[];
  /** League metric: total_win_points / games_played (win=3, lose=0) */
  league: { min: number; score: number }[];
  /** Performance: peer-eval averaged level → score */
  performance: { level: number; score: number }[];
  /** Game record (participation) fixed bonus */
  gameRecord: number;
}

/**
 * Match within an Event — pairing of two teams.
 * One match can map to one Game (when it's actually played).
 */
export interface Match {
  id: string;
  round: number;           // 1, 2, ... (라운드 번호)
  teamAId: TeamId;
  teamBId: TeamId;
  gameId?: GameId | null;  // null = 미진행, set = 진행/완료
}

/**
 * Event — 대회. 풀리그(roundrobin)로 시작, 추후 토너먼트 추가 예정.
 */
export interface Event {
  id: string;
  name: string;
  type: 'roundrobin';
  teamIds: TeamId[];
  rounds: number;          // 진행하기로 한 총 라운드 수
  matches: Match[];        // 자동 생성된 모든 경기
  createdAt: string;
  endedAt?: string | null; // 사용자가 명시적으로 종료한 시점
}

export interface AppData {
  teams: Team[];
  games: Game[];
  events: Event[];
  criteria: EvaluationCriteria;
  gasUrl: string;
  /** Peer evaluations keyed by playerId → list of entries. */
  peerEvals: Record<PlayerId, PeerEval[]>;
}

/** Active connected device (for showing "X명 접속중" badge). */
export interface ActiveSession {
  deviceId: string;
  role: EvaluatorRole;
  name?: string;
  lastPing: number;
}

/**
 * Action types — used for the modal flow.
 * tap player → modal shows the outcome buttons for that category
 */
export type ActionCategory = 'serve' | 'attack' | 'defense' | 'setter' | 'block' | 'error';

export const ACTION_OUTCOMES: Record<ActionCategory, Array<{
  key: keyof PlayerStats;
  label: string;
  scoringTeam: 'self' | 'other' | 'none';
}>> = {
  serve: [
    { key: 'serveOk',   label: '성공',    scoringTeam: 'none'  },
    { key: 'serveAce',  label: '에이스',  scoringTeam: 'self'  },
    { key: 'serveFail', label: '실패',    scoringTeam: 'other' },
  ],
  attack: [
    { key: 'spikeSuccess', label: '득점',     scoringTeam: 'self'  },
    { key: 'spikeBlocked', label: '상대블록', scoringTeam: 'other' },
    { key: 'spikeError',   label: '실책',     scoringTeam: 'other' },
  ],
  defense: [
    { key: 'receive', label: '리시브', scoringTeam: 'none' },
    { key: 'dig',     label: '디그',   scoringTeam: 'none' },
  ],
  setter: [
    { key: 'setSuccess', label: '성공',  scoringTeam: 'none'  },
    { key: 'setAssist',  label: '득점',  scoringTeam: 'self'  },
    { key: 'setError',   label: '실책',  scoringTeam: 'other' },
  ],
  block: [
    { key: 'block', label: '블로킹 성공', scoringTeam: 'self' },
  ],
  error: [
    { key: 'error', label: '실책', scoringTeam: 'other' },
  ],
};
