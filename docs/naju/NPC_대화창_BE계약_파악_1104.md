<!-- 2026-11-04 파악 문서(구현 전). BE 계약 v0.1(세진, 기준 코드 339c344)을 FE 코드·UX 설계안·퍼즐 진행표와 대조한 결과. 계약서 원문은 BE 공유 브랜치에서 받는다. -->

# NPC 대화창 BE 계약 v0.1 파악 문서 (FE · 해랑용)

- 작성 2026-11-04 · 대상 브랜치 `feat/랑-화풍-나주톤` @ `41a3225` (origin 과 동일 — **푸시 완료 상태 확인함**, `git status -sb` 가 `...origin/feat/랑-화풍-나주톤` 과 어긋남 없음)
- 계약서 원본: `/Users/rangkkuku/Downloads/npc_fe_dialogue_ui_contract_v0.1.md` (「NPC 대화창 FE · BE 연동 계약 v0.1 (11/4)」, 기준 코드 `339c344` = `origin/feat/SJ-npc-pack-policy-v0414-1104`). 아래 「계약 §n」 은 이 파일의 절 번호다.
- 이 문서는 파악만 한다. 코드·설계안·idmap 은 고치지 않았다.

---

## 1. 계약 핵심 10줄

1. **세션은 `content_version` 고정이어야 NPC 가 돈다.** `POST /api/v1/play-sessions` 에 `content_version` 을 생략한 레거시 세션은 NPC 턴이 늘 `409 CASE_VERSION_UNAVAILABLE` (계약 §2 L30). 지금 FE 의 `case_001` 흐름은 버전이 없다.
2. **`reply: null` 이 기본이다.** 승인 대사가 없으면 `null` 이 정상 응답이고, 말풍선·타이핑·오류 토스트를 띄우지 않으며 **FE 가 대사를 지어내지 않는다** (§4.2 L100, §4.3 L117).
3. **모드는 `content_mode`(`case`|`generic`, 항상 있음), 사유는 `fallback_reason`(5값|null)** 으로만 읽는다. `reply` 유무로 모드를 추측하지 말 것 (§4 L70, §4.1 L95).
4. **`client_event_id` = 사용자 행동 1회에 UUID 1개.** 응답을 못 받아 다시 보낼 때는 같은 ID·같은 본문. NPC 는 UUID 형식 필수, Hint 는 1~36자. 같은 ID 에 다른 본문이면 409 → 버그로 기록, 재발급 금지 (§5 L125, §6 L134-139).
5. **`suggest_hint{hint_ref}` ≠ 해금.** NPC 는 힌트를 권하기만 하고, 플레이어가 수락하면 FE 가 `POST …/hints {hint_ref, target_level: 1}` 을 부른다. 힌트 원문은 Hint API 응답 `hint.text` 로만 (§1 L19, §8, §9 L203).
6. **힌트 3단계 대응(PM v0.4.15 확정):** 1단계 = 넛지(`/npc/turns`, 무료) · 2단계 = 정식 힌트 level 1 · 3단계 = 정식 level 2(정답). 별도 3단계 API 는 없다. level 1 성공 응답의 `result.puzzle_id` 로 2단계 버튼을 `puzzle_id` 경로로 연다 (§9.1 L208-217, §8 L189).
7. **오류 처리:** 404 → 세션 재생성 · 409 `CASE_VERSION_UNAVAILABLE` → NPC UI 비활성(게임 계속, 재시도 무의미) · 500 `NPC content is unavailable.` → NPC 비활성+보고 · 422 는 `detail` 배열. 서버 영문 문장을 화면에 그대로 내지 않는다. 네트워크·502+ 만 같은 본문으로 재시도(예시 최대 2회) (§5, §10 L293).
8. **`auto` 턴** 은 「끼어들어도 되는 순간」의 점검 턴. 개입 여부는 서버가 정하고(연속 `input` 오답 6회 · 무입력 240초 · 쿨다운 180s · 퍼즐당 2회 — `339c344:backend/app/services/npc_decision.py:48-55`), **호출 주기 계약 없음·과호출 금지**(구역 진입·오답 직후·일정 무입력 뒤 1회) (§3 L56-57). `message` 를 넣으면 422.
9. **`focus_object_id`** = 플레이어가 보고 있는 현재 구역 Object 의 런타임 ID(1~64자). 퍼즐 ID 아님. **`auto` 턴의 대상 퍼즐을 정할 때만** 쓰고 `player_message` 판정엔 안 쓴다(재시도 동일성 비교에는 포함) (§3 L44, §13 L374).
10. **긴급 중단(`generic` + `NPC_CONTENT_WITHDRAWN`)** 이어도 게임·힌트 버튼은 유지. 숨기는 건 케이스 대사·NPC 힌트 제안 UI 뿐. Hint API 는 중단 중에도 동작 (§4.1 L91·L96, §12 L355).

---

## 2. FE 현재 코드와의 간극

