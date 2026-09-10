# Contract Baseline v0.3.1

> v0.3의 단서 조합 구조를 유지하면서, 자유 조합 UX와 힌트 상태 모델을 명시적으로 확정한 버전.

## 1. v1 Interaction

- `inspect`
- `navigate`
- `input`
- `select`
- `combine_clues`

## 2. `combine_clues` UX 원칙

`combine_clues`는 **자유 조합형**이다.

플레이어는 조사수첩에서 현재 획득한 단서 중 임의의 두 개를 선택하여 관계를 시도한다.

- 별도 `puzzle_id` 없음
- 정확히 2개 Clue 선택
- 두 Clue 모두 현재 Play Session에서 획득 상태여야 함
- 서버가 해당 Clue 쌍에 정의된 조합 규칙을 조회
- 정의된 규칙이 있으면 `correct`
- 정상적으로 획득한 Clue 쌍이지만 규칙이 없으면 `incorrect`
- 획득하지 않은 Clue ID, 1개/3개 요청 등은 계약 위반 Error
- 조합 성공 결과는 `clue_acquired`, `puzzle_completed`, `object_unlocked`, `flag_updated` 등으로 표현 가능

## 3. v1 Puzzle Type

- `code_input`
- `text_input`
- `single_choice`
- `multiple_choice`
- `observation`
- `navigation`
- `clue_combination`

## 4. Hint 모델

본편 v1 힌트 상태는 `hint_level` 필드로 통일한다.

```text
0 = 미열람
1 = 힌트 보기
2 = 정답 보기
```

- `hint_unlocked` 사용하지 않음
- 상태 변경은 `hint_level_changed`
- level 2는 level 1 이력 다음만 허용
- 오답 횟수 기반 자동 해금 없음
- 힌트/정답 내용은 사람이 작성한 정적 콘텐츠

## 5. 공통 원칙

- 위치·회전·모델·조명·카메라 = FE
- 상태·정답·해금 = BE
- 퍼즐 판정 Source of Truth = 서버
- 정답은 FE에 노출하지 않음
- 오답과 규칙 없는 단서 조합은 정상 게임 결과
- `client_event_id`로 멱등성 보장
- 새로고침/재접속 시 서버 Play Session 상태로 복구
