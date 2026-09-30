# 왜곡 · FE ↔ BE 인터랙션 계약 v0.3.2 (확정)

> **확정일** 2026-09-28 · **작성** 랑(FE) · **상태** FE·BE 전 항목 합의 완료.
> BE가 이 내용으로 Request/Response Schema + 닫힌 값 목록을 문서화하여 **Interaction Contract v0.3.2**로 확정 진행. (저장소 정식계약 v0.3.1 → v0.3.2 반영 대기)
>
> **이 문서 목적**: FE(비밀복도/게임 씬) 및 API 클라이언트 구현이 이 계약을 하나도 빠뜨리지 않고 따르도록 하는 단일 참고본. 새 작업 시작 시 이 파일을 먼저 읽을 것.

---

## 0. 한눈에 (핵심 원칙)

1. **모든 게임 상호작용은 `POST /interactions` 하나로 통합**해서 보낸다.
2. FE는 `play_session_id` · `client_event_id` · `action` · `target` · `payload`를 보낸다.
3. BE가 **현재 세션 상태 + 퍼즐/콘텐츠 기준으로 검증·판정·상태변경**을 하고, **결과 + 실제 변경분(state_changes)** 만 응답한다.
4. **정답/판정/진행 저장은 서버에만.** FE는 결과(result_type, state_changes)만 화면에 반영한다. (번들에는 표시용 데이터만 온다)
5. **오답은 오류가 아니다.** 정상 게임 결과로 HTTP 200 + `result_type=incorrect`. (실패 없는 설계 — 불이익 없음, 얻은 단서 유지)
6. **문구 소유권은 BE.** `message`(string|null)를 BE가 주고, FE는 null일 때만 기본 문구로 폴백한다.
7. **멱등**: 같은 `(play_session_id, client_event_id)` 재요청 → 최초 결과 그대로 반환(횟수 증가 없음).
8. **역할 분리**: Interaction Response = **변경분** / `GET /play-sessions/{id}` = **전체 상태 복원**.

---

## 1. 엔드포인트

| 엔드포인트 | 용도 | 비고 |
|---|---|---|
| `POST /interactions` | 모든 게임 상호작용(5종) | 아래 Request/Response |
| `GET /play-sessions/{id}` | 새로고침·재접속 시 전체 상태 복원 | `state.acquired_clue_ids` 등 |
| `POST /puzzles/{id}/hints` (별도 Hint API) | 힌트 요청 | 응답 state_changes에 `hint_level_changed` |

> 모든 경로는 계약 기준 `/api/v1` 접두어(DEC-06). 이 문서 표에서는 접두어 생략.
> 12월 MVP는 **게스트(익명 세션) 전용** — 로그인/회원가입 API 미사용(DEC-09).

---

## 2. Request (FE → BE, `POST /interactions`)

```jsonc
{
  "play_session_id": "uuid",     // 현재 플레이 세션 id
  "client_event_id": "uuid",     // ★ FE 생성. 사용자 행동 1건당 1개. 재전송 시에만 같은 값 재사용 = 멱등 키
  "action": "inspect | navigate | input | select | combine_clues",
  "target_type": "object | puzzle | clue | zone",
  "target_id": "obj-njc01-001",  // 씬 번들에서 받은 id를 그대로 회신. combine_clues는 nullable
  "payload": { }                 // action별 (아래 3장)
}
```

### 필드 설명
- **play_session_id**: 케이스 진입(`POST /play/session`) 때 발급받은 세션. 모든 인터랙션에 포함.
- **client_event_id**: FE가 `crypto.randomUUID()` 등으로 **행동마다 새로 생성**. 네트워크 오류로 재전송할 때만 **같은 값**을 다시 쓴다(그래야 BE 멱등 판정이 걸린다).
- **action**: 5종 고정(inspect / navigate / input / select / combine_clues). 인벤토리(collect/carryable) 개념은 폐기(DEC-15).
- **target_type / target_id**: 상호작용 대상. id는 콘텐츠(씬 번들)에서 내려온 값을 회신.
- **payload**: action별 추가 데이터. 없으면 `{}`.

---

## 3. action별 상세 (payload · target_type · 예시)

### 3-1. `inspect` — 물건/단서 조사 (E)
- **target_type**: `object` 또는 `clue`
- **payload**: `{}`
- **결과**: 대개 `result_type=ok`. 단서가 있으면 state_changes에 `clue_acquired`.
```jsonc
// Request
{ "play_session_id":"...", "client_event_id":"...", "action":"inspect",
  "target_type":"object", "target_id":"obj-njc01-001", "payload":{} }
// Response
{ "interaction_id":"...", "result_type":"ok", "message":"낡은 안내판이다. 글자가 지워져 있다.",
  "attempt_count":null,
  "state_changes":[ { "type":"clue_acquired", "clue_id":"clue-njc01-03" } ],
  "ui_actions":[] }
```

