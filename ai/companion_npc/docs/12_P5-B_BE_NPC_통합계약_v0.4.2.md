# P5-B — BE · NPC 통합 계약 (PM 계약 v0.4.2 기준)

> 작성 2026-10-28 · 기준 커밋 `2af9783`(`feat/SJ-ai-npc-integration`) · 상태 **문서만 작성 — 런타임 코드는 바꾸지 않았다**
>
> **표기**
> - **[확정]** PM 계약 v0.4.2 에서 확정된 정책이다. 이 문서는 정책을 새로 만들지 않고 옮겨 적기만 한다.
> - **[확인됨]** 지금 코드가 실제로 그렇게 동작한다(파일 경로 표시 · 읽기 전용 확인).
> - **[제안]** 이 문서의 구현안이다. 계약이 아니다.
> - **[PM 결정 필요]** v0.4.2 에 정해지지 않은 것이다. 정하기 전에는 구현하지 않는다(§8).
>
> 대응표의 판정: **완료** = v0.4.2 대로 동작 · **일부** = 일부만 있거나 연결되지 않음 · **미구현** = 없음 · **충돌** = 지금 동작이 v0.4.2 와 반대.
>
> 관련 문서: `docs/09`(P5 연동 준비) · `docs/11`(P5-A 상호작용 설계 초안 v2). `docs/11` 의 일부 제안(NPC 가 승인 힌트 원문을 들고 있는 구조)은 v0.4.2 와 다르다 — §2.3 참고.

## 1. 확정 정책 [확정]

### 1.1 NPC 일반 대화

| # | 정책 |
|---|---|
| C1 | AI 생성을 허용하는 범위: 인사 · 동행 반응 · 분위기 · **이미 공개된 사실** |
| C2 | 모델 입력은 공개된 `model_context` 만 쓴다 |
| C3 | 생성 대사 전체를 검사한다: NG · U 단정 · 미공개 단서 · 미공개 힌트 · **모든 퍼즐의** 정답 문자열 |
| C4 | 정책 검사에 실패하면 **승인된 대체 대사**를 쓴다 |
| C5 | 퍼즐 풀이 질문에는 AI 생성 응답을 하지 않는다 |
| C6 | `nudge` 는 승인된 `line_id` 의 원문만 쓴다 |
| C7 | 정식 힌트와 재열람은 `server.json` 원문을 그대로 쓴다 |
| C8 | 응답에 `reply.source` 를 넣고, 필요하면 `line_id` 를 함께 넣는다 |
| C9 | 생성 여부와 정책 검사 결과를 기록한다 |
| C10 | 생성 기능 스위치는 기본 OFF. 운영에서 켜기 전에 사람이 검수한다 |

### 1.2 개입 · 힌트

| # | 정책 |
|---|---|
| I1 | `intervention_level`(0~2)은 NPC 의 행동 판단용이다 |
| I2 | `hint_level`(0~2)은 BE 의 해금 상태다. I1 과 다른 값이며 서로 바꿔 쓰지 않는다 |
| I3 | NPC 판단으로 힌트 단계를 바꾸지 않는다 |
| I4 | NPC 는 Hint API 를 자동으로 부르지 않는다 |
| I5 | 가장 강한 개입도 nudge 또는 힌트 안내까지만 한다 |
| I6 | 힌트 재열람에는 플레이어 요청과 서버의 해금 확인이 **둘 다** 필요하다 |

### 1.3 콘텐츠

| # | 정책 |
|---|---|
| K1 | 정식 힌트 원문은 `server.json` 에만 있다 |
| K2 | `npc.json` 의 hints 는 단계 참조만 담는다 |
| K3 | nudge 는 `npc.json` 에 두고 G3 승인이 필요하다 |

### 1.4 게시 승인

