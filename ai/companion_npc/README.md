# AI 동행 NPC 실험 환경

「왜곡」 AI 동행 NPC 의 계약 설계와 모델 비교 실험을 하는 곳이다. **backend·frontend 와 분리되어 있다.**
12월 PRD 의 정적 힌트(USR-108)와는 별개인 확장 실험(EXT-001)이다. 자세한 범위는 [docs/00_범위와_원칙.md](docs/00_범위와_원칙.md)에 있다.

- 정답 판정과 PlaySession 상태 변경은 하지 않는다 (backend 책임).
- `backend/` 는 테스트에서 **읽기만** 한다.

## 지금 단계 — P0 · P1

| | 내용 |
|---|---|
| P0 | 폴더 · Python 3.12 가상환경 · 최소 의존성 |
| P1 | 계약 초안 3종 + 검증 테스트 |

| 계약 | 문서 | 코드 |
|---|---|---|
| ScenarioPack | [docs/contracts/scenario_pack_v0.1.md](docs/contracts/scenario_pack_v0.1.md) | `src/companion_npc/contracts/scenario_pack.py` |
| NpcContext | [docs/contracts/npc_context_v0.1.md](docs/contracts/npc_context_v0.1.md) | `src/companion_npc/contracts/npc_context.py` |
| NpcUtterance | [docs/contracts/npc_utterance_v0.1.md](docs/contracts/npc_utterance_v0.1.md) | `src/companion_npc/contracts/npc_utterance.py` |

팀이 정할 것은 [docs/01_합의_필요_사항.md](docs/01_합의_필요_사항.md)에 모았다.

## 폴더

```
ai/companion_npc/
├─ docs/                     범위·원칙, 계약 문서, 합의 사항
├─ src/companion_npc/
│  └─ contracts/             Pydantic 계약 · RAG 차단(visibility) · 누설 검사(spoiler)
├─ tests/                    계약 · 차단 · 누설 · backend 호환 테스트
│  └─ fixtures/              case_001 팩 · 가상 사건 팩 · Context · Utterance 견본
├─ pyproject.toml            pytest · ruff 설정 (이 폴더 전용)
├─ requirements*.txt
└─ .env.예시                 키 이름만. 실제 값은 .env (깃 제외)
```

P2 이후 추가할 자리 (이번에는 만들지 않음): `src/companion_npc/{scenario,state,policy,generation,rag,eval}/`, `experiments/`, `notebooks/`, 그리고 깃에서 빠지는 `data/`, `models/`, `runs/`.

## 환경 준비 (Windows · PowerShell)

backend(Python 3.13)와 **다른** Python 3.12 가상환경을 쓴다.

```powershell
cd kgeseo\ai\companion_npc
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip check
```

의존성은 pydantic · pytest · ruff 뿐이다. backend 와 같은 버전이다.
PyTorch · Qwen · LightGBM · scikit-learn · OpenAI SDK 는 계약 합의 후 단계별로 추가한다.

## 검사

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

`tests/test_backend_compat.py` 는 `../../backend` 의 스키마와 `case_001` JSON 을 읽어
닫힌 값 목록(action · target_type · result_type · state_changes · PlaySessionState 필드)이 같은지 검사한다.
backend 계약이 바뀌면 이 테스트가 먼저 깨진다. backend 가 없으면 이 테스트는 건너뛴다.

## ⚠️ 테스트 견본은 운영 데이터가 아니다

`tests/fixtures/` 의 팩에 든 힌트·지식 문구는 **계약 검증용 견본**이다. 실제로 승인된 힌트가 아니다.

- `approved_by: "test-fixture"`, `provenance.rationale: "테스트 견본 — 실제 승인 힌트 아님"` 으로 표시해 두었다.
- `scenario_pack_fictional.json`(꺼진 등대)은 가상 사건이다. 실제 설화·지역과 관계없다.
- 이 문구를 게임·정적 힌트(USR-108)·학습 정답지로 옮겨 쓰지 않는다. 운영 힌트는 사람이 따로 작성·승인한다.

## 깃에 올리지 않는 것

이 폴더의 `.gitignore` 가 막는다. 루트 `.gitignore` 는 고치지 않았다.

- `.venv/`, 캐시
- `data/`, `runs/`, `models/` 와 모델·인덱스 파일(`*.gguf`, `*.safetensors`, `*.pt`, `*.faiss` …)
- `.env` (견본 `.env.예시` 만 올린다)
