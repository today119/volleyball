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
  /** 코트 편성에서 지정하는 포지션 라벨(예: 레프트/라이트/세터/리베로/센터백 등). position==='세터'면 isSetter와 동기화. */
  position?: string;
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
 *   spike total   = spikeSuccess + spikeInPlay + spikeBlocked + spikeError
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
  spikeInPlay?: number;  // 연결 — 상대가 받아내 랠리 지속(점수 변동 없음). 구버전 기록엔 없어 optional.

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
  spikeSuccess: 0, spikeBlocked: 0, spikeError: 0, spikeInPlay: 0,
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
  /** 이 세트에서 각 선수가 뛴 포지션 스냅샷(코트 편성 시 기록). 포지션별 수행도 집계용. */
  positions?: Record<PlayerId, string>;
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
  /** 자체리그(인트라스쿼드): 한 팀 roster를 양 사이드로 나눠 연습. teamAId===teamBId. */
  intrasquad?: boolean;
  /** 인트라스쿼드 출석 선수 풀(이 풀에서만 코트 편성). */
  attendees?: PlayerId[];
  /**
   * 이 경기에 한해 A/B 팀에 속한 선수 목록.
   * 출결 때문에 선수를 섞어 뛴 날을 위한 것으로, 지정하면 기본 소속팀(player.teamId)보다 우선한다.
   * 비어 있으면 기본 소속팀으로 판정한다.
   */
  rosterA?: PlayerId[];
  rosterB?: PlayerId[];
}

export interface PeerEval {
  evaluatorId: string;    // 학번
  evaluatorName?: string;
  level: 1 | 2 | 3 | 4;
  timestamp: number;
}

/**
 * 2026학년도 2학기 「스포츠 경기 분석」 평가계획 기준.
 *   경기 수행 30 + 개인 기록(서브) 40 + 경기 분석 및 피드백 30 = 100
 */
export interface EvaluationCriteria {
  /** 개인 기록 40점 — 서브 평균 = (득점×3 + 성공×2) / 서브 횟수 */
  serve: { min: number; score: number }[];
  /** 경기 수행 30점 — 승점 평균 = 이긴 세트 수 합계 / 본인이 뛴 경기 수 */
  league: { min: number; score: number }[];
  /** 경기 분석 및 피드백 30점 — 기록지 5항목 중 충족 개수 → 점수 */
  gameRecord: { min: number; score: number }[];
  /** (구버전 호환) 동료평가 — 2026-2학기 계획서에서 삭제됨 */
  performance?: { level: number; score: number }[];
}

/** 경기 기록지 5항목 충족 여부 — 학생별로 교사가 체크 */
export interface RecordSheet {
  /** 1. 기록 분석(강점·약점) 2. 포지션·역할 3. 다음 목표 전략 4. 인상 깊은 장면 5. 깨달은 점 */
  items: [boolean, boolean, boolean, boolean, boolean];
  /** 미제출이면 true — 충족 개수와 무관하게 0점 */
  notSubmitted?: boolean;
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
  /** 경기 분석 및 피드백(기록지) 체크 — playerId → 5항목 */
  recordSheets?: Record<PlayerId, RecordSheet>;
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
    { key: 'spikeInPlay',  label: '연결',     scoringTeam: 'none'  },
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

/**
 * 평가 기준 기본값 — 2026학년도 2학기 「스포츠 경기 분석」 평가계획 기준.
 * App/동기화 양쪽에서 써야 해서 여기(공용 타입 모듈)에 둔다.
 */
export const DEFAULT_CRITERIA: EvaluationCriteria = {
  // 개인 기록 40점 — 서브 평균 = (득점×3 + 성공×2) / 서브 횟수
  serve: [
    { min: 1.8, score: 40 }, { min: 1.4, score: 35 }, { min: 1.0, score: 30 },
    { min: 0.7, score: 25 }, { min: 0, score: 20 },
  ],
  // 경기 수행 30점 — 승점 평균 = 이긴 세트 수 / 본인이 뛴 경기 수
  league: [
    { min: 1.8, score: 30 }, { min: 1.4, score: 25 }, { min: 1.0, score: 20 },
    { min: 0.7, score: 15 }, { min: 0, score: 10 },
  ],
  // 경기 분석 및 피드백 30점 — 기록지 5항목 중 충족 개수
  gameRecord: [
    { min: 4, score: 30 }, { min: 3, score: 25 }, { min: 2, score: 20 },
    { min: 1, score: 15 }, { min: 0, score: 10 },
  ],
};

/**
 * 저장된 criteria에 빠진 항목을 기본값으로 채운다.
 * 구버전 데이터에는 gameRecord가 없어서, 이걸 거치지 않으면
 * lookupCriteriaScore(…, undefined)에서 앱이 죽는다.
 */
export function normalizeCriteria(c: any): EvaluationCriteria {
  const pick = (v: any, def: { min: number; score: number }[]) =>
    Array.isArray(v) && v.length ? v : def;
  const src = c && typeof c === 'object' ? c : {};
  return {
    serve: pick(src.serve, DEFAULT_CRITERIA.serve),
    league: pick(src.league, DEFAULT_CRITERIA.league),
    gameRecord: pick(src.gameRecord, DEFAULT_CRITERIA.gameRecord),
    ...(src.performance ? { performance: src.performance } : {}),
  };
}
