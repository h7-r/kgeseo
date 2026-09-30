# AWS Deployment v0.1

**Status: Draft Deployment Guide v0.1**

이 문서는 배포 계획이다. AWS 리소스 생성, 운영 배포, 실제 AWS 검증을 완료했다는 의미가 아니다.

## 1. 목적

왜곡 Backend MVP를 AWS에서 실행하기 위한 최소 구성, 배포 순서, 점검 및 복구 원칙을 정리한다.
현재 FastAPI와 SQLAlchemy Async, MySQL, Alembic 구조를 유지한다.

## 2. MVP Deployment Architecture

```text
Browser / Frontend
        | HTTPS
        v
AWS EC2: FastAPI Backend
        | MySQL connection
        v
AWS RDS MySQL
```

EC2와 RDS는 같은 VPC 내에서 연결하고 RDS를 인터넷에 직접 공개하지 않는 구성을 우선한다.
AWS의 [EC2-RDS 연결 가이드](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/tutorial-connect-ec2-instance-to-rds-database.html)는
EC2 보안 그룹을 RDS 접근 소스로 사용하는 구성을 설명한다.
HTTPS 종료 방식과 도메인은 아직 결정하지 않았다.

## 3. Local / Test / Demo 환경 구분

| 환경 | 목적 | DB와 설정 |
|---|---|---|
| Local | 개발 및 수동 검증 | 로컬 MySQL, 개발자별 `.env` |
| Test | 자동 테스트 | FakeAsyncSession 등 테스트 대역; 운영 DB 미사용 |
| Demo | MVP 시연 | EC2 Backend와 전용 RDS MySQL, 별도 환경변수와 데이터 |

Demo DB에 Local 데이터를 자동 복사하지 않는다. 환경별 자격 증명과 데이터 접근을 분리한다.

## 4. EC2 역할

- 검증된 소스 revision과 Python 3.13 환경에서 Backend를 실행한다.
- `requirements.txt`의 Runtime dependency만 설치한다.
- DB 설정은 실행 환경에서 주입한다. 소스나 Git 저장소에 비밀정보를 넣지 않는다.
- 서비스 프로세스의 재시작, 운영 로그 및 HTTPS 종료 방식은 배포 전에 별도로 결정한다.

## 5. RDS 역할

- MySQL 8 호환 DB로 PlaySession과 InteractionEvent 등 영속 데이터를 보관한다.
- Backend 전용 최소 권한 계정을 사용하며 MySQL `root`를 애플리케이션에 사용하지 않는다.
- 백업, 복구 시점, 보존 기간은 Demo 배포 전 결정한다.
- Migration은 승인된 절차에서만 적용하며 애플리케이션 시작 때 임의 실행하지 않는다.

## 6. 환경변수 및 비밀정보 관리 원칙

현재 [`.env.example`](../.env.example)과 `app/core/config.py`의 설정명을 그대로 사용한다.

```text
DB_HOST=<RDS_ENDPOINT>
DB_PORT=3306
DB_USER=<APP_DB_USER>
DB_PASSWORD=<YOUR_PASSWORD>
DB_NAME=<DEMO_DB_NAME>
```

- 실제 비밀번호, RDS 주소, `.env`는 Git과 GitHub 저장소에 넣지 않는다.
- Demo에서는 배포 실행 환경에 비밀값을 주입하고 접근 권한을 제한한다.
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)는
  향후 비밀정보 저장 및 회전 수단으로 검토할 수 있지만 이번 v0.1에서 연동하지 않는다.
- 설정값이나 SQLAlchemy 연결 문자열을 API 오류 응답에 노출하지 않는다.

## 7. Security Group 기본 원칙

- EC2: HTTP/HTTPS는 실제 서비스에 필요한 소스와 포트만 허용한다.
- EC2 관리 접근: SSH를 사용할 경우 개발자 IP 등 필요한 소스만 허용한다.
- RDS: Public Internet 전체 공개를 피하고 MySQL 3306 인바운드는 Backend EC2의 보안 그룹에서만 허용한다.
- MySQL 3306을 `0.0.0.0/0`에 개방하지 않는다.

