# NPC G1~G3 승인 이력 영속화

기준: `feat/SJ-ai-npc-integration` / `6264576`.

## 구현 범위와 운영 연결 상태

- `ReviewRecord`, `gate_decisions()`, 기존 메모리 저장소 및 기존 테스트는 변경하지 않았다.
- Async MySQL Repository와 관리자 기록 서비스, DB 이력을 읽는 내부 게시 판정 경계를 추가했다.
- 검증된 관리자 인증·권한 체계가 기존 코드에 없어 관리자 HTTP 라우트는 **연결하지 않았다**. 무인증 POST는 404이며 승인 입력이 불가능하다.
- 공개 게시 API, 서버 시작 등록, NPC 턴의 매 요청 DB 조회, 게시 중단, 신규 멱등 저장소, hint_ref, 자동 개입 정책은 추가하지 않았다. 운영 LLM도 OFF다.
- 기존 NPC 경로의 메모리 승인 공급 방식은 그대로다. 이 기능만으로 운영 NPC 연결이 완료되지는 않는다.

## 저장 범위

`npc_approval_reviews`는 `review_id` PK, `target_type`, `target_id`, `content_version`, `gate`, `target_hash`, `decision`, `reviewer`, `reviewed_at`, `reason`, `supersedes`를 저장한다.

- `target_type`: `case_content` / `dialogue_pack`. 같은 ID라도 타입별로 조회가 분리된다.
- 이력 조회·쓰기 직렬화 범위: `(target_type, target_id, content_version)`.
- 판정은 그 범위 안에서 기존 함수가 `(gate, target_hash)`별 최신 `(reviewed_at, review_id)` 기록을 선택한다. PM의 대상·gate 개념에 버전·fingerprint 범위를 함께 적용한다.
- 두 대상 모두 G1~G3가 기본이다. dialogue_pack의 G3 전용 정책은 도입하지 않았다.
- 세션 FK나 대사 본문은 저장하지 않는다. 콘텐츠의 `approvals[]`는 승인 원본으로 사용하지 않는다.
- ID·해시는 binary collation으로 비교한다. 새 target_id 입력은 앞뒤 공백을 거부한다.

UUID·UTC 밀리초 문자열·decision 5종·사유 규칙은 기존 `ReviewRecord`로 검증한다. DB에는 UUID `CHAR(36)`, 해시 `CHAR(71)`, 검토 시각 `DATETIME(3)`를 사용한다.

## 추가만 가능한 이력과 동시성

Repository의 `append()`는 대상 잠금 후 중복 ID와 supersedes의 존재를 검사하고 flush만 한다. commit/rollback은 서비스가 관리한다.

기존과 같이 supersedes는 전체 이력에서의 존재를 검사한다. 다른 hash의 이전 기록 참조를 허용하며, 참조 범위를 임의로 강화하지 않았다. 조회 범위 밖 참조나 잘못된 재승인 연결은 기존 `gate_decisions()`에서 FAIL이 될 수 있다. 저장 성공은 게시 승인 성공이 아니다.

`npc_approval_targets`의 `(target_type, target_id, content_version)` PK 행을 upsert하고 잠근다. 기록이 0건이어도 동시 쓰기가 직렬화된다. 잠금 행에는 UPDATE가 있지만 승인 이력에는 없다.

`records(current=True)`는 쓰기 잠금 안에서 최신 커밋 이력을 읽는다. 조회 시 현재 hash만 미리 필터링하지 않아 stale hash 및 supersedes 판정 의미를 유지한다.

관리자 서비스가 UUID와 UTC 시각을 생성한다. 같은 밀리초의 UUID 정렬로 재승인이 과거로 배치되지 않게 서버 시각을 밀리초로 내린 값과 해당 범위 최종 시각+1ms 중 큰 값을 쓴다. 검토 순서를 보존하는 서버 발급 시각이며 클라이언트는 지정할 수 없다.

- 같은 review_id 재시도는 기존처럼 오류다. 자동 성공 재반환 정책을 도입하지 않았다.
- 오래된 supersedes를 자동 보정하거나 새 이력으로 재기준화하지 않는다. 동시 기록 결과가 유효한지는 기존 판정 규칙을 따른다.
- ORM UPDATE/DELETE는 이벤트로 거부한다. migration의 MySQL 트리거는 직접 SQL UPDATE/DELETE도 거부한다. migration 실행 계정은 TRIGGER 권한이 필요하다.
- DB 장애·취소·검증 실패는 승인으로 바꾸지 않으며 기록 서비스는 rollback한다.

## 관리자 HTTP 연결 보류 계약

`GateReviewCreate`는 target과 gate/hash/decision/reason/supersedes만 입력받는다. `review_id`, `reviewed_at`, `reviewer` 및 알 수 없는 필드는 거부한다.

