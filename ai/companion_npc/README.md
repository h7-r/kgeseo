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

## P2-A — 기존 Case 파일 변환기

backend 의 `<case_id>.client.json` · `.server.json` 을 읽어 **draft** ScenarioPack 과 변환 보고서를 만든다.
정답과 조합 짝은 옮기지 않는다. 원본에 없는 힌트·설정·설화는 만들지 않는다.
규칙은 [docs/02_P2-A_변환기.md](docs/02_P2-A_변환기.md)에 있다.

```powershell
$env:PYTHONPATH = "src"
.\.venv\Scripts\python.exe -m companion_npc.adapters case_001
```

`--out-dir` 로 파일을 쓸 때는 `runs/` 처럼 깃에서 빠지는 폴더를 쓴다.

## P2-B — 플레이어 행동 특성 추출

PlaySessionState 와 상호작용 기록을 판단층 입력(FeatureVector fs-0.1, 25개 특성)으로 바꾼다.
규칙은 [docs/03_P2-B_특성.md](docs/03_P2-B_특성.md)에 있다.

| 기능 | 코드 |
|---|---|
| 공통 특성 추출 — 온라인·오프라인이 같은 함수 | `features/extract.py` `extract_features(context, pack)` |
| 오프라인 재생 — interaction_events 행 → 판단 시점별 NpcContext | `features/replay.py` `replay_session(...)` |
| 대리 라벨 `no_progress_within_120s` · `needs_help` 계약 | `features/labels.py` |
| 오답 지문 (비밀 키 필요, 오답만) | `features/fingerprint.py` |

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_features.py
```

**현재 범위**
- 특성 **계산**까지만 만들었다. 모델 학습·성능 검증·합성 플레이어(P2-C)는 없다.
- DB 에 접속하지 않는다. 실제 운영 로그로는 아직 돌려 보지 않았다.
- 검증 범위와 한계는 [docs/01_합의_필요_사항.md](docs/01_합의_필요_사항.md) 「P2-B 검증 범위」에 있다.

## P2-C — 합성 플레이어 시뮬레이터

5가지 유형(빠른 해결 · 시행착오 · 반복 오답 · 장시간 탐색 · 중도 이탈)의 합성 세션을 만든다. 출력의 `interaction_events.jsonl` 은 운영 로그와 같은 형식이라 P2-B 파이프라인을 그대로 지난다.
규칙·결과·한계는 [docs/04_P2-C_시뮬레이터.md](docs/04_P2-C_시뮬레이터.md)에 있다.

```powershell
$env:PYTHONPATH = "src"
.\.venv\Scripts\python.exe -m companion_npc.simulation --config experiments\p2c_default.json --out-dir data\synthetic\p2c_default --analyze
.\.venv\Scripts\python.exe -m pytest tests\test_simulation.py
```

- **합성 데이터는 파이프라인 기능 검증용이다.** 실제 플레이어 분포를 대표하지 않는다. 매개변수(`experiments/p2c_default.json`)는 관찰 근거가 없는 가정값이다.
- 잠재 상태·유형 같은 시뮬레이터 정답(`session_truth`, `latent_segments`)은 라벨·평가에만 쓴다. 모델 입력에는 넣지 않는다.
- 대량 출력은 `data/synthetic/`(깃 제외)에 쓴다. 깃에는 15세션 견본(`tests/fixtures/synthetic/`)과 요약(`experiments/results/`)만 둔다.

## P3-A — 학습·평가 기반과 규칙 기준선

`synthetic_needs_help` 를 목표로 하는 판단층의 학습·평가 골격이다. 구성은 다음과 같다.
- 데이터셋 로더 · 라벨 결합 검사 · 모델 입력과 Oracle 정보 분리
- 사건 단위 leave-one-case-out + 세션 단위 GroupKFold · 누수 검사
- 항상 개입 / 개입 안 함 / 규칙 기준선
- 분류 지표와 개입 정책 지표 (관측 가능 · Oracle 필터)

설계와 결과는 [docs/05_P3_학습평가_설계.md](docs/05_P3_학습평가_설계.md)에 있다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ml.txt    # scikit-learn · LightGBM
$env:PYTHONPATH = "src"
.\.venv\Scripts\python.exe -m companion_npc.training --config experiments\p3\p3a_baselines.json --publish
.\.venv\Scripts\python.exe -m pytest tests\test_training.py
```

- **결과는 모두 합성 데이터 평가값이다.** 실제 플레이어 성능이 아니다. 테스트 통과는 기능 검증이다.
- 관측 가능 평가에서 규칙 기준선 개입의 74~95% 가 세션 종료 후였다. 규칙 기준선은 오개입 예산을 충족하지 못했다.
- `generator_reference` 는 Oracle(플레이어 유형)을 쓰는 참고 기준선이다. 운영에 쓸 수 없다.
- 커밋하는 결과는 `experiments/results/<exp_id>/` 의 `report.md` · `metrics.json`(핵심 지표 + 재현 정보)뿐이다. 원본 `results.json` 은 `runs/`(깃 제외)에 둔다.
- 로지스틱 회귀 · LightGBM 학습은 P3-B 에서 한다.

## P3-B — 판단 모델 비교와 개입 정책 평가