RDS 인바운드에서 EC2 보안 그룹을 소스로 지정하는 방식은
[AWS RDS 연결 문서](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ec2-rds-connect.html)를 참고한다.

## 8. Backend 배포 순서

1. 배포할 commit 또는 tag와 변경 범위, 기존 안정 revision을 확인한다.
2. Demo 전용 RDS와 네트워크 접근, Backend 전용 DB 계정을 준비한다.
3. EC2에 소스를 배치하고 Python 3.13 가상환경을 만든다.
4. `pip install -r requirements.txt`로 Runtime dependency를 설치한다.
5. `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`을 안전하게 주입한다.
6. 다음 절차에 따라 Migration을 검토하고 적용한다.
7. FastAPI 프로세스를 시작하고 liveness 및 readiness를 확인한다.
8. 실제 기능 경로는 별도 Demo 데이터와 콘텐츠 준비 후 검증한다.

이 문서에는 프로세스 관리자, reverse proxy, 인증서 발급 명령을 아직 고정하지 않는다.

## 9. Alembic Migration 적용 순서

1. 적용 대상 revision과 이미 적용된 revision을 확인한다 (`alembic heads`, `alembic current`).
2. 신규 Migration의 DDL, 데이터 영향과 복구 방안을 사전 검토한다.
3. 필요한 백업과 유지보수 창을 확보한다.
4. DB에 접근 가능한 승인된 배포 환경에서 `alembic upgrade head`를 실행한다.
5. `alembic current`와 서비스 readiness로 결과를 확인한다.

이미 적용된 Migration 파일은 수정하지 않는다. Schema가 바뀌면 새 Migration을 작성한다.

## 10. Liveness / Readiness 확인

| 경로 | 의미 | 성공 | 실패 시 해석 |
|---|---|---|---|
| `GET /api/v1/health` | FastAPI 프로세스 응답 | 200 `{"status":"ok"}` | 프로세스/라우팅 문제 |
| `GET /api/v1/health/ready` | DB Session에서 `SELECT 1` 가능 | 200 `{"status":"ready"}` | 503 `{"detail":"Database is not ready."}` |

Readiness는 DB 연결을 확인하지만 테이블, Migration 상태, 게임 콘텐츠까지 검증하지 않는다.
배포 후 두 경로를 확인하고 별도 기능 검증을 진행한다.

## 11. Rollback 기본 전략

- 배포 전 이전 안정 commit 또는 tag를 기록해 코드 복구 지점을 확보한다.
- 새 코드에 문제가 있으면 이전 안정 revision으로 되돌리고 liveness/readiness를 재확인한다.
- 이미 적용된 Alembic Migration 파일을 수정하지 않는다.
- Schema rollback은 코드 rollback과 별개로 데이터 영향과 역방향 Migration을 검토한 뒤 실행한다.
- 파괴적 DB 작업이나 전체 데이터 삭제를 자동 rollback 절차에 포함하지 않는다.

## 12. 아직 결정되지 않은 항목

- Demo 도메인, HTTPS 종료 및 인증서 관리 방식
- EC2 프로세스 관리자, 로그 수집과 알림 방식
- RDS 백업/복구 목표, 규모, 비용 한도
- Demo 콘텐츠와 데이터 준비 및 검증 기준
- 배포 승인자, 유지보수 창, 접근 권한

## 13. 향후 확장

실제 필요가 확인되면 S3/CloudFront를 정적 자산 배포에 검토한다.
CI/CD, 확장 및 고가용성 구성은 MVP 운영 요구가 정해진 뒤 별도 설계한다.
이번 v0.1에서는 Docker, ECS, EKS, Kubernetes, Auto Scaling, Redis Cluster, Kafka를 도입하지 않는다.
