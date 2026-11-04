<!-- 2026-11-04 설계안(미구현). BE 계약서 npc_fe_dialogue_ui_contract_v0.1 이 공유되면 7절 대응표를 그 문서 기준으로 다시 맞춘다. 서로 다른 관점의 설계 4안(자막형·바텀시트·상황적응·레퍼런스)을 세 기준(몰입·계약 정합·구현 현실성)으로 심사해 1위 자막형을 뼈대로 종합한 것. -->

# NPC 대화창 종합 설계안 — 「강가 자막」 뼈대 + 세 안의 접목

> 작성: UX 리드 / 기준: 심사 1·2·3 합산 1위 **subtitle(101/120)** 을 뼈대로, sheet·adaptive·reference 의 가장 좋은 아이디어를 얹고 subtitle 의 치명 결함 4가지(재열람 불가 · 잔액 UX 얇음 · generic 판별 불가 · 채팅이 선택 기능)를 전부 해소했다. **구현은 하지 않는다.**

---

## 1. 한 줄 결론

**포인터락을 풀지 않는 바텀 자막(화면 아래 36~105px 띠)으로 아비사의 말을 흘리고, 말 걸기·힌트 수락은 기존 조준점 아래 [E] 알약 한 자리에서 끝내며, 채팅(Enter)은 같은 자리에 한 줄 입력으로 열리되 capture 차단기 하나로 키 샘을 막는다. 해금된 힌트는 퍼즐 안내판에 한 줄로 남아 다시 볼 수 있다.**

---

## 2. 왜 이 구조인가 — 플레이어가 불편하지 않은 이유 3가지

| # | 이유 | 근거 |
|---|---|---|
| 1 | **1인칭 손이 한 번도 끊기지 않는다.** 말 걸기(E 짧게)·대사 읽기·힌트 수락(E 길게) 전부 포인터락 유지. 창이 뜨지 않으니 unlock → lock 왕복이 없고, T 를 안 누른 사람이 갑자기 잠기는 나주 관례의 구멍(`naju01/src/app/useGameHotkeys.ts:62,68,72`)도 건드리지 않는다. 채팅(Enter)만 예외이고 그때도 열기 전 잠금 상태를 기억해 닫을 때만 복원한다(본편 `src/app/pointerLock.ts:17-36` 방식). | subtitle + adaptive |
| 2 | **퍼즐·풍경을 한 픽셀도 고정으로 덮지 않는다.** 글자 뒤 줄 단위 띠(rgba .62)만 그리고 고정 박스·스크림·상시 띠가 없다. 핫바 주석 「아래쪽은 대사 자리라 비워 둔다」(`naju01/src/puzzles/Hotbar.tsx:2`)와 PRD UI-010 「HUD 는 퍼즐 관찰을 가리지 않음」을 그대로 따른다. 풀리는 순간 연출(cameraFocus)·통발 게이지·물속에는 자막을 **보류 큐**에 넣어 연출을 끊지 않는다. | subtitle |
| 3 | **배울 게 없다.** 새 키·새 창·새 z-index 층·마우스 UI 가 없다. 조사 대상과 같은 [E] 알약에 「아비사에게 말 걸기」가 뜨고, 힌트 제안도 그 알약 라벨이 바뀌는 것뿐이다(PRD S7-049 「깜빡여 존재만 알림」). 다시 보고 싶은 힌트는 이미 보고 있던 퍼즐 안내판에 남는다. | subtitle + reference |

---

## 3. 화면 배치 스펙

### 3-1. 자막 띠(새로 추가되는 유일한 상시 자리, 평소엔 비어 있음)

| 항목 | 값 |
|---|---|
| 부모 | `div.game-stage`(position relative, `naju01/src/index.css:29-32`) 안 absolute — `?stage=16x9` 레터박스에서도 같은 자리 |
| 위치 | left 50% · **bottom 36px(고정 px)** · translateX(-50%) · text-align center |
| 폭 | `min(720px, calc(100% - 32px))` → 1280 폭에서 280~1000px, 1024 폭에서 152~872px |
| 높이 | 이름 줄 12px/1 + marginBottom 6 + 대사 2줄(17px/1.5 = 25.5 × 2 = 51) = **69px** → 화면 아래 **36~105px 띠** |
| z-index | **25**(조준점·E 알약·알림과 같은 층. 자막은 알림 '아래' 띠라 겹치지 않음) |
| pointerEvents | none(채팅 입력 열림 때만 input 한 칸 auto) |
| 바탕 | 고정 박스 없음. 줄 단위 띠 `box-decoration-break: clone`, padding 3px 10px, radius 6, rgba(14,18,26,.62) + text-shadow 0 1px 2px rgba(0,0,0,.55) |
| 2줄 초과 | 17px·720px 에서 1줄 ≈ 38~40자 → 80자 넘으면 문장 경계(. ? ! … —)에서 2줄 청크로 나눠 순서 표시. 280자 상한(`npc_utterance_v0.1.md`)이면 최대 4청크 |

### 3-2. 기존 HUD 와의 관계(전부 코드로 확인한 좌표)