| # | 정책 |
|---|---|
| P1 | G1~G3 승인 이력은 append-only 다 |
| P2 | 현재 fingerprint 와 같은 기록만 판정에 쓴다 |
| P3 | `reviewed_at` 최신순, 같으면 기록 ID 순으로 최종 판정을 정한다 |
| P4 | 세 관문이 모두 최종 승인일 때만 PASS |
| P5 | 반려 · 보류 · 수정 요청 · 상위 단계 이관은 FAIL |
| P6 | 같은 해시에서 반려 뒤 재승인하려면 사유가 필수다 |
| P7 | 최종 `published` 전환은 게시 담당 PM 이 한다 |

## 2. 현재 구현 대응표 [확인됨]

경로: BE 는 `backend/app/` 기준, NPC 는 `ai/companion_npc/src/companion_npc/` 기준.

### 2.1 확인한 모듈의 현재 상태

| 모듈 | 지금 하는 일 | 연결 상태 |
|---|---|---|
| P3 개입 판단 `training/policy.py` · `training/p3b.py` | 점수 ≥ threshold · cooldown · 세션 / 퍼즐 상한으로 개입 여부만 정한다. 실험 평가용 | 오프라인 실험만. 런타임 연결 없음 |
| NPC 발화 `speech/pipeline.py` `speak()` | check_in · clarify 는 승인 템플릿만. nudge · hint 는 NPC 팩의 `ApprovedHint` 원문을 근거로 **생성기(LLM 가능)가 바꿔 말한다** → 검증 → 실패 시 템플릿 대체 → 그것도 실패 시 보류 | 실험 환경 안에서만 |
| NPC 검증 `speech/guard.py` `SpeechGuard` | 정답 · 별칭(모든 퍼즐) · 내부 ID · 미공개 지식 조각 · 근거 없는 문장 검사 | 실험 환경 |
| BE NPC `services/npc.py` `process_npc_request()` | `nudge`: 승인된 line_id 원문을 돌려준다. `hint_reshow`: 서버 `hint_levels` 가 요청 단계 이상일 때 원문을 돌려준다. 이벤트 한 줄만 쓰고 상태는 바꾸지 않는다 | **라우터 미등록** |
| BE 공개 조건 `services/npc_reveal.py` | `reveal_when` 평가기 | 콘텐츠 **문법 검사에만** 쓰인다. 대사를 내줄 때는 쓰지 않는다 |
| BE 힌트 `services/hint.py` `unlock_hint()` | `hint_levels` 를 바꾸는 유일한 곳. 한 단계씩만 연다. 원문 위치 · 접근 조건은 주입식 | **라우터 미등록** |
| BE 게시 `services/publication_gate.py` | fingerprint · 교차 검증 · NPC 콘텐츠 · 누출 · NG · 승인을 묶어 판정하고, 통과하면 `PinnedContentStore` 에 등록 | HTTP · 파일 로더에 미연결 |
| BE 고정 콘텐츠 `services/pinned_content.py` `line_source()` | 고정 버전의 `npc.json` 에서 nudge 를 찾는다. v0.1 은 **늘 `approved=False`** 로 돌려준다 | 그래서 지금은 어떤 nudge 도 내보낼 수 없다 |
| 응답 스키마 | NPC `NpcUtterance`(`decision.npc_hint_level` · `speech` · `generation.method` · `safety`) / BE `NpcProcessResult`(`npc_event_id` · `result` · `line{line_id,text}` · `reshown_hint`) | 두 스키마는 서로 연결되어 있지 않다 |
| 기록 · 스위치 | NPC: `NpcContext.limits.allow_llm=False` 기본 · `speech/records.py` 실험 기록(원문은 `runs/restricted/`) / BE: `NpcEventRecord`(원문 없이 결과 · line_id · 단계) | BE 에 생성 스위치 · 생성 기록 없음(생성 경로 자체가 없다) |

### 2.2 정책별 대응

