# PlaySession State Concurrency Strategy v0.1

**Status: Draft Strategy v0.1**

## 1. 목적

서로 다른 `client_event_id`를 가진 Interaction이 같은
`PlaySession.state_json`을 동시에 변경할 때 발생할 수 있는 lost update를
분석하고, FastAPI, SQLAlchemy Async, MySQL 8 기반 MVP에 적합한 동시성 제어
방식을 제안한다. 이 문서는 설계안이며 ORM, Migration, Service를 변경하지 않는다.

## 2. 현재 Transaction Flow

현재 `process_interaction()`은 다음 순서로 동작한다.

1. `db.get(PlaySession, play_session_id)`로 PlaySession을 일반 조회한다.
2. `(play_session_id, client_event_id)`로 기존 InteractionEvent를 조회한다.
3. Event가 있으면 저장된 응답을 replay하거나 충돌을 발생시킨다.
4. Server Runtime JSON을 읽고 Pydantic으로 검증한다.
5. `play_session.state_json`을 `deepcopy`하여 Interaction을 판정한다.
6. 상태가 바뀌면 ORM 객체의 `state_json` 전체와 `updated_at`을 교체한다.
7. InteractionEvent를 AsyncSession에 추가한다.
8. 한 번의 `commit()`으로 PlaySession UPDATE와 InteractionEvent INSERT를 저장한다.

따라서 한 요청 안에서 state와 Event는 같은 DB transaction에 포함된다.
commit 실패 시 rollback하고, 동일 Event ID의 UNIQUE 경합은 rollback 후 winner
Event를 재조회한다. 다만 PlaySession 조회에는 row lock이 없고 UPDATE에도
revision 조건이 없다.

`app/db/session.py`의 engine과 sessionmaker에는 isolation level을 명시하지 않았다.
실제 격리 수준은 MySQL 서버·세션 설정에 의존한다. 저장소 코드만으로 로컬과
배포 환경의 값을 확정할 수 없다. 현재 `with_for_update()` 사용도 없다.

External input 경로는 Adapter가 Object target을 해석하기 위해 같은 AsyncSession으로
PlaySession을 먼저 일반 조회한 뒤 `process_interaction()`을 호출한다. 따라서
Interaction Service가 실행될 때 이미 transaction과 ORM identity map이 시작됐을 수 있다.

## 3. Lost Update Scenario

두 요청 A와 B가 서로 다른 Event ID이면서 같은 PlaySession을 읽으면 둘 다
동일한 이전 JSON으로 결과를 계산할 수 있다.

```text
state.completed_puzzle_ids = []

A reads [] -> computes [PUZZLE_01]
B reads [] -> computes [PUZZLE_02]

A UPDATE state_json = [PUZZLE_01]
B UPDATE state_json = [PUZZLE_02]
```

InnoDB가 실제 UPDATE 시점의 row write를 순서대로 처리하더라도 B의 값은 이미
오래된 상태에서 계산된 완성 JSON이다. 현재 UPDATE에는 version 조건이 없으므로
B가 A의 결과를 덮을 수 있다. 최종 state에는 하나만 남지만 서로 다른 두 Event는
모두 정상 저장될 수 있어, Event 기록과 복구 상태의 의미도 어긋난다.

## 4. Existing Idempotency와의 차이

현재 멱등성 보강은 같은 `(play_session_id, client_event_id)`의 동시 INSERT를
복합 UNIQUE 제약으로 감지한다. loser는 winner Event의 저장 응답을 replay한다.

서로 다른 Event ID에는 UNIQUE 충돌이 없다. 두 Event 모두 유효하므로 기존
`IntegrityError` 경로는 lost update를 감지하거나 병합하지 못한다. 멱등성과
PlaySession state 직렬화는 서로 보완하지만 별개의 문제다.

## 5. Strategy A - SELECT FOR UPDATE

PlaySession PK row를 locking read로 가져온 뒤 최신 state를 기준으로 판정하고,
state UPDATE와 Event INSERT를 같은 transaction에서 commit한다.

개념적인 SQLAlchemy 2.x 형태는 다음과 같다.

```python
play_session = await db.get(
    PlaySession,
    play_session_id,
    with_for_update=True,
    populate_existing=True,
)
```

또는 `select(PlaySession).where(...).with_for_update()`를 사용할 수 있다.
PK 조회이므로 MySQL은 대상 record를 좁게 lock할 수 있다. 두 요청이 같은
PlaySession을 변경하면 뒤 요청이 기다렸다가 앞 요청의 commit 후 최신 state를 읽는다.

장점:

