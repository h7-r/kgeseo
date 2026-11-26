# 보존 기간 파기 운영 절차 v0.2 (1차 — 문의 IP · 감사 기록 · 종료일 문의)

- 작성: 세진 11/26(v0.1 #213) · 11/26 운영 등록 값 반영(v0.2). 정책: `docs/contracts/account_withdrawal_v0.2.md` §10(PM 최종 결정 11/25 · 11/26).
- 코드: `scripts/purge_retention_data.py`(CLI) · `app/services/data_retention.py`(조건 · 배치).
- **운영 상태(PM 운영 확인 보고 11/26 — 이 문서 작성자가 운영 서버에서 직접 확인한 것은 아니다)**: #213 병합 · 운영 배포 완료, systemd
  service · timer 등록, 운영 시험 실행 정상 종료. 첫 정기 실행 예정 2026-11-27 04:10 KST.
- 운영 등록 · 실제 실행 · 설정 변경은 PM 담당이다. 이 1차는 비밀번호 찾기 기능 · 새 마이그레이션 없이 단독으로 운영된다(후속 작업은 §9).

## 1. 작업

| 작업(`--tasks` 이름) | 대상 | 처리 |
|---|---|---|
| `inquiry_ip` | 접수 후 30일이 지난 문의의 `client_ip` | `client_ip` 만 NULL(축약 없음 · 나머지 유지) |
| `audit_log_purge` | 수집 후 달력 1년이 지난 관리자 감사 기록 | 행 전체 삭제(`target_id` 포함) |
| `inquiry_purge` | 2027-01-01 00:00 KST **전에** 접수된 문의 전부(상태 무관) | 행 삭제 · 답변은 FK CASCADE. 종료 시각 전에는 건너뛴다 |

- 매일 실행한다. 종료 시각 전에는 `inquiry_purge` 만 `SKIPPED`(대상 건수는 보인다)이고, 다른 작업은 그대로 한다.
- 이미 처리한 행은 다시 대상이 되지 않는다(같은 명령을 다시 실행해도 0건).
- 아직 없는 작업: `login_throttles`, 비밀번호 재설정 코드 — 후속 PR(§9).

## 2. 운영 환경(PM 확정 · 11/26)

| 항목 | 값 |
|---|---|
| 운영 DB | `waegok`(RDS MySQL 8.4) |
| 운영 모드 | `APP_ENV=production` |
| 실행 계정 | `waegok` |
| 작업 경로 | `/srv/waegok/current/backend` (`current` 는 `/srv/waegok/releases/<커밋>` 을 가리키는 심볼릭 링크) |
| Python | `/srv/waegok/current/venv/bin/python`(3.13) |
| 환경변수 | `/srv/waegok/.env` — systemd `EnvironmentFile=` 로 읽는다 |
| 운영 API 서비스 | `waegok-api` |
| 로그 | journald(30일 보존) |
| RDS 자동 백업 | 매일 03:00~03:30 KST |
| 정기 파기 | 매일 **04:10 KST**(백업 뒤) · `Persistent=true` |

- ⚠ **`.env` 를 셸에서 `source` · `set -a` 로 읽지 않는다.** `CORS_ORIGINS` 의 JSON 배열 따옴표가 셸에서 깨져 설정 로딩이 실패할 수 있다(PM 확인).
  정기 실행 · 수동 실행 모두 systemd 의 `EnvironmentFile=` 로 읽는다(§4 · §5).
- 비밀번호 · 접속 URL · 인증정보는 명령 · 유닛 파일 · 로그에 넣지 않는다. CLI 는 DB 이름 · 기준 시각 · 작업 · 건수 · 오류 종류 이름만 출력한다.
- `current` 링크는 실행이 시작될 때 해석된다. 배포로 링크가 바뀌면 **다음 실행부터** 새 코드가 돈다(실행 중인 프로세스는 시작한 코드로 끝난다 — 추정).

## 3. 실행 전 확인(새로 등록하거나 다시 등록할 때)

1. `deploy-backend` 가 성공했고 운영 코드에 `scripts/purge_retention_data.py` 가 있는지.
2. DB revision: `alembic current` 가 `alembic heads` 와 같은지(1차는 마이그레이션 없음).
3. 서버 시계와 DB 서버 시계: CLI 가 직접 비교한다(5분 넘게 다르면 실행하지 않는다). `timedatectl` 로 NTP 동기화도 본다.
4. RDS 자동 백업이 켜져 있는지 — 삭제는 백업 복구 외에는 되돌릴 수 없다.
5. **운영 dry-run 결과를 PM 이 먼저 확인**한다(§4). 스케줄은 그 뒤에 등록 · 변경한다.

## 4. 수동 실행(root)

### dry-run — PM 이 실제로 쓴 명령(11/26)

```bash
systemd-run --wait --pipe --quiet \
  -p User=waegok \
  -p EnvironmentFile=/srv/waegok/.env \
  -p WorkingDirectory=/srv/waegok/current/backend \
  /srv/waegok/current/venv/bin/python \
  -m scripts.purge_retention_data
```

- 옵션을 주지 않으면 **dry-run**(읽기 전용 · 건수만)이다. `--dry-run` 이라는 옵션은 없다. CLI 옵션은 `--execute` · `--confirm` ·
  `--batch-size` · `--tasks` 넷뿐이다.
- (선택) 스케줄과 같은 작업 범위로 보고 싶으면 끝에 `--tasks inquiry_ip,audit_log_purge,inquiry_purge` 를 붙인다. 고르지 않은 작업은
  `status=NOT_SELECTED` 로 건수만 보인다 — 위 PM 명령과는 다른 예시다.

**운영 dry-run 결과(PM 운영 확인 보고 11/26)**: `inquiry_ip` 0건 · `audit_log_purge` 0건 · `inquiry_purge` 문의 1건 · 답변 1건,
`status=SKIPPED`(`purge_at` 전).

### 실제 파기를 손으로 한 번 돌릴 때

정기 실행과 같은 설정(유닛 파일)을 그대로 쓴다:

```bash
systemctl start waegok-retention-purge.service      # oneshot — 끝날 때까지 기다린다
journalctl -u waegok-retention-purge.service -n 15 --no-pager
systemctl show waegok-retention-purge.service -p Result -p ExecMainStatus
```

### dry-run 출력 읽기

```text
[DRY-RUN] db=waegok now=2026-11-26T09:00:01Z
  task=inquiry_ip status=DRY_RUN targets=0 changed=0
  task=audit_log_purge status=DRY_RUN targets=0 changed=0
  task=inquiry_purge status=SKIPPED targets=1 replies=1 changed=0 reason=before_purge_at purge_at=2026-12-31T15:00:00Z
[DRY-RUN] changed_total=0 (읽기 전용 — 바꾸지 않았습니다)
```

(형식 예시 — 건수는 위 PM 보고와 같게 적었고 시각은 예시다.)

- `targets` = 지금 실행하면 처리될 건수(종료 파기는 문의 수, `replies` = 함께 지워질 답변 수). `changed=0` = 바꾸지 않았다.
- `SKIPPED` = 실행할 수 없는 때(종료 시각 전) — 건수는 미리 보기. `NOT_SELECTED` = `--tasks` 로 고르지 않은 작업.

## 5. 등록된 systemd 설정(PM 등록 · 11/26)

`/etc/systemd/system/waegok-retention-purge.service`:

```ini
[Unit]
Description=waegok retention purge (inquiry IP / audit log / inquiry)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=waegok
EnvironmentFile=/srv/waegok/.env
Environment=PYTHONPATH=/srv/waegok/current/backend
WorkingDirectory=/srv/waegok/current/backend
ExecStart=/srv/waegok/current/venv/bin/python -m scripts.purge_retention_data --execute --confirm waegok --tasks inquiry_ip,audit_log_purge,inquiry_purge
NoNewPrivileges=true
PrivateTmp=true
```

`/etc/systemd/system/waegok-retention-purge.timer`:

```ini
[Unit]
Description=Daily waegok retention purge at 04:10 KST

[Timer]
OnCalendar=*-*-* 04:10:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

- `OnCalendar` 는 PM 이 전한 메시지에서 별표 일부가 빠져 보였다. 매일 실행 표현은 위와 같고, 전달 중 서식 문제로 본다(추정 — 서버 파일을 직접
  읽지 않았다). 서버에서 `systemctl cat waegok-retention-purge.timer` 로 한 번 확인한다.
- 자동 실행은 dry-run 이 아니라 `--execute --confirm waegok` 실제 파기다. 작업 범위는 `--tasks` 로 고정돼 있다(§9).
- **`Persistent=true`**: 서버가 꺼져 있었거나 타이머가 멈춰 있던 동안 04:10 을 놓쳤으면, 다음에 켜질 때(타이머가 다시 동작할 때) **한 번** 바로
  실행한다(놓친 횟수만큼 여러 번 하지는 않는다). 오래 멈췄다가 다시 켜면 그 자리에서 실제 파기가 한 번 돈다 — 다시 켜기 전에 dry-run 을 본다.
- 겹침: `Type=oneshot` 유닛은 이미 돌고 있으면 또 띄우지 않는다. 그 밖의 경로(수동 `systemd-run --execute` 등)와 겹치면 CLI 의 DB 잠금이
  늦게 온 쪽을 종료 코드 3 으로 끝낸다(§7).

## 6. 등록 · 확인 · 중지

```bash
# 등록(또는 파일을 고친 뒤)
systemd-analyze verify /etc/systemd/system/waegok-retention-purge.service /etc/systemd/system/waegok-retention-purge.timer
systemd-analyze calendar '*-*-* 04:10:00 Asia/Seoul'     # 다음 실행 시각이 KST 04:10 인지
systemctl daemon-reload
systemctl enable --now waegok-retention-purge.timer

# 확인
systemctl list-timers waegok-retention-purge.timer --no-pager     # NEXT · LAST
journalctl -u waegok-retention-purge.service -n 15 --no-pager       # 마지막 실행 출력
journalctl -u waegok-retention-purge.service --since today --no-pager
systemctl show waegok-retention-purge.service -p Result -p ExecMainStatus -p ExecMainExitTimestamp
```

- `ExecMainStatus` 가 CLI 종료 코드다. 0 이 아니면 유닛이 `failed` 가 된다.

**타이머 중지와 실행 중인 파기 중단은 다르다**:

```bash
# 앞으로의 정기 실행만 멈춤(지금 돌고 있는 실행은 그대로 끝난다) · 다시 켜기
systemctl disable --now waegok-retention-purge.timer
systemctl enable --now waegok-retention-purge.timer     # Persistent=true — 놓친 실행이 있으면 바로 한 번 돈다
# 지금 돌고 있는 파기를 중단
systemctl stop waegok-retention-purge.service
# 등록 해제
systemctl disable --now waegok-retention-purge.timer
rm /etc/systemd/system/waegok-retention-purge.timer /etc/systemd/system/waegok-retention-purge.service
systemctl daemon-reload
```

- 실행 중 중단하면 진행 중인 배치는 롤백되지만, **이미 커밋된 배치는 되돌아가지 않는다**(NULL 로 바꾼 IP · 지운 행은 백업 복구 외에는 복구되지 않는다).

**cron(대안 — 실제 운영 방식이 아니다)**: timer 를 쓰는 동안에는 등록하지 않는다. 쓰게 되면 셸에서 `.env` 를 읽지 않도록 위 service 를 부르는
방식으로만 한다(예: `/etc/cron.d/` 에 `CRON_TZ=Asia/Seoul` 과 `10 4 * * * root systemctl start waegok-retention-purge.service` — cron 종류에
따라 `CRON_TZ` 지원 확인).

## 7. 실패 대응

| 종료 코드 | 뜻 | 대응 |
|---|---|---|
| 0 | 정상(대상 없음 · `SKIPPED` 포함) | 없음 |
| 2 | 사용 · 확인 실패 — **바꾸지 않음** | 「사용 오류」 · 「확인 실패」 줄: `--confirm` · DB 이름 · `--tasks` · 시계(5분 · DB 시계 읽기) 확인 |
| 3 | 다른 실행이 DB 잠금을 잡고 있음 — **바꾸지 않음** | 겹친 실행(정기 · 수동)이 끝났는지 로그로 본다. 필요하면 다시 실행 |
| 4 | DB 오류 | 작업 줄의 `PARTIAL`(앞 배치는 확정 · 실패 배치는 롤백) · `FAIL`(처리 0)과 오류 종류를 보고, 원인을 고친 뒤 `systemctl start waegok-retention-purge.service` 로 다시 실행 — 남은 것만 처리한다 |

- DB 잠금은 `GET_LOCK('kgeseo_retention_purge:waegok', 0)` 이고 파기 동안 한 연결에서 잡고 있다가 같은 연결에서 푼다.
- **알려진 한계(후속 검증 항목, 코드 미수정)**: ① 잠금을 푸는 단계에서 오류가 나면(그 순간 연결 끊김 등) 파기는 끝났어도 결과 줄 없이 종료 4 로
  보고될 수 있다 — 다시 실행해 0건인지 본다. ② 실행 도중 잠금 연결이 끊기면 잠금이 풀려 다른 실행과 겹칠 수 있다. 각 배치가 만료 조건을 다시
  확인하지만 그것만으로 모든 동시 실행 문제가 없다고 단정하지 않는다 — 후속 PR(신규 인증 데이터 파기)에서 동시성 시험을 더한다.

## 8. 시험운영 종료일 파기

- 기준 시각(서버 시계와 DB 서버 시계 중 이른 쪽)이 2027-01-01 00:00 KST(= 2026-12-31 15:00 UTC) 이후인 첫 실행. DELETE 문장도 DB 서버
  시계를 다시 본다. 정각 · 이후 접수된 문의는 지우지 않는다(2027년 이후 보존 정책은 추후 결정).
- 04:10 KST 타이머면 **2027-01-01 04:10 KST 실행이 첫 종료 파기**다. 그 전 12월 중 미처리 문의는 운영 담당이 처리한다.

## 9. 후속 파기 작업 추가(`login_throttles` · 비밀번호 재설정 코드)

- 같은 CLI 에 작업이 더해진다. `main` 병합은 자동 배포라 `current` 아래 코드가 바뀐다. **service 의 `--tasks` 가 세 작업으로 고정돼 있으므로
  새 작업은 배포만으로 자동 실행되지 않는다.** `--tasks` 를 지우면 새 작업이 다음 실행부터 바로 돈다 — 지우지 않는다.
- 새 작업을 켜는 순서: ① 비밀번호 찾기 기능 배포 · 마이그레이션 적용(`alembic current` = heads) 확인 ② §4 dry-run(옵션 없이)으로 새 작업의
  `targets` 를 PM 이 확인 ③ service 의 `ExecStart` `--tasks` 에 새 이름 추가 ④ `systemctl daemon-reload` ⑤ 다음 실행 로그 확인.
- 예전 · 모르는 이름이 `--tasks` 에 있으면 실행하지 않는다(종료 2) — 작업 이름을 바꾸는 후속 PR 은 service 도 함께 고쳐야 한다.