로지스틱 회귀 · LightGBM · 규칙 기준선을 같은 조건(사건 단위 바깥 분할 · 세션 단위 안쪽 선택 · 세션 부트스트랩)으로 비교했다. 정책 쪽은 ActivityGate(마지막 이벤트 뒤 2·5·10분 차단) · 세션당 3회 · 퍼즐당 2회 · cooldown 60초를 평가했다.
결과와 확정된 개입 정책은 [docs/06_P3-B_모델비교.md](docs/06_P3-B_모델비교.md)에 있다.

```powershell
$env:PYTHONPATH = "src"
.\.venv\Scripts\python.exe -m companion_npc.training.p3b_cli --config experiments\p3\p3b_models.json --publish   # 약 16분
.\.venv\Scripts\python.exe -m pytest tests\test_p3b.py
```

- **합성 데이터 평가값이다.** 실제 플레이어 성능이 아니고, 운영 모델은 정하지 않았다.
- 자동 개입은 두 가지다. 대상이 불명확하면 `check_in`(도움 필요 여부만 묻기), 확인된 포커스와 승인 콘텐츠가 있으면 퍼즐 힌트다. 합성 평가에서는 모든 개입이 `check_in` 이었다.
- 탐색 중 오개입 · 종료 후 개입률 같은 진단 지표는 시뮬레이터 정답으로 계산한 사후 진단이다. 온라인 정책 조건이 아니다.

## P4-A — NPC 발화층 (안전한 발화 기반)

승인된 NPC 콘텐츠(`.npc.json` v0.1 초안)를 사건 팩과 합친다. 그다음 거른 지식만 근거로 `check_in` · `clarify` · `nudge` · `hint` 발화를 만들고, 공통 안전 검증을 거친다. 실패하면 승인 템플릿으로 대체하고, 그것도 실패하면 보류한다.
설계와 결과는 [docs/07_P4-A_발화층_설계.md](docs/07_P4-A_발화층_설계.md)에 있다.

```powershell
$env:PYTHONPATH = "src"
.\.venv\Scripts\python.exe -m companion_npc.speech --config experiments\p4\p4a_speech.json --publish
.\.venv\Scripts\python.exe -m pytest tests\test_speech.py
```

- 네트워크와 LLM 을 쓰지 않는다. GPT · Qwen 은 P4-B 다.
- `.npc.json` 은 테스트 fixture 기준의 초안이다. backend 공식 게시 계약이 아니다.
- 정답 별칭은 서버 비공개 정보다. 테스트에서는 `tests/fixtures/private/` 이 그 자리를 대신한다.
- 평가는 구조 지표(누설 · 차단 · 대체)다. 발화 품질 평가가 아니다.
- 근거 검사는 문장·절 단위다. 승인 힌트 뒤에 덧붙인 문장은 막지만(8/8), 정당한 바꿔 말하기도 많이 막고(오탐 7/10), 문장 안에 끼워 넣은 짧은 표현은 못 막는다. 의미 수준 누설을 완전히 막는다고 주장하지 않는다.
- `.npc.json` 견본의 approved · published 는 테스트용 상태다. 실제 팀 승인이 아니다.

## 폴더

```
ai/companion_npc/
├─ docs/                     범위·원칙, 계약 문서, 합의 사항
├─ src/companion_npc/
│  ├─ contracts/             Pydantic 계약 · RAG 차단(visibility) · 누설 검사(spoiler)
│  ├─ adapters/              P2-A Case 파일 → ScenarioPack 변환기 · CLI
│  ├─ features/              P2-B 특성 추출 · 오프라인 재생 · 대리 라벨
│  ├─ simulation/            P2-C 합성 플레이어 시뮬레이터 · 분석
│  ├─ training/              P3 학습·평가 (데이터 · 분할 · 기준선 · 모델 · ActivityGate · 정책 · 부트스트랩 · 재현 정보)
│  └─ speech/                P4 발화층 (검색 · 생성기 · 안전 검증 · 파이프라인 · 평가)
├─ experiments/              실험 설정(p2c_default.json) · 결과 요약(results/)
├─ tests/                    계약 · 차단 · 누설 · 변환기 · backend 호환 테스트
│  └─ fixtures/              case_001 팩 · 가상 사건 팩 · Context · Utterance 견본
│     └─ cases/              backend 형식의 가상 사건 한 쌍 (변환기 입력)
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
- `scenario_pack_fictional.json` 과 `cases/case_fixture_lighthouse.*.json`(꺼진 등대)은 가상 사건이다. 실제 설화·지역과 관계없다. 그 안의 정답(`0412` 등)도 테스트용이다.
- 이 문구를 게임·정적 힌트(USR-108)·학습 정답지로 옮겨 쓰지 않는다. 운영 힌트는 사람이 따로 작성·승인한다.

## 깃에 올리지 않는 것

이 폴더의 `.gitignore` 가 막는다. 루트 `.gitignore` 는 고치지 않았다.

- `.venv/`, 캐시
- `data/`, `runs/`, `models/` 와 모델·인덱스 파일(`*.gguf`, `*.safetensors`, `*.pt`, `*.faiss` …)
- `.env` (견본 `.env.예시` 만 올린다)