- JSON 전체 교체 구조를 유지하면서 lost update를 방지한다.
- DB Schema와 Migration이 필요 없다.
- state UPDATE와 Event INSERT의 기존 transaction invariant를 유지하기 쉽다.
- 같은 PlaySession만 직렬화하고 다른 PlaySession은 병렬 처리할 수 있다.
- retry로 Interaction 판정을 여러 번 수행하는 별도 정책이 필요하지 않다.

단점:

- 같은 PlaySession의 요청은 lock 대기열을 만든다.
- Runtime 파일 읽기와 판정 동안 lock을 유지하면 대기 시간이 늘어난다.
- 긴 transaction, lock wait timeout, deadlock 처리와 관측이 필요하다.
- replay·conflict·오류 경로에서도 commit 또는 rollback으로 lock을 확실히 풀어야 한다.

### A-1. Event precheck 후 PlaySession lock

기존 Event가 이미 보이면 PlaySession lock 없이 빠르게 replay할 수 있다.
하지만 precheck가 없음을 반환한 뒤 lock을 기다리는 동안 다른 요청이 Event를
저장할 수 있다. lock 획득 후 Event를 반드시 다시 확인해야 한다.

MySQL `REPEATABLE READ`와 이미 시작된 transaction을 고려하면 두 번째 조회는
오래된 consistent-read snapshot에 의존해서는 안 된다. Event 재확인은 locking/current
read처럼 winner commit을 볼 수 있는 방식이어야 한다. 구현과 테스트가 더 복잡하다.

### A-2. PlaySession lock 후 Event check

먼저 PlaySession을 lock하면 같은 세션의 새 Interaction이 직렬화된다. 그 다음
Event를 최신 상태로 조회하므로 precheck와 lock 사이의 TOCTOU가 없다. 기존 replay도
PlaySession lock을 거치므로 쿼리 대기 비용은 늘지만 순서가 단순하고 안전하다.

**MVP에는 A-2를 권장한다.** Event 조회도 locking/current read로 수행하면,
External Adapter의 선행 일반 조회로 transaction snapshot이 이미 생긴 경우에도
최신 winner Event를 확인할 수 있다. 모든 경로는 동일한 lock 순서를 사용한다.

`populate_existing=True` 또는 동등한 refresh가 중요한 이유는 Adapter가 먼저 로드한
PlaySession ORM 객체가 identity map에 남아 있을 수 있기 때문이다. SQL lock만 얻고
Python 객체의 오래된 `state_json`을 계속 사용해서는 안 된다.

## 6. Strategy B - Optimistic Locking

PlaySession에 정수 `revision` 또는 `version` 컬럼을 추가하고 다음 의미의 UPDATE를 한다.

```text
UPDATE play_sessions
SET state_json = ..., revision = revision + 1
WHERE id = ... AND revision = previous_revision
```

영향:

- ORM 필드와 새 Alembic Migration이 필요하다.
- 기존 행의 초기 revision과 NOT NULL/default 정책이 필요하다.
- SQLAlchemy `version_id_col` 또는 명시적 row-count 검증이 필요하다.
- 충돌 시 rollback 후 최신 state와 Event를 다시 읽고 Runtime 판정부터 재시도해야 한다.
- Event INSERT도 같은 transaction에서 rollback되어야 하며, retry 중 기존 Event가
  생겼는지 다시 확인해야 한다.
- 최대 retry 횟수, backoff, 최종 HTTP 오류 정책이 필요하다.

lock 대기 대신 충돌을 감지하므로 쓰기 경합이 낮고 확장성이 필요할 때 유리하다.
그러나 JSON 상태 재계산, Event transaction, 멱등성까지 묶은 retry 설계가 필요해
현재 MVP에는 Strategy A보다 구현·테스트 부담이 크다.

## 7. Strategy C - Application Lock

프로세스 내부의 `asyncio.Lock`은 한 프로세스에서는 직렬화할 수 있지만 여러 Uvicorn
worker, 여러 서버, 재시작을 넘지 못한다. lock registry의 수명과 정리 문제도 있다.
Redis 분산 lock은 다중 서버를 지원하지만 새 인프라·dependency·TTL·장애 복구 정책이
필요하다. DB transaction과 lock 소유권이 분리되어 Event/state 원자성을 더 어렵게 한다.

현재 MySQL이 이미 상태의 Source of Truth이므로 MVP에서 Application Lock이나 Redis를
추가하지 않는다.

## 8. Strategy D - Defer

