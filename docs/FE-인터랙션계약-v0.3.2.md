# 왜곡 · FE ↔ BE 인터랙션 계약 v0.3.2 (확정)

> **확정일** 2026-09-28 · **작성** 랑(FE) · **상태** FE·BE 전 항목 합의 완료.
> **연동 기준**: 공용 인터랙션 카탈로그 v2.0 (`docs/공용-인터랙션-카탈로그-v2.0.md`).
> BE가 이 내용으로 Request/Response Schema + 닫힌 값 목록을 문서화하여 **Interaction Contract v0.3.2**로 확정 진행. (저장소 정식계약 v0.3.1 → v0.3.2 반영 대기)
>
> **이 문서 목적**: FE(비밀복도/게임 씬) 및 API 클라이언트 구현이 이 계약을 하나도 빠뜨리지 않고 따르도록 하는 단일 참고본. 새 작업 시작 시 이 파일을 먼저 읽을 것.

---

## 0. 한눈에 (핵심 원칙)

1. **모든 게임 상호작용은 `POST /interactions` 하나로 통합**해서 보낸다.
2. FE는 `play_session_id` · `client_event_id` · `action` · `target_type` · `target_id` · `payload`를 보낸다.
3. BE가 **현재 세션 상태 + 퍼즐/콘텐츠 기준으로 검증·판정·상태변경**을 하고, **결과 + 실제 변경분(state_changes)** 만 응답한다.
4. **정답/판정/진행 저장은 서버에만.** FE는 결과(result_type, state_changes)만 화면에 반영한다.
5. **오답은 오류가 아니다.** 정상 게임 결과로 HTTP 200 + `result_type=incorrect`. (실패 없는 설계 — 불이익 없음, 얻은 단서 유지)
6. **문구 소유권은 BE.** `message`(string|null)를 BE가 주고, FE는 null일 때만 기본 문구로 폴백한다.
7. **멱등**: 같은 `(play_session_id, client_event_id)` 재요청 → 최초 결과 그대로 반환(횟수 증가 없음).
8. **역할 분리**: Interaction Response = **변경분(delta)** / `GET /play-sessions/{id}` = **전체 상태(snapshot)**.

---

## 1. Interaction v1 — 계약 5종 (카탈로그 v2.0)

| action | 설명 | target_type | payload |
|---|---|---|---|
| `inspect` | 오브젝트·기록·단서 조사 | `object`·`clue` | `{}` |
| `navigate` | Zone/조사 지점 이동 | `zone` | `{}` |
| `input` | 텍스트·코드 등 입력 | `puzzle` | `{"answer":"1234"}` |
| `select` | 선택지·대상 선택 | `puzzle` | `{"choice":"optA"}` |
| `combine_clues` | 획득 단서 2개 관계 추론·조합 | `puzzle`(우선) | `{"clue_ids":["clueA","clueB"]}` |

**사용하지 않는 옛 기획 ID** (API Interaction ID로 사용 안 함):
`observe` / `collect` / `compare` / `rotate` / `align` / `connect` / `sequence` / `input_code`
- `collect` 기반 **아이템 인벤토리 사용 안 함.** 획득 정보는 `acquired_clue_ids`(PlaySession 상태)로 관리(DEC-15).

---

## 2. 엔드포인트

| 엔드포인트 | 용도 | 비고 |
|---|---|---|
| `POST /interactions` | 모든 게임 상호작용(5종) | 아래 3·4장 |
| `GET /play-sessions/{id}` | 새로고침·재접속 시 전체 상태 복원 | 8장 |
| `POST /puzzles/{id}/hints` (별도 Hint API) | 힌트 요청 | 응답 state_changes에 `hint_level_changed`. **실제 경로 코드 대조 후 확정** |

> 모든 경로는 `/api/v1` 접두어(DEC-06, 이 문서 표에서는 생략). 12월 MVP는 게스트(익명 세션) 전용(DEC-09).

---

## 3. Request (FE → BE, `POST /interactions`)

```jsonc
{
  "play_session_id": "uuid",
  "client_event_id": "uuid",     // FE 생성. 사용자 행동 1건당 1개. 재전송 시에만 같은 값 재사용 = 멱등 키
  "action": "inspect | navigate | input | select | combine_clues",
  "target_type": "object | puzzle | clue | zone",
  "target_id": "string | null",  // 씬 번들에서 받은 id 회신. combine_clues는 nullable
  "payload": { }
}
```

### action별 예시 Request / Response

