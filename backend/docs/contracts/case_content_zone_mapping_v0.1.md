# Case Content / Zone Runtime Mapping v0.1

**Status: Draft Mapping v0.1**

이 문서는 Frontend v0.3.1의 Zone 조회 개요와 현재 Backend 코드를 비교한 설계 및
Client Content Loader와 Case Bundle API v0.1 구현 상태를 기록한다.
저장소에는 Frontend v0.3.1 원문이 없으므로, Zone API의 세부 응답 필드와 오류
정책은 확정하지 않는다. Production 콘텐츠 JSON과 Session 기반 Zone API는 아직 없다.

## 1. 목적

Client에 공개할 Case 콘텐츠, PlaySession에서 계산할 Zone 상태, Server-only 판정 데이터를
분리한다. 확정된 `GET /api/v1/cases/{case_id}/bundle`은 정적 Client Content만 제공하고,
외부 조회 기준인 `GET /api/v1/play-sessions/{play_session_id}/zones/{zone_id}`에 필요한
데이터와 결정 사항을 식별한다.

## 2. Frontend Zone Contract

제공된 Frontend v0.3.1 개요에 따르면 Zone은 `zone_id`, `zone_name`, `zone_type`,
`description`, `objects[]`, `navigation`, `metadata`를 포함한다. Object에는 `object_id`,
`object_name`, `object_type`, `visible`, `enabled`, `interaction`이 있고,
`interaction`은 `interaction_type`, `target_id` 등의 연결 정보를 갖는다.
Navigation은 `door_object_id`와 `target_zone_id`를 연결한다.

Client Content의 Object는 플레이어가 상호작용 가능한 대상의 정의다.
`visible=false`인 Object도 Client Content에는 존재하고 Frontend에서 숨김 처리한다.
`enabled=false`는 Object가 존재하지만 Interaction 불가임을 뜻한다.
이 두 값의 Session별 동적 계산 조건과 Zone HTTP 응답 조립은 아직 구현되지 않았다.

## 3. Backend Runtime 현황

`app/schemas/puzzle_runtime.py`는 `PuzzleRuntimeDefinition` 아래 `puzzles`와
`clue_combinations`를 정의한다. Puzzle에는 `puzzle_id`, `accepted_answers`,
`on_correct`가 있고, Clue Combination에는 `combination_id`, 두 `clue_ids`,
`on_success`가 있다. Effect는 `grant_clue_ids`, `complete_puzzle_ids`, `set_flags`다.

`app/services/puzzle_runtime.py`는 `<case_id>.server.json`을 요청 시 읽어 검증한다.
현재 `app/content/cases/`에는 production Case JSON이 없다.
Runtime Schema와 Loader에는 Zone, Object, 표시 텍스트, navigation 또는
Object 공개/활성 조건이 없다. 따라서 현재 Runtime만으로 Zone 응답을 생성할 수 없다.

Client 쪽에는 `app/schemas/case_content.py`의 `CaseClientContent`와
`app/services/case_content.py`의 `load_case_client_content(case_id)`가 추가되었다.
이 Loader는 정적 Client Definition을 반환할 뿐 PlaySession 상태를 적용하지 않는다.

## 4. Client / Session State / Server-only 분류

| 분류 | 예시 | 원천 및 주의점 |
|---|---|---|
| Client Static Content | Zone/Object ID·이름·유형·설명, `asset_key`, interaction 연결, navigation, 정적 `visible`·`enabled` | Client Content Definition으로 검증. 실제 에셋 내용과 공개 범위는 후속 검토 |
| Session-derived Runtime State | Object `visible`·`enabled`, 퍼즐 완료, 단서 획득, 힌트 단계, 조건부 navigation | PlaySession 값과 **별도로 정의된 공개 조건**을 함께 사용해야 함 |
| Server-only Runtime | `accepted_answers`, 정규화·정답 판정 규칙, `clue_combinations.clue_ids` 매칭, `on_correct`·`on_success` Effect, 판정·공개 조건의 내부 표현 | Zone 응답에 원본 또는 내부 규칙을 직렬화하지 않음 |

`puzzle_id`·`clue_id` 자체는 공개 연결에 필요할 수 있으나, 어떤 ID를 공개할지는
Client Content Schema에서 명시해야 한다. `clue_combinations`의 두 입력 ID 관계와
성공 Effect는 정답을 누설할 수 있으므로 공개하지 않는다. `flags`의 현재 값도
그대로 내려보내지 않고, 허용된 공개 상태로 해석하는 규칙이 필요하다.

현재 PlaySession의 `completed_puzzle_ids`, `acquired_clue_ids`, `hint_levels`, `flags`는
완료/획득/힌트 단계의 **저장값**을 제공한다. 그러나 Object별 조건식과 Zone/Navigation
정의가 없으므로 `visible`·`enabled`를 계산할 수 없다. `flags`는 임의 key/value이며
어떤 flag가 어떤 Object에 영향을 주는지도 정의되어 있지 않다.

## 5. ID 연결 규칙