| # | 항목 | 지금 코드(파일:줄) | 계약 요구 | 고칠 것 |
|---|---|---|---|---|
| 1 | 세션 생성 본문 | `src/server/api.ts:141-145` — `{anonymous_session_id, case_id}` 만 보냄. 호출 쪽 `src/server/playSession.ts:19-25` `PLAY_CONTRACT.caseId = "case_001"` 고정 | §2: `content_version` 필수(없으면 NPC 턴 409) | `createPlaySession(anonymousSessionId, caseId, contentVersion)` 로 시그니처 확장. 나주용 `caseId`·버전 상수를 `PLAY_CONTRACT` 와 별도로 둔다 |
| 2 | 409 처리 | `playSession.ts:177-180` — `createFreshPlaySession` 은 404·410 만 삼키고 나머지는 `throw` → `prepareFailed` | §2·§5: `CASE_VERSION_UNAVAILABLE` 은 「NPC 비활성·게임 계속」, 세션 재생성 아님 | 버전 고정 세션에서 온 409 는 `npcEnabled=false` 분기. 레거시 세션(버전 없음)일 때만 새 세션 |
| 3 | 세션 보관 레코드 | `playSession.ts:77` `GUEST_PLAY_KEY = "kgeseo.guest-play.v1"` (anonymousSessionId·playSessionId·caseId) | 버전 고정 세션만 NPC 가능 | `GuestPlayRecord` 에 `contentVersion` 추가, `caseId+contentVersion` 이 같을 때만 복원. 버전 없는 옛 레코드는 NPC 용으로 재사용 안 함 |
| 4 | 나주 ↔ 서버 연결 | `naju01/src` 에 `@/server`·`playSession` import **0건** (grep 확인). 세션 시작은 `?dev` 전용 `src/server/PlaySessionStatusPanel.tsx` 와 본편 소화전(`src/station/areas/CorridorCabinets.tsx:7,192`)뿐. `src/app/App.tsx:90-101` 은 `?dev` 일 때만 lazy 로드 | NPC·Hint 둘 다 `play_session_id` 가 경로에 필요 | `naju01/src/app` 에 부팅 지점: `startPlaySession(najuCaseId, contentVersion)` 호출, `usePlaySession` 으로 id 읽기. `@` → `../src` 별칭은 이미 있음(`naju01/tsconfig.json:4`, `naju01/vite.config:67`) |
| 5 | 번들 검증 | `playSession.ts:155-166` `assertBundle` — `case_001` 이면 소화전 자물쇠 Object 를 확인 | 나주 케이스에는 해당 없음 | `caseId !== PLAY_CONTRACT.caseId` 면 이미 통과(`:159`). 나주 전용 검증은 따로(entry_zone·호스트 Object 존재) |
| 6 | NPC·Hint 호출 함수 | `src`·`naju01/src` 에 `/npc/turns`·`/hints`·`hint_ref`·`target_level`·`content_version` 문자열 **0건**. 서버 호출은 `submitInteraction`(`api.ts:148-152`) 하나 | §3·§7 두 엔드포인트 | `sendNpcTurn`·`unlockHint` 를 `api.ts` 에 추가. 별칭 `/puzzles/{id}/hints` 는 쓰지 않음(§7 L183) |
| 7 | 재시도·ID 동결 | `playSession.ts:265-273` — `client_event_id: crypto.randomUUID()` 를 호출 직전에 생성, `api.ts:50-69` `backendRequest` 는 재시도 없음 | §6: 같은 ID·같은 본문 재전송, 네트워크·502+ 만 | `{client_event_id, body}` pending 객체를 동결해 재전송하는 공용 래퍼. Interaction·NPC·Hint 공유 |
| 8 | UUID·타임스탬프 유틸 | UUID 는 `playSession.ts:266` 인라인(+ `naju01/src/review/ReviewBridge.tsx:170` fallback), 타임스탬프 `new Date().toISOString()` 인라인. 공용 유틸 없음(grep `nanoid|makeId|getTimezoneOffset` 0건) | §3: `client_timestamp` 오프셋 없으면 422(`Z` 접미는 오프셋 있음으로 통과 — `339c344:backend/app/schemas/npc_turn.py:34-38 require_timezone` 은 `utcoffset is None` 만 거부) | `src/server/ids.ts` 같은 곳에 `newEventId()`(randomUUID 없으면 getRandomValues v4)·`clientTimestamp()`(ISO, Z 유지) |
| 9 | 오류 본문 보존 | `api.ts:43-47` `readDetail` 이 `String(detail)` → 422 배열·409 객체가 `"[object Object]"`. `api.ts:63-66` 은 `Backend 요청 실패 (status): detail` 을 message 로. `playSession.ts:247,291` 이 그대로 `status.error` 에, `PlaySessionStatusPanel.tsx:33` 이 렌더 | §5 L130: `detail` 문자열/배열/객체로 분기, 영문 노출 금지. §7: `HINT_BALANCE_EMPTY` 등은 `detail.code` | `BackendError.detail` 을 원형(`unknown`)으로 보존, `errorCode(error)` 헬퍼(`detail` 이 문자열이면 그 값, 객체면 `.code`). 대화창은 코드별 한국어 고정 문구만, 영문은 console |
| 10 | 힌트 저장소 | `src/game/hintBox.ts:23-34` 모듈 배열 `hints` + `addHint`. 나주 `HintBoxHud.tsx:7,31` 이 같은 배열. `[H]` 는 `naju01/src/app/useGameHotkeys.ts:53-77` 에서 종이 캔버스를 data URL 로 넣는 FE 로컬 동작 | §7·§9: `hint_levels`·`hint_balance`·`hint.text`·`already_unlocked`, 넛지는 힌트처럼 보이면 안 됨 | 서버 힌트는 `hintBox` 와 **별도 스토어**(퍼즐별 level·text·잔액). 힌트함 UI 에 「서버 힌트」 구획 따로. `PlaySessionState`(`api.ts:95-98`, 현재 `completed_puzzle_ids`·`flags` 뿐)에 `hint_levels` 추가 |
| 11 | focus_object_id 소스 | `naju01/src/puzzles/interaction.ts:10-30` `Interactable.id` 는 `"ridge-knot"`(`TetheredCarriers.tsx:279`)·`"cave-valve"`(`RingDoor.tsx:276`) 같은 자유 문자열. `aimedId()`(`:78`)·`aimedTarget()`(`:135`) 로 읽음. idmap 런타임 id(`OBJ_S1_…`)는 `director.ts:198-204` 의 `${o.name}#${ids[i]}` 키에서 파생 | §3: 현재 구역 Object 런타임 ID, 미매핑이면 전송 차단(idmap `rules.unmapped_local_id`) | 로컬 id → `OBJ_` 어댑터 표를 `naju01` 에 두고, 없으면 `focus_object_id` 생략 + 진단 로그 |
| 12 | 로컬 backend | `backend/app/api/v1` 에 `hints.py` 없음, `backend/app/schemas/npc_turn.py:58-65` `SuggestHintOut.puzzle_id`, `content_mode`·`fallback_reason` 없음. `backend/docs/contracts/hint_api_v0.1.md:5` 「라우터에 등록하지 않았다」 | 기준은 `339c344` | **정정:** 계약 브랜치는 로컬에 없는 게 아니다. `origin/feat/SJ-npc-pack-policy-v0414-1104` 가 remote-tracking 으로 fetch 돼 있고 tip 이 `339c344` 와 일치한다(`git rev-parse`). HEAD 조상은 아니라(`merge-base` 확인) 지금 체크아웃으로는 안 보일 뿐. 연동 시험은 `git worktree add … 339c344` 로 백엔드만 따로 띄운다. 로컬 docs 4개(play_session·hint_api·npc_turn·anonymous_session)는 갱신 전까지 참고 금지 |