내부 `create_gate_review()`는 `VerifiedAdmin` 신원을 요구한다. 이 객체는 인증 기능 자체가 아니며 요청 JSON의 역할 이름이나 reviewer 문자열로 만들면 안 된다. 향후 검증된 관리자 인증 의존성에서만 생성해야 한다. 현재는 어떤 HTTP 라우트도 이 서비스를 호출하지 않는다.

팀 확정이 필요한 내용:

1. 관리자 로그인 검증 방식 및 서버 권한 판정 원본
2. 인증 주체에서 `reviewer`를 생성하는 규칙
3. 최종 prefix, 인증 실패(401/403), 검증 실패 및 중복/참조 오류의 HTTP 계약
4. 승인 기록의 유일한 운영 입력 경로 및 운영 DB 계정의 직접 쓰기 제한

## 게시 판정 경계

`check_target_approval()`는 두 target_type에 대해 DB 이력을 읽고 기존 `gate_decisions()`를 실행한다.

`evaluate_publication_with_db_reviews()`는 case_content 이력을 읽은 뒤 동기 `ApprovalSource`로 기존 `evaluate_publication()`에 전달한다. fingerprint는 기존 PUB-GATE가 콘텐츠에서 재계산한다. 대상·버전이 다르면 빈 이력을 공급한다.

### 트랜잭션 소유권 (2026-10-30 수정)

이전에는 두 함수가 **호출자의 `AsyncSession`** 으로 일반 조회를 했다. MySQL `REPEATABLE READ`에서는 트랜잭션의 첫 일반 조회가 snapshot을 고정한다. 그래서 이미 다른 것을 읽은 세션을 재사용하면, 그 뒤에 commit된 `hold`·`rejected` 기록을 게시 판정이 보지 못했다. 격리 MySQL에서 재현했다: 철회 commit 뒤 판정이 `()`(모든 게이트 통과)를 돌려줌. 오류가 나면 호출자 세션을 rollback해서 호출자의 미커밋 변경까지 지우는 문제도 있었다.

지금 계약:

- 두 함수는 세션이 아니라 **세션 팩토리**(`async_sessionmaker[AsyncSession]`)를 받는다. 판정마다 새 세션·새 트랜잭션을 연다. 호출자 세션은 읽지도, commit·rollback하지도 않는다.
- 새 트랜잭션에서 append와 같은 대상 잠금 행(`npc_approval_targets`)을 잠그고, 잠금 읽기(`records(current=True)`)로 **최신 커밋 이력**을 읽는다. 철회 commit 뒤에 시작한 판정은 그 철회를 반영한다. 철회 트랜잭션이 아직 commit 전이면 판정이 잠금을 기다린 뒤 철회를 반영한다.
- 이력 트랜잭션이 commit된 **뒤에** 판정·기존 게이트를 실행한다. 잠금 대기 초과(1205)·교착(1213)·연결 오류·취소·commit 실패는 그대로 전파된다. 승인 결과나 store 등록으로 바뀌지 않는다. 판정 전용 트랜잭션은 rollback된다.
- 잠금 해제 뒤에 commit된 철회는 「게시 뒤 철회」와 같다. PM 정책(철회만으로 기존 게시본을 자동 중단하지 않음)에 따라 이 경계는 등록된 store를 되돌리지 않는다.
- `locked_approval_history(sessions, target)`는 잠금을 잡은 채 `(session, records)`를 넘기는 블록이다. 블록이 정상 종료하면 commit, 예외·취소면 rollback한다. **향후 게시 확정은 이 블록 안에서 같은 세션으로 기록해야** 판정과 확정 사이에 철회가 끼어들지 않는다. 블록 동안 같은 대상의 append는 대기한다. 게시 확정 자체는 아직 구현하지 않았다.
- 같은 대상의 잠금을 다른 트랜잭션에서 잡은 채 이 함수를 부르면 잠금 대기 끝에 1205 오류가 난다. 대기 시간은 서버의 `innodb_lock_wait_timeout`(기본 50초)을 따른다.
- `records()`의 기본(`current=False`)은 snapshot 조회이므로 게시 판정에 쓰지 않는다.

기존 게이트의 store 인자를 명시적으로 넘기면 기존 방식으로 등록할 수 있지만 새 공개 게시 경로나 자동 등록은 없다. store가 없을 때의 UNVERIFIED 등 기존 판정도 유지한다.

미승인 기록을 추가해도 이 경계가 기존 게시 store나 진행 세션을 제거하지 않는다. 게시 중단과 신규 NPC 멱등 응답의 철회 우선순위는 별도 작업이다.

## Alembic

새 revision `d2a6f8b1c903`의 부모는 `c9e1a4b7d2f0`다. 기존 revision은 수정하지 않았다.

