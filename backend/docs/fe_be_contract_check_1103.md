# FE·BE 계약 점검 (2026-11-03)

실제 FE 호출 코드와 BE OpenAPI·라우터를 맞대어 본 결과다. 추천은 결정 전까지 계약이 아니다.
관리자 인증, G1~G3 승인, 일반 팩 게시 정책은 이 문서에서 정하지 않는다.

## 0. 기준

| 구분 | 기준 | 비고 |
|---|---|---|
| BE | `4ff9e73` (`feat/SJ-npc-pause-pack-1103`) | BE 1103 브랜치(통합 · 소셜 · 승인 저장소 · 런타임 승인 · 나주 상호작용 · 장면)를 모두 포함 |
| BE OpenAPI | `app.main:app.openapi()` (4ff9e73) | 경로 19개. 오류 응답은 OpenAPI에 200/201·422만 적혀 있어 404·409·410·503은 라우터 코드로 확인 |
| 최신 FE | `dcba86d` (`origin/feat/랑-화풍-나주톤`, 11/2) | `feat/나주-ts이식` · `feature/sejin-social-onboarding-dev` · BE 힌트 · NPC 브랜치를 병합한 가장 최근 FE |
| 참고 FE | `origin/dev` `60a0e66` | 위 최신 FE의 소셜 가입 변경이 아직 없다 |

`origin/docs/발표준비`는 위 FE를 포함하지 않는 문서 브랜치라 제외했다.
FE 호출 코드는 세 곳뿐이다: `src/server/api.ts`(게임), `website/src/services/account/*`(사이트 인증), `naju01/src/loaders/packSource.ts`(나주 팩, 미사용 경로).

## 1. 요약

| 분류 | 건수 | 가장 급한 것 |
|---|---|---|
| FE 수정 필요 | 7 | F1 `dev` 사이트의 소셜 로그인 응답 해석이 현재 BE와 맞지 않음 |
| BE 수정 필요 | 0 (명백한 버그 없음) · 문서 보강 2 | B1 OpenAPI에 4xx 응답 미기재 |
| PM 결정 필요 | 8 | P1 FE 세션을 버전 고정으로 바꿀지(긴급 중단 · 힌트 · NPC 승인이 고정 세션 기준) |

이번 점검에서 BE 코드는 고치지 않았다. 확인한 불일치는 FE 미구현 · 미반영이거나 정책이 정해지지 않은 항목이다.

## 2. FE 수정 필요

