# 보존 기간 파기 운영 절차 v0.1 (1차 — 문의 IP · 감사 기록 · 종료일 문의)

- 작성: 세진 11/26. 정책: `docs/contracts/account_withdrawal_v0.2.md` §10(PM 최종 결정 11/25 · 11/26).
- 코드: `scripts/purge_retention_data.py`(CLI) · `app/services/data_retention.py`(조건 · 배치).
- **운영 등록 · 실제 실행은 PM 담당이다.** 이 문서는 절차와 예시다 — 아래 「확인이 필요한 값」을 채우기 전에는 그대로 복사해 실행하는 명령이 아니다.
- 이 1차는 **혼자 운영 등록할 수 있다**. 비밀번호 찾기 기능 · 새 마이그레이션은 선행 조건이 아니다(후속 PR 은 §9).

## 1. 작업

| 작업(`--tasks` 이름) | 대상 | 처리 |
|---|---|---|
| `inquiry_ip` | 접수 후 30일이 지난 문의의 `client_ip` | `client_ip` 만 NULL(축약 없음 · 나머지 유지) |
| `audit_log_purge` | 수집 후 달력 1년이 지난 관리자 감사 기록 | 행 전체 삭제(`target_id` 포함) |
| `inquiry_purge` | 2027-01-01 00:00 KST **전에** 접수된 문의 전부(상태 무관) | 행 삭제 · 답변은 FK CASCADE. 종료 시각 전에는 건너뛴다 |

- 매일 실행해도 된다. 종료 시각 전에는 `inquiry_purge` 만 `SKIPPED`(대상 건수는 보인다)이고, 다른 작업은 그대로 한다.
- 이미 처리한 행은 다시 대상이 되지 않는다(같은 명령을 다시 실행해도 안전 · 0건).
- 아직 없는 작업: `login_throttles`, 비밀번호 재설정 코드 — 후속 PR(§9).

## 2. 운영 값

**저장소 문서에 있는 값**(`docs/publication_state_cli.md` §5, 「PM 11/8 확정」 — 오래된 값일 수 있어 **실행 전에 다시 확인**):

| 항목 | 문서 값 |
|---|---|
| 백엔드 폴더 | `/srv/waegok/current/backend` |
| Python | `/srv/waegok/current/venv/bin/python` |
| 실행 사용자 | `waegok` |
| 운영 DB 이름 | `waegok` |
| 원격 실행 경로 | CloudShell → SSM Run Command `AWS-RunShellScript`(root 로 돈다 · PM 권한) |

**저장소에서 확인되지 않은 값(PM 이 운영 서버에서 확인해 채운다 — 추측해 쓰지 않았다)**:

| 항목 | 왜 필요한가 | 확인 방법(예) |
|---|---|---|
| 설정(DB_*) 로딩 방식 | 앱은 작업 폴더의 `.env` 와 환경변수에서 읽는다(`app/core/config.py`). 운영 API 가 `.env` 를 쓰는지, systemd `EnvironmentFile` 등을 쓰는지 저장소에 없다 | 운영 API 프로세스 설정 확인. 첫 dry-run 이 DB 를 읽으면 로딩은 맞다 |
| 운영 API 의 프로세스 관리자 | `docs/deployment_aws_v0.1.md` 는 「아직 고정하지 않는다」. 배포 SSM 문서 `waegok-Deploy` 내용은 저장소 밖 | 서버에서 확인 |
| systemd 판 · 서버 시간대 | 타이머의 시간대 표기(§5) | `systemctl --version`, `timedatectl` |
| `/srv/waegok/current` 가 배포마다 바뀌는 링크인지 | 배포가 타이머 아래 코드를 바꾸는지(§9) | `ls -l /srv/waegok/` |
| cron 구현 · `flock` 유무(cron 을 고를 때만) | `CRON_TZ` 지원 · 중복 방지 | `rpm -q cronie` 등, `command -v flock` |

