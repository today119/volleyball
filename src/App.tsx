/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Volleyball,
  LogIn,
  LogOut,
  UserRound,
  Users, 
  Settings, 
  Plus, 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Save, 
  Trash2, 
  UserPlus, 
  Play, 
  CheckCircle2, 
  History,
  Share2,
  Wifi,
  WifiOff,
  Eye,
  Copy,
  BarChart3
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { 
  AppData, 
  Team, 
  Game, 
  Player, 
  GameSet, 
  PlayerStats,
  EvaluationCriteria,
  ActionCategory,
  EvaluatorRole,
  ACTION_OUTCOMES,
} from './types';
import { useFirebaseSync } from './lib/useFirebaseSync';
import { useGameLogic } from './lib/useGameLogic';
import { readScoreEvents } from './lib/cloudOps';
import { useAuth, signInWithGoogle, signOut } from './lib/auth';
import {
  deriveRates,
  aggregatePlayerStatsInGame,
  aggregatePlayerStatsAllGames,
} from './lib/stats';
import {
  gasCreateRosterTemplate,
  gasLoadRoster,
  gasSaveRoster,
  gasSaveGame,
  gasExportEvaluations,
  gasInit,
} from './lib/gas';
import {
  generateRoundRobinSchedule,
  addRoundsToEvent,
  getMatchResult,
  computeStandings,
  eventProgress,
} from './lib/events';
import type { Event as VBEvent, Match } from './types';
import { 
  getSessionParams, 
  generateSessionId, 
  setSessionUrl, 
  clearSessionUrl, 
  buildShareUrl,
  SessionMode 
} from './lib/session';

// --- Constants & Defaults ---
const STORAGE_KEY = 'spike_log_v1';

const DEFAULT_CRITERIA: EvaluationCriteria = {
  serve: [
    { min: 2.0, score: 20 },
    { min: 1.5, score: 17 },
    { min: 1.0, score: 14 },
    { min: 0, score: 11 },
  ],
  league: [
    { min: 1.75, score: 20 },
    { min: 1.25, score: 17 },
    { min: 0.75, score: 14 },
    { min: 0, score: 11 },
  ],
  performance: [
    { level: 4, score: 40 },
    { level: 3, score: 34 },
    { level: 2, score: 28 },
    { level: 1, score: 22 },
  ],
  gameRecord: 20,
};

const INITIAL_DATA: AppData = {
  teams: [
    { id: 'team-1', name: '팀 1', players: [] },
    { id: 'team-2', name: '팀 2', players: [] },
  ],
  games: [],
  events: [],
  criteria: DEFAULT_CRITERIA,
  gasUrl: '',
  peerEvals: {},
};

// --- Helper Functions ---
const generateId = () => Math.random().toString(36).substring(2, 11);

const createNewSet = (number: number): GameSet => ({
  number,
  scoreA: 0,
  scoreB: 0,
  courtA: [],
  courtB: [],
  serverIdxA: 0,
  serverIdxB: 0,
  servingTeam: 'A',
  playerStats: {},
  scoreEvents: [],
});

// --- Components ---

const Card = ({ children, className, title, onClick }: { children: React.ReactNode, className?: string, title?: string, onClick?: () => void, key?: React.Key }) => (
  <div 
    className={cn("bg-white border border-slate-200 rounded-xl lg:rounded-2xl p-5 lg:p-4 overflow-hidden shadow-sm", className)}
    onClick={onClick}
  >
    {title && <h3 className="text-base lg:text-sm font-bold text-slate-600 uppercase tracking-wider mb-3">{title}</h3>}
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  size = 'md', 
  className, 
  disabled,
  icon: Icon
}: { 
  children?: React.ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'warning', 
  size?: 'sm' | 'md' | 'lg', 
  className?: string,
  disabled?: boolean,
  icon?: any
}) => {
  const variants = {
    primary: "bg-orange-600 text-white hover:bg-orange-500 active:scale-95",
    secondary: "bg-slate-800 text-slate-200 hover:bg-slate-700 active:scale-95",
    outline: "border-2 border-orange-600 text-orange-600 hover:bg-orange-600/10 active:scale-95",
    ghost: "text-slate-400 hover:text-white hover:bg-slate-800 active:scale-95",
    danger: "bg-red-600 text-white hover:bg-red-500 active:scale-95",
    success: "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95",
    warning: "bg-amber-500 text-white hover:bg-amber-400 active:scale-95",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-4 text-base font-bold",
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none font-medium",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 18} />}
      {children}
    </button>
  );
};

const Input = ({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="space-y-1.5 w-full">
    {label && <label className="text-sm font-semibold text-slate-600 ml-1">{label}</label>}
    <input 
      {...props}
      className={cn(
        "w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-orange-600/50 transition-all",
        props.className
      )}
    />
  </div>
);

const SessionBadge = ({ 
  session, 
  onShare 
}: { 
  session: { sessionId: string | null; mode: SessionMode }; 
  onShare: () => void;
}) => {
  // 모바일은 아이콘만(라벨 텍스트 hidden lg:inline), 데스크톱은 라벨 포함
  if (session.mode === 'solo') {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-slate-900 border border-slate-800" title="오프라인">
        <WifiOff size={12} className="text-slate-600" />
        <span className="hidden lg:inline text-[9px] font-bold text-slate-600 uppercase tracking-wider">Offline</span>
      </div>
    );
  }
  if (session.mode === 'share') {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-blue-600/10 border border-blue-600/30" title="읽기 전용">
        <Eye size={12} className="text-blue-500" />
        <span className="hidden lg:inline text-[9px] font-bold text-blue-500 uppercase tracking-wider">읽기전용</span>
      </div>
    );
  }
  // collab
  return (
    <button
      onClick={onShare}
      className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-emerald-600/10 border border-emerald-600/30 hover:bg-emerald-600/20 transition-colors"
      title="협업중 — 공유 링크 복사"
    >
      <Wifi size={12} className="text-emerald-500 animate-pulse" />
      <span className="hidden lg:inline text-[9px] font-bold text-emerald-500 uppercase tracking-wider">협업중</span>
      <Share2 size={11} className="text-emerald-500" />
    </button>
  );
};

// ── Role badge for student modes ─────────────────────────────────────
const ROLE_LABELS: Record<EvaluatorRole, { label: string; color: string }> = {
  teacher: { label: '교사',     color: 'bg-orange-600/10 border-orange-600/30 text-orange-500' },
  serve:   { label: '서브',     color: 'bg-blue-600/10 border-blue-600/30 text-blue-500' },
  attack:  { label: '공격',     color: 'bg-red-600/10 border-red-600/30 text-red-500' },
  defense: { label: '수비',     color: 'bg-teal-600/10 border-teal-600/30 text-teal-500' },
  setter:  { label: '세터',     color: 'bg-purple-600/10 border-purple-600/30 text-purple-500' },
  error:   { label: '실책',     color: 'bg-pink-600/10 border-pink-600/30 text-pink-500' },
  peer:    { label: '동료평가', color: 'bg-amber-600/10 border-amber-600/30 text-amber-500' },
};

const RoleBadge = ({ role }: { role: EvaluatorRole }) => {
  const info = ROLE_LABELS[role];
  return (
    <div className={cn(
      "flex items-center gap-1 px-2 py-1 rounded-md border",
      info.color
    )}>
      <span className="text-[9px] font-bold uppercase tracking-wider">{info.label}</span>
    </div>
  );
};

