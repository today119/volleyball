/**
 * GAS Web App client.
 *
 * Talks to the Google Apps Script web app deployed from Code.gs.
 * Uses POST with no-cors workaround (text/plain content-type) so the
 * preflight is skipped and we can hit script.google.com directly from
 * the browser.
 *
 * Important: when GAS responds, the browser exposes the body as text.
 * We parse JSON manually.
 */

import type { 
  AppData, Game, Player, PeerEval 
} from '../types';
import { calculateAllEvaluations, aggregatePlayerStatsAllGames } from './stats';

export interface GasResponse<T = any> {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

async function postToGas<T = any>(
  gasUrl: string,
  payload: Record<string, any>
): Promise<GasResponse<T>> {
  if (!gasUrl) {
    return { ok: false, error: 'GAS URL이 설정되지 않았습니다. 설정 화면에서 입력하세요.' };
  }
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      // text/plain prevents CORS preflight, mirrors MatchMaker Pro pattern
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as GasResponse<T>;
    } catch {
      return { ok: false, error: '응답 파싱 실패: ' + text.slice(0, 200) };
    }
  } catch (e: any) {
    return { ok: false, error: '네트워크 오류: ' + (e?.message ?? e) };
  }
}

// ── 명단 시트 ─────────────────────────────────────────────────────

export async function gasCreateRosterTemplate(gasUrl: string, teamName: string) {
  return postToGas(gasUrl, { action: 'createRosterTemplate', teamName });
}

export async function gasLoadRoster(gasUrl: string, teamName: string) {
  return postToGas(gasUrl, { action: 'loadRoster', teamName });
}

/**
 * Save a single team's roster to its dedicated sheet.
 */
export async function gasSaveRoster(
  gasUrl: string,
  teamName: string,
  players: Array<{ org?: string; number: string; name: string; isSetter?: boolean }>
) {
  return postToGas(gasUrl, { action: 'saveRoster', teamName, players });
}

// ── 경기 결과 저장 ────────────────────────────────────────────────

export async function gasSaveGame(
  gasUrl: string,
  game: Game,
  data: AppData
) {
  const teamA = data.teams.find(t => t.id === game.teamAId);
  const teamB = data.teams.find(t => t.id === game.teamBId);
  const players = [
    ...(teamA?.players ?? []),
    ...(teamB?.players ?? []),
  ];
  return postToGas(gasUrl, {
    action: 'saveGame',
    game,
    teamAName: teamA?.name || '팀 A',
    teamBName: teamB?.name || '팀 B',
    players,
  });
}

// ── 동료평가 저장 ─────────────────────────────────────────────────

export async function gasSavePeerEvals(
  gasUrl: string,
  data: AppData
) {
  const flatEvals: any[] = [];
  Object.keys(data.peerEvals).forEach(playerId => {
    // Find the player to include name/org
    let player: Player | undefined;
    for (const t of data.teams) {
      const p = t.players.find(x => x.id === playerId);
      if (p) { player = p; break; }
    }
    if (!player) return;
    data.peerEvals[playerId].forEach(e => {
      flatEvals.push({
        playerOrg: player!.org || '',
        playerName: player!.name,
        evaluatorId: e.evaluatorId,
        evaluatorName: e.evaluatorName || '',
        level: e.level,
        timestamp: e.timestamp,
      });
    });
  });

  return postToGas(gasUrl, { action: 'savePeerEvals', evals: flatEvals });
}

// ── 평가 결과 일괄 내보내기 ───────────────────────────────────────

/**
 * Calculate evaluations locally then push to GAS.
 * GAS organizes them into "평가결과" sheet + per-class tabs.
 */
export async function gasExportEvaluations(
  gasUrl: string,
  data: AppData
) {
  const grouped = calculateAllEvaluations(data);
  const flat: any[] = [];

  Object.keys(grouped).forEach(org => {
    grouped[org].forEach(({ player, evaluation }) => {
      const teamName = data.teams.find(t => t.id === player.teamId)?.name || '';
      const stats = aggregatePlayerStatsAllGames(data.games, player.id);
      flat.push({
        org: player.org || '',
        number: player.number,
        name: player.name,
        teamName,
        serveMetric: evaluation.serveMetric,
        serveScore: evaluation.serveScore,
        leagueAvg: evaluation.leagueAvg,
        leagueScore: evaluation.leagueScore,
        perfLevel: evaluation.perfLevel,
        perfScore: evaluation.perfScore,
        peerEvalCount: evaluation.peerEvalCount,
        gameRecordScore: evaluation.gameRecordScore,
        total: evaluation.total,
        // raw counts
        serveAttempts: stats.serveOk + stats.serveAce + stats.serveFail,
        serveSuccess: stats.serveOk + stats.serveAce,
        spikeAttempts: stats.spikeSuccess + stats.spikeBlocked + stats.spikeError,
        spikeSuccess: stats.spikeSuccess,
        blocks: stats.block,
        receives: stats.receive,
        digs: stats.dig,
        setAttempts: stats.setSuccess + stats.setAssist + stats.setError,
        setAssists: stats.setAssist,
        errors: stats.error,
      });
    });
  });

  return postToGas(gasUrl, { action: 'exportEvaluations', evaluations: flat });
}

// ── 유틸 ──────────────────────────────────────────────────────────

export async function gasPing(gasUrl: string) {
  return postToGas(gasUrl, { action: 'sheetUrl' });
}

export async function gasInit(gasUrl: string) {
  return postToGas(gasUrl, { action: 'init' });
}
