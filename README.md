# 🏐 SpikeLog Pro

> 배구 경기 기록 & 수행평가 관리 앱  
> *Volleyball Performance Tracker for PE Classrooms*

체육 수업과 학교 대회에서 배구 경기를 실시간으로 기록하고, 학생 수행평가까지 관리하는 웹 앱입니다.

---

## ✨ 주요 기능

- **실시간 경기 기록** — 스파이크/서브/블로킹/리시브 등 상세 기록
- **3-Mode 운영** — 솔로 / 협업(다기기 동시 기록) / 공유(읽기 전용)
- **대회(리그) 관리** — 자동 일정 생성(풀리그), 실시간 순위표
- **수행평가 산출** — 서브, 리그 성적, 동료평가 통합 점수
- **Google Sheets 연동** — 명단 관리 + 경기/평가 결과 자동 백업
- **세트제 지원** — 단판 / 3전 2선승 / 5전 3선승
- **반응형 UI** — 교사 노트북 + 학생 태블릿/폰 동시 사용

---

## 🛠 기술 스택

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS 4
- **Realtime DB**: Firebase Realtime Database
- **Sheets**: Google Apps Script (Web App)
- **Hosting**: GitHub Pages
- **Icons**: Lucide

---

## 🚀 시작하기

### 로컬 실행

```bash
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

### 빌드 & 배포

```bash
# 빌드
npm run build

# GitHub Pages 배포
npm run deploy
```

---

## ⚙️ Firebase 설정

`src/lib/firebase.ts` 안의 Firebase 설정값을 본인의 프로젝트로 교체하세요.

Realtime Database 보안 규칙 예시:
```json
{
  "rules": {
    "spikelog": {
      "$sessionId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

---

## 📊 Google Sheets 연동 (선택)

1. Google Drive → 새 스프레드시트 생성
2. 확장 프로그램 → Apps Script
3. `Code.gs` 내용 전체 붙여넣기
4. 배포 → 새 배포 → 웹 앱 (액세스: 모든 사용자)
5. 생성된 URL을 앱 설정 화면에 입력

시트 자동 생성:
- `명단` — 통합 선수 명단
- `[팀이름]` — 팀별 명단
- `경기기록`, `선수기록`, `동료평가`, `평가결과`

---

## 📁 프로젝트 구조

```
spikelog-pro/
├── src/
│   ├── App.tsx                # 메인 앱 컴포넌트
│   ├── main.tsx               # 진입점
│   ├── types.ts               # 타입 정의
│   ├── index.css              # 전역 스타일 (light theme)
│   └── lib/
│       ├── firebase.ts        # Firebase 설정 + 세션 관리
│       ├── useFirebaseSync.ts # RTDB 동기화 훅
│       ├── useGameLogic.ts    # 경기 로직 (득점, 교체, 로테이션)
│       ├── session.ts         # 세션 ID/모드
│       ├── stats.ts           # 통계 계산
│       ├── events.ts          # 대회/리그 로직
│       ├── gas.ts             # Google Apps Script 클라이언트
│       └── utils.ts           # 유틸리티 (cn, etc.)
├── Code.gs                    # Google Apps Script 백엔드
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🎯 평가 산출 공식

- **서브 점수** (20점) = ((ace×2 + ok) / total) → 20/17/14/11점
- **리그 점수** (20점) = (wins×3 / games) → 20/17/14/11점
- **수행평가** (40점) = 동료평가 평균 → 40/34/28/22점
- **경기기록** (20점) — 기본 부여
- **총점** = /100

---

## 📜 라이선스

MIT License

---

## 🏫 개발 배경

이 앱은 인천영종고등학교 체육 수업의 배구 단원 운영을 위해 만들어졌습니다.  
교실 단위 리그 운영, 실시간 다기기 기록, 자동 평가 산출을 목표로 합니다.

**Made with vibe coding 🤖✨**