// ── Cumulative score tower (1-10 / 11-20 / 21-30) ────────────────────
const ScoreTower = ({ 
  scoreEvents, 
  teamA, 
  teamB 
}: { 
  scoreEvents: GameSet['scoreEvents']; 
  teamA?: Team; 
  teamB?: Team;
}) => {
  // For each point 1..30, find which team scored it and which player
  const points: Array<{ team?: 'A' | 'B'; playerNumber?: string }> = Array(30).fill(null).map(() => ({}));
  
  let countA = 0, countB = 0;
  for (const ev of scoreEvents) {
    if (ev.team === 'A') {
      countA++;
      if (countA <= 30) {
        const allPlayers = [...(teamA?.players ?? []), ...(teamB?.players ?? [])];
        const num = allPlayers.find(p => p.id === ev.playerId)?.number;
        points[countA - 1] = { team: 'A', playerNumber: num };
      }
    } else {
      countB++;
      if (countB <= 30) {
        // We use single sequence per team; render two towers
      }
    }
  }
  
  // Build separate tower for B
  const pointsB: Array<{ playerNumber?: string }> = [];
  let cb = 0;
  for (const ev of scoreEvents) {
    if (ev.team === 'B') {
      cb++;
      if (cb <= 30) {
        const allPlayers = [...(teamA?.players ?? []), ...(teamB?.players ?? [])];
        const num = allPlayers.find(p => p.id === ev.playerId)?.number;
        pointsB.push({ playerNumber: num });
      }
    }
  }

  const renderTower = (
    team: 'A' | 'B', 
    scoredPoints: Array<{ playerNumber?: string }>, 
    color: string,
  ) => (
    <div className="flex-1 space-y-1">
      {[0, 10, 20].map(base => (
        <div key={base} className="grid grid-cols-10 gap-0.5">
          {Array.from({ length: 10 }, (_, i) => {
            const pt = scoredPoints[base + i];
            return (
              <div
                key={i}
                className={cn(
                  "h-5 rounded-sm flex items-center justify-center text-[8px] font-bold font-mono",
                  pt ? `${color} text-white` : "bg-slate-800/50 text-slate-700"
                )}
              >
                {pt?.playerNumber ?? (base + i + 1)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  // Use just the scoring sequence (not points[])
  const aPoints: Array<{ playerNumber?: string }> = [];
  for (const ev of scoreEvents) {
    if (ev.team === 'A') {
      const allPlayers = [...(teamA?.players ?? []), ...(teamB?.players ?? [])];
      const num = allPlayers.find(p => p.id === ev.playerId)?.number;
      aPoints.push({ playerNumber: num });
    }
  }

  return (
    <div className="mt-3 flex gap-2">
      {renderTower('A', aPoints, 'bg-orange-600')}
      <div className="w-px bg-slate-800" />
      {renderTower('B', pointsB, 'bg-blue-600')}
    </div>
  );
};

// ── 가로형 스코어보드 (이미지 2, 3 테니스 스타일) ────────────────────
const ScoreboardCard = ({
  game,
  currentSet,
  teamA,
  teamB,
  setNav,
}: {
  game: Game;
  currentSet: GameSet;
  teamA?: Team;
  teamB?: Team;
  /** SET 박스 좌우 화살표(이전 세트 / 세트 종료·다음 세트). 데스크톱에서만 표시. */
  setNav?: { onPrev?: () => void; canPrev?: boolean; onNext?: () => void; nextShort?: string; nextTitle?: string };
}) => {
  const maxSets = game.maxSets ?? 1;
  const setTarget = game.setTarget ?? 25;
  const completedSets = game.sets.slice(0, currentSet.number - 1);
  const setWinsA = completedSets.filter(s => s.scoreA > s.scoreB).length;
  const setWinsB = completedSets.filter(s => s.scoreB > s.scoreA).length;

  // 세트 점등 도트 (세로 배치)
  const renderDots = (team: 'A' | 'B') => {
    const wins = team === 'A' ? setWinsA : setWinsB;
    return (
      <div className="flex flex-col gap-1.5 items-center">
        {Array.from({ length: maxSets }, (_, i) => (
          <div
            key={i}
            className={cn(
              "w-2.5 h-2.5 rounded-full border transition-all",
              i < wins
                ? team === 'A'
                  ? "bg-orange-500 border-orange-400 shadow-md shadow-orange-500/70"
                  : "bg-blue-500 border-blue-400 shadow-md shadow-blue-500/70"
                : "bg-slate-700 border-slate-600"
            )}
          />
        ))}
      </div>
    );
  };

  void renderDots; // (구 다크 스코어보드용 — 라이트 3카드로 교체됨)
  const servingA = currentSet.servingTeam === 'A';
  const servingB = currentSet.servingTeam === 'B';

  // 세트 점(딴 세트 수) — 라벨 옆 세로 스택. 모바일·데스크톱 공통(스케치: HOME옆 점들)
  const setDots = (team: 'A' | 'B') => {
    if (maxSets <= 1) return null;
    const wins = team === 'A' ? setWinsA : setWinsB;
    const onCls = team === 'A' ? 'bg-orange-500' : 'bg-blue-500';
    const offCls = team === 'A' ? 'bg-orange-100 border border-orange-200' : 'bg-blue-100 border border-blue-200';
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-0.5 lg:px-1 shrink-0" title={`세트 ${wins} / ${maxSets}`}>
        {Array.from({ length: maxSets }, (_, i) => (
          <div key={'d' + team + i} className={cn('w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full', i < wins ? onCls : offCls)} />
        ))}
      </div>
    );
  };

  return (
    // 박스 안: [HOME 세로라벨][세트점][(데스크톱)팀명][큰 점수]. AWAY는 좌우 대칭.
    <div className="flex items-stretch gap-1.5 lg:gap-4">
      {/* HOME 팀 카드 */}
      <div className="flex-1 flex items-stretch bg-white rounded-xl lg:rounded-2xl border-2 border-orange-200 shadow-sm overflow-hidden min-w-0">
        <div className={cn('w-1 lg:w-1.5 self-stretch', servingA ? 'bg-orange-400' : 'bg-orange-100')} />
        {/* HOME 세로 라벨 */}
        <div className="flex items-center justify-center px-1 lg:px-1.5 shrink-0">
          <span className="text-[9px] lg:text-[10px] font-black text-orange-400 tracking-[0.2em] [writing-mode:vertical-rl] rotate-180">HOME</span>
        </div>
        {/* 세트 점 — 라벨 옆 */}
        {setDots('A')}
        {/* 팀명 — 데스크톱만 (모바일은 아래 토글에 팀명 있음) */}
        <div className="hidden lg:flex lg:flex-1 lg:items-center pl-2 pr-3 py-3 min-w-0">
          <span className="text-3xl sm:text-4xl font-black text-slate-900 truncate leading-tight">{teamA?.name}</span>
        </div>
        {/* 큰 점수 */}
        <div className={cn('flex-1 lg:flex-none flex items-center justify-center lg:justify-end py-2.5 lg:py-0 px-1 lg:pr-5 text-4xl lg:text-6xl font-black font-mono tabular-nums leading-none', servingA ? 'text-orange-500' : 'text-slate-800')}>
          {currentSet.scoreA}
        </div>
      </div>

      {/* SET 카드 (가운데) — 모바일은 좁게, 데스크톱은 타워 컬럼 폭 */}
      <div className="relative flex flex-col items-center justify-center self-stretch bg-slate-50 rounded-xl lg:rounded-2xl border border-slate-200 shadow-sm w-14 lg:w-[240px] px-1 lg:px-0 shrink-0">
        {/* 이전 세트 화살표 (좌) — 데스크톱, 이전 세트가 있을 때만 */}
        {setNav?.canPrev && setNav.onPrev && (
          <button onClick={setNav.onPrev} title="이전 세트" className="hidden lg:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 items-center justify-center rounded-lg bg-white border border-slate-300 text-slate-500 hover:bg-slate-100 transition-colors">
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="text-sm lg:text-4xl font-black text-slate-800 tracking-tight lg:tracking-wide leading-none whitespace-nowrap">SET {currentSet.number}</div>
        <div className="text-[8px] lg:text-xs font-bold text-slate-400 tracking-wider lg:tracking-[0.25em] mt-0.5 lg:mt-2 whitespace-nowrap">TO {setTarget}</div>
        {/* 세트 종료 → 다음 세트(또는 결과) 화살표 (우) — 데스크톱 */}
        {setNav?.onNext && (
          <button onClick={setNav.onNext} title={setNav.nextTitle} className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 h-9 items-center gap-0.5 pl-2.5 pr-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md transition-colors whitespace-nowrap">
            {setNav.nextShort}<ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* AWAY 팀 카드 — 좌우 대칭: [큰 점수][세트점][AWAY 세로라벨] */}
      <div className="flex-1 flex items-stretch bg-white rounded-xl lg:rounded-2xl border-2 border-blue-200 shadow-sm overflow-hidden min-w-0">
        {/* 큰 점수 */}
        <div className={cn('flex-1 lg:flex-none flex items-center justify-center lg:justify-start py-2.5 lg:py-0 px-1 lg:pl-5 text-4xl lg:text-6xl font-black font-mono tabular-nums leading-none', servingB ? 'text-blue-500' : 'text-slate-800')}>
          {currentSet.scoreB}
        </div>
        {/* 팀명 — 데스크톱만 */}
        <div className="hidden lg:flex lg:flex-1 lg:items-center justify-end pr-1 pl-3 py-3 min-w-0">
          <span className="text-3xl sm:text-4xl font-black text-slate-900 truncate leading-tight">{teamB?.name}</span>
        </div>
        {/* 세트 점 — 라벨 옆 */}
        {setDots('B')}
        {/* AWAY 세로 라벨 */}
        <div className="flex items-center justify-center px-1 lg:px-1.5 shrink-0">
          <span className="text-[9px] lg:text-[10px] font-black text-blue-400 tracking-[0.2em] [writing-mode:vertical-rl]">AWAY</span>
        </div>
        <div className={cn('w-1 lg:w-1.5 self-stretch', servingB ? 'bg-blue-400' : 'bg-blue-100')} />
      </div>
    </div>
  );
};

// ── Vertical score tower for desktop layout ──────────────────────────
const ScoreTowerVertical = ({
  scoreEvents,
  teamA,
  teamB,
}: {
  scoreEvents: any; // 배열(솔로/레거시) 또는 객체(collab push) 모두 허용 — readScoreEvents로 정규화
  teamA?: Team;
  teamB?: Team;
}) => {
  const allPlayers = [...(teamA?.players ?? []), ...(teamB?.players ?? [])];
  
  const aPoints: Array<{ playerNumber?: string }> = [];
  const bPoints: Array<{ playerNumber?: string }> = [];
  for (const ev of readScoreEvents(scoreEvents)) {
    const num = allPlayers.find(p => p.id === ev.playerId)?.number;
    if (ev.team === 'A') aPoints.push({ playerNumber: num });
    else bPoints.push({ playerNumber: num });
  }

  // Render 세로형: 한 팀당 2 cols × 15 rows (column-flow로 위→아래로 채워짐)
  const renderTower = (
    points: Array<{ playerNumber?: string }>,
    color: 'orange' | 'blue'
  ) => (
    <div
      className="grid grid-cols-2 gap-1 h-full"
      style={{ gridAutoFlow: 'column', gridTemplateRows: 'repeat(15, minmax(0, 1fr))' }}
    >
      {Array.from({ length: 30 }, (_, idx) => {
        const pt = points[idx];
        return (
          <div
            key={idx}
            className={cn(
              "w-7 min-h-0 rounded-md flex items-center justify-center text-[10px] font-bold font-mono border-2",
              pt
                ? color === 'orange'
                  ? "bg-orange-500 text-white border-orange-600 shadow-sm"
                  : "bg-blue-500 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 text-slate-400 border-slate-200"
            )}
            title={`${idx + 1}점`}
          >
            {pt?.playerNumber ?? (idx + 1)}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex gap-3 justify-center items-stretch h-full w-full py-1">
      <div className="flex flex-col items-center gap-1 h-full">
        <div className="text-[10px] font-black text-orange-600 uppercase tracking-widest shrink-0">HOME</div>
        <div className="flex-1 min-h-0">{renderTower(aPoints, 'orange')}</div>
      </div>
      <div className="flex flex-col items-center gap-1 h-full">
        <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest shrink-0">AWAY</div>
        <div className="flex-1 min-h-0">{renderTower(bPoints, 'blue')}</div>
      </div>
    </div>
  );
};


// ── Bench panel - left: roster (bench), right: cumulative court stats ──
const BenchPanel = ({
  team, teamName, players, courtIds, stats, onBenchTap, disabled,
}: {
  team: 'A' | 'B';
  teamName: string;
  players: Player[];
  courtIds: string[];
  stats: Record<string, PlayerStats>;
  onBenchTap: (playerId: string) => void;
  disabled?: boolean;
}) => {
  const benchPlayers = players.filter(p => !courtIds.includes(p.id));

  const summary = (s?: PlayerStats) => {
    if (!s) return null;
    const serveTotal = s.serveOk + s.serveAce + s.serveFail;
    const serveOk = s.serveOk + s.serveAce;
    const spikeTotal = s.spikeSuccess + s.spikeBlocked + s.spikeError;
    return { serveOk, serveTotal, spikeSuccess: s.spikeSuccess, spikeTotal, block: s.block, error: s.error };
  };

  return (
    <div className={cn(
      "rounded-2xl p-3 border-2 overflow-hidden flex flex-col",
      team === 'A' ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"
    )}>
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className={cn(
          "text-xs font-black uppercase tracking-widest",
          team === 'A' ? "text-orange-700" : "text-blue-700"
        )}>
          {teamName} 벤치
        </div>
      </div>

      {/* Two-column layout: left = bench roster, right = cumulative stats */}
      <div className="flex-1 grid grid-cols-[1fr_1fr] gap-2 overflow-hidden">
        {/* LEFT: bench player list */}
        <div className="flex flex-col overflow-hidden">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex justify-between">
            <span>대기 ({benchPlayers.length}명)</span>
            <span className="text-slate-600 normal-case tracking-normal">탭=교체</span>
          </div>
          <div className="overflow-y-auto flex-1 space-y-1 pr-1">
            {benchPlayers.length === 0 ? (
              <div className="text-center text-[10px] text-slate-600 py-4 italic">대기 선수 없음</div>
            ) : (
              benchPlayers.map(p => {
                const s = summary(stats[p.id]);
                const hasStats = s && (s.serveTotal + s.spikeTotal + s.block + s.error > 0);
                return (
                  <button
                    key={p.id}
                    onClick={() => onBenchTap(p.id)}
                    disabled={disabled}
                    className={cn(
                      "w-full flex items-center gap-2 p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 transition-colors text-left shadow-sm",
                      disabled && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center font-black text-sm flex-shrink-0",
                      team === 'A' ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                    )}>
                      {p.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <div className="text-xs font-bold text-slate-800 truncate">{p.name}</div>
                        {p.isSetter && (
                          <div className="text-[8px] font-black bg-purple-600 text-white px-1 rounded">S</div>
                        )}
                      </div>
                      {hasStats && (
                        <div className="text-[8px] text-slate-500 font-mono mt-0.5 truncate">
                          {s!.serveTotal > 0 && `서브${s!.serveOk}/${s!.serveTotal}`}
                          {s!.spikeTotal > 0 && ` 공${s!.spikeSuccess}/${s!.spikeTotal}`}
                          {s!.block > 0 && ` 블${s!.block}`}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: cumulative court stats */}
        <div className="flex flex-col overflow-hidden">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            코트 누적 기록
          </div>
          <div className="overflow-y-auto flex-1">
            <CourtStatsSummary 
              players={players.filter(p => courtIds.includes(p.id))}
              stats={stats}
              team={team}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Compact stats summary for court players (now grid-2 vertical) ─────
const CourtStatsSummary = ({
  players, stats, team,
}: {
  players: Player[];
  stats: Record<string, PlayerStats>;
  team: 'A' | 'B';
}) => {
  const total = players.reduce((acc, p) => {
    const s = stats[p.id];
    if (!s) return acc;
    acc.serveOk += s.serveOk; acc.serveAce += s.serveAce; acc.serveFail += s.serveFail;
    acc.spikeSuccess += s.spikeSuccess; acc.spikeBlocked += s.spikeBlocked; acc.spikeError += s.spikeError;
    acc.block += s.block; acc.receive += s.receive; acc.dig += s.dig;
    acc.setAssist += s.setAssist;
    acc.error += s.error;
    return acc;
  }, { 
    serveOk:0, serveAce:0, serveFail:0,
    spikeSuccess:0, spikeBlocked:0, spikeError:0,
    block:0, receive:0, dig:0, setAssist:0, error:0 
  });

  const serveTotal = total.serveOk + total.serveAce + total.serveFail;
  const spikeTotal = total.spikeSuccess + total.spikeBlocked + total.spikeError;
  const accent = team === 'A' ? 'text-orange-400' : 'text-blue-400';

  return (
    <div className="grid grid-cols-2 gap-1 text-[10px]">
      <StatCell label="서브" value={`${total.serveAce + total.serveOk}/${serveTotal}`} accent={accent} />
      <StatCell label="에이스" value={`${total.serveAce}`} accent={accent} />
      <StatCell label="스파이크" value={`${total.spikeSuccess}/${spikeTotal}`} accent={accent} />
      <StatCell label="블로킹" value={`${total.block}`} accent={accent} />
      <StatCell label="리시브" value={`${total.receive}`} />
      <StatCell label="디그" value={`${total.dig}`} />
      <StatCell label="어시스트" value={`${total.setAssist}`} accent="text-purple-400" />
      <StatCell label="실책" value={`${total.error}`} accent="text-red-400" />
    </div>
  );
};

const StatCell = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="bg-slate-900/40 rounded px-1.5 py-1">
    <div className="text-slate-500 text-[8px] uppercase truncate">{label}</div>
    <div className={cn("font-mono font-bold", accent || "text-slate-300")}>{value}</div>
  </div>
);

// ── Substitution picker modal — handles both directions ───────────────
const SubstitutionPicker = ({
  mode,                  // 'fromBench' or 'fromCourt'
  fixedPlayer,           // the player already chosen (bench OR court)
  candidates,            // list of swap targets (court OR bench)
  onPick,
  onCancel,
}: {
  mode: 'fromBench' | 'fromCourt';
  fixedPlayer?: Player;
  candidates: Player[];
  onPick: (targetPlayerId: string) => void;
  onCancel: () => void;
}) => (
  <ModalOverlay onClose={onCancel}>
    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">선수 교체</div>
    {mode === 'fromBench' ? (
      <>
        <div className="text-sm font-black text-white mb-1">
          투입: <span className="text-emerald-400">{fixedPlayer?.number} {fixedPlayer?.name}</span>
        </div>
        <div className="text-xs text-slate-500 mb-3">교체할 코트 선수를 선택하세요</div>
      </>
    ) : (
      <>
        <div className="text-sm font-black text-white mb-1">
          교체 (OUT): <span className="text-red-400">{fixedPlayer?.number} {fixedPlayer?.name}</span>
        </div>
        <div className="text-xs text-slate-500 mb-3">투입할 대기 선수를 선택하세요</div>
      </>
    )}
    <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
      {candidates.length === 0 ? (
        <div className="col-span-3 text-center text-xs text-slate-500 py-6 italic">
          {mode === 'fromBench' ? '코트 선수가 없습니다' : '대기 선수가 없습니다'}
        </div>
      ) : (
        candidates.map(p => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className={cn(
              "py-3 rounded-xl border font-bold active:scale-95 transition-all",
              mode === 'fromBench' 
                ? "bg-red-600/20 hover:bg-red-600/40 border-red-600/30 text-white" 
                : "bg-emerald-600/20 hover:bg-emerald-600/40 border-emerald-600/30 text-white"
            )}
          >
            <div className="text-lg font-black">{p.number}</div>
            <div className="text-[10px] truncate px-1">{p.name}</div>
            {p.isSetter && (
              <div className="text-[8px] font-black bg-purple-600 text-white px-1 rounded inline-block mt-0.5">S</div>
            )}
          </button>
        ))
      )}
    </div>
    <Button variant="ghost" className="w-full mt-3" onClick={onCancel}>취소</Button>
  </ModalOverlay>
);

const CourtPlayers = ({
  team, teamName, players, courtIds, serverIdx, isServing, stats, onTap, onBenchTap, disabled,
  benchOpen: benchOpenProp, onToggleBench,
}: {
  team: 'A' | 'B';
  teamName: string;
  players: Player[];
  courtIds: string[];
  serverIdx: number;
  isServing: boolean;
  stats: Record<string, PlayerStats>;
  onTap: (playerId: string) => void;
  onBenchTap?: (playerId: string) => void;
  disabled?: boolean;
  /** 펼침 상태를 상위(App)에서 제어 — collab 리렌더/리마운트에도 유지되도록 hoist. 미지정 시 로컬 폴백. */
  benchOpen?: boolean;
  onToggleBench?: () => void;
}) => {
  // serverIdx 클램프(음수/초과/NaN 안전) — 교체·로테이션 후에도 코트 범위 내로.
  const safeServerIdx = courtIds.length ? ((((serverIdx || 0) % courtIds.length) + courtIds.length) % courtIds.length) : 0;
  const serverId = courtIds[safeServerIdx];
  const courtPlayers = courtIds.map(id => players.find(p => p.id === id)).filter(Boolean) as Player[];
  const benchPlayers = players.filter(p => !courtIds.includes(p.id));
  const [benchOpenLocal, setBenchOpenLocal] = useState(false);
  const benchOpen = benchOpenProp ?? benchOpenLocal;
  const toggleBench = onToggleBench ?? (() => setBenchOpenLocal(o => !o));

  // 통계 계산
  const computeStats = (s?: PlayerStats) => {
    if (!s) return { points: 0, errors: 0, attackPct: 0, servePct: 0, spikeTotal: 0, serveTotal: 0, hasAny: false };
    const points = s.spikeSuccess + s.serveAce + s.block;
    const errors = s.error + s.spikeError + s.spikeBlocked + s.serveFail;
    const spikeTotal = s.spikeSuccess + s.spikeBlocked + s.spikeError;
    const attackPct = spikeTotal > 0 ? Math.round((s.spikeSuccess / spikeTotal) * 100) : 0;
    const serveTotal = s.serveOk + s.serveAce + s.serveFail;
    const servePct = serveTotal > 0 ? Math.round(((s.serveOk + s.serveAce) / serveTotal) * 100) : 0;
    const hasAny = points + errors + spikeTotal + serveTotal + s.receive + s.dig + s.setAssist > 0;
    return { points, errors, attackPct, servePct, spikeTotal, serveTotal, hasAny };
  };

  // 한 선수 행 렌더링 (코트 또는 대기)
  const renderRow = (p: Player, isCourt: boolean) => {
    const isServer = isCourt && p.id === serverId && isServing;
    const s = computeStats(stats[p.id]);

    return (
      <button
        key={p.id}
        onClick={() => isCourt ? onTap(p.id) : onBenchTap?.(p.id)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border-2 transition-all active:scale-[0.98] text-left",
          isServer
            ? team === 'A'
              ? "bg-orange-500 border-orange-600 shadow-md"
              : "bg-blue-500 border-blue-600 shadow-md"
            : isCourt
              ? team === 'A'
                ? "bg-white border-orange-300 hover:bg-orange-50"
                : "bg-white border-blue-300 hover:bg-blue-50"
              : team === 'A'
                ? "bg-orange-50/40 border-orange-200 border-dashed hover:bg-orange-100/60"
                : "bg-blue-50/40 border-blue-200 border-dashed hover:bg-blue-100/60",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {/* 번호 박스 */}
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center font-black text-xl flex-shrink-0 relative",
          isServer
            ? "bg-white/25 text-white"
            : isCourt
              ? team === 'A'
                ? "bg-orange-100 text-orange-700"
                : "bg-blue-100 text-blue-700"
              : team === 'A'
                ? "bg-orange-100/60 text-orange-600/80"
                : "bg-blue-100/60 text-blue-600/80"
        )}>
          {p.number}
          {p.isSetter && (
            <div className="absolute -top-1 -right-1 text-[8px] font-black bg-purple-600 text-white px-1 rounded shadow-md">S</div>
          )}
        </div>

        {/* 이름 + 통계 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className={cn(
              "text-base font-black truncate",
              isServer ? "text-white" : "text-slate-800"
            )}>{p.name}</div>
            {isServer && (
              <div className="text-[9px] font-black bg-white/30 text-white px-1.5 py-0.5 rounded tracking-wider">서버</div>
            )}
          </div>
          {/* 통계 */}
          {s.hasAny ? (
            <div className={cn(
              "text-[11px] flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono",
              isServer ? "text-white/90" : "text-slate-500"
            )}>
              <span>득점 <span className={cn("font-bold", isServer ? "text-white" : "text-slate-800")}>{s.points}</span></span>
              {s.errors > 0 && (
                <span>실책 <span className={cn("font-bold", isServer ? "text-white" : "text-red-600")}>{s.errors}</span></span>
              )}
              {s.spikeTotal > 0 && (
                <span>공격 <span className={cn("font-bold", isServer ? "text-white" : "text-slate-800")}>{s.attackPct}%</span></span>
              )}
              {s.serveTotal > 0 && (
                <span>서브 <span className={cn("font-bold", isServer ? "text-white" : "text-slate-800")}>{s.servePct}%</span></span>
              )}
            </div>
          ) : (
            <div className={cn(
              "text-[11px]",
              isServer ? "text-white/70" : "text-slate-400"
            )}>
              {isCourt ? "기록 없음" : "대기 중 — 탭하여 교체"}
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className={cn(
      "rounded-2xl p-3 border-2",
      team === 'A' ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"
    )}>
      {/* 코트 선수 (주전) — 팀명은 상단 스코어보드에 있으므로 컬럼에선 생략(중복 제거·공간 절약) */}
      <div className="mb-3">
        <div className={cn(
          "flex items-center justify-between mb-2 px-1",
          team === 'A' ? "text-orange-700" : "text-blue-700"
        )}>
          <span className="text-[10px] font-black uppercase tracking-wider">코트 ({courtPlayers.length}명)</span>
          {isServing && (
            <span className="flex items-center gap-1 text-[11px] font-black">
              <span className={cn("w-2 h-2 rounded-full animate-pulse", team === 'A' ? "bg-orange-500" : "bg-blue-500")} />
              서브
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {courtPlayers.map(p => renderRow(p, true))}
        </div>
      </div>

      {/* 대기 선수 — 펼치기/접기 */}
      {benchPlayers.length > 0 && (
        <div>
          <button
            type="button"
            onClick={toggleBench}
            className={cn(
              "w-full flex items-center justify-between text-[10px] font-black uppercase tracking-wider mb-2 px-1 py-1.5 rounded-lg hover:bg-slate-100 transition-colors",
              team === 'A' ? "text-orange-700" : "text-blue-700"
            )}
          >
            <span className="flex items-center gap-1">
              {benchOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              대기 명단 {benchOpen ? '접기' : '펼치기'} ({benchPlayers.length}명)
            </span>
            <span className="text-slate-500 font-normal normal-case tracking-normal">탭=교체</span>
          </button>
          {benchOpen && (
            <div className="space-y-1.5">
              {benchPlayers.map(p => renderRow(p, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Modal: pick action category ───────────────────────────────────────
const CATEGORY_LABELS: Record<ActionCategory, { label: string; color: string }> = {
  serve:   { label: '서브',     color: 'bg-blue-500/10 border-blue-400/40 text-slate-900' },
  attack:  { label: '스파이크', color: 'bg-rose-500/10 border-rose-400/40 text-slate-900' },
  defense: { label: '수비',     color: 'bg-teal-500/10 border-teal-400/40 text-slate-900' },
  setter:  { label: '토스',     color: 'bg-violet-500/10 border-violet-400/40 text-slate-900' },
  block:   { label: '블로킹',   color: 'bg-amber-500/10 border-amber-400/40 text-slate-900' },
  error:   { label: '실책',     color: 'bg-pink-500/10 border-pink-400/40 text-slate-900' },
};

const CategoryPicker = ({
  allowedCategories, showSubstitute, onPick, onSubstitute, onCancel,
}: {
  allowedCategories: ActionCategory[];
  showSubstitute?: boolean;
  onPick: (c: ActionCategory) => void;
  onSubstitute?: () => void;
  onCancel: () => void;
}) => (
  <ModalOverlay onClose={onCancel}>
    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">행동 선택</div>
    <div className="grid grid-cols-2 gap-2">
      {allowedCategories.map(c => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className={cn(
            "py-4 rounded-xl font-black text-sm border active:scale-95 transition-all",
            CATEGORY_LABELS[c].color
          )}
        >
          {CATEGORY_LABELS[c].label}
        </button>
      ))}
    </div>
    {showSubstitute && onSubstitute && (
      <button
        onClick={onSubstitute}
        className="w-full mt-2 py-3 rounded-xl font-black text-sm text-slate-900 bg-emerald-600/15 hover:bg-emerald-600/30 border border-emerald-600/30 active:scale-95 transition-all"
      >
        🔄 교체
      </button>
    )}
    <Button variant="ghost" className="w-full mt-3" onClick={onCancel}>취소</Button>
  </ModalOverlay>
);

// ── Modal: pick outcome for a category ────────────────────────────────
const OutcomePicker = ({
  category, playerLabel, onPick, onCancel,
}: {
  category: ActionCategory;
  playerLabel: string;
  onPick: (key: keyof PlayerStats) => void;
  onCancel: () => void;
}) => {
  const outcomes = ACTION_OUTCOMES[category];
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">결과 선택</div>
      <div className="text-sm font-black text-white mb-3">{playerLabel} · {CATEGORY_LABELS[category].label}</div>
      <div className="space-y-2">
        {outcomes.map(o => {
          // Outline style (옅은 배경 + 컬러 외곽선 + 컬러 글자). 스파이크 상대블록은
          // 실책과 구분되도록 별도 색(주황)으로, 나머지 실점 결과는 빨강 계열.
          const colorClass =
            o.scoringTeam === 'self'    ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300' :
            o.key === 'spikeBlocked'    ? 'bg-orange-500/10 border-orange-400/40 text-orange-300' :
            o.scoringTeam === 'other'   ? 'bg-rose-500/10 border-rose-400/40 text-rose-300' :
            'bg-slate-500/10 border-slate-400/40 text-slate-300';
          return (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              className={cn(
                "w-full py-4 rounded-xl font-black text-sm border active:scale-95 transition-all",
                colorClass
              )}
            >
              {o.label}
              {o.scoringTeam === 'self' && <span className="ml-2 text-[10px] font-bold opacity-80">+1 득점</span>}
              {o.scoringTeam === 'other' && <span className="ml-2 text-[10px] font-bold opacity-80">상대 +1</span>}
            </button>
          );
        })}
      </div>
      <Button variant="ghost" className="w-full mt-3" onClick={onCancel}>취소</Button>
    </ModalOverlay>
  );
};

// ── Modal: pick which setter assisted ─────────────────────────────────
const AssistPicker = ({
  setters, onPick, onSkip,
}: {
  setters: Player[];
  onPick: (setterId: string) => void;
  onSkip: () => void;
}) => (
  <ModalOverlay onClose={onSkip}>
    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">어시스트 한 세터</div>
    <div className="space-y-2">
      {setters.map(s => (
        <button
          key={s.id}
          onClick={() => onPick(s.id)}
          className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold active:scale-95 transition-all"
        >
          {s.number} {s.name}
        </button>
      ))}
    </div>
    <Button variant="ghost" className="w-full mt-3" onClick={onSkip}>건너뛰기</Button>
  </ModalOverlay>
);

// ── Modal overlay wrapper ─────────────────────────────────────────────
const ModalOverlay = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4" onClick={onClose}>
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-5 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </motion.div>
  </div>
);

// ── Stat pill for dashboard ───────────────────────────────────────────
const StatPill = ({ label, value, pct }: { label: string; value: string; pct: number }) => (
  <div className="bg-slate-800/50 rounded-lg px-2 py-1.5">
    <div className="text-[8px] font-bold text-slate-500 uppercase">{label}</div>
    <div className="font-mono font-bold text-slate-200">{value}</div>
    <div className="text-[8px] text-slate-500 font-mono">{pct.toFixed(0)}%</div>
  </div>
);

// RTDB/레거시 데이터가 배열을 키객체로 저장해도 배열로 복원(경기 소실 방지).
function toArr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

// --- Main App Component ---

export default function App() {
  // ── Session detection from URL ─────────────────────────────────────
  // 부팅 자동 collab: 세션 없으면 메인 워크스페이스(spikelog/main)에 연결.
  const [session, setSession] = useState(() => {
    const p = getSessionParams();
    if (!p.sessionId) return { sessionId: 'main', mode: 'collab' as const };
    return p;
  });

  // ── 인증(구글 학교계정) ─────────────────────────────────────────────
  const { user: authUser, allowed: canRecord } = useAuth();

  // 쓰기 권한이 없으면(미로그인/도메인 외) 읽기전용 뷰어로 동작.
  const readOnly = session.mode === 'share' || !canRecord;
  const firebaseEnabled = session.mode === 'collab' || session.mode === 'share';

  const handleLogin = async () => {
    try { await signInWithGoogle(); }
    catch (e: any) { alert(e?.message || '로그인에 실패했습니다.'); }
  };
  const handleLogout = async () => { try { await signOut(); } catch { /* noop */ } };

  const [data, setData] = useState<AppData>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return INITIAL_DATA;
    try {
      const parsed = JSON.parse(saved);
      // Backward compatibility: fill missing fields with defaults
      return {
        ...INITIAL_DATA,
        ...parsed,
        events: toArr(parsed.events),
        // 각 세트에 필수 필드 보강 — 옛/외부 주입 데이터에 playerStats·scoreEvents가
        // 없으면 통계 집계 시 앱 전체가 흰 화면으로 죽던 문제 방지.
        games: toArr(parsed.games).map((g: any) => ({
          ...g,
          sets: toArr(g.sets).map((s: any) => ({
            ...s,
            playerStats: s.playerStats ?? {},
            scoreEvents: toArr(s.scoreEvents),
            courtA: toArr(s.courtA),
            courtB: toArr(s.courtB),
          })),
        })),
        teams: toArr(parsed.teams).length
          ? toArr(parsed.teams).map((t: any) => ({
              id: t.id ?? generateId(),
              name: t.name ?? '팀',
              players: toArr(t.players),
            }))
          : INITIAL_DATA.teams,
        criteria: parsed.criteria ?? INITIAL_DATA.criteria,
        peerEvals: parsed.peerEvals ?? {},
      };
    } catch {
      return INITIAL_DATA;
    }
  });

  // ── Firebase sync (only when session is active) ────────────────────
  useFirebaseSync({
    sessionId: session.sessionId,
    data,
    setData,
    readOnly,
    enabled: firebaseEnabled,
  });

  const [view, setView] = useState<'home' | 'team' | 'game-setup' | 'game-court' | 'game-record' | 'dashboard' | 'settings' | 'event-setup' | 'event-detail'>('home');
  const [params, setParams] = useState<any>({});
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);
  // 대회 상세 탭 상태 — App 레벨로 올려둠. (뷰 컴포넌트가 중첩 정의라
  // collab 동기화 setData 때마다 리마운트되는데, 로컬 useState면 탭이
  // 순위표로 초기화되어 '경기 일정'을 눌러도 튕기는 버그가 있었음.)
  const [eventDetailTab, setEventDetailTab] = useState<'standings' | 'matches'>('standings');
  // 개인 기록 표 정렬 (표시용 클라이언트 상태) — 집계/데이터 미접촉. 동기화 리마운트에도 유지되도록 부모 state.
  const [statSort, setStatSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'contribution', dir: 'desc' });
  // 경기 설정 폼 상태도 App 레벨로 — 중첩 뷰가 collab 리렌더로 리마운트되면
  // 로컬 useState가 초기화돼 "9인제/3전2선승 선택이 6인제/단판으로 되돌아가던" 버그 방지.
  const [gsTeamA, setGsTeamA] = useState('');
  const [gsTeamB, setGsTeamB] = useState('');
  const [gsTarget, setGsTarget] = useState(25);
  const [gsCourtN, setGsCourtN] = useState(6);
  const [gsMaxSets, setGsMaxSets] = useState(1); // 1=단판, 3=3전2선승, 5=5전3선승
  // 경기 설정 모달 open 상태도 App 레벨로 — 중첩 게임뷰가 collab 동기화로 리마운트되면
  // 로컬 useState(false)로 초기화되어 모바일에서 모달이 열리자마자 닫히던(깜빡) 버그 방지.
  const [showSettings, setShowSettings] = useState(false);
  // 대기명단 펼침도 App 레벨 — 게임뷰가 collab 리렌더로 리마운트돼도 펼침 유지(깜빡이며 닫힘 방지).
  const [benchOpenA, setBenchOpenA] = useState(false);
  const [benchOpenB, setBenchOpenB] = useState(false);
  // Derive currentGame from data.games (single source of truth)
  const currentGame: Game | null = currentGameId
    ? data.games.find(g => g.id === currentGameId) ?? null
    : null;
  // 경기 설정 변경(인원수·세트수·목표점수) — 모달을 App 레벨에서 렌더하므로 핸들러도 App 레벨.
  const applyGameSettings = (patch: Partial<Pick<Game, 'courtN' | 'maxSets' | 'setTarget'>>) => {
    if (!currentGame) return;
    // 인원수(courtN) 변경 시 format 문자열("N인제")도 함께 갱신 — 헤더/카드 표기 일치.
    const extra = patch.courtN != null ? { format: `${patch.courtN}인제` } : {};
    setData(prev => ({
      ...prev,
      games: prev.games.map(g => g.id === currentGame.id ? { ...g, ...patch, ...extra } : g),
    }));
  };
  const currentEvent: VBEvent | null = currentEventId
    ? data.events.find(e => e.id === currentEventId) ?? null
    : null;
  const [toast, setToast] = useState<string | null>(null);

  // Persistence: always cache to localStorage as offline fallback
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(STORAGE_KEY + '_ts', String(Date.now())); // 첫 스냅샷 lastUpdate 머지용
  }, [data]);

  // ── Session actions ────────────────────────────────────────────────
  const startCollabSession = () => {
    const id = session.sessionId || generateSessionId();
    setSessionUrl(id, 'collab');
    setSession({ sessionId: id, mode: 'collab' });
    showToast('협업 세션 시작됨');
  };

  const endSession = () => {
    if (!confirm('세션을 종료하시겠습니까? URL이 초기화됩니다.')) return;
    clearSessionUrl();
    setSession({ sessionId: null, mode: 'solo' });
    showToast('솔로 모드로 전환');
  };

  const copyShareLink = async () => {
    if (!session.sessionId) return;
    const url = buildShareUrl(session.sessionId);
    try {
      await navigator.clipboard.writeText(url);
      showToast('공유 링크가 복사되었습니다');
    } catch {
      // Fallback for older browsers / non-secure contexts
      prompt('공유 링크 (복사하세요):', url);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const navigate = (v: typeof view, p: any = {}) => {
    setView(v);
    setParams(p);
  };

  // --- View Components ---

  const HomeView = () => (
    <div className="flex flex-col h-full bg-slate-950 text-slate-50">
      <header className="p-4 lg:p-6 border-b border-slate-900">
       <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 lg:gap-3 min-w-0">
          <div className="w-9 h-9 lg:w-10 lg:h-10 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30 shrink-0">
            <Volleyball size={22} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg lg:text-xl font-black tracking-tight text-white truncate">Spike <span className="text-sky-400">Log</span> Pro</h1>
            {/* 데스크톱: 로고 아래 태그라인. 모바일: 헤더 하단 풀폭 띠로 별도 표시(아래) */}
            <p className="hidden lg:block text-[10px] text-slate-500 font-bold uppercase tracking-widest">Volleyball Performance Tracker</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
          {/* 로그인/로그아웃 — '협업중' 배지와 같은 연한 pill 톤으로 통일 */}
          {canRecord ? (
            <>
              {/* 계정 — 모바일은 아이콘만(탭하면 이메일 토스트), 데스크톱은 이름 표시 */}
              <button
                onClick={() => showToast(authUser?.email || authUser?.name || '계정')}
                className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-emerald-600/10 border border-emerald-600/30 text-[11px] font-bold text-emerald-400 max-w-[150px] truncate"
                title={authUser?.email ?? ''}
              >
                <UserRound size={13} className="flex-shrink-0" />
                <span className="truncate hidden lg:inline">{authUser?.name || authUser?.email}</span>
              </button>
              <button
                onClick={handleLogout}
                title="로그아웃"
                className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-slate-700/40 border border-slate-600/50 hover:bg-slate-700/70 text-[11px] font-bold text-slate-300 transition-colors"
              >
                <LogOut size={13} /> <span className="hidden lg:inline">로그아웃</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleLogin}
              title={authUser ? '다른 계정' : '구글 로그인'}
              className="flex items-center gap-1 px-2 py-1.5 lg:py-1 rounded-md bg-sky-600/10 border border-sky-600/30 hover:bg-sky-600/20 text-[11px] font-bold text-sky-400 transition-colors"
            >
              <LogIn size={13} /> <span className="hidden lg:inline">{authUser ? '다른 계정' : '구글 로그인'}</span>
            </button>
          )}
          <SessionBadge session={session} onShare={copyShareLink} />
          <Button variant="ghost" size="sm" onClick={() => navigate('settings')} icon={Settings} />
        </div>
       </div>
        {/* 태그라인 — 모바일에서만 헤더 하단 풀폭 띠로 옅게 */}
        <p className="lg:hidden text-center text-[9px] text-slate-600 font-bold uppercase tracking-[0.3em] mt-2.5">Volleyball Performance Tracker</p>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-8 min-h-0">
        <div className="max-w-4xl mx-auto space-y-8 pb-6">
        <section className="space-y-4">
          <div className="flex justify-between items-end">
            <h2 className="text-base lg:text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Users size={16} /> 팀 관리
            </h2>
            <Button variant="ghost" size="sm" onClick={() => {
              const nextNum = data.teams.length + 1;
              const newTeam: Team = { 
                id: generateId(), 
                name: `팀 ${nextNum}`, 
                players: [] 
              };
              setData(prev => ({ ...prev, teams: [...prev.teams, newTeam] }));
              showToast(`${newTeam.name} 추가됨`);
            }} icon={Plus}>팀 추가</Button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 lg:gap-3">
            {data.teams.map((team, idx) => {
              const colors = [
                { bar: '#ea580c', text: '#c2410c' },   // orange
                { bar: '#2563eb', text: '#1d4ed8' },   // blue
                { bar: '#059669', text: '#047857' },   // emerald
                { bar: '#9333ea', text: '#7e22ce' },   // purple
                { bar: '#db2777', text: '#be185d' },   // pink
                { bar: '#0891b2', text: '#0e7490' },   // cyan
                { bar: '#ca8a04', text: '#a16207' },   // amber
                { bar: '#dc2626', text: '#b91c1c' },   // red
              ];
              const c = colors[idx % colors.length];
              return (
                <div 
                  key={team.id}
                  className="group relative rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors overflow-hidden"
                  style={{ borderLeft: `4px solid ${c.bar}` }}
                >
                  <button
                    onClick={() => navigate('team', { teamId: team.id })}
                    className="w-full text-left p-5 lg:p-4 pr-12 lg:pr-11 flex items-center justify-between gap-3"
                  >
                    <h3
                      className="font-black text-xl lg:text-base truncate min-w-0 flex-1"
                      style={{ color: c.text }}
                    >
                      {team.name}
                    </h3>
                    <p className="text-base lg:text-xs text-slate-500 font-bold shrink-0 whitespace-nowrap">
                      선수 <span className="text-slate-700 font-mono">{(team.players?.length ?? 0)}명</span>
                    </p>
                  </button>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (data.teams.length <= 2) {
                          showToast('팀이 최소 2개 필요합니다');
                          return;
                        }
                        if (!confirm(`"${team.name}"을(를) 삭제하시겠습니까?\n등록된 선수도 함께 삭제됩니다.`)) return;
                        setData(prev => ({
                          ...prev,
                          teams: prev.teams.filter(t => t.id !== team.id),
                        }));
                        showToast('팀 삭제됨');
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                      title="팀 삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 대회 섹션 */}
        <section className="space-y-4">
          <div className="flex justify-between items-end">
            <h2 className="text-base lg:text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Trophy size={16} /> 대회 (리그)
            </h2>
            <Button 
              variant="ghost" 
              size="sm" 
              icon={Plus}
              onClick={() => navigate('event-setup')}
              disabled={readOnly}
            >
              대회 만들기
            </Button>
          </div>

          {data.events.length === 0 ? (
            <div className="text-center py-8 bg-slate-900/30 rounded-xl lg:rounded-3xl border border-dashed border-slate-800">
              <p className="text-slate-500 text-base lg:text-sm">대회를 만들어 리그를 운영하세요.</p>
              <p className="text-slate-600 text-sm lg:text-xs mt-1">팀 선택 → 라운드 수 입력 → 자동 일정 생성</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[...data.events].reverse().map(event => {
                const progress = eventProgress(event, data.games);
                const isOngoing = !event.endedAt;
                return (
                  <div
                    key={event.id}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors overflow-hidden"
                    style={{ borderLeft: `4px solid ${isOngoing ? '#ea580c' : '#94a3b8'}` }}
                    onClick={() => {
                      setCurrentEventId(event.id);
                      navigate('event-detail');
                    }}
                  >
                    <div className="p-5 lg:p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-black text-xl lg:text-base text-slate-900 truncate">{event.name}</h3>
                        <div className="text-sm lg:text-[10px] text-slate-500 mt-1">
                          {event.teamIds.length}팀 · {event.rounds}라운드 · 총 {event.matches.length}경기
                        </div>
                      </div>
                      {isOngoing && (
                        <div className="text-xs lg:text-[10px] font-black bg-orange-100 text-orange-700 px-2 py-1 rounded">
                          진행중
                        </div>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1.5">
                      <div 
                        className="bg-orange-500 h-1.5 rounded-full transition-all"
                        style={{ 
                          width: `${progress.total > 0 ? (progress.finished / progress.total) * 100 : 0}%` 
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs lg:text-[10px] text-slate-500 font-mono">
                      <span>완료 {progress.finished}/{progress.total}</span>
                      {progress.inProgress > 0 && (
                        <span className="text-emerald-600">진행 {progress.inProgress}</span>
                      )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {(() => {
          const ongoing = data.games.filter(g => !g.winnerTeamId && !g.endedAt);
          const finished = data.games.filter(g => g.winnerTeamId || g.endedAt);
          return (
            <>
              {ongoing.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-base lg:text-sm font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                    <Play size={16} /> 진행 중인 경기 ({ongoing.length})
                  </h2>
                  <div className="space-y-3">
                    {[...ongoing].reverse().map(game => {
                      const teamA = data.teams.find(t => t.id === game.teamAId);
                      const teamB = data.teams.find(t => t.id === game.teamBId);
                      const lastSet = game.sets[game.sets.length - 1];
                      return (
                        <Card
                          key={game.id}
                          className="p-3 lg:p-3.5 rounded-xl lg:rounded-2xl cursor-pointer hover:bg-slate-900 transition-colors border-emerald-600/30 bg-emerald-600/5"
                          onClick={() => {
                            setCurrentGameId(game.id);
                            // jump back into recording at last set
                            navigate('game-record', { setId: game.sets.length - 1 });
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-12 shrink-0" aria-hidden="true"></span>
                            <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
                              <span className="font-black text-xl lg:text-base text-slate-200 truncate flex-1 text-right">{teamA?.name}</span>
                              <span className="font-mono font-black text-xl lg:text-lg text-orange-500 tabular-nums shrink-0">{lastSet?.scoreA ?? 0}</span>
                              <span className="text-slate-500 text-base shrink-0">:</span>
                              <span className="font-mono font-black text-xl lg:text-lg text-blue-500 tabular-nums shrink-0">{lastSet?.scoreB ?? 0}</span>
                              <span className="font-black text-xl lg:text-base text-slate-200 truncate flex-1 text-left">{teamB?.name}</span>
                            </div>
                            <ChevronRight size={18} className="text-emerald-500 shrink-0" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm('이 경기를 삭제하시겠습니까?')) return;
                                setData(prev => ({
                                  ...prev,
                                  games: prev.games.filter(g => g.id !== game.id),
                                }));
                                showToast('경기 삭제됨');
                              }}
                              className="text-slate-600 hover:text-red-500 p-1 shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="flex items-center justify-center gap-1 mt-1 text-[10px] font-bold text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                            LIVE · {game.date} · SET {game.sets.length}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-4">
                <h2 className="text-base lg:text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <History size={16} /> 종료된 경기
                </h2>
                {finished.length === 0 ? (
                  <div className="text-center py-8 lg:py-12 bg-slate-900/30 rounded-xl lg:rounded-3xl border border-dashed border-slate-800">
                    <p className="text-slate-500 text-base lg:text-sm">종료된 경기가 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...finished].reverse().slice(0, 5).map(game => {
                      const teamA = data.teams.find(t => t.id === game.teamAId);
                      const teamB = data.teams.find(t => t.id === game.teamBId);
                      return (
                        <Card key={game.id} className="p-3 lg:p-3.5 rounded-xl lg:rounded-2xl cursor-pointer hover:bg-slate-900 transition-colors" onClick={() => {
                          setCurrentGameId(game.id);
                          navigate('dashboard', { gameId: game.id });
                        }}>
                          <div className="flex items-center gap-2">
                            <span className="w-12 shrink-0" aria-hidden="true"></span>
                            <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
                              <span className="font-black text-xl lg:text-base text-slate-200 truncate flex-1 text-right">{teamA?.name}</span>
                              <span className="font-black text-orange-600 text-sm italic shrink-0">VS</span>
                              <span className="font-black text-xl lg:text-base text-slate-200 truncate flex-1 text-left">{teamB?.name}</span>
                            </div>
                            <ChevronRight size={18} className="text-slate-400 shrink-0" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm('이 경기 기록을 삭제하시겠습니까?')) return;
                                setData(prev => ({
                                  ...prev,
                                  games: prev.games.filter(g => g.id !== game.id),
                                }));
                                showToast('경기 삭제됨');
                              }}
                              className="text-slate-600 hover:text-red-500 p-1 shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="text-[10px] font-bold text-slate-500 mt-1 text-center">{game.date}</div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          );
        })()}
        </div>
      </main>

      <footer className="p-4 lg:p-6 bg-slate-950 border-t border-slate-900">
        <Button
          variant="primary"
          size="lg"
          className="w-full shadow-xl shadow-orange-600/20"
          onClick={() => navigate('game-setup')}
          icon={Play}
          disabled={readOnly}
        >
          {readOnly ? '읽기 전용 모드' : '새 경기 시작하기'}
        </Button>
      </footer>
    </div>
  );

  const TeamView = () => {
    const teamId = params.teamId;
    const team = data.teams.find(t => t.id === teamId);
    const [pName, setPName] = useState('');
    const [pNum, setPNum] = useState('');
    const [pOrg, setPOrg] = useState('');
    const [pIsSetter, setPIsSetter] = useState(false);
    const [replaceMode, setReplaceMode] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    if (!team) return null;

    const addPlayer = () => {
      if (!pName) return;
      const newPlayer: Player = {
        id: generateId(),
        name: pName,
        number: pNum || '-',
        org: pOrg,
        teamId: team.id,
        isSetter: pIsSetter,
      };
      setData(prev => ({
        ...prev,
        teams: prev.teams.map(t => t.id === team.id ? { ...t, players: [...t.players, newPlayer] } : t)
      }));
      setPName(''); setPNum(''); setPOrg(''); setPIsSetter(false);
    };

    // CSV template download — BOM prefix for Excel Korean compatibility
    const downloadCSVTemplate = () => {
      const csv = '\uFEFF이름,번호,학년반,세터(Y/N)\n홍길동,7,2-3,N\n김세터,1,2-3,Y\n이공격,9,2-4,N';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${team.name}_선수명단_양식.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    // CSV bulk upload
    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = (ev.target?.result as string).replace(/^\uFEFF/, '');
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 2) {
          showToast('CSV에 데이터가 없습니다');
          return;
        }
        const newPlayers: Player[] = [];
        const seenKeys = new Set<string>();
        // Existing players' keys for dedup when not replacing
        if (!replaceMode) {
          (team.players ?? []).forEach(p => seenKeys.add(`${p.name}|${p.number}`));
        }
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          const name = cols[0];
          const number = cols[1] || '-';
          const org = cols[2] || '';
          const isSetter = (cols[3] || '').toUpperCase() === 'Y';
          if (!name) continue;
          const key = `${name}|${number}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          newPlayers.push({
            id: generateId(),
            name, number, org,
            teamId: team.id,
            isSetter,
          });
        }
        if (newPlayers.length === 0) {
          showToast('새로 추가할 선수가 없습니다');
          return;
        }
        setData(prev => ({
          ...prev,
          teams: prev.teams.map(t =>
            t.id === team.id
              ? { ...t, players: replaceMode ? newPlayers : [...t.players, ...newPlayers] }
              : t
          ),
        }));
        showToast(`${newPlayers.length}명 ${replaceMode ? '교체' : '추가'}됨`);
      };
      reader.readAsText(file, 'UTF-8');
      e.target.value = ''; // allow re-upload same file
    };

    // Export current team roster as CSV
    const exportRoster = () => {
      const header = '이름,번호,학년반,세터(Y/N)';
      const rows = (team.players ?? []).map(p =>
        [p.name, p.number, p.org ?? '', p.isSetter ? 'Y' : 'N'].join(',')
      );
      const csv = '\uFEFF' + [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${team.name}_선수명단.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const toggleSetter = (pid: string) => {
      setData(prev => ({
        ...prev,
        teams: prev.teams.map(t => 
          t.id === team.id 
            ? { ...t, players: (t.players ?? []).map(p => p.id === pid ? { ...p, isSetter: !p.isSetter } : p) }
            : t
        )
      }));
    };

    const deletePlayer = (pid: string) => {
      if (!confirm('정말 삭제하시겠습니까?')) return;
      setData(prev => ({
        ...prev,
        teams: prev.teams.map(t => t.id === team.id ? { ...t, players: (t.players ?? []).filter(p => p.id !== pid) } : t)
      }));
    };

    const renameTeam = () => {
      const newName = prompt('팀 이름을 입력하세요:', team.name);
      if (!newName || newName === team.name) return;
      setData(prev => ({
        ...prev,
        teams: prev.teams.map(t => t.id === team.id ? { ...t, name: newName } : t),
      }));
      showToast('팀 이름 변경됨');
    };

    const deleteTeam = () => {
      if (data.teams.length <= 2) {
        showToast('팀이 최소 2개 필요합니다');
        return;
      }
      if (!confirm(`정말 "${team.name}"을(를) 삭제하시겠습니까?\n등록된 선수도 모두 삭제됩니다.`)) return;
      setData(prev => ({
        ...prev,
        teams: prev.teams.filter(t => t.id !== team.id),
      }));
      navigate('home');
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center justify-between gap-4 border-b border-slate-900">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
            <button onClick={renameTeam} className="text-left hover:opacity-70 transition-opacity">
              <h1 className="text-xl font-black tracking-tight truncate">
                {team.name} <span className="text-orange-600 text-sm font-normal">✏️</span>
              </h1>
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={deleteTeam} className="text-red-500 hover:bg-red-500/10">
            <Trash2 size={18} />
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 pb-12 min-h-0">
          <div className="max-w-4xl mx-auto space-y-6 pb-6">
          <Card title="선수 추가">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Input label="이름" value={pName} onChange={e => setPName(e.target.value)} placeholder="홍길동" />
              <Input label="번호" value={pNum} onChange={e => setPNum(e.target.value)} placeholder="7" />
              <Input label="학년반" value={pOrg} onChange={e => setPOrg(e.target.value)} placeholder="2-3" />
            </div>
            <label className="flex items-center gap-2 mb-4 px-1 cursor-pointer">
              <input 
                type="checkbox" 
                checked={pIsSetter} 
                onChange={e => setPIsSetter(e.target.checked)}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-sm lg:text-xs font-bold text-slate-400">세터 (S)</span>
            </label>
            <Button variant="primary" className="w-full" onClick={addPlayer} icon={UserPlus}>선수 등록</Button>
          </Card>

          <Card title="📊 구글 시트로 명단 관리">
            <div className="space-y-3">
              <div className="text-base lg:text-sm text-slate-600 bg-emerald-50 border border-emerald-200 p-4 rounded-xl lg:rounded-lg leading-relaxed">
                매치매이커 방식 — 구글 시트에서 직접 명단을 편집/관리합니다.
                <br/>설정 → "GAS Web App URL" 등록 필요.
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="success"
                  size="sm"
                  onClick={async () => {
                    if (!data.gasUrl) { showToast('GAS URL을 먼저 설정하세요'); return; }
                    showToast(`[${team.name}] 시트 준비 중...`);
                    const res = await gasCreateRosterTemplate(data.gasUrl, team.name);
                    if (res.ok) {
                      showToast(res.message || '시트 준비됨');
                      if (res.sheetUrl) window.open(res.sheetUrl, '_blank');
                    } else {
                      showToast('실패: ' + res.error);
                    }
                  }}
                >
                  📋 명단 시트 만들기
                </Button>
                <Button 
                  variant="primary" 
                  size="sm" 
                  onClick={async () => {
                    if (!data.gasUrl) { showToast('GAS URL을 먼저 설정하세요'); return; }
                    showToast(`[${team.name}] 시트에서 불러오는 중...`);
                    const res = await gasLoadRoster(data.gasUrl, team.name);
                    if (!res.ok) { showToast('실패: ' + res.error); return; }
                    const loadedPlayers = res.players || [];
                    if (loadedPlayers.length === 0) {
                      showToast('시트에 등록된 선수가 없습니다');
                      return;
                    }
                    const newPlayers: Player[] = loadedPlayers.map((p: any) => ({
                      id: generateId(),
                      name: p.name,
                      number: p.number || '-',
                      org: p.org || '',
                      teamId: team.id,
                      isSetter: !!p.isSetter,
                    }));
                    setData(prev => ({
                      ...prev,
                      teams: prev.teams.map(t =>
                        t.id === team.id ? { ...t, players: newPlayers } : t
                      ),
                    }));
                    showToast(`${newPlayers.length}명 불러옴`);
                  }}
                >
                  ⬇️ 시트에서 불러오기
                </Button>
              </div>

              <Button 
                variant="outline" 
                size="sm" 
                className="w-full"
                onClick={async () => {
                  if (!data.gasUrl) { showToast('GAS URL을 먼저 설정하세요'); return; }
                  showToast(`[${team.name}] 시트에 저장 중...`);
                  const playersPayload = (team.players ?? []).map(p => ({
                    org: p.org || '',
                    number: p.number,
                    name: p.name,
                    isSetter: !!p.isSetter,
                  }));
                  const res = await gasSaveRoster(data.gasUrl, team.name, playersPayload);
                  if (res.ok) showToast(`${res.saved}명을 [${team.name}] 시트에 저장됨`);
                  else showToast('실패: ' + res.error);
                }}
              >
                ⬆️ 현재 명단을 시트에 저장
              </Button>
            </div>
          </Card>

          <Card title="📥 CSV로 일괄 등록 (오프라인용)">
            <div className="space-y-3">
              <div className="text-base lg:text-sm text-slate-600 bg-slate-100 p-4 rounded-xl lg:rounded-lg leading-relaxed">
                인터넷이 안 될 때 CSV 파일로 명단을 추가할 수 있습니다.
                <br/>컬럼: <span className="font-mono text-slate-700">이름, 번호, 학년반, 세터(Y/N)</span>
              </div>

              <label className="flex items-center gap-2 px-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceMode}
                  onChange={e => setReplaceMode(e.target.checked)}
                  className="w-4 h-4 accent-red-600"
                />
                <span className="text-sm lg:text-xs font-bold text-slate-400">
                  기존 명단 삭제 후 새로 등록
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={downloadCSVTemplate}>
                  📄 양식 다운로드
                </Button>
                <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
                  📤 CSV 업로드
                </Button>
              </div>

              {(team.players?.length ?? 0) > 0 && (
                <Button variant="outline" size="sm" className="w-full" onClick={exportRoster}>
                  💾 현재 명단 CSV로 저장
                </Button>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCSVUpload}
                className="hidden"
              />
            </div>
          </Card>

          <div className="space-y-3">
            <h2 className="text-base lg:text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">선수 명단 ({(team.players?.length ?? 0)}명)</h2>
            {(team.players?.length ?? 0) === 0 ? (
              <div className="text-center py-8 text-slate-600 text-base lg:text-sm italic">등록된 선수가 없습니다.</div>
            ) : (
              (team.players ?? []).map(player => (
                <div key={player.id} className="flex items-center justify-between bg-white border border-slate-200 p-4 lg:p-3 rounded-xl lg:rounded-2xl group hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center font-bold text-orange-600 relative">
                      {player.number}
                      {player.isSetter && (
                        <div className="absolute -top-1 -right-1 text-[10px] lg:text-[8px] font-black bg-purple-600 text-white px-1 rounded">S</div>
                      )}
                    </div>
                    <div>
                      <div className="font-black text-lg lg:text-base text-slate-900">{player.name}</div>
                      <div className="text-sm lg:text-[10px] text-slate-500 font-medium">{player.org || '소속 없음'}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 items-center">
                    <button 
                      onClick={() => toggleSetter(player.id)}
                      className={cn(
                        "text-xs lg:text-[10px] font-bold px-2.5 py-1.5 lg:py-1 rounded-md border transition-all",
                        player.isSetter 
                          ? "bg-purple-100 border-purple-400 text-purple-700"
                          : "bg-transparent border-transparent text-slate-300 hover:bg-purple-50 hover:border-purple-200 hover:text-purple-500"
                      )}
                      title={player.isSetter ? "세터 해제" : "세터로 지정"}
                    >
                      {player.isSetter ? '세터' : '+ 세터'}
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => deletePlayer(player.id)} className="text-red-500 hover:bg-red-500/10">
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </main>
      </div>
    );
  };

  const GameSetupView = () => {
    // App 레벨 상태 사용(리마운트돼도 선택 유지). 팀은 미선택 시 기본값으로 폴백.
    const tA = gsTeamA || data.teams[0]?.id || '';
    const setTA = setGsTeamA;
    const tB = gsTeamB || data.teams[1]?.id || '';
    const setTB = setGsTeamB;
    const target = gsTarget, setTarget = setGsTarget;
    const courtN = gsCourtN, setCourtN = setGsCourtN;
    const maxSets = gsMaxSets, setMaxSets = setGsMaxSets;

    const start = () => {
      if (tA === tB) {
        alert('서로 다른 팀을 선택해주세요.');
        return;
      }
      const newGame: Game = {
        id: generateId(),
        date: format(new Date(), 'yyyy-MM-dd HH:mm'),
        teamAId: tA,
        teamBId: tB,
        mode: 'single',
        format: `${courtN}인제`,
        courtN,
        setTarget: target,
        deuceGap: 2,
        deadPoint: target + 5,
        maxSets,
        sets: [createNewSet(1)],
        winnerTeamId: null,
      };
      setData(prev => ({ ...prev, games: [...prev.games, newGame] }));
      setCurrentGameId(newGame.id);
      navigate('game-court', { setId: 0 });
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center gap-4 border-b border-slate-900">
          <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
          <h1 className="text-xl font-black tracking-tight">경기 <span className="text-orange-600">설정</span></h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          <div className="max-w-4xl mx-auto space-y-6 pb-6">
          <div className="grid grid-cols-1 gap-6">
            <Card title="팀 선택">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm lg:text-xs font-bold text-slate-500 ml-1">TEAM A (홈)</label>
                  <select 
                    value={tA} 
                    onChange={e => setTA(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base lg:text-sm text-white focus:outline-none"
                  >
                    {data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-center">
                  <div className="text-sm lg:text-xs font-black text-slate-700 italic">VS</div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm lg:text-xs font-bold text-slate-500 ml-1">TEAM B (어웨이)</label>
                  <select 
                    value={tB} 
                    onChange={e => setTB(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base lg:text-sm text-white focus:outline-none"
                  >
                    {data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </Card>

            <Card title="규칙 설정">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm lg:text-xs font-bold text-slate-500 ml-1">인원수</label>
                  <div className="flex gap-2">
                    {[6, 9].map(n => (
                      <button 
                        key={n}
                        onClick={() => setCourtN(n)}
                        className={cn(
                          "flex-1 py-3 lg:py-2.5 rounded-xl text-base lg:text-sm font-bold transition-all",
                          courtN === n ? "bg-orange-600 text-white" : "bg-slate-800 text-slate-400"
                        )}
                      >
                        {n}인
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm lg:text-xs font-bold text-slate-500 ml-1">목표 점수</label>
                  <select 
                    value={target} 
                    onChange={e => setTarget(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-base lg:text-sm text-white focus:outline-none"
                  >
                    {[15, 21, 25].map(n => <option key={n} value={n}>{n}점</option>)}
                  </select>
                </div>
              </div>

              {/* 경기 방식 */}
              <div className="mt-4 space-y-1.5">
                <label className="text-sm lg:text-xs font-bold text-slate-500 ml-1">경기 방식</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 1, label: '단판', desc: '1세트' },
                    { val: 3, label: '3전 2선승', desc: '먼저 2세트' },
                    { val: 5, label: '5전 3선승', desc: '먼저 3세트' },
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => setMaxSets(opt.val)}
                      className={cn(
                        "py-3 lg:py-2.5 rounded-xl text-base lg:text-sm font-bold transition-all border",
                        maxSets === opt.val
                          ? "bg-orange-600 text-white border-orange-600" 
                          : "bg-white text-slate-600 border-slate-300 hover:border-orange-300"
                      )}
                    >
                      <div>{opt.label}</div>
                      <div className="text-[11px] lg:text-[9px] font-normal opacity-80 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>
          </div>
        </main>

        <footer className="p-6 bg-slate-950 border-t border-slate-900">
          <Button variant="primary" size="lg" className="w-full" onClick={start} icon={ChevronRight}>
            코트 편성하기
          </Button>
        </footer>
      </div>
    );
  };

  const CourtSetupView = () => {
    const setId = params.setId;
    const game = currentGame;
    if (!game) return null;

    const teamA = data.teams.find(t => t.id === game.teamAId);
    const teamB = data.teams.find(t => t.id === game.teamBId);
    const set = game.sets[setId];
    if (!set) return null; // 세트 인덱스가 비정상(빈 sets 등)이면 흰 화면 대신 안전 종료

    const togglePlayer = (team: 'A' | 'B', pid: string) => {
      const key = team === 'A' ? 'courtA' : 'courtB';
      const current = set[key];
      let next;
      if (current.includes(pid)) {
        next = current.filter(id => id !== pid);
      } else {
        if (current.length >= game.courtN) return;
        next = [...current, pid];
      }
      
      const updatedSet = { ...set, [key]: next };
      setData(prev => ({
        ...prev,
        games: prev.games.map(g =>
          g.id === game.id
            ? { ...g, sets: g.sets.map((s, i) => i === setId ? updatedSet : s) }
            : g
        ),
      }));
    };

    const startMatch = () => {
      if (set.courtA.length < game.courtN || set.courtB.length < game.courtN) {
        alert(`각 팀당 ${game.courtN}명의 선수를 선택해야 합니다.`);
        return;
      }
      navigate('game-record', { setId });
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center gap-4 border-b border-slate-900">
          <Button variant="ghost" size="sm" onClick={() => navigate('game-setup')} icon={ChevronLeft} />
          <h1 className="text-xl font-black tracking-tight">코트 <span className="text-orange-600">편성</span></h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
          <div className="max-w-4xl mx-auto space-y-6 pb-6">
          <div className="bg-orange-600/10 border border-orange-600/20 p-3 rounded-2xl text-[11px] text-orange-500 font-bold text-center">
            선택 순서가 서브 오더(로테이션)가 됩니다.
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { team: 'A' as const, data: teamA, key: 'courtA' as const, color: 'text-orange-500', bg: 'bg-orange-600' },
              { team: 'B' as const, data: teamB, key: 'courtB' as const, color: 'text-blue-500', bg: 'bg-blue-600' }
            ].map(t => (
              <div key={t.team} className="flex flex-col space-y-3">
                <div className="flex justify-between items-center px-1">
                  <h3 className={cn("text-xs font-black uppercase tracking-widest", t.color)}>{t.data?.name}</h3>
                  <span className="text-[10px] font-bold text-slate-500">{set[t.key].length}/{game.courtN}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {(t.data?.players ?? []).map(player => {
                    const idx = set[t.key].indexOf(player.id);
                    const isSelected = idx !== -1;
                    return (
                      <button 
                        key={player.id}
                        onClick={() => togglePlayer(t.team, player.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                          isSelected ? `border-slate-600 bg-slate-800` : "border-slate-800 bg-slate-900/30 opacity-60"
                        )}
                      >
                        <div className={cn(
                          "w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black",
                          isSelected ? t.bg + " text-white" : "bg-slate-700 text-slate-400"
                        )}>
                          {isSelected ? idx + 1 : player.number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold truncate">{player.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          </div>
        </main>

        <footer className="shrink-0 sticky bottom-0 z-10 p-4 lg:p-6 bg-slate-950 border-t border-slate-900" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <Button variant="primary" size="lg" className="w-full" onClick={startMatch} icon={Play}>
            경기 시작 ({set.courtA.length}/{game.courtN} · {set.courtB.length}/{game.courtN})
          </Button>
        </footer>
      </div>
    );
  };

  const GameRecordView = () => {
    const setId = params.setId ?? 0;
    const game = currentGame;
    if (!game) return null;

    const set = game.sets[setId];
    if (!set) return null; // 세트 인덱스가 비정상(빈 sets 등)이면 흰 화면 대신 안전 종료
    const teamA = data.teams.find(t => t.id === game.teamAId);
    const teamB = data.teams.find(t => t.id === game.teamBId);

    const { recordAction, undoLastScore, adjustStat, rotateServer, substitute } = useGameLogic({
      data,
      setData,
      currentGame: game,
      currentSetIdx: setId,
      sessionId: session.sessionId,
      // collab + 쓰기가능(읽기전용 아님)일 때만 RTDB 경로단위 쓰기.
      cloudWrite: session.mode === 'collab' && !readOnly,
    });

    // 모바일: 한 팀만 선택해 기록 (기기별 로컬 상태). 데스크톱은 양팀 모두 표시.
    const [mobileTeam, setMobileTeam] = useState<'A' | 'B'>(
      () => ((localStorage.getItem('spike_mobile_team') as 'A' | 'B') || 'A')
    );
    const pickMobileTeam = (t: 'A' | 'B') => { setMobileTeam(t); localStorage.setItem('spike_mobile_team', t); };

    // 경기 설정 모달 open 상태·핸들러·모달 렌더는 App 레벨로 hoist됨(리마운트 견딤).

    // Role-based filtering: students see only their assigned action buttons.
    // Teacher sees everything.
    const role: EvaluatorRole = (new URLSearchParams(window.location.search).get('role') as EvaluatorRole) || 'teacher';
    const allowedCategories: ActionCategory[] = 
      role === 'teacher' ? ['serve', 'attack', 'defense', 'setter', 'block', 'error']
      : role === 'serve'   ? ['serve']
      : role === 'attack'  ? ['attack', 'block']
      : role === 'defense' ? ['defense']
      : role === 'setter'  ? ['setter']
      : role === 'error'   ? ['error']
      : [];

    // Modal state: tap player → choose category → choose outcome
    const [pendingAction, setPendingAction] = useState<{
      playerId: string;
      team: 'A' | 'B';
      category?: ActionCategory;
    } | null>(null);

    // For attack success: prompt for assisting setter
    const [pendingAssist, setPendingAssist] = useState<{
      playerId: string;
      team: 'A' | 'B';
      outcomeKey: keyof PlayerStats;
    } | null>(null);

    // Substitution flow: can start from bench (pick court) or court (pick bench)
    const [pendingSub, setPendingSub] = useState<{
      benchId?: string;     // start from bench: this player is going IN
      courtId?: string;     // start from court: this player is going OUT
      team: 'A' | 'B';
    } | null>(null);

    const handlePlayerTap = (team: 'A' | 'B', playerId: string) => {
      if (readOnly) return;
      // If only one category allowed, skip the picker
      if (allowedCategories.length === 1) {
        setPendingAction({ playerId, team, category: allowedCategories[0] });
      } else {
        setPendingAction({ playerId, team });
      }
    };

    const handleOutcomeSelect = (outcomeKey: keyof PlayerStats) => {
      if (!pendingAction || !pendingAction.category) return;
      
      // If attack success, ask which setter assisted (skip if no setters)
      if (outcomeKey === 'spikeSuccess') {
        const myTeam = pendingAction.team === 'A' ? teamA : teamB;
        const setters = (myTeam?.players ?? []).filter(p => p.isSetter) ?? [];
        if (setters.length > 0) {
          setPendingAssist({
            playerId: pendingAction.playerId,
            team: pendingAction.team,
            outcomeKey,
          });
          setPendingAction(null);
          return;
        }
      }
      
      recordAction(pendingAction.playerId, pendingAction.category, outcomeKey);
      setPendingAction(null);
      showToast('기록됨');
    };

    const handleAssistSelect = (setterId: string | null) => {
      if (!pendingAssist) return;
      recordAction(
        pendingAssist.playerId, 
        'attack', 
        pendingAssist.outcomeKey, 
        setterId ?? undefined
      );
      setPendingAssist(null);
      showToast('기록됨');
    };

    // ── 세트 종료 / 다음 세트 (3전2선승·5전3선승 지원) ──────────────────
    const maxSets = game.maxSets ?? 1;
    const setsToWin = Math.ceil(maxSets / 2);
    // 현재 세트까지의 (잠정) 세트 승수 — 현재 세트의 라이브 점수 반영
    const setWinsA = game.sets.slice(0, setId + 1).filter(s => s.scoreA > s.scoreB).length;
    const setWinsB = game.sets.slice(0, setId + 1).filter(s => s.scoreB > s.scoreA).length;
    const matchDecided =
      setWinsA >= setsToWin || setWinsB >= setsToWin || setId + 1 >= maxSets;

    const endCurrentSet = () => {
      const cur = game.sets[setId];
      if (cur.scoreA === cur.scoreB) {
        showToast('세트가 동점입니다 — 승부를 낸 뒤 종료하세요');
        return;
      }
      if (matchDecided) {
        // 경기 결과(대시보드)로 — 거기서 "저장 후 종료"
        navigate('dashboard', { gameId: game.id });
        return;
      }
      // 다음 세트 생성: 직전 세트의 코트 라인업을 그대로 이어감 (교체로 조정 가능)
      const nextIdx = setId + 1;
      const prevSet = game.sets[setId];
      const nextSet: GameSet = {
        number: nextIdx + 1,
        scoreA: 0,
        scoreB: 0,
        courtA: [...prevSet.courtA],
        courtB: [...prevSet.courtB],
        serverIdxA: 0,
        serverIdxB: 0,
        servingTeam: 'A',
        playerStats: {},
        scoreEvents: [],
      };
      setData(prev => ({
        ...prev,
        games: prev.games.map(g =>
          g.id === game.id
            ? { ...g, sets: [...g.sets.slice(0, nextIdx), nextSet] }
            : g
        ),
      }));
      navigate('game-record', { setId: nextIdx });
      showToast(`${nextIdx + 1}세트 시작`);
    };

    // Build cumulative score tower data (each scoring event lights a number box)
    // Tower 1: 1-10, Tower 2: 11-20, Tower 3: 21-30
    const buildScoreSequence = (team: 'A' | 'B'): number[] => {
      return readScoreEvents(set.scoreEvents)
        .filter(e => e.team === team)
        .map((_, i) => i + 1); // points 1, 2, 3, ...
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50 overflow-hidden">
        {/* Top header bar — 모바일은 아이콘 위주로 컴팩트, 데스크톱은 라벨 표시 */}
        <header className="relative bg-white px-3 lg:px-4 py-2.5 lg:py-3 border-b border-slate-200 shadow-sm z-10 flex items-center justify-between gap-2">
          <button
            onClick={() => navigate('home')}
            className="flex items-center gap-2 px-2.5 lg:px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-base font-bold transition-colors border border-slate-200 shrink-0"
            title="진행 상태 유지하며 홈으로"
          >
            <ChevronLeft size={18} />
            <span className="hidden lg:inline">일시중단</span>
          </button>
          {/* 상태 칩 묶음 — 모바일·데스크톱 모두 헤더 가로 정중앙 정렬(absolute) */}
          <div className="flex items-center gap-1.5 min-w-0 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <RoleBadge role={role} />
            <div className="text-xs lg:text-sm font-black text-slate-600 uppercase tracking-wider bg-slate-100 px-2 lg:px-3 py-1 lg:py-1.5 rounded-lg whitespace-nowrap">SET {setId + 1}</div>
            {/* 인원수는 courtN에서 파생 — 경기설정으로 9인제 바꿔도 항상 일치 */}
            <div className="text-xs lg:text-sm font-black text-orange-600 uppercase tracking-wider bg-orange-50 px-2 lg:px-3 py-1 lg:py-1.5 rounded-lg whitespace-nowrap">{game.courtN ?? 6}인제</div>
          </div>
          <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
            <button
              onClick={() => navigate('dashboard', { gameId: game.id })}
              className="flex items-center gap-2 px-2.5 lg:px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-base font-bold transition-colors border border-slate-200"
              title="현재까지 기록·통계 보기"
            >
              <History size={18} />
              <span className="hidden lg:inline">기록</span>
            </button>
            <button
              onClick={() => navigate('dashboard', { gameId: game.id })}
              disabled={readOnly}
              className="flex items-center gap-2 px-3 lg:px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm lg:text-base font-black transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              <span className="hidden sm:inline">경기 종료</span>
            </button>
          </div>
        </header>

        {/* 스코어보드 — 헤더 아래 고정(스크롤돼도 항상 보임) */}
        <div className="shrink-0 px-4 pt-4">
          <ScoreboardCard game={game} currentSet={set} teamA={teamA} teamB={teamB}
            setNav={(!readOnly && role === 'teacher' && maxSets > 1) ? {
              canPrev: setId > 0,
              onPrev: () => navigate('game-record', { setId: setId - 1 }),
              onNext: endCurrentSet,
              nextShort: matchDecided ? '결과' : `${setId + 2}세트`,
              nextTitle: matchDecided ? '세트 종료 · 결과 보기' : `세트 종료 · ${setId + 2}세트로`,
            } : undefined}
          />
        </div>

        {/* 본문: 데스크톱 3열 / 모바일 1열. 명단은 컬럼 내부 스크롤 → 스코어보드·하단바 항상 보임 */}
        <main className="flex-1 overflow-hidden p-4 pt-3">
          <div className="flex flex-col lg:flex-row gap-4 h-full">
            {/* 모바일 팀 토글 */}
            <div className="lg:hidden shrink-0">
              <div className="grid grid-cols-2 gap-2 bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm">
                {([['A', teamA?.name], ['B', teamB?.name]] as Array<['A' | 'B', string | undefined]>).map(([t, name]) => (
                  <button
                    key={t}
                    onClick={() => pickMobileTeam(t)}
                    className={cn(
                      'py-2.5 rounded-xl font-black text-sm transition-all',
                      mobileTeam === t ? (t === 'A' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {name || (t === 'A' ? '홈' : '어웨이')}
                  </button>
                ))}
              </div>
            </div>

            {/* Team A (컬럼 내부 스크롤) */}
            <div className={cn('min-h-0 overflow-y-auto lg:flex-1 lg:block', mobileTeam === 'A' ? 'flex-1' : 'hidden')}>
              <CourtPlayers
                team="A"
                teamName={teamA?.name ?? ''}
                players={teamA?.players ?? []}
                courtIds={set.courtA}
                serverIdx={set.serverIdxA}
                isServing={set.servingTeam === 'A'}
                stats={set.playerStats ?? {}}
                onTap={(pid) => handlePlayerTap('A', pid)}
                onBenchTap={(pid) => setPendingSub({ benchId: pid, team: 'A' })}
                disabled={readOnly}
                benchOpen={benchOpenA}
                onToggleBench={() => setBenchOpenA(o => !o)}
              />
            </div>

            {/* Center 득점 타워 + 컨트롤 — 데스크톱만, 항상 보임 (레퍼런스: 타워 아래 컨트롤) */}
            <div className="hidden lg:flex lg:w-[240px] shrink-0 flex-col min-h-0 gap-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-2 flex-1 min-h-0 overflow-hidden flex items-stretch justify-center shadow-sm">
                <ScoreTowerVertical scoreEvents={set.scoreEvents ?? []} teamA={teamA} teamB={teamB} />
              </div>
              {!readOnly && role === 'teacher' && (
                <div className="shrink-0 flex flex-col gap-1.5">
                  <button onClick={undoLastScore} className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-xl bg-white border-2 border-orange-300 hover:bg-orange-50 text-orange-700 font-bold text-sm transition-colors whitespace-nowrap">
                    <RotateCcw size={15} /> 득점 취소
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => rotateServer(set.servingTeam, -1)} className="flex items-center justify-center gap-1 px-2 py-2 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors whitespace-nowrap"><ChevronLeft size={15} /> 이전</button>
                    <button onClick={() => rotateServer(set.servingTeam, 1)} className="flex items-center justify-center gap-1 px-2 py-2 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors whitespace-nowrap">다음 <ChevronRight size={15} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={() => navigate('game-court', { setId })} className="flex items-center justify-center gap-1 px-2 py-2 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors whitespace-nowrap" title="코트 선수·서브 오더 다시 편성">
                      <Users size={15} /> 코트편성
                    </button>
                    <button onClick={() => setShowSettings(true)} className="flex items-center justify-center gap-1 px-2 py-2 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors whitespace-nowrap" title="인원수·세트수·목표점수 변경">
                      <Settings size={15} /> 경기설정
                    </button>
                  </div>
                  {/* 세트 종료(다음 세트)는 스코어보드 SET 박스 좌우 화살표로 이동 */}
                </div>
              )}
            </div>

            {/* Team B (컬럼 내부 스크롤) */}
            <div className={cn('min-h-0 overflow-y-auto lg:flex-1 lg:block', mobileTeam === 'B' ? 'flex-1' : 'hidden')}>
              <CourtPlayers
                team="B"
                teamName={teamB?.name ?? ''}
                players={teamB?.players ?? []}
                courtIds={set.courtB}
                serverIdx={set.serverIdxB}
                isServing={set.servingTeam === 'B'}
                stats={set.playerStats ?? {}}
                onTap={(pid) => handlePlayerTap('B', pid)}
                onBenchTap={(pid) => setPendingSub({ benchId: pid, team: 'B' })}
                disabled={readOnly}
                benchOpen={benchOpenB}
                onToggleBench={() => setBenchOpenB(o => !o)}
              />
            </div>
          </div>
        </main>

        {/* 하단 컨트롤 바 — 모바일 전용 (데스크톱은 가운데 컬럼에 표시) */}
        {!readOnly && role === 'teacher' && (
          <footer className="lg:hidden shrink-0 bg-white border-t border-slate-200 px-3 py-2.5">
            {/* 문서앱 툴바 스타일 — 모든 아이콘 버튼 동일 크기(11x11), 세트종료만 색+라벨로 구분 */}
            <div className="flex items-center gap-1.5">
              <button onClick={undoLastScore} title="득점 취소(되돌리기)" className="flex items-center justify-center w-11 h-11 rounded-xl bg-white border-2 border-orange-300 hover:bg-orange-50 text-orange-700 transition-colors">
                <RotateCcw size={18} />
              </button>
              <button onClick={() => rotateServer(set.servingTeam, -1)} title="이전(로테이션)" className="flex items-center justify-center w-11 h-11 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors">
                <ChevronLeft size={22} />
              </button>
              <button onClick={() => rotateServer(set.servingTeam, 1)} title="다음(로테이션)" className="flex items-center justify-center w-11 h-11 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors">
                <ChevronRight size={22} />
              </button>
              <div className="flex-1" />
              <button onClick={() => navigate('game-court', { setId })} title="코트 재편성 — 선수·서브 오더 다시 편성" className="flex items-center justify-center w-11 h-11 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-500 transition-colors">
                <Users size={18} />
              </button>
              <button onClick={() => setShowSettings(true)} title="경기 설정 — 인원수·세트수·목표점수 변경" className="flex items-center justify-center w-11 h-11 rounded-xl bg-white border-2 border-slate-300 hover:bg-slate-50 text-slate-500 transition-colors">
                <Settings size={18} />
              </button>
              {maxSets > 1 && (
                <button onClick={endCurrentSet} title={matchDecided ? '세트 종료 · 결과 보기' : `세트 종료 · ${setId + 2}세트로`} className="flex items-center gap-1 h-11 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-colors shadow-md whitespace-nowrap">
                  <CheckCircle2 size={16} /> {matchDecided ? '결과 →' : `${setId + 2}세트 →`}
                </button>
              )}
            </div>
          </footer>
        )}

        {/* 경기 설정 모달은 App 레벨에서 렌더(리마운트로 인한 깜빡임 방지) */}

        {/* Category picker modal — adds Substitution option for teacher */}
        {pendingAction && !pendingAction.category && (
          <CategoryPicker
            allowedCategories={allowedCategories}
            showSubstitute={role === 'teacher' && !readOnly}
            onPick={(cat) => setPendingAction({ ...pendingAction, category: cat })}
            onSubstitute={() => {
              // Switch to substitution mode: pick a bench player
              setPendingSub({ 
                courtId: pendingAction.playerId, 
                team: pendingAction.team 
              });
              setPendingAction(null);
            }}
            onCancel={() => setPendingAction(null)}
          />
        )}

        {/* Outcome picker modal */}
        {pendingAction && pendingAction.category && (
          <OutcomePicker
            category={pendingAction.category}
            playerLabel={getPlayerLabel(pendingAction.playerId, [teamA, teamB])}
            onPick={handleOutcomeSelect}
            onCancel={() => setPendingAction(null)}
          />
        )}

        {/* Assist picker modal (after attack success) */}
        {pendingAssist && (
          <AssistPicker
            setters={((pendingAssist.team === 'A' ? teamA : teamB)?.players ?? []).filter(p => p.isSetter)}
            onPick={handleAssistSelect}
            onSkip={() => handleAssistSelect(null)}
          />
        )}

        {/* Substitution picker — handles both directions */}
        {pendingSub && (() => {
          const teamObj = pendingSub.team === 'A' ? teamA : teamB;
          const courtList = pendingSub.team === 'A' ? set.courtA : set.courtB;
          const mode: 'fromBench' | 'fromCourt' = pendingSub.benchId ? 'fromBench' : 'fromCourt';
          const fixedId = pendingSub.benchId ?? pendingSub.courtId ?? '';
          const fixedPlayer = (teamObj?.players ?? []).find(p => p.id === fixedId);
          const candidates = mode === 'fromBench'
            ? (teamObj?.players ?? []).filter(p => courtList.includes(p.id))
            : (teamObj?.players ?? []).filter(p => !courtList.includes(p.id));

          return (
            <SubstitutionPicker
              mode={mode}
              fixedPlayer={fixedPlayer}
              candidates={candidates}
              onPick={(targetId) => {
                if (mode === 'fromBench') {
                  // bench → in, court target → out
                  substitute(pendingSub.team, targetId, pendingSub.benchId!);
                } else {
                  // court → out, bench target → in
                  substitute(pendingSub.team, pendingSub.courtId!, targetId);
                }
                setPendingSub(null);
                showToast('교체 완료');
              }}
              onCancel={() => setPendingSub(null)}
            />
          );
        })()}
      </div>
    );
  };

  const DashboardView = () => {
    const game = currentGame;
    if (!game) return null;

    const teamA = data.teams.find(t => t.id === game.teamAId);
    const teamB = data.teams.find(t => t.id === game.teamBId);

    const saveAndExit = async () => {
      // Mark game as ended
      const endedAt = new Date().toISOString();
      const sets = game.sets;
      // Determine winner by sets won
      let aWins = 0, bWins = 0;
      sets.forEach(s => { if (s.scoreA > s.scoreB) aWins++; else if (s.scoreB > s.scoreA) bWins++; });
      const winnerTeamId = aWins > bWins ? game.teamAId : bWins > aWins ? game.teamBId : null;
      
      setData(prev => ({
        ...prev,
        games: prev.games.map(g =>
          g.id === game.id ? { ...g, endedAt, winnerTeamId } : g
        ),
      }));

      // If GAS URL configured, push this game's stats to the sheet.
      if (data.gasUrl) {
        showToast('시트에 저장 중...');
        const finalGame = { ...game, endedAt, winnerTeamId };
        const res = await gasSaveGame(data.gasUrl, finalGame, data);
        if (res.ok) {
          showToast(`시트 저장 완료 (세트 ${res.gameRows}, 선수 기록 ${res.statRows}건)`);
        } else {
          showToast('시트 저장 실패: ' + res.error);
        }
      }
      navigate('home');
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center justify-between border-b border-slate-900">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
            <h1 className="text-xl font-black tracking-tight">경기 <span className="text-orange-600">결과</span></h1>
          </div>
          <Button variant="primary" size="sm" onClick={saveAndExit} icon={CheckCircle2}>저장 후 종료</Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          {(() => {
            const isMulti = (game.maxSets ?? 1) > 1;
            const setWinsA = game.sets.filter(s => s.scoreA > s.scoreB).length;
            const setWinsB = game.sets.filter(s => s.scoreB > s.scoreA).length;
            return (
              <Card className="bg-slate-900/80">
                <div className="text-center space-y-4">
                  <div className="text-xs lg:text-[10px] font-black text-slate-500 uppercase tracking-widest">{game.date}</div>
                  <div className="flex items-center justify-center gap-8">
                    <div className="text-center">
                      <div className="text-base lg:text-sm font-bold text-slate-400 mb-1">{teamA?.name}</div>
                      <div className="text-4xl font-black text-orange-500">{isMulti ? setWinsA : game.sets[0].scoreA}</div>
                    </div>
                    <div className="text-2xl font-black text-slate-800 italic">VS</div>
                    <div className="text-center">
                      <div className="text-base lg:text-sm font-bold text-slate-400 mb-1">{teamB?.name}</div>
                      <div className="text-4xl font-black text-blue-500">{isMulti ? setWinsB : game.sets[0].scoreB}</div>
                    </div>
                  </div>
                  {isMulti && (
                    <div className="flex justify-center gap-4 pt-1">
                      {game.sets.map((s, i) => (
                        <div key={i} className="text-center">
                          <div className="text-xs lg:text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">SET {i + 1}</div>
                          <div className="text-base lg:text-sm font-mono font-bold">
                            <span className={s.scoreA > s.scoreB ? "text-orange-400" : "text-slate-500"}>{s.scoreA}</span>
                            <span className="text-slate-600 mx-1">:</span>
                            <span className={s.scoreB > s.scoreA ? "text-blue-400" : "text-slate-500"}>{s.scoreB}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            );
          })()}

          <section className="space-y-4">
            <h2 className="text-base lg:text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">선수별 통계 {(game.maxSets ?? 1) > 1 ? '(전체 세트)' : '(1세트)'}</h2>
            <div className="space-y-2">
              {[...(teamA?.players ?? []), ...(teamB?.players ?? [])].map(p => {
                const stats = aggregatePlayerStatsInGame(game, p.id);
                if (!Object.values(stats).some(v => v > 0)) return null;
                const rates = deriveRates(stats);
                const team = (teamA?.players ?? []).includes(p) ? 'A' : 'B';
                return (
                  <div key={p.id} className="bg-slate-900/30 p-4 lg:p-3 rounded-xl border border-slate-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          team === 'A' ? "bg-orange-500" : "bg-blue-500"
                        )} />
                        <span className="text-sm lg:text-xs font-bold text-slate-300">{p.number} {p.name}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs lg:text-[10px]">
                      <StatPill label="서브" value={`${(stats.serveAce + stats.serveOk)}/${rates.serveTotal}`} pct={rates.servePct} />
                      <StatPill label="공격" value={`${stats.spikeSuccess}/${rates.spikeTotal}`} pct={rates.spikePct} />
                      <StatPill label="토스" value={`${stats.setSuccess + stats.setAssist}/${rates.setTotal}`} pct={rates.setEffective} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    );
  };

  // ── 대회 만들기 화면 ─────────────────────────────────────────────
  const EventSetupView = () => {
    const [name, setName] = useState('');
    const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
    const [rounds, setRounds] = useState(1);

    const toggleTeam = (id: string) => {
      setSelectedTeamIds(prev => 
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    };

    const createEvent = () => {
      if (!name.trim()) {
        showToast('대회 이름을 입력하세요');
        return;
      }
      if (selectedTeamIds.length < 2) {
        showToast('최소 2팀 이상 선택해야 합니다');
        return;
      }
      const matches = generateRoundRobinSchedule(selectedTeamIds, rounds);
      const newEvent: VBEvent = {
        id: `event_${Date.now()}`,
        name: name.trim(),
        type: 'roundrobin',
        teamIds: selectedTeamIds,
        rounds,
        matches,
        createdAt: new Date().toISOString(),
        endedAt: null,
      };
      setData(prev => ({ ...prev, events: [...prev.events, newEvent] }));
      setCurrentEventId(newEvent.id);
      showToast(`대회 생성됨 (총 ${matches.length}경기)`);
      navigate('event-detail');
    };

    // Preview match count
    const previewMatches = selectedTeamIds.length >= 2
      ? generateRoundRobinSchedule(selectedTeamIds, rounds).length
      : 0;

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center gap-4 border-b border-slate-900">
          <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
          <h1 className="text-xl font-black tracking-tight">대회 <span className="text-orange-600">만들기</span></h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          <Card title="대회 정보">
            <Input
              label="대회 이름"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: 2026 1학기 배구 리그"
            />
          </Card>

          <Card title={`참가 팀 선택 (${selectedTeamIds.length}/${data.teams.length})`}>
            <div className="space-y-2">
              {data.teams.length === 0 ? (
                <p className="text-sm lg:text-xs text-slate-500 text-center py-4">등록된 팀이 없습니다</p>
              ) : (
                data.teams.map(t => {
                  const selected = selectedTeamIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTeam(t.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-4 lg:p-3 rounded-xl border transition-all",
                        selected
                          ? "bg-orange-600/10 border-orange-600 text-orange-50"
                          : "bg-slate-900/40 border-slate-800 text-slate-300 hover:border-slate-700"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0",
                        selected ? "bg-orange-600 border-orange-600" : "border-slate-600"
                      )}>
                        {selected && <span className="text-white text-xs font-bold">✓</span>}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="font-bold text-lg lg:text-base truncate">{t.name}</div>
                        <div className="text-sm lg:text-[10px] text-slate-500">{(t.players?.length ?? 0)}명</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          <Card title="라운드 수">
            <div className="flex gap-2">
              {[1, 2, 3, 4].map(r => (
                <button
                  key={r}
                  onClick={() => setRounds(r)}
                  className={cn(
                    "flex-1 py-3.5 lg:py-3 rounded-xl text-base lg:text-sm font-bold transition-all",
                    rounds === r ? "bg-orange-600 text-white" : "bg-slate-800 text-slate-400"
                  )}
                >
                  {r}바퀴
                </button>
              ))}
            </div>
            <p className="text-sm lg:text-[10px] text-slate-500 mt-2 leading-relaxed">
              풀리그: 모든 팀이 한 번씩 대결.<br/>
              2바퀴 = 모든 팀과 두 번씩 (홈/어웨이 개념).<br/>
              진행 중에도 라운드를 더 추가할 수 있습니다.
            </p>
          </Card>

          {previewMatches > 0 && (
            <Card>
              <div className="text-center">
                <div className="text-xs lg:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">예상 경기 수</div>
                <div className="text-3xl font-black text-orange-500 font-mono">{previewMatches}</div>
                <div className="text-sm lg:text-[10px] text-slate-500 mt-1">
                  {selectedTeamIds.length}팀 × {rounds}바퀴
                </div>
              </div>
            </Card>
          )}
        </main>

        <footer className="p-6 bg-slate-950 border-t border-slate-900">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={createEvent}
            disabled={!name.trim() || selectedTeamIds.length < 2}
            icon={Trophy}
          >
            대회 생성 ({previewMatches}경기)
          </Button>
        </footer>
      </div>
    );
  };

  // ── 대회 상세 — 순위표 + 일정 + 통계 ─────────────────────────────
  const EventDetailView = () => {
    const event = currentEvent;
    if (!event) return null;

    const tab = eventDetailTab;
    const setTab = setEventDetailTab;
    const standings = computeStandings(event, data.games);
    const progress = eventProgress(event, data.games);

    // ── 개인 기록 집계 (이 대회에 연결된 게임만, 읽기 전용) ──────────────
    const eventGameIds = new Set(
      event.matches.map(m => m.gameId).filter(Boolean) as string[]
    );
    const eventGames = data.games.filter(g => eventGameIds.has(g.id));
    const eventTeams = data.teams.filter(t => event.teamIds.includes(t.id));
    const playerRecords = eventTeams.flatMap(t =>
      (t.players ?? []).map(p => {
        const stats = aggregatePlayerStatsAllGames(eventGames, p.id);
        const rates = deriveRates(stats);
        const contribution = stats.serveAce + stats.spikeSuccess + stats.block;
        const defense = stats.receive + stats.dig;
        const hasRecord = (Object.values(stats) as number[]).some(v => v > 0);
        return { player: p, teamName: t.name, stats, rates, contribution, defense, hasRecord };
      })
    );
    // ── 개인 기록 정렬 (헤더 클릭 → 표시용 정렬, 집계 로직 미접촉) ──────────
    type Rec = (typeof playerRecords)[number];
    const statValue = (r: Rec): number | string => {
      switch (statSort.key) {
        case 'name': return r.player.name;
        case 'serveAce': return r.stats.serveAce;
        case 'serveSuccess': return r.stats.serveOk + r.stats.serveAce;
        case 'servePct': return r.rates.servePct;
        case 'spikeSuccess': return r.stats.spikeSuccess;
        case 'spikePct': return r.rates.spikePct;
        case 'block': return r.stats.block;
        case 'receive': return r.stats.receive;
        case 'dig': return r.stats.dig;
        case 'setAssist': return r.stats.setAssist;
        case 'contribution':
        default: return r.contribution;
      }
    };
    const statTie = (r: Rec): number => {
      switch (statSort.key) {
        case 'serveSuccess':
        case 'servePct': return r.rates.serveTotal;
        case 'spikeSuccess':
        case 'spikePct': return r.rates.spikeTotal;
        case 'contribution': return r.stats.spikeSuccess;
        default: return r.contribution;
      }
    };
    const dirMul = statSort.dir === 'asc' ? 1 : -1;
    const recordedPlayers = playerRecords
      .filter(r => r.hasRecord)
      .sort((a, b) => {
        const va = statValue(a), vb = statValue(b);
        let cmp: number;
        if (typeof va === 'string' || typeof vb === 'string') {
          cmp = String(va).localeCompare(String(vb), 'ko');
        } else {
          cmp = va - vb;
        }
        if (cmp !== 0) return dirMul * cmp;
        const tie = statTie(b) - statTie(a); // 동률 시 시도수 많은 순
        if (tie !== 0) return tie;
        return a.player.name.localeCompare(b.player.name, 'ko');
      });
    const noRecordPlayers = playerRecords.filter(r => !r.hasRecord);

    const toggleStatSort = (k: string, isName = false) => {
      setStatSort(prev => prev.key === k
        ? { key: k, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key: k, dir: isName ? 'asc' : 'desc' });
    };
    const sortTh = (
      label: string,
      k: string,
      opts: { minW?: string; accent?: boolean; name?: boolean } = {},
    ) => {
      const active = statSort.key === k;
      const arrow = active ? (statSort.dir === 'desc' ? ' ▼' : ' ▲') : '';
      return (
        <th
          key={k}
          onClick={() => toggleStatSort(k, opts.name)}
          aria-sort={active ? (statSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
          className={cn(
            'sticky top-0 bg-white shadow-[0_1px_0_0_#e2e8f0] px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap cursor-pointer select-none transition-colors',
            opts.name ? 'left-0 z-30 text-left' : 'z-20 text-right',
            opts.minW,
            active ? 'text-orange-600' : (opts.accent ? 'text-orange-500' : 'hover:text-slate-700'),
          )}
        >
          {label}{arrow}
        </th>
      );
    };

    const startOrResumeMatch = (match: Match) => {
      // If match already has a game, resume it
      if (match.gameId) {
        const existingGame = data.games.find(g => g.id === match.gameId);
        if (existingGame) {
          setCurrentGameId(existingGame.id);
          if (existingGame.endedAt) {
            navigate('dashboard', { gameId: existingGame.id });
          } else {
            const lastIdx = Math.max(0, (existingGame.sets?.length ?? 1) - 1);
            navigate('game-record', { setId: lastIdx });
          }
          return;
        }
      }
      // Create new game from match → CourtSetupView 거쳐서 진행
      const newGame: Game = {
        id: generateId(),
        date: format(new Date(), 'yyyy-MM-dd HH:mm'),
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        mode: 'single',
        format: `6인제`,
        courtN: 6,
        setTarget: 25,
        deuceGap: 2,
        deadPoint: 30,
        sets: [createNewSet(1)],
        winnerTeamId: null,
      };
      setData(prev => ({
        ...prev,
        games: [...prev.games, newGame],
        events: prev.events.map(e => 
          e.id === event.id
            ? { ...e, matches: e.matches.map(m => m.id === match.id ? { ...m, gameId: newGame.id } : m) }
            : e
        ),
      }));
      setCurrentGameId(newGame.id);
      navigate('game-court', { setId: 0 });
    };

    const addOneRound = () => {
      if (!confirm('이 대회에 1라운드를 추가하시겠습니까?\n모든 팀이 한 번씩 더 대결합니다.')) return;
      setData(prev => ({
        ...prev,
        events: prev.events.map(e => e.id === event.id ? addRoundsToEvent(e, 1) : e),
      }));
      showToast('1라운드 추가됨');
    };

    const endEvent = () => {
      if (!confirm('대회를 종료하시겠습니까? 미진행 경기는 그대로 남습니다.')) return;
      setData(prev => ({
        ...prev,
        events: prev.events.map(e => 
          e.id === event.id ? { ...e, endedAt: new Date().toISOString() } : e
        ),
      }));
      showToast('대회 종료됨');
    };

    const deleteEvent = () => {
      if (!confirm(`"${event.name}"을(를) 삭제하시겠습니까?\n경기 기록은 유지되지만 대회 정보는 사라집니다.`)) return;
      setData(prev => ({
        ...prev,
        events: prev.events.filter(e => e.id !== event.id),
      }));
      setCurrentEventId(null);
      navigate('home');
    };

    // Group matches by round
    const matchesByRound: Record<number, Match[]> = {};
    event.matches.forEach(m => {
      if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
      matchesByRound[m.round].push(m);
    });

    const teamName = (id: string) => data.teams.find(t => t.id === id)?.name ?? '?';

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center justify-between gap-4 border-b border-slate-900">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
            <div className="min-w-0">
              <h1 className="text-xl lg:text-lg font-black tracking-tight truncate">{event.name}</h1>
              <div className="text-sm lg:text-[10px] text-slate-500">
                {event.teamIds.length}팀 · {event.rounds}라운드 · {progress.finished}/{progress.total} 완료
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={deleteEvent} className="text-red-500 hover:bg-red-500/10">
            <Trash2 size={18} />
          </Button>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-slate-900 px-4">
          {(['standings', 'matches'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-3.5 lg:py-3 text-base lg:text-xs font-black uppercase tracking-widest transition-colors",
                tab === t 
                  ? "text-orange-500 border-b-2 border-orange-500" 
                  : "text-slate-600 hover:text-slate-400"
              )}
            >
              {t === 'standings' ? '순위표' : '경기 일정'}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto p-6 min-h-0">
          {tab === 'standings' && (
            <div className="space-y-3">
              <div className="overflow-auto max-h-[60vh] bg-slate-900/30 rounded-xl lg:rounded-2xl border border-slate-800">
                <table className="w-full text-sm lg:text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-left px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">순위</th>
                      <th className="sticky top-0 left-0 z-30 bg-white shadow-[0_1px_0_0_#e2e8f0] text-left px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap min-w-[96px]">팀</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">경기</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">승</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">패</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">세트</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">득실</th>
                      <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-right px-2.5 py-2.5 lg:p-3 font-bold text-orange-500 whitespace-nowrap">승점</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, idx) => (
                      <tr key={row.teamId} className={cn(
                        "border-b border-slate-800/50",
                        idx === 0 && "bg-orange-600/5"
                      )}>
                        <td className="px-2.5 py-2.5 lg:p-3 font-black">
                          <span className={cn(
                            "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs lg:text-[10px]",
                            idx === 0 ? "bg-yellow-500 text-slate-900" :
                            idx === 1 ? "bg-slate-400 text-slate-900" :
                            idx === 2 ? "bg-orange-700 text-white" :
                            "bg-slate-800 text-slate-400"
                          )}>{idx + 1}</span>
                        </td>
                        <td className="sticky left-0 z-10 bg-white px-2.5 py-2.5 lg:p-3 font-bold text-slate-100 min-w-[96px]">{teamName(row.teamId)}</td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-400">{row.played}</td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-emerald-400">{row.wins}</td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-red-400">{row.losses}</td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-400">{row.setsWon}-{row.setsLost}</td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-400">
                          {row.setDiff > 0 ? `+${row.setDiff}` : row.setDiff}
                        </td>
                        <td className="px-2.5 py-2.5 lg:p-3 text-right font-black text-orange-500 text-lg lg:text-base">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-sm lg:text-[10px] text-slate-500 leading-relaxed bg-slate-900/30 p-4 lg:p-3 rounded-xl lg:rounded-lg">
                * 승점: 승 = 3점, 패 = 0점 (무승부 없음)<br/>
                * 동률 시: 세트 득실 → 세트 승수 → 득점 차
              </div>

              {/* ── 개인 기록 ──────────────────────────────────── */}
              <section className="space-y-3 pt-4">
                <h2 className="text-base lg:text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 size={16} /> 개인 기록
                </h2>

                {recordedPlayers.length === 0 ? (
                  <div className="text-center py-8 bg-slate-900/30 rounded-xl lg:rounded-lg border border-dashed border-slate-800">
                    <p className="text-base lg:text-sm text-slate-500">아직 기록된 개인 스탯이 없습니다.</p>
                    <p className="text-sm lg:text-[10px] text-slate-600 mt-1">경기를 진행하면 선수별 누적 기록이 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="overflow-auto max-h-[60vh] bg-slate-900/30 rounded-xl lg:rounded-2xl border border-slate-800">
                      <table className="w-full text-sm lg:text-xs">
                        <thead>
                          <tr className="text-slate-500">
                            <th className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_#e2e8f0] text-left px-2.5 py-2.5 lg:p-3 font-bold whitespace-nowrap">순위</th>
                            {sortTh('선수', 'name', { name: true, minW: 'min-w-[132px]' })}
                            {sortTh('에이스', 'serveAce', { minW: 'min-w-[52px]' })}
                            {sortTh('서브 성공/시도', 'serveSuccess', { minW: 'min-w-[92px]' })}
                            {sortTh('서브 성공률', 'servePct', { minW: 'min-w-[68px]' })}
                            {sortTh('스파이크 성공/시도', 'spikeSuccess', { minW: 'min-w-[100px]' })}
                            {sortTh('스파이크 성공률', 'spikePct', { minW: 'min-w-[80px]' })}
                            {sortTh('블로킹', 'block', { minW: 'min-w-[52px]' })}
                            {sortTh('리시브', 'receive', { minW: 'min-w-[52px]' })}
                            {sortTh('디그', 'dig', { minW: 'min-w-[52px]' })}
                            {sortTh('토스 도움', 'setAssist', { minW: 'min-w-[60px]' })}
                            {sortTh('득점기여', 'contribution', { minW: 'min-w-[68px]', accent: true })}
                          </tr>
                        </thead>
                        <tbody>
                          {recordedPlayers.map((r, idx) => (
                            <tr key={r.player.id} className={cn(
                              "border-b border-slate-800/50",
                              idx === 0 && "bg-orange-600/5"
                            )}>
                              <td className="px-2.5 py-2.5 lg:p-3 font-black">
                                <span className={cn(
                                  "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs lg:text-[10px]",
                                  idx === 0 ? "bg-yellow-500 text-slate-900" :
                                  idx === 1 ? "bg-slate-400 text-slate-900" :
                                  idx === 2 ? "bg-orange-700 text-white" :
                                  "bg-slate-800 text-slate-400"
                                )}>{idx + 1}</span>
                              </td>
                              <td className="sticky left-0 z-10 bg-white px-2.5 py-2.5 lg:p-3 min-w-[132px]">
                                <div className="flex items-center gap-1.5 whitespace-nowrap">
                                  <span className="font-mono text-slate-500">{r.player.number}</span>
                                  <span className="font-bold text-base lg:text-sm text-slate-100">{r.player.name}</span>
                                  {r.player.isSetter && <span className="text-[10px] font-black text-purple-400">S</span>}
                                </div>
                                <div className="text-[11px] lg:text-[10px] text-slate-500">{r.teamName}</div>
                              </td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.stats.serveAce}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-400 whitespace-nowrap">{r.rates.serveTotal > 0 ? `${r.stats.serveOk + r.stats.serveAce}/${r.rates.serveTotal}` : '-'}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.rates.serveTotal > 0 ? `${Math.round(r.rates.servePct)}%` : '-'}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-400 whitespace-nowrap">{r.rates.spikeTotal > 0 ? `${r.stats.spikeSuccess}/${r.rates.spikeTotal}` : '-'}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.rates.spikeTotal > 0 ? `${Math.round(r.rates.spikePct)}%` : '-'}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.stats.block}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.stats.receive}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.stats.dig}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-mono text-slate-300">{r.stats.setAssist}</td>
                              <td className="px-2.5 py-2.5 lg:p-3 text-right font-black font-mono text-orange-500 text-base lg:text-sm">{r.contribution}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {noRecordPlayers.length > 0 && (
                      <div className="text-xs lg:text-[10px] text-slate-600 leading-relaxed px-1 pt-1">
                        기록 없음: {noRecordPlayers.map(r => `${r.player.name}(${r.teamName})`).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'matches' && (
            <div className="space-y-6">
              {Object.keys(matchesByRound)
                .map(Number)
                .sort((a, b) => a - b)
                .map(round => (
                  <div key={round} className="space-y-2">
                    <div className="text-base lg:text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <span className="inline-block w-6 h-6 rounded-full bg-orange-600/20 text-orange-500 text-xs lg:text-[10px] flex items-center justify-center">
                        {round}
                      </span>
                      라운드 {round}
                    </div>
                    {matchesByRound[round].map(match => {
                      const result = getMatchResult(match, data.games);
                      return (
                        <button
                          key={match.id}
                          onClick={() => startOrResumeMatch(match)}
                          disabled={readOnly}
                          className={cn(
                            "w-full p-4 lg:p-3 rounded-xl border text-left transition-all hover:bg-slate-900",
                            result.status === 'finished' && "bg-slate-900/40 border-slate-800",
                            result.status === 'inProgress' && "bg-emerald-600/5 border-emerald-600/30",
                            result.status === 'pending' && "bg-slate-900/40 border-slate-800 hover:border-orange-600/50",
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "flex-1 text-right font-bold text-lg lg:text-base",
                              result.winner === 'A' ? "text-orange-400" : "text-slate-300"
                            )}>
                              {teamName(match.teamAId)}
                            </div>
                            <div className="text-center min-w-[64px] lg:min-w-[60px]">
                              {result.status === 'finished' ? (
                                <div className="font-black font-mono text-lg lg:text-sm">
                                  <span className={result.winner === 'A' ? 'text-orange-400' : 'text-slate-500'}>{result.setsA}</span>
                                  <span className="text-slate-700 mx-1">:</span>
                                  <span className={result.winner === 'B' ? 'text-blue-400' : 'text-slate-500'}>{result.setsB}</span>
                                </div>
                              ) : result.status === 'inProgress' ? (
                                <div className="text-xs lg:text-[9px] font-black bg-emerald-600/20 text-emerald-400 px-2 py-1 rounded">
                                  LIVE
                                </div>
                              ) : (
                                <div className="text-xs lg:text-[9px] font-black bg-slate-800 text-slate-500 px-2 py-1 rounded">
                                  VS
                                </div>
                              )}
                            </div>
                            <div className={cn(
                              "flex-1 text-left font-bold text-lg lg:text-base",
                              result.winner === 'B' ? "text-blue-400" : "text-slate-300"
                            )}>
                              {teamName(match.teamBId)}
                            </div>
                          </div>
                          {result.status === 'finished' && (
                            <div className="text-xs lg:text-[9px] text-slate-600 text-center mt-1 font-mono">
                              총 {result.pointsA} - {result.pointsB}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </main>

        <footer className="p-6 bg-slate-950 border-t border-slate-900 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={addOneRound} disabled={readOnly || !!event.endedAt}>
            ➕ 1라운드 추가
          </Button>
          {!event.endedAt ? (
            <Button variant="success" size="sm" className="flex-1" onClick={endEvent} disabled={readOnly}>
              대회 종료
            </Button>
          ) : (
            <div className="flex-1 text-center py-2 text-sm lg:text-[10px] font-bold text-slate-500">
              종료됨: {new Date(event.endedAt).toLocaleDateString('ko-KR')}
            </div>
          )}
        </footer>
      </div>
    );
  };

  const SettingsView = () => {
    const [url, setUrl] = useState(data.gasUrl);

    const save = () => {
      setData(prev => ({ ...prev, gasUrl: url }));
      showToast('설정이 저장되었습니다.');
    };

    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-50">
        <header className="p-6 flex items-center gap-4 border-b border-slate-900">
          <Button variant="ghost" size="sm" onClick={() => navigate('home')} icon={ChevronLeft} />
          <h1 className="text-xl font-black tracking-tight">환경 <span className="text-orange-600">설정</span></h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          <div className="max-w-4xl mx-auto space-y-6 pb-6">
          <Card title="실시간 협업 / 공유">
            <div className="space-y-3">
              <div className="text-base lg:text-sm text-slate-600 leading-relaxed">
                {session.mode === 'solo' && '현재 오프라인 모드입니다. 협업 세션을 시작하면 여러 기기에서 동시에 기록할 수 있습니다.'}
                {session.mode === 'collab' && (
                  <>현재 협업 세션 진행 중<br/><span className="font-mono text-emerald-600">{session.sessionId}</span></>
                )}
                {session.mode === 'share' && '읽기 전용 공유 링크로 접속 중입니다. 편집할 수 없습니다.'}
              </div>
              {session.mode === 'solo' && (
                <Button variant="success" className="w-full" onClick={startCollabSession} icon={Wifi}>
                  협업 세션 시작
                </Button>
              )}
              {session.mode === 'collab' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={copyShareLink} icon={Copy}>공유 링크</Button>
                  <Button variant="danger" onClick={endSession} icon={WifiOff}>세션 종료</Button>
                </div>
              )}
            </div>
          </Card>

          <Card title="Google Sheets 연동">
            <div className="space-y-4">
              <Input 
                label="GAS Web App URL" 
                value={url} 
                onChange={e => setUrl(e.target.value)} 
                placeholder="https://script.google.com/macros/s/..." 
              />
              <div className="text-base lg:text-sm text-slate-600 leading-relaxed bg-slate-100 p-4 rounded-xl lg:rounded-lg">
                <div className="font-bold text-slate-700 mb-2">GAS 설정 방법:</div>
                1. 구글 드라이브 → 새 스프레드시트 만들기<br/>
                2. 확장 프로그램 → Apps Script<br/>
                3. Code.gs 내용 붙여넣기 (다운로드 받은 파일)<br/>
                4. 배포 → 새 배포 → 웹 앱, 액세스: 모든 사용자<br/>
                5. 나온 URL을 위에 입력 후 저장
              </div>
              <Button variant="primary" className="w-full" onClick={save} icon={Save}>설정 저장</Button>

              {data.gasUrl && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="text-base lg:text-sm font-bold text-slate-600 uppercase tracking-wider">시트 작업</div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      showToast('시트 초기화 중...');
                      const res = await gasInit(data.gasUrl);
                      if (res.ok) showToast('모든 시트 준비됨');
                      else showToast('실패: ' + res.error);
                    }}
                  >
                    🔧 시트 초기화 (최초 1회)
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      if (!confirm('현재까지의 모든 평가 결과를 시트로 내보내시겠습니까?\n(학년반별 시트가 자동 생성됩니다)')) return;
                      showToast('평가 결과 산출 중...');
                      const res = await gasExportEvaluations(data.gasUrl, data);
                      if (res.ok) {
                        showToast(`${res.saved}명 내보냄`);
                        if (res.spreadsheetUrl) window.open(res.spreadsheetUrl, '_blank');
                      } else {
                        showToast('실패: ' + res.error);
                      }
                    }}
                  >
                    📊 평가 결과 시트로 내보내기
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card title="데이터 관리" className="border-red-200 bg-red-50">
            <p className="text-base lg:text-sm text-slate-600 mb-4">모든 데이터를 초기화하고 처음 상태로 되돌립니다.</p>
            <Button variant="danger" className="w-full" onClick={() => {
              if (confirm('정말 모든 데이터를 삭제하시겠습니까?')) {
                setData(INITIAL_DATA);
                localStorage.removeItem(STORAGE_KEY);
                window.location.reload();
              }
            }} icon={Trash2}>전체 데이터 초기화</Button>
          </Card>
          </div>
        </main>
      </div>
    );
  };

  // Game record view goes wide on desktop; other views stay phone-width
  // All views use wide container; inner max-width controls content width per view
  const containerClass = "h-[100dvh] w-full max-w-6xl mx-auto bg-slate-950 shadow-2xl overflow-hidden relative";

  return (
    <div className={containerClass}>
      {readOnly && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-blue-600/90 text-white text-[11px] font-bold text-center py-1.5 px-3 backdrop-blur-sm flex items-center justify-center gap-3">
          <span>
            <Eye size={11} className="inline mr-1" />
            {session.mode === 'share'
              ? '읽기 전용 공유 모드'
              : (authUser ? '이 계정은 기록 권한이 없습니다 (학교 계정 필요) — 보기 전용' : '보기 전용 — 기록하려면 학교 구글 계정으로 로그인')}
          </span>
          {session.mode !== 'share' && (
            <button
              onClick={handleLogin}
              className="px-2.5 py-0.5 rounded-md bg-white text-blue-700 font-black text-[11px] hover:bg-blue-50 transition-colors"
            >
              {authUser ? '학교 계정으로 로그인' : '구글 로그인'}
            </button>
          )}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="h-full w-full"
        >
          {view === 'home' && <HomeView />}
          {view === 'team' && <TeamView />}
          {view === 'game-setup' && <GameSetupView />}
          {view === 'game-court' && <CourtSetupView />}
          {view === 'game-record' && <GameRecordView />}
          {view === 'dashboard' && <DashboardView />}
          {view === 'event-setup' && <EventSetupView />}
          {view === 'event-detail' && <EventDetailView />}
          {view === 'settings' && <SettingsView />}
        </motion.div>
      </AnimatePresence>

      {/* 경기 설정 수정 모달 — App 레벨에서 렌더(게임뷰 리마운트와 무관하게 안정적으로 유지, 트랜지션 재생 방지) */}
      {showSettings && view === 'game-record' && currentGame && (
        <ModalOverlay onClose={() => setShowSettings(false)}>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">경기 설정 수정</div>
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1.5">인원수</div>
              <div className="grid grid-cols-2 gap-2">
                {[6, 9].map(n => (
                  <button key={n} onClick={() => applyGameSettings({ courtN: n })}
                    className={cn('py-2.5 rounded-xl font-black text-sm transition-all', (currentGame.courtN ?? 6) === n ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400')}>
                    {n}인제
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1.5">경기 방식</div>
              <div className="grid grid-cols-3 gap-2">
                {[{ v: 1, l: '단판' }, { v: 3, l: '3전2선승' }, { v: 5, l: '5전3선승' }].map(o => (
                  <button key={o.v} onClick={() => applyGameSettings({ maxSets: o.v })}
                    className={cn('py-2.5 rounded-xl font-bold text-xs transition-all', (currentGame.maxSets ?? 1) === o.v ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400')}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1.5">목표 점수</div>
              <div className="grid grid-cols-3 gap-2">
                {[15, 21, 25].map(n => (
                  <button key={n} onClick={() => applyGameSettings({ setTarget: n })}
                    className={cn('py-2.5 rounded-xl font-bold text-sm transition-all', (currentGame.setTarget ?? 25) === n ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400')}>
                    {n}점
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-amber-400/90 bg-amber-500/10 rounded-lg p-2 leading-relaxed">
              ※ 인원수를 줄이면 코트 인원이 초과될 수 있어요 — 변경 후 '코트 재편성'으로 확인하세요.
            </div>
          </div>
          <Button variant="primary" className="w-full mt-4" onClick={() => setShowSettings(false)}>완료</Button>
        </ModalOverlay>
      )}
    </div>
  );
}

// --- Helpers used by GameRecordView modals ---

function getPlayerLabel(playerId: string, teams: (Team | undefined)[]): string {
  for (const t of teams) {
    const p = (t?.players ?? []).find(p => p.id === playerId);
    if (p) return `${p.number} ${p.name}`;
  }
  return '?';
}

