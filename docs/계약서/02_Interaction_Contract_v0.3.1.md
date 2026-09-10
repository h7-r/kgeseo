# 02_Interaction_Contract_v0.3.1

> v0.3의 `combine_clues`를 **자유 조합형 UX**로 명시하고, 힌트 상태 변경을 `hint_level_changed`로 통일한 버전.

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Interaction Contract |
| 버전 | v0.3.1 |
| 상태 | 1차 확정 Baseline |
| 관련 문서 | Zone Contract v0.2 / Puzzle Contract v0.3.1 / Session Contract v0.3.1 |

---

## 1. 기본 원칙

1. FE는 플레이어가 무엇을 시도했는지 전달한다.
2. BE는 판단 유효성·퍼즐 판정·상태 변경을 결정한다.
3. 서버 상태가 Source of Truth다.
4. 정상 플레이 오답은 API 오류가 아니다.
5. 성공 후 전체 재조회 대신 `state_changes`를 적용한다.
6. 새로고침/재접속 시 Play Session 상태를 다시 조회한다.
7. `client_event_id`로 중복 반영을 막는다.

---

## 2. API

```http
POST /api/v1/play-sessions/{play_session_id}/interactions
```

---

## 3. Request Schema

```json
{
  "zone_id": "ZONE_003",
  "object_id": "OBJ_LOCK_01",
  "interaction_type": "input",
  "payload": {
    "value": "1847"
  },
  "client_event_id": "d38ad330-2707-4551-a903-cafbfcc3a61c",
  "client_timestamp": "2026-09-09T00:10:00Z"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `zone_id` | string | Y | 현재 논리 Zone |
| `object_id` | string/null | Y | 대상 Object. `combine_clues`에서는 null |
| `interaction_type` | enum | Y | 행동 타입 |
| `payload` | object | Y | 타입별 입력 |
| `client_event_id` | UUID string | Y | 멱등성 키 |
| `client_timestamp` | datetime/null | Y | 클라이언트 발생 시각 |

---

## 4. v1 Interaction Type

- `inspect`
- `navigate`
- `input`
- `select`
- `combine_clues`

---

## 5. `combine_clues` — 자유 조합형 UX

### 한 줄 정의

> 플레이어가 조사수첩에서 현재 획득한 단서 중 임의의 두 개를 자유롭게 선택하여 관계를 시도하는 상호작용이다. 별도 `puzzle_id`를 요구하지 않으며, 서버는 해당 단서 쌍에 정의된 조합 규칙이 있으면 성공 결과를, 없으면 정상 오답(`incorrect`)을 반환한다.

### Request

```json
{
  "zone_id": "ZONE_003",
  "object_id": null,
  "interaction_type": "combine_clues",
  "payload": {
    "clue_ids": [
      "CLUE_TESTIMONY_01",
      "CLUE_RECORD_03"
    ]
  },
  "client_event_id": "2bb287a4-1db5-4b67-a02e-d4e3de8b0ac1",
  "client_timestamp": "2026-09-09T00:20:00Z"
}
```

### 성공

```json
{
  "success": true,
  "data": {
    "interaction_id": "INT_020",
    "result": {
      "result_type": "correct",
      "message": "두 기록 사이의 모순을 발견했다.",
      "attempt_count": 1
    },
    "state_changes": [
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
    ],
    "ui_actions": []
  }
}
```

### 규칙 없는 정상 조합 시도

두 Clue 모두 획득했지만 서버에 해당 쌍의 조합 규칙이 없으면 정상 오답이다.

```json
{
  "success": true,
  "data": {
    "interaction_id": "INT_021",
    "result": {
      "result_type": "incorrect",
      "message": "두 단서 사이에서는 아직 의미 있는 연결을 찾기 어렵다.",
      "attempt_count": 2
    },
    "state_changes": [],
    "ui_actions": []
  }
}
```

### 계약 위반

다음은 정상 오답이 아니라 Error다.

- Clue를 1개 또는 3개 이상 전달
- 같은 Clue ID를 두 번 전달
- 현재 Play Session에서 획득하지 않은 Clue ID 전달
- 존재하지 않는 Clue ID 전달

예상 오류 코드:

```text
INVALID_CLUE_COMBINATION_REQUEST
```

---

## 6. State Change v1

| 타입 | 의미 |
|---|---|
| `object_unlocked` | Object 해금 |
| `object_locked` | Object 잠금 |
| `object_revealed` | Object 표시 |
| `object_hidden` | Object 숨김 |
| `clue_acquired` | 단서/추론 단서 획득 |
| `puzzle_started` | 퍼즐 시작 |
| `puzzle_completed` | 퍼즐 완료 |
| `hint_level_changed` | 퍼즐 힌트 열람 단계 변경 |
| `current_zone_changed` | 현재 논리 Zone 변경 |
| `zone_completed` | Zone 완료 |
| `case_completed` | Case 완료 |
| `flag_updated` | 일반 진행 플래그 변경 |

`hint_unlocked`는 v1에서 사용하지 않는다.

---

## 7. Hint 상태 변화

```json
{
  "type": "hint_level_changed",
  "target_id": "PUZZLE_001",
  "value": 1
}
```

또는:

```json
{
  "type": "hint_level_changed",
  "target_id": "PUZZLE_001",
  "value": 2
}
```

의미:

```text
0 = 미열람
1 = 힌트 보기
2 = 정답 보기
```

오답 횟수에 따른 자동 해금은 v1에서 사용하지 않는다.

---

## 8. 멱등성

동일한 `play_session_id + client_event_id` 요청은 상태를 두 번 적용하지 않는다.

서버는 재시도 요청에 대해 가능하면 최초 처리 결과와 동일한 결과를 반환한다.

---

## 9. 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v0.2 | inspect/navigate/input/select |
| v0.3 | `combine_clues` 추가 |
| v0.3.1 | 자유 조합형 UX 명시, `hint_unlocked` 제거, `hint_level_changed`로 통일 |