| # | 정책 | 판정 | 근거 (지금 코드) |
|---|---|---|---|
| C1 | 일반 대화 AI 생성 허용 | **미구현 · 충돌** | NPC 는 check_in · clarify(일반 대화에 가까운 유형)를 **템플릿만** 쓰고(`pipeline.py` "check_in · clarify 는 승인 템플릿에서만"), 거꾸로 nudge · hint 를 생성한다. BE 에는 생성 경로가 없다 |
| C2 | 공개된 `model_context` 만 입력 | **일부** | `speech/payload.py` `to_model_input()` 이 ID · label_map 을 빼고 보낸다. 다만 승인 힌트 원문 · 지식 조각 · 플레이어 메시지가 들어간다. `model_context` 라는 계약 · 공개 범위 정의는 없다 |
| C3 | 생성 대사 전체 검사 | **일부** | NPC `SpeechGuard`: 모든 퍼즐 정답 · 별칭 · 내부 ID · 미공개 지식 조각 · 근거 없는 문장. **NG · U 단정 검사 없음.** 미공개 힌트는 지식 조각 겹침으로만 간접 검사. BE `_ensure_no_protected_text()` 는 nudge · 재열람 원문에 정답 · 다른 퍼즐 힌트 원문 포함 여부를 본다(생성 대사용이 아님) |
| C4 | 실패 시 승인된 대체 대사 | **일부** | NPC: 승인 템플릿으로 대체 → 재검증 → 실패 시 보류. 템플릿은 NPC 팩(`npc.json` 초안)에 있고 BE 승인 절차를 거치지 않는다 |
| C5 | 풀이 질문에 생성 금지 | **미구현 · 충돌** | 풀이 질문을 가려내는 단계가 없다. 플레이어 도움 요청은 nudge · hint 로 가고, `allow_llm` 이면 LLM 이 생성한다 |
| C6 | nudge = 승인 line_id 원문 | **BE 일부 · NPC 충돌** | BE `_resolve_nudge()` 는 원문 그대로 · 승인 · 유형 · 퍼즐 범위를 확인한다(완료). 그러나 `line_source()` 가 늘 미승인이라 실제로는 못 내보낸다. NPC 는 nudge 를 **생성**한다(line_id 없음) |
| C7 | 힌트 · 재열람 = server.json 원문 | **BE 일부 · NPC 충돌** | BE 재열람은 `hint_source` 원문을 그대로 돌려준다. 하지만 `PuzzleDefinition` 에 힌트 필드가 없고 `extra="forbid"` 라 지금 server.json 에 힌트를 넣으면 검증 오류다(필드 위치 미정). NPC 는 `npc.json` 의 `ApprovedHint.text` 를 근거로 바꿔 말한다 |
| C8 | `reply.source` · `line_id` | **미구현** | 두 응답 스키마 모두 `reply.source` 가 없다. BE 는 `line.line_id` 만 있다. NPC 는 `generation.method` 로 생성 방식만 남긴다 |
| C9 | 생성 여부 · 검사 결과 기록 | **일부** | NPC 실험 기록에는 있다(`records.py` · `NpcUtterance.generation` · `safety`). BE `NpcEventRecord` 에는 생성 여부 · 검사 결과 칸이 없다 |
| C10 | 스위치 기본 OFF · 사람 검수 | **일부** | NPC `allow_llm=False` 기본(완료). BE 운영 스위치 · 검수 절차 없음 |
| I1 | `intervention_level` 0~2 | **일부** | 같은 눈금이 `NpcHintLevel`(0 없음 · 1 주의 환기 · 2 방향 제시)로 있다. 이름이 `npc_hint_level` 이라 I2 와 헷갈린다. 개명 필요 |
| I2 | `hint_level` 분리 | **완료** | BE `hint_levels` 와 NPC 값은 다른 필드 · 다른 타입이다. `contracts/common.py` 에 "다른 축" 주석(통합 커밋 `136dd2b`) |
| I3 | NPC 가 단계를 바꾸지 않음 | **완료** | BE `process_npc_request()` 는 `state_json` 을 쓰지 않고 `state_changes` 는 늘 빈 목록(`max_length=0`). NPC 실험 환경은 BE 상태를 쓰지 않는다 |
| I4 | Hint API 자동 호출 금지 | **완료(한계 있음)** | BE NPC 서비스는 `unlock_hint()` 를 부르지 않는다. `trigger="auto_help_offer"` 재열람은 거부. NPC 코드에는 BE 호출이 없다. 단, `trigger` 는 클라이언트 값이라 인가 근거가 아니다 |
| I5 | 가장 강한 개입 = nudge · 힌트 안내 | **충돌** | NPC `KIND_LEVEL["hint"]=2` 가 자동 개입(`initiator="auto"`)에서도 승인 힌트 **내용**을 말한다. 「힌트 안내」(힌트가 있음을 알려 줌)라는 유형이 없다 |
| I6 | 재열람 = 플레이어 요청 + 서버 해금 | **일부** | 서버 해금 확인은 완료(`_current_hint_level() < hint_level` 이면 거부). 플레이어 요청은 증명하지 못한다(`trigger` 는 기록용) |
| K1 | 힌트 원문은 server.json 에만 | **일부** | BE 설계 · 주석은 그렇다(`schemas/npc_content.py`). server.json 필드 미정(C7). NPC `ApprovedHint.text` 가 원문을 들고 있다(충돌) |
| K2 | `npc.json` hints = 단계 참조 | **BE 완료 · NPC 충돌** | BE `NpcHintLevelRef{level}` 만 받고 `text` 는 거부. NPC 초안 `contracts/npc_content.py` 는 승인 힌트 · 템플릿 · 지식 조각을 담는다 |
| K3 | nudge 는 npc.json · G3 | **일부** | BE `NpcNudgeContent`(line_id · text · reveal_when) 있음. G3 판정은 게시 게이트에만 있고 `line_source()` 는 늘 미승인 |
| P1 | append-only 이력 | **미구현** | 승인 기록 저장소가 없다. `approval_source` 를 주입받고, 없으면 FAIL(기본 거부) |
| P2 | 현재 fingerprint 기록만 | **완료** | `_approval_check()` 가 다시 계산한 fingerprint 와 같은 `target_hash` 만 본다 |
| P3 | `reviewed_at` 최신 · 기록 ID 순 | **충돌** | 같은 해시에 승인 · 반려가 함께 있으면 **최종을 고르지 않고 FAIL**(`conflicting decisions`). `ApprovalRecord` 에 기록 ID 가 없고 시각 필드 이름은 `decided_at` |
| P4 | 세 관문 모두 최종 승인 | **완료** | G1 · G2 · G3 각각 승인 기록이 있어야 PASS |
| P5 | 반려 · 보류 · 수정 요청 · 이관 = FAIL | **일부** | `decision` 이 `approved` · `rejected` 둘뿐이다. 나머지 셋은 표현할 수 없다 |
| P6 | 반려 뒤 재승인 사유 | **미구현** | 사유 필드 없음. 지금은 반려 뒤 재승인이 늘 `conflicting decisions` 로 FAIL |
| P7 | PM 이 published 전환 | **미구현** | JSON 의 `status` 는 신뢰하지 않는다(완료). 게이트를 통과하면 바로 저장소에 등록한다. PM 전환 단계 · 주체 기록이 없다 |

