# NPC 자동 개입 — PM v0.4.7 반영

기준 브랜치 `feat/SJ-npc-publication-approval-integration`(`1620d6e` 이후).

## 역할 분담

- **BE가 정하는 것:** 개입 여부 · 단계, 퍼즐당 · 세션당 횟수, 쿨다운
- **FE가 정하는 것:** 지금 화면에 보여 줄 수 있는지(대화 중 · 컷 · 거리 등)만. 결과를 표시 · 미표시 · 거절 이벤트로 보고한다.
- 정식 힌트 해금 · 정답 공개는 하지 않는다. 힌트 원문은 Hint API만 다룬다.

## 기본 설정 · 케이스 덮어쓰기

| 항목 | 서버 기본값 | `npc.json.auto_nudge` 필드(제안 이름, PM 확인 필요) |
|---|---|---|
| 연속 오답 | 6회 | `consecutive_incorrect_min` |
| 무입력 | 240초 | `idle_seconds` |
| 퍼즐당 최대 제안 | 2회 | `max_per_puzzle` |
| 세션당 최대 | 제한 없음 | `max_per_session` |
| 제안 사이 쿨다운 | 180초 | `suggestion_cooldown_seconds` |
| 거절 뒤 쿨다운 | 600초 | `decline_cooldown_seconds` |

- `auto_nudge`에 적은 필드만 서버 기본값을 덮어쓴다(`npc_decision.rule_config_for`).
- 값은 1 이상의 정수만 받는다(bool · 문자열 거부). 모르는 필드는 거부한다.
- `auto_nudge`는 npc.json 본문이라 콘텐츠 fingerprint에 들어간다. 바꾸려면 새 콘텐츠 버전 · 승인이 필요하다.
- 무입력 시간에서 컷 · 모달 시간을 빼는 것(PM v0.4.6)은 아직 구현하지 않았다(아래 미연결).

## 판단 순서 (`npc_decision.decide`)

1. 규칙(P3 기준선, rule parity 그대로): 도움 요청 → 연속 오답 ≥ 기준 → 대상 있음 · 무입력 ≥ 기준
2. 거절 쿨다운(600초) → `declined_cooldown`
3. 표시 쿨다운(180초) → `cooldown`
4. 세션 · 퍼즐 상한 → `policy_blocked`
5. 개입(1단계)

## 2단계 개입 (`npc_turn.run_auto_turn`)

| 상황 | 응답 |
|---|---|
| 보여 줄 승인 nudge 있음 | 1단계: 승인 nudge 원문 |
| 연속 오답 · 보여 줄 승인 nudge 없음 · 정식 힌트 있음 · 승인 일반 팩에 `NPC_GENERIC_PUZZLE_02` 있음 | 2단계: 그 안내 문구 + `suggest_hint: {hint_ref}` |
| 위와 같은데 승인 일반 팩 없음 | `reply: null`, `fallback_reason: "NPC_GENERIC_PACK_MISSING"`, `suggest_hint: {hint_ref}` |
| 무입력 · 보여 줄 승인 nudge 없음 | 발화 없음(2단계로 올리지 않음) |

- 「보여 줄 승인 nudge 없음」에는 작성은 됐지만 공개 조건(`reveal_when`)을 아직 못 채운 경우도 들어간다.
- 일반 팩 승인은 기존 규칙(G1~G3 `gate_decisions`)을 그대로 쓴다. PM v0.4.6의 「G3 + 정책 검사」보다 엄격하다(확인 필요).

## 응답 계약 (`POST /api/v1/play-sessions/{id}/npc/turns`)

```json
{
  "npc_event_id": "<제안 ID>",
  "reply": {"source": "approved_line", "text": "…", "line_id": "NPC_GENERIC_PUZZLE_02"} | null,
  "suggest_hint": {"hint_ref": "hr1.<key id>.<43자>"} | null,
  "fallback_reason": "NPC_GENERIC_PACK_MISSING" | "NPC_CONTENT_WITHDRAWN" | null
}
```