### 3-2. `navigate` — 구역 이동
- **target_type**: `zone`
- **payload**: `{}`
- **결과**: `result_type=ok`. 필요 시 `zone_unlocked` 등.

### 3-3. `input` — 퍼즐 답안 입력 (숫자/문자/순서)
- **target_type**: `puzzle`
- **payload**: `{ "answer": "1234" }`
- **결과**: 채점 → `correct` / `incorrect` / `already_completed`. `attempt_count` 증가.
```jsonc
// Request
{ "play_session_id":"...", "client_event_id":"...", "action":"input",
  "target_type":"puzzle", "target_id":"P02", "payload":{ "answer":"1234" } }
// Response (정답)
{ "interaction_id":"...", "result_type":"correct", "message":null, "attempt_count":2,
  "state_changes":[
    { "type":"puzzle_completed", "puzzle_id":"P02" },
    { "type":"zone_unlocked",   "zone_id":"z2" }
  ], "ui_actions":[] }
// Response (오답)
{ "interaction_id":"...", "result_type":"incorrect", "message":null, "attempt_count":3,
  "state_changes":[], "ui_actions":[] }
```

### 3-4. `select` — 선택형 퍼즐 (고르기)
- **target_type**: `puzzle`
- **payload**: `{ "choice": "optA" }`
- **결과**: 채점 → correct/incorrect/already_completed.

### 3-5. `combine_clues` — 두 단서 대조 (조사수첩 M2)
- **target_type**: `puzzle` (단, **target_id는 nullable** — clue 2개가 실제 대상. puzzle target 필요 여부는 구현 중 재확인)
- **payload**: `{ "clue_ids": ["clueA", "clueB"] }` — **정확히 2개** (v1 제한)
- **결과**: 맞는 쌍이면 추론 단서 생성 → `clue_acquired`. 어떤 쌍이 맞는지는 서버만 안다.
```jsonc
// Request
{ "play_session_id":"...", "client_event_id":"...", "action":"combine_clues",
  "target_type":"puzzle", "target_id":null,
  "payload":{ "clue_ids":["clue-01","clue-04"] } }
// Response (맞는 쌍)
{ "interaction_id":"...", "result_type":"correct", "message":null, "attempt_count":null,
  "state_changes":[ { "type":"clue_acquired", "clue_id":"clue-inferred-1" } ],
  "ui_actions":[] }
```

---

## 4. Response (BE → FE)

```jsonc
{
  "interaction_id": "uuid",      // 서버 발급 UUID. 로깅/상관용
  "result_type": "ok | correct | incorrect | already_completed",
  "message": "string | null",    // BE 제공 문구. null이면 FE 기본문구 폴백
  "attempt_count": 2,            // (play_session_id, puzzle_id) 기준 누적. 채점(input/select)만 증가, 그 외 null
  "state_changes": [ /* 실제 변경분만. 없으면 [] */ ],
  "ui_actions": []              // v0.1 미사용. 항상 [] (미래 연출 지시 예약). FE는 지금 무시
}
```

### 4-1. `result_type` → FE 화면 처리
| result_type | 의미 | FE 처리 |
|---|---|---|
| `ok` | 비채점 정상 처리(inspect/navigate 등) | 조용히 반영(조사 뷰 열기 등), 연출 없음 |
| `correct` | 채점 정답 | 성공 연출(빛/사운드) + state_changes 적용 |
| `incorrect` | 채점 오답 | 오답 피드백(흔들림/문구). **불이익 없음, 얻은 단서 유지(단조성)** |
| `already_completed` | 이미 해결한 퍼즐 재제출 | "이미 해결" 안내만. **state_changes = []** (새 변경 없음) |

### 4-2. `state_changes` 닫힌 타입 (BE Naming Contract 기준)
| type | payload 필드 | FE 반영 |
|---|---|---|
| `clue_acquired` | `clue_id` | 조사수첩에 단서 추가 |
| `puzzle_completed` | `puzzle_id` | 퍼즐 완료 표시 · 다음 목표 갱신 |
| `zone_unlocked` | `zone_id` | 해당 구역 열기 |
| `hint_level_changed` | `puzzle_id`, `hint_level` | 힌트 단계 표시 갱신 (Hint API 응답에 실림) |

**적용 규칙**
- 배열 **순서대로** 적용한다.
- 각 type이 담는 키는 위 표 고정. 추가 상태 변경이 필요하면 **계약에 타입을 추가**하는 방식(FE는 모르는 type은 무시하도록 방어적으로 처리 권장).
- `state_changes`는 **변경분만**. 전체 현재 상태는 `GET /play-sessions/{id}`로 받는다.

---

## 5. 에러 구분 (게임 결과 vs HTTP 오류)

**비즈니스 결과(ok/correct/incorrect/already_completed)는 전부 HTTP 200.**
요청 자체를 처리할 수 없는 경우만 HTTP 오류로 구분한다.

