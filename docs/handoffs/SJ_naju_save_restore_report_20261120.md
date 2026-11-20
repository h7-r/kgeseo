# 나주 저장 · 복원 검증 보고 (2026-11-20)

> 갱신(11/20 후속): §5-1 의 백엔드 쪽 막음(`PUT /me/game-save` 선택 필드 `account_id` → `409 account_changed`)을 브랜치
> `fix/SJ-game-save-account-guard-1120`(Draft PR)에 구현 · 시험했다. FE 가 `account_id` 를 보내기 전까지는 막히지 않는다. §5-2 는
> `SJ_naju_save_conflict_fe_design_20261120.md` 에 FE 수정 설계 · 재현 절차.

- 기준: `origin/main` **a9640803** (#178 · #189 포함). PR #54 · #197 은 건드리지 않음.
- 범위: 코드 조사 · 로컬 단위 테스트 · **실제 `gameSave.ts` 를 가짜 서버로 돌린 시나리오 시뮬레이션**. 운영 접근 · 운영 플레이 · 브라우저 E2E 는 하지 않음.
- **판정: 로컬 검증 완료 · 운영 확인 대기. 브라우저 E2E 미실행이라 E2E PASS 아님. 데이터가 섞이거나 사라질 수 있는 위험 2건 발견(§5).**

## 1. 저장 아키텍처

| 층 | 위치 | 역할 |
|---|---|---|
| 서버 | `backend/app/api/v1/me.py` `GET/PUT/DELETE /api/v1/me/game-save` | 쿠키 세션의 회원 한 명에 저장 **한 칸**(slot 0). PUT 은 `revision` 이 서버 번호와 같을 때만 쓰고 +1, 다르면 `409 {detail:{code:"save_conflict", revision}}`. 처음 저장은 revision 0 → 1. 탈퇴 경합 시 401 |
| 클라이언트 공통 | `src/save/gameSave.ts` | 본편 · 나주가 **같은 저장본을 칸(section)으로 나눠** 씀(`naju.*`, `main.*`). 이 페이지가 모르는 칸은 처음 불러온 값 그대로 함께 씀 |
| 상태 | `src/save/saveStatus.ts` | `guest` · `load_failed` · `saving` · `signed_out` · `account_changed`(#189) |
| 불러오기 판정 | `src/save/gameSaveLoad.ts` | 200 → 저장(없으면 새 진행) / 401 → 손님(저장 안 함) / 그 밖 · 연결 실패 · 모양 틀림 → `load_failed`(저장 멈춤 + 안내 — 빈 진행으로 덮지 않음) |
| 나주 연결 | `naju01/src/boot.tsx`(initGameSave 뒤 화면) · `naju01/src/save/NajuSaveBridge.tsx`(칸 등록 · `startGameSaveLoop`) · `naju01/src/save/najuSaveData.ts`(칸 12개: fishTrap · clam · jars · makgeolli · ritual · ridge · ridgeQuest · ridgeCarry · playTime · helpLog · inventory · puzzleMemory) | |
| 끊김 안내 | `src/save/SaveSignedOutNotice.tsx` · `saveStatusText.ts` | 「로그인이 풀렸어요」 · 「로그인했어요」(재개) |
| 진입 제한 | `shared/playLoginGate.ts` | 운영은 로그인한 사람만 들어옴(`https://www.k-escape.com/login?next=/play`) |

## 2. 자동 저장 · 복원 흐름

1. **불러오기**: 페이지 시작 때 `GET /me/game-save` 한 번 → 결과로 상태 결정 → 불러왔으면 `/me` 로 계정 id 를 기억(`accountId`) → 저장된 단계(`getSavedStage`) · 칸 값을 등록 때 바로 넣음(`registerSaveSection` → `apply`).
2. **자동 저장**: 값이 바뀌면 1.5초 모아 한 번(`scheduleGameSave`), 화면이 보이는 동안 10초마다, 창 숨김 · `pagehide` 때 바로(keepalive). 마지막에 쓴 것과 같으면 보내지 않음. 보내는 중 또 부탁받으면 끝난 뒤 최신 값으로 한 번 더.
3. **떠나기 전**: 나주 → 로비 · 「처음부터 다시」는 `saveBeforeLeaving` 으로 저장 성공을 확인한 뒤 이동(실패면 메뉴가 까닭 · 「저장하지 않고 끝내기」).
4. **새로고침 복원**: 새 페이지가 1번부터 다시. `bfcache` 로 되살아난 페이지는 쓰지 않고 새로고침(옛 값으로 덮기 방지).
5. **401(세션 끊김)**: 그 자리에서 `signed_out` — 이후 PUT 없음, 안내 표시. 「로그인했어요」 → `/me` 가 같은 계정이면 `saving` 으로 돌아가 바로 저장(끊긴 동안의 진행 포함), 다른 계정이면 `account_changed`.
6. **409(번호 충돌)**: `/me` 확인 → 401 이면 `signed_out`, 다른 계정이면 `account_changed`(멈춤), 같은 계정이면 서버 번호로 **한 번 더**(이 창 값이 이김). 또 409 면 서버 번호를 기억해 다음 저장이 맞게(L22).
7. **삭제**: 클라이언트는 서버 저장을 지우는 요청(DELETE)을 보내지 않음. 「처음부터 다시」는 나주 칸을 뺀 저장본을 **다시 씀**(플레이어가 고른 동작).

## 3. 테스트한 시나리오 · 결과

### 3.1 기존 자동 테스트(main 사본, 설치 없이)
| 테스트 | 결과 |
|---|---|
| `node --test naju01/tests/*.test.ts` | **358/358 통과**(#189 의 `saveStatus.test.ts` · `gameSaveLoad.test.ts` 포함 — 상태 저장소 · 응답 판정 · 소스 검사 수준) |
| `web:test` | 114/114 통과 |
| `tsc -p naju01` | 오류 0 |

### 3.2 시나리오 시뮬레이션(새로 작성, 저장소에 넣지 않음)
- 방법: **실제 `src/save/gameSave.ts` · `gameSaveLoad.ts` · `saveStatus.ts`** 를 rolldown 으로 묶고(베타 기록 · 주소 설정만 가짜), 가짜 서버(me.py 의 revision/409 규칙을 옮김)와 가짜 쿠키로 돌림. 탭 = 모듈 한 벌.
- 파일: 세진 로컬 임시 하네스(저장소에 넣지 않음 — 같은 시나리오를 FE 자동 테스트로 옮기는 설계는 `SJ_naju_save_conflict_fe_design_20261120.md` §5)
- **브라우저 · DOM · 실제 쿠키 · CORS · keepalive · 타이머 간격은 검증 대상이 아님**(흉내).

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 저장 후 재접속(새 페이지) 시 단계 · 칸 값 복원 | 통과 |
| 2 | 저장 중 401 → `signed_out`, 이후 PUT 없음, 떠나기 전 저장 false, 서버 값은 마지막 성공 그대로 | 통과 |
| 3 | 같은 계정 재로그인 → 「로그인했어요」 → `saving`, 끊긴 동안 진행이 저장됨(로그인 전엔 `signed_out` 유지) | 통과 |
| 4 | 다른 계정 전환(번호 다름) → 409 → `account_changed`, 그 계정 저장 안 덮음 | 통과 |
| 4b | 끊긴 뒤 다른 계정으로 로그인하고 「로그인했어요」 → `account_changed` | 통과 |
| 5 | revision 409 → 같은 계정 → 서버 번호로 재시도 성공, 다음 저장은 409 없이 바로 | 통과 |
| 6 | 저장 없음(GET 200 null) → 새 진행 시작, `saving` | 통과(1 에 포함) |
| 7 | 불러오기 500 → `load_failed`, PUT 0 · DELETE 0, 서버 저장 그대로 | 통과 |
| 발견 1 | 아래 §5-1 재현 | 위험 재현됨 |
| 발견 2 | 아래 §5-2 재현 | 위험 재현됨 |

## 4. 미검증 항목

- 실제 브라우저 E2E(본편 · 나주 화면, 끊김 안내 · 멈춤 메뉴 문구 · 버튼, 포인터 잠금 중 안내 클릭 불가 — #189 남긴 것).
- 실제 쿠키(`__Host-` · Secure · SameSite) · CORS · `credentials: include` 로 운영 API 를 부르는 것.
- `pagehide` keepalive 저장 · 창 숨김 저장 · 10초 간격 · bfcache 새로고침.
- 실제 MySQL 저장(`/me/game-save` 의 동시 첫 저장 IntegrityError → 409 경로)은 기존 백엔드 격리 MySQL 시험이 다룸 — 이번에 다시 돌리지 않음.
- 운영 데이터 · 운영 계정 전부.

## 5. 발견된 버그(위험)

### 5-1. 계정이 바뀌어도 두 계정의 revision 이 같으면 다른 계정 저장을 덮는다 — 중요도: 중~상
- 계정 바뀜은 **409 가 날 때만** 알아챈다(`decideConflictRetry`). 쿠키가 B 로 바뀌었는데 이 창의 revision 이 B 저장의 revision 과 **우연히 같으면** PUT 이 200 으로 성공 → **A 의 진행이 B 계정 저장에 들어가고**, 상태는 계속 `saving` 이라 계속 B 에 씀.
- 가장 흔한 경우: 두 계정 모두 저장이 없다(revision 0) — 예) A 가 막 가입해 첫 저장 전, 같은 브라우저 다른 탭에서 B 로 로그인. 시뮬레이션 「발견 1」로 재현.
- 수정안(코드 미수정, 승인 필요)
  - **BE + FE(권장)**: PUT 본문에 처음 불러온 계정 id 를 함께 보내고(`account_id`, 선택 필드), 서버가 세션 회원과 다르면 `409 {code:"account_changed"}` — FE 는 그대로 `account_changed` 로 멈춤. 서버가 막으므로 번호와 무관.
  - FE 만: 매 PUT 전에 `/me` 확인(요청 2배, 경합 창은 남음) — 비권장.

### 5-2. 409 재시도가 이 페이지가 쓰지 않는 칸을 옛 값으로 되돌린다 — 중요도: 중
- 409 뒤 재시도는 **이 페이지가 처음 불러온 저장본**에 자기 칸만 덮어 보낸다. 그사이 다른 탭(예: 나주)이 자기 칸을 저장했으면, 본편 탭의 재시도가 나주 칸을 **처음 불러온 옛 값으로 되돌린다**(나주 진행 손실). 시뮬레이션 「발견 2」로 재현.
- 조건: 같은 계정으로 본편 · 나주(또는 두 탭)를 **동시에** 열어 둘 다 저장. 한 탭에서 기차 → 나주로 넘어가는 보통 흐름에서는 안 생김.
- 수정안(FE, 승인 필요): 409 를 받으면 `GET /me/game-save` 로 최신 저장을 다시 읽어 **이 페이지가 등록한 칸만 지금 값으로, 나머지 칸은 서버 최신 값으로** 합친 뒤 서버 번호로 PUT. `storedSections` 도 서버 값으로 갱신.

### 그 밖(알려진 것, #189 에 기록됨)
- 처음 `/me` 를 못 읽으면(`accountId` null) 계정 비교를 못 하고 그대로 재시도한다.
- 운영 나주에서 `?dev` 로 개발 표시가 켜짐(`naju01/src/app/runtimeFlags.ts` — DEV 가드 없음).

## 6. 운영 테스트 체크리스트(실행하지 않음 — 승인 필요)

**계정 조건**
- 테스트 전용 회원 계정 **2개**(A · B, `is_test=true`, 베타 참가자 · 팀 실계정 아님). 새로 만들려면 별도 승인 필요(오늘은 금지).
- 각 계정 저장 칸은 하나뿐 — **테스트가 그 계정의 기존 저장을 덮는다.** 기존 진행을 남겨야 하는 계정은 쓰지 않는다.
- 「처음부터 다시」는 나주 진행을 지운다 — 시험 절차에 없으면 누르지 않는다.
- §5-1 재현(계정 전환)은 **B 계정 저장을 A 진행으로 덮는다** — 버리는 테스트 계정으로만, 하려면 미리 승인.

**진입**
- `https://www.k-escape.com/login?next=/play` 로그인 → `https://play.k-escape.com`(본편) → 기차 목적지에서 나주(`/naju01/`). 나주 주소 직접 진입 가능 여부는 확인 필요.

**저장 성공 확인**
- 개발자 도구 Network: `PUT /api/v1/me/game-save` **200**, 응답 `revision` 이 1씩 증가, `stage` = `naju`. 409 가 보이면 그 뒤 재시도 PUT 이 200 인지.
- Console 에 `[저장]` 경고가 없을 것. 멈춤 메뉴 저장 문구가 정상(로그인 안 함 · 끊김 문구가 아님).

**복원 성공 기준**
- 진행(예: 조개 판 · 항아리 · 막걸리) 뒤 새로고침 → 같은 단계 · 같은 퍼즐 상태 · 소지품 · 플레이 시간이 이어짐. `GET /api/v1/me/game-save` 200 의 `revision` 이 마지막 PUT 과 같음.
- 나주 → 로비 → 다시 나주: 진행 유지.

**로그아웃 · 계정 변경**
1. 탭 1 나주 플레이 중, 탭 2(`www`)에서 로그아웃 → 탭 1 에 다음 저장(≈10초 안) 때 「로그인이 풀렸어요」 · 멈춤 메뉴 끊김 문구 · PUT 401.
2. 탭 2 에서 **같은 계정**으로 다시 로그인 → 탭 1 ESC → 「로그인했어요」 → PUT 200 재개, 끊긴 동안 진행 포함(새로고침으로 확인).
3. 탭 2 에서 **B 계정**으로 로그인(두 계정 revision 이 다를 때) → 탭 1 다음 저장에서 409 → `account_changed`, B 저장 그대로(B 로 접속해 확인).
4. 끊긴 채 「로비로 나가기」 → 바로 떠나지 않고 까닭 · 「저장하지 않고 끝내기」 표시.

**실패 시 수집**
- 시각(KST) · 계정 UUID(이메일 X) · 브라우저 · 탭 수 · 하던 단계.
- 실패한 요청의 메서드 · 경로 · 상태 코드 · `detail.code` · 요청/응답의 `revision`(본문 전체 · 쿠키는 복사하지 않음).
- Console `[저장]` 로그, 화면 안내 문구 스크린샷.
- 관리자 베타 기록의 `client_error save_failed`(`game_save_401` · `game_save_409` 등) 시각.

## 7. 후속 조치

| 쪽 | 조치 | 상태 |
|---|---|---|
| BE | PUT `/me/game-save` 에 선택 필드 `account_id` · 다르면 `409 account_changed`(§5-1) — 계약 · 오류 명세 · 격리 MySQL 시험 | 제안(승인 대기) |
| FE | PUT 에 처음 불러온 `accountId` 실어 보내기 · 새 409 code 처리(§5-1) | 제안(BE 와 함께) |
| FE | 409 재시도 전 최신 저장 다시 읽어 칸 합치기(§5-2) | 제안 |
| FE | 시뮬레이션 시나리오(1~7 + 발견 2건)를 `naju01/tests` 같은 자동 테스트로 옮기기(별칭 · import.meta 때문에 묶음 단계 필요) | 제안 |
| FE | 나주 `?dev` 운영 가드 여부(#189 남긴 것) | PM 판단 |
| 운영 | 테스트 계정 2개 준비 · §6 실행 | 승인 대기 |
