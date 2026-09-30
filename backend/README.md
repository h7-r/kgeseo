# 왜곡 Backend

지역 설화 기반 온라인 방탈출 게임 **왜곡**의 백엔드 프로젝트입니다.

현재는 FastAPI + MySQL 기반으로 세션 API와 게임 진행 상태 관리 기반을 구축하고 있습니다.

## 현재 구현 상태

- FastAPI 기본 실행
- `.env` 기반 DB 설정 분리
- SQLAlchemy Async + aiomysql 연결
- MySQL 연결 검증
- Alembic Migration 구성
- `anonymous_sessions` 테이블 생성
- 익명 세션 생성 API 구현
- Swagger 호출 및 실제 DB 저장 검증 완료
- `play_sessions` 테이블 및 ORM 구현
- Play Session Schema / Service / Router 구현
- Play Session Router 등록
- Play Session 실제 API 호출 및 MySQL 저장 검증 완료
- Play Session 상태 조회 / 이어하기 API 구현 및 검증 완료
- Interaction v0.3.2 Phase 1 flat Response와 input/combine_clues Adapter 구현
- Interaction 멱등 replay, attempt count, UTC client timestamp 저장 및 MySQL 검증 완료
- 파일 기반 Case Bundle API 구현
- Development Harness v0.1 구축
  - pytest 자동 테스트
  - Ruff lint / format 검사
  - `scripts/check.ps1` 로컬 검증 스크립트
- Health Check API 구현
- AnonymousSession / PlaySession 기본 자동 테스트

현재 구현된 API:

```http
GET /api/v1/health
GET /api/v1/health/ready
POST /api/v1/anonymous-sessions
POST /api/v1/play-sessions
GET /api/v1/play-sessions/{play_session_id}
POST /api/v1/play-sessions/{play_session_id}/interactions
GET /api/v1/cases/{case_id}/bundle
```

Interaction Endpoint는 현재 `input`, `combine_clues`를 처리한다.
`inspect`, `navigate`, `select`는 Request Contract에는 포함되지만 Runtime 미구현으로 HTTP 501을 반환한다.

## 기술 스택

- Python 3.13
- FastAPI
- SQLAlchemy 2.x
- aiomysql
- MySQL 8.0
- Alembic
- Pydantic / pydantic-settings
- Uvicorn

## 프로젝트 구조

```text
backend/
├─ app/
│  ├─ api/
│  │  └─ v1/
│  │     ├─ __init__.py
│  │     ├─ anonymous_sessions.py
│  │     ├─ health.py
│  │     └─ play_sessions.py
│  ├─ core/
│  │  ├─ __init__.py
│  │  └─ config.py
│  ├─ db/
│  │  ├─ __init__.py
│  │  ├─ base.py
│  │  └─ session.py
│  ├─ models/
│  │  ├─ anonymous_session.py
│  │  └─ play_session.py
│  ├─ schemas/
│  │  ├─ anonymous_session.py
│  │  ├─ health.py
│  │  └─ play_session.py
│  ├─ services/
│  │  ├─ anonymous_session.py
│  │  └─ play_session.py
│  └─ main.py
├─ alembic/
│  ├─ versions/
│  └─ env.py
├─ docs/
├─ scripts/
│  └─ check.ps1
├─ tests/
├─ AGENTS.md
├─ alembic.ini
├─ pytest.ini
├─ requirements-dev.txt
├─ requirements.txt
├─ ruff.toml
├─ .env
├─ .env.example
└─ .gitignore
```

## 로컬 실행

모든 Backend 명령은 저장소를 clone한 뒤 `kgeseo/backend/`에서 실행합니다.
아래 절차는 Windows, Python 3.13.14, MySQL 8.0.46 환경에서 검증했습니다.

```powershell
cd kgeseo\backend
```

### 1. Python 환경 준비

Windows에서는 `python` 명령이 PATH 설정에 따라 실행되지 않거나 다른 Python 버전을 가리킬 수 있으므로 `py -3.13` 사용을 권장합니다.

```powershell
py -3.13 --version
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip check
```

PowerShell에서 가상환경을 활성화하지 않아도 위와 같이 `.venv`의 Python을 직접 사용할 수 있습니다.
`requirements-dev.txt`는 Runtime dependency와 테스트, lint, format 도구를 함께 설치합니다.

Runtime dependency만 필요한 환경에서는 다음을 사용합니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Linux/macOS 환경은 이번 절차에서 실제 검증하지 않았습니다. 해당 환경에서는 가상환경 실행 파일 경로가 Windows와 다르므로 일반적인 Python 가상환경 사용법에 맞게 명령을 조정해야 합니다.

### 2. 환경변수 설정

`.env.example`을 `.env`로 복사합니다.