싱글 플레이여도 더블클릭, 네트워크 재전송, 여러 UI event, clue 조합과 답 제출의
근접 요청은 서로 다른 Event ID로 도착할 수 있다. 발생 빈도가 낮다는 가정만으로
유효한 state를 잃는 것을 허용하면 두 Event가 성공했지만 하나의 효과가 복구 상태에서
사라질 수 있다.

콘텐츠가 아직 production 단계가 아니라 구현을 일정상 미룰 수는 있으나, Interaction을
MVP 완료로 선언하기 전에는 동시성 제어와 실제 MySQL 검증을 완료하는 편이 적절하다.

## 9. Idempotency + Lock Ordering

권장 순서는 다음과 같다.

```text
1. 요청의 interaction_type / target_id / payload 계산
2. PlaySession을 PK로 SELECT FOR UPDATE
   - 기존 identity-map 객체가 있으면 DB 최신 값으로 refresh
3. 같은 (play_session_id, client_event_id) Event를 locking/current read로 조회
4-a. Event 존재 + 동일 요청
     -> stored response 구성
     -> transaction 종료로 lock 해제
     -> replay 반환
4-b. Event 존재 + 다른 요청
     -> transaction rollback으로 lock 해제
     -> IdempotencyConflictError
5. Runtime load 및 최신 locked state 기반 판정
6. PlaySession state/updated_at 변경 + InteractionEvent 추가
7. 한 commit
8. IntegrityError이면 기존 UNIQUE race recovery를 방어적으로 유지
```

이 순서에서는 같은 PlaySession의 정상 요청이 모두 같은 row를 먼저 lock하므로
교착 가능성을 낮춘다. 향후 다른 row도 lock한다면 모든 경로의 lock 획득 순서를
일관되게 정해야 한다.

현재 replay는 write 없이 곧바로 반환하며 Session 종료 시 transaction이 정리된다.
`FOR UPDATE` 도입 후에는 응답 반환 전에 명시적으로 transaction을 끝내 lock을
해제해야 한다. stored response는 transaction 종료 전에 Pydantic 결과로 구성해,
rollback 후 ORM 속성의 expire/implicit IO 문제를 피한다.

## 10. Runtime Loader와 Lock Duration

### Runtime load 후 lock

lock 보유 시간은 짧아진다. 그러나 Runtime을 고르려면 `case_id`를 먼저 읽어야 하고,
그 read transaction과 ORM identity map을 정리한 뒤 최신 PlaySession을 lock해야 한다.
콘텐츠 파일이 요청 중 교체될 때 어떤 버전을 사용했는지도 별도 문제가 된다.

### lock 후 Runtime load

구조가 단순하며 locked PlaySession의 `case_id`와 최신 state를 함께 사용한다.
대신 파일 I/O, Pydantic validation, 답 정규화와 lookup 동안 row lock을 보유한다.

**MVP 권고는 lock 후 Event check, 그 다음 Runtime load다.** 현재 Runtime은 로컬의
작은 JSON이며 요청 경합이 낮을 것으로 예상된다. replay는 Runtime을 로드하지 않는다.
구현 후 lock hold time을 측정하고, 필요하면 검증된 immutable Runtime cache 또는
versioned content snapshot을 별도 설계한다. 안전성이 확인되지 않은 채 파일 load를
lock 밖으로 이동하지 않는다.

Client Content/Object Resolver는 External input Adapter에서 Interaction Service 전에
실행된다. 이 단계는 row lock을 보유하지 않지만 같은 AsyncSession의 read transaction을
시작할 수 있다. Service의 locking/current read와 ORM refresh가 이 선행 조회를
고려해야 한다.

## 11. 추천안

현재 MVP에는 **Strategy A, PlaySession row의 pessimistic `SELECT FOR UPDATE`**를
추천한다.

- JSON 상태 전체 교체라는 현재 모델과 직접 맞는다.
- Schema/Migration 없이 정확성을 높인다.
- state와 Event를 한 transaction에 저장하는 기존 invariant를 유지한다.
- 충돌 retry와 revision lifecycle을 새로 정의할 필요가 없다.
- 한 플레이 세션의 Interaction을 순서대로 적용하는 게임 도메인과도 맞는다.

요청량이나 한 세션의 동시 쓰기가 증가해 lock wait가 문제가 되면 revision 기반
optimistic locking을 다음 단계로 재평가한다. 현재는 정확성과 작은 구현 범위를
우선한다.

## 12. 테스트 전략

### Unit / Fake Session

