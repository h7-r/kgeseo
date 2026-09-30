# PlaySession / Frontend Session Mapping v0.1

**Status: Draft Mapping v0.1**

## 1. 목적

Frontend가 기대하는 Session 필드와 현재 Backend의 저장·API 계약을 대조하고,
위치, 상태, 시각의 표현 방향과 선행 결정을 분리한다. 이 문서는 설계 제안이며
ORM, DB Schema, 기존 API Response를 변경하지 않는다. 저장소에는 Frontend
Session Contract 원문이 없어, 아래 FE 필드 목록은 이번 작업에 제공된 개요와
`fe_backend_interaction_mapping_v0.1.md`를 기준으로 한다.

## 2. 현재 Backend PlaySession

`play_sessions`에는 `id`, `anonymous_session_id`, `case_id`, `state_json`,
`created_at`, `updated_at`, `completed_at`이 있다. 신규 `state_json`은
`current_zone_id`, `completed_puzzle_ids`, `acquired_clue_ids`, `hint_levels`,
`flags`를 가진다. `PlaySessionState.current_zone_id`는 과거 row 호환을 위해
nullable이다.

`POST /api/v1/play-sessions`는 `case_id`와 `anonymous_session_id`를 받아
`created_at`과 중첩된 `state`를 반환한다. 현재 `case_id`는 1~64자 문자열이며
생성 시 Client Content를 검증하고 `entry_zone_id`를 초기 위치로 저장한다.
`GET /api/v1/play-sessions/{play_session_id}`는 `created_at`, `updated_at`,
`completed_at`과 중첩된 `state`를 반환한다. 완료 세션도 조회 가능하다.
DB 시각은 UTC 기준 naive `DATETIME(6)`이고 API는 UTC offset을 명시한다.

Interaction Service는 `state_json` 변경 시 `updated_at`을 갱신하지만,
현재 `completed_at`을 설정하거나 Zone 위치를 갱신하지 않는다.

## 3. Frontend Session Contract

제공된 개요의 최소 필드는 `play_session_id`, `case_id`, `current_zone_id`,
`status`, `acquired_clue_ids`, `completed_puzzle_ids`, `hint_levels`,
`flags`, `started_at`, `updated_at`이다. 상태 필드는 평탄한 구조일 수 있다.
정확한 Response envelope, 각 필드의 필수·null 허용 여부, `status` 값 집합은
저장소에서 확인되지 않았다. 이를 확정된 API Contract로 간주하지 않는다.

## 4. Field Mapping

| FE 필드 | 현재 Backend 원천 | 현재 차이 및 제안 |
|---|---|---|
| `play_session_id` | `PlaySession.id` | 기존 POST/GET에 있음 |
| `case_id` | `PlaySession.case_id` | 기존 POST/GET에 있음 |
| `current_zone_id` | `state_json.current_zone_id` | 신규 세션은 `entry_zone_id`, 과거 row는 `null`; Navigation 갱신 규칙은 WIP |
| `status` | 없음 | FE 값 집합 확인 후 `completed_at` 파생 여부 결정 |
| `acquired_clue_ids`, `completed_puzzle_ids`, `hint_levels`, `flags` | `state_json`, `PlaySessionState` | 기존 API에서는 `data.state` 안에 있음 |
| `started_at` | `created_at` 후보 | 의미가 일치하면 외부 별칭으로 매핑 |
| `updated_at` | `PlaySession.updated_at` | 기존 GET에 있으며 POST에는 없음 |
| `completed_at` | `PlaySession.completed_at` | 기존 GET에 있음; FE 전용 형태에서 생략 가능 여부 결정 |

`anonymous_session_id`는 DB 관계 필드지만 현재 PlaySession Response에 없고,
FE 최소 필드에도 없다. 내부 저장 필드와 외부 필드를 동일하게 강제하지 않는다.

## 5. current_zone_id 저장 전략

| 후보 | Zone API·이어하기·상태 갱신 | 구현 및 Migration |
|---|---|---|
| A. `play_sessions` 컬럼 | 위치를 명시적으로 조회·갱신하고 인덱싱하기 쉽다. 진행 상태와 별도 컬럼의 일관성을 관리해야 한다. | 새 Migration, ORM, 기존 행의 nullable/backfill 정책 필요 |
| B. `state_json.current_zone_id` | 기존 진행 상태와 함께 읽고 같은 트랜잭션에서 갱신할 수 있어 새로고침·이어하기에 적합하다. Zone API도 세션 상태에서 읽을 수 있다. | DB Schema Migration 불필요. Schema와 생성·조회는 구현됨. Navigation Service는 WIP |
| C. Frontend-only | Backend가 현재 위치를 검증하거나 재접속 시 복구할 수 없다. 여러 기기·탭에서 불일치할 수 있다. | 서버 변경은 적지만 Backend Source of Truth 원칙에 맞지 않음 |

