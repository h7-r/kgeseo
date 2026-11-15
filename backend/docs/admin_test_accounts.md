# 팀 테스트 계정 표시 is_test — 운영 절차(미르 11/13)

관리자 통계에서 팀 테스트 계정을 빼기 위한 표시다. 집계 규칙(무엇을 빼는지 · `include_internal` · 게스트 승계 · beta_events 한계)은
관리자 API 계약서 `docs/contracts/admin_api_v0.2_phase2.md` 의 「테스트 계정 is_test」 절이 원본이다. 이 문서는 운영 절차만 적는다.

## 정의

| 항목 | 값 |
|---|---|
| 열 | `app_users.is_test` |
| 형식 | BOOLEAN(MySQL `TINYINT(1)`), NOT NULL |
| 기본값 | `false` — DB 기본값(`DEFAULT 0`, server_default) · ORM 기본값 둘 다. 기존 회원도 migration 으로 모두 `false` |
| migration | `f3c8a1d6e2b7`(바로 앞 `a3f9c2e7b1d4`, 단일 head) |
| 바꾸는 길 | 서버 명령 `scripts/set_test_account.py` 뿐. API 없음 · 응답에 싣지 않음 |

- **내부 계정 = `role == "admin"` OR `is_test == true`(미르 11/13 최종).** 관리자 통계의 기본값(`include_internal=false`)은 회원 · 게스트 · 게임(beta_events) 통계 모두에서 내부 계정과, 내부 계정으로 승계된 게스트를 뺀다.
- 판정은 늘 **조회 시점의 현재 값**이다. 지정 · 해제하면 그 계정의 **과거 날짜 숫자도 바뀐다**(다시 계산). 지정 이력은 남지 않는다 — 언제 누구를 지정했는지는 운영 기록(작업 메모)에 따로 남긴다.
- 관리자는 is_test 와 상관없이 role 로 늘 내부 계정이다. 관리자이면서 is_test 인 계정은 `excluded` 에서 `admins` 쪽에만 센다.
- 로그인 · Play Session · 저장 · 승계 동작은 이 값과 상관없다(통계만 바뀐다).

## 서버 명령

백엔드 폴더에서, 앱과 같은 DB 설정(`DB_*`)으로 실행한다. 대상은 **회원 UUID(`app_users.id`)** 로만 고른다.

```bash
# 1) 확인만 — 지금 값과 바뀔 값만 보여 주고 바꾸지 않는다(DB 에는 읽기 한 번)
python -m scripts.set_test_account <회원 UUID> true

# 2) 지정 — --confirm 에 같은 UUID 를 한 번 더 적어야 한다
python -m scripts.set_test_account <회원 UUID> true --execute --confirm <회원 UUID>

# 3) 해제
python -m scripts.set_test_account <회원 UUID> false --execute --confirm <회원 UUID>
```

출력(개인정보 없음 — DB 이름 · UUID · role · is_test 만):

```
[DRY-RUN] db=waegok user_id=… role=user is_test: false -> true (바꾸려면 --execute --confirm …)
[OK] db=waegok user_id=… role=user is_test: false -> true
[UNCHANGED] db=waegok user_id=… role=user is_test=true (이미 그 값)
[NOT FOUND] db=waegok user_id=…: 그런 회원이 없습니다
[REFUSED] db=waegok: --confirm 의 UUID 가 대상과 다릅니다.
```

| 종료 코드 | 뜻 |
|---|---|
| 0 | 바꿈 · 확인만 · 이미 그 값 |
| 2 | 잘못된 사용(UUID 형식 · true/false 아님 · --confirm 없음/불일치) — DB 에 닿기 전에 멈춘다 |
| 3 | 그런 회원 없음 — 아무것도 쓰지 않는다 |

- 이메일 · 닉네임으로 찾지 않는다. 회원 UUID 는 관리자 화면 회원 목록(`/admin/users`)의 `user_id` 로 확인한다.
- 읽는 칸은 `id` · `role` · `is_test` 뿐이고, 바꿀 때는 그 행을 잠근 뒤(`FOR UPDATE`) `is_test` 한 칸만 `UPDATE` 한다. 비밀번호 해시 · 토큰 · 이메일 · 닉네임은 읽지도 출력하지도 않는다.
- 운영 서버에서 실행할 때의 폴더 · Python · 실행 사용자(`sudo -n -u waegok`)는 `docs/publication_state_cli.md` 의 확정값과 같다.
  **운영 계정 지정은 미르 승인 뒤에만 한다.**

## 배포 순서(미르 11/13 확인)

`AppUser` 모델에 열이 생겨 **회원을 읽는 모든 쿼리(로그인 · /me · 관리자 등)가 `is_test` 를 함께 읽는다.** 그래서 새 코드는 열이 있는 DB 에서만
돌아야 한다. 운영 배포(`deploy-backend.yml` → SSM 문서 `waegok-Deploy`)의 실제 순서가 그렇게 되어 있다.

1. `alembic upgrade heads` — 이 migration 이 열 하나를 더한다(MySQL 8 에서는 INSTANT 로 예상, 표 복사 없음).
2. `python -m scripts.check_deployment --schema-only` — DB revision 이 코드 head(`f3c8a1d6e2b7`)와 같은지, 모델의 모든 열(`is_test` 포함)이 DB 에 있는지 본다. 어긋나면 전환하지 않는다.
3. 서버 전환 · 재시작.
4. `/health/ready` 와 전체 점검.

- 1 과 3 사이에는 이전 코드가 새 열이 있는 DB 에서 돈다. 이전 코드는 이 열을 읽지 않고, 가입 INSERT 에서 이 열을 빼도 DB 기본값으로 `false` 가 들어가므로 문제없다(격리 MySQL 검사로 확인).
- ALTER 는 짧게 배타적 메타데이터 잠금을 잡는다. `app_users` 에 오래 열린 트랜잭션이 있으면 그 뒤로 줄이 생기므로 사용이 적은 시간에 배포한다.

### 실패 · 되돌리기

- **배포가 실패하면 이전 코드로 복구하지만 DB 변경은 되돌리지 않는다.** 이 열은 이전 코드와 함께 있어도 되므로 복구 뒤에도 로그인 · 가입은 정상이다. 열 · 지정 값은 그대로 남는다.
- 손으로 `alembic downgrade a3f9c2e7b1d4`(열 삭제)를 할 때는 **반드시 코드를 먼저 이전 판으로 되돌린 뒤** 한다. 새 코드가 도는 동안 열을 지우면 로그인 · /me · 관리자 쿼리가 `Unknown column` 으로 실패한다. 지우면 지정 값도 사라지므로 테스트 계정 UUID 를 미리 적어 둔다. 보통은 지우지 않고 둔다.