- `PlaySession.case_id`로 해당 Case의 Client Content와 Server Runtime을 찾는다.
- 요청 `zone_id`는 해당 Case의 Zone Definition에 존재해야 한다.
- `object_id`는 Zone 안에서 Object를 식별하고, navigation의 `door_object_id`는
  해당 Object를 참조하며 `target_zone_id`는 같은 Case의 Zone을 참조해야 한다.
- 외부 Interaction의 `object_id`와 Zone Object ID는 같은 식별자 체계를 사용해야 한다.
- `object_id`와 Backend target ID는 서로 다른 역할이며, Object의
  `interaction.target_id`를 통해 연결한다. 문자열 값의 불일치는 요구하지 않는다.
  `input`의 target은 Server Runtime의 puzzle ID 존재 여부로 교차 검증한다.
- Interaction Adapter의 `input`은 Client Content Object Resolver를 통해
  `interaction.target_id`를 내부 `submit_answer.target_id`로 전달한다.
- 공개되는 clue ID와 Runtime Effect/PlaySession의 clue ID는 일치해야 한다.
- **Confirmed v0.1:** 이미 Load된 Client/Server 모델을
  `validate_case_content_links(client_content, server_runtime)`에 전달하면,
  먼저 두 모델의 `case_id` 일치를 확인하고, `input` Object의
  `interaction.target_id`가 Server `puzzles[].puzzle_id`에 존재하는지 검사한다.
  이후 Zone 순서, Object 순서대로 첫 오류에서 실패한다.
  두 Loader는 독립적이며 이 검증을 자동 실행하지 않는다.
- **Confirmed v0.1:** Server Runtime의 `puzzles[].puzzle_id`는 한 Runtime 안에서
  유일해야 하며, 중복은 Runtime Schema validation error다.
- **Confirmed v0.1:** Object Resolver는 이미 Load된 Client Content에서 요청
  `zone_id`와 `object_id`로 Object를 찾고, 선언된 `interaction.type`이 요청
  `interaction_type`과 같을 때 `interaction.target_id`를 반환한다.
  `combine_clues`는 Object 기반 해석 대상이 아니다. `inspect`·`select`·`navigate`는
  선언된 mapping만 읽을 수 있으며 Backend 동작이나 target 의미를 확정하지 않는다.

## 6. Client Content Definition 필요 여부

**확정: MVP에서는 `app/content/cases/<case_id>.client.json`과 기존
`<case_id>.server.json`을 명시적으로 분리한다.** Client 파일은 공개 가능한
Zone/Object/표시 텍스트/navigation와 필요한 공개 ID 연결만 담는다.
Server 파일은 정답, 조합 매칭, Effect와 내부 공개 조건을 담당한다.

한 원본 파일을 프로그램으로 분리하려면 export/검증 파이프라인과 누출 방지 규칙이
추가로 필요하다. 현재는 이런 체계가 없으므로 두 파일을 분리하는 쪽이 MVP에서
정답 정보의 실수 노출을 막기 쉽다. 대신 파일 간 ID 불일치 위험이 있으므로
확정된 `input` 참조는 독립 Validator와 테스트로 확인한다. 다른 참조의 정책은
Contract 확정 후 확장한다.

Client Content Schema는 모든 구조적 모델에 `extra="forbid"`를 적용한다.
`accepted_answers`, `on_success`, `complete_puzzle_ids`, `grant_clue_ids`, `set_flags`
등은 공개 Schema에 정의하지 않으며 잘못 삽입된 필드는 검증 오류로 처리한다.
`metadata`는 공개 필드가 확정되지 않아 빈 `ClientMetadata` 모델만 허용하며,
임의 키를 거부한다. 공개 metadata 필드는 FE Contract 확정 후 명시적으로 추가한다.
Zone 응답은 허용된 공개 필드로 구성하고 파일 원본을 통째로
반환하거나 `server.json`을 정적 파일로 서빙하지 않는다.

v0.1의 `visible`·`enabled`는 작성자가 명시하는 정적 초기값이다.
Session-derived 조건 문법과 보관 위치는 아직 미정이다. 조건이 정답·숨김 정보를
드러낼 수 있다면 Server-only로 둔다. Production JSON은 이번 단계에서 만들지 않는다.
Object Resolver는 Zone/Object/interaction 존재와 type 일치만 검사하여 target ID를
해석한다. Object State Resolver와 달리 정적 또는 Session-derived `visible`·`enabled`로
요청 가능 여부를 판정하지 않는다. Interaction Adapter는 input target 해석에만
이 Resolver를 사용하며 Object 상태 판정은 아직 없다.

## 7. Zone 조회 처리 흐름

```text
Router: play_session_id / zone_id 수신, Service 호출, 오류를 HTTP로 변환
  -> Service: PlaySession 조회, case_id 확인, Client Content와 필요한
              Server-only 공개 조건을 이용해 Zone 계산, 공개 응답 생성
  -> Client Loader: case_id의 client.json 읽기·Schema 검증, DB 접근/응답 생성 없음
  -> Server Loader: 필요할 때만 server.json을 별도로 읽고 판정 규칙은 비공개 유지
  -> DB: PlaySession의 저장된 진행 상태만 읽기
```