- **변경점:** 이전 `suggest_hint: {"puzzle_id": …}`를 `{"hint_ref": …}`로 바꿨다. FE는 아직 이 API에 연결돼 있지 않다.
- **hint_ref:** HMAC-SHA-256(세션 ‖ 퍼즐 ‖ fingerprint) 태그만 담는다. 토큰 안에 퍼즐 ID가 없다(`app.services.hint_ref`).
  - 발급 키 의존성 `get_hint_ref_keys()`의 운영 기본값은 None이다. 그래서 운영 설정 전에는 `suggest_hint`를 내지 않는다(fail closed).
  - 이벤트에는 내부 puzzle_id를 남긴다.
- **재전송:** 같은 `client_event_id`면 같은 hint_ref · `fallback_reason`을 돌려준다(값이 결정적이다).

## 이벤트 계약

| 이벤트(`interaction_events.interaction_type`) | 보내는 쪽 | `target_id` | `response_json` | 효과 |
|---|---|---|---|---|
| `npc_turn` (`auto_intervened: true`) | BE(제안 응답) | — | `auto_intervene {trigger, value, puzzle_ref, nudge_missing, level}` 등 | 횟수 · 쿨다운 소모 없음 |
| `npc_suggestion_shown` | FE 보고 | 제안 ID(`npc_event_id`) | `{puzzle_id, level}` | 퍼즐당 · 세션당 횟수 + 180초 쿨다운 |
| `npc_suggestion_suppressed` | FE 보고 | 제안 ID | `{puzzle_id, level}` | 소모 없음 |
| `npc_suggestion_declined` | FE 보고 | 제안 ID | `{puzzle_id, level}` | 600초 쿨다운 |

- **`npc_auto_intervene` 필드:**
  - `trigger`: `repeated_incorrect` · `idle_too_long` · `player_requested`
  - `value`: 연속 오답 수 · 무입력 초
  - `puzzle_ref`: 내부 puzzle_id
  - `nudge_missing`: 그 퍼즐에 nudge가 아예 작성되지 않음
  - `level`: 1 · 2
- **전이 규칙(`record_suggestion_event`):**
  - shown · suppressed는 둘 중 먼저 온 것만 기록한다. 반대 보고는 `SuggestionEventConflictError`다.
  - declined는 shown 뒤에만 받는다.
- **중복 수신 방지:**
  - 같은 종류를 다시 보내면 다른 client_event_id여도 새 행 없이 처음 기록을 돌려준다(`duplicate: true`).
  - 같은 client_event_id로 다른 보고를 보내면 `IdempotencyConflictError`다.
  - 세션 행 `FOR UPDATE`로 직렬화한다.
- 자동 개입 제안이 아닌 ID나 다른 세션의 ID는 `SuggestionNotFoundError`다.
- 모든 보고 이벤트는 `npc_` 접두라 무입력(마지막 플레이어 행동) 계산에서 빠진다.

## PUB-GATE

- 새 검사 `NUDGE_COVERAGE`: server.json 퍼즐 중 npc.json에 nudge 항목이 없는 퍼즐 ID를 `WARN`으로 남긴다.
- `WARN`은 게시를 막지 않는다(`NON_BLOCKING_STATUSES`). 다른 검사의 FAIL은 그대로 게시를 막는다.

## 아직 연결하지 않은 것

- 표시 · 미표시 · 거절을 받는 HTTP 라우트(서비스 `record_suggestion_event`만 있다)와 FE 연결
- hint_ref를 받는 Hint API(검증 함수 `resolve_hint_ref`만 있다), 운영 발급 키 설정
- 멱등 저장소 · 게시 guard의 NPC 턴 HTTP 연결(작업 C · D 저장소는 독립 기반)
- 무입력에서 컷 · 모달 시간 제외(FE `active_seconds` 연동 필요)
- 응답만 하고 보고가 오지 않은 제안의 처리. 소모하지 않으므로 다음 자동 턴에서 다시 제안될 수 있다.

