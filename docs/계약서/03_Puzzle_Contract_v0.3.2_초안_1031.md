# 03_Puzzle_Contract_v0.3.2 (초안 · 10/31)

> **[10/31 초안 · 김세진 확인 필요]** v0.3.1의 §1~§6은 그대로 두고 §7 · §8만 DEC-61(동행 NPC LLM 힌트 · 잔액 · 미니게임 충전)에 맞춰 고쳤다. 원본 v0.3.1 파일은 그대로 남긴다.
>
> v0.3의 단서 조합 구조를 유지하면서 `clue_combination`을 자유 조합형으로 명확히 하고, 힌트 모델을 `hint_level`로 통일한 버전.

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Puzzle Contract |
| 버전 | v0.3.2 초안(10/31) — 기준 v0.3.1 |
| 상태 | §1~§6 확정 Baseline · §7 · §8 초안(김세진 확인 필요) |
| 관련 문서 | Interaction Contract v0.3.2 / Session Contract v0.3.1 / NPC 콘텐츠 데이터 계약 v0.4.6 / PRD v2.6(USR-120~122 · ADM-102 · API-030~034) |

---

## 1. v1 Puzzle Type

- `code_input`
- `text_input`
- `single_choice`
- `multiple_choice`
- `observation`
- `navigation`
- `clue_combination`

---

## 2. `clue_combination` UX 모델

`clue_combination`은 특정 퍼즐 화면에 먼저 진입해야만 사용할 수 있는 방식이 아니라,
**조사수첩에서 획득 단서를 자유롭게 연결하는 방식**이다.

```text
조사수첩
↓
Clue 2개 선택
↓
combine_clues
↓
서버가 쌍 규칙 조회
├─ 규칙 있음 → 성공
└─ 규칙 없음 → incorrect
```

따라서 `combine_clues` Interaction 요청에는 `puzzle_id`가 없다.

조합 성공 결과가 특정 Puzzle 완료로 연결되는 경우,
서버가 `state_changes`에 `puzzle_completed`를 반환한다.

---

## 3. Runtime Puzzle 정의

`clue_combination`에 대응하는 Puzzle 정의는 조합 결과·진행 효과를 설명하는 콘텐츠/서버 규칙으로 존재할 수 있다.

FE가 조합 요청을 보낼 때 해당 `puzzle_id`를 알고 있을 필요는 없다.

예:

```json
{
  "puzzle_id": "PUZZLE_CLUE_COMBINE_01",
  "zone_id": "ZONE_003",
  "title": "서로 맞지 않는 두 기록",
  "puzzle_type": "clue_combination",
  "status": "available",
  "presentation": {
    "prompt": "서로 연결되는 단서를 찾아보자."
  },
  "validation": {
    "method": "server_side"
  },
  "hint_state": {
    "hint_level": 0
  }
}
```

---

## 4. Internal Authoring Definition

```json
{
  "puzzle_id": "PUZZLE_CLUE_COMBINE_01",
  "puzzle_type": "clue_combination",
  "validation_spec": {
    "method": "unordered_pair_match",
    "required_clue_ids": [
      "CLUE_TESTIMONY_01",
      "CLUE_RECORD_03"
    ]
  },
  "requirements": [
    {
      "type": "clue_required",
      "target_id": "CLUE_TESTIMONY_01"
    },
    {
      "type": "clue_required",
      "target_id": "CLUE_RECORD_03"
    }
  ],
  "success_effects": [
    {
      "type": "clue_acquired",
      "target_id": "CLUE_DEDUCTION_02",
      "value": true
    },
    {
      "type": "puzzle_completed",
      "target_id": "PUZZLE_CLUE_COMBINE_01",
      "value": true
    }
  ]
}
```

`validation_spec`은 FE에 노출하지 않는다.

---

## 5. 조합 판정 규칙

- 정확히 2개 Clue
- 두 Clue 순서는 기본적으로 무관
- 두 Clue 모두 현재 Play Session에서 획득 상태
- 서버에 정의된 Pair 규칙이 있으면 `correct`
- 획득한 정상 Clue Pair지만 규칙이 없으면 `incorrect`
- 획득하지 않은 Clue 또는 잘못된 요청 형식은 Error

---

## 6. AI 생성 제약

AI는:

- 이미 존재하는 Clue만 사용
- 2개 Clue 조합만 생성
- 확정 시나리오/화자 발견에 근거한 추론만 생성
- 새로운 FE 조작을 요구하지 않음
- 드래그/배치/슬라이드/물리 조합을 요구하지 않음

---

## 7. Hint 모델 (v0.3.2 초안 · DEC-61)

### 7.1 무엇을 알려 줄지는 승인 힌트 단계가 정한다

`hint_level`은 그대로 쓴다. 단계의 뜻은 「퍼즐별로 지금까지 공개된 최대 단계」다.

```text
hint_level = 0 → 미열람
hint_level = 1 → 방향 힌트(정답을 숨긴 채 다음 사고 · 행동)
hint_level = 2 → 정답 공개(최종 입력값 · 순서 · 조작)
```

- 각 단계의 **승인 원문**(사람 승인 · G3)은 서버 전용 콘텐츠에 있다. 동행 NPC 대사는 LLM이 만들지만, **허용된 정보(현재 단계의 승인 원문 범위)만** 쓴다.
- 모델 대사에 정답 문자열이 섞이면 승인 원문으로 바꾼다. 모델 실패 · 시간 초과도 승인 원문으로 대신한다.
- level 2는 level 1 이후에만. 오답 횟수 기반 자동 해금 없음(v0.3.1 유지).

### 7.2 따로 세는 숫자 셋