### 2.3 이전 문서와 다른 점

- `docs/11` §0 MVP 의 「승인 힌트 **원문**」을 NPC 가 들고 보여 주는 구조 → v0.4.2 에서는 원문이 server.json 에만 있고, 재열람은 BE 가 한다(K1 · C7).
- `docs/09` 의 우선 후보 「A군 선택형(승인 힌트 문장 + 여는 말 · 맺는 말)」은 **nudge · 힌트에는 쓸 수 없다**(C6 · C7). 일반 대화(C1)에 적용할지는 §8.
- P4 실험(GPT 바꿔 말하기 비교)의 결과는 **nudge · 힌트 운영 방식으로 쓰이지 않는다**. 실험 결과 · 비용 장부는 기록으로 남긴다(고치지 않는다).

## 3. BE · NPC 입력 · 출력 계약 [제안]

### 3.1 구조

```
FE ──(플레이어 행동 · 말 걸기 · 도움 요청)──▶ BE
BE: 세션 상태(state_json) · 고정 콘텐츠(pinned) · 해금 상태(hint_levels) 를 가진다
 ├─ ① 판단 요청 ─▶ NPC 판단층(P3): intervention_level · 유형만 돌려준다
 ├─ ② 일반 대화(생성 스위치 ON 일 때만) ─▶ NPC 발화층: model_context → 생성 → 정책 검사
 │                                         실패 → BE 가 승인 대체 대사로 바꾼다
 ├─ ③ nudge  ─▶ BE 가 승인 line_id 원문을 고른다(생성 없음)
 └─ ④ 재열람 ─▶ BE 가 해금 확인 뒤 server.json 원문(생성 없음)
BE ──(reply{source, text, line_id?})──▶ FE
```

