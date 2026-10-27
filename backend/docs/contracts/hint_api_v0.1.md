# Hint API Contract v0.1

**Status: Draft — 팀 검토 대기, PM 미결정 사항 포함. 확정 계약이 아니다.**

공통 서비스(`app/services/hint.py`)만 구현했다. 라우터에 등록하지 않았으므로 HTTP 경로는
아직 없다. 기준: Puzzle Contract v0.3.1 §7·8, FE ↔ BE 인터랙션 계약 v0.3.2 §8.

## 1. 단계 모델 (기존 계약 그대로)

- `hint_level` 0 = 미열람, 1 = 힌트 보기, 2 = 정답 보기
- 1단계는 플레이어가 직접 요청한다. 2단계는 1단계를 연 뒤에만 열 수 있다.
- 오답 횟수 기반 자동 해금은 없다.
- 서버가 `PlaySession.state.hint_levels[puzzle_id]`에 현재 단계를 저장한다. 키가 없으면 0이다.
- 힌트 단계를 바꾸는 곳은 이 서비스뿐이다. NPC는 단계를 바꾸지 않는다(PM 정책 3·5).

## 2. 구현된 서비스 동작

### 2.1 해금 `unlock_hint`

요청 모델 `HintUnlockRequest`:

```json
{ "client_event_id": "<uuid>", "client_timestamp": "<ISO-8601>", "target_level": 1 }
```

`target_level`은 1 또는 2만 받는다(그 밖은 검증 오류).

PlaySession 행 잠금(`with_for_update`) 안에서 다음 순서로 판정한다.

1. PlaySession이 없으면 `PlaySessionNotFoundError`.
2. 같은 `client_event_id`의 이벤트가 있으면 저장된 결과를 돌려준다. 상태 변경·이벤트·commit이
   없다. `interaction_type`·`puzzle_id`·`target_level` 중 하나라도 다르면
   `IdempotencyConflictError`. Interaction API와 같은 표(`interaction_events`)와 같은 고유키를
   쓰므로 Interaction 이벤트 ID를 힌트에 재사용하거나 그 반대도 충돌이다.
3. 퍼즐이 Server Runtime에 없으면 `PuzzleNotFoundError`.
4. 요청 단계의 원문이 없거나 비어 있으면 `HintNotFoundError` (메시지: `퍼즐ID:단계`, 원문 없음).
5. 저장된 단계가 0~2 정수가 아니면 `InvalidHintStateError`.
6. 요청 단계 ≤ 현재 단계이면 `already_unlocked`. 상태는 그대로이고 `state_changes=[]`이다.
   이벤트는 기록한다(재전송 응답 보존). 사용 횟수에 넣지 않는다.
7. 요청 단계 > 현재 단계 + 1이면 `HintLevelSkippedError`.
8. `access_policy(state, puzzle, target_level)`를 호출한다. 거부하면 `HintAccessDeniedError`.
9. `hint_levels[puzzle_id]`를 올리고 `hint_level_changed` 한 개를 만든다. 상태 변경과 이벤트
   INSERT를 한 commit에 저장한다.

이벤트 기록: `interaction_type="unlock_hint"`, `target_id=puzzle_id`,
`payload_json={"target_level": n}`, `result_type`(`hint_unlocked` | `already_unlocked`),
`response_json`(결과, **원문 없음**).

commit 중 고유키 경합이면 rollback 후 승자 이벤트를 다시 읽어 재전송처럼 응답한다.
그 밖의 오류·취소는 rollback 후 그대로 올린다.

결과(`HintUnlockProcessResult`):

```json
{
  "interaction_id": "<uuid>",
  "result": {
    "result_type": "hint_unlocked",
    "puzzle_id": "PZ_01",
    "hint_level": 1,
    "state": { "...": "PlaySessionState" },
    "state_changes": [
      { "type": "hint_level_changed", "puzzle_id": "PZ_01", "hint_level": 1 }
    ]
  },
  "hint": { "level": 1, "text": "<요청 단계 원문>" }
}
```

