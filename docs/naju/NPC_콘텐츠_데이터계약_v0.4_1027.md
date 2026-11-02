# AI 동행 NPC ↔ 콘텐츠 생성 에이전트 데이터 계약 v0.4 (10/27)

> v0.4 = **v0.3(`claude/NPC_콘텐츠_데이터계약_v0.3_1022.md`) 1~10절 그대로** + 아래 고침(6·9절) + 새 절 11~13. 🟢 합의 · 🟡 제안(확인 필요) · 🔴 결정 필요
> 첫 연결 대상: 나주 앙암바위 `naju-angam-01`. 대응표 초안 `naju-angam-01.idmap.draft.json`(같은 폴더).

## 6절 고침 — fingerprint 계산 대상
- `content_fingerprint = "sha256:" + sha256( canonical({ "client": …, "server": …, "npc": …, "idmap": … }) )` — idmap 이 있는 케이스는 대응표 본문도 넣는다(없으면 키를 빼고 계산). 파일 머리 일치 규칙에 idmap 파일도 포함.

## 9절 고침 — 남은 결정 추가
| 항목 | 누구 |
|---|---|
| 콘텐츠 버전 저장·조회 구조와 세션 고정 적용 방식 | BE(세진) |
| 서버에 잘못된 런타임 ID 가 왔을 때 상태 코드(기존 오류 계약에 맞춤) | BE(세진) |
| `clear_when` 판정 구현 여부 · 퍼즐 아닌 씬 완료 조건의 표현 방식 | BE(세진) · PM |
| 나주 어댑터 파일 위치 · 세션 시작 신호 · 읽기 getter 범위 | FE · 나주 담당 · PM |
| 나주 씬 물건 배치 확인(씬 2·3·5 배치 0, 씬2 솟대가 Z1) · 생성 퍼즐 호스트를 나주 맵에 둘지 | 나주 담당 · PM |

## 11. 나주 연결 — 로컬 ID ↔ 런타임 ID 🟢(v0.4, BE 합의 10/27)
- **나주 로컬 ID 는 그대로 둔다.** 구역 `Z1~Z4` · 통로 `T1~T4` · 차단물 `B1~B4` · 씬 번호 1~5 · 물건 `<인스턴스 묶음>#<번호>`(예: `씬1.통발#2`). FE 어댑터가 BE 로 보낼 때·받을 때만 런타임 ID 로 바꾼다. BE·NPC 는 런타임 ID 만 쓴다.
- **대응표** `<case_id>.idmap.json` — 케이스 콘텐츠 묶음 안의 별도 파일(client/server/npc 와 나란히). 첫 케이스 `naju-angam-01` 초안: `naju-angam-01.idmap.draft.json`.
  - 항목: zones · scenes(로컬 완료 신호 `endScene(n)`) · navigation(T1~T4) · blockers · objects(`local` → `zone_id`·`object_id`) · puzzles · clues(생성 `src_id` ↔ 런타임 ID) · not_mapped(보내지 않는 로컬 상태와 까닭).
  - **fingerprint 대상에 넣는다**(6절 계산식의 `{client, server, npc}` → `{client, server, npc, idmap}`).
- **매핑 없는 로컬 ID** 🟢: FE 가 서버 전송을 막고 진단 로그(`local_id` · 종류 · `case_id` · `content_version` · 시각)를 남긴다. NPC 는 `content_mode: generic`.
- **잘못된 런타임 ID 가 서버에 온 경우**: 기존 BE 오류 계약에 맞춰 상태 코드 지정 — BE(세진) 🔴.
- **보내지 않는 것**: `stage.seenClues`(2.5 m 근접 「봤다」 — 단서 획득 아님) · 미리보기 전용 연출(왜곡의 막) · NPC 자체(대화 API).
- 게시 전 검증 **PUB-REF 확장** 🟡: ① 나주 상호작용이 필요한 런타임 ID(구역·물건·단서·씬)가 모두 대응표에 있다 ② 대응표의 로컬 ID 가 나주 코드(sitePlan·배치 파일)에 실제로 있다 ③ 한 로컬 ID 가 두 런타임 ID 로 가지 않는다.