---

## 3. UX 설계안(`docs/naju/NPC_대화창_UX_설계안_1104.md`) 수정 목록

설계안은 로컬 옛 스키마(`backend/app/schemas/npc_turn.py:52-65`)를 보고 쓴 것이라 계약 기준 코드와 어긋난다. 절 번호는 설계안 헤딩(§1 L9 … §13 L265) 기준.

| 절 | 지금 설계 | 계약 | 바꿀 내용 |
|---|---|---|---|
| 머리말 L1 · §7 ③ L158 · §12 ② ④ | 로컬 파일:줄 인용(npc_turn.py:52-65 · main.py:62-121 · npc_decision.py:12-17) | 계약 L3·L5 「코드가 기준」 = `339c344` | 머리말에 「API 근거는 origin feat/SJ-npc-pack-policy-v0414-1104 @339c344, 로컬 backend/ 는 옛 스키마」 명기. 인용을 339c344 기준으로 교체 |
| §5 L119 · §7 ③ · §13 L273 | `content_mode` 없다고 보고 어댑터 기본값 generic, 「FE 는 케이스 대사 여부 판별 불가」 | §4 L70 항상 있음, `339c344:npc_turn.py:86-88` 기본값 없음 | 「`content_mode` 는 필수 필드, 누락 = 파싱 오류(기본값 금지)」. 판별 불가 문장·§13 마지막 행 삭제. `npcApi.ts` 타입에 `content_mode`·`fallback_reason`·`suggest_hint{hint_ref}` |
| §4 ④⑤⑦ L86-90 · §7 ⑥ L161 · §11 순서 2 L228 | `suggest_hint{puzzle_id}`, 수락 시 `target_level: hint_levels[puzzle_id]+1`, `postHint(playSessionId, puzzleId, body)` | §1 L19·§7 L150-151·§8 L188-189: `{hint_ref, target_level: 1}` 고정, 2단계는 `result.puzzle_id` 로 `{puzzle_id, target_level: 2}`. `hint_ref` 토큰엔 puzzle_id 없음(`339c344:services/hint_ref.py:3-4`) | ④ `suggest_hint{hint_ref}` · ⑤ `POST /hints {새 UUID, hint_ref, target_level:1}` · ⑦ 「level 1 응답의 `result.puzzle_id` 기억 → 2단계는 puzzle_id 경로」. 이미 연 퍼즐 재제안은 `already_unlocked`(차감 없음)로 오므로 그때 2단계 알약으로 전환. `postHint(playSessionId, body)` 하나, 경로 `/play-sessions/{id}/hints` |
| §4 L86-90 · §5 L113 · §9 L183·L194 · §11 L242 | 힌트 진입이 offering(NPC 제안 뒤 E 길게) 하나뿐. 「직접 힌트 버튼」 은 「안 만드는 것」 | §4.3 L117 reply null 기본, §7 L150 `puzzle_id` 로 언제든, §12 L355 generic 이어도 힌트 버튼 유지 | §4 에 「⑩ 직접 힌트」 추가: 퍼즐 안내판(또는 겨냥한 호스트 Object)에서 `{puzzle_id, target_level: hint_levels[puzzle_id]+1}`. §5 에 offering 을 안 거치는 `pending(hint)` 진입. 발견 전 퍼즐은 404 이므로 안내판에 보이는 퍼즐만 |
| §4 ③′ L85 · §7 ② L157 · §9 L184·L194 · §12 ⑥ L257 · §11 L244 | reply null 에 FE 지문 「아비사는 말없이 강을 바라본다」 20초 1회 | §4.2 L100 「FE 가 대사를 지어내지 않는다」, 고정 UI 는 🔴 FE·PM 결정 | PM 결정 전 기본 = 이름 줄 「아비사 ···」 320ms 뒤 소멸, 아무것도 안 남김. 지문은 「PM 승인 시 선택지」로 내림. 1차 완료 기준에서 지문 제외 |
| §5 L99-103·L113 | `null` → idle, offering 은 showing 뒤에만 | §4.1 L90·§4.2 L106: `reply null + suggest_hint{hint_ref} + NPC_GENERIC_PACK_MISSING` 은 「말풍선 없이 힌트 버튼 강조」 | 전이 `pending ──null + suggest_hint──▶ offering` 추가. §4 ⑨ 에 「reply 없이 suggest 만 오면 알약 라벨 교체」. 표시 방식(겨눌 때만 vs 즉시 강조)은 §12 질문 |
| §4 ② L83 · §11 순서 10·12 L236·L238 | `focus_object_id` = 「현재 미완료 퍼즐 runtime object_id(idmap)」, auto 조건 「focusObjectId 있음」 | §3 L44 | **정정(과장 아님으로 판정):** 설계안도 퍼즐 ID 가 아니라 **Object ID** 를 보낸다(L83 「runtime object_id」, L236 「겨냥·근접 로컬 ID → idmap → runtime object_id」). `339c344:services/npc_turn_service.py:360-388 _focus_puzzle` 은 현재 구역 objects 에서 그 object_id 를 찾아 `interaction.target_id` 가 미완료 퍼즐이면 대상으로 삼으므로 「미완료 퍼즐의 호스트 Object」 도 해석된다. 재시도 409 우려도 설계안이 본문 동결(L111, L160 「재구성 금지」)로 이미 막음. 실제 바꿀 것은 **선택 기준 문구뿐**: 「겨냥·근접한 Object 의 runtime id, 없으면 생략」 + 「퍼즐 ID 금지」 한 줄 |
| §4 ⑨ L92 · §11 순서 12 L238 · §12 ④ L255 | `AUTO_TURN_INTERVAL_SEC = 60` 주기 호출, 서버 쿨다운 60s·세션 3회로 기재 | §3 L57 주기 계약 없음·과호출 금지. 상수는 180s/240s/퍼즐 2회/세션 제한 없음(`npc_decision.py:48-55`) | `autoTurnLoop` 를 이벤트 1회형으로: 스테이지 문 통과 1회 · `submit_answer` 오답 직후 1회 · 마지막 상호작용 뒤 240s 1회(그 뒤 180s 쿨다운). 주기 타이머 삭제. §12 ④ 숫자 정정 |
| §5 L111 · §7 ⑤ L160 · §9 L186-187 · §11 순서 2 L228 | 3.0s AbortController 뒤 0.5s 후 1회 재전송, 4xx·5xx 전부 error, 늦게 온 응답 버림 | §5 L128·§10 L293: 네트워크·502+ 만 같은 본문 최대 2회, 500·409·422 재시도 없음 | 「네트워크·타임아웃·502/503/504 → 같은 ID·본문 최대 2회, 그 외 없음」. 타임아웃 8~10s 로 상향, 「잠깐만」 유지. `pending.id` 가 같으면 늦은 응답도 채택 |
| §7 ⑤ L160 · §9 L190 | 409 event conflict 에 새 UUID 1회 재발급 | §5 L125·§6 L136 버그로 기록 | `console.error` 로 본문 차이 기록, 재발급 없이 idle |
| §7 ① L156 · §9 L189·L192 | 500 에 지문만 띄우고 NPC 유지, 409 `CASE_VERSION_UNAVAILABLE` 엔 무조건 새 세션 | §5 L124·L127: 500 → 비활성+보고, 409 → 비활성(게임 계속) | 500 행에 「`enabled=false` + 세션당 1회 `console.error`」. 409 는 레거시(버전 없음)일 때만 새 세션, 버전 고정 세션이면 `enabled=false` 만 |
| §7 ⑥ L161 · §9 L193 · §12 ⑤ L256 | 잔액 숫자 표시 금지, `HINT_BALANCE_EMPTY` 를 초안 취급, 힌트 409 한 문구 | §7 L172-179·§8 L188·L190: 구현됨. 버튼에 「남은 힌트 n」 미리, `hint_balance` 로 갱신 | 코드별 분기: `HINT_BALANCE_EMPTY` → 잔액 없음 UI(`minigames_left` 는 로그만) · `HINT_REF_MISMATCH`·503 `HINT_REF_UNAVAILABLE` → 제안 알약 숨김(직접 힌트는 유지) · 「Previous hint level is not unlocked」·「Hint is not available yet」 → 라벨 원복. §12 ⑤ 는 「초기 지급량·세션 state 의 hint_balance 유무」만 |
| §3-4 L74 · §7 ⑥ · §12 ⑨ L260 | hintCache 선행 조회로 호출 생략, sessionStorage 원문 보관, 재열람 API 등록 질문 | §6 L137·§7 L166·L168: 같은 단계 재요청 = `already_unlocked` 무료, 원문은 「표시만」 | 메모리 캐시만. 새로고침 뒤 재열람은 `{puzzle_id, target_level}` 재호출. `hint_ref` 경로는 캐시 조회 없이 바로. sessionStorage 보관은 PM 질문으로. §12 ⑨ 삭제 |
| §5 L119 · §7 ③ · §9 L183 | generic 이면 offering 없음 + 안내판 힌트 블록도 숨김 | §4.1 L91·L96, §12 L355 | 「숨김: NPC 제안 알약 라벨만 / 유지: 말 걸기·직접 힌트·안내판 힌트 블록·게임 / 표시: 서버가 준 「잠시 멈춤」 reply 그대로」. generic 의 reply null 은 직접 질문 정책과 동일 |
| §4 ⑦ L90 · §8 L172 | level 2 진입을 「다시 E 짧게 → 서버 기본 안내 + suggest_hint」 재제안에만 | §8 L189 3항 | level 1 자막이 끝나면 안내판 힌트 블록 아래에 「힌트 2/2 열기 — 정답이 드러난다」. NPC 재제안은 보조 경로 |
| §8 L170-175 · §4 ④ L86 | 1단계 = 「아비사」 이름 줄 자막(「힌트」 표기 없음), 「힌트 1/2·2/2」 는 정식 level 에만 — **계약 §9·§9.1 과 충돌 없음(유지)** | §9 L204, §9.1 L217 | 알약 문구만 「E 길게 · 힌트 1/2 열기 — 남은 힌트 n」 꼴로(「도움 1」 삭제). §4 ⑦ 에 인용한 서버 기본 안내 02 원문은 `<기본 안내>` 자리 표시로(계약 L7) |
| §12 L252-261 | 열린 질문 ①~⑩ | ②③⑤⑨⑩ 은 계약으로 답 남 | ②③⑨⑩ 삭제. ④ → 「3 트리거면 충분한가」. ⑤ → 「초기 지급량·state 의 hint_balance」. ① 유지(결과 「걸리지 않으면 매번 (대답 없음)」). ⑥ → ③ 결정으로 확장. ⑦ → 「보고 있는 Object ID 를 idmap 어느 범위까지 얻는가」. 새로 추가: reply null+suggest 표시 방식, 정답 원문 로컬 보관 가부 |

