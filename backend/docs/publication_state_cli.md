# 게시 콘텐츠 상태 관리 — 운영 Runbook (suspend · block · resume)

명령: `python -m scripts.publication_state {status|suspend|block|resume}` (`backend/scripts/publication_state.py`)
판정 · 전이는 기존 `NpcPublicationService`가 하고, 이 명령은 실행 조건을 확인하고 결과만 보여 준다.

> **상태 변경과 코드 롤백은 다른 일이다.** 이 명령은 DB의 게시 상태만 바꾼다. 배포된 코드 · 게시 파일 · 승인 기록은 바꾸지 않는다.
> 코드 문제는 main 병합 revert → 배포(`deploy-backend.yml`)로 따로 되돌린다.

## 1. 상태와 회차 동작 (PM v0.4.6 · 코드 확인 · 격리 MySQL 테스트)

| 상태 | 신규 회차(`POST /play-sessions`) | 진행 중 회차: 퍼즐 · Client Bundle · Hint | 진행 중 회차: NPC 케이스 대사 |
|---|---|---|---|
| `published` | 허용 | 정상 | 사용 |
| `suspended`(일반 중단) | **409**(게시 중 아님) | 정상 | 사용(고정 게시본 그대로) |
| `blocked`(긴급 중단) | **409** | 정상(이전 Hint 재전송도 처음 응답 그대로) | **차단** — `fallback_reason=NPC_CONTENT_WITHDRAWN`. 승인된 일반 「잠시 멈춤」 팩이 있으면 그 대사, 없으면 `reply: null`. 이 버전의 저장된 NPC 응답 본문은 block 때 지운다 |

- 진행 중 회차의 세션 ID · 고정 fingerprint · 완료 상태는 어느 상태에서도 바뀌지 않는다.
- 상태는 앱이 **요청마다 DB에서 읽는다 → 서버 재시작 필요 없음.** 재시작해도 상태는 DB에 남고, suspended · blocked 버전도 고정 회차용으로 복구된다.
- 다른 케이스 · 다른 버전은 바뀌지 않는다.

## 2. 허용 전이

| 명령 | 시작 상태 → 결과 | 조건 |
|---|---|---|
| `suspend` | published → suspended | 그 밖의 상태면 거부(종료 3) |
| `block` | published · suspended → blocked | 실행 전에 본 상태와 잠근 뒤 상태가 다르면 거부(동시 변경) |
| `resume` | suspended · blocked → published | ① 게시 루트 파일의 fingerprint = 등록 fingerprint ② **지금 DB 승인 이력으로 게시 게이트 다시 통과** ③ blocked였으면 G1 · G2 · G3 최종 approved가 모두 **마지막 차단 뒤**(재승인 필요) |

- 이미 목표 상태면 `result=unchanged`(종료 0, 아무것도 안 바꿈).
- ⚠ `resume`은 게시 게이트의 VERSION_ORDER도 다시 본다 — **같은 케이스에 더 높은 버전이 등록돼 있으면 낮은 버전은 재개할 수 없다**(기존 서비스 계약). 나주는 지금 v1 하나라 해당 없음.
- ⚠ 나주 v1 `resume`은 PR #62(게이트 · idmap 검증기 수정)가 배포된 서버에서만 게이트를 통과한다.
- 상태 변경 이력(actor · reason · 시각)은 같은 트랜잭션에서 남는다. 실패하면 상태 · 이력 모두 rollback.

## 3. 언제 무엇을