## 12. PlaySession 연동 단계 · 버전 고정 · 씬 판정 🟢(v0.4)
- **case_id** `naju-angam-01`. 콘텐츠 버전은 case_id 와 분리하고, PlaySession 은 시작 때 참조한 `(content_version, content_fingerprint)` 를 끝까지 유지(6절). BE 저장·조회 구조 확인 뒤 구체화 🔴.
- **PlaySession 클라이언트**: 튜토리얼(`src/server/api.ts` · `playSession.ts`)을 재사용. 나주에는 어댑터 파일 + 세션 시작 신호 한 곳만 추가(범위는 FE·나주 담당과 합의). 세션 시작 → NPC 요청 `session.play_session_id` 채움 · NPC `rebaseline()`.
- **단계**
  | 단계 | 게임 진행 기준 | NPC |
  |---|---|---|
  | 0 (지금) | 나주 로컬 | generic · `puzzle_hint` 차단 |
  | 1 | FE 가 세션을 만들고 로컬 이벤트(상호작용·단서 획득)를 대응표로 바꿔 전송, **BE 가 판정** | generic(맥락 준비) |
  | 2 | 같음 | BE `model_context`(case 모드) |
- **씬 완료**: FE 의 완료 이벤트로 확정하지 않는다. BE 가 퍼즐·단서·상호작용 상태로 `clear_when`(3.4)을 판정. 퍼즐이 아닌 조건(특정 자리 도착·연출 시청 등)이 생기면 상호작용 종류로 표현할지 별도 API 로 할지 검토 🟡.
- **1단계 전제**: 나주 퍼즐이 `naju-angam-01.server.json` 에 정의돼야 BE 가 판정한다 → 컴파일·게시 단계 필요. 그전까지 씬 진행은 로컬.
- **지금 초안에서 드러난 빈칸**(idmap 초안 기준)
  - 생성 퍼즐 10개·단서 27개의 호스트(나룻배 표지·뱃사공 등)가 나주 맵에 아직 없다 → 모두 `unplaced`.
  - 나주 씬 물건(그물틀·통발·솟대·배자국 등)은 놓여 있으나 상호작용(`interaction`)이 없다 → `placed_no_interaction`.
  - 확인한 판(src=sf)에서 씬 물건 13개가 모두 Z1 에 있다(씬2 솟대도 Z1, 씬2 무대는 Z4). 씬 2·3·5 묶음 11개는 배치 0 — 나주 담당 확인 🟡.
  - 생성 장면 순서 = 나주 씬 번호로 가정했다 🟡.

## 13. 힌트 재열람 — 2단계(정답 보기) 🟢(v0.4)
5절 「재열람」에 덧붙인다.
- 그 퍼즐의 `hint_level ≥ 2` 를 **응답을 만드는 시점에 BE 가 확인**했을 때만. 클라이언트·NPC 가 보낸 값은 쓰지 않는다.
- **플레이어가 다시 보기를 요청했을 때만**. NPC 가 먼저 꺼낼 때는 nudge 만.
- 모델 대사와 **분리된 필드**(예: `reshown_hint { puzzle_id, level, text }`)에 승인 원문 그대로. 정책 검사의 정답 문자열 검사는 이 필드에 한해, 해금이 확인된 그 퍼즐 정답만 예외. 모델 대사는 모든 정답 문자열을 계속 검사.
- 힌트 사용 횟수에 넣지 않고 `npc_hint_reshown { puzzle_id, level: 2 }` 만 기록.

## v0.4 변경
| # | 내용 | 근거 |
|---|---|---|
| 1 | 11절 나주 로컬 ID ↔ 런타임 ID 대응표(idmap), 매핑 없음 처리, PUB-REF 확장 | BE 회신 10/27 |
| 2 | 6절 fingerprint 계산 대상에 idmap 추가 | PM |
| 3 | 12절 PlaySession 단계 · case_id · 버전 고정 · 씬 완료 BE 판정 | BE 회신 10/27 |
| 4 | 13절 2단계 힌트 재표시 조건 | BE 질문 10/27 |
| 5 | 9절 남은 결정에 버전 구조 · 잘못된 ID 오류 코드 · 나주 배치 확인 추가 | — |
