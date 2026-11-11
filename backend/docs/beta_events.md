# 베타 분석 기록(beta_events) — 11/11 미르 결정

11/13 베타의 수집 항목(「왜곡_베타테스트_수집항목 v1.1」 2-2절)을 실제로 모으기 위한 별도 수집 경로다.
**세진님과 사전 조율 없이 미르 결정으로 넣었다 — 베타 뒤 검토 · 정리 대상.**

## 무엇이 바뀌나

- 새 표 `beta_events` 하나(Alembic `a3f9c2e7b1d4`, down `d8f2a6c4e1b9`). 기존 표 변경 없음, 외래 키 없음.
- 새 API 두 개. 기존 API 의 동작 · 응답은 바꾸지 않았다.
  - `POST /api/v1/beta-events` — 게임 화면이 분석 기록을 묶어서 보낸다.
  - `GET /api/v1/admin/beta-events` — 관리자 내보내기(열람 기록을 `admin_audit_logs` 에 남김).
- 설정 두 개: `BETA_EVENTS_ENABLED`(기본 true) · `RATE_LIMIT_BETA_EVENTS`(기본 IP 당 60초 1500회).

## POST /api/v1/beta-events

- 본문 `{"events": [...]}` 1~50개, 전체 64KB 이하(넘으면 413). `application/json` · `text/plain` 둘 다 받는다 — 페이지를
  떠날 때의 keepalive 요청을 CORS 사전 요청 없이 보내려고 text/plain 으로 온다. 본문을 직접 읽어 Pydantic 으로 검사한다.
- Origin 검사는 플레이 API 와 같다(`require_play_origin`, 운영은 www · play 만). 403.
- 주인은 쿠키로만(`resolve_play_principal` — 로그인 → 게스트, 둘 다 없어도 받는다). 본문의 사용자 id 는 무시한다.
- 형식이 틀리면 묶음 전체 422(보낸 값 `input` 은 되돌려 주지 않는다). 부분 저장 없음.
- 저장은 `INSERT IGNORE` — 같은 `event_id`(재전송)는 유일 색인에 걸려 건너뛰고 `duplicates` 로 센다.
  길이 · 형식은 앞에서 모두 검사하므로 IGNORE 가 숨기는 것은 중복뿐이다.
- `BETA_EVENTS_ENABLED=false` 면 저장하지 않고 200 `{"accepted":0,"duplicates":0,"disabled":true}`. 게임 화면은 이 응답을
  받으면 그 페이지에서 그만 보낸다(계측 끄기 스위치).
- 요청 빈도: 기존 `request_rate_limit` 에 규칙 `beta_events` 추가. 교실 하나가 같은 IP 로 나가도 막히지 않게 넉넉히 뒀다.

## 필드

event_id(UUID, 필수) · type(11종 중 하나, 필수) · client_ts(ISO, 필수 — UTC 로 바꿔 저장) · phase · pc(참여 코드
`^[A-Z0-9-]{4,16}$`) · run_id · run_index · tab_id · seq · objective_id · page · build · data(JSON 2048바이트 이하).
알 수 없는 필드는 무시한다.

## 세진님이 볼 것(베타 뒤)

- 운영 DB 반영: 새 표 생성뿐이지만 배포 때 migration 이 자동으로 돈다(deploy-backend). 표가 커지면 보관 기간 · 정리.
- 예상 부하: 참가자당 약 10초마다 1회 묶음 전송 + 화면 숨김 · 이탈 때 1회. 100명이면 초당 10건 안팎의 작은 INSERT.
- 워커가 여러 개가 되면 빈도 제한은 워커마다 따로 센다(기존 규칙과 같은 전제).
- 시험: `tests/test_beta_events.py`(단위) · `tests/test_beta_events_mysql.py`(격리 MySQL — 실행 조건은 파일 머리말).

## 게임 화면이 보내는 기록(src/beta · naju01/src/beta)

참여 코드(`?pc=`)로 들어온 브라우저에서만 보낸다(코드 없는 일반 이용자는 보내지 않는다). 코드는 같은 출처 localStorage 에
보관하고 주소에서는 지운다. 보내지 못한 기록은 localStorage 대기열(최대 300)에 남겨 같은 event_id 로 다시 보낸다.
계측 오류는 밖으로 던지지 않고, 게임은 전송을 기다리지 않는다. 빌드 변수 `VITE_BETA_LOG=off` 로 끈다.