```powershell
Copy-Item .env.example .env
```

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=waegok_app
DB_PASSWORD=<LOCAL_PASSWORD>
DB_NAME=waegok
```

- `DB_HOST`: MySQL 서버 주소. 이번 로컬 검증에서는 `127.0.0.1`을 사용했습니다.
- `DB_PORT`: MySQL 포트. 기본값은 `3306`입니다.
- `DB_USER`: Backend가 사용할 MySQL 계정입니다.
- `DB_PASSWORD`: 해당 MySQL 계정의 비밀번호입니다.
- `DB_NAME`: Backend가 사용할 database 이름입니다.

실제 비밀번호는 `.env`에만 작성하고 `.env`는 Git에 커밋하지 않습니다.

### 3. MySQL 최초 준비

Alembic은 database와 MySQL user 자체를 생성하지 않습니다. 새 PC에서는 MySQL 관리자 계정으로 최초 한 번 database와 애플리케이션 계정을 만들고, 해당 database에 필요한 권한을 부여해야 합니다.

다음 SQL은 로컬 개발용 예시이며 실제 비밀번호 대신 placeholder를 사용합니다.

```sql
CREATE DATABASE waegok
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'waegok_app'@'localhost'
  IDENTIFIED BY '<LOCAL_PASSWORD>';

GRANT ALL PRIVILEGES ON waegok.* TO 'waegok_app'@'localhost';
FLUSH PRIVILEGES;
```

MySQL 계정의 host 부분과 database 이름은 실제 실행 환경에 맞게 설정합니다.

### 4. Migration 적용

새로 만든 빈 DB에서는 현재 migration chain을 기준으로 다음 명령을 사용합니다.

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

기존 DB에는 migration 이력이 현재 코드와 일치하는지 먼저 확인해야 합니다. 확인 없이 `upgrade`, `stamp`, `downgrade`를 실행하지 마세요.

현재 로컬 검증 시 기존 `waegok` DB의 `alembic_version`은 `f59fc2b266d8`이었고 현재 코드의 migration head는 `d7481874fb1c`였습니다. 두 값이 일치하지 않아 해당 기존 DB에는 `upgrade head`를 실행하지 않았습니다. 이는 한 로컬 DB에서 확인한 결과이며 팀 공용 DB 상태를 의미하지 않습니다.

### 5. 서버 실행

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

- 기본 주소: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 6. 테스트 및 Ruff

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

Windows에서는 기존 검증 스크립트로 세 명령을 순서대로 실행할 수도 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

현재 환경에서 확인한 검증 기록은 다음과 같습니다. 테스트 파일이 변경되면 테스트 수와 파일 수는 달라질 수 있습니다.

```text
Python 3.13.14
MySQL 8.0.46
requirements-dev.txt 설치 성공
pip check 성공
166 tests passed, 2 warnings
Ruff check: All checks passed
Ruff format check: 64 files already formatted
```

## Health Check

FastAPI 프로세스 상태 확인:

```http
GET /api/v1/health
```

DB를 조회하지 않으며 정상 응답은 HTTP 200과 `status=ok`입니다.

```json
{
  "status": "ok"
}
```

DB readiness 확인:

```http
GET /api/v1/health/ready
```

DB에 `SELECT 1`을 실행합니다. 연결에 실패하면 HTTP 503을 반환하며, 정상 응답은 HTTP 200과 `status=ready`입니다.

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health/ready
```

이번 로컬 검증에서는 두 endpoint 모두 HTTP 200 응답을 확인했습니다.

기존 `GET /`는 사람이 확인하는 기본 안내 응답이고,
Health Check는 자동화된 상태 확인을 위한 고정된 API 계약입니다.

## Runtime Content

게임 Runtime Content는 다음 위치에서 로드합니다.

```text
app/content/cases/<case_id>.client.json
app/content/cases/<case_id>.server.json
```

경로는 서비스 코드 파일 위치를 기준으로 계산하므로 프로젝트가 `backend/` 하위로 이동한 것 자체로 깨지지 않습니다.

현재 저장소에는 실제 Runtime Content JSON이 포함되어 있지 않고 `app/content/cases/__init__.py`만 존재합니다. 따라서 Health Check, DB readiness, Backend 자동 테스트는 실행할 수 있지만 실제 Case Bundle, Play Session, Interaction 플레이 흐름은 Runtime Content를 준비하기 전까지 제한될 수 있습니다.

## DB

현재 생성된 주요 테이블:

```text
alembic_version
anonymous_sessions
play_sessions
interaction_events
```

현재 Alembic head:

```text
d7481874fb1c
```

`anonymous_sessions` 구조:

```text
id          CHAR(36)     PRIMARY KEY
created_at  DATETIME(6)  NOT NULL
expires_at  DATETIME(6)  NOT NULL
```

`expires_at`에는 만료 세션 조회를 위한 인덱스가 설정되어 있습니다.

## API 문서

익명 세션 API 상세 문서:

```text
docs/anonymous_session_api.md
```

Play Session API 상세 문서:

```text
docs/play_session_api.md
```

Interaction API 상세 문서:

```text
docs/contracts/interaction_api_v0.3.2.md
```

Case Bundle API 상세 문서:

```text
docs/contracts/case_bundle_api_v0.1.md
```

## 다음 작업

다음 게임 기능은 API Contract를 먼저 확정한 뒤 기능 단위로 진행합니다.

## 개발 원칙

```text
API Contract
→ DB Schema
→ ORM Model
→ Migration
→ Pydantic Schema
→ Service
→ Router
→ main.py 등록
→ 자동 테스트
→ Swagger/API 검증
→ DB 저장 검증
→ 문서 갱신
```

DB 전체를 처음부터 과도하게 설계하지 않고, 필요한 API 단위로 Schema와 Migration을 함께 확정합니다.
