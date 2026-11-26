# 공식 일반 대사 팩 · 긴급 중단 대체 대사 (PM v0.4.12, 팀 검토 대기)

코드: `app/services/npc_general_pack.py`(파일 공급 · DB 승인 판정), `app/services/npc_line_supply.select_pause_line`,
`app/services/npc_turn_service.py`, `app/api/v1/npc.py`, `scripts/general_pack_status.py`(읽기 전용 확인).

## 1. 공식 팩

| 항목 | 값 |
|---|---|
| 파일 | `backend/content/npc_general/general_default/v1.json` (비밀 정보 없음, 코드 저장소에 포함) |
| 승인 대상 | `target_type=dialogue_pack` · `target_id=general_default` · `content_version=1` |
| fingerprint (`target_hash`) | `sha256:a625988f0187d724f97184733be0e8a8d1b936c950dfc35d84329c19cea086be` |
| 대사 | `GENERIC_PAUSE_01`~`05` (PM 11/3 확정 원문, 바꾸지 않음) |

- fingerprint는 기존 `general_pack_fingerprint`(팩 모델 JSON의 JCS 정규화 → SHA-256)다. 파일의 들여쓰기 · 줄바꿈은
  값에 영향이 없고, 문장 · line_id · `use` · 버전이 한 글자라도 바뀌면 값이 바뀌어 이전 승인이 쓰이지 않는다.
- 문장을 고치려면 **새 버전 파일**(`v2.json`)을 만들고 그 fingerprint로 다시 승인받는다. 승인된 버전 파일은 고치지 않는다.
- 공식 팩에는 「잠시 멈춤」 5개만 있다. PM 기본 안내 문구(`NPC_GENERIC_PUZZLE_*`)는 넣지 않았다(넣으면 승인 시
  일반 NPC 응답 동작이 바뀐다 — 별도 결정 필요).
- 「잠시 멈춤」 대사(`GENERIC_PAUSE_*`)는 케이스가 `blocked`일 때, 플레이어가 말을 건 턴(`player_message`)에만
  쓴다(v0.4.16 §11 — auto 턴은 상황 유무와 상관없이 `reply: null`). 일반 대체 대사 공급
  (`general_pack_line_provider`) · 재전송 원문 조회에서 빠진다.
- 테스트 팩은 테스트 코드 안에서만 만든다(가상 문장, 이 경로를 쓰지 않는다).

확인: `python -m scripts.general_pack_status general_default/v1 [--db]` (읽기 전용, 승인 기록을 만들지 않음)

## 2. 공급 · 승인 판정

1. 설정 `NPC_GENERAL_PACK=general_default/v1`이 있을 때만 파일을 읽는다. 기본은 비어 있음 → 일반 팩 없음.
   파일이 없거나 형식 · ID가 틀리면 공급하지 않는다(오류 로그: 설정 값 · 이유 코드).
2. NPC 턴마다 `npc_approval_reviews`의 `(dialogue_pack, general_default, 1)` 기록을 읽어 그 fingerprint의 **G3**가
   `approved`이고 **정책 검사**를 통과할 때만 대사를 쓴다(PM v0.4.13, `npc_contract_v0413.md` §1). 정책 검사 기준이
   PM v0.4.14로 정책 검사(GEN-*)가 구현됐다(`npc_pack_policy_v0414.md`). 고유명 계약 전에는 게시 케이스가 있으면 UNVERIFIED →
   G3가 있어도 대사를 쓰지 않는다. 케이스 승인(`case_content`)은 쓰지 않는다.
3. DB 오류 · 계약을 어긴 행 → 승인 없음(`reply: null`, fail closed).
4. 계산 전(잠금 없음)과 이벤트 확정 트랜잭션(공유 잠금, 케이스 판정 다음)에서 두 번 읽고, 그 사이 철회가 commit됐으면
   다시 계산한다. 확정 중인 턴이 있으면 철회 기록은 그 턴이 끝날 때까지 기다린다.
5. 재전송(같은 `client_event_id`)은 저장 응답이 아니라 **지금** 승인된 팩에서 다시 고른다. 승인이 철회됐으면 null.

일반 팩의 게시 · 중단 상태 계약은 없다. 승인만으로 「게시됨」으로 보지 않도록 공급은 설정으로만 켠다.
멈추는 방법: 승인 철회(다음 요청부터) 또는 설정을 비우고 재시작.

## 3. 현재 승인 상태 (11/3)

- **실제 G1 · G2 · G3 승인 기록 없음.** 개발 DB(`waegok` · `waegok_test`)는 승인 저장소 migration 이전(`c9e1a4b7d2f0`)이라
  `npc_approval_reviews` 테이블도 없다. 운영 DB는 확인하지 않았다(접근 · 변경 승인 없음).
- 테스트의 승인 기록은 격리 테스트 DB에만 넣은 가상 검토자 기록이다. 운영 승인이 아니다.
- 따라서 지금 운영에서 긴급 중단 응답은 `reply: null` + `content_mode: "generic"`이다.

