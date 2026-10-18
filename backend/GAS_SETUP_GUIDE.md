# Google Apps Script (GAS) & 구글 시트 연동 가이드

본 문서는 점심 메뉴 투표 웹 서비스(v4.0.0 Production Baseline)와 구글 스프레드시트를 연동하여 실시간 데이터베이스로 활용하는 가이드입니다.

---

## 1. 구글 스프레드시트 생성

1. [Google Sheets](https://sheets.new)에 접속하여 새 스프레드시트를 만듭니다.
2. 스프레드시트 제목을 `점심 메뉴 투표 DB` 등으로 지정합니다.

---

## 2. Google Apps Script 코드 작성

1. 구글 스프레드시트 상단 메뉴에서 **확장 프로그램 (Extensions) -> Apps Script**를 클릭합니다.
2. 기본 생성된 `Code.gs` 내용을 모두 지우고, 본 프로젝트의 [`backend/Code.gs`](Code.gs) 파일의 전체 내용을 복사하여 붙여넣습니다.
3. 상단의 저장 아이콘(💾)을 클릭하여 스크립트를 저장합니다.

---

## 3. 웹 앱(Web App) 배포

1. Apps Script 편집기 우측 상단의 파란색 **배포 (Deploy) -> 새 배포 (New deployment)** 버튼을 클릭합니다.
2. 왼쪽 유형 선택에서 **웹 앱 (Web App)**을 선택합니다.
3. 배포 설정을 다음과 같이 지정합니다:
   - **설명 (Description)**: `Lunch Vote API v4.0`
   - **다음 사용자로 실행 (Execute as)**: `나 (Me)`
   - **액세스 권한이 있는 사용자 (Who has access)**: `모든 사용자 (Anyone)` *(팀원들이 로그인 없이 투표하기 위해 필수)*
4. **배포 (Deploy)** 버튼을 클릭합니다.
5. 계정 액세스 권한 승인 팝업이 뜨면 Google 계정으로 로그인 후 **고급 -> 이동(안전하지 않음)**을 눌러 권한을 허용합니다.
6. 배포가 완료되면 생성된 **웹 앱 URL (Web App URL)**을 복사합니다.
   - 예시: `https://script.google.com/macros/s/AKfycb.../exec`

---

## 4. 웹 애플리케이션에 URL 등록

1. 점심 메뉴 투표 웹 사이트(`index.html`)를 브라우저에서 엽니다.
2. 우측 상단의 **설정 (⚙️)** 버튼을 클릭합니다.
3. 동작 모드를 **Google Apps Script (GAS) 실서버 연동 모드**로 변경합니다.
4. **Google Apps Script Web App URL** 입력창에 복사한 웹 앱 URL을 붙여넣습니다.
5. **설정 저장 및 적용** 버튼을 클릭합니다.
6. 이제 투표를 진행하면 구글 스프레드시트의 `LunchVotes` 시트에 실시간으로 1표씩 원자적(Atomic)으로 누적됩니다!

---

## 5. 아키텍처 및 무결성 보장 원리

- **LockService (10,000ms)**: 동시 투표가 몰려도 트랜잭션 락을 통해 분실 업데이트(Lost Update)를 100% 방지합니다.
- **CacheService (10s UUID Deduplication)**: 불안정한 네트워크로 인한 클라이언트 재전송 요청 시 중복 투표를 차단합니다.
- **KST 서버 시각 반환**: 클라이언트 기기의 시계 왜곡(Clock Drift)을 보정하여 한국 표준시(KST) 자정 기준으로 안전하게 1일 1회 투표를 제한합니다.
- **방어적 널 병합(SRS-FR-003)**: 시트의 셀이 비어있거나 잘못 입력되어도 자동으로 `0표`로 변환하여 렌더링 오류를 차단합니다.