- NPC 는 **판단(①)과 일반 대화 생성(②)** 만 한다. ③ · ④ 의 문장은 NPC 를 거치지 않는다.
- 정책 검사(C3)는 서버에서 한다. 정답 · 미공개 정보는 서버를 떠나지 않는다.

### 3.2 판단 요청 (BE → NPC 판단층)

| 필드 | 내용 |
|---|---|
| 입력 | 지금 `NpcContext` 의 관측 가능한 값(`state` · `recent_interactions` · `npc_history` · `timing` · `focus`) |
| 출력 | `intervention_level`(0~2) · 제안 유형(`none` · `check_in` · `nudge` · `hint_guidance`) · `reason_code` · 대상 퍼즐(선택) |
| 금지 | `hint_level` 을 읽어 바꾸거나 Hint API 를 부르는 동작(I3 · I4). 출력은 「무엇을 할지 제안」뿐 |

`hint_guidance` 이름 · 문구는 §8 결정 사항이다(I5 「힌트 안내」의 정의).

### 3.3 일반 대화 생성 요청 (BE → NPC 발화층)

| 필드 | 내용 |
|---|---|
| `model_context` | **공개된 것만**: 페르소나 · 현재 구역 공개 설명 · 이미 공개된 사실 · 최근 NPC 발화(문장 없이 유형) · 플레이어 메시지(정리 후). 정답 · 힌트 원문 · 미공개 조각 · 내부 ID 없음. 정확한 필드 목록은 §8 |
| `purpose` | `greeting` · `companion_reaction` · `ambience` · `public_fact` (C1 범위) |
| 응답 | `draft_text` · `model` · `latency_ms` (생성 실패 시 오류 코드) |

### 3.4 응답 (BE → FE)

```json
{
  "npc_event_id": "<uuid>",
  "reply": {
    "source": "<PM v0.4.2 확정 값 — §8.1 D8>",
    "text": "<표시할 문장>",
    "line_id": "NUDGE_… (nudge · 대체 대사일 때)"
  },
  "reshown_hint": null
}
```

- `reply.source` 의 값 목록은 PM v0.4.2 에서 확정됐다(§8.1 D8). 값은 계약 원문을 따르며 이 문서에는 아직 옮겨 적지 않았다. 구현 전에 원문 값을 여기에 옮긴다.
- 재열람은 지금 BE 처럼 `reshown_hint` 로 따로 두고 대사와 섞지 않는다(기존 `NpcProcessResult` 방침 유지).

### 3.5 기록 (C9)

`NpcEventRecord` 에 더할 칸 [제안]: `reply_source` · `line_id` · `generated`(bool) · `policy_check`(`passed` · `failed` · `not_run`) · 실패 사유 코드 · 생성 모델 이름. **원문은 넣지 않는다**(기존 방침). 원문 보존 여부 · 기간은 §8.