---

## 4. 해랑이 만들거나 결정해야 할 콘텐츠

### 4-1. 대응표가 없다 — 지금 상태

- idmap 초안(`docs/naju/naju-angam-01.idmap.draft.json`)의 `puzzles[]` 는 생성 퍼즐 `PZ-01~10 → PUZZLE_ANGAM_01~10`(전부 `unplaced`)이라 **진행표 P번호와 다른 퍼즐**이다. `objects[]` 13개(`OBJ_S1_NET_FRAME_0`…`OBJ_S4_FOOTPRINTS_0`)는 모두 `ZONE_FERRY_TERRACE`·`placed_no_interaction` 이라 서버가 퍼즐을 찾을 호스트 Object 가 **0개**다.
- **정정:** 아비사는 「Object 가 아닌」 게 아니다. `objects[]` 에 `씬1.아비사#0 → OBJ_S1_ABISA_FIGURE_0`(Z1, interaction null) 이 있고, `not_mapped[2]` 「NPC(아비사) Z1 (22, 38.5)」 는 **대화 주체**로 넣을지 미정이라는 항목이다.
- 로컬 퍼즐 식별자는 안내판 id 뿐: `setPuzzlePanel("clam-dig"|"cave-stations"|"cave-burrows"|"cave-ring"|"cave-chamber"|"cave-door"|"float-stones"|"ridge-posts"|"ridge-stumps")`. 진행표 P번호는 레포에 없고 메모리(`나주-퍼즐-진행표-규칙.md`)에만 있다.
- 나주 `client.json`·`server.json`·`npc.json` 이 하나도 없다(`backend/app/content/cases` 에는 `case_001` 두 파일뿐). 그래서 NPC 턴은 409/`reply null`, Hint API 는 404 `Puzzle not found.` 다.
- **정정(발견 조건):** `current_zone_id` 는 `navigate` 로만 생기지 않는다. 세션 생성 시 `client.json` 의 `entry_zone_id` 로 초기화된다(`origin/feat/SJ-be-error-contract-1103:backend/app/services/play_session.py:160-161`, `backend/docs/contracts/play_session_initialization_policy_v0.1.md:8·23·143`). 따라서 **entry zone(Z1)의 퍼즐은 navigate 없이도 발견**될 수 있고, Z1 밖(Z2 물굴·Z3·Z4)으로 갈 때만 `navigate` 1회가 필요하다. 발견 3조건은 `hint_access.py:58-77 is_puzzle_discovered`(현재 구역에 visible + `interaction.type ∈ {input, select}` + `target_id == puzzle_id` 인 Object / 이미 푼 퍼즐 / `hint_levels ≥ 1`).