| 기존 요소 | 자리(파일) | 자막과의 관계 | 규칙 |
|---|---|---|---|
| 조준점 | 50%/50% 5px z25 (`InteractionHud.tsx:38-50`) | 안 겹침 | 그대로 |
| [E] 알약 | 50%, top calc(50%+34px) z25 (`InteractionHud.tsx:52-68`) | 안 겹침 | **힌트 제안 때 라벨만 교체**(새 자리 없음) |
| 짧은 알림 | 50%, bottom 110 z25 (`InteractionHud.tsx:81-95`) | 자막 윗변 105 → **5px 틈** | 동시 표시 가능, 알림이 퍼즐 피드백이라 우선. 자막은 그대로 흐름 |
| 줄당기기 게이지 | 50%, bottom 70, SVG 380×150 z26 (`fishTrap/PullGaugeHud.tsx:117-128`) | y 겹침 | **동시 금지** — 게이지 활성이면 말 걸기 비활성 + 자막 보류 |
| 숨 게이지 | left 24 bottom 28, 180×10 트랙 z26 (`cave/BreathHud.tsx:113-137`) | 1100px 미만 폭에서 x 겹침 가능 | **물속에선 말 걸기 비활성 + 자막 보류**(NPC 없음) |
| ?dev 조작 안내 | 50%, bottom 18 z20 (`App.tsx:328-357`) | 잠금 전에만 뜸 | 개발 전용이라 둔다 |
| 퍼즐 안내판 | right 24, top 50% translateY(-50%), 폭 250 z24 (`PuzzlePanelHud.tsx:29-43`) | 영역 분리 | **해금 힌트 한 줄을 여기에 얹음**(3-4) |
| 핫바 | left 14 top 54 세로 넷 z24 (`Hotbar.tsx:81-90`) | 분리 | 그대로 |
| 계기판·⚙·[H] 자국 | top 12~14 z20 (`App.tsx:359-387`, `Dashboard.tsx:182-195`) | 분리 | 그대로 |
| 종이 읽기 | inset 0 z30, 왼쪽 띠만 어둡게·종이 min(26vw,380px) (`ridge/PaperReadHud.tsx:44-66`) | 종이는 왼쪽 3vw 띠, 자막은 가운데 | 공존 가능하나 **E 선점이 겹치므로 종이 열림 중엔 제안중 상태를 만들지 않음** |
| 소지품 z40 · 설정 z45 · 힌트함 z50 | 백드롭 inset 0 | 자막을 덮음 | 열리면 isLocked=false → 자막 **보류**(타이머 정지), 닫히면 이어 흐름 |
| 로딩 덮개 z3000 | inset 0 | 덮음 | 보류 |
| ?review=1 inspection | left 12 bottom 12 폭 276 z80 (`ReviewBridge.tsx:1396-1402`) | 1024 미만에서 x 겹침 | 검수 전용이라 둔다 |

### 3-3. 채팅 입력(Enter) — 자막 대사 줄 자리에 한 줄

| 항목 | 값 |
|---|---|
| 위치·폭 | 자막 대사 줄과 같은 자리·같은 폭 |
| 크기 | height 40, 17px CREAM, padding 0 14, radius 8 |
| 바탕 | rgba(14,18,26,.78), inset 1px rgba(242,238,228,.18), 포커스 시 inset 1px rgba(242,200,154,.6), caret AMBER |
| 이름 줄 | 「아비사에게 · Enter 보내기 · Esc 취소」 12px, 180자부터 오른쪽 「n/200」 11px mono |
| 열림 전이 | 180ms 높이 0→40, 닫힘 역순 |

### 3-4. 힌트 재열람 줄 — 퍼즐 안내판에 얹음(subtitle 치명 결함 1 해소)