**inspect** (단서 있는 물건)
```jsonc
// Req
{ "play_session_id":"...", "client_event_id":"...", "action":"inspect",
  "target_type":"object", "target_id":"obj-njc01-001", "payload":{} }
// Res
{ "interaction_id":"...", "result_type":"ok", "message":"낡은 안내판이다.",
  "attempt_count":null,
  "state_changes":[ {"type":"clue_acquired","clue_id":"clue-njc01-03"} ], "ui_actions":[] }
```

**input** (정답 / 오답)
```jsonc
// Req
{ "action":"input", "target_type":"puzzle", "target_id":"P02", "payload":{"answer":"1234"} , ... }
// Res(정답)
{ "result_type":"correct", "message":null, "attempt_count":2,
  "state_changes":[ {"type":"puzzle_completed","puzzle_id":"P02"},
                    {"type":"zone_unlocked","zone_id":"zone-02"} ], "ui_actions":[] }
// Res(오답)
{ "result_type":"incorrect", "message":null, "attempt_count":3, "state_changes":[], "ui_actions":[] }
```

**select**: `payload {"choice":"optA"}`, target `puzzle` — 채점 결과 correct/incorrect/already_completed.

**combine_clues** (정확히 2개)
```jsonc
// Req
{ "action":"combine_clues", "target_type":"puzzle", "target_id":null,
  "payload":{"clue_ids":["clue-01","clue-04"]}, ... }
// Res(맞는 쌍)
{ "result_type":"correct", "message":null, "attempt_count":null,
  "state_changes":[ {"type":"clue_acquired","clue_id":"clue-inferred-1"} ], "ui_actions":[] }
```
- `clue_ids`는 **v1에서 정확히 2개.** 어떤 쌍이 맞는지는 서버만 안다.
- `target_id`는 **nullable**(clue 2개가 실제 대상). puzzle target 필요 여부는 구현 중 재확인.

---

## 4. Response (BE → FE)

```jsonc
{
  "interaction_id": "uuid",      // 서버 발급 UUID. 로깅/상관용
  "result_type": "ok | correct | incorrect | already_completed",
  "message": "string | null",    // BE 제공 문구. null이면 FE 기본문구 폴백
  "attempt_count": 2,            // 채점(input/select)만 증가. 비채점(inspect/navigate)은 null
  "state_changes": [ /* 실제 변경분만. 없으면 [] */ ],
  "ui_actions": []              // v0.1 미사용. 항상 []. FE는 지금 무시
}
```

### 4-1. result_type → FE 화면 처리
| result_type | 의미 | FE 처리 |
|---|---|---|
| `ok` | 비채점 정상 처리(inspect/navigate 등) | 조용히 반영, 연출 없음 |
| `correct` | 채점 정답(최초) | 성공 연출 + state_changes 적용 |
| `incorrect` | 채점 오답(정상 결과, HTTP 오류 아님) | 오답 피드백. **불이익 없음, 얻은 단서 유지** |
| `already_completed` | 새 client_event_id로 완료 퍼즐 재제출 | 재성공 연출 없이 "이미 해결" 안내. **state_changes = []** |

### 4-2. attempt_count 규칙
- 기본 키: **`play_session_id + puzzle_id`**. 첫 채점 제출 = **1**.
- **채점 요청(input/select)에서만 증가.** 비채점은 `null`.
- 동일 `client_event_id` 재전송에서는 **증가하지 않음**.
- `combine_clues`처럼 puzzle_id가 없는 경우 → **정렬된 clue_id 쌍을 키로** 사용.

---

## 5. state_changes 닫힌 목록

| type | payload 필드 | FE 반영 |
|---|---|---|
| `clue_acquired` | `clue_id` | 조사수첩에 단서 추가 |
| `puzzle_completed` | `puzzle_id` | 퍼즐 완료 표시·다음 목표 갱신 |
| `zone_unlocked` | `zone_id` | 해당 구역 열기 |
| `hint_level_changed` | `puzzle_id`, `hint_level` | 힌트 단계 표시 갱신 (Hint API 응답에 실림) |

예:
```jsonc
{"type":"clue_acquired","clue_id":"clue-naju-01-03"}
{"type":"puzzle_completed","puzzle_id":"P02"}
{"type":"zone_unlocked","zone_id":"zone-02"}
{"type":"hint_level_changed","puzzle_id":"P02","hint_level":1}
```
**적용 규칙**: 배열 순서대로 적용 · 변경분만 옴 · **FE는 모르는 type을 만나도 죽지 않게 방어적으로 무시**(타입은 계약에 추가되며 확장될 수 있음).

---

## 6. 에러 구분 (게임 결과 vs HTTP 오류)

**비즈니스 결과(ok/correct/incorrect/already_completed)는 전부 HTTP 200.**