### 4-2. P번호 ↔ puzzle_id ↔ 호스트 Object ↔ 3단계 처리 표(초안 — 해랑이 채울 것)

| P | 이름 | 판정 | 안내판 id(로컬) | 서버 puzzle_id | 호스트 Object(`OBJ_S?_…`, interaction type) | Zone | 1단계 넛지 | 2단계(level 1) | 3단계(level 2) |
|---|---|---|---|---|---|---|---|---|---|
| P01 | 조개 숨구멍 캐기 | 서버 | `clam-dig` | ❓ `P01` vs `PUZZLE_…`(질문 ①) | 신규 등록 필요(input) | Z1/Z2 ❓ | npc.json `NUDGE_P01_*` | server.json hints level 1 | level 2 정답(서버에서만) |
| P02 | 통발 고르기 | 서버 | (통발 — `OBJ_S1_FISH_TRAP_0..2` 후보) | ❓ | `OBJ_S1_FISH_TRAP_*` 에 `interaction{type:"select", target_id}` 추가 | Z1 | 〃 | 〃 | 〃 |
| P02-2 | 떨리는 줄 당기기(게이지) | **화면** | — | **등록 불가**(accepted_answers 필수, `puzzle_runtime.py:115`) | 없음 | — | P02 넛지 안에 | P02 level 1 text 에 방향 포함 요청 | **FE 조작 보조**(안내판 rule / showNotice) — 힌트 버튼·잔액 UI 없음 |
| P03 | 소리로 항아리 맞추기 | 서버 | `cave-stations` ❓ | ❓ | 신규 | Z2/물굴 ❓ | 〃 | 〃 | 〃 |
| P05 | 돌탑 → 기우제 | 서버 | — (`OBJ_S1_CAIRN_0` 후보) | ❓ | `OBJ_S1_CAIRN_0` + input/select. **Item 3종(제물) 소비** → `consumes_item_ids` | Z1 | 〃 | 〃 | 〃 |
| P07 | 조개 진주 빛 잇기 | 화면 | `cave-ring`? ❓ | 등록 불가 | — | — | general_nudges 로 | (상위 서버 퍼즐 없음 → PM 질문 ②) | FE 조작 보조 |
| P08 | 물고기 굴 차례 | **확인 중** | `cave-burrows` | 서버면 ❓ | 서버면 신규 | 물굴 | 〃 | 〃 | 서버면 level 2 / 화면이면 조작 보조 |
| P09 | 물레 고리 숫자 | 서버 | `cave-ring` ❓ | ❓ | 신규. **톱니돌 ×3 소비** | 물굴 | 〃 | 〃 | 〃 |
| P09-2 | 물레 돌리기 | 화면 | — | 등록 불가 | — | — | — | P09 level 1 에 | FE 조작 보조 |
| P10 | 벽화 받침 순서·진주 | 서버(오답 숨 −8s, 3s 잠김) | `cave-chamber` | ❓ | 신규. **큰 진주 소비** | 석실 ❓ Zone | 〃 | 〃 | 〃 |
| P11 | 지게·궤 옮기기 | 화면(물리) | `ridge-posts`? ❓ | 등록 불가 | — | — | general | — | FE 조작 보조 |
| P12 | 천하대장군 장승 고리 | 서버 | — | ❓ | 신규 | Z4 ❓ | 〃 | 〃 | 〃 |
| P13 | 통나무 걸상 순서 | 서버 | `ridge-stumps` | ❓ | 신규 | Z4 | 〃 | 〃 | 〃 |
| P13-2 | 돌새 마주 보기 | 화면 | — | 등록 불가 | — | — | — | P13 level 1 에 | FE 조작 보조 |
| (`float-stones`·`cave-door` 안내판) | 뜬 돌 수집 / 동굴 문 버튼 | 판정 없음 → 퍼즐 아님 | | 등록 안 함 | | | general_nudges 가능 | — | — |