`hint`는 저장하지 않고 응답할 때마다 `hint_source`에서 읽는다. 요청 단계만 담는다.

재전송(같은 `client_event_id`·같은 내용)은 최초 결과(`result_type`·`state_changes`·`state`)와
`interaction_id`를 그대로 돌려주고 상태·이벤트를 쓰지 않는다. 원문만 그때의 `hint_source`에서
다시 읽는다(§3.1).

### 2.2 조회 `get_puzzle_hint_state`

잠금 없이 읽는다. 상태·이벤트를 바꾸지 않는다. 현재 단계와 1~현재 단계 원문만 돌려준다.
열지 않은 단계는 원문을 읽지도 않는다.

### 2.3 힌트 사용 · 해금 지표

`unlock_hint` 이벤트는 실제 해금과 이미 연 단계 요청이 같은 `interaction_type`이다. 지표는
`interaction_type="unlock_hint"` **이면서** `result_type="hint_unlocked"`인 이벤트만 센다
(그 이벤트만 `state_changes`에 `hint_level_changed`가 있다). `already_unlocked`는 세지 않는다.
`interaction_type`만으로 세면 과다 집계된다. 현재 저장소에 지표 집계 코드는 없다.

### 2.4 이벤트 구분 (PM 확정)

| 이벤트 | 언제 | 기록 주체 | 힌트 단계 | 사용 횟수 |
|---|---|---|---|---|
| `hint_level_changed` | 새 단계 실제 해금 | Hint API (이 서비스) | 올린다 | 센다 |
| `npc_hint_reshown` | 이미 해금된 힌트를 NPC가 재표시 | NPC API (미구현) | 바꾸지 않는다 | 세지 않는다 |
| `npc_nudge_given` | 승인된 `NUDGE_*` 문장 제공 | NPC API (미구현) | 바꾸지 않는다 | 세지 않는다 |

### 2.5 NPC 재표시와의 관계 (PM 확정 정책, NPC API 미구현)

- 정식 힌트와 NPC 힌트는 같은 원본(`hint_source`)을 쓴다. NPC용 사본을 두지 않는다.
- 힌트 해금은 Hint API만 한다. NPC API는 `hint_levels`를 바꾸지 않는다.
- 이미 해금된 2단계 원문 재표시는 허용한다. 단, 플레이어가 명시적으로 요청했을 때만이고,
  서버가 그 퍼즐의 `hint_level >= 2`를 확인한다. 1단계 재표시는 `hint_level >= 1`을 확인한다.
- NPC 응답은 재표시 원문을 대사와 분리한 `reshown_hint`로 싣는다.
- 정답 검사 예외는 그 퍼즐의 승인된 `reshown_hint.text`에만 적용한다. 모델 대사는 기존 정답
  검사를 그대로 받는다. 다른 퍼즐의 정답과 미해금 원문은 계속 막는다.
- 재표시는 사용 횟수에 넣지 않고 `npc_hint_reshown`으로 기록한다.
- 서버 측 확인에는 §2.2의 조회(해금한 단계 원문만 반환)를 재사용할 수 있다.

## 3. 미결정 사항 (서비스가 정하지 않음)

| 항목 | 지금 처리 | 결정 주체 |
|---|---|---|
| 힌트 원문의 콘텐츠 필드 위치 | `hint_source(case_id, puzzle_id, level)` 인자로 받는다. 기본 구현 없음 | PM (정책 12) |
| Zone 접근 제한 | `access_policy` 인자. 서비스는 판정하지 않는다 | PM |
| 완료한 퍼즐의 힌트 해금 | `access_policy` | PM |
| 선행 단서 미획득 시 해금 | `access_policy` (`PuzzleDefinition.requires_clue_ids` 전달됨) | PM |
| "플레이어의 명시적 요청"을 어떤 입력으로 판정할지 | NPC API 범위 | PM · FE |
| HTTP 경로 · 응답 envelope · 오류 상태 코드 | 라우터 미등록 | BE · FE 합의 |
| `access_policy`를 이미 연 단계에도 적용할지 | 지금은 새 단계 해금에만 호출 | 팀 합의 |
| 콘텐츠가 바뀐 뒤 재전송 응답의 원문 | §3.1 | PM · 팀 합의 |
| `already_unlocked` 이벤트 증가 | §3.2 | 팀 합의 |