온보딩 병합 시 `d2a6f8b1c903`(또는 후속 최신 head)과 `c9d8e7f6a5b4`를 새 merge revision으로 합쳐야 한다. 이번 변경에는 그 merge를 넣지 않았다. downgrade는 이력 테이블을 삭제하므로 운영 적용 전 별도 검토가 필요하다.

### 운영 적용 전 권한 확인

`d2a6f8b1c903`은 테이블 2개, 인덱스 1개, 트리거 2개(`npc_approval_reviews_no_update`, `npc_approval_reviews_no_delete`)를 만든다. migration 실행 계정에 필요한 것:

| 항목 | 없을 때 | 확인 |
|---|---|---|
| 대상 schema의 `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP` | 테이블·인덱스 생성 실패 | `SHOW GRANTS FOR CURRENT_USER();` |
| 대상 schema의 `TRIGGER` | `1142 TRIGGER command denied` | 위와 같음 |
| binary logging이 켜져 있으면(`@@log_bin = 1`): `SUPER` 또는 `log_bin_trust_function_creators = 1` | `1419 You do not have the SUPER privilege and binary logging is enabled` | `SELECT @@log_bin, @@log_bin_trust_function_creators;` |

- AWS RDS·Aurora는 `SUPER`를 주지 않는다. 트리거를 만들려면 **DB 파라미터 그룹**에서 `log_bin_trust_function_creators = 1`이 필요하다. 이 값은 운영 DB 전체 설정이므로 DB 관리자 승인 뒤 변경한다.
- 트리거의 `DEFINER`는 migration 실행 계정이다. 그 계정을 삭제하면 이력 UPDATE·DELETE는 트리거 오류로 계속 거부되지만, 오류 문구가 정의자 부재 오류로 바뀐다. 전용 migration 계정은 삭제하지 않거나 트리거를 다시 만든다.
- 앱 실행 계정에는 `TRIGGER`·`DROP`을 주지 않는다. 앱 계정이 트리거를 지울 수 있으면 직접 SQL 수정 차단이 무력해진다.

### 부분 적용 실패 시 복구

MySQL DDL은 트랜잭션으로 묶이지 않는다(문마다 암묵 commit). Alembic은 이 revision의 모든 문이 성공한 뒤에만 `alembic_version`을 올린다. 그래서 중간에 실패하면 **앞 단계의 테이블·인덱스는 남고 version은 `c9e1a4b7d2f0`에 머문다**. 이 상태에서 다시 실행하면 `1050 Table 'npc_approval_targets' already exists`로 실패한다.

복구 순서:

1. 쓰기 경로가 연결돼 있지 않은지 확인한다. 현재는 관리자 HTTP 라우트가 없어 새 테이블에 쓰는 경로가 없다.
2. 상태 확인:
   ```sql
   SELECT version_num FROM alembic_version;            -- c9e1a4b7d2f0 이어야 한다
   SHOW TABLES LIKE 'npc_approval%';
   SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = DATABASE();
   SELECT (SELECT COUNT(*) FROM npc_approval_reviews) + (SELECT COUNT(*) FROM npc_approval_targets) AS rows_total;
   ```
   - version이 `c9e1a4b7d2f0`이 아니면 중단하고 보고한다.
   - `rows_total`이 0이 아니면 **삭제하지 말고 중단**한다(아래 SQL은 빈 테이블에만 쓴다).
3. 남은 객체를 생성 역순으로 지운다. 존재하는 것만 지운다.
   ```sql
   DROP TRIGGER IF EXISTS npc_approval_reviews_no_delete;
   DROP TRIGGER IF EXISTS npc_approval_reviews_no_update;
   DROP TABLE IF EXISTS npc_approval_reviews;   -- 인덱스도 함께 삭제된다
   DROP TABLE IF EXISTS npc_approval_targets;
   ```
4. 원인(권한, `log_bin_trust_function_creators`)을 고친 뒤 `alembic upgrade head`를 다시 실행한다.
5. 검증:
   - `alembic current` = `d2a6f8b1c903 (head)`
   - 트리거 2개 존재
   - 행 1개를 넣은 테스트 schema에서 직접 `UPDATE`·`DELETE`가 `1644 approval reviews are append-only`로 거부되는지 확인

`alembic stamp`로 version만 올리는 방식은 쓰지 않는다. 빠진 트리거가 없는지 사람이 보장해야 하기 때문이다.

2026-10-30 격리 MySQL 8.0.46(binlog ON, 새 datadir, 포트 13317)에서 위 절차를 실제로 확인했다.
- `TRIGGER` 없는 계정: 1142 → 테이블·인덱스만 남고 version `c9e1a4b7d2f0` → 재실행 1050
- `TRIGGER`만 부여: 1419 → 같은 부분 상태
- 복구(빈 테이블 확인 → 삭제) 뒤 `log_bin_trust_function_creators = 1`로 재실행: head 도달, 트리거 2개, 직접 UPDATE·DELETE 1644 거부
- 확인 뒤 테스트 DB·계정·설정을 원래대로 돌렸다.