비밀번호 · 접속 URL · 인증정보는 명령 · 유닛 파일 · 로그에 넣지 않는다(CLI 는 DB 이름 · 건수 · 오류 종류 이름만 출력한다).

## 3. 실행 전 확인

1. 이 PR 이 `main` 에 병합되고 `deploy-backend` 가 성공했는지(Actions). 운영 서버의 코드에 `scripts/purge_retention_data.py` 가 있는지.
2. DB revision: `alembic current` 가 `alembic heads` 와 같은지. **이 PR 은 마이그레이션이 없다**(작성 때 head `93fb40166c08`).
3. 서버 시계와 DB 서버 시계: CLI 가 직접 비교한다(5분 넘게 다르면 실행하지 않는다). 서버에서 `timedatectl` 로 NTP 동기화 여부도 본다.
4. RDS 자동 백업(30일)이 켜져 있는지 — 삭제는 되돌릴 수 없다(백업 복구 외에는).
5. **운영 dry-run 결과를 PM 이 먼저 확인**한다(§4). 스케줄은 그 뒤에 등록한다.

## 4. 명령

모든 명령은 백엔드 폴더에서 실행 사용자로 돈다. 아래 `<…>` 는 §2 에서 확인한 값으로 바꾼다.

```bash
cd <BACKEND_DIR>
# dry-run(기본 · 읽기 전용) — 작업별 대상 건수만
sudo -n -u <SERVICE_USER> <PYTHON> -m scripts.purge_retention_data
# 수동 실제 파기 — 검토한 작업을 이름으로 고정
sudo -n -u <SERVICE_USER> <PYTHON> -m scripts.purge_retention_data \
  --execute --confirm <DB_NAME> --tasks inquiry_ip,audit_log_purge,inquiry_purge
```

- `--confirm` 값 · 설정의 DB 이름 · 실제 접속한 DB(`SELECT DATABASE()`)가 모두 같아야 실행된다(다르면 바꾸지 않고 종료 2).
- `--tasks` 를 빼면 **그 판에 있는 작업 전부**가 돈다. 스케줄에는 반드시 `--tasks` 를 쓴다(§9).
- `--batch-size N`(1~5000, 기본 500): 한 트랜잭션에서 처리하는 행 수. 보통은 바꾸지 않는다.
- 시각을 바꾸는 옵션은 없다. 기준 시각은 시작할 때 서버 시계와 DB 서버 시계 중 이른 쪽으로 한 번 정한다.

CloudShell 에서 SSM 으로 보낼 때는 `docs/publication_state_cli.md` §5-1 의 `run()` 과 같은 방식으로, 모듈 이름만 `scripts.purge_retention_data`
로 바꿔 쓴다(인자를 하나씩 작은따옴표로 감싸 보내고, 결과는 `get-command-invocation` 의 `ResponseCode` = 종료 코드로 본다).

### dry-run 출력 읽기

```text
[DRY-RUN] db=<DB_NAME> now=2026-12-20T18:00:01Z
  task=inquiry_ip status=DRY_RUN targets=12 changed=0
  task=audit_log_purge status=DRY_RUN targets=0 changed=0
  task=inquiry_purge status=SKIPPED targets=40 replies=25 changed=0 reason=before_purge_at purge_at=2026-12-31T15:00:00Z
[DRY-RUN] changed_total=0 (읽기 전용 — 바꾸지 않았습니다)
```

- `targets` = 지금 실행하면 처리될 건수(종료 파기는 문의 수, `replies` = 함께 지워질 답변 수). `changed=0` = dry-run 은 아무것도 바꾸지 않았다.
- `SKIPPED` = 실행할 수 없는 때(종료 시각 전). 건수는 미리 보기다. `NOT_SELECTED` = `--tasks` 로 고르지 않은 작업(건수만 보인다).

## 5. systemd timer 등록(권장)

매일 1회, **KST 03:00** 제안(PM 이 바꿀 수 있다). 자동 실행은 dry-run 이 아니라 `--execute --confirm` 실제 파기다.

