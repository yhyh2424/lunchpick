# 실시간 점심 메뉴 투표 웹 서비스 (Lunch Menu Voting Service)
### v4.0.0 Production Zero-Defect Baseline with Atomic Increment & A11y

> **표준 규격 준수**: IEEE Std 830-1998 / ISO/IEC/IEEE 29148:2018 / ISO/IEC/IEEE 29119 / WCAG 2.1 AA

---

## 📌 1. 프로젝트 개요 (Overview)

팀과 조직 구성원들이 매일 점심 메뉴를 결정할 때 겪는 결정 피로와 시간 소모를 해결하기 위해 설계된 초고속 실시간 투표 단일 페이지 애플리케이션(SPA)입니다.
Google Apps Script(GAS)를 API 프록시로 활용하여 Google Sheets에 실시간 원자적(Atomic) 증분을 수행하며, 클라이언트의 시간 왜곡(Clock Drift) 보정 및 UUID 기반 멱등성을 보장합니다.

---

## 📋 2. PRD & SRS v4.0 요구사항 매핑 및 구현 현황

| 분류 | 요구사항 ID | 핵심 내용 | 구현 상태 | 관련 코드 위치 |
| :--- | :--- | :--- | :---: | :--- |
| **메뉴 구성** | **FR-1.1** | 고정 4개 메뉴 (제육볶음, 짜장면, 돈가스, 국밥) | ✅ 완료 | [`js/config.js`](js/config.js) |
| **선택 및 인터랙션** | **SRS-FR-001** / **FR-1.2** | 300ms 디바운스, 최소 48x48px 터치 영역, 선택 시 `--color-primary` (`#D04A37`) 테두리 및 웜톤 배경 (`#FFF3ED`), `2px solid #1A5276` 포커스 링 | ✅ 완료 | [`css/styles.css`](css/styles.css), [`js/app.js`](js/app.js) |
| **원자적 투표 & Optimistic UI** | **SRS-FR-002** / **FR-1.3** / **NFR-1** | 투표 버튼 클릭 즉시 로컬 카운트 +1 (0ms 체감 지연), 버튼 hover scale (`translateY(-2px)`), 스피너 애니메이션, 고유 `UUIDv4` (`X-Request-ID`) 전송 | ✅ 완료 | [`js/state.js`](js/state.js), [`js/app.js`](js/app.js) |
| **방어적 텔레메트리** | **SRS-FR-003** / **TC-DATA-001** | 구글 시트의 빈 셀 또는 비숫자 셀을 정수 `0`으로 방어적 매핑 (`0표` 렌더링) | ✅ 완료 | [`js/state.js`](js/state.js), [`backend/Code.gs`](backend/Code.gs) |
| **멱등성 및 부정 투표 방지** | **SRS-FR-004** / **FR-3.2** / **FR-3.3** | 서버 KST 시간 기준 `lunch_vote_token_YYYY-MM-DD` 발급, 클라이언트 시계 왜곡 보정, 10초 멱등성 윈도우, 자정(00:00 KST) 리셋 | ✅ 완료 | [`js/state.js`](js/state.js), [`js/api.js`](js/api.js) |
| **멀티탭 동기화** | **FR-3.4** | `window.addEventListener('storage', ...)`로 다른 탭의 투표 상태 실시간 동기화 | ✅ 완료 | [`js/state.js`](js/state.js) |
| **트랜잭션 롤백 & 폴백** | **SRS-FR-005** / **NFR-3** / **TC-ERR-001** | 네트워크 타임아웃(>=5000ms) 또는 락 고갈(>10s) 시: (1) 로컬 -1 롤백, (2) UI 활성화, (3) 토스트: `'현재 대기자가 많습니다. 3초 후 다시 시도해 주세요.'`, (4) 백그라운드 재동기화 | ✅ 완료 | [`js/app.js`](js/app.js), [`js/state.js`](js/state.js) |
| **실시간 순위 뱃지** | **FR-2.2** | 최다 득표 메뉴에 '1위' (1st Place) 다이내믹 뱃지 부여 | ✅ 완료 | [`js/app.js`](js/app.js), [`css/styles.css`](css/styles.css) |
| **접근성 & 디자인 시스템** | **NFR-4** / **WCAG 2.1 AA** | 명도 대비 4.8:1 (`#D04A37`), 키보드 접근성, 다크 모드 (`#121212`, `#1E1E1E`), 반응형 4열/2x2 그리드 | ✅ 완료 | [`css/styles.css`](css/styles.css), [`index.html`](index.html) |
| **동시성 락 & 구글 시트** | **FR-3.1** | `LockService.getScriptLock().tryLock(10000)` 및 수식 원자 증분 | ✅ 완료 | [`backend/Code.gs`](backend/Code.gs) |