| # | 항목 | FE 근거 | BE 계약 | 필요한 수정 |
|---|---|---|---|---|
| F1 | `dev` 사이트 소셜 로그인 | `origin/dev:website/src/services/account/socialAuthApi.ts` — 응답 최상위의 `email` · `name` · `subject`를 읽어 `${provider}:${subject}`로 사용자 ID를 만든다 | `POST /auth/google` · `/auth/naver` 200은 `{user: {user_id, email, nickname, region, created_at, provider}}` 또는 `{result: "onboarding_required", onboarding_token, expires_in, suggested_nickname, terms_version}` | 최신 FE(`dcba86d`)의 `socialAuthApi.ts` · `SocialOnboardingPage.tsx`가 맞게 고쳐져 있다. **BE를 dev에 넣기 전 이 FE 변경이 dev에 먼저(또는 함께) 들어가야 한다.** 순서가 바뀌면 dev 사이트의 소셜 로그인이 모두 실패한다 |
| F2 | 게임 개발도구 Google 로그인 | `src/server/GoogleSignIn.tsx`(`?dev` 전용) · `api.ts`의 `GoogleUser {name, email, picture}` | 위와 같은 `{user}` / `onboarding_required` | `?dev` 화면에서 이름이 늘 「Google 사용자」로 나오고 이메일이 비며, 처음 온 계정은 가입을 마칠 수 없다. 사이트의 `postSocialAuth`를 쓰거나 PoC를 걷어낸다. 우선순위 낮음 |
| F3 | NPC 턴 | 최신 FE · 원격 전체 브랜치에 `/npc/turns` 호출 없음 | `POST /play-sessions/{id}/npc/turns` — `reply`는 null일 수 있음, `fallback_reason ∈ {NPC_GENERIC_PACK_MISSING, NPC_CONTENT_WITHDRAWN, null}`, `content_mode ∈ {"generic", null}` | 연동 시 반드시: `reply: null`이면 말풍선을 띄우지 않기, `NPC_CONTENT_WITHDRAWN`(=`content_mode: "generic"`)일 때 케이스 대사 · 힌트 제안 UI를 숨기기, `client_event_id` 재전송 시 같은 ID 사용, 409 `CASE_VERSION_UNAVAILABLE` 처리. 세부는 `npc_general_pack.md` §5 |
| F4 | Hint API · 잔액 | 최신 FE 힌트는 바닥 쪽지를 줍는 로컬 힌트함(`src/game/hintBox.ts`, 메모리 배열)뿐이다. 서버 Hint API 호출 · 잔액 표시 없음 | `POST /play-sessions/{id}/hints` `{client_event_id(≤36), target_level: 1\|2, puzzle_id XOR hint_ref}` → `result.hint_balance` · `help_used` · `hint {level, text}`. 잔액 0이면 409 `HINT_BALANCE_EMPTY` | 연동 시 `puzzle_id` · `hint_ref` 중 하나만 보내기(둘 다 · 둘 다 없음은 422), 재시도는 같은 `client_event_id`. 구 경로 `/puzzles/{puzzle_id}/hints`는 호환 별칭(삭제 예정)이라 쓰지 않는다. 잔액 첫 표시는 P3 결정 필요 |
| F5 | 세션 복원 때 번들 | `playSession.ts` 복원은 `GET /cases/{case_id}/bundle`(최신 파일)을 다시 읽는다 | `GET /play-sessions/{id}/bundle`이 그 세션이 고정한 버전의 번들을 준다(레거시 세션은 기본 파일) | 지금 `case_001`(레거시)에서는 결과가 같다. 버전 고정 세션(P1)으로 가면 복원은 세션 번들을 써야 새 버전 콘텐츠와 섞이지 않는다 |
| F6 | 나주 팩 로더 | `naju01/src/loaders/packSource.ts` — 배포본은 `GET /api/v1/packs/{id}` 호출 | BE에 `/packs` 경로 없음 | 주석상 「P2, 백엔드」 예정 경로다. 배포본에서 이 경로를 타면 404다. BE 계약이 생기기 전에는 배포 경로에서 쓰지 않는다(또는 P8에서 계약을 정한다) |
| F7 | 상호작용 재전송 | `submitFireCabinetLock`은 호출마다 `crypto.randomUUID()`로 새 `client_event_id` | BE는 같은 `client_event_id`면 저장 응답을 돌려준다(멱등) | 네트워크 오류 뒤 다시 누르면 새 이벤트로 판정돼 시도 횟수가 두 번 쌓일 수 있다. 실패한 요청을 다시 보낼 때는 같은 ID를 쓰도록 한다. 정답 처리 자체는 `already_completed`로 안전 |

## 3. BE 수정 필요

명백한 BE 버그는 찾지 못했다. 아래는 계약 문서 보강이다(동작 변경 없음, 이번에 고치지 않음).

| # | 항목 | 내용 |
|---|---|---|
| B1 | OpenAPI 오류 응답 (**11/3 처리: `api_error_contract.md`**) | 모든 경로가 OpenAPI에 성공 · 422만 적혀 있다. 실제 오류는 라우터 코드에만 있다(아래 §5 표). FE가 OpenAPI만 보고 붙으면 404 · 409 · 410 · 503 처리를 놓친다. `responses=`로 기재하거나 이 표를 FE 연동 문서로 공유한다 |
| B2 | `detail` 형식 혼재 | 소셜 가입 실패는 `{code, message}`인데 `SocialAuthConflictError`(409)는 문자열 `"Social account login could not be completed."`, 이메일 가입 409는 문자열 비교(`"Email already registered."`)로 FE가 분기한다. 지금 FE와는 맞지만 문구를 바꾸면 FE가 깨진다. `code`로 통일할지는 P7 |

## 4. PM 결정 필요