**확정: B.** MVP에서는 진행 상태인 `current_zone_id`를 `state_json`에 둔다.
신규 세션은 Client Content의 `entry_zone_id`로 초기화한다. 단, 저장만으로
Navigation 계약이 생기지는 않는다.
이동 요청의 대상·접근 권한·멱등성·트랜잭션 경계는 별도 합의가 필요하다.
요청의 `zone_id`를 자동으로 현재 위치에 기록하지 않는다. 위치에 대한
독립 쿼리·인덱스 요구가 확인되면 A를 다시 검토한다.

## 6. 초기 Zone 전략

| 후보 | 장점 | 문제 |
|---|---|---|
| A. `zones[0]` | 필드 추가가 없다. | 배열 재정렬이 시작 위치를 바꾸고 빈 Zone 목록을 처리할 규칙이 없다. 암묵 계약이 된다. |
| B. Client Content `entry_zone_id` | Case 작성자가 시작 위치를 명시하고 Zone ID 존재를 검증할 수 있다. | Client Schema·검증·생성 흐름에 반영됨. Production Content 배포는 별도 절차 |
| C. 생성 Request의 초기 Zone | 선택 가능한 시작 위치를 표현할 수 있다. | 클라이언트 입력 신뢰·접근 검증이 필요하고 기존 POST Request 계약이 바뀐다. |
| D. 초기 `null` | 기존 행·콘텐츠가 없는 개발 환경과 호환하기 쉽다. | 첫 화면·이어하기 위치를 결정하지 못한다. FE가 null을 허용해야 한다. |

**확정: 새 콘텐츠에는 B.** Client Content Schema는 필수 `entry_zone_id`를 가지며,
같은 Case의 Zone ID를 참조하도록 검증한다. Zone 배열의 첫 항목을 초기 Zone으로
간주하지 않으며, 배열 순서는 초기 Zone의 의미를 바꾸지 않는다. production JSON은
아직 없다.

PlaySession 생성은 Client Content를 필수로 읽고 `entry_zone_id`를
`current_zone_id`로 저장한다. 기존 row는 누락 key를 `null`로 읽으며 조회 시
자동 보정하지 않는다.

## 7. status 전략

| 후보 | 평가 |
|---|---|
| A. DB 컬럼 | 여러 독립 수명주기 상태가 확정되면 명시적이지만 Migration·전이 규칙·기존 행 보정이 필요하다. |
| B. `completed_at`에서 계산 | 진행/완료 두 상태만 필요하다면 중복 저장 없이 계산할 수 있다. 단, 실제 완료 처리에서 `completed_at`을 일관되게 설정해야 한다. |
| C. `state_json.status` | Migration은 피하지만 `completed_at`과 불일치할 수 있고 상태 전이의 단일 원천을 다시 정해야 한다. |

**조건부 제안: B.** FE가 진행/완료 두 상태만 사용하고 정확한 문자열 값을
확정한다면 `completed_at is None`/non-null로 외부 status를 파생한다.
현재 Interaction Service에는 완료 시각 설정 규칙이 없으므로 지금 곧바로
정확한 게임 상태로 제공할 수 없다. `active`, `completed`는 예시 이름일 뿐
확정 enum이 아니다. `paused`, `abandoned`, `failed` 등의 실제 요구도 확인되지
않아 추가하지 않는다. 값 집합과 완료 전이 주체는 Decision Required다.

## 8. started_at / created_at

현재 `created_at`은 PlaySession을 생성하면서 기록하며 코드에서도 플레이 시작
시각으로 설명한다. FE의 `started_at`이 이 순간을 뜻한다면 외부 Adapter에서
`created_at`을 `started_at`으로 매핑할 수 있다. DB 컬럼 rename은 필요 없다.
UTC naive 저장과 UTC offset이 있는 API 표현을 유지한다. FE가 실제 첫 입장
시각처럼 다른 의미를 원한다면 별도 시각 정책이 필요하다.
기존 POST/GET의 `created_at` 이름을 합의 없이 제거하지 않는다.

## 9. completed_at 내부 유지

`completed_at`은 완료 시각 기록, 진행/완료 구분, 운영·분석에 유용하므로
DB 내부에서 유지한다. 기존 GET Contract에도 포함되어 있다. FE 전용 응답에서
생략하더라도 기존 GET 필드를 제거하지 않는다. 외부 status를 이 값으로
계산하려면 완료 시각을 설정하는 게임 종료 규칙이 먼저 필요하다.

