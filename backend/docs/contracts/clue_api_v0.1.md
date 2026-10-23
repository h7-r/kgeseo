# Clue API Contract v0.1

**Status: Draft — 구현됨, 팀 검토 대기 (2026-10-23)**

PlaySession이 획득한 단서의 표시 정보(제목·요약·본문)를 제공한다. 단서 정의는
Server 전용 콘텐츠에 두고, 획득한 단서만 서버가 골라 반환한다.
pytest·실제 `TestClient` HTTP 테스트로 검증했으며 실제 MySQL 검증은 하지 않았다.

## 1. 단서 정의 (`<case_id>.server.json` 최상위 `clues`)

```json
{
  "clues": [
    {
      "clue_id": "CLUE_LETTER",
      "title": "낡은 서신",
      "summary": "서신의 핵심 요약",
      "body": "서신에 적힌 전체 내용"
    }
  ]
}
```

| 필드 | 필수 | 규칙 |
|---|---|---|
| `clue_id` | 필수 | 문자열, 빈 값·공백만 있는 값 거부. `clues` 안에서 유일 |
| `title` | 필수 | 문자열, 공백만 있는 값 거부 |
| `summary` | 선택 | 생략 또는 `null`. 값을 쓰면 공백만 있는 값 거부 |
| `body` | 선택 | 생략 또는 `null`. 값을 쓰면 공백만 있는 값 거부 |

- 정의되지 않은 필드(`carrier_kind`, `asset_key` 등)는 거부한다(`extra_forbidden`).
- 글자 수 상한은 아직 두지 않았다(팀 검토 대기).
- 글은 일반 텍스트로 다룬다. Frontend는 HTML로 해석하지 않고 텍스트로 표시한다.
- `client.json`에는 두지 않는다. Case Bundle로 획득 전에 공개되기 때문이다.

### 1.1 참조 검증과 기존 콘텐츠

- `clues` 키가 **없는** 콘텐츠: 기존처럼 단서 ID만 쓴다. 참조 검증을 하지 않는다.
- `clues` 키가 **있는** 콘텐츠(빈 목록 포함): 다음 ID가 모두 `clues`에 정의돼 있어야 한다.
  - `puzzles[].on_correct.grant_clue_ids`
  - `clue_combinations[].clue_ids`, `clue_combinations[].on_success.grant_clue_ids`
  - `inspections[].on_inspect.grant_clue_ids`
- 정의만 있고 어디서도 지급하지 않는 단서는 허용한다.
- 검증은 Server Runtime Schema 단계에서 한다. 실패하면 로드 오류이며
  `python -m scripts.validate_case <case_id>`가 위치와 메시지를 출력한다. 예:
  `case.server.json → (root) → value_error → Value error, Puzzle 'P' references clue 'C' not defined in clues`

## 2. 획득 단서 조회

```http
GET /api/v1/play-sessions/{play_session_id}/clues
```

### 2.1 Success Response (200)

```json
{
  "success": true,
  "data": {
    "play_session_id": "22222222-2222-4222-8222-222222222222",
    "clues": [
      {
        "clue_id": "CLUE_DIARY",
        "title": "젖은 일기",
        "summary": null,
        "body": null
      },
      {
        "clue_id": "CLUE_LETTER",
        "title": "낡은 서신",
        "summary": "서신의 핵심 요약",
        "body": "서신에 적힌 전체 내용"
      }
    ]
  }
}
```

- 해당 PlaySession `state.acquired_clue_ids`에 있는 단서만, 그 순서(획득 순서)대로 반환한다.
- 획득하지 않은 단서는 ID·제목·본문은 물론 개수도 드러내지 않는다.
- 응답은 공개용 모델(`clue_id`, `title`, `summary`, `body`)로만 만든다. 정답, Effect, flags,
  선행 조건 같은 Server 전용 정보는 포함하지 않는다.
- 조회만 한다. PlaySession 상태, Interaction Event, commit을 만들지 않는다.
- 획득한 단서가 없으면 콘텐츠를 읽지 않고 빈 목록을 반환한다.

### 2.2 정의가 없는 단서

획득했지만 현재 콘텐츠에 정의가 없는 단서(`clues` 없는 기존 콘텐츠, 또는 콘텐츠 수정으로
정의가 사라진 경우)는 임의 제목을 만들지 않고 다음처럼 반환한다.

```json
{ "clue_id": "CLUE_LETTER", "title": null, "summary": null, "body": null }
```

`title`은 정의에서 필수이므로 `title: null`은 "정의 없음"을 뜻한다. Frontend 표시 방식은
팀 검토 대기다.

### 2.3 Errors

| 상황 | HTTP | `detail` |
|---|---:|---|
| PlaySession 없음 | 404 | `Play session not found.` |
| Server 콘텐츠 로드 실패(파일 없음, JSON 오류, Schema·참조 오류) | 500 | `Case content is unavailable.` |
| 저장된 `state_json`이 Schema와 다름 | 500 | (처리되지 않은 검증 오류, 기존 PlaySession GET과 같음) |

오류 응답에 단서 ID·제목·파일 경로를 넣지 않는다.

### 2.4 접근 정책

기존 PlaySession GET과 같다. `play_session_id`(UUID)만으로 조회하며 인증·소유자 확인은 없다.
이 한계는 단서 본문에도 그대로 적용된다(팀 검토 대기).

## 3. Interaction과의 관계

- 기존 Interaction 응답은 바뀌지 않는다. `clue_acquired`는 계속 `clue_id`만 담는다.
- 같은 `client_event_id` 재전송은 최초 응답을 replay하므로 단서가 두 번 지급되지 않고,
  이 API에도 한 번만 나온다.
- Case Bundle은 Client Content만으로 만들므로 단서 정의가 들어가지 않는다.

## 4. Frontend 연동 흐름 (제안)

1. 시작·새로고침: `GET /play-sessions/{id}`와 `GET /play-sessions/{id}/clues`로 상태와
   단서를 복원한다(인벤토리 `addAll(..., { silent: true })` 등).
2. Interaction 응답에 `clue_acquired`가 있으면 `GET .../clues`를 다시 받아 새 단서를 추가한다.
3. 대응 예: `title` → 인벤토리 `name`, `summary` → `description`, `body` → 상세 보기.

## 5. 팀 검토 대기

- `carrier_kind` 도입과 Frontend `category`("열쇠" | "기록") 매핑
- `asset_key`와 이미지 지원
- `title: null`(정의 없음) 단서의 Frontend 표시 방식
- 세션 인증·접근 제어
- Content Version 고정(현재 콘텐츠 파일을 요청마다 읽으므로 수정이 진행 중 세션에 바로 반영됨)
- 선행 조건 연동: Q5 `requires_clue_ids`로 구현됨. `clues`를 명시하면 정의된 단서인지
  검증한다(`interaction_puzzle_runtime_v0.1.md` §7.9)
- 글자 수 상한, 획득 직후 표시 지연이 문제일 때 Interaction 응답 확장 여부