Router는 DB를 직접 조회하거나 `visible`·`enabled`를 계산하지 않는다.
Service는 공개 가능한 Object 정의와 정적 `visible`·`enabled`에 향후 Session 상태를
반영하고 Server Runtime 내부 필드를 응답에 섞지 않는다. Client Loader는 구현됐지만
Zone Service/API는 아직 없다. Zone 조회에서 state 변경이나 commit은 하지 않는다.

## 8. Case Bundle v0.1

`GET /api/v1/cases/{case_id}/bundle`은 파일 기반 Client Content를 정적 preload
Bundle로 제공한다. Client와 Server Runtime을 모두 로드하고 기존 cross-file Validator를
실행한 뒤, 별도의 Public Response Adapter가 허용된 Client 필드만 반환한다.

Object의 공개 `interaction`에는 `type`만 포함한다. 내부 puzzle 연결인
`interaction.target_id`와 Server Runtime 전체는 반환하지 않는다. `object_id`는 Zone
내부에서만 유일하므로 외부 Object 주소는 `(zone_id, object_id)` 조합이다.

Bundle의 `visible`·`enabled`는 정적 초기값이다. Session 파생 상태는 포함하지 않으며,
향후 Zone API 또는 Interaction `state_changes`가 별도로 담당한다. 상세 계약은
`docs/contracts/case_bundle_api_v0.1.md`에 기록한다.

### 8.1 Interaction Adapter 오류 매핑

현재 Interaction Router는 Client Content와 Object Resolver에서 발생하는 다음 예외만
명시적으로 HTTP 오류로 변환한다.

| Exception | HTTP Status | `detail` |
|---|---:|---|
| `ZoneNotFoundError` | 404 | `Zone not found.` |
| `ObjectNotFoundError` | 404 | `Object not found.` |
| `ObjectInteractionNotFoundError` | 409 | `Object interaction is unavailable.` |
| `InteractionTypeMismatchError` | 409 | `Interaction action does not match the object.` |
| `CaseClientContentError` | 500 | `Case content is unavailable.` |

Object의 정적 또는 Session-derived `visible`·`enabled`를 이용한 요청 가능 여부 판정은
아직 구현하지 않았으므로 이 표에 새로운 오류 규칙을 추가하지 않는다.

## 9. Contract Gap

- Frontend v0.3.1 Zone 원문의 정확한 응답 Schema, 오류 응답, `metadata` 구조 미확인
- `inspect`·`select` target 의미와 `navigate.interaction.target_id` 규칙 미확정
- Clue ID registry 및 공개 Clue와 Server Runtime의 연결 검증 미확정
- Session 상태가 정적 `visible`·`enabled`를 덮어쓰는 구체적인 규칙
- Object/Navigation의 공개·활성 조건, 조건 표현과 Server-only 보관 위치
- Interaction Adapter의 Object 상태 판정 정책 미정
- 공개 가능한 Puzzle/Clue 표시 필드와 에셋 참조 범위
- `current_zone_id`의 저장·갱신 주체 및 요청 Zone 접근 정책
- Frontend `status`와 Backend `completed_at`의 관계; 일시정지 등 상태는 현재 모델에 없음
- `input` 이외의 파일 간 ID 참조 무결성 정책
- Production Content 검증·배포 단계에서 `scripts/validate_case.py`를 실행하는 자동화 위치

`current_zone_id`와 `status`가 현재 PlaySession 모델/GET 응답에 없어도
Zone ID로 **정적 Zone을 조회**하는 형태 자체는 설계할 수 있다. 하지만 현재 위치
제한, navigation 진행, 접근 권한 또는 세션 상태에 의존하는 Zone 응답은 정확히
만들 수 없다. 경로의 `zone_id`를 저장된 현재 위치로 간주해서는 안 된다.
이 Gap은 Zone API 구현 전에 Frontend/Backend와 합의해야 한다.

## 10. 구현 순서 제안

1. Frontend v0.3.1 Zone 원문과 Object/Navigation/Visibility 세부 계약을 확보한다.
2. 구현된 Client Loader를 바탕으로 공개 필드와 Object/Target ID 규칙을 검토한다.
3. Client `input.interaction.target_id`의 Server puzzle 존재 검증은 구현됐으며,
   게임 실행 전 호출 위치와 다른 ID 검증 범위는 후속 결정한다.
4. Object Resolver의 Interaction Adapter 연결과 현재 예외의 HTTP 매핑은 구현됐으며,
   Object 상태 판정 정책은 별도 작업에서 결정한다.
5. Session-derived 공개 조건과 `current_zone_id`/`status`의 필요 범위를 결정한다.
6. Zone Service에서 PlaySession state를 읽고 공개 Zone 응답을 조립한다.
7. Zone Router/API 테스트를 추가하고 실제 콘텐츠·DB 통합 검증 후 문서를 갱신한다.

이번 Adapter 연결 단계에서는 DB Schema, Migration, Session/Interaction Service,
production Case JSON을 변경하지 않는다.