| # | 결정 | 왜 필요한가 | 근거 |
|---|---|---|---|
| P1 | FE가 세션을 **버전 고정**(`content_version`)으로 만들지 | FE는 `content_version` 없이 레거시 세션만 만든다. 게시 상태 확인(긴급 중단 시 새 세션 409)은 고정 세션에만 걸린다(`create_play_session`: `pinned_content`가 있을 때만 `publication_guard`). 그래서 지금 FE 경로에서는 케이스를 `blocked`로 바꿔도 새 세션이 만들어진다. NPC 케이스 승인 · `hint_ref`(레거시 세션은 409 `HINT_REF_MISMATCH`)도 고정 세션 기준이다 | `play_sessions.py` · `play_session.py:103` · `hint_api_v0410.md` |
| P2 | 정상 NPC 응답의 `content_mode` 값 | 지금은 긴급 중단만 `"generic"`, 나머지 `null`. `"case"` 같은 값은 PM 문서에 없어 만들지 않았다 | `npc_general_pack.md` §5 |
| P3 | 힌트 잔액을 처음 어디서 보여 줄지 | 잔액은 해금 응답에만 있다. `GET /play-sessions/{id}` · 세션 생성 응답의 `state`에는 `hint_balance` · `help_used`가 없어 해금 전 · 새로고침 뒤 잔액을 알 길이 없다. 읽기 응답에 더할지(BE 추가 작업), 첫 해금 전엔 표시하지 않을지 결정 | `PlaySessionState` 스키마, `hint_balance_v049.md`(초기 N=3도 🔴 확정 대기) |
| P4 | 로컬 힌트함과 서버 Hint API의 관계 | FE 힌트함은 쪽지 실물을 줍는 연출이고 서버 Hint API는 잔액을 쓰는 단계 해금이다. 둘을 함께 둘지 · 바꿀지 | `src/game/hintBox.ts`, `hint_api_v0410.md` |
| P5 | 나주 퍼즐의 서버 연동 범위 · ID | §6. 나주 FE는 서버를 전혀 부르지 않고, BE에는 나주 콘텐츠(번들 · server.json · idmap 게시본)가 없다 | §6 |
| P6 | 네이버 콜백 주소 | FE는 `window.location.origin + "/로그인/콜백"`(`ROUTES.socialCallback`)을 `redirect_uri`로 보내고 BE는 설정 `NAVER_REDIRECT_URI`로 토큰을 교환한다. 배포 도메인마다 두 값과 네이버 콘솔 등록값이 같아야 한다 | `naverAuth.ts:20`, `auth.py` |
| P7 | 오류 `detail`을 `{code, message}`로 통일할지 | B2 | `auth.py` |
| P8 | 나주 팩 배포 경로(`/api/v1/packs/{id}`) 계약 | F6 | `packSource.ts` |

관리자 인증 · G1~G3 실제 승인 · 일반 팩 게시 정책은 기존 미결 항목 그대로다(`npc_general_pack.md` §4 · §7). 이 점검은 그 결정을 대신하지 않는다.

## 5. 영역별 대조

### 5.1 Google · 네이버 소셜 로그인 (최신 FE: 맞음)

| 항목 | FE (`dcba86d`) | BE | 판정 |
|---|---|---|---|
| 요청 | google `{credential}`, naver `{code, state}` | `GoogleLoginRequest` · `NaverLoginRequest`(빈 문자열 422) | 일치 |
| 기존 회원 | `{user}` → `toSessionUserFromBackend`(provider `local\|google\|naver` 검사) | `SocialUserResponse {user: SocialAccountUser(provider google\|naver)}` | 일치 |
| 처음 온 계정 | `result === "onboarding_required"`와 토큰 · `expires_in>0` · 닉네임 · `terms_version` 검사 | `SocialOnboardingRequiredResponse` (`expires_in` 600) | 일치 |
| 401 / 422 | 「응답이 올바르지 않음」 | 잘못된 credential · code · 프로필 401 | 일치 |
| 409 | `account_link_required` → 기존 방법 안내, 그 밖 409 → 일반 문구 | `{code: account_link_required}` · 문자열 detail(경합) | 일치 |
| 502 / 503 | 「계정 정보를 확인하지 못함」 / 「준비 중」 | 네이버 교환 · 프로필 실패 502, 키 미설정 503 | 일치 |
| `Cache-Control` | — | 성공 · 실패 모두 `no-store` | — |

`dev` 사이트는 이 표와 맞지 않는다(F1). 게임 `?dev` PoC도 맞지 않는다(F2).

### 5.2 소셜 가입 완료 `POST /auth/social-onboarding/complete` (맞음)