| 상황 | 권장 |
|---|---|
| 콘텐츠에 고칠 점이 있지만 진행 중인 플레이어는 끝까지 하게 둔다 | `suspend` → content_version 2 준비 · 승인 · 게시 |
| NPC 대사에 즉시 내려야 할 문제(사실 왜곡 · 부적절한 문장) | `block`(진행 중 회차도 다음 NPC 요청부터 케이스 대사 없음) |
| 문제가 아니었다 / 해결됐다(같은 v1) | suspended → `resume`. blocked → G1~G3 재승인(`record_gate_review`, `--supersedes` · `--reason`) 뒤 `resume` |
| 퍼즐 판정 · 서버 코드가 틀렸다 | 상태 변경으로는 못 고친다 — 신규 회차를 막으려면 `suspend`, 코드는 revert 배포. 진행 중 회차는 계속 그 코드로 판정된다 |

## 4. 실행 전 확인

1. 대상: `case_id` · `content_version` · fingerprint(아래 status로 확인한 값과 같은지).
2. 실행 근거(`--reason`)와 실행자(`--actor`). 운영 DB 이름(`--confirm-db`, 🟡 확인 필요).
3. `status` → 계획(--commit 없이) → `--commit` 순서. 계획 출력의 `plan: A -> B`가 의도와 같은지.

## 5. CloudShell → SSM 명령

**확인된 값**(저장소 `.github/workflows/deploy-backend.yml` · `server-logs.yml`): 리전 `ap-northeast-2`, 인스턴스 `i-006fa7d504dafaa75`, 배포는 SSM Run Command(사용자 문서 `waegok-Deploy` · `waegok-Logs`).
**확인 안 된 값(🟡 — 미르가 운영 서버에서 확인 후 채운다):** 백엔드 폴더(문서상 예 `/opt/waegok/backend`), venv Python 경로, 운영 DB 이름, `AWS-RunShellScript` 사용 허용 여부.
`.env`는 백엔드 폴더 기준으로 읽히므로 **반드시 그 폴더로 `cd` 한 뒤** 실행한다. 비밀번호 · 정답은 명령 · 출력에 나오지 않는다(명령 인자에 비밀값을 넣지 않는다).

### 5-1. CloudShell에서 한 번만(변수)

```bash
export AWS_REGION=ap-northeast-2 I=i-006fa7d504dafaa75 D=<백엔드 폴더> PY=<venv python 경로> DBN=<운영 DB 이름> FP=sha256:cf804b1740860aa563734f9d866bd660c14f5bf1f5f595cb4b118d557671f1b6
run(){ local a q=""; for a in "$@"; do if [[ $a == *\"* || $a == *\'* || $a == *\\* ]]; then echo "인자에 따옴표 · 역슬래시를 쓰지 않는다: $a" >&2; return 1; fi; q="$q '$a'"; done; CID=$(aws ssm send-command --instance-ids "$I" --document-name AWS-RunShellScript --comment publication_state --parameters "{\"commands\":[\"cd '$D' && '$PY' -m scripts.publication_state$q\"]}" --query Command.CommandId --output text) && echo "CommandId=$CID" && aws ssm wait command-executed --command-id "$CID" --instance-id "$I"; aws ssm get-command-invocation --command-id "$CID" --instance-id "$I" --query '[Status,ResponseCode,StandardOutputContent,StandardErrorContent]' --output text; }
```