- ❓ 는 해랑이 안내판 ↔ P번호 대응을 확정해야 하는 칸이다(코드상 안내판 id 와 진행표 이름이 1:1 로 적혀 있지 않다).
- **화면 판정 퍼즐 6개(P02-2·P07·P08?·P09-2·P11·P13-2)의 3단계 「조작 보조」 는 Hint API 에 자리가 없다.** `server.json` 퍼즐은 `accepted_answers ≥ 1` 필수, `hints[]` 는 `{level 1|2, text}` 뿐이고 level 2 의 뜻은 「정답 보기」 고정(계약 §7 L149, `backend/docs/contracts/hint_api_v0.1.md` §1). → FE 자체(C)로 분류, 힌트 버튼·잔액 UI 를 띄우지 않고 이미 있는 안내판 rule / `showNotice`(`RingDoor.tsx:490`, `FishTrapPuzzle.tsx:192` 등)를 「조작 보조」 문구로 다듬는다. 2단계(방향)는 상위 서버 퍼즐(P02→P02-2, P09→P09-2, P13→P13-2)의 level 1 문장에 PM 이 넣게 요청.

### 4-3. 해랑이 쓸 원문·데이터(정답은 어디에도 넣지 않는다)

| 산출물 | 내용 | 비고 |
|---|---|---|
| idmap 재작성 | `puzzles[]` 를 P번호 기준으로(`src_id: "P01"…`, 화면 판정은 `not_mapped` 에 사유), 서버 퍼즐 호스트 Object 를 `objects[]` 에 `status:"placed"` + `interaction{type:"input"\|"select", target_id}` 로 | `publication_gate.py` 가 `placed`+interaction 요구. idmap 도 `content_fingerprint` 대상이라 **한 번에 모아 승인** |
| 나주 `client.json` 초안 | `entry_zone_id`(Z1), zones(Z1~Z4 + 물굴/석실 신설 여부 질문), objects(visible/enabled 초기값), navigation(T1~T4 `door_object_id`) | 구역 경계는 `sitePlan`·`stageGates` 좌표 |
| `npc.json` 초안 | 퍼즐별 `nudges[]` 2~3개(`line_id NUDGE_*`, ≤200자, `reveal_when` 필수) + `general_nudges` + `fallback_lines`(「잠시 멈춤」) + `auto_nudge`(연속 오답·무입력 값) | 정답·힌트 원문·정답 낱말이 섞이면 500 `NPC content is unavailable.` |
| 힌트 원문·accepted_answers | `server.json` 용 level 1(방향)·level 2(정답) 문장 | 세진에게 **별도 전달**(진행표 규칙: 레포·코드에 정답 금지) |
| Item 표 | 진행표 이름 그대로 한글 ↔ 영문 ID(호미, 조개 미끼, 통발, 빛 물고기, 막걸리, 쌀, 뜬 돌×4, 톱니돌×3, 공기주머니×3, 큰 진주, 아랑사의 푸른 비늘, 아랑사의 함, 낡은 종이, 청동 열쇠) + 획득 지점(어느 퍼즐 `on_correct` / 어느 `inspect` 의 `grant_item_ids`) + 소비 지점(`consumes_item_ids`) | 현재 `naju01/src/puzzles/inventory.ts:30-79` ITEMS 에 호미·조개 미끼·통발·공기주머니·낡은 종이가 없고 「푸른 눈물」·「진주」·「짚신 한 짝」 은 진행표와 이름이 다름 |
| FE 어댑터 상수 한 곳 | 안내판 id ↔ P번호 ↔ 서버 puzzle_id ↔ 호스트 `OBJ_` id | `naju01/src/server/` 같은 곳 |
| 시스템 지문 분리 | 숨 부족(`caveState.ts:228-246·299-311`, `BreathHud.tsx`)·끼임(`useTerrainMovement.ts:476-494` safeSpot)·재료 부족(`showNotice`) 문구는 **아비사 이름 줄 없이** 관찰 서술체로 | NPC reply 와 코드 경로 분리. 승인 대상인지는 PM 질문 ⑦ |

---

## 5. BE(세진)·PM 에 물을 것