## 4. 서버 권한과 AI 권한의 경계

| 할 수 있는 쪽 | 서버(BE) | NPC AI |
|---|---|---|
| 정답 판정 · 퍼즐 완료 · 단서 획득 | ○ | × |
| `hint_level` 변경(해금) | ○ (`unlock_hint()` 만, 플레이어 요청) | × (I3 · I4) |
| 힌트 원문 보관 · 재열람 | ○ (server.json · 해금 확인) | × (K1 · C7) |
| nudge 원문 선택 · 반환 | ○ (승인 line_id) | × 문장 생성 금지 (C6). 어떤 nudge 가 좋을지 **유형 제안**만 |
| 개입할지 · 얼마나 | 최종 결정(상한 · 스위치 · cooldown) | `intervention_level` 제안 |
| 일반 대화 문장 | 정책 검사 · 대체 대사 결정 · 기록 | 생성(스위치 ON 일 때만, `model_context` 만 보고) |
| 퍼즐 풀이 질문 응답 | 고정 응답 · 힌트 기능 안내 | × 생성 금지 (C5) |
| 콘텐츠 승인 · 게시 | 게이트 판정 · PM 전환 기록 | × |
| 정답 · 별칭 · 미공개 정보 열람 | ○ (검사용) | × (`model_context` 밖) |

## 5. 기존 구현에서 수정해야 할 파일 [제안]

### 5.1 BE (`backend/`)

| 파일 | 수정 내용 | 관련 정책 |
|---|---|---|
| `app/schemas/puzzle_runtime.py` | 정식 힌트 원문 필드(위치 · 형식은 §8) | K1 · C7 |
| `app/services/pinned_content.py` | `hint_source()` 에 쓸 resolver, `line_source()` 의 G3 승인 반영(늘 미승인 해제) | C6 · K3 |
| `app/schemas/npc.py` | `reply{source,text,line_id}` 응답 · 일반 대화 요청 · 기록 칸 추가 | C8 · C9 |
| `app/services/npc.py` | 일반 대화 경로(스위치 · 정책 검사 · 대체 대사) · `reveal_when` 을 대사 반환 시 적용 · 풀이 질문 분기 | C1~C5 · C10 |
| `app/services/npc_reveal.py` | (평가기 자체는 유지) 런타임 호출 지점 추가 | C3 미공개 단서 |
| `app/services/publication_gate.py` | `ApprovalRecord` 에 기록 ID · `reviewed_at` · 결정 5종 · 사유 · `_approval_check()` 를 최신 기록 판정으로 · PM 게시 전환 분리 | P1~P7 |
| `app/schemas/npc_content.py` | 승인 대체 대사 보관 방식(§8) | C4 |
| `app/api/v1/` (신규 라우터) | NPC · Hint 경로 등록(계약 확정 뒤) | — |
| `alembic/versions/` (신규) | 승인 기록 저장소(append-only) · NPC 이벤트 칸 | P1 · C9 |

### 5.2 NPC (`ai/companion_npc/`)

| 파일 | 수정 내용 | 관련 정책 |
|---|---|---|
| `src/companion_npc/contracts/common.py` · `npc_utterance.py` · `npc_context.py` | `NpcHintLevel` · `npc_hint_level` → `intervention_level` 개명(값 0~2 유지) | I1 · I2 |
| `src/companion_npc/speech/pipeline.py` | nudge · hint 생성 경로 제거(BE 원문 사용), 일반 대화 생성 경로 추가, 자동 개입 상한을 힌트 안내로 | C1 · C5~C7 · I5 |
| `src/companion_npc/speech/guard.py` | NG · U 단정 검사 연결(주입식), 미공개 힌트 검사 | C3 |
| `src/companion_npc/speech/payload.py` | `to_model_input()` → `model_context`(공개 필드만) | C2 |
| `src/companion_npc/contracts/npc_content.py` · `adapters/npc_merge.py` | NPC 초안 `.npc.json` 을 BE `npc-pack 0.1` 로 맞춘다(힌트 원문 제거) | K1 · K2 |
| `tests/` | 위 변경에 맞는 테스트(§7). 기존 실험 재현 테스트는 판을 나눠 보존 | — |