- `run`은 인자를 하나씩 작은따옴표로 감싸 서버에 그대로 넘긴다(띄어쓰기 · 쉼표가 있는 `--reason`도 한 인자). 인자에 `'` · `"` · `\`가 있으면 보내지 않고 멈춘다.
  로컬 확인(11/8): `aws`를 대역으로 바꿔 만든 `--parameters`가 올바른 JSON이고, 서버 쪽 인자가 의도대로 나뉨(실제 AWS 호출 없음).
- `aws ssm wait command-executed`는 명령이 실패해도 끝난다(대기 실패 메시지가 나올 수 있다) — 그 뒤 `get-command-invocation`으로 실제 결과를 본다.

### 5-2. 명령 한 줄씩

```bash
# 1. status (읽기 전용)
run status --case-id naju-angam-01 --content-version 1
# 2. suspend — 먼저 계획(--commit 없이), 확인 뒤 같은 줄에 --commit --confirm-db 를 붙여 다시
run suspend --case-id naju-angam-01 --content-version 1 --expect-fingerprint $FP --actor <실행자> --reason '<근거>'
run suspend --case-id naju-angam-01 --content-version 1 --expect-fingerprint $FP --actor <실행자> --reason '<근거>' --commit --confirm-db $DBN
# 3. block
run block --case-id naju-angam-01 --content-version 1 --expect-fingerprint $FP --actor <실행자> --reason '<근거>' --commit --confirm-db $DBN
# 4. resume (게시 루트 = 서버 PUBLISHED_CONTENT_ROOT, LOCAL_IDS 파일이 있으면 --local-ids)
run resume --case-id naju-angam-01 --content-version 1 --expect-fingerprint $FP --content-root <PUBLISHED_CONTENT_ROOT> --local-ids <local-ids.json> --actor <실행자> --reason '<근거>' --commit --confirm-db $DBN
```

- `--reason`은 CloudShell에서 작은따옴표로 감싸 한 인자로 넘긴다. 그 안에 `'` · `"` · `\`는 쓸 수 없다(`run`이 거부).
- 요청 성공과 명령 성공은 다르다: `send-command`가 CommandId를 주면 **요청만** 접수된 것이다. 결과는 `get-command-invocation`의 `Status`(Success · Failed …)와 `ResponseCode`(= CLI 종료 코드)로 본다.
  - `ResponseCode` 0 성공 · 변화 없음 · 계획 / 1 입력 오류 · 대상 없음 · DB 오류 / 2 게이트 · 재승인 차단 / 3 상태 충돌 · 허용 안 되는 전이.
- 결과를 나중에 다시 볼 때: `aws ssm get-command-invocation --command-id <CommandId> --instance-id "$I" --query '[Status,ResponseCode,StandardOutputContent]' --output text`
- 필요한 IAM 권한(CloudShell 사용자): `ssm:SendCommand`(이 인스턴스 + `AWS-RunShellScript` 문서), `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations`. 인스턴스 역할은 이미 SSM 관리 대상이다(배포가 SSM으로 됨).
- 더 안전한 대안(권장, 미르 결정): `waegok-Deploy`처럼 **허용 인자만 받는 전용 SSM 문서**(예: `waegok-PublicationState` — action은 4개 중 하나, case_id · version 형식 검사)를 만들어 임의 셸 실행을 막는다.

## 6. 실행 후 확인

1. `run status …` — `status=` · `revision=` · 마지막 `event`(actor · reason)가 기대와 같은지.
2. 신규 회차: suspended · blocked면 세션 생성이 409인지, published면 201인지(담당자 게스트로).
3. 서버 재시작은 필요 없다. 로그는 Actions `server-logs`로.

## 7. 실패 시

| ResponseCode | 뜻 | 대응 |
|---|---|---|
| 1 | 입력 · 대상 없음 · DB 오류 | 출력의 `[ERROR]`/`refused:` 확인. 경로 · DB 이름 · 대상 다시 확인 |
| 2 | 게이트 · 재승인 차단(resume) | 출력의 `checks:` 표에서 FAIL 항목 확인. blocked 재개면 G1~G3 재승인부터 |
| 3 | 상태가 이미 바뀜 · 허용 안 되는 전이 · fingerprint 불일치 | `status`로 현재 상태 다시 보고 판단 |
| SSM `Failed`인데 ResponseCode 없음 | 셸 · 경로 문제 | `StandardErrorContent` 확인(폴더 · Python 경로) |

## 8. 배포와의 관계

- 이 명령 파일은 **이 브랜치가 main에 병합 · 운영 배포된 뒤에만** 서버에 있다(main 병합 = 운영 자동 배포).
- 상태 변경은 배포 없이 즉시 적용되고, 배포 · 재시작해도 DB 상태는 유지된다.