## 10. 기존 state_json 호환성

기존 행에는 `current_zone_id`가 없다. 읽기 Schema는
`current_zone_id: str | None = None`으로 누락 키를 비파괴적으로 허용한다.
GET은 과거 행의 위치를 `null`로 반환하며 DB를 갱신하지 않는다. 이는 DB Migration
없이 과거 행을 읽게 하지만 **유효한 위치를 복원하는 것과는 다르다.** 무승인
일괄 UPDATE, 현재 Content의 `entry_zone_id` 주입, `zones[0]` 추론은 하지 않는다.
신규 세션은 검증된 `entry_zone_id`를 non-null 값으로 저장한다.

현재 GET Router는 네 상태 키를 직접 조립한다. 향후 위치 키를 추가하면
읽기/쓰기 Schema뿐 아니라 생성·조회 응답 구성과 Interaction 결과의 state
직렬화도 함께 검토해야 한다. `PlaySessionState`의 기본값 추가는 과거 응답에
`null` 키를 새로 내보낼 수 있으므로 기존 API 계약 회귀 테스트가 필요하다.
Interaction Service가 `state_json`을 복사해 갱신하더라도, 새 필드의 외부
노출과 직렬화 계약까지 자동으로 보장하지는 않는다.

## 11. Zone API 영향

`GET /api/v1/play-sessions/{play_session_id}/zones/{zone_id}`는 저장된
`current_zone_id` 없이도 Case Content의 **정적 Zone 정의**를 찾는 형태로
설계할 수 있다. 그러나 요청 Zone이 현재 위치인지, 이미 방문 가능한지,
Navigation으로 이동할 수 있는지 판단하는 정책은 만들 수 없다.

- `current_zone_id`: 현재 위치와 이어하기 시작점을 나타내는 저장 상태. Zone 조회만으로 갱신하지 않는다.
- 정적 `visible`·`enabled`: Client Content의 초기 표시값이며 현재 Object Resolver는 이를 접근 통제로 사용하지 않는다.
- `completed_puzzle_ids`, `acquired_clue_ids`: 저장된 진행 사실. Object/Navigation 공개 조건과 연결하려면 별도 규칙이 필요하다.
- `flags`: 내부 임의 key/value 상태. 원본을 Zone 응답에 무조건 복사하지 않고 허용된 공개 상태로 해석해야 한다.
- Session-derived `visible`·`enabled`: 위 상태와 별도 공개 조건 Contract를 결합해 계산해야 하며 현재 구현되지 않았다.

`status`와 위치에 따라 Zone 접근을 제한할지도 미정이다. Navigation 처리와
위치 변경은 별도 Service 규칙 및 필요 시 같은 DB 트랜잭션으로 설계한다.

## 12. Decision Required

1. FE Session 원문의 `status` 정확한 값 집합과 각 값의 전이 조건, 완료 판정 주체.
2. FE `started_at`이 세션 생성 시각과 같은 의미인지.
3. 평탄한 FE 응답의 정확한 envelope/필수 필드와 기존 POST/GET을 보존할 버전·Adapter 경계.
4. Navigation 입력·접근·갱신 규칙과 Zone API의 현재 위치 제한 여부.
5. Session-derived `visible`·`enabled` 및 flag 공개 조건의 원천과 표현 방식.

## 13. 구현 순서 제안

1. FE Session/Zone 원문으로 status 값 집합과 외부 응답 형태를 확정한다.
2. 완료 전이와 `completed_at` 정책을 구현한 뒤 status 파생 가능성을 검증한다.
3. Navigation과 Zone 접근/표시 규칙을 별도 Contract로 확정하고 Service/API를 구현한다.
4. Session-derived `visible`·`enabled`와 flag 공개 규칙을 확정한다.
5. 각 단계에서 기존 POST/GET, 과거 행, UTC, 실제 API/DB 동작을 회귀 검증한다.

**External Response 방향:** 내부 `state_json`과 ORM 필드 구조는 유지하고,
FE 전용 Adapter에서 필요한 필드만 평탄화하는 B안이 적합하다. 다만 기존
POST/GET 계약을 그 자리에서 바꾸지 않도록 endpoint/version 또는 호환 응답
방식을 먼저 합의한다. 중첩 `state`를 그대로 내보내는 A안은 구현량이 적지만
FE가 평탄한 상태를 요구한다면 차이를 해결하지 못한다.
