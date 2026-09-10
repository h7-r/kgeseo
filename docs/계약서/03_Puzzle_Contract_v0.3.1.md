# 03_Puzzle_Contract_v0.3.1

> v0.3의 단서 조합 구조를 유지하면서 `clue_combination`을 자유 조합형으로 명확히 하고, 힌트 모델을 `hint_level`로 통일한 버전.

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Puzzle Contract |
| 버전 | v0.3.1 |
| 상태 | 1차 확정 Baseline |
| 관련 문서 | Interaction Contract v0.3.1 / Session Contract v0.3.1 |

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

## 7. Hint 모델

본편 v1 힌트는 정적 2단계이며 상태값은 `hint_level`로 표현한다.

```text
hint_level = 0
→ 미열람

hint_level = 1
→ 힌트 보기

hint_level = 2
→ 정답 보기
```

규칙:

- level 1은 플레이어가 직접 요청
- level 2는 level 1 이력 후에만 요청 가능
- 오답 횟수 기반 자동 해금 없음
- 서버가 현재 level을 저장
- FE는 서버 상태를 기준으로 UI를 구성

---

## 8. Hint API

```http
POST /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints
```

Request:

```json
{
  "target_level": 1,
  "client_event_id": "6109bc8f-2dd7-4be1-8535-c2be60bc76c7"
}
```

정답 보기 요청:

```json
{
  "target_level": 2,
  "client_event_id": "5dc135c0-27fb-4a48-b394-0321ed5bb1e3"
}
```

Response 예:

```json
{
  "success": true,
  "data": {
    "puzzle_id": "PUZZLE_001",
    "hint_level": 1,
    "content": "기록의 시행 날짜와 주민의 진술 시점을 비교해보세요.",
    "state_changes": [
      {
        "type": "hint_level_changed",
        "target_id": "PUZZLE_001",
        "value": 1
      }
    ]
  }
}
```

level 2는 현재 `hint_level >= 1`일 때만 허용한다.

---

## 9. 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v0.2 | Runtime/Internal 분리 |
| v0.3 | `clue_combination` 추가 |
| v0.3.1 | 자유 조합형 UX 확정, Hint를 `hint_level 0/1/2`로 통일 |
