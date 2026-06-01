/**
 * SpikeLog Pro - Google Apps Script Backend
 *
 * 배포 방법:
 *   1. Google Drive에서 새 스프레드시트 생성 (예: "SpikeLog 데이터")
 *   2. 확장 프로그램 → Apps Script
 *   3. 이 파일 전체 내용을 Code.gs에 붙여넣기
 *   4. 저장 후 → 배포 → 새 배포 → 유형: 웹 앱
 *   5. 액세스 권한: 모든 사용자
 *   6. 배포 후 나오는 URL을 앱의 설정 → "GAS Web App URL"에 입력
 *
 * 매치매이커 방식과 동일 — 앱 ↔ GAS ↔ Sheets 직접 통신
 */

// ────────────────────────────────────────────────────────────────────
// 공통 헬퍼
// ────────────────────────────────────────────────────────────────────

const SS = SpreadsheetApp.getActiveSpreadsheet();

function sh(name) {
  let s = SS.getSheetByName(name);
  if (!s) s = SS.insertSheet(name);
  return s;
}

function ensureHeader(sheet, cols) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cols);
    sheet.getRange(1, 1, 1, cols.length)
      .setBackground('#EA580C')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data || { ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────────────────────────
// 시트 초기화 — 모든 시트 자동 생성
// ────────────────────────────────────────────────────────────────────

function initAllSheets() {
  // 통합 명단 — 팀 컬럼을 첫번째로 (팀별 시트는 saveRoster 시점에 동적으로 생성)
  ensureHeader(sh('명단'), [
    '팀', '학년반', '번호', '이름', '세터(Y/N)', '등록일'
  ]);

  ensureHeader(sh('경기기록'), [
    '날짜', '게임ID', '세트', '팀A 이름', '팀B 이름',
    '팀A 점수', '팀B 점수', '승리팀', '저장일시'
  ]);

  ensureHeader(sh('선수기록'), [
    '게임ID', '세트', '학년반', '번호', '이름', '소속팀',
    '서브OK', '서브ACE', '서브실패', '서브 시도', '서브 성공률(%)',
    '스파이크성공', '블록당함', '스파이크실책', '스파이크 시도', '스파이크 성공률(%)',
    '블로킹', '리시브', '디그',
    '토스성공', '토스어시스트', '토스실책', '토스 시도', '토스 효율(%)',
    '실책', '저장일시'
  ]);

  ensureHeader(sh('동료평가'), [
    '평가일시', '평가받은선수 학년반', '평가받은선수 이름',
    '평가자 학번', '평가자 이름', '레벨(1-4)'
  ]);

  ensureHeader(sh('평가결과'), [
    '학년반', '번호', '이름', '팀',
    '서브 지표', '서브 점수(11-20)',
    '팀 승점평균', '리그 점수(11-20)',
    '수행 레벨', '수행 점수(22-40)', '동료평가 인원',
    '경기기록 점수', '총점(/100)',
    '서브 시도', '서브 성공', '스파이크 시도', '스파이크 성공',
    '블로킹', '리시브', '디그', '토스 시도', '토스 어시스트', '실책',
    '내보낸 일시'
  ]);

  return { ok: true, message: '모든 시트가 준비되었습니다.' };
}

// ────────────────────────────────────────────────────────────────────
// 명단 관리 — 팀별 시트 방식
// ────────────────────────────────────────────────────────────────────

const ROSTER_COLS = ['학년반', '번호', '이름', '세터(Y/N)', '등록일'];

/**
 * 팀별 시트 이름 규칙: `[팀이름]`
 * 예: 팀 이름이 "인천영종고"면 시트 이름은 "[인천영종고]"
 * - 시트 탭에서 한눈에 팀 시트임을 알 수 있음
 * - 통합 "명단" 시트와도 구분됨
 */
function teamSheetName(teamName) {
  return '[' + String(teamName).trim() + ']';
}

/**
 * 특정 팀 시트 생성 (이미 있으면 그대로 사용).
 * @param {string} teamName
 */
function createRosterTemplate(teamName) {
  if (!teamName) {
    return { ok: false, error: '팀 이름이 필요합니다.' };
  }

  const sheetName = teamSheetName(teamName);
  const s = sh(sheetName);
  ensureHeader(s, ROSTER_COLS);

  // 처음 만든 시트면 예시 행 + 안내
  const isNew = s.getLastRow() <= 1;

  if (isNew) {
    // 친절한 예시 행
    s.appendRow(['2-3', '7', '홍길동', 'N', new Date()]);
    s.appendRow(['2-3', '1', '김세터', 'Y', new Date()]);
    s.appendRow(['2-3', '9', '이공격', 'N', new Date()]);
  }

  // 컬럼별 적절한 너비 (학년반/번호/이름/세터/등록일)
  const widths = [70, 60, 90, 80, 160];
  for (let i = 0; i < widths.length; i++) {
    s.setColumnWidth(i + 1, widths[i]);
  }

  // 통합 "명단" 시트도 항상 보장 (전체 통합 뷰)
  ensureHeader(sh('명단'), ['팀', '학년반', '번호', '이름', '세터(Y/N)', '등록일']);

  return {
    ok: true,
    sheetUrl: SS.getUrl() + '#gid=' + s.getSheetId(),
    sheetName: sheetName,
    message: isNew
      ? sheetName + ' 시트가 생성되었습니다. 예시 행을 참고하여 작성하세요.'
      : sheetName + ' 시트가 이미 있습니다. 그대로 편집하세요.'
  };
}

/**
 * 특정 팀의 시트에서 명단 읽어오기.
 * @param {string} teamName
 */
function loadRoster(teamName) {
  if (!teamName) {
    return { ok: false, error: '팀 이름이 필요합니다.' };
  }

  const sheetName = teamSheetName(teamName);
  const s = SS.getSheetByName(sheetName);
  if (!s) {
    return {
      ok: false,
      error: '"' + sheetName + '" 시트가 없습니다. 먼저 "명단 시트 만들기"를 눌러주세요.'
    };
  }

  ensureHeader(s, ROSTER_COLS);

  const lastRow = s.getLastRow();
  if (lastRow < 2) return { ok: true, players: [], teamName: teamName };

  const data = s.getRange(2, 1, lastRow - 1, 4).getValues();
  const players = data
    .filter(row => row[2]) // 이름 있는 행만
    .map(row => ({
      org: String(row[0]).trim(),
      number: String(row[1]).trim(),
      name: String(row[2]).trim(),
      teamName: teamName,
      isSetter: String(row[3]).trim().toUpperCase() === 'Y',
    }));

  return { ok: true, players: players, teamName: teamName };
}

/**
 * 특정 팀의 명단을 시트에 저장 (덮어쓰기).
 * 동시에 통합 "명단" 시트도 갱신.
 * 
 * POST body: { 
 *   action: 'saveRoster', 
 *   teamName: '인천영종고',
 *   players: [{ org, number, name, isSetter }] 
 * }
 */
function saveRoster(teamName, players) {
  if (!teamName) {
    return { ok: false, error: '팀 이름이 필요합니다.' };
  }

  // 1. 팀별 시트 갱신
  const sheetName = teamSheetName(teamName);
  const s = sh(sheetName);
  ensureHeader(s, ROSTER_COLS);

  // 기존 데이터 행 삭제 (헤더 유지)
  if (s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).clearContent();
  }

  const now = new Date();
  if (players && players.length > 0) {
    const rows = players.map(p => [
      p.org || '',
      p.number || '',
      p.name || '',
      p.isSetter ? 'Y' : 'N',
      now,
    ]);
    s.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  // 2. 통합 "명단" 시트도 갱신 — 이 팀의 행만 제거 후 다시 삽입
  const unified = sh('명단');
  ensureHeader(unified, ['팀', '학년반', '번호', '이름', '세터(Y/N)', '등록일']);

  // 기존 행 중 이 팀에 속하는 것만 제거
  const unifiedLast = unified.getLastRow();
  if (unifiedLast > 1) {
    const allData = unified.getRange(2, 1, unifiedLast - 1, unified.getLastColumn()).getValues();
    const keepRows = allData.filter(r => String(r[0]).trim() !== teamName);
    // 기존 데이터 전부 지우고 keepRows만 다시 쓰기
    unified.getRange(2, 1, unifiedLast - 1, unified.getLastColumn()).clearContent();
    if (keepRows.length > 0) {
      unified.getRange(2, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
    }
  }
  // 새 팀 데이터 추가
  if (players && players.length > 0) {
    const teamRows = players.map(p => [
      teamName,
      p.org || '',
      p.number || '',
      p.name || '',
      p.isSetter ? 'Y' : 'N',
      now,
    ]);
    const startRow = unified.getLastRow() + 1;
    unified.getRange(startRow, 1, teamRows.length, 6).setValues(teamRows);
  }

  return {
    ok: true,
    saved: players ? players.length : 0,
    sheetName: sheetName,
  };
}

// ────────────────────────────────────────────────────────────────────
// 경기 결과 저장
// ────────────────────────────────────────────────────────────────────

/**
 * 한 경기의 모든 세트 결과 + 선수별 기록을 시트에 추가
 * POST body: { action: 'saveGame', game: {...}, teamAName, teamBName, players: [...] }
 */
function saveGame(payload) {
  const game = payload.game;
  const teamAName = payload.teamAName || '팀 A';
  const teamBName = payload.teamBName || '팀 B';
  const players = payload.players || []; // 전체 선수 정보 (이름/학년반 매핑용)

  const gameSheet = sh('경기기록');
  ensureHeader(gameSheet, [
    '날짜', '게임ID', '세트', '팀A 이름', '팀B 이름',
    '팀A 점수', '팀B 점수', '승리팀', '저장일시'
  ]);

  const statSheet = sh('선수기록');
  ensureHeader(statSheet, [
    '게임ID', '세트', '학년반', '번호', '이름', '소속팀',
    '서브OK', '서브ACE', '서브실패', '서브 시도', '서브 성공률(%)',
    '스파이크성공', '블록당함', '스파이크실책', '스파이크 시도', '스파이크 성공률(%)',
    '블로킹', '리시브', '디그',
    '토스성공', '토스어시스트', '토스실책', '토스 시도', '토스 효율(%)',
    '실책', '저장일시'
  ]);

  const now = new Date();
  const playerMap = {};
  players.forEach(p => { playerMap[p.id] = p; });

  // 1. 경기기록 시트에 세트별 추가
  const gameRows = [];
  game.sets.forEach(set => {
    const winner = set.scoreA > set.scoreB ? teamAName
                  : set.scoreB > set.scoreA ? teamBName
                  : '무승부';
    gameRows.push([
      game.date || now,
      game.id,
      set.number,
      teamAName, teamBName,
      set.scoreA, set.scoreB,
      winner,
      now,
    ]);
  });
  if (gameRows.length > 0) {
    gameSheet.getRange(
      gameSheet.getLastRow() + 1, 1,
      gameRows.length, gameRows[0].length
    ).setValues(gameRows);
  }

  // 2. 선수기록 시트에 세트별 × 선수별 추가
  const statRows = [];
  game.sets.forEach(set => {
    const stats = set.playerStats || {};
    Object.keys(stats).forEach(pid => {
      const s = stats[pid];
      const player = playerMap[pid] || {};
      const teamName = player.teamId === game.teamAId ? teamAName : teamBName;

      const serveTotal = (s.serveOk||0) + (s.serveAce||0) + (s.serveFail||0);
      const servePct = serveTotal > 0
        ? Math.round(((s.serveOk + s.serveAce) / serveTotal) * 1000) / 10
        : 0;

      const spikeTotal = (s.spikeSuccess||0) + (s.spikeBlocked||0) + (s.spikeError||0);
      const spikePct = spikeTotal > 0
        ? Math.round((s.spikeSuccess / spikeTotal) * 1000) / 10
        : 0;

      const setTotal = (s.setSuccess||0) + (s.setAssist||0) + (s.setError||0);
      const setPct = setTotal > 0
        ? Math.round(((s.setSuccess + s.setAssist) / setTotal) * 1000) / 10
        : 0;

      statRows.push([
        game.id,
        set.number,
        player.org || '',
        player.number || '',
        player.name || '',
        teamName,
        s.serveOk||0, s.serveAce||0, s.serveFail||0, serveTotal, servePct,
        s.spikeSuccess||0, s.spikeBlocked||0, s.spikeError||0, spikeTotal, spikePct,
        s.block||0, s.receive||0, s.dig||0,
        s.setSuccess||0, s.setAssist||0, s.setError||0, setTotal, setPct,
        s.error||0,
        now,
      ]);
    });
  });

  if (statRows.length > 0) {
    statSheet.getRange(
      statSheet.getLastRow() + 1, 1,
      statRows.length, statRows[0].length
    ).setValues(statRows);
  }

  return {
    ok: true,
    gameRows: gameRows.length,
    statRows: statRows.length,
  };
}

// ────────────────────────────────────────────────────────────────────
// 동료평가 저장
// ────────────────────────────────────────────────────────────────────

function savePeerEvals(payload) {
  const evals = payload.evals || []; // [{ playerOrg, playerName, evaluatorId, evaluatorName, level, timestamp }]
  const s = sh('동료평가');
  ensureHeader(s, [
    '평가일시', '평가받은선수 학년반', '평가받은선수 이름',
    '평가자 학번', '평가자 이름', '레벨(1-4)'
  ]);

  if (evals.length === 0) return { ok: true, saved: 0 };

  const rows = evals.map(e => [
    e.timestamp ? new Date(e.timestamp) : new Date(),
    e.playerOrg || '',
    e.playerName || '',
    e.evaluatorId || '',
    e.evaluatorName || '',
    e.level || 0,
  ]);

  s.getRange(s.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return { ok: true, saved: rows.length };
}

// ────────────────────────────────────────────────────────────────────
// 평가결과 일괄 내보내기 (앱에서 계산해서 보내준 결과를 시트에 정리)
// ────────────────────────────────────────────────────────────────────

/**
 * POST body: { 
 *   action: 'exportEvaluations', 
 *   evaluations: [{ org, number, name, teamName, ... }]
 * }
 *
 * 평가결과 시트에 일괄 기록 + 학년반별 시트 자동 생성
 */
function exportEvaluations(payload) {
  const evaluations = payload.evaluations || [];
  if (evaluations.length === 0) return { ok: true, saved: 0 };

  const mainSheet = sh('평가결과');
  ensureHeader(mainSheet, [
    '학년반', '번호', '이름', '팀',
    '서브 지표', '서브 점수(11-20)',
    '팀 승점평균', '리그 점수(11-20)',
    '수행 레벨', '수행 점수(22-40)', '동료평가 인원',
    '경기기록 점수', '총점(/100)',
    '서브 시도', '서브 성공', '스파이크 시도', '스파이크 성공',
    '블로킹', '리시브', '디그', '토스 시도', '토스 어시스트', '실책',
    '내보낸 일시'
  ]);

  // 평가결과 시트는 매번 새로 쓰기 (가장 최근 산출 결과)
  if (mainSheet.getLastRow() > 1) {
    mainSheet.getRange(2, 1, mainSheet.getLastRow() - 1, mainSheet.getLastColumn()).clearContent();
  }

  const now = new Date();
  const rows = evaluations.map(e => [
    e.org || '',
    e.number || '',
    e.name || '',
    e.teamName || '',
    e.serveMetric != null ? Math.round(e.serveMetric * 1000) / 1000 : 0,
    e.serveScore || 0,
    e.leagueAvg != null ? Math.round(e.leagueAvg * 1000) / 1000 : 0,
    e.leagueScore || 0,
    e.perfLevel != null ? Math.round(e.perfLevel * 100) / 100 : 0,
    e.perfScore || 0,
    e.peerEvalCount || 0,
    e.gameRecordScore || 0,
    e.total || 0,
    e.serveAttempts || 0,
    e.serveSuccess || 0,
    e.spikeAttempts || 0,
    e.spikeSuccess || 0,
    e.blocks || 0,
    e.receives || 0,
    e.digs || 0,
    e.setAttempts || 0,
    e.setAssists || 0,
    e.errors || 0,
    now,
  ]);

  if (rows.length > 0) {
    mainSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  // 학년반별 시트 자동 생성
  const groupedByOrg = {};
  evaluations.forEach(e => {
    const key = e.org || '미지정';
    if (!groupedByOrg[key]) groupedByOrg[key] = [];
    groupedByOrg[key].push(e);
  });

  const orgSummaries = [];
  Object.keys(groupedByOrg).forEach(org => {
    const tabName = `[${org}]`;
    const orgSheet = sh(tabName);

    // 학년반 시트는 항상 새로 작성
    orgSheet.clear();
    orgSheet.appendRow(['번호', '이름', '팀',
      '서브 점수', '리그 점수', '수행 점수', '경기기록 점수', '총점',
      '서브성공률(%)', '스파이크성공률(%)']);
    orgSheet.getRange(1, 1, 1, 10)
      .setBackground('#EA580C')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    orgSheet.setFrozenRows(1);

    const orgPlayers = groupedByOrg[org]
      .sort((a, b) => {
        const numA = parseInt(a.number) || 0;
        const numB = parseInt(b.number) || 0;
        return numA - numB;
      });

    const orgRows = orgPlayers.map(e => {
      const serveTotal = (e.serveAttempts || 0);
      const servePct = serveTotal > 0
        ? Math.round(((e.serveSuccess || 0) / serveTotal) * 1000) / 10
        : 0;
      const spikeTotal = (e.spikeAttempts || 0);
      const spikePct = spikeTotal > 0
        ? Math.round(((e.spikeSuccess || 0) / spikeTotal) * 1000) / 10
        : 0;
      return [
        e.number || '',
        e.name || '',
        e.teamName || '',
        e.serveScore || 0,
        e.leagueScore || 0,
        e.perfScore || 0,
        e.gameRecordScore || 0,
        e.total || 0,
        servePct,
        spikePct,
      ];
    });

    if (orgRows.length > 0) {
      orgSheet.getRange(2, 1, orgRows.length, orgRows[0].length).setValues(orgRows);
    }

    // 자동 너비 조정
    orgSheet.autoResizeColumns(1, 10);

    orgSummaries.push({ org, count: orgRows.length });
  });

  return {
    ok: true,
    saved: rows.length,
    orgSheets: orgSummaries,
    spreadsheetUrl: SS.getUrl(),
  };
}

// ────────────────────────────────────────────────────────────────────
// HTTP 엔드포인트
// ────────────────────────────────────────────────────────────────────

/**
 * GET 요청: ?action=loadRoster 등
 * (CORS 우회용으로 GET도 지원 — POST가 막힐 때 fallback)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    const teamName = e && e.parameter && e.parameter.teamName;

    if (action === 'ping') {
      return ok({ ok: true, message: 'SpikeLog GAS 준비 완료' });
    }
    if (action === 'init') {
      return ok(initAllSheets());
    }
    if (action === 'createRosterTemplate') {
      return ok(createRosterTemplate(teamName));
    }
    if (action === 'loadRoster') {
      return ok(loadRoster(teamName));
    }
    if (action === 'sheetUrl') {
      return ok({ ok: true, url: SS.getUrl() });
    }
    return err('unknown action: ' + action);
  } catch (ex) {
    return err(String(ex));
  }
}

/**
 * POST 요청: action 필드로 분기
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'init') {
      return ok(initAllSheets());
    }
    if (action === 'createRosterTemplate') {
      return ok(createRosterTemplate(body.teamName));
    }
    if (action === 'loadRoster') {
      return ok(loadRoster(body.teamName));
    }
    if (action === 'saveRoster') {
      return ok(saveRoster(body.teamName, body.players));
    }
    if (action === 'saveGame') {
      return ok(saveGame(body));
    }
    if (action === 'savePeerEvals') {
      return ok(savePeerEvals(body));
    }
    if (action === 'exportEvaluations') {
      return ok(exportEvaluations(body));
    }
    if (action === 'sheetUrl') {
      return ok({ ok: true, url: SS.getUrl() });
    }
    return err('unknown action: ' + action);
  } catch (ex) {
    return err(String(ex));
  }
}
