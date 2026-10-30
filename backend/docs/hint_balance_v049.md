# 힌트 잔액 · 원자적 차감 — PM v0.4.8 · v0.4.9 반영

기준 브랜치 `feat/SJ-npc-publication-approval-integration`(`080179b`). 이번 범위는 **잔액 · 차감만**이다.
LLM 힌트 표현 · 미니게임 충전 · 별 · 계정 연결 · AI 호출 한도 · FE 연결은 들어 있지 않다.

## 저장 구조

| 칼럼(`play_sessions`) | 뜻 | 바뀌는 때 |
|---|---|---|
| `hint_balance` INT NOT NULL DEFAULT 0 | 이 회차의 힌트 잔액 | 회차 시작 = N, 새 단계 해금 −1 |
| `help_used` INT NOT NULL DEFAULT 0 | 이 회차에서 새로 연 단계 수의 합(별 계산용) | 새 단계 해금 +1 |

- revision `b6d4e2f8a1c3`(부모 `a5c7e9b2d4f6`, 단일 head). 기존 revision은 바꾸지 않았다.
- 기존 행: `hint_balance = 3`(작성 시점 PM 기본값), `help_used = hint_levels` 값(0~2 정수)의 합.
- DB 기본값 0은 지급 경로를 거치지 않은 행이 무료 힌트를 받지 않게 하는 안전값이다.
- `hint_balance >= 0` CHECK는 배포 DB 버전 확인 전이라 두지 않았다(제안 SQL은 revision 주석에 있다).
  0 미만 금지는 세션 행 잠금 안의 확인으로 지킨다.

## 설정값 (`app.core.config.Settings`, 환경 변수)

| 환경 변수 | 기본값 | 용도 |
|---|---|---|
| `HINT_INITIAL_BALANCE` | 3 | 회차 시작 지급량 N (🔴 PM 확정 대기) |
| `HINT_FUN_MINIGAMES_PER_SESSION` | 2 | 잔액 부족 응답의 `minigames_left` |
| `HINT_SPECIAL_MINIGAMES_PER_SESSION` | 1 | `special_minigame_available` |
| `HINT_REF_CURRENT_KEY_ID` · `HINT_REF_KEYS` | 비어 있음 | hint_ref 발급 키(아래) |

## 처리 순서 (`app.services.hint.unlock_hint`, v0.4.9 §1)

1. 세션 행 `FOR UPDATE`
2. 세션이 고정한 버전의 로더 · 원문인지 대조(`ensure_loaders_match_session`), 같은 `client_event_id`면 처음 결과 재전송
3. 퍼즐 · **요청 단계 승인 원문을 먼저 읽음** — 실패하면 차감 없이 오류
4. 이미 연 단계 → `already_unlocked`(무료, 잔액 0이어도 됨)
5. 단계 건너뜀 · 접근 정책 확인 → 잔액 0이면 `HintBalanceEmptyError`(쓰기 없음)
6. `hint_levels` +1 · `hint_balance` −1 · `help_used` +1 · `unlock_hint` 이벤트를 **한 commit**
- 같은 `client_event_id` 동시 요청은 세션 잠금 + 이벤트 잠금 읽기 + UNIQUE 키로 한 번만 처리된다.
- 게시 상태(긴급 차단)는 보지 않는다. 차단 중에도 승인 원문을 준다(v0.4.6 §3 · v0.4.9 §3, 환불 없음).
- 원문은 이벤트에 저장하지 않는다(기존 정책). 재전송 때 고정 버전에서 다시 읽는다.

## HTTP (`POST /api/v1/play-sessions/{id}/puzzles/{puzzle_id}/hints`)

> PM v0.4.10: 정식 경로 `POST …/hints`가 생겼고 이 경로는 호환 별칭이다(`docs/hint_api_v0410.md`).
> 접근 정책은 「제한 없음」에서 「발견한 퍼즐만」으로 바뀌었다.

요청: `{"client_event_id": "<1~36자>", "client_timestamp": "<ISO-8601>", "target_level": 1|2}`

응답 200: `{interaction_id, result: {result_type, puzzle_id, hint_level, state, state_changes, hint_balance, help_used}, hint: {level, text}}`

| 상황 | 상태 | detail |
|---|---|---|
| 잔액 0에서 새 단계 | 409 | `{"code": "HINT_BALANCE_EMPTY", "message", "minigames_left", "special_minigame_available"}` |
| 고정 버전 묶음 없음 · fingerprint 불일치 · 로더 불일치 | 409 | `CASE_VERSION_UNAVAILABLE` |
| 세션 없음 / 퍼즐 없음 / 그 단계 원문 없음 | 404 | 문자열 |
| 단계 건너뜀 · 접근 거부 · client_event_id 충돌 | 409 | 문자열 |
| 저장된 단계 값 오류 | 500 | 문자열 |

- `minigames_left`는 충전 API가 없어 지금은 설정값 그대로다. 특별 미니게임은 재미 미니게임을 다 써야 열리므로
  지금은 늘 `false`다. 충전 API가 생기면 `minigame_allowance`가 회차 기록을 반영한다.
- (v0.4.10에서 대체) 접근 조건은 `app.services.hint_access`(발견한 퍼즐만, 선행 단서 기본 미적용 · `get_hint_access_rules`)다.

## hint_ref 발급 키 (`app.api.v1.npc.get_hint_ref_keys`)

- `HINT_REF_CURRENT_KEY_ID=k2`, `HINT_REF_KEYS="k1:<base64url>,k2:<base64url>"`(각 32바이트 이상, id는 소문자 · 숫자 1~16자).
- 둘 다 비어 있으면 None → `suggest_hint`를 내지 않는다(fail closed, 운영 기본값).
- 형식이 틀리면 키를 쓰지 않고 오류 로그만 남긴다(비밀 값은 남기지 않는다). NPC 턴 자체는 막지 않는다.
- `HINT_REF_KEYS`는 `SecretStr`이라 설정 객체 표시 · 로그에 나오지 않는다. 운영에서는 비밀 저장소(환경 변수 주입)로 넣는다.
- 키 교체: 새 id를 추가하고 `CURRENT`를 바꾼다. 이전 id는 그 키로 발급된 ref가 쓰이는 동안(세션 진행 중) 남겨 둔다.

## 아직 하지 않은 것

- LLM 힌트 표현(`reply.source`, `RECOVERED_AFTER_FAILURE`, 멱등 저장소 연결, 호출 한도 예약)
- 미니게임 발급 · 제출 · 충전 API와 `minigame_attempt_id` 멱등
- 별 · 완주(`completed_at`) · 재도전 기록, 계정 연결, AI 호출 한도
- 세션 조회 응답에 잔액 노출, FE 연결
