/**
 * cloudOps — 한 기록 액션을 "경로 단위 연산(Op)"으로 표현.
 *
 * 같은 Op 목록을:
 *   - 솔로/테스트: applyOpsToSet 으로 로컬 세트에 적용
 *   - collab: applyOpsToRtdb 으로 RTDB에 ServerValue.increment / push / set
 * 으로 적용 → A팀·B팀 기록자가 서로 다른 경로(선수별 스탯)와
 * 원자적 증가(점수)로만 쓰므로 동시 기록 시 덮어쓰기/분실이 없다.
 */
import type { GameSet, PlayerStats } from '../types';
import { EMPTY_STATS } from '../types';

export type Op =
  | { kind: 'inc'; path: string; by: number }
  | { kind: 'set'; path: string; value: any }
  | { kind: 'push'; path: string; value: any };

export interface ScoringParams {
  playerId: string;
  team: 'A' | 'B';
  outcomeKey: keyof PlayerStats;
  /** 'self' = 우리팀 득점, 'other' = 상대 득점, 'none' = 비득점 */
  scoringTeam: 'self' | 'other' | 'none';
  assistingSetterId?: string;
}

/** set 상대 경로 기준 Op 목록. (서버 회전: 잃은 팀의 다음 서버를 +1) */
export function computeScoringOps(set: GameSet, p: ScoringParams): Op[] {
  const ops: Op[] = [];
  const ps = (set.playerStats || {}) as Record<string, PlayerStats>;

  // 1) 액션 선수 스탯: 최초 등장이면 전체 EMPTY_STATS로 init(+1), 아니면 원자 증가
  if (ps[p.playerId]) {
    ops.push({ kind: 'inc', path: `playerStats/${p.playerId}/${p.outcomeKey}`, by: 1 });
  } else {
    ops.push({ kind: 'set', path: `playerStats/${p.playerId}`, value: { ...EMPTY_STATS, [p.outcomeKey]: 1 } });
  }

  // 2) 어시스트 세터
  if (p.outcomeKey === 'spikeSuccess' && p.assistingSetterId) {
    const sid = p.assistingSetterId;
    if (ps[sid]) ops.push({ kind: 'inc', path: `playerStats/${sid}/setAssist`, by: 1 });
    else ops.push({ kind: 'set', path: `playerStats/${sid}`, value: { ...EMPTY_STATS, setAssist: 1 } });
  }

  // 3) 득점 팀 결정
  const scoreTeam: 'A' | 'B' | null =
    p.scoringTeam === 'self' ? p.team :
    p.scoringTeam === 'other' ? (p.team === 'A' ? 'B' : 'A') :
    null;

  if (scoreTeam === 'A') ops.push({ kind: 'inc', path: 'scoreA', by: 1 });
  if (scoreTeam === 'B') ops.push({ kind: 'inc', path: 'scoreB', by: 1 });

  // 4) 사이드아웃: 서브권 넘김 + 잃은 팀 서버 인덱스 +1 (LWW)
  if (scoreTeam && scoreTeam !== set.servingTeam) {
    const losing = set.servingTeam;
    ops.push({ kind: 'set', path: 'servingTeam', value: scoreTeam });
    if (losing === 'A') {
      const len = Math.max((set.courtA || []).length, 1);
      ops.push({ kind: 'set', path: 'serverIdxA', value: ((set.serverIdxA || 0) + 1) % len });
    } else {
      const len = Math.max((set.courtB || []).length, 1);
      ops.push({ kind: 'set', path: 'serverIdxB', value: ((set.serverIdxB || 0) + 1) % len });
    }
  }

  // 5) scoreEvents push (타워 그래프용 — 점수 스냅샷은 불필요)
  if (scoreTeam) {
    ops.push({
      kind: 'push',
      path: 'scoreEvents',
      value: { timestamp: Date.now(), team: scoreTeam, playerId: p.scoringTeam === 'self' ? p.playerId : null },
    });
  }
  return ops;
}

// ── 경로 헬퍼 ──────────────────────────────────────────────────────────
function getDeep(obj: any, path: string): any {
  return path.split('/').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setDeep(obj: any, path: string, value: any): void {
  const keys = path.split('/');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
let pushSeq = 0;
function genKey(): string {
  // 단조 증가 + 랜덤 — 정렬 가능, 충돌 없음 (테스트/솔로용)
  pushSeq = (pushSeq + 1) % 1e6;
  return 'e' + Date.now().toString(36) + String(pushSeq).padStart(4, '0') + Math.random().toString(36).slice(2, 5);
}

/** Op들을 세트 사본에 적용 (솔로/테스트). 반환: 새 set + 마지막 push 키. */
export function applyOpsToSet(set: GameSet, ops: Op[]): { set: GameSet; lastPushKey: string | null } {
  const s: any = JSON.parse(JSON.stringify(set));
  if (!s.playerStats) s.playerStats = {};
  let lastPushKey: string | null = null;
  for (const op of ops) {
    if (op.kind === 'inc') {
      setDeep(s, op.path, (Number(getDeep(s, op.path)) || 0) + op.by);
    } else if (op.kind === 'set') {
      setDeep(s, op.path, op.value);
    } else if (op.kind === 'push') {
      let cur = getDeep(s, op.path);
      if (Array.isArray(cur)) {
        const o: any = {}; cur.forEach((v, i) => { o['a' + String(i).padStart(4, '0')] = v; }); cur = o;
      }
      if (cur == null || typeof cur !== 'object') cur = {};
      const key = genKey();
      cur[key] = op.value;
      setDeep(s, op.path, cur);
      lastPushKey = key;
    }
  }
  return { set: s as GameSet, lastPushKey };
}

/** scoreEvents를 배열/객체 둘 다 지원 → timestamp 정렬된 배열로. */
export function readScoreEvents(se: any): Array<{ timestamp: number; team: 'A' | 'B'; playerId?: string | null }> {
  if (!se) return [];
  const list = Array.isArray(se) ? se : Object.values(se);
  return (list as any[]).filter(Boolean).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}