| type | phase | 어디서 | 지표 |
|---|---|---|---|
| beta_entry | open · blocked | 본편 · 나주 엔트리(브라우저 · OS · 화면 대략) | L01 · L16 |
| stage_reached | tutorial · headquarters · train · naju(gameSave.setGameStage) · naju_ready(시작 카드) · naju_controllable(첫 조작) · load_done(로딩 막 준비 · 시간 초과) | 본편 · 나주 | L01 · L14 |
| run_state | start · resume · new_run · restart · released · dawn · quit · lobby | 나주 App · restartNaju · gutState · exitGame · leaveToLobby | L02 · L17 |
| objective_state | available(그 회차에서 처음 지금 목표) · focus · complete(실시간만) · progress(바위 위) · rite | najuBeta 1초 확인 | L03 · L04 |
| puzzle_attempt | fail(알림 · 안내판 추정) · sent_back · correct · incorrect · already_completed · send_failed(서버 판정) | gameObserver · progressRuntime | L07 |
| help_event | request(보기 고름) · received(helpLog) · answer_seen | director · helpLog | L08 · L09 |
| npc_turn | request · response(has_reply · reply_source · fallback_reason · rtt_ms) · error | companionApi.postNpcTurn | L11a · L11b |
| story_exposure | heard(의뢰 · 인연 이야기 줄, 근거 줄 evidence) · skipped | FirstSceneActors | L10a |
| activity_snapshot | interval(15초) · hidden · restart · quit · lobby | najuBeta | L04 · L06 · L17 |
| client_error | uncaught · unhandled_rejection · webgl_lost · save_failed · submit_failed | betaBoot · gameSave · progressRuntime | L13 |
| survey_link | shown · opened · dismissed_done · dismissed_later | 설문 카드 · 멈춤 메뉴 | L19 |

모든 나주 기록에 `run_id` · `run_index`(처음부터 다시가 성공하면 +1)와 `data.active_ms`(조사 시계 — 창 · 멈춤 · 게임 밖 제외)를 붙인다.
오류 문장은 주소 · 긴 토큰 모양을 지우고 160자로 자른다. 대화 원문 · 정답 원문 · 계정 정보는 보내지 않는다.

## 운영(미르)

- 참여 코드 · 개인 링크: `node tools/beta/make-codes.mjs <개수> <출력.csv>` — 이름 · 연락처 배정표는 따로.
- 설문 폼 주소: `src/beta/betaSurvey.ts` 의 `BETA_FORMS` 또는 빌드 변수 `VITE_BETA_FORM_PRE` · `VITE_BETA_FORM_POST_A` ·
  `VITE_BETA_FORM_POST_B` · `VITE_BETA_FORM_EXIT`(구글 폼 미리 채운 링크에서 코드 칸 값을 `{pc}`, 회차 칸을 `{run}` 으로).
  비어 있으면 설문 안내는 뜨지 않는다(기록은 그대로 쌓인다).
- 내보내기: 관리자 계정으로 로그인한 브라우저에서 `https://<api>/api/v1/admin/beta-events?limit=10000`(다음 쪽은 `after_id`).
- 집계: `node tools/beta/beta-report.mjs <출력 폴더> <내보낸.json …> [--codes 코드.csv]` → summary.md · objectives.csv · events.csv.

## 세진님 PR #117(베타 퍼즐 통계 · 읽기 전용 SQL)과의 관계

- #117 은 기존 `interaction_events` 로 P01 · P03 · P07 · P09 를 센다. 이 기록은 그것을 대신하지 않고 옆에 붙는다 — 서버 판정 결과는
  `puzzle_attempt`(data.source=server)에 `client_event_id` 를 같이 남겨 `interaction_events.client_event_id` 와 맞춰 볼 수 있다.
- 서버 밖에서만 보이는 것(로컬 퍼즐 실패 추정 · 목표 도달 · 활성 시간 · 이탈 위치 · 로딩 · 오류 · 게스트)은 이 기록에만 있다.
- #117 의 주의(P03 의 `incorrect` 는 항아리를 놓을 때마다 생기는 판정)는 여기 `puzzle_attempt` 의 P03 결과에도 그대로 적용된다.