퍼즐 안내판(`PuzzlePanelHud.tsx`, 제목 AMBER 15px · 규칙 #CFD6D4 · 상태 줄)의 상태 줄 아래에 **해금된 힌트가 있을 때만** 한 블록 추가:
- borderLeft 2px AMBER, padding 6px 10px, bg rgba(242,200,154,.08), marginTop 8
- 라벨 「힌트 1/2」 AMBER 700 12px, 본문 CREAM 13px/1.5, 최대 4줄(넘치면 … 없이 전부 — 안내판은 세로 가운데라 늘어나도 바텀 자막과 안 닿음; 720p 에서 안내판 높이 300px 까지는 아래끝 ≈ 510 < 자막 윗변 615)
- level 2 를 열면 두 블록(1/2 위, 2/2 아래). 안내판은 가장 가까운 퍼즐 것만 보이므로(`puzzlePanel.ts:29-35`) 다른 퍼즐 힌트가 섞이지 않는다.
- 원문은 `hintCache[puzzle_id][level]` + `sessionStorage('kgeseo.naju.hints.<playSessionId>')` 에 보관 → 새로고침해도 남는다(sheet 안 접목).

---

## 4. 사용자 흐름 — 말 걸기 → 대사 → 힌트 제안 → 수락 → 해금

| 단계 | 플레이어 | 화면 | 서버 |
|---|---|---|---|
| ① 접근 | 걷다가 아비사(Z1 x22 z38.5, `fishTrap/site.ts ABISA`)를 2.5m 안에서 겨눔 | 아비사 모델 AIM_GLOW 로 살짝 밝아짐(링 금지). 조준점 아래 알약 「**E** 아비사에게 말 걸기」. 자막 자리는 비어 있음 | 없음 |
| ② 말 걸기 | **E 짧게** | 이름 줄 「아비사 ···」(점 3개 1.2초 호흡)만 12px 로 뜸. 대사 줄 비어 있어 화면이 거의 안 변함 | `POST npc/turns { trigger:'player_message', message: 고정 말머리, focus_object_id: 현재 미완료 퍼즐 runtime object_id(idmap, 없으면 생략) }` |
| ③ 대사 | 아무것도 안 함(걷기 자유) | 이름 줄 「아비사」, 대사가 240ms 로 떠오르고 28ms/자 로 흐름. 머무름 max(2.6s, 1.0s+글자수×0.085s) 상한 8s → 320ms 퇴장. 2줄 초과는 180ms 간격 청크 | 응답 `reply{source,text,line_id}` |
| ③′ reply null | — | 플레이어 턴일 때만 FE 지문 「아비사는 말없이 강을 바라본다.」(이름 줄 없음, CREAM .7, 2.6s). 20초에 1회. auto 턴 null 은 아무것도 안 띄움 | 200 + reply null(정상) |
| ④ 힌트 제안 | 아비사를 계속 보고 있음 | 마지막 청크 끝 +0.6s 뒤, 알약 라벨이 **「E 길게 · 힌트 1/2 열기 — 처음 열면 도움 1」** 로 바뀌고 키캡 테두리 1.4s 주기 2회만 맥동. 자막 자리엔 아무것도 추가 안 됨 | 응답 `suggest_hint{puzzle_id}` (해금 아님) |
| ⑤ 수락 | **E 를 0.5초 길게**(level 2 는 0.9초) | 누르는 동안 키캡 안이 AMBER 로 아래→위 차오름. 완료 순간 알약 120ms 로 사라지고 이름 줄 「힌트 ···」 | `POST Hint API { 새 UUID, target_level: hint_levels[puzzle_id]+1 }` |
| ⑤′ 거절 | 시선을 떼거나 8초 방치 | 알약 라벨이 원래대로 | 없음(서버에 안 알림) |
| ⑥ 해금 | — | 자막 이름 줄 「힌트 1/2」 AMBER, 대사 줄 왼쪽에 2px AMBER 선(NPC 의 말이 아니라 '꺼낸 쪽지'로 구분), 글자 흐르기 없이 한 번에, 머무름 ×1.5(최소 6s). 동시에 퍼즐 안내판에 힌트 블록이 붙어 **남는다** | `hint{level,text}` + `state_changes[hint_level_changed]` 로만 로컬 hint_levels 갱신 |
| ⑦ 3단계(정답) | level 1 을 보고도 막히면 다시 E 짧게 → 서버 기본 안내 02 「…막혔다면 힌트를 열어 볼까요?」 + suggest_hint → 알약 「**E 길게 · 힌트 2/2 열기 — 정답이 드러난다 · 도움 1**」 → 0.9초 길게 | 안내판에 2/2 블록 추가 | target_level 2 (hint_levels ≥1 일 때만) |
| ⑧ 채팅 | **Enter**(잠금 중·창 없음·cameraFocus 아님) | 잠금 기억 → unlock → 자막 자리에 입력줄 180ms 로 열림·포커스. 1~200자, 공백만이면 안 보냄, IME 조합 중 Enter 무시 | Enter → `player_message` 전송 → 입력줄 닫고 기억이 true 면 즉시 lock() → ②의 대기 화면 |
| ⑨ 자동 개입 | 아무것도 안 함 | reply 가 오면 바텀에 조용히 흘림(이름 줄 「아비사」). 보류 조건이면 큐. auto 로 온 suggest_hint 는 **아비사를 겨눌 때만** 알약이 켜짐(아무 데서나 잔액 안 씀) | FE 가 `AUTO_TURN_INTERVAL_SEC`(60, 상수)마다 focus 가 있을 때만 auto 턴 |

---

## 5. 상태 기계(모듈 스토어 하나, 한 번에 한 상태)

```
idle ──E짧게 / Enter전송 / auto주기──▶ pending ──reply──▶ showing ──suggest_hint──▶ offering ──E길게──▶ pending(hint) ──▶ showing(hint) ──▶ idle
                                       │                                               │
                                       ├──null(플레이어 턴)──▶ showing(지문) ──▶ idle   ├──시선이탈 / 8s / 창열림──▶ idle
                                       ├──null(auto)──▶ idle
                                       └──timeout×2 / 4xx / 5xx──▶ error ──2.6s──▶ idle
idle ──Enter──▶ typing ──Enter(1~200자)──▶ pending   /   typing ──Esc / 포커스 잃음──▶ idle
```

| 상태 | 화면 | 들어가는 조건 | 나가는 조건 | 비고 |
|---|---|---|---|---|
| idle | 자막 비어 있음 | 기본 | 큐 머리가 있고 보류 아님 → showing | 큐 길이 ≤ 2, auto 는 밀리면 버림(체류 상한 20s) |
| near(파생) | 알약 「말 걸기」 | 아비사 겨냥 + reach 2.5m + 잠금 + enabled | — | 상태가 아니라 interaction.ts 겨냥의 결과. 모든 상태와 겹칠 수 있음 |
| pending | 이름 줄 「아비사 ···」 또는 「힌트 ···」 | 턴/힌트 전송 | 3.0s 타임아웃 → 같은 pending 객체 1회 재전송 → 실패면 error | **pending = {client_event_id, body(client_timestamp 포함), kind, sentAt} 를 동결**(sheet). E 는 무시(중복 턴 방지), 걷기 자유. 늦게 온 응답은 pending.id 비교로 버림 |
| showing | 청크 n/m 흐름·머무름 | reply / null 지문 / hint 응답 | 마지막 청크 종료 | 플레이어 턴 결과가 오면 현재 청크를 320ms 로 접고 교체, auto 는 뒤에 줄 세움 |
| offering | 알약 라벨 교체 + 맥동 | showing 끝 + suggest_hint + contentMode=case + 종이 안 열림 | E 길게 완료 / 시선 이탈 / 8s / 창 열림 / 게이지·물속 | 짧게 누름 = 아무 일 없음(차오름 되감기) |
| typing | 입력줄 | Enter(잠금·창 없음·cameraFocus 아님·`?present` 아님) | Enter 전송 / Esc / blur | capture 차단기 등록, unlock, wasLocked 기억 |
| error | 한국어 지문 1줄 2.6s | 재시도 실패·4xx·5xx | 2.6s | 종류는 console 에만 |
| deferred(플래그) | 타이머 정지·새 표시 금지 | `isCameraFocused()` ∥ PullGauge 활성 ∥ BreathHud 활성 ∥ paperOpen ∥ !isLocked ∥ 로딩 | 전부 해제 | 타이머는 rAF 누적(`cameraFocus.ts` 방식) — 멈췄다 돌아온 프레임이 자막을 통째로 건너뛰지 않게 |

- `enabled` 게이트(sheet): 세션에 content_version 이 없으면 `registerInteractable` 자체를 하지 않고 알약도 안 뜬다 → 409 경로 원천 차단.
- contentMode=generic: offering 상태 자체가 없다(suggest_hint 무시). **서버가 준 reply 는 버리지 않고 그대로 흘린다**(응답에 케이스 팩 여부가 없어 FE 가 판별할 수 없음 — subtitle 치명 결함 3 해소, 열린 질문 ③).

---

## 6. 입력·포인터 잠금 규칙

| 키 | 평소(잠금) | offering | typing | 근거·처리 위치 |
|---|---|---|---|---|
| E 짧게 | 아비사 겨냥 시 말 걸기. 기존 capture 체인(keyInterceptor → 잠금 확인 → handHandler → quickHandler → aimed.use, `interaction.ts:155-178`) 그대로 `aimed.use()` 에서 턴 전송 | 아무 일 없음(차오름 되감기, 재질문 안 나감 — 잔액 보호) | 글자 e | `handLabel: () => '아비사에게 말 걸기'`, `keepHand: true`(`interaction.ts:23,27` 실재) 로 든 채로도 말 걸기 |
| E 길게 | — | `setKeyInterceptor`(`interaction.ts:148-151`, PaperReadHud 와 같은 방식)로 keydown 선점 + keyup 별도 수신, ≥500ms(level 2 는 900ms)면 수락 | — | 종이 읽기 interceptor 와 안 겹치게 종이 열림이면 offering 금지 |
| Enter | typing 진입(InventoryModal 의 Enter 는 창 열림 때 capture 뿐이라 충돌 없음) | 같음 | 전송 / 빈 칸이면 닫기 / `isComposing` 이면 무시 | 쓰이지 않던 키 |
| Esc | 브라우저가 잠금을 먼저 품 → 자막은 닫을 게 없음 | offering 해제 | **typing 은 이미 unlock 이라 keydown 정상 도착** → 닫고 wasLocked 면 lock() | sheet·adaptive 의 'Esc 재잠금 거부' 전제는 잠금 유지형엔 해당 없음(심사 3) |
| WASD·Shift·Space·C | 그대로 걷기 | 그대로 | **차단기가 삼킴**(아래) | `useTerrainMovement.ts:168-195` 는 bubble |
| 숫자 1~8·휠 | 핫바 | 핫바 | 차단기가 삼킴 / 휠은 pointerLockElement 없어 Hotbar 가 안 받음 | `Hotbar.tsx:22-45` bubble |
| H·I·P | 창 열림 → isLocked=false → 자막 보류 | 창 열림 → offering 해제 | 차단기가 삼킴(한 번에 한 창) | `useGameHotkeys` if 순서는 손대지 않음 |
| T·V·Q·O·F | 그대로 | 그대로 | 삼킴 | F 는 v1 미배정(자막 넘기기 요청이 오면 F) |
| 마우스 | 시선 | 시선 | 입력줄 클릭만 | PointerLockControls selector `'#no-such-element'`(`NajuScene.tsx:490-495`) 그대로 → 장면 클릭이 재잠금 안 함 |

**typing 중 키 샘 방지 — capture 차단기 하나(sheet 안 접목, 파일 수정 0곳)**
- 확인된 사실: `useTerrainMovement`·`Hotbar`·`StumpStairs`·`RidgeCart`·`useNajuDevTools`·`useGameHotkeys` 는 전부 **bubble** 등록, capture 는 `interaction.ts`(모듈 로드 시, 가장 먼저) 와 `InventoryModal.tsx:53`(창 열림 때만) 뿐.
- typing 진입 때 `window.addEventListener('keydown', gate, {capture:true})` 하나 등록 → Escape·Enter 는 차단기가 직접 처리하고, 나머지 키는 `stopImmediatePropagation()` 만(**preventDefault 안 함** → 글자 삽입은 기본 동작이라 input 에 그대로 찍힘).
- 주의: capture 단계에서 전파를 끊으면 input 의 React onKeyDown 도 안 오므로 **Enter/Esc/IME 판정은 차단기 안에서** 한다.
- `interaction.ts` E 는 먼저 돌지만 `:164` 에서 pointerLockElement 없음 → 무시. 추가로 typing 동안 `setKeyInterceptor(() => true)` 를 걸어 이중 안전.
- 차단기 등록/해제는 typing 상태와 한 effect 로 묶고 error·unmount 경로에서도 반드시 뗀다(sheet 위험 항목).

**포인터 잠금**
- 자막·offering: 잠금 유지. unlock 하는 곳은 typing 하나뿐.
- typing 열기: `wasLocked = !!document.pointerLockElement` 기억 → `controls.unlock()` → rAF 에서 `input.focus()`.
- typing 닫기(Enter/Esc/blur): keydown 사용자 제스처 안에서 `wasLocked` 일 때만 `controls.lock()`. 실패는 catch 하고 bottom 18 자리에 「T 다시 잡기」 pill 2초(adaptive).
- cameraFocus 중: 겨냥이 멈춰(`InteractionLoop.tsx:10`) E 말 걸기 불가, Enter 도 막음, 자막 보류.

---

## 7. BE 주의사항 7가지 대응표

| # | BE 주의사항 | 대응 | 화면 |
|---|---|---|---|
| ① | PlaySession 생성 시 `content_version` 필수 | `src/server/api.ts:137-152 createPlaySession` 본문에 번들 응답의 content_version 추가. 세션 메타에 버전이 없으면 `dialogueStore.enabled=false` → `registerInteractable` 안 함(sheet). localStorage `kgeseo.guest-play.v1` 의 옛 playSessionId 로 409 CASE_VERSION_UNAVAILABLE 이 오면 새 세션 생성 | 알약이 안 뜸. ?dev 계기판에만 「NPC: legacy session」 |
| ② | 200 + `reply: null` 은 정상 | error 로 가지 않음. 플레이어 턴 → 지문 1줄(20s 에 1회), auto 턴 → 침묵. 재시도 없음(null 은 결과) | 이름 줄 없는 CREAM .7 지문 2.6s |
| ③ | `content_mode` case/generic, generic 은 케이스 대사·힌트 제안 UI 만 숨김 | 응답 스키마(`schemas/npc_turn.py:52-65`)에 필드가 없으므로 어댑터 한 함수 `getContentMode()` 뒤에 가두고 기본 **generic**. generic 이면 offering 없음 + 안내판 힌트 블록 없음. 서버가 준 reply 는 FE 가 케이스 여부를 판별할 수 없으니 그대로 표시(케이스 대사 차단은 BE 책임 — 열린 질문 ③) | 알약 라벨 교체·힌트 블록만 사라짐 |
| ④ | 제안 ≠ 해금, 수락 시 Hint API | suggest_hint → 알약 라벨만. hint_levels 를 바꾸는 코드는 Hint 응답 `state_changes` 처리 한 곳뿐. NPC 응답으로 fishTrapState·stageGates·hint_levels 를 건드리는 경로를 만들지 않음(`state_changes` 항상 빈 배열, `schemas/npc_turn.py:80-83`). auto 로 온 제안은 겨눌 때만 수락 가능 | 해금 전엔 자막 자리에 아무것도 안 붙음 |
| ⑤ | 재시도는 같은 `client_event_id` + 같은 본문, UUID 형식 | pending 객체(`{client_event_id: crypto.randomUUID(), body}`)를 동결해 타임아웃 재전송 1회가 그 객체를 그대로 보냄(client_timestamp 포함, 재구성 금지). 첫 응답 text 는 즉시 스토어에 적고 재전송 null 로 덮지 않음. NPC·Hint·Interaction 이 같은 표(`interaction_puzzle_runtime_v0.1.md:263-290`)를 쓰므로 힌트는 **반드시 새 UUID**. 409 event conflict 는 프로그래밍 오류 → console.warn + 새 UUID 1회 재발급 | 플레이어는 「아비사 ···」만 본다 |
| ⑥ | 정식 힌트 level 1·2, 각 최초 해금 때 잔액 1 차감 | target_level 은 항상 hint_levels[puzzle_id]+1(건너뛰기 409 방지). `hintCache` 에 있으면 **호출 자체를 안 하고** 캐시 재표시(sheet). already_unlocked 도 차감 없음. 알약 라벨에 「처음 열면 도움 1」, level 2 는 「정답이 드러난다」 + 길게 0.9s(subtitle 치명 결함 2 해소). 잔액 숫자는 hint-wallet API(초안·미구현) 전까지 표시 금지. 409 HINT_BALANCE_EMPTY(초안) → 지문 「지금은 더 열 수 있는 힌트가 없다.」 | 알약 라벨·차오름 시간 |
| ⑦ | 서버 영문 메시지 비노출 | `BackendError.message`(`src/server/api.ts:27-37`)를 자막에 쓰는 경로 없음. status·detail 상수 → 한국어 표(`dialogueCopy.ts`): 404 「길이 끊겼다. 잠시 뒤 다시 말을 걸어 보자.」 / 409 CASE_VERSION_UNAVAILABLE 「아비사가 지금은 대답할 수 없다.」(+세션 재생성) / 422·500·타임아웃·네트워크 「아비사가 지금은 대답할 수 없다.」 / 힌트 409 「지금은 더 열 수 있는 힌트가 없다.」 / 표에 없는 코드 → 타임아웃 문구. 원문은 console·?dev 계기판에만 | 관찰 서술체 ~다, 2.6s, 이름 줄 없음 |

---

## 8. 힌트 3단계(PM v0.4.15)가 화면에서 보이는 모습

| PM 단계 | 서버 | 화면 | 잔액 | 다시 보기 |
|---|---|---|---|---|
| 1단계 무료 NPC 넛지 | NPC 턴 reply(승인 nudge 원문 / 기본 안내) | 바텀 자막, 이름 줄 「아비사」, 글자 흐름. **'힌트'라는 말을 안 씀** | 없음 | 없음(말은 흘러간다 — 로그 창을 두지 않는 게 설계 핵심) |
| 2단계 정식 Hint level 1 | `target_level 1` | 알약 「E 길게 · **힌트 1/2** 열기 — 처음 열면 도움 1」 → 자막 이름 줄 「힌트 1/2」 AMBER + 왼쪽 2px AMBER 선, 흐르기 없이 한 번에, ≥6s | 1 | 퍼즐 안내판 힌트 블록 「힌트 1/2」 |
| 3단계 정식 Hint level 2 | `target_level 2` | 알약 「E 길게 · **힌트 2/2** 열기 — 정답이 드러난다 · 도움 1」, 길게 0.9s → 자막 「힌트 2/2」 | 1 | 안내판에 「힌트 2/2」 블록이 1/2 아래 추가 |

- UI 번호는 **정식 힌트 기준(1/2, 2/2) 하나로 통일**(sheet 의 '2단계 열었는데 1단계가 나옴' 불일치 해소). PM 용어 1·2·3단계는 문서·코드 주석에서만.
- NPC 는 어느 단계에서도 정답을 말하지 않고, 정답은 「힌트 2/2」 자막·안내판 블록에서만 나온다(`npc_intervention.py:10-11`).

---

## 9. generic 모드 · 오류 · reply:null · 재시도 화면

| 상황 | 자막 자리 | 알약 | 안내판 | 서버 |
|---|---|---|---|---|
| generic | reply 는 그대로 흐름, 지문도 그대로 | 「말 걸기」만(힌트 라벨 없음) | 힌트 블록 없음 | suggest_hint 무시 |
| reply null(플레이어 턴) | 「아비사는 말없이 강을 바라본다.」 CREAM .7 2.6s(20s 에 1회) | 변화 없음 | — | 재시도 안 함 |
| reply null(auto) | 아무것도 없음 | — | — | — |
| 타임아웃 3.0s | 「아비사 ···」 유지, 3s 넘으면 점 옆 11px 「잠깐만」(reference) | — | — | 같은 pending 1회 재전송(0.5s 뒤) |
| 재전송도 실패 / 네트워크 | 「아비사가 지금은 대답할 수 없다.」 2.6s | 변화 없음 | — | 끝. 플레이어는 E 를 다시 누르면 **새 UUID** 로 새 턴 |
| 404 | 「길이 끊겼다. 잠시 뒤 다시 말을 걸어 보자.」 | enabled=false 로 전환 | — | 세션 재시작 경로(playSession.ts) |
| 409 CASE_VERSION_UNAVAILABLE | 「아비사가 지금은 대답할 수 없다.」 | enabled=false | — | 새 세션 생성 시도, 세션당 1회 console.warn |
| 409 event conflict | 표시 없음 | — | — | 새 UUID 1회 재발급 |
| 422 | 「아비사가 지금은 대답할 수 없다.」 | — | — | console.error(FE 검증 버그) |
| 500 NPC content unavailable | 같은 지문 | — | — | 재시도 없음(콘텐츠 문제) |
| 힌트 409(단계 건너뜀·잔액) | 「지금은 더 열 수 있는 힌트가 없다.」 | 라벨 원복 | 변화 없음 | — |
| 운영 기본값(빈 저장소·미승인·생성 OFF) | 매번 지문 | — | — | **v1 1차 완료 기준 = 이 경로가 깨지지 않는 것** |

- `?present`·`?present=minimal` 발표 프리셋: 자막·알약은 그대로(플레이 요소), **Enter 채팅만 끔**. 운영 기본값에서 대사가 전혀 없으면 시연 때 지문만 보이므로 발표 전 콘텐츠 게시 여부를 확인(열린 질문 ⑦).

---

## 10. 시각·모션 스펙(hudTheme 기준)

| 항목 | 값 | 근거 |
|---|---|---|
| 서체 | 본문 `HUD_FONT` 17px/1.5 500 CREAM #F2EEE4(알림 15px 보다 한 단계 커 '말'임을 구분) · 이름 줄 12px/1 600 AMBER #F2C89A letter-spacing .04em opacity .9 · 키캡 22×22 radius 6 AMBER / KEY_INK #2A2018 700 12px `KEY_FONT` | `naju01/src/puzzles/hudTheme.ts:1-7`. **로컬 FONT 재정의 금지**(PaperReadHud·PullGaugeHud·BreathHud 의 중복 패턴을 늘리지 않음) |
| 바탕 | 줄 단위 띠 rgba(14,18,26,.62) radius 6 padding 3px 10px `box-decoration-break: clone` + text-shadow 0 1px 2px rgba(0,0,0,.55). 고정 박스·테두리·그라데이션·backdropFilter 없음 | pill 관례 .72 보다 살짝 옅게 |
| 등장 | opacity 0→1, translateY(6px→0), 240ms ease-out | 로딩 자막 caption-cycle(`LoadingVideoOverlay.tsx:310-311`)과 같은 결 |
| 글자 흐름 | 28ms/자(≈36자/초, 80자 2.2s). 글자를 하나씩 붙이지 않고 `clip-path: inset(0 R 0 0)` 을 줄여 줄바꿈이 흔들리지 않게. 띠는 전체 폭으로 먼저 깔리고 글자만 흐름. 문장 부호 .?!… 뒤 180ms, — 뒤 240ms 멈춤(reference) | — |
| 머무름 | max(2.6s, 1.0s + 글자수×0.085s), 상한 8s. 힌트 ×1.5(최소 6s). 지문·오류 2.6s | — |
| 퇴장 | opacity 1→0, translateY(0→-4px), 320ms ease. 청크 사이 180ms 빈 간격. 이름 줄은 한 턴의 청크가 끝날 때까지 유지 | — |
| 대기 점 | 이름 줄 뒤 「···」 opacity .35→.9 1.2s 주기 ease-in-out | — |
| 힌트 자막 | 흐르기 없음. 왼쪽 2px AMBER 선이 0→전체 높이로 180ms 자라며 본문이 한 번에(쪽지를 펼친 느낌) | reference·adaptive |
| 제안 알약 | 라벨 교체 시 키캡 box-shadow 0 0 0 4px rgba(242,200,154,.35) 를 1.4s 주기 **2회만** 맥동 후 정지. E 길게 동안 키캡 안쪽 AMBER 아래→위 500ms(level 2 900ms) linear 차오름. 짧게 떼면 120ms 되감기. 완료 순간 알약 opacity 0 120ms | PRD S7-049 '깜빡여 존재만 알림' |
| 안내판 힌트 블록 | 붙을 때 bg rgba(242,200,154,.25)→.08 600ms 가라앉음 | adaptive |
| 채팅 입력줄 | 높이 0→40 180ms, 닫힘 역순. 포커스 링은 outline 대신 inset 1px rgba(242,200,154,.6) | — |
| prefers-reduced-motion | 흐르기·맥동·점 호흡·차오름 없음, 등장·퇴장 opacity 160ms 만 | `LoadingVideoOverlay.tsx:319` 패턴 |
| 저사양 ?q=low | 그대로(DOM 텍스트라 비용 0). blur 는 애초에 안 씀 | `src/engine/quality.ts` |
| 톤 | NPC 대사는 서버 원문 그대로(바꿔 말하기 금지, C6). FE 가 쓰는 글은 지문(「~다」 관찰 서술체, 알림 톤 `BirdHints.tsx`·`LegendTraces.tsx:44` 과 동일)·알약 라벨·오류 문구 세 종류뿐. 영문·코드 없음 | 콘텐츠 승인 범위 → 열린 질문 ⑥ |

---

## 11. 만들 때의 파일·컴포넌트 계획

새 폴더 `naju01/src/npc/` — 조사시스템·로비 상호작용 층과 합치지 않는다(메모 「로비 상호작용 층」).

| 순서 | 파일 | 역할 | 예상 분량 | 의존 |
|---|---|---|---|---|
| 1 | `src/server/api.ts` (수정) | `createPlaySession` 본문에 `content_version`, `PlaySessionState` 타입에 `hint_levels` 추가 | +30줄 | BE ① |
| 2 | `src/server/npcApi.ts` (신규) | `postNpcTurn(playSessionId, body)` / `postHint(playSessionId, puzzleId, body)`. 3.0s AbortController, 같은 pending 1회 재전송, 반환은 `{status, detailCode}` 만(영문 message 는 console). Hint 경로는 `HINT_ENDPOINT` 상수 하나(계약서 수신 후 교체) | 120줄 | 1 |
| 3 | `naju01/src/npc/dialogueCopy.ts` (신규) | 고정 말머리 `FIXED_OPENER`, 지문, 알약 라벨, status/detail → 한국어 표 | 60줄 | — |
| 4 | `naju01/src/npc/dialogueStore.ts` (신규) | `createChangeSignal + useSyncExternalStore` 모듈 스토어(`interaction.ts showNotice`·`hintBoxView.ts` 와 같은 꼴). phase·speaker·chunks·queue(≤2)·pending(동결)·offer·hintCache·hintLevels·contentMode·enabled·wasLocked. `isDeferred()` 한 함수. rAF 누적 타이머. sessionStorage 힌트 캐시 | 220줄 | 2,3 |
| 5 | `naju01/src/npc/SubtitleHud.tsx` (신규) | 바텀 자막 DOM(이름 줄·대사 줄·지문·힌트 자막·대기 점). hudTheme 만 import. reduced-motion 분기 | 180줄 | 4 |
| 6 | `naju01/src/npc/abisaInteractable.ts` (신규) | `ABISA(x22 z38.5)` 자리에 `registerInteractable({ id:'npc.abisa', label:'아비사에게 말 걸기', reach 2.5, radius 0.7, handLabel, keepHand:true, enabled: !gauge && !underwater && !cameraFocus && store.enabled, use: sendPlayerTurn(FIXED_OPENER, focusObjectId()) })`. offering 동안 `setKeyInterceptor` + keyup 으로 E 길게 판정 | 90줄 | 4 |
| 7 | `naju01/src/puzzles/InteractionHud.tsx` (수정) | offering 이면 aimed 라벨 대신 힌트 라벨 + 키캡 차오름·맥동 렌더(자리·스타일 그대로) | +45줄 | 4 |
| 8 | `naju01/src/app/PuzzleLayer.tsx` (수정) | `PuzzleHud` 목록에서 `InteractionHud` 다음에 `<SubtitleHud />` | +2줄 | 5 |
| 9 | `naju01/src/puzzles/PuzzlePanelHud.tsx` (수정) | 상태 줄 아래 힌트 블록(hintCache[현재 안내판 퍼즐]) | +40줄 | 4 |
| 10 | `naju01/src/npc/focusObject.ts` (신규) | 겨냥·근접 로컬 ID → idmap → runtime object_id. 매핑 없으면 null + 진단 로그(데이터계약 v0.4 §12). 세션 시작 신호 한 곳(`playSession.ts` 나주 어댑터 `'naju-angam-01'`) | 60줄 | 1 |
| 11 | `naju01/src/npc/DialogueInput.tsx` + `useTypingGate.ts` (신규) | 입력줄 + capture 차단기(Esc·Enter 직접 처리, 나머지 stopImmediatePropagation, preventDefault 없음) + `setKeyInterceptor(()=>true)` + wasLocked 기억 → unlock/lock. maxLength 200, trim, isComposing, 붙여넣기 자르기 | 150줄 | 4 |
| 12 | `naju01/src/npc/autoTurnLoop.ts` (신규) | `AUTO_TURN_INTERVAL_SEC = 60` 상수. 조건: isLocked ∧ !deferred ∧ 창 없음 ∧ focusObjectId 있음 ∧ 마지막 플레이어 입력 뒤 ≥60s | 60줄 | 4,10 |
| 13 | `fishTrap/PullGaugeHud.tsx` · `cave/BreathHud.tsx` (수정) | 활성 여부를 모듈 플래그로 노출(렌더 불변) | +10줄 | — |
| 14 | 검증 | `tsc -p naju01/tsconfig.json`(메모 「나주 타입검사 명령」). 빌드+정적서버 Playwright: ① ?dev 아비사 앞 E → 「아비사 ···」 → 지문(운영 기본값) ② 통발 게이지·물속·cameraFocus 중 자막 보류 ③ typing 중 'wasd1c' 가 전부 찍히고 플레이어가 안 움직이는지 ④ Enter 닫기 뒤 `pointerLockElement` 복원 ⑤ 1024·1280·1920 폭에서 자막이 bottom 36~105 띠 밖으로 안 나가는지 픽셀 비교 | — | 전부 |

합계: 신규 8파일 ≈ 940줄, 기존 수정 6파일 ≈ +130줄. **안 만드는 것**: 대화 로그 창·말풍선 3D 텍스처·선택지 버튼·마우스 클릭 UI·새 z-index 층·새 모달·`useGameHotkeys` if 순서 변경·기존 리스너 5곳 가드. 나주 힌트함(`hintBoxView.ts`·`HintBoxHud.tsx`)은 정식 힌트와 별개 층이라 손대지 않는다.

1차 완료 기준(운영 기본값에서 성립): 1~8 까지. 9~12 는 2차.

---

## 12. 열린 질문(BE / PM 에 물을 것)

| # | 대상 | 질문 | 답이 바꾸는 것 |
|---|---|---|---|
| ① | BE | 고정 말머리 「여기서 뭘 해야 할지 모르겠어요. 어떻게 해야 할까요?」 가 `puzzle_question.py` 규칙(키워드)에 걸리는가? 걸리는 문장 견본을 받고 싶다 | 안 걸리면 생성 OFF 에서 매번 지문만 봄 → 말머리 문구 |
| ② | BE | Hint API 실제 HTTP 경로·envelope·오류 코드(`…/puzzles/{id}/hints` vs v0.3.2 초안 `/help`). 이 저장소엔 라우터 미등록(`backend/app/main.py:62-121`) | `HINT_ENDPOINT` 상수·응답 파서 |
| ③ | BE | `content_mode` 를 FE 가 어디서 받는가(번들 메타? 세션 응답? 턴 응답?). generic 일 때 케이스 대사는 서버가 아예 안 보내는가(FE 는 판별 불가) | `getContentMode()` 한 함수 |
| ④ | BE | auto 턴 호출 주기 권장값. 서버 쿨다운 60s·무입력 240s·세션 3회·퍼즐 2회(`npc_decision.py:12-17`)와 맞는 FE 주기 | `AUTO_TURN_INTERVAL_SEC` |
| ⑤ | BE | 힌트 잔액 조회(hint-wallet, API-030 초안)·초기 지급량·409 HINT_BALANCE_EMPTY 확정 시점. already_unlocked 재호출이 정말 차감 0 인가 | 알약 라벨 「남은 도움 n」 추가 여부 |
| ⑥ | PM | FE 지문 「아비사는 말없이 강을 바라본다.」·오류 문구 4개가 콘텐츠 승인 대상인가(승인 전엔 「—」 만 쓸지) | dialogueCopy.ts |
| ⑦ | PM/BE | 나주 콘텐츠 게시·승인·idmap 확정 일정. 씬 물건에 interaction 이 없어(placed_no_interaction) focus_object_id 를 못 보내므로 suggest_hint·auto 가 검증 불가. 11/4 이후 시연에서 대사가 비어도 되는가 | 시연 범위·발표 프리셋 플래그 |
| ⑧ | PM | 아비사 말투(설화 인물·진부촌 처녀) — 동행 조사관 존댓말(case_001)과 다를 텐데 승인 nudge 원문의 톤 기준 | 자막 서체·이름 줄엔 영향 없음, 문서 기록용 |
| ⑨ | BE | 재열람 API(`get_puzzle_hint_state`) 라우터 등록 계획. 등록되면 sessionStorage 캐시 대신 서버 재조회로 바꿀지 | hintCache 출처 |
| ⑩ | BE | 계약서 `backend/docs/npc_fe_dialogue_ui_contract_v0.1.md` 공유 브랜치 링크 | 위 ①~⑤ 재확인 |

---

## 13. 채택하지 않은 안과 이유

| 안 | 가져온 것 | 버린 것 | 버린 이유 |
|---|---|---|---|
| **sheet** (바텀 띠·시트, 69점) | capture 차단기(Esc·Tab 제외 stopImmediatePropagation) · pending 객체 동결 재전송 · hintCache 있으면 미호출 · enabled 게이트 · sessionStorage 보관 · 2차 확인 문구(「도움 1」「정답이 드러난다」) | 상시 44px 띠 · 38vh 시트 · 48vh 스크림 · 매번 unlock 메신저 구조 · PuzzlePanelHud bottom 보정 · Tab 키 | 기록 1줄만 생기면 평소 바텀에 띠가 영구히 남고, 펼치면 아래 반을 덮는다 — 「평소 바텀은 비어 있다」 현황과 「퍼즐을 가리지 않음」 원칙에서 가장 멀다. 메신저 로그는 '게임 속 사람의 말'로 읽히지 않는다. 칩(PM 2단계)과 결과(서버 1단계) 번호 불일치. Esc 재잠금 거부 전제는 틀림 |
| **adaptive** (거리 단계형 띠, 72점) | 열기 전 잠금 기억·닫을 때만 복원 · 힌트를 대사 칸이 아닌 AMBER 선 블록으로 분리 · 자동 개입엔 수락 버튼 없음 · handLabel/keepHand 로 든 채 말 걸기 | E 로 열 때 `trigger:'auto'` 전송 · 근접 칩 · 120~168px 반모달 띠 · 매번 unlock · 리스너 6곳 가드 수정 | auto 는 서버 P3 규칙(오답 ≥6·무입력 ≥240s)용이라 말 거는 순간엔 거의 항상 null → 열 때마다 지문만 본다(계약 오독). bubble 리스너를 capture 로 못 막는다는 전제가 틀려 남의 파일 6곳 수정을 불필요하게 요구. 반모달이라 손이 끊긴다 |
| **reference** (야숨·Firewatch 대화상자, 76점) | 선택지/라벨 문구로 target_level 을 고정해 건너뛰기 409 원천 방지 · already_unlocked 면 확인 생략 · 알림 우선 규칙 · 문장 부호 뒤 멈춤 · 3s 넘으면 「잠깐만」 · 4m 이탈 종료 개념(offering 시선 이탈로 축소 채택) | FE 로컬 인사(check_in)를 아비사 대사로 · 숫자 선택지 1~4 · 173~213px 상자 · 힌트함에 텍스트 쪽지 | FE 가 지은 인사를 아비사 입에 넣는 건 「승인 line_id 원문만」(C6)과 콘텐츠 승인 전 현황을 우회하고 동행 조사관 존댓말을 설화 인물에 입히는 톤 충돌. 숫자 선택지는 대화 중 핫바를 전부 죽인다. 720p 에서 선택지 두 줄이면 29.6vh 로 자기 상한(26vh) 초과. 다른 물건 겨눈 채 E 가 그 물건으로 새는 구멍(setKeyInterceptor 거부). 힌트함(그림+한 줄 보관함)에 텍스트 항목을 넣으려면 본편 `src/game/hintBox.ts`·`HintPanel.tsx` 를 고쳐야 해 영역을 넘는다 |
| subtitle 원안의 「Enter 채팅은 선택 기능」 | — | 선택 기능 취급 | 사용자가 「엔피시 대화 채팅」이라 명시. v1 에 포함하되 운영 기본값(생성 OFF)에선 자유 문장이 null 이므로 1차 완료 기준에서는 뒤로(11절 순서 11) |
| subtitle 원안의 「generic 이면 케이스 팩 대사를 버린다」 | — | 버림 | 응답엔 source·line_id 뿐이라 FE 가 케이스 팩 여부를 판별할 수 없다. 서버가 준 reply 는 그대로 표시하고 차단은 BE 책임으로(열린 질문 ③) |
| subtitle 원안의 「다시 보기 없음」 | — | 버림 | 잔액 1 을 쓴 정답 힌트가 6초 뒤 사라지면 메모해야 한다. 퍼즐 안내판 블록 + sessionStorage 로 해소(3-4) |