FE 요청 `{onboarding_token, nickname(NFKC·trim), terms_version(서버가 준 값), consent: {terms, privacy, age}}` — BE `extra="forbid"`, `StrictBool`과 일치. 성공 201 `{user}`.

| 상태 · code | BE 발생 조건 | FE 동작 |
|---|---|---|
| 401 `invalid_onboarding_token` | 형식 아님 · 없음 · 만료 | restart(소셜 로그인부터) |
| 409 `onboarding_token_used` | 이미 쓴 증표 | restart |
| 409 `terms_version_mismatch` | 약관 판 변경 | restart |
| 409 `account_link_required` | 같은 이메일 계정 있음 | restart + 기존 방법 안내 |
| 409 `nickname_unavailable` | 닉네임 중복(경합 포함) | 같은 화면에서 닉네임만 다시 |
| 422 `invalid_nickname` | 정책 위반 · 형식 오류(검증 오류도 이 code로 바뀜) | 닉네임만 다시 |
| 422 `consent_required` | 필수 동의 누락 | retry |
| 422 `invalid_input` | 그 밖의 형식 오류(입력값을 되돌려 보내지 않음) | retry |
| 409 문자열 detail | 계정 생성 경합(`SocialAuthConflictError`) | retry(일반 문구) |

닉네임 규칙(제어 문자 거절 → NFKC · trim → 2~12자 → `[가-힣A-Za-z0-9_]`)도 FE 사전 검사와 같다. BE만 금칙어를 더 본다(422 → FE 닉네임 오류).
이메일 가입의 약관 판은 FE 상수 `TERMS_VERSION = "2026-09"`로 보내는데 BE `CURRENT_TERMS_VERSION`도 `"2026-09"`다. 약관 개정 때 두 곳을 함께 바꿔야 한다(소셜 가입은 서버 값을 돌려보내 문제없음).

### 5.3 NPC (`content_mode` · `NPC_CONTENT_WITHDRAWN` · `reply: null`) — FE 미연동

| 상황 | BE 응답 |
|---|---|
| 정상 | `reply {source, text, line_id?}` 또는 null, `content_mode: null` |
| 긴급 중단 + 승인된 일반 팩 | `reply {source: "approved_line", line_id: "GENERIC_PAUSE_0n"}`, `suggest_hint: null`, `fallback_reason: "NPC_CONTENT_WITHDRAWN"`, `content_mode: "generic"` |
| 긴급 중단 + 승인 팩 없음(현재 운영) | `reply: null`, 위와 같은 `fallback_reason` · `content_mode` |
| 고정 버전 사용 불가 | 409 `CASE_VERSION_UNAVAILABLE` |
| 같은 `client_event_id`에 다른 본문 | 409 |

FE 호출 코드가 없어 불일치는 없지만 연동 전 F3 · P1 · P2가 필요하다. 공식 팩의 실제 승인 기록은 없다(테스트 승인은 격리 DB의 가상 기록).

### 5.4 Hint API — FE 미연동

| 항목 | BE |
|---|---|
| 정식 경로 | `POST /play-sessions/{id}/hints` (`extra="forbid"`) |
| 성공 | `{interaction_id, result: {result_type: hint_unlocked\|already_unlocked, puzzle_id, hint_level, state, state_changes, hint_balance, help_used}, hint: {level, text}}` |
| 오류 | 409 `HINT_BALANCE_EMPTY`(차감 없음), 409 `CASE_VERSION_UNAVAILABLE`, 409 `HINT_REF_MISMATCH`, 404, 422 |
| 긴급 중단 | 기존 세션의 해금은 계속 된다(PM v0.4.6 §3, 11/3 격리 MySQL 확인) |

FE는 서버 힌트를 쓰지 않는다(F4). 잔액 첫 표시는 P3.

### 5.5 익명 세션 · PlaySession · Interaction (`case_001` 소화전 자물쇠: 맞음)