- 기존 실험(P3 · P4)의 설정 · 결과 · 비용 장부 · 합성 데이터는 고치지 않는다. 바뀐 경로는 새 판 번호로 분리한다.

## 6. 단계별 구현 순서 [제안]

| 단계 | 내용 | 끝났다고 보는 기준 |
|---|---|---|
| 0 | §8 PM 결정 | 결정 기록 |
| 1 | 이름 분리: `intervention_level` 개명 (BE 변경 없음) | I1 · I2 테스트 · 기존 실험 재현 유지 |
| 2 | 콘텐츠 계약: server.json 힌트 필드 · NPC `.npc.json` 을 BE 형식으로 | K1 · K2 · 힌트 원문이 npc.json 에 없음 |
| 3 | 게시 승인: append-only 저장소 · 최신 판정 · 결정 5종 · 사유 · PM 전환 | P1~P7 테스트 |
| 4 | nudge · 재열람 운영 경로: `line_source()` G3 반영 · `reveal_when` 적용 · `reply.source` · 기록 | C6 · C7 · C8 · C9 · I6 |
| 5 | 판단층 연결: P3 출력 → BE 결정(상한 · cooldown) · 힌트 안내 | I3 · I4 · I5 |
| 6 | 일반 대화 생성(스위치 OFF 로 배포): `model_context` · 정책 검사 · 대체 대사 · 풀이 질문 차단 | C1~C5 · C10 |
| 7 | 사람 검수 뒤 스위치 ON 판단 | C10 |

LLM 이 없어도 1~5 단계로 nudge · 재열람 · 개입은 동작해야 한다(기능 끄기 원칙, `docs/11` §9).

## 7. 검증해야 할 테스트 [제안]

| 정책 | 테스트 |
|---|---|
| C1 · C5 | 풀이 질문이면 생성기를 한 번도 부르지 않는다(호출 횟수 0) · 허용 목적만 생성 |
| C2 | `model_context` 에 정답 · 별칭 · 힌트 원문 · 미공개 조각 · 내부 ID 가 없다(모든 Case · 모든 상태) |
| C3 | NG · U · 미공개 단서 · 미공개 힌트 · **다른 퍼즐** 정답이 섞인 생성 대사가 모두 막힌다 |
| C4 | 검사 실패 → 승인 대체 대사 · 대체 대사도 검사 · 둘 다 실패 시 보류 |
| C6 | 응답 nudge 문장 == 승인 line_id 원문(바이트 같음) · 미승인 · 범위 밖 line_id 거부 |
| C7 · I6 | 재열람 문장 == server.json 원문 · 해금 단계 미만 거부 · `auto_help_offer` 거부 |
| C8 · C9 | 모든 응답에 `reply.source` · nudge · 대체 대사에 `line_id` · 기록에 생성 여부 · 검사 결과 · 원문 없음 |
| C10 | 스위치 OFF 면 생성기 호출 0 · 응답은 승인 대사만 |
| I2 · I3 · I4 | NPC 처리 전후 `hint_levels` 동일 · NPC 경로에서 `unlock_hint()` 호출 0 |
| I5 | 자동 개입 응답에 힌트 원문이 없다 |
| K1 · K2 | `npc.json` 에 힌트 `text` 가 있으면 검증 오류(BE 는 이미 있음) · NPC 쪽도 같은 판정 |
| P2~P6 | 같은 해시: 승인 → 반려(최신) FAIL · 반려 → 재승인(사유 있음, 최신) PASS · 사유 없음 FAIL · 동률 시 기록 ID 순 · 보류 · 수정 요청 · 이관 FAIL · 다른 해시 기록 무시 |
| P1 · P7 | 기록 수정 · 삭제 불가 · PM 전환 전에는 세션 고정 대상이 아님 |
| 회귀 | BE 1071 · NPC 352 기존 테스트 · `case_001` VALID · compat · navigation 계약 · 실험 입력 해시 불변 |

