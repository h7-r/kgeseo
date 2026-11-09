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
- 제안(`auto_intervened: true`)은 퍼즐 자동 개입 판단(`auto_intervene` 기록)이 대사나 힌트 안내를 낸 응답뿐이다.
  상황 대사(v0.4.16)와 긴급 차단 중 턴(auto는 `reply: null`, 플레이어 메시지는 「잠시 멈춤」 대사)은 제안이 아니라
  보고하면 `SuggestionNotFoundError`다.
- 모든 보고 이벤트는 `npc_` 접두라 무입력(마지막 플레이어 행동) 계산에서 빠진다.

## PUB-GATE

- 새 검사 `NUDGE_COVERAGE`: server.json 퍼즐 중 npc.json에 nudge 항목이 없는 퍼즐 ID를 `WARN`으로 남긴다.
- `WARN`은 게시를 막지 않는다(`NON_BLOCKING_STATUSES`). 다른 검사의 FAIL은 그대로 게시를 막는다.

## 아직 연결하지 않은 것

- 표시 · 미표시 · 거절을 받는 HTTP 라우트(서비스 `record_suggestion_event`만 있다)와 FE 연결
  - 11/7 확인: 공식 계약(v0.4.16 §1은 「v0.4.7 §3」만 가리킨다)에 경로 · 요청 본문 · 응답 · 오류 상태 코드가 없다.
    PM이 정할 것: 경로, 보고 종류 값, `client_event_id` · `client_timestamp` 포함 여부, 응답 모양(`duplicate` 노출 여부),
    오류 코드(제안 아님 · 반대 보고 · 같은 ID 다른 보고).
- hint_ref를 받는 Hint API(검증 함수 `resolve_hint_ref`만 있다), 운영 발급 키 설정
- 멱등 저장소 · 게시 guard의 NPC 턴 HTTP 연결(작업 C · D 저장소는 독립 기반)
- 무입력에서 컷 · 모달 시간 제외(FE `active_seconds` 연동 필요)
- 응답만 하고 보고가 오지 않은 제안의 처리. 소모하지 않으므로 다음 자동 턴에서 다시 제안될 수 있다.