`/etc/systemd/system/waegok-retention-purge.service`:

```ini
[Unit]
Description=waegok retention purge (inquiry IP 30d, audit log 1y, end-of-trial inquiries)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=<SERVICE_USER>
WorkingDirectory=<BACKEND_DIR>
# 설정 로딩: 운영 API 와 같은 방식을 쓴다. .env 를 WorkingDirectory 에서 읽으면 이 줄은 필요 없다.
# 운영 API 가 EnvironmentFile 을 쓰면 같은 파일을 적는다(값을 유닛 파일에 직접 쓰지 않는다).
# EnvironmentFile=<ENV_FILE>
ExecStart=<PYTHON> -m scripts.purge_retention_data --execute --confirm <DB_NAME> --tasks inquiry_ip,audit_log_purge,inquiry_purge
SyslogIdentifier=waegok-retention-purge
```

`/etc/systemd/system/waegok-retention-purge.timer`:

```ini
[Unit]
Description=Daily waegok retention purge at 03:00 KST

[Timer]
# systemd 235 이상: 시간대를 직접 적는다(서버가 UTC 여도 KST 03:00).
OnCalendar=*-*-* 03:00:00 Asia/Seoul
# systemd 가 시간대 표기를 모르면(235 미만) 위 줄 대신, 서버 시간대가 UTC 일 때 KST 03:00 = UTC 전날 18:00:
# OnCalendar=*-*-* 18:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

등록 · 확인(root):

```bash
systemd-analyze calendar '*-*-* 03:00:00 Asia/Seoul'   # 다음 실행 시각이 KST 03:00 인지(표기를 모르면 오류)
systemd-analyze verify /etc/systemd/system/waegok-retention-purge.service /etc/systemd/system/waegok-retention-purge.timer
systemctl daemon-reload
systemctl enable --now waegok-retention-purge.timer
systemctl list-timers waegok-retention-purge.timer      # NEXT · LAST
systemctl status waegok-retention-purge.timer
```

첫 실제 실행을 타이머 전에 손으로 보고 싶으면 `systemctl start waegok-retention-purge.service` 뒤 아래 로그를 본다.

로그 · 종료 코드:

```bash
journalctl -u waegok-retention-purge.service --since today --no-pager
systemctl show waegok-retention-purge.service -p Result -p ExecMainStatus -p ExecMainExitTimestamp
```

- `Type=oneshot` 은 같은 유닛을 겹쳐 띄우지 않는다. `Persistent=true` 는 서버가 꺼져 있어 놓친 실행을 켜질 때 한 번 한다.
- 종료 코드가 0 이 아니면 유닛이 `failed` 가 된다 — `ExecMainStatus` 가 CLI 종료 코드다(§7).

## 6. cron(대안 — systemd timer 와 **동시에 등록하지 않는다**)

timer 를 쓰지 않을 때만. `/etc/cron.d/waegok-retention-purge`(root 소유):

```cron
# cronie 는 CRON_TZ 를 지원한다(다른 cron 이면 확인 · 지원하지 않으면 UTC 서버에서 "0 18 * * *")
CRON_TZ=Asia/Seoul
0 3 * * * <SERVICE_USER> cd <BACKEND_DIR> && flock -n /tmp/waegok-retention-purge.lock <PYTHON> -m scripts.purge_retention_data --execute --confirm <DB_NAME> --tasks inquiry_ip,audit_log_purge,inquiry_purge 2>&1 | logger -t waegok-retention-purge
```

- 로그: `journalctl -t waegok-retention-purge` 또는 syslog 파일. 파이프 때문에 cron 은 종료 코드를 따로 남기지 않는다 — 출력의 `[OK]` · `[FAIL]` 줄로 본다.
- `flock` 잠금 파일 경로는 서버에 맞게 바꾼다(`flock` 이 없으면 빼도 아래 DB 잠금이 막는다).

## 7. 중복 실행 · 실패 대응

**중복 실행**: `--execute` 는 DB 잠금(`GET_LOCK('kgeseo_retention_purge:<DB 이름>', 0)`)을 잡고 한다. timer · cron · 수동 실행이 겹치면 늦게 온 쪽이
바로 끝난다(종료 3 · 아무것도 바꾸지 않음). 서버가 둘이어도 같은 DB 면 막힌다. 겹쳐도 각 배치가 조건을 다시 확인하므로 같은 행을 두 번 처리하지는 않는다.

| 종료 코드 | 뜻 | 대응 |
|---|---|---|
| 0 | 정상(대상 없음 · `SKIPPED` 포함) | 없음 |
| 2 | 사용 · 확인 실패 — **바꾸지 않음** | 출력의 「사용 오류」 · 「확인 실패」: `--confirm` · DB 이름 · `--tasks` · 시계(5분 · DB 시계 읽기) 확인 |
| 3 | 다른 실행이 잠금을 잡고 있음 — **바꾸지 않음** | 다른 실행이 끝났는지 보고(로그) 필요하면 다시 |
| 4 | DB 오류 | 작업 줄을 본다: `PARTIAL`(앞 묶음은 확정 · 실패 묶음은 롤백) · `FAIL`(처리 0). 원인(오류 종류 이름)을 고친 뒤 **같은 명령을 다시** 실행 — 남은 것만 처리한다 |

## 8. 스케줄 중지 · 해제

```bash
# 잠시 멈춤(파일은 둔다) · 다시 켜기
systemctl disable --now waegok-retention-purge.timer
systemctl enable --now waegok-retention-purge.timer
# 해제
systemctl disable --now waegok-retention-purge.timer
rm /etc/systemd/system/waegok-retention-purge.timer /etc/systemd/system/waegok-retention-purge.service
systemctl daemon-reload
# cron 이면
rm /etc/cron.d/waegok-retention-purge
```

이미 돌고 있는 실행은 배치 단위로 확정된다 — 멈춰도 처리된 묶음은 되돌아가지 않는다.

## 9. 시험운영 종료일 파기 · 후속 PR

- **종료일 파기 기준**: 기준 시각(서버 시계와 DB 서버 시계 중 이른 쪽)이 2027-01-01 00:00 KST(= 2026-12-31 15:00 UTC) 이후인 첫 실행.
  DELETE 문장도 DB 서버 시계를 다시 본다. 정각 · 이후 접수된 문의는 지우지 않는다(2027년 이후 보존 정책은 추후 결정). KST 03:00 타이머면
  2027-01-01 03:00 KST 실행이 첫 종료 파기다. 그 전 12월 중 미처리 문의는 운영 담당이 처리한다.
- **후속 PR(`login_throttles` · 비밀번호 재설정 코드)**: 같은 CLI 에 작업이 더해진다.
  - 배포(`main` 병합 → 자동 배포)는 타이머 아래의 코드를 바꿀 수 있다. **스케줄이 `--tasks` 로 작업을 고정해 두었으므로 새 작업은 배포만으로
    자동 실행되지 않는다.** `--tasks` 없이 등록하면 새 작업이 다음 실행부터 바로 돈다 — 그래서 스케줄에는 반드시 `--tasks` 를 쓴다.
  - 후속 배포 뒤 절차: ① 비밀번호 찾기 기능 배포 · 마이그레이션 적용(`alembic current` = heads) 확인 ② dry-run 으로 새 작업의 `NOT_SELECTED`
    건수 확인(PM) ③ 유닛 파일(또는 cron 줄)의 `--tasks` 에 새 이름 추가 ④ `systemctl daemon-reload`(cron 은 파일 저장만) ⑤ 다음 실행 로그 확인.
  - 예전 이름 · 모르는 이름이 `--tasks` 에 있으면 실행하지 않는다(종료 2) — 작업 이름을 바꾸는 후속 PR 은 스케줄도 함께 고쳐야 한다.
