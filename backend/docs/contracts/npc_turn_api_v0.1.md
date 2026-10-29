# NPC 턴 API v0.1 (PM v0.4.3)

> 상태: 팀 검토 대기 · 운영 일반 대화 생성 OFF · 승인 이력 저장소 없음(기본은 모든 대사 미승인)

`POST /api/v1/play-sessions/{play_session_id}/npc/turns`

## 요청

```json
{
  "client_event_id": "UUID",
  "client_timestamp": "2026-10-29T12:00:00+09:00",
  "trigger": "player_message | auto",
  "message": "player_message 일 때만 (1~200자)",
  "focus_object_id": "선택 — 현재 구역에서 보고 있는 Object"
}
```

- 모르는 필드는 422(`extra="forbid"`). 퍼즐 ID 는 받지 않는다 — 서버가 포커스 Object 에서 다시 찾는다.
- `player_message` 에는 `message` 필수, `auto` 에는 `message` 금지.

## 응답 (200, 감싸지 않은 객체)

```json
{
  "npc_event_id": "UUID",
  "reply": {"source": "generated | approved_line", "text": "…", "line_id": "approved_line 이면 필수"},
  "suggest_hint": {"puzzle_id": "…"}
}
```

- 발화가 없으면 `reply` 는 `null`. `suggest_hint` 는 힌트 버튼 표시 안내일 뿐, 힌트를 해금하지 않는다.

## 처리

| trigger | 흐름 |
|---|---|
| `player_message` | 퍼즐 풀이 질문 판별 → 퍼즐 질문: 승인 nudge 원문 → 승인 일반 팩 기본 안내(+`suggest_hint`) · 생성기 호출 없음 / 일반 대화: 생성 OFF 면 발화 없음, ON 이면 model_context → 생성 1회 → 정책 검사 → 승인 대체 대사 |
| `auto` | 세션 이벤트로 P3 규칙 판단(연속 오답 · 무입력 · 쿨다운 · 상한) → `intervention_level` 1 까지 → 승인 nudge 원문 |

- 콘텐츠는 세션이 고정한 버전 묶음만 쓴다. 공개 여부는 서버 `state_json` 으로만 판정한다.
- 대사 승인은 그 버전 fingerprint 의 G1~G3 승인 이력이 모두 최종 approved 일 때만이다.
- PlaySession 상태 · `hint_levels` 를 바꾸지 않는다. Hint API 를 부르지 않는다.

## 기록

`interaction_events` 한 줄(`interaction_type="npc_turn"`, `target_id=null`).

- `payload_json`: `trigger` · `focus_object_id` · `message_sha256`(재전송 비교용, 원문 없음)
- `response_json`: `reply_source` · `line_id` · `generated` · `no_reply_reason` · `suggest_hint_puzzle_id` ·
  `policy`([{code, rule_id}]) · `decision` · `diagnosis`(신호 종류만) · `auto_intervened`
- 대사 · 플레이어 원문 · 정답 · 힌트 원문은 저장하지 않는다.

## 오류 (기존 체계)

| 상태 | detail |
|---|---|
| 404 | `Play session not found.` |
| 409 | `CASE_VERSION_UNAVAILABLE` (레거시 세션 · 저장소에 없는 버전 · fingerprint 불일치) |
| 409 | `Client event ID conflicts with a previous interaction.` |
| 422 | 요청 검증 오류 |
| 500 | `NPC content is unavailable.` (승인 대사에 정답 · 힌트 원문 — 콘텐츠 수정 필요) |

## 재전송

같은 `client_event_id` · 같은 요청이면 저장된 결과를 돌려준다. 승인 대사는 그때 승인된 콘텐츠에서 line_id 로
다시 읽고(승인이 빠졌으면 `reply=null`), 생성 대사는 저장하지 않았으므로 `reply=null` 이다.

## 운영 의존성 (기본값)

| 의존성 | 기본 | 비고 |
|---|---|---|
| `get_pinned_content_store` | 빈 저장소 | 게시 경로 없음 → 고정 세션은 409 |
| `get_npc_approval_source` | `None` | 승인 이력 영속 저장소 없음(DB 테이블 · 마이그레이션 필요) |
| `get_general_line_pack` | `(None, None)` | 일반 팩 게시 절차 없음 |
| `get_npc_generation` | OFF | 사람 검수 전 활성화 금지 |