### 3.1 원문 변경 후 재전송

원문을 이벤트에 저장하지 않으므로 재전송 응답의 결과는 최초와 같고 원문만 그때의 콘텐츠다.

- 원문이 **수정**되면: 재전송에 수정된 원문이 나간다.
- 원문이 **삭제**되면: 최초 요청은 성공했는데 재전송은 `HintNotFoundError`다. 상태·이벤트는
  바뀌지 않는다.

Q7 inspect `message`는 반대로 `response_json`에 저장해 재전송 때 최초 문구를 준다. 힌트는
2단계가 정답이라 이벤트(DB)에 정답 원문을 남기지 않으려고 저장하지 않았다. 콘텐츠 버전
관리가 없어 둘 다 만족하는 방법이 없다. 선택지(미결정):

1. 지금처럼 저장하지 않는다(정답 원문이 이벤트에 없음, 재전송 원문은 최신본, 삭제 시 실패).
2. Q7처럼 저장한다(재전송 최초 문구 보장, 이벤트 표에 정답 원문 저장).
3. 콘텐츠 버전(예: case 버전 또는 원문 해시)을 이벤트에 저장하고 불일치를 감지한다(콘텐츠 버전
   체계 필요).

### 3.2 `already_unlocked` 이벤트 증가

새 `client_event_id`로 이미 연 단계를 요청할 때마다 이벤트가 하나씩 쌓인다. 지표에는 들어가지
않지만(§2.3) 횟수 제한이 없다. 최소 변경 선택지(미결정):

1. `already_unlocked`는 이벤트를 남기지 않는다. 결과가 늘 같아 재전송도 같은 결과지만,
   응답마다 `interaction_id`가 달라지고 그 ID의 나중 재사용 충돌을 감지하지 못한다.
2. 이벤트는 남기되 라우터에서 세션별 요청 빈도를 제한한다.
3. FE는 이미 연 단계를 `GET` 조회로 보여주고 해금 요청을 보내지 않는다(서버 변경 없음).

오류 상태 코드 제안(미확정): 퍼즐·힌트 없음 404, 단계 건너뜀·접근 거부·멱등 충돌 409,
저장 상태 오류·콘텐츠 로드 실패 500. 경로 제안(미확정):
`POST /api/v1/play-sessions/{play_session_id}/puzzles/{puzzle_id}/hints` (Puzzle Contract v0.3.1).

## 4. 미결정 기능의 테스트 설계 (구현 대기)

정책이 정해지면 `access_policy` 구현과 함께 추가한다.

- Zone 제한: 현재 Zone 밖 퍼즐 해금 거부 / 허용, `current_zone_id=null` 세션 처리
- 완료한 퍼즐: `completed_puzzle_ids`에 있는 퍼즐의 1·2단계 요청 결과
- 선행 단서: 부족할 때 거부 여부, 거부 응답에 단서 ID 대신 개수만 싣는지(Q5와 같게)
- `hint_source` 콘텐츠 로더: 필드 위치 확정 후 스키마 검증(원문 공백 거부, 2단계만 있는 퍼즐
  거부, 미정의 퍼즐 ID 거부), `validate_case.py` 반영
- 라우터: 경로·envelope·상태 코드, 번들(`GET /cases/{id}/bundle`)에 원문이 없는지
- 실제 MySQL 동시성: `scripts/verify_interaction_concurrency.py`와 같은 방식으로 힌트 동시 해금
  (이번 테스트는 행 잠금을 흉내 낸 가짜 세션으로만 검증)
