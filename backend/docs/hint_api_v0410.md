# 정식 Hint API 경로 일원화 — PM v0.4.10 §1 반영

기준 브랜치 `feat/SJ-npc-hint-balance`(`12ab1e5`, v0.4.9 힌트 잔액). DB migration 변경은 없다.

## 경로

| 경로 | 용도 | 상태 |
|---|---|---|
| `POST /api/v1/play-sessions/{id}/hints` | 정식. 힌트 버튼 · NPC 제안 수락 모두 | 신규 |
| `POST /api/v1/play-sessions/{id}/puzzles/{puzzle_id}/hints` | 호환 별칭(FE 이전 뒤 삭제) | `deprecated` 표시 |

- 두 경로 모두 `app.api.v1.hints._process_hint_request` → `app.services.hint.unlock_hint` 하나를 부른다.
  차감 · `help_used` · 멱등 · 고정 버전 확인 로직은 v0.4.9 그대로이고 중복 구현이 없다.
- `/npc/turns`에는 차감 경로가 없다. NPC는 `suggest_hint.hint_ref`만 준다.

## 요청 (`HintApiRequest`, 모르는 필드 거부)

```json
{ "client_event_id": "<1~36자>", "client_timestamp": "<ISO-8601, 선택>", "target_level": 1,
  "puzzle_id": "PZ_A" }
{ "client_event_id": "<1~36자>", "target_level": 1,
  "hint_ref": "hr1.<key id>.<43자>" }
```

- `puzzle_id` · `hint_ref` 중 **정확히 하나**. 둘 다 없거나 둘 다 있으면 422(FastAPI 검증 오류 형식).
- 멱등 키는 기존과 같은 `interaction_events (play_session_id, client_event_id)`다. 같은 ID를 다른 형식
  (hint_ref ↔ puzzle_id)으로 다시 보내도 **같은 퍼즐 · 같은 단계면** 처음 응답이고, 다르면 409다.

## hint_ref 검증 (`app.services.hint_access.resolve_hint_target`)

- 기존 `resolve_hint_ref`를 그대로 쓴다. 입력: 그 세션 ID · 세션 고정 fingerprint · 고정 버전 퍼즐 목록.
- 검증 키는 NPC 발급과 같은 의존성(`get_hint_ref_keys`, 환경 변수 `HINT_REF_*`)이다.

| 상황 | 상태 | detail.code |
|---|---|---|
| 형식 오류 | 422 | `HINT_REF_INVALID` |
| 다른 세션 · 다른 fingerprint · 다른 키로 서명 · 변조 · 레거시 세션 | 409 | `HINT_REF_MISMATCH` |
| 검증 키 미설정 · 모르는 key id | 503 | `HINT_REF_UNAVAILABLE` |

- 오류 응답에는 퍼즐 ID를 싣지 않는다. 성공 응답에는 `result.puzzle_id` · `state`가 기존 형식대로 들어간다
  (그 퍼즐은 발견한 퍼즐이고, 호스트 Object의 `interaction.target_id`로 client.json에 이미 공개돼 있다).

## 서버 상태 접근 조건 (`server_state_access_policy`, 새 단계 해금에만)

기존 코드 근거만 쓴다. 새 정책을 정하지 않았다.

| 발견으로 보는 경우 | 근거 |
|---|---|
| 현재 구역에서 보이는 Object가 그 퍼즐로 이어지는 상호작용(`input` 등)을 가짐 | NPC `hint_ref` 발급 조건 `npc_turn_service._focus_puzzle`, `npc_model_context`의 open 퍼즐 |
| 이미 푼 퍼즐 | 같은 두 곳의 completed 퍼즐 |
| 이미 한 단계 이상 연 퍼즐(`hint_levels ≥ 1`) | 그때 서버가 접근을 허락했다는 기록 |

- 발견하지 않은 퍼즐은 **없는 퍼즐과 같은 404 `Puzzle not found.`**다. 접근 조건을 원문 조회 · 단계 판정보다
  먼저 보므로 그 퍼즐의 힌트 유무 · 단계 건너뜀 여부도 드러나지 않는다(`unlock_hint` 순서 변경).
- 재열람(이미 연 단계)은 조건 없이 준다(v0.3 · v0.4.9 그대로).
- 선행 단서(`requires_clue_ids`): 계약상 정답 판정 · 조사 효과의 조건이고(interaction_puzzle_runtime §7.9),
  힌트 적용 여부는 PM 미결정(hint_api_v0.1 §3)이라 **기본 미적용**. `HintAccessRules(require_clues=True)`로 켜면
  Interaction API와 같은 409 `{"detail": "Required clues are not acquired.", "missing_clue_count": n}`.

## 그대로 유지한 것

- 원자적 차감(단계 +1 · 잔액 −1 · `help_used` +1 · 이벤트 한 commit), 잔액 0 → 409 `HINT_BALANCE_EMPTY`
- 재열람 무료, 같은 요청 ID 재전송 · 동시 요청 한 번만 차감
- 고정 버전 불일치 → 409 `CASE_VERSION_UNAVAILABLE`(차감 없음)
- 긴급 차단 중에도 승인 원문(게시 상태를 보지 않음)

## 아직 연결하지 않은 것

- v0.4.10 §2 `hint_request` 별도 저장 · NPC 멱등 저장소 공통 모듈화(지금은 `interaction_events` 멱등)
- LLM 힌트 표현(`reply.source`, `RECOVERED_AFTER_FAILURE`), AI 호출 한도
- 미니게임 충전 API(`minigames_left`는 설정값 그대로), 별 · 완주 · 재도전, 계정 연결
- v0.4.10 §3 · §4 회차 종료(`ended_at` · `end_reason`) · `last_active_at`
- FE 연결 · 별칭 삭제(FE 이전 뒤)