1. **[BE] 나주 세션 생성 값** — `case_id` 는 idmap 의 `"naju-angam-01"` 인가, `content_version` 은 몇 번이 게시돼 있나(없다면 게시 예정일). `GET /cases/{id}/bundle` 응답에 `content_version` 이 실리는가. → 세션 생성 코드 첫 줄부터 막혀 있다.
2. **[BE] 기준 커밋 `339c344` 의 dev 머지 시점·로컬 시험 가부** — FE 가 `origin/feat/SJ-npc-pack-policy-v0414-1104` 를 그대로 띄워도 되는지(추가 Alembic 마이그레이션 유무). → 연동 시험 환경을 정하려고.
3. **[PM·BE] 서버 `puzzle_id` 표기** — 진행표 P번호(`"P01"`, `"P02-2"`)를 그대로 쓰나, 런타임 ID 규칙(대문자+밑줄, `PUZZLE_…`) 때문에 대응표가 필요한가. 「새 ID 체계 금지」와 충돌. → 어댑터·idmap 을 한 번만 쓰려고.
4. **[PM·BE] 화면 판정 퍼즐 6개** — `accepted_answers` 가 없어 `server.json` 에 못 넣는다. Hint API 대상에서 빼고 FE 조작 보조로 가도 되나. level 2 = 「정답 보기」를 고정으로 둘지. → 3단계 UI 를 어디까지 만들지 갈린다.
5. **[PM] P08(물고기 굴 차례)** 서버 판정 확정. → 서버면 호스트 Object·accepted_answers 가 필요.
6. **[BE] `focus_object_id` 와 아비사** — idmap 의 `OBJ_S1_…` 를 그대로 보내면 되는가. 서버가 Object → 퍼즐을 못 찾으면 auto 턴은 `reply null·suggest null` 인가 오류인가. 아비사 자체를 대화 대상 Object 로 두는가(`OBJ_S1_ABISA_FIGURE_0` 재사용?). → 어댑터 범위.
7. **[BE] 오류 본문 모양** — 코드형(`CASE_VERSION_UNAVAILABLE` 등)은 `detail` 이 문자열 하나, `HINT_BALANCE_EMPTY` 는 `detail` 객체 안에 `minigames_left`, 422 는 FastAPI 기본 배열 — 계약 §5·§7 그대로 맞는지 확인. → `errorCode()` 헬퍼 한 번에 짜려고.
8. **[BE] `client_timestamp`** — JS `toISOString()` 의 `Z` 접미(UTC)로 보내도 오프셋 포함으로 인정되는가(코드상 `utcoffset is None` 만 거부라 통과로 보임, 확인만). → `+09:00` 변환 코드를 안 만들려고.
9. **[BE] 재열람·초기 상태** — 이미 연 힌트 재열람 GET 경로가 없으니 새로고침 뒤엔 `already_unlocked` 재호출로 가면 되는가. `POST /play-sessions` 응답 `state` 와 `GET /play-sessions/{id}` 에 `hint_levels`·`hint_balance` 가 실리는가. → 첫 힌트 응답 전에 「남은 힌트 n」 을 보여 주려면 필요.
10. **[PM] 힌트 초기 잔액 3 확정** 과 베타에서 미니게임 충전 없음(`HINT_BALANCE_EMPTY` 뒤 끝)으로 가도 되는지. → 잔액 없음 UI 범위.
11. **[PM] `reply: null`(직접 질문) 고정 UI** — 「(대답 없음)」 문구·입력창 상태·재질문 안내를 둘지, 설계안 FE 지문을 승인할지, 이름 줄만 사라지는 무 UI 로 갈지(계약 §4.2 🔴). → 운영 기본값에서 플레이어가 보는 전부다.
12. **[PM] `reply null + suggest_hint`(NPC_GENERIC_PACK_MISSING) 표시 방식** — 아비사를 겨눌 때만 알약 라벨 교체로 충분한가, 즉시 강조가 필요한가(계약 §4.2 🔴). → 자동 개입이 보이는 유일한 신호.
13. **[PM] 직접 힌트 입력 위치** — 퍼즐 안내판 쪽 키 하나인지 별도 버튼인지. 계약은 「힌트 버튼」 존재를 전제. → 지금은 NPC 제안 없이는 힌트를 못 연다.
14. **[PM] 정답 원문 `hint.text` 를 sessionStorage 에 보관해도 되는가**(계약은 「표시만」). → 안 되면 재열람은 재호출.
15. **[BE] auto 턴 트리거** — 「구역 진입·오답 직후·무입력 240s 뒤」 각 1회가 서버 쿨다운 180s·퍼즐 2회와 맞는가. 화면 판정 퍼즐을 푸는 동안은 서버가 idle 로 보는데 FE 가 auto 를 안 보내는 게 맞는가. → 과호출·무의미 턴 방지.
16. **[BE] 줍는 물건** — 막걸리·쌀·뜬 돌·공기주머니는 획득 Interaction 이 없다(획득은 Effect `grant_item_ids` 뿐). 줍기 Object 를 `inspect` 로 등록해 `on_inspect.grant_item_ids` 로 받는 방식이 맞나, 줍기 Interaction 을 추가할 계획인가. Item ID 명명 규칙·정의 위치도. → P05·P09·P10 이 `409 Required items are not held.` 가 되지 않게.
17. **[PM·BE] 물굴·석실 Zone** — Z2 에 포함할지 별도 Zone 으로 둘지. Z1 밖은 `navigate` 를 보내야 발견 조건이 맞는다. → client.json·navigate 트리거 좌표.
18. **[PM·BE] 넛지 원문 작성 주체와 G1·G2·G3 승인자**, 승인 저장소(DB)·게시 경로 일정. → 원문을 써도 승인 저장소가 없으면 `reply` 는 계속 null.
19. **[PM] 시스템 지문(숨·끼임·재료 부족 `showNotice`)** 이 콘텐츠 승인 대상인가. 아비사 이름 없는 지문이면 승인 없이 써도 되나. → 기존 HUD 문구를 그대로 둘 수 있는지.

---

## 6. 착수 순서 제안