## 4. PM 승인 절차 (선행 조건)

> 11/4 갱신: PM v0.4.13으로 일반 팩은 G3 + 정책 검사만 필요하고, 인증 전 내부 CLI 등록이 허용됐다.
> CLI(`scripts/record_gate_review.py`)와 `actor` 열(Alembic `b3f7c2e9a4d1`)은 `npc_contract_v0413.md` §2를 본다.
> 아래는 11/3 당시 설계 기록이다.

관리자 인증이 아직 없다. `create_gate_review`는 `VerifiedAdmin`만 받고, 이 값은 검증된 인증 의존성만 만들 수 있다
(클라이언트 입력 · 명령줄 인자로 만들지 않는다). 그래서 이번에는 승인 기록을 만들지 않았고, 승인 입력 명령도 구현하지 않았다.

선행 조건:
1. **관리자 인증 방식 결정 · 구현**: 누가 관리자인지(계정 · 권한 저장소)와 어떻게 확인하는지(예: 운영 계정 로그인 + 2단계 인증).
   이 결과로만 `VerifiedAdmin(reviewer=<검증된 신원>)`를 만든다.
2. **대상 DB에 승인 저장소 migration 적용**(현재 head `4b8e1d6a9c27`까지). 운영 DB 변경이므로 별도 승인 필요.
3. **G1 · G2 검토자 결정**: 판정은 G1~G3가 모두 있어야 통과한다. PM 요청은 G3(황미르)만 명시돼 있어 G1 · G2 담당 ·
   기록 방법을 정해야 한다.

승인 입력 명령 설계(미구현, 위 1 이후):
- 내부 CLI만(HTTP 없음). 실행자는 인증 절차로 신원을 확인받고, 그 신원이 `reviewer`로 그대로 기록된다(인자로 이름을 받지 않음).
- 입력: 팩 설정(`general_default/v1`) · 관문(G1/G2/G3) · 결정 · 사유. 명령이 파일에서 fingerprint를 다시 계산해 화면에 보여 주고,
  실행자가 그 값을 직접 다시 입력해 확인해야 기록한다(`GateReviewCreate` → `create_gate_review`).
- 철회는 같은 관문에 `hold` · `rejected`를 `supersedes`로 기록한다(기존 이력 규칙).
- 기록 뒤 `scripts.general_pack_status --db`로 `approval=PASS` 확인 → 설정 `NPC_GENERAL_PACK` 적용 → 재시작.

## 5. FE 공유: NPC 턴 응답 변경 (`POST /api/v1/play-sessions/{id}/npc/turns`)

추가 필드 하나, 기존 필드 변경 · 삭제 없음.

| 필드 | 값 |
|---|---|
| `content_mode` | 정상 `"case"`, 긴급 중단 · NPC 콘텐츠 없음 등이면 `"generic"`(PM v0.4.13, `npc_contract_v0413.md` §4). 11/3 당시에는 정상이 `null`이었다 |

긴급 중단 중 응답:
```json
{"npc_event_id": "…", "reply": {"source": "approved_line", "text": "<승인 원문>", "line_id": "GENERIC_PAUSE_03"},
 "suggest_hint": null, "fallback_reason": "NPC_CONTENT_WITHDRAWN", "content_mode": "generic"}
```
승인 팩이 없으면 `"reply": null`이고 `content_mode`는 그대로 `"generic"`이다(말풍선 없음).
정상 응답은 `content_mode: "case"`다(PM v0.4.13 §4, 11/4 반영).
현재 저장소 FE · 원격 브랜치에서 이 응답을 읽는 코드는 찾지 못했다(11/3 검색).

## 6. 긴급 중단과 Hint API (PM v0.4.6 §3 · v0.4.9 §3)

`GENERIC_PAUSE_04`가 힌트 버튼을 안내한다. Hint API는 게시 상태를 보지 않으므로 차단 뒤에도 기존 세션에서 그대로 쓴다
(코드 변경 없음). 격리 MySQL · 실제 라우터로 확인: 게시 중 생성한 세션 → 차단 → NPC 「잠시 멈춤」 →
같은 세션 힌트 해금 200 · 잔액 차감 · 같은 요청 재전송 시 추가 차감 없음 → 새 세션 생성 409.

## 7. 배포 전 남은 항목

- 관리자 인증 · 승인 입력 명령(§4), 대상 DB migration, G1~G3 실제 승인
- 운영 설정 `NPC_GENERAL_PACK` 적용 여부 결정
- 일반 팩 게시 · 중단 상태 계약(현재는 설정 · 승인 철회로만 제어)
- 정상 응답의 `content_mode`는 `"case"`로 반영(11/4). FE 반영 필요
- 일반 팩 정책 검사 기준(PM 확인 필요). 정해지기 전에는 G3가 있어도 일반 팩을 쓰지 않는다
- 다중 워커: 공식 팩은 프로세스마다 파일에서 읽는다(같은 파일이면 같은 결과). 승인은 매 요청 DB에서 읽는다.