- PlaySession 조회 statement가 `FOR UPDATE`를 포함하는지 확인한다.
- 기존 identity-map 객체가 있어도 최신 state를 사용하도록 refresh 옵션을 확인한다.
- lock 후 Event 조회 순서와 동일 요청 replay, 다른 요청 conflict를 확인한다.
- replay, conflict, Runtime 오류, 일반 commit 오류에서 transaction 종료를 확인한다.
- 상태 변경과 Event 추가가 한 commit에 들어가는 기존 테스트를 유지한다.
- UNIQUE `IntegrityError` winner replay 회귀 테스트를 유지한다.

Fake는 SQL과 호출 순서를 검증할 수 있지만 MySQL의 실제 blocking과 snapshot 가시성을
증명하지 못한다.

### 실제 MySQL Integration

실제 MySQL에서 서로 다른 두 `AsyncSession`과 명시적 동기화 지점을 사용하는 테스트가
필요하다.

1. 테스트용 PlaySession을 준비한다.
2. Session A가 row lock을 획득하고 첫 상태 변경을 준비한다.
3. Session B가 같은 PlaySession Interaction을 시작한다.
4. 짧은 timeout 동안 B가 lock에서 대기하며 완료되지 않음을 확인한다.
5. A가 state와 Event를 commit한다.
6. B가 lock을 획득하고 A의 최신 state를 읽어 두 번째 변경을 적용한다.
7. 최종 state에 A/B 효과가 모두 있고 Event 두 개가 저장됐는지 확인한다.
8. 오류 경로 후 lock이 해제되는지도 별도 확인한다.

테스트는 기존 데이터와 분리된 ID를 사용하고 transaction/fixture cleanup을 제한적으로
수행해야 한다. 타이밍만으로 판정하지 말고 `asyncio.Event` 같은 테스트 동기화와
명확한 timeout을 사용한다. Fake test만으로 완료라고 보고하지 않는다.

## 13. 구현 영향 범위

예상 최소 변경:

- `app/services/interaction.py`: locking read, 최신 ORM refresh, Event 재확인,
  replay/conflict/error transaction 종료.
- `tests/test_interaction_service.py`: query·순서·rollback/commit 단위 테스트.
- 별도 MySQL integration test 또는 검증 script: 두 AsyncSession 동시성 검증.
- 관련 Contract/검증 문서: 실제 구현과 MySQL 결과 기록.

`app/services/external_interaction.py`는 선행 PlaySession 조회가 transaction과 identity
map에 미치는 영향을 구현 중 확인해야 한다. locking/current read와 refresh로 해결하면
변경하지 않을 수 있다. 그렇지 않으면 Adapter와 Interaction Service 사이의 transaction
소유권을 작은 범위로 정리해야 한다.

Strategy A에는 ORM column과 Alembic Migration이 필요하지 않다. engine isolation level을
코드로 고정할지는 별도 결정이며, 고정한다면 `app/db/session.py`와 실제 DB 영향 검토가
추가된다.

## 14. Decision Required

1. A-2의 정확성 우선 순서를 승인할지, 빠른 replay를 위한 A-1 이중 조회를 택할지.
2. replay·conflict에서 lock을 해제할 transaction 종료 방식과 Service의 transaction 소유권.
3. Event 재확인을 locking/current read로 통일할지.
4. MySQL isolation level을 현재 서버 설정에 맡길지 애플리케이션에서 명시할지.
5. lock wait timeout·deadlock 발생 시 retry 또는 외부 오류 정책.
6. Runtime 파일 load 시간 허용 기준과 향후 cache/versioning 도입 시점.
7. 실제 MySQL 동시성 테스트를 기본 suite와 분리해 어떻게 실행할지.

## 15. 후속 작업

1. 로컬 MySQL의 실제 isolation level과 InnoDB 사용 여부를 비파괴적으로 확인한다.
2. 승인된 lock·transaction 순서로 Interaction Service를 최소 수정한다.
3. Fake Session 단위 테스트로 SQL 생성, 순서, 모든 종료 경로를 검증한다.
4. 두 AsyncSession MySQL integration test로 blocking과 최종 병합 state를 검증한다.
5. lock wait/deadlock 로그와 오류 정책을 정하고 문서를 갱신한다.
6. Interaction 완료 기준에 동시 distinct Event state 보존 검증을 포함한다.
7. 경합·트래픽 요구가 커지면 revision 기반 optimistic locking을 재평가한다.

## 참고 자료

- [SQLAlchemy `with_for_update()`](https://docs.sqlalchemy.org/en/20/core/selectable.html)
- [SQLAlchemy AsyncSession API](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [MySQL InnoDB Locking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [MySQL InnoDB Deadlock Handling](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks-handling.html)