| 상황 | HTTP | FE 처리 |
|---|---|---|
| 정상 게임 결과(오답 포함) | **200** | result_type으로 분기 |
| 잘못된 Request/Payload | **400** 또는 FastAPI **422** | 토스트 안내 + 재시도 |
| 없는 play_session_id · target_id | **404** | 토스트 + 「다시 시도 · 처음으로」 |
| 만료된 anonymous/play 세션 | (BE 세션오류 매핑에 맞춰 확정) | 404 계열이면 **새 세션 발급하지 않음**(화면설계서 DEC-08) |
| 서버 내부 오류 | **500** | 토스트 + 재시도 |

- 네트워크 오류·5xx는 **현재 화면 유지 + 「다시 시도 · 처음으로」**, 새 세션 발급 금지(USR-110 예외 · DEC-08).
- 이벤트는 로컬에 쌓아 재전송(CMN-020 · 021). 진행을 막지 않는다.

---

## 6. 멱등성 (중복 처리 방지)

- FE: **사용자 행동 1건당 `client_event_id`(UUID) 하나 생성.** 성공 응답을 받으면 그 id는 소비됨.
- **재전송(네트워크 오류 등) 시에만 같은 `client_event_id`를 다시 사용.**
- BE: `(play_session_id, client_event_id)` 기준으로 중복을 판정 → **최초 결과 그대로 반환**(attempt_count 등 증가 없음).
- 효과: FE의 오프라인 큐·재전송(5초 배치 + 이탈 시 강제 전송, 화면설계서 CMN-020·021)이 **중복 채점 없이** 안전.

---

## 7. 힌트 (별도 Hint API)

- 힌트는 인터랙션 5종에 **넣지 않는다.** 별도 엔드포인트: `POST /puzzles/{id}/hints`.
- 2단계: 1단계 힌트 → (1단계 후) 2단계 정답 보기.
- 응답의 `state_changes`에 **`hint_level_changed`(puzzle_id, hint_level)** 를 실어 내려줌 → FE는 그걸로 힌트 단계 표시를 갱신.
- (참고) 화면설계서 EVT-013 hint_used. 힌트 열람은 진행을 막지 않음.

---

## 8. 상태 복원 (`GET /play-sessions/{id}`)

- 새로고침·재접속 시 호출. `state.acquired_clue_ids`, 완료 퍼즐, 힌트 단계, 남은 시간 등 **전체 상태**를 받아 복원.
- 즉: **Interaction Response = 증분 / PlaySession 조회 = 스냅샷(전체).**
- FE는 진입/복귀 시 이 조회로 초기 상태를 세팅하고, 이후 인터랙션 응답의 state_changes로 증분 갱신.

---

## 9. FE 구현 체크리스트

- [ ] API 클라이언트: `POST /interactions` (play_session_id·client_event_id·action·target·payload)
- [ ] `client_event_id` 생성·보관·재전송 시 재사용 로직
- [ ] `result_type` 4종 분기(ok/correct/incorrect/already_completed)
- [ ] `state_changes` 타입별 로컬 상태 반영(clue_acquired→조사수첩 / puzzle_completed→목표 / zone_unlocked→구역 / hint_level_changed→힌트단계). 모르는 type 무시.
- [ ] `message` null 폴백 처리(문구 하드코딩 금지, BE 우선)
- [ ] 에러 처리: 400/422/404/500 → 토스트 + 「다시 시도·처음으로」, 404 세션만료 시 새 세션 발급 안 함
- [ ] 오프라인/재전송 큐(5초 배치 + 이탈 시 강제 전송)
- [ ] 진입·재접속 시 `GET /play-sessions/{id}`로 전체 상태 복원
- [ ] 힌트: 별도 `POST /puzzles/{id}/hints` 연동 + 응답 hint_level_changed 반영
- [ ] combine_clues: clue_ids 정확히 2개, target_id nullable

---

## 10. 열린 항목 / 주의

- **combine_clues의 target_id**: 현재 nullable. 실제 구현에서 puzzle target이 꼭 필요한지 BE와 재확인.
- **만료 세션 HTTP 매핑**: BE 세션오류 매핑 확정 값에 맞출 것(404 계열 예상).
- state_changes 타입은 **확장될 수 있음** → FE는 알 수 없는 type을 만나도 죽지 않게 방어적으로.

---

## 11. 참고 문서
- 화면설계서 v1.1 (S0~S9 + 모달 4종) — WF-S5(훈련실·비밀복도 퍼즐 체인), WF-S7-M2(조사수첩), M3(퍼즐·힌트)
- 공용 인터랙션 카탈로그 00 (v2.0, 5종·acquired_clue_ids로 갱신 예정)
- 시스템 아키텍처 다이어그램 (Latent Space v0.3.2)
- 프로젝트 문서: `claude/FE-인터랙션계약-v0.3.2.md` (claude.ai 프로젝트 사본)
