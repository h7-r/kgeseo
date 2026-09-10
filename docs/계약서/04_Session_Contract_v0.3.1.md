# 04_Session_Contract_v0.3.1

> v0.3 구조를 유지하면서 새로고침/재접속 시 힌트 UI를 정확히 복원할 수 있도록 `hint_levels`를 추가한 버전.

## 1. Anonymous Session

Anonymous Session 구조는 변경 없음.

```text
id
created_at
expires_at
```

게임 진행 상태는 Play Session이 소유한다.

---

## 2. Play Session 상태 조회

```http
GET /api/v1/play-sessions/{play_session_id}
```

예:

```json
{
  "success": true,
  "data": {
    "play_session_id": "7b795c7d-2862-46d7-8b03-93eb832fb557",
    "case_id": "CASE_001",
    "current_zone_id": "ZONE_003",
    "status": "playing",
    "acquired_clue_ids": [
      "CLUE_TESTIMONY_01",
      "CLUE_RECORD_03",
      "CLUE_DEDUCTION_02"
    ],
    "completed_puzzle_ids": [
      "PUZZLE_CLUE_COMBINE_01"
    ],
    "hint_levels": {
      "PUZZLE_001": 1,
      "PUZZLE_002": 0,
      "PUZZLE_CLUE_COMBINE_01": 2
    },
    "flags": {},
    "started_at": "2026-09-09T00:10:00Z",
    "updated_at": "2026-09-09T00:45:00Z"
  }
}
```

---

## 3. `hint_levels`

`hint_levels`는 Puzzle별 현재 힌트 열람 단계를 저장한다.

```text
0 = 미열람
1 = 힌트 보기
2 = 정답 보기
```

FE는 새로고침/재접속 시 이 값을 전역 Store에 복원한다.

오답 횟수 기반 자동 해금은 v1에서 사용하지 않는다.

---

## 4. 단서 조합 복구

별도 Item 상태를 만들지 않는다.

조사로 얻은 Clue와 조합으로 획득한 Deduction Clue를 모두 `acquired_clue_ids`로 복구한다.

```text
CLUE_A
+
CLUE_B
↓
CLUE_DEDUCTION_C
```

---

## 5. 변경 이력

| 버전 | 변경 내용 |
|---|---|
| v0.2 | Anonymous / Play Session 분리 |
| v0.3 | 단서 조합 결과를 `acquired_clue_ids`로 통합 |
| v0.3.1 | 새로고침 복구용 `hint_levels` 추가 |