| FE 호출 | BE | 판정 |
|---|---|---|
| `POST /anonymous-sessions` → `data.anonymous_session_id` | 201 `{success, data: {anonymous_session_id, expires_at}}` | 일치(`expires_at`은 FE가 안 씀) |
| `POST /play-sessions {anonymous_session_id, case_id}` | 201. 404 익명 세션 없음 · 410 만료 · 409 `CASE_VERSION_UNAVAILABLE` · 422 · 404 케이스 없음 | FE는 404 · 410이면 익명 세션을 새로 만든다 — 일치. `content_version`은 보내지 않음(P1) |
| `GET /play-sessions/{id}` → `case_id`, `completed_at`, `state.completed_puzzle_ids`, `state.flags` | 200 `PlaySessionReadData`, 404 | 일치. 404면 기록을 지우고 새로 만든다 |
| `GET /cases/case_001/bundle` → `entry_zone_id == ZONE_SECRET_CORRIDOR`, `OBJ_FIRE_CABINET_LOCK.interaction.type == "input"` | `case_001.client.json`과 같음 | 일치(복원 때는 F5) |
| `POST /interactions {client_event_id(UUID), client_timestamp(ISO, Z), zone_id, action: "input", target_type: "object", target_id, payload: {answer}}` | `InputInteractionRequest`(`extra="forbid"`, 시간대 필수) → `result_type ∈ {ok, correct, incorrect, already_completed}` | 일치. `correct` · `already_completed`면 세션을 다시 읽는다 |
| 플래그 `fire_cabinet_unlocked` · 퍼즐 `PUZZLE_FIRE_CABINET_LOCK` | `case_001.server.json`에 있음 | 일치 |

### 5.6 FE가 쓰지 않는 BE 경로

`/auth/register` · `/login` · `/email-exists` · `/nickname-exists`는 사이트가 쓴다(맞음). 게임 FE가 쓰지 않는 것: `GET /play-sessions/{id}/clues`, `GET /play-sessions/{id}/bundle`, `/npc/turns`, `/hints`, 구 힌트 경로.

## 6. 나주 퍼즐 9종 — FE Object ID와 서버 콘텐츠 ID

현재 서버 쪽 사실:
- BE 저장소에 나주 콘텐츠가 없다. 서버가 실제로 판정하는 케이스는 `case_001`뿐이다(`backend/app/content/cases/`).
  BE의 나주 관련 코드는 idmap 스키마 · 검증(`naju_idmap.py`, `idmap_validation.py`)과 게시 게이트의 테스트 입력뿐이다.
- 나주 FE(`naju01/src`, `src/naju`)는 플레이 세션 · 상호작용 API를 부르지 않는다. 퍼즐 상태는 모두 FE 메모리다.
- 유일한 ID 대응표는 PM 초안 `docs/naju/naju-angam-01.idmap.draft.json`(FE 브랜치, `naju-idmap/0.1-draft`, 10/27)이다.
  출처 커밋 `11e4b67`이라 최신 FE(`dcba86d`)보다 오래됐다. 퍼즐 10개(`PUZZLE_ANGAM_01~10`, 이야기 추론형)는 모두 `local: null`이라
  아래 FE 기믹 퍼즐과 연결이 없고, Object 13개 중 FE `registerInteractable` ID와 같은 이름은 없다.