---

## 🧪 3. ISO/IEC/IEEE 29119 QA 검증 매트릭스

웹 애플리케이션 상단 **[QA 검증]** 버튼을 클릭하면 SRS v4.0 제4장에 명시된 모든 검증 항목을 원클릭으로 자동 실행할 수 있습니다.

| Test ID | 대상 요구사항 | 테스트 제목 | 테스트 기법 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-NAV-001** | SRS-FR-001 | Selection & Touch Target | State Transition | 타겟 카드 활성화 (`#D04A37`), 최소 48x48px 터치 영역, 포커스 링 표시 |
| **TC-VOTE-001** | SRS-FR-002 | Atomic Increment & UUID | Equivalence Partitioning | 로컬 득표수 +1 즉각 반영 (0ms), 고유 UUIDv4 멱등성 전송 |
| **TC-DATA-001** | SRS-FR-003 | Defensive Null-Coalescing | Boundary Value Analysis | 시트의 빈 셀이나 null을 `0표`로 정상 렌더링 |
| **TC-ABUSE-001** | SRS-FR-004 | Server-Time Idempotency | State Transition | 서버 KST 기준 1일 1회 투표 제한 및 멀티탭 동기화 |
| **TC-EDGE-001** | SRS-FR-004 | Midnight Rollover & Drift | Boundary Value Analysis | 시계 왜곡 보정 및 자정(00:00 KST) 롤오버 시 투표 초기화 |
| **TC-ERR-001** | SRS-FR-005 | Timeout Rollback & Fallback | Fault Injection | 타임아웃(>=5000ms) 시 로컬 -1 롤백, 스피너 닫힘, 지정 토스트 출력 |

---

## 🚀 4. 실행 및 사용 방법

### 옵션 1: 브라우저에서 바로 열기 (설치 불필요)
- [`index.html`](index.html) 파일을 Chrome, Edge 등의 브라우저로 직접 더블 클릭하여 실행합니다.
- 내장된 **무설치 시뮬레이터(Simulator Engine)**가 활성화되어 있어 별도 서버 없이도 즉시 투표, 멀티탭 동기화, 결함 주입 테스트를 체험할 수 있습니다.

### 옵션 2: 로컬 PowerShell 서버 실행
PowerShell 터미널에서 다음 명령을 실행합니다:
```powershell
.\start-server.ps1
```
브라우저가 자동으로 열리며 `http://localhost:8080/`으로 서비스가 구동됩니다.

---

## ☁️ 5. Google Sheets 실서버 배포 및 연동

1. [Google Sheets](https://sheets.new)에서 새 스프레드시트를 생성합니다.
2. 상단 메뉴 **확장 프로그램 -> Apps Script**를 열고 [`backend/Code.gs`](backend/Code.gs) 내용을 붙여넣습니다.
3. **배포 -> 새 배포 -> 웹 앱**을 선택하고 액세스 권한을 **"모든 사용자(Anyone)"**로 설정하여 배포합니다.
4. 생성된 Web App URL을 웹 사이트의 **설정(⚙️)** 창에 입력하면 실제 구글 시트와 실시간 연동됩니다.
- 자세한 내용은 [`backend/GAS_SETUP_GUIDE.md`](backend/GAS_SETUP_GUIDE.md)를 참고하세요.

---

## 📁 6. 프로젝트 디렉토리 구조

```
lunchpick/
├── index.html               # WCAG 2.1 AA 단일 페이지 웹 애플리케이션 (SPA)
├── css/
│   └── styles.css           # 디자인 시스템 토큰, 다크 모드, 반응형 그리드, 애니메이션
├── js/
│   ├── config.js            # 메뉴 4개 정의, 타임아웃, 디바운스, 스토리지 키 설정
│   ├── state.js             # 원자적 증분, Optimistic UI, KST 왜곡 보정, 멀티탭 동기화
│   ├── api.js               # GAS 연동 클라이언트 및 무설치 결함 주입 시뮬레이터
│   ├── app.js               # 메인 컨트롤러, 300ms 디바운스, UI 이벤트 바인딩
│   └── qa-tests.js          # ISO/IEC/IEEE 29119 QA 검증 자동화 테스트 러너
├── backend/
│   ├── Code.gs              # Google Apps Script 프로덕션 백엔드 코드
│   └── GAS_SETUP_GUIDE.md   # 구글 시트 배포 상세 가이드
├── start-server.ps1         # 로컬 개발용 경량 PowerShell HTTP 서버
└── README.md                # 종합 프로젝트 문서
```