## 검증 방법

일반 pytest는 실제 DB에 연결하지 않는다. `test_approval_persistence_mysql.py`는 기본 skip이며 다음을 **모두** 충족해야 한다.

- `APPROVAL_MYSQL_ISOLATED=1`
- `APPROVAL_MYSQL_URL`: mysql+aiomysql, localhost 또는 127.0.0.1, 명시된 3306 외 포트, `test_npc_approval_` 접두사의 전용 DB
- `APPROVAL_MYSQL_DATADIR`: 새 테스트 인스턴스의 실제 데이터 디렉터리
- 접속 후 `SELECT DATABASE(), @@datadir`가 위 설정과 일치
- 테스트 schema가 비어 있음

조건을 확인한 뒤에만 새 revision을 적용하고, 시나리오 종료 후 해당 revision의 테이블만 회수한다. 앱 `.env`의 DB 주소는 사용하지 않는다. 테스트 DB에는 별도 프로세스를 사용하고 종료 후 서버도 중지한다.

```powershell
python -B -m pytest tests/test_approval_persistence.py tests/test_approval_history.py -q -p no:cacheprovider
# 격리 조건을 설정·확인한 전용 환경에서만:
python -B -m pytest tests/test_approval_persistence_mysql.py -q -p no:cacheprovider
```

실제 테스트 결과와 전체 회귀 검증 결과는 구현 완료 보고에 별도로 기록한다.

### 2026-10-29 구현 검증 기록

- 기존 가상환경 재사용: BE Python 3.13.14, NPC Python 3.12.13. 패키지 설치 없음.
- 전용 MySQL 8.0.46 인스턴스를 새 datadir와 포트 13317로 실행하고 격리 확인 후 테스트했다. 기존 MySQL 서비스·운영 DB에는 연결하지 않았다.
- BE 전체: **1490 passed, 1 skipped**, 그 안에 실제 MySQL 테스트 **8개 통과** 포함.
- BE/NPC Ruff check 통과. 변경한 Python 파일의 format 검사 통과.
- 전체 BE format 검사는 기존 `local_auth.py`, `test_local_auth.py` 2개를 지적한다. 기준 `6264576`에서도 동일한 실패를 확인했으며 이 파일들은 수정하지 않았다.
- 기존 콘텐츠 고정 migration 테스트는 새 revision이 추가되어 최종 head가 바뀐 부분만 갱신했다. 이전 revision의 부모 관계와 DDL 검증은 유지했다.
- 기존 NPC의 `test_no_game_code_changes`는 Git clean 상태를 요구하므로 기능 커밋 이후 최종 전체 회귀 결과를 완료 보고에 기재한다. 해당 테스트나 NPC 코드는 수정하지 않았다.
- 실제 MySQL 테스트는 새 revision의 DDL을 격리 DB에서 적용·회수했다. 테스트 종료 시 스키마가 빈 것을 확인하고 전용 서버를 정상 종료했다. 운영 migration 적용·HTTP 연결은 완료 범위가 아니다.

### 2026-10-30 게시 판정 트랜잭션 수정 검증 기록

- 격리 MySQL 8.0.46(새 datadir, 포트 13317, `REPEATABLE-READ`, binlog ON). 시스템 MySQL 서비스(3306)에는 연결하지 않았다.
- 수정 전 코드로 결함 재현: snapshot을 가진 세션으로 철회 commit 뒤 `check_target_approval()` 호출 → `()`(전 게이트 통과).
- 신규 MySQL 테스트 5개:
  - snapshot 재현과 최신 철회 반영(호출자 미커밋 변경 보존)
  - 진행 중 철회 대기
  - 잠금 구간 중 append 대기
  - 잠금 대기 초과 1205는 오류이고 store 등록 없음
  - 블록 예외·취소 시 rollback
- 변이 확인: 잠금 · 잠금 읽기를 빼면 동시성 테스트 2개가 실패한다.
- BE 전체:
  - 격리 MySQL 포함 **1495 passed, 1 skipped**
  - DB 없이 1482 passed, 14 skipped(MySQL 13 · 심볼릭 링크 1)
- Ruff check 통과, 변경 파일 format 통과, `case_001` VALID.
- 단위 테스트 2개는 계약 변경(세션 → 세션 팩토리, 호출자 세션 rollback 제거)에 맞춰 기대값을 바꿨다. 판정 규칙(`ReviewRecord`, `gate_decisions()`)은 바꾸지 않았다.