| 숫자 | 뜻 | 세는 것 | 초기화 |
|---|---|---|---|
| 도움 사용 수 | 별 계산용 | 새 도움을 실제로 받은 횟수. 잡담 · 거절 · 재열람 제외 | 첫 도전 기록은 처음부터 다시 해도 보존 |
| 힌트 잔액 | 회차의 남은 도움 | 처음 지급량 [미정] + 미니게임 충전 − 새 도움 | 새 회차마다 새로 |
| AI 호출 한도 | 비용 상한 | 잡담 포함 모든 모델 호출 | **처음부터 다시 · 특별 미니게임을 해도 초기화 안 함** (계정 · 게스트 + 사건 기준) |

### 7.3 차감 · 중복 요청 · 재열람

- **차감**: 새 도움(`kind = new_help`) 1회 = 잔액 −1, 서버가 한 번만 반영한다. 차감 · 도움 수 · 첫 도전 이력 기록은 한 트랜잭션.
- **중복 요청**: 멱등 키는 `turn_request_id`(NPC 계약 v0.4.4~0.4.6과 같은 규칙).
  - 같은 키 + 같은 본문 → 저장된 응답 재현, 차감 없음
  - 같은 키 + 다른 본문 해시 → 422
  - 만료된 키(tombstone) → 410 `turn_expired`
  - 동시 요청 → 한 번만 차감
- **재열람**: 이미 연 단계는 **승인 원문**을 별도 필드로 준다(NPC 계약 13절). 차감 · 도움 수 없음.
- **잔액 0**: 409 `HINT_BALANCE_EMPTY`(초안) → 클라이언트는 미니게임 충전 / 소진 선택을 띄운다.
- **종료된 회차**: 409(계약 v0.4.6 6절). 긴급 차단된 콘텐츠 버전은 generic 응답(v0.4.6 2절).

### 7.4 미니게임 충전

- 재미 미니게임(틀린그림 · OX · 빈칸)은 한 판 2개까지, 하나 완료당 +1. 같은 미니게임으로 두 번 충전하지 않는다.
- 잔액 0이고 2개를 다 썼으면: 특별 미니게임(선택, 충전량 [미정]) 또는 처음부터 다시.

### 7.5 상태 변화와의 관계

- `state_changes`는 닫힌 4종을 유지한다. `hint_level_changed`는 퍼즐별 최대 공개 단계가 바뀔 때만 쓴다.
- **힌트 잔액 · 도움 사용 수 · 별 · 보상은 `state_changes`에 넣지 않는다.** 별도 응답 필드 · 별도 API로 준다(공용 인터랙션 카탈로그 v2.1 §6).

## 8. Hint API (v0.3.2 초안 · 김세진 확인 필요)

경로는 PRD v2.6 13_API 초안을 따른다. 기존 `POST …/puzzles/{puzzle_id}/hints`(v0.3.1)와 BE의 `POST …/npc/turns` 중 어디에 합칠지는 미정이다 🔴.

### 8.1 잔액 조회 — API-030

```http
GET /api/v1/play-sessions/{play_session_id}/hint-wallet
```

```json
{ "balance": 2, "initial_grant": null, "minigame_credit": 1, "help_used_count": 1, "ai_calls_used": 3, "ai_calls_cap": null }
```
※ `null` = 값 [미정]. 예시 숫자는 형식 설명용이다.

### 8.2 도움 요청 — API-031

```http
POST /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/help
```

Request:

```json
{ "turn_request_id": "b0c4…", "message": "이 그림자는 어디서 오는 거야?" }
```

Response:

```json
{
  "puzzle_id": "PUZZLE_001",
  "reply_text": "창살 쪽에서 들어오는 빛을 따라가 보시게.",
  "hint_level": 1,
  "level_kind": "direction",
  "approved_text": null,
  "source": "llm",
  "balance": 1,
  "counted": true,
  "state_changes": [ { "type": "hint_level_changed", "target_id": "PUZZLE_001", "value": 1 } ]
}
```

- `level_kind = answer`일 때 `approved_text`에 승인 원문을 함께 준다.
- `source = approved_fallback`이면 `reply_text`는 승인 원문이다.

### 8.3 재열람 — API-032

```http
GET /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints/{level}
```

```json
{ "level": 2, "approved_text": "…" }
```
열지 않은 단계는 409. 차감 없음.

### 8.4 미니게임 충전 — API-033 · 소진 선택 — API-034

```http
POST /api/v1/play-sessions/{play_session_id}/minigames/{minigame_id}/complete
POST /api/v1/play-sessions/{play_session_id}/hint-exhausted
```
한 판 2개 상한 초과 · 중복은 `credited: 0`(또는 409 `MINIGAME_LIMIT`, 초안). 처음부터 다시를 고를 때 이전 회차를 `abandoned`로 닫을지 김세진 확인 필요 🔴.

### 8.5 v0.3.1 Hint API와의 관계

`POST …/hints { target_level }`는 v0.3.1 클라이언트 호환을 위해 남길지 결정 전이다. 남긴다면 「승인 원문 단계 열람」으로만 쓰고 잔액 차감은 API-031로 일원화한다 🔴.

---

## 9. 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v0.2 | Runtime/Internal 분리 |
| v0.3 | `clue_combination` 추가 |
| v0.3.1 | 자유 조합형 UX 확정, Hint를 `hint_level 0/1/2`로 통일 |
| v0.3.2 초안(10/31) | §7 · §8 — 동행 NPC LLM 힌트(승인 단계 안에서) · 숫자 셋 · 차감 · 멱등(`turn_request_id`) · 재열람 승인 원문 · 미니게임 충전 · 잔액 · 별은 `state_changes` 밖. DEC-61 · 김세진 확인 필요 |