## 자동 개입 nudge 선택 (11/10 PM 요청 · 미르님 승인)

판단 조건(연속 오답 6회 · 무입력 240초), `intervention_level`, 횟수 · 쿨다운 정책은 바꾸지 않았다. `decide()`의 판단 사유로
**어떤 승인 nudge를 고를지**만 정한다(`npc_dialogue.select_auto_nudge`).

- **분류:** line_id 끝의 `_<분류>_<번호>[_<말투>]`로 읽는다(예: `NUDGE_P01_WRONG_1_J` → WRONG).
  이 꼴이 아니면 분류 없음이다.
- **사유별 후보 순서(같은 분류 안에서는 npc.json 순서):**
  - `repeated_incorrect`: WRONG → HELP → 분류 없음
  - `idle_too_long`: STUCK → HELP → 분류 없음
  - 순서를 정하지 않은 사유(`player_requested` 등)는 기존처럼 npc.json 순서다(PM 미정).
    현재 auto 턴에서는 `player_requested`가 생기지 않는다.
  - 그 사유의 순서에 없는 분류는 쓰지 않는다(무입력에 WRONG, 오답에 STUCK을 쓰지 않음).
- **ARRIVE:** 어떤 사유에서도 자동 개입에 쓰지 않는다.
- **승인 · 공개 조건:** 기존 검사(게시 절차의 승인 출처, `reveal_when`)를 그대로 거친 줄만 후보다.
- **회차 내 중복 방지:**
  - 기준은 `(play_session_id, puzzle_id, line_id)`이고, 개입 사유가 달라도 다시 고르지 않는다.
  - 새 테이블 없이 기존 `npc_turn` 기록(`response_json`)을 쓴다. 기록 조건은 `trigger=auto`,
    `auto_intervened=true`, `reply_source=approved_line`, `auto_intervene.level=1`이다.
    퍼즐 ID는 `auto_intervene.puzzle_ref`에서 읽는다.
  - 새 회차(새 play session)는 이력을 새로 시작한다.
- **소진:**
  - 후보가 모두 쓰였으면 같은 줄을 반복하지 않고 reply null을 돌려준다.
    이벤트 기록의 `no_reply_reason`은 `auto_nudges_exhausted`다.
  - 연속 오답은 기존 정책대로 2단계(힌트 안내)로 넘어간다. 단, server.json에 그 퍼즐의 정식 힌트가 있을 때만이다.
    나주 v1에는 서버 힌트가 없어 null이다.
- **재시도:** 같은 `client_event_id`는 저장된 기록을 그대로 돌려준다(후보를 더 쓰지 않는다).
- **동시성:**
  - auto 턴은 확정 전에 세션 행을 `FOR UPDATE`로 잠근다. 잠근 뒤 상태 · 이벤트를 다시 읽고 계산한다.
  - 그래서 같은 회차의 동시 요청이 같은 줄을 두 번 고르지 않는다.
  - 잠금 순서는 세션 → 승인 · 게시(공유 잠금)다.

### 제한

- **반환 기록 기준이다. 실제 화면 표시는 보장하지 않는다.** FE가 받은 뒤 표시하지 못한 줄(대화 중 · 컷 · 탭
  숨김 · 네트워크 실패)도 쓴 것으로 센다. 표시 보고 HTTP API는 이번 베타 범위가 아니다.
- **판단 순서:** 같은 퍼즐에서 연속 오답이 기준 이상이면 무입력보다 먼저 판단한다. 연속 수는 정답(=완료)으로만
  끊긴다. 그래서 실제 흐름에서 같은 퍼즐의 순서는 「무입력(STUCK) → 오답(WRONG)」만 생긴다.
- **반복 요청:** 후보가 소진된 뒤에도 auto 턴마다 `npc_turn` 기록 1행은 계속 쌓인다(reply null).