| # | 퍼즐 | 실제 FE Object ID(`registerInteractable`) | FE 완료 신호 | 초안 idmap 대응 | 서버 ID |
|---|---|---|---|---|---|
| 1 | 통발 줄 당기기 | `fish-trap-{i}`, `fish-trap-stake-{i}` (`FishTrapPuzzle.tsx`), 미끼 `clam-spot` · `clam-hoe` · `clam-pick` | `fishTrapPuzzle` `idle→full→pulled→lit→told` | `씬1.통발#0..2` → `OBJ_S1_FISH_TRAP_0..2`(이름만 비슷, 말뚝은 없음) | 없음 |
| 2 | 돌탑 기우제 | `ritual-cairn-{i}`, `ritual-table`, 뒤이어 물에 뜬 돌 `float-stone-0..3`(넷을 건지면 강물이 갈라짐) | `ritual` `cairns→…→parted→cave→cleared` | `씬1.돌탑#0` → `OBJ_S1_CAIRN_0`(1개뿐) | 없음 |
| 3 | 독 물방울 항아리 | `cave-jar` (`AirStations.tsx`) | 기울임 1회 · `gearStone` 생성(stage 없음) | 없음 | 없음 |
| 4 | 진주 빛 잇기 | `cave-source-pearl`, `cave-clam-{k}`, `cave-big-clam` | 빛 도달 → `bigPearl` 획득 | 없음 | 없음 |
| 5 | 고리문 물레 | `cave-float-{k}`, `cave-valve`, `cave-valve-rim-{i}`, `cave-gear-{k}`, `cave-tablet`, `cave-door` | 문 열림 | 없음 | 없음 |
| 6 | 석실 받침 | `cave-pedestal-0..3`, `cave-altar`, `cave-socket`, `cave-scale`, `cave-exit` (`InnerChamber.tsx`) | 받침 순서 달→배→구렁이→바위 → `bigPearl` 비춤 → `scale` 획득 | 없음 | 없음 |
| 7 | 장승 고리 | `ridge-post-ring-{i}` (`GateAltar.tsx`) | `ridgeQuest.postsSolved` | 없음 | 없음 |
| 8 | 걸상 다섯 | 걸상별 ID 없음 — 발 위치 판정 + [C] 키. 등록 ID는 평상 글 `ridge-platform-story`뿐 (`StumpStairs.tsx`, 「씬2.걸상」 모양을 빌려 다섯 개를 다시 그림) | 해·달·물결·새·불 차례 → `ridgeQuest.stairs` | `씬2.걸상` → `OBJ_S2_STOOL`(인스턴스 없는 묶음) | 없음 |
| 9 | 돌새 마주 보기 | `ridge-statue-{k}` (`RidgeBirds.tsx`), `ridge-jar-reflection`, `ridge-fossil` (`BirdHints.tsx`) | `birdsFacing` → `scaleSet` → `ridge` `awakening` | `씬2.솟대#2` → `OBJ_S2_SOTDAE_2`(0·1번은 FE가 숨기고 다시 그림) | 없음 |

11/2 조사 초안(`나주_퍼즐9종_상세ID매핑_초안.md`)과 다른 점:
- 석실 받침: 초안은 「단일 ID · 완료 callback 미확인」이었지만 `InnerChamber.tsx`에 `cave-pedestal-0..3` 등 등록 ID와 정답 순서(`ORDER`)가 있다.
- 돌새: 초안은 「register ID 없음」이었지만 `ridge-statue-{k}`가 있다.
- 걸상 다섯: 다섯 개는 코드에서 확인된다(`SYMBOLS` 5 · `CARVED` 5). 다만 걸상마다 상호작용 ID가 없어 서버 Object로 옮기려면 FE 쪽 ID가 먼저 필요하다.
- 9종 밖 FE 퍼즐도 있다: 항아리 자리(`jar-{i}`, `jar-slot-{s}`, `jarPuzzle locked→open`), 막걸리 배 병(`boat-bottle-broken-{i}`), 물고기 굴(`cave-burrow-*`), 전설 흔적(`legend-*`), 능선 수레 · 함(`ridge-cart*`, `ridge-chest*`, `ridge-jige-*`, `ridge-box-lock`). 9종 목록에 넣을지 P5에서 정한다.

후속(1103): 최신 FE `5f88aa6` 기준 FE ID 목록 · idmap 개발판 · 9종 대응표와 빈칸은 `backend/content_drafts/naju/README.md`(게시 · 등록 금지 골격).

나주를 서버에 붙이려면(P5): 최신 FE 커밋 기준 idmap 재작성 → 퍼즐마다 서버 완료 시점 · 상태 delta 결정 → `client/server/npc/idmap` 게시본과 fingerprint → 게시 게이트 통과 → FE 어댑터. 지금 어떤 후보 ID도 API에 쓰면 안 된다.

## 7. 확인 방법

- BE: 4ff9e73에서 `app.openapi()`를 뽑아 경로 · 요청 · 응답 스키마를 대조했다. 오류 코드는 `app/api/v1/*.py`의 `HTTPException`을 읽었다.
- FE: `git show origin/feat/랑-화풍-나주톤:<파일>`로 호출 코드를 읽었다(FE 브랜치 · 작업 트리는 바꾸지 않음).
  원격 브랜치 전체에서 `/npc/turns` · `/hints` · `hint_ref` 호출을 찾았고 없었다.
- 나주: `naju01/src/puzzles/**`의 `registerInteractable({ id })`와 상태 모듈을 읽고, 초안 idmap JSON과 대조했다.
- 실행 시험은 하지 않았다(코드 변경 없음). BE 회귀는 4ff9e73 기준 pytest 2,086 passed / 123 skipped, 격리 MySQL 122 passed다.