## 8. PM 결정 사항

### 8.1 확정됨 [확정]

처음 정리할 때는 미확정으로 두었다가 PM v0.4.2 에서 확정된 것으로 확인된 항목이다. 확정 **내용**은 PM 계약 원문을 따른다.
원문을 이 문서에 아직 옮겨 적지 않았으므로, 구현 전에 원문 값을 여기에 옮긴다(이 문서가 내용을 지어 넣지 않는다).

| # | 항목 | 상태 |
|---|---|---|
| D4 | NPC 재열람으로 `hint_level` 2(정답 보기) 단계 원문도 다시 보여 줄 수 있는가 | 확정 — 내용은 v0.4.2 원문 |
| D8 | `reply.source` 값 목록과 이름 | 확정 — 값은 v0.4.2 원문 |

### 8.2 PM 결정 필요 [PM 결정 필요]

v0.4.2 에 정해지지 않았거나 해석이 둘 이상인 것이다. 이 문서는 어느 쪽도 정하지 않았다.

| # | 항목 | 왜 필요한가 |
|---|---|---|
| D1 | 「퍼즐 풀이 질문」 판정 기준 · 판정 주체(규칙 · 분류기) · 애매할 때의 기본값 | C5 를 구현하려면 질문을 가려야 한다 |
| D2 | 풀이 질문에 대한 응답 문장(고정 안내? 힌트 기능 안내?) | C5 에서 생성 대신 무엇을 보일지 |
| D3 | 「힌트 안내」의 정의 · 문구 · 승인 경로 | I5 의 가장 강한 자동 개입 |
| D5 | `model_context` 필드 목록 · 「이미 공개된 사실」의 범위(획득 단서 요약 · 구역 설명 · 대화 기록 포함 여부) | C1 · C2 |
| D6 | NG · U 단정 판정 기준 · 판정기 | C3. BE 게이트도 `ng_checker` 가 없으면 UNVERIFIED |
| D7 | 승인 대체 대사의 저장 위치(`npc.json` 의 새 항목?) · 승인 관문(G3?) | C4 |
| D9 | 생성 원문 로그의 보존 여부 · 기간 · 열람 권한 | C9 · 기존 실험의 7일 수동 정리와 같은지 |
| D10 | 생성 기능 스위치의 단위(전역 · 케이스 · 세션 · 사용자) · 사람 검수 범위 · 승인자 | C10 |
| D11 | 플레이어 요청을 서버가 어떻게 확인하는가(FE 버튼 이벤트만으로 충분한가) | I6 |
| D12 | `intervention_level` 0~2 각 값의 정의 — 지금 NPC 의 0 없음 · 1 주의 환기 · 2 방향 제시를 그대로 쓰는가 | I1 |
| D13 | server.json 힌트 필드의 위치 · 형식 | K1 · C7 |
| D14 | 승인 기록 형식: 기록 ID 형식 · 결정 값 이름(보류 · 수정 요청 · 이관) · 사유 필드 · 저장소 | P1 · P3 · P5 · P6 |
| D15 | PM 게시 전환의 방법 · 기록(누가 · 언제) · 게이트 통과와 전환 사이에 내용이 바뀌면 | P7 |
| D16 | 생성 모델 제공자 · 외부 전송 동의 · 비용 · 호출 상한 · 지연 시간 기준 | C1(운영). `docs/09` §3 미결정 항목과 같다 |
| D17 | `reveal_when` 을 nudge 반환 때 적용할지(지금은 문법 검사만) | C3 미공개 단서 |