| 상황 | HTTP | FE 처리 |
|---|---|---|
| 정상 게임 결과(오답 포함) | **200** | result_type으로 분기 |
| 잘못된 Request/Payload | **400** / FastAPI **422** | 토스트 + 재시도 |
| 없는 play_session_id·target_id | **404** | 토스트 + 「다시 시도·처음으로」 |
| 만료된 세션 | (BE 세션오류 매핑에 맞춰 확정, 404 계열 예상) | 새 세션 발급 안 함(DEC-08) |
| 서버 내부 오류 | **500** | 토스트 + 재시도 |

- 네트워크 오류·5xx: 현재 화면 유지 + 「다시 시도·처음으로」, 새 세션 발급 금지(USR-110·DEC-08).
- 이벤트는 로컬에 쌓아 재전송(CMN-020·021). 진행을 막지 않는다.

---

## 7. 멱등성

- FE: 사용자 행동 1건당 `client_event_id`(UUID) 하나 생성. **재전송 시에만 같은 값 재사용.**
- BE: `(play_session_id, client_event_id)` 기준 중복 판정 → **최초 결과 그대로 반환**(attempt 증가 없음).
- 효과: FE 오프라인 큐·재전송(5초 배치 + 이탈 시 강제 전송, CMN-020·021)이 **중복 채점 없이** 안전.

---

## 8. 힌트 (별도 Hint API)

- 힌트는 인터랙션 5종에 **넣지 않는다.** 별도 엔드포인트(예: `POST /puzzles/{id}/hints`, **실제 경로 확정 대기**).
- 2단계: 1단계 힌트 → (1단계 후) 2단계 정답 보기.
- 응답 `state_changes`에 `hint_level_changed(puzzle_id, hint_level)` → FE가 힌트 단계 갱신.

---

## 9. 상태 복원 (`GET /play-sessions/{id}`)

- 새로고침·재접속 시 호출. **전체 상태 스냅샷**을 받아 복원.
- 복원 필드(예): `state.acquired_clue_ids`, `completed_puzzle_ids`, `hint_levels`, `flags` 등.
- **Interaction Response = 증분(delta) / PlaySession 조회 = 전체(snapshot).**
- FE는 진입/복귀 시 이 조회로 초기 상태를 세팅, 이후 인터랙션 응답의 state_changes로 증분 갱신.

---

## 10. FE 구현 체크리스트

- [ ] API 클라이언트: `POST /interactions` (play_session_id·client_event_id·action·target·payload)
- [ ] `client_event_id` 생성·보관·재전송 시 재사용
- [ ] `result_type` 4종 분기
- [ ] `state_changes` 타입별 반영(clue_acquired→조사수첩 / puzzle_completed→목표 / zone_unlocked→구역 / hint_level_changed→힌트단계). 모르는 type 무시
- [ ] `message` null 폴백(문구 하드코딩 금지)
- [ ] 에러: 400/422/404/500 → 토스트 + 「다시 시도·처음으로」, 404 세션만료 시 새 세션 발급 안 함
- [ ] 오프라인/재전송 큐(5초 배치 + 이탈 시 강제 전송)
- [ ] 진입·재접속 시 `GET /play-sessions/{id}` 전체 복원
- [ ] 힌트: 별도 Hint API + 응답 hint_level_changed 반영
- [ ] combine_clues: clue_ids 정확히 2개, target_id nullable

---

## 11. 저장소 반영 전 확인 (코드 대조)

- [ ] v0.3.1 계약 파일을 v0.3.2로 갱신
- [ ] Hint API 실제 endpoint 기입
- [ ] 세션 만료 HTTP 매핑 코드 대조
- [ ] combine_clues target_id 필요 여부 확인
- [ ] OpenAPI/테스트와 계약 일치 확인
> 위 항목은 FE·BE 합의가 남은 게 아니라, **실제 구현과 정확히 맞추기 위한 후속 확인**이다.

---

## 12. v0.3.1 → v0.3.2 변경 요약

- Response Schema 정식 정의
- result_type 닫힌 목록 확정
- message / attempt_count 규칙 명시
- state_changes 닫힌 목록 확정
- already_completed의 빈 state_changes 명시
- client_event_id 멱등 규칙 명시
- Interaction Response(delta)와 PlaySession 조회(snapshot) 역할 분리
- target_type에 `zone` 포함
- action별 payload 구체화
- combine_clues를 단서 2개로 제한
- Hint를 별도 API로 분리

---

## 13. 참고 문서
- `docs/공용-인터랙션-카탈로그-v2.0.md` (카탈로그 v2.0 — action 5종 승인 기준)
- 화면설계서 v1.1 — WF-S5(비밀복도 퍼즐 체인), WF-S7-M2(조사수첩), M3(퍼즐·힌트)
- 시스템 아키텍처 다이어그램 (Latent Space v0.3.2)