| 순서 | 단계 | 선행 조건 | 내용 | 예상 분량 |
|---|---|---|---|---|
| 1 | **세션 버전** | 질문 ①(case_id·content_version) 회신. 없으면 상수를 비워 두고 `?naju-case=`·`?naju-version=` 쿼리로 주입 | `createPlaySession` 에 `content_version`, `GuestPlayRecord.contentVersion`, 409 분기(레거시 vs 고정), `naju01/src/app` 부팅 지점 + `usePlaySession` | 0.5일 |
| 2 | **API 층** | 1 완료. 타입은 계약 §3·§4·§7·§10 표로만(로컬 backend 참고 금지) | `src/server/ids.ts`(newEventId·clientTimestamp), `BackendError.detail` 원형 보존 + `errorCode()`, 동결 pending 재시도 래퍼, `sendNpcTurn`·`unlockHint`, `PlaySessionState.hint_levels`, 서버 힌트 스토어(hintBox 와 별도) | 1일 |
| 3 | **자막 UI** | 2 완료 + PM 질문 ⑪ 회신(없으면 「이름 줄 320ms 소멸」 기본값으로 진행) | 설계안 §3·§5·§6 자막 띠·상태 기계·입력 잠금. reply 표시·reply null 무 UI·generic 모드·500/409 비활성. 지문은 시스템 지문 경로로 분리 | 1.5일 |
| 4 | **힌트 제안·직접 힌트** | 3 완료 + 질문 ④⑬ 회신 | offering 알약(`hint_ref`, level 1 고정) → `result.puzzle_id` 로 2단계 버튼, 직접 힌트(`puzzle_id`) 입력, 코드별 409/503 처리, 「남은 힌트 n」, 화면 판정 퍼즐은 조작 보조로 분기 | 1일 |
| 5 | **auto 턴·focus_object_id** | 4 완료 + idmap 호스트 Object 등록(아래 6) | 이벤트 1회형 트리거 3종, 로컬 id → `OBJ_` 어댑터, 미매핑 시 생략+로그, Z1 밖 구역 진입 시 `navigate` 1회 | 0.5일 |
| 6 | **콘텐츠** | 질문 ③④⑤⑯⑰⑱ 회신(병렬 진행 가능, 코드와 독립) | idmap 재작성(P번호·호스트 Object·interaction), `client.json` 초안, `npc.json` 넛지 초안, Item 표, 힌트 원문(세진에게 별도) | 1~2일, 승인 대기는 별도 |

- 11/4 중간 발표 시연은 이 순서와 무관하게 기존 흐름으로 간다(나주 머지 순서 메모 참조). 1~3 은 승인 대사가 없어도 `reply: null` 경로로 동작 확인이 되므로 BE 회신을 기다리지 않고 시작할 수 있다.

---

## 7. 지금 `reply: null` 뿐인 상태에서 UI 를 시험하는 법(모의 응답)

1. **fetch 가로채기 레이어(권장)** — `api.ts` 의 `backendRequest` 가 `fetch` 하나를 쓰므로, `?mock-npc` 쿼리(또는 `import.meta.env.DEV` + localStorage 플래그)가 켜지면 `/npc/turns`·`/hints` 경로만 가로채는 모의 핸들러를 `src/server/mock/npc.ts` 에 둔다. 응답 사전(모두 계약 §4·§7 의 JSON 모양 그대로):
   - `case + reply`: `{npc_event_id, reply:{source:"approved_line", text:"<승인 원문 자리>", line_id:"NUDGE_TEST_01"}, suggest_hint:null, fallback_reason:null, content_mode:"case"}`
   - `case + null`(운영 기본값): `reply:null, suggest_hint:null, fallback_reason:null, content_mode:"case"`
   - `case + suggest only`: `reply:null, suggest_hint:{hint_ref:"hr1.k1.<43자>"}, fallback_reason:"NPC_GENERIC_PACK_MISSING"`
   - `generic`: `reply:null, suggest_hint:null, fallback_reason:"NPC_CONTENT_WITHDRAWN", content_mode:"generic"`
   - `generic + 잠시 멈춤`: `reply:{…text:"<잠시 멈춤 자리>"}, content_mode:"generic"`
   - Hint 성공: `{interaction_id, result:{result_type:"hint_unlocked", puzzle_id:"P01", hint_level:1, state:{}, state_changes:[…], hint_balance:2, help_used:1}, hint:{level:1, text:"<힌트 원문 자리>"}}` / 재열람: `result_type:"already_unlocked"`, 같은 `hint_balance`
   - 오류: `409 {"detail":"CASE_VERSION_UNAVAILABLE"}` · `409 {"detail":{"code":"HINT_BALANCE_EMPTY","message":"…","minigames_left":0,"special_minigame_available":false}}` · `409 {"detail":{"code":"HINT_REF_MISMATCH"}}` · `503 {"detail":{"code":"HINT_REF_UNAVAILABLE"}}` · `422 {"detail":[{"loc":["body","message"],"msg":"…","type":"…"}]}` · `500 {"detail":"NPC content is unavailable."}` · 네트워크 오류(throw) 뒤 두 번째 호출 성공 → 같은 `client_event_id` 로 재전송됐는지 검사
   - 시나리오 선택은 `?mock-npc=case-null` 처럼 쿼리값으로, 지연은 0ms / 1500ms / 9000ms(타임아웃 경계) 세 가지.
   - 모의 응답의 대사 텍스트는 자리 표시만 쓴다(계약 L7 — 승인 원문·정답을 코드에 두지 않는다).
2. **로컬 백엔드로 진짜 `null` 을 받기** — `git worktree add ../kgeseo-be-339c344 339c344` 로 백엔드만 따로 띄우면 `/hints` 라우터·`content_mode` 가 있는 계약 기준 코드다. 나주 콘텐츠가 없으니 세션 생성은 409 가 나므로, **`case_001` + 게시된 버전**으로 세션을 만들어 `/npc/turns` 를 치면 `reply:null·content_mode:"case"` 와 409·422·500 의 실제 본문 모양(`detail` 문자열/배열/객체)을 확인할 수 있다. 질문 ①②⑦ 의 답을 코드로 먼저 얻는 용도.
3. **Playwright 검사 환경** — 메모리 규칙대로 개발 서버 말고 빌드+정적 서버, 컨텍스트 하나 공유. 모의 레이어는 빌드에 포함되되 `?mock-npc` 없으면 실행 코드 경로에 들어가지 않게(프로덕션 번들에서는 tree-shake 되도록 `import.meta.env.DEV` 가드).
4. **검사 항목(최소)** — reply null 에 아무 UI 없음 · reply 있으면 승인 원문 그대로 · suggest 만 와도 offering 진입 · generic 에서 직접 힌트·게임 유지 · 재시도 시 `client_event_id`·본문 동일 · 409 conflict 에 재발급 없음 · 422 배열이 `"[object Object]"` 로 안 보임 · 화면에 영문 `detail` 노출 0건.