# 나주 동행 NPC — NajuScene 통합 가이드 (1-C)

> 대상: 나주 맵 담당(`feat/나주-ts이식`). 작성 2026-10-20 · 상태: **제안** — 아직 PM 브랜치에 반영하지 않았다.
> NPC 쪽 작업 브랜치: `feat/SJ-naju-npc-sandbox` (커밋 전).

## 한 줄 요약

`?npc` 주소로 열 때만, 하늘색 구체 NPC가 실제 플레이어를 따라다닌다. `?npc` 가 없으면 **아무것도 만들지 않고 아무 계산도 하지 않는다.**
나주 쪽 변경은 `NajuScene.tsx` 17줄(+ 1-B 단계의 `App.tsx`·`runtimeFlags.ts` 9줄)이고, 플레이어 이동·카메라·지형·이벤트 코드는 건드리지 않는다.

## 1. 반영할 것

| 경로                             | 내용                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `naju01/src/npc/` (폴더 전체)    | NPC 코드. 나주 코드를 고치지 않고 읽기만 한다                                                |
| `naju01/src/app/runtimeFlags.ts` | `IS_NPC_TEST`(`?npc`, 검수 실행에서는 꺼짐) · `ALLOW_VIEW_TOGGLE`(`?npc` 일 때만 V 로 3인칭) |
| `naju01/src/app/App.tsx`         | V 전환을 `ALLOW_VIEW_TOGGLE` 일 때만 허용 (본편은 지금처럼 1인칭 고정)                       |
| `naju01/src/scene/NajuScene.tsx` | NPC 추적 훅 호출 1곳 + NPC 그리기 1줄                                                        |

세 파일의 변경은 `naju01/src/npc/naju-integration.patch` 에 있다. `feat/나주-ts이식`(0dee66d) 기준으로 만들었고, 그 트리에 깨끗이 적용되는 것을 확인했다.

```bash
# 저장소 뿌리에서 — npc/ 폴더를 먼저 들여온 뒤
git apply --check naju01/src/npc/naju-integration.patch   # 미리 보기
git apply naju01/src/npc/naju-integration.patch
```

## 2. NajuScene 변경 (패치 중 해당 부분)

```diff
 import { usePresentationOverrides } from "../app/presentation";
+import { IS_NPC_TEST } from "../app/runtimeFlags";
 ...
 import { GROUP_IDS } from "../placement/editFile";
+import NajuNpcBody from "../npc/NajuNpcBody";
+import { useNajuNpcFollow } from "../npc/useNajuNpcFollow";
 ...
   const teleport = usePlayerMovement({ ... });
+  // NPC 동행(?npc) — 반드시 usePlayerMovement 바로 뒤. 그래야 같은 프레임의 플레이어 자리를 읽는다(npc/INTEGRATION.md)
+  const npcFollow = useNajuNpcFollow({
+    enabled: IS_NPC_TEST,
+    // 플레이어가 걷는 동안과 같은 조건(usePlayerMovement 의 active·paused)
+    active: (active || isEditing) && !((isEditing && isOverview) || isReviewHold),
+    playerState,
+    terrain,
+    instanceGroups,
+    ramp,
+    allowLeavingCore: controls.allowLeavingCore,
+  });
 ...
       {IS_ANIME_VARIANT && <AnimeStyleLayer />}

+      {/* NPC 동행 개발 테스트(?npc) — 자리는 useNajuNpcFollow 가 매 프레임 직접 고친다. 여기서는 그리기만 */}
+      {IS_NPC_TEST && <NajuNpcBody meshRef={npcFollow.meshRef} />}
```

### 꼭 지켜야 할 것

1. **훅 위치는 `usePlayerMovement` 바로 뒤.** R3F `useFrame` 은 우선순위가 같으면 등록 순서대로 돈다(등록은 layout effect). NajuScene 본문에서 이동 훅 다음에 부르면 NPC 가 그 프레임에 막 갱신된 플레이어 자리를 읽는다. 자식 컴포넌트 안에서 돌리면 자식 effect 가 먼저 돌아 한 프레임 늦다. 브라우저에서 1·3인칭 모두 「NPC 가 읽은 자리 = 그 프레임 playerState」 불일치 0 프레임을 확인했다.
2. **훅은 조건 없이 부른다.** 켜고 끄기는 `enabled` 로만 한다(React 훅 규칙). `enabled=false` 면 소품 충돌·월드를 만들지 않고 매 프레임 바로 돌아간다.
3. **`active` 식은 `usePlayerMovement` 와 같아야 한다.** 부감(편집 + Tab)·검수 카메라 고정 중에는 플레이어처럼 NPC 도 멈춘다. 플레이어 쪽 조건이 바뀌면 이 식도 같이 바꾼다.
4. **`ramp`·`allowLeavingCore` 는 플레이어 이동과 같은 값.** NPC 의 연결로(코어 밖) 판정이 플레이어와 같아야 NPC 만 떨어지거나 못 오르지 않는다.

## 3. NPC 가 나주 코드에서 쓰는 것 (읽기만)

| 쓰는 것                                                               | 어디서                   | 용도                                                                                                         |
| --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `playerState` (AvatarLink)                                            | NajuScene                | 플레이어 자리(유닛·눈높이 → 미터·발 높이로 바꿔 읽음)와 진행 방향. **쓰지 않는다**                           |
| `terrain.groundAt` · `blockers` · `clearedBlockers` · `measuredPaths` | NajuScene 의 terrain     | 지면 높이·강·벼랑·코어 밖 · 도면 차단물(치우면 다음 프레임부터 빠짐) · 통로 경유점                           |
| `buildPropColliders(instanceGroups)`                                  | movement/propColliders   | 소품 충돌. 플레이어 쪽 결과가 밖으로 나오지 않아 같은 목록으로 한 벌 더 만든다 (instanceGroups 가 바뀔 때만) |
| `ramp.isOn`                                                           | NajuScene 의 ramp        | 연결로 위                                                                                                    |
| `stage.seenClues` · `stage.cut`                                       | scene/immersion/state    | 게임 이벤트: 단서 발견(director 의 임시 근접 판정) · 구역 진입 컷 중. **모듈 내부 필드 — PM 협의 사항**      |
| `focus.clearedScenes`                                                 | scene/immersion/focusFog | 게임 이벤트: 씬 완료(endScene → scenePassed, 최댓값만 올라감). **모듈 내부 필드 — PM 협의 사항**             |

## 4. 동작

| 상황                         | NPC                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 플레이어가 서 있음           | 오른쪽 뒤 동행 자리로 와서 멈춘다 (약 1.3–1.4 m)                                                            |
| 걷기·달리기·옆걸음           | 따라온다 (최대 2.8 m/s — 달리기 2.32 m/s 보다 빠름). 소품·차단물을 돌아가고 강·벼랑·코어 밖에는 서지 않는다 |
| 플레이어가 NPC 쪽으로 걸어옴 | 비켜서며 몸을 겹치지 않는다                                                                                 |
| 순간 이동(시점 키·낙하 복귀) | **따라 순간이동하지 않는다.** 12 m 안이면 걸어서 오고, 그보다 멀고 직선으로 못 가면 제자리에서 기다린다     |
| 부감·검수 고정               | 제자리에 멈췄다가 풀리면 다시 따라온다                                                                      |
| 행동 상태 Idle · Interact    | 제자리에 멈춘다(부유는 계속). Follow 로 돌아오면 그 자리에서 걸어서 다시 따라온다(순간이동 없음)            |
| `?npc=z1`                    | NPC 는 Z1(나루터) 안에서만 움직인다 — 1차 확인용                                                            |

### 행동 상태 (FSM)

훅은 `behaviorState.ts` 저장소(Idle · Follow · Interact)를 프레임마다 `getState()` 로 읽어 **`active && 행동 === Follow`** 일 때만 추적한다.
저장소는 `useNajuNpcFollow({ ..., behaviorStore })` 로 넘길 수 있고(선택), 없으면 훅이 NPC 마다 만든다. 반환값의 `behaviorStore` 로
`dispatch({ type: "START_INTERACT" })` 처럼 보낸다. 규칙은 기존 그대로다 — 대화 중 `START_FOLLOW`·`STOP_FOLLOW` 는 거부, 대화가 끝나면
시작 전 상태(Follow/Idle)로 돌아간다. 플레이어 이동·시점은 건드리지 않는다. **통합 패치는 바꿀 필요가 없다**(옵션은 선택, 반환값만 늘었다).

### 게임 이벤트

나주 게임에는 이벤트 발행·구독 장치가 없다. 훅이 매 프레임 게임 상태를 **읽기만** 해서 지난 관측과 비교하고(`najuGameEventSource.ts` →
`gameEventDiff.ts`), 새로 생긴 것만 `npcEventController` 에 넘긴다. 게임 모듈을 읽는 곳은 `najuGameEventSource.ts` 하나다.

| 이벤트            | 읽는 상태                                    | target_id              | 추가 필드       | event_id (결정적)             | 프로토타입 이름    |
| ----------------- | -------------------------------------------- | ---------------------- | --------------- | ----------------------------- | ------------------ |
| `zone_entered`    | `terrain.groundAt(플레이어 발 자리).zone`    | `Z1`~`Z4`              | `previous_zone` | `기준:zone_entered:n:이전>새` | 같음               |
| `clue_discovered` | `stage.seenClues` (내용 비교)                | 무리 이름 `씬1.구렁이` | `clue_key`      | `기준:clue_discovered:열쇠`   | `clue_acquired`    |
| `scene_cleared`   | `focus.clearedScenes`                        | 씬 번호 `"2"`          | `scene`         | `기준:scene_cleared:n`        | `puzzle_completed` |
| `blocker_cleared` | `terrain.clearedBlockers` (처음 치워진 것만) | 차단물 코드 `B2`       | —               | `기준:blocker_cleared:코드`   | 없음 (7단계 추가)  |

- **기본은 기록만.** 실제 NPC 반응 규칙이 정해지지 않아 기본 규칙 표가 비어 있다(`no-rule`). `useNajuNpcFollow({ ..., eventRules })` 로 규칙을
  넘겼을 때만 `START_FOLLOW`·`STOP_FOLLOW` 를 보낸다. 이벤트는 행동 상태만 바꾸고 NPC 위치·속도는 건드리지 않는다.
- **구역**은 플레이어 실제 자리와 지형으로 잰다(구역 초점이 꺼져도 동작). 통로·연결로(null)는 건너뛰고 직전 구역을 유지한다 — Z1 → 통로 → Z1 은 이벤트 없음.
- **씬 완료**는 최고치를 넘을 때만. 1 → 3 처럼 뛰면 3 만 내고, 건너뛴 2 는 끝났는지 알 수 없어 기록(`notes`)만 남긴다.
- **치운 차단물**: 처음 치워진 코드만 `blocker_cleared` (7단계 — 진행 추적용). 되살아났다 다시 치워져도 · 마운트 때 이미 치워져 있어도 내지 않는다.
  경로 탐색은 이 이벤트와 상관없이 충돌 세계 판 번호로 반영한다(후보 슬롯 캐시도 같이 무효).
- **마운트 · 재마운트**: 훅이 붙을 때마다 새로 만들어 첫 읽기를 기준으로 삼는다. 이미 있던 상태로는 이벤트를 내지 않는다.
- **줄어듦**(단서 빠짐 · 씬 수 내려감 · 차단물 되살아남): 세션 재시작으로 단정하지 않는다. 이벤트 없이 기록만 하고, 이미 낸 단서·씬 최고치는
  잊지 않는다. 공식 세션 식별자가 없어서다 — 세션 시작 신호가 생기면 `rebaseline()` 을 부르게 한다(그 뒤 ID 앞머리가 바뀐다).
- **대화 중**: 규칙이 있는 이벤트는 보류했다가 대화가 끝나면 채널(동행 모드)마다 마지막 것만 적용한다. 규칙 없는 이벤트는 바로 기록한다.
- **씬 멈춤**(`active=false`): 읽지 않는다. 그동안 바뀐 상태는 다시 움직이는 첫 프레임에 한 번 비교돼 나온다(잃거나 겹치지 않음).
  NPC 가 꺼져 있으면(`enabled=false`) 게임 상태를 아예 읽지 않는다.
- **못 보는 것**: 차단물 무너짐 연출 중인지(NajuScene 안의 `collapseRef`) · `endScene(n)` 을 이미 지난 낮은 번호로 부른 경우(카운터가 안 바뀜) ·
  사건(`playEvent`) 호출 자체(상태를 남기지 않음 — 「구렁이」는 단서 열쇠로만 보인다).
- **규칙 교체**: `eventRules` 배열이 바뀌어도 컨트롤러를 새로 만들지 않는다(`setRules`) — 받은 이벤트 기록·대화 중 보류분이 남고, 보류분은
  받을 때 정한 행동을 그대로 쓴다. 행동 상태 저장소가 바뀔 때만 새로 만들고 지난 구독을 뗀다.

### 행동 · 진행 추적 (AI 입력 재료)

`playerActivityTracker.ts`(순수) 가 매 프레임 플레이어 상태와 게임 이벤트를 받아 세고, `npcAiInput.ts` 가 `npc_ai_input/0.1` 스냅숏을 만든다
(훅 반환값 `getAiInput()` · 개발 훅 `__game.npcFollow.ai.input`). AI 모델 · 힌트 판단은 아직 없다.

- **시계**: 씬이 움직이는 프레임(active)의 delta 만 더하는 「놀이 시간」. 한 프레임 최대 0.1 s(탭 복귀로 튀어도). 부감 · 검수 고정 · 잠금 전에는 멈춘다.
- **유휴**: 마지막으로 움직인 뒤 놀이 시간. **정체**: 마지막 진행 뒤 놀이 시간(진행이 없으면 추적 시작부터).
- **진행**: `scene_cleared` · 처음 보는 `clue_discovered`(열쇠) · 처음 보는 `blocker_cleared`(코드)만. `zone_entered` 는 탐색이라 진행이 아니다.
  같은 event_id 는 무시하고, 다른 event_id 라도 같은 열쇠 · 코드 · 씬 번호면 다시 세지 않는다.
- **구역 방문**: 프레임의 구역 변화로 센다(통로 null 은 건너뜀 · 처음 서 있던 구역도 1).
- **세션**: 게임 이벤트 소스와 같은 수명 — 마운트마다 새로 만들고, 이벤트 기준을 다시 잡을 때(`events.rebaseline()`) 같이 지운다. 지난 기록은 복원하지 않는다.
- **null 로 두는 것**: `puzzle` · `backend` · `session.play_session_id` · `player.distance_travelled_m`(게임의 `MovementReport` 에 있지만 훅에 연결되지 않음 —
  쓰려면 통합 패치에서 `reportRef` 를 넘겨야 한다) · 모르는 NPC 거리. 단서는 임시 근접 「발견」이라 백엔드 `acquired_clue_ids` 와 다르다.

### 도움 제안 판단 (규칙 기준선 · 읽기 전용)

훅이 30 프레임마다 `getAiInput()` → 상태 추정(`npcAssessment.ts`, `npc_assessment/0.1`) → 개입 정책(`helpPolicy.ts`, `npc_help_decision/0.1`)을
돌려 결과만 남긴다. **`OFFER_HELP` 가 나와도 대화를 저절로 열거나 FSM 을 바꾸지 않는다** — 아래 「도움 제안」으로 안내만 바뀐다.
추정기는 `PlayerStateAssessor` 계약이라 학습 모델로 바꿀 수 있고, `assessmentEval.ts` 로 같은 시나리오(`checks/assessmentScenarios.ts`)에서 비교한다.

| 상태                | 조건 (임시 임계값 — `ASSESSMENT_CONFIG`)                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `INSUFFICIENT_DATA` | 놀이 시간 < 120 s · 구역 모름 · (진행 없음 중) 180 s 넘게 움직이지 않음(자리를 비웠을 수 있음)                                 |
| `EXPLORING`         | 마지막 진행 뒤 < 300 s · 또는 진행은 없지만 반복 방문이 없거나 최근 120 s 안에 처음 가 보는 구역에 들어섬                      |
| `POSSIBLY_STUCK`    | 마지막 진행 뒤 ≥ 300 s **그리고** 그 뒤 같은 구역 재진입 ≥ 2 **그리고** 최근 새 구역 없음 **그리고** 180 s 넘게 멈춰 있지 않음 |

- 진행 없음 · 오래 머묾 · 멈춰 있음 하나만으로는 `POSSIBLY_STUCK` 이 아니다. 퍼즐 정답 · 오답 · 힌트 단계는 없는 데이터라 쓰지 않는다.
- 재진입은 마지막 진행 뒤 `recent_events`(최근 10개)의 `zone_entered` 로 센다 = 진입 수 − 서로 다른 구역 수. 창 시작 때 서 있던 구역으로의 복귀는
  못 봐서 하나 적게 셀 수 있다(막힘을 덜 보는 쪽).
- 정책 `WAIT` 이유: `GAME_INACTIVE` · `POINTER_UNLOCKED` · `CUTSCENE_ACTIVE` · `DIALOG_ACTIVE` · `INTERACTION_BLOCKED`(대화 접근 판정 실패) ·
  `PLAYER_DECLINED` · `COOLDOWN_ACTIVE` · `INSUFFICIENT_DATA` · `NOT_STUCK`. 하나라도 있으면 WAIT, 없을 때만 `OFFER_HELP`(제안 번호).
- 쿨다운(임시 — `HELP_POLICY_CONFIG`): 제안 뒤 180 s · 거절 뒤 600 s, 모두 놀이 시간. 「같은 말을 자주 하지 않는다」 쪽으로 보수적으로 잡은 출발점이고
  플레이 테스트로 다시 정해야 한다. 제안한 순간 쿨다운이 걸려 같은 판단을 거듭 불러도 제안은 한 번이다.
- 세션: 추적기와 같은 수명(마운트마다 새로 · `events.rebaseline()` 때 같이 지움).

### 도움 제안 (안내 · 수락 · 거절)

`OFFER_HELP` 는 `helpOffer.ts` 에 pending 제안 하나로 남는다. 대화를 걸 수 있을 때(접근 판정 통과)만 안내가 `[F] 도움 · [G] 괜찮아` 로 바뀐다.

| 입력 / 일        | 동작                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| F (도움 안내 중) | 제안이 유효하면 `dialog.open("hint_offer")` → `START_INTERACT`(source `dialog:hint_offer`) → 열리면 제안 소비(accepted). 임시 도움 대사 |
| G (도움 안내 중) | 명시적 거절 → 제안 declined · `helpPolicy.decline(offer_id)` → 거절 쿨다운. 같은 제안 두 번째 거절은 무시                               |
| 안내가 숨겨짐    | 멀어짐 · 컷 · 잠금 풀림 · 씬 멈춤 — **거절이 아니다**. 제안은 pending 그대로(다시 걸 수 있게 되면 안내가 돌아옴)                        |
| 만료             | 유효 시간 60 s(임시 · 놀이 시간) · 새 진행 · 추정이 EXPLORING 으로 바뀜 · 새 제안이 옴(superseded) · 세션/정책 초기화                   |

- 추정이 `INSUFFICIENT_DATA` 로 바뀐 것만으로는 만료하지 않는다(오래 서서 생각 중일 수 있다).
- 같은 `offer_id` 는 한 번만 받는다. 수락 · 거절된 제안은 다시 뜨지 않고, 다음 안내는 정책의 새 제안 번호다.
- 실제 힌트는 없다(퍼즐 · 힌트 데이터 없음). 수락하면 `PLACEHOLDER_HELP_LINES`(검수 전 임시 — 정답 · 단서 · 길을 알려 주지 않는 말)가 나온다.
  실제 대사는 `dialogue.helpLines` · `dialogue.helpProvider` 로 넘긴다.
- G 는 게임 · 편집기 · 공용 엔진 어디서도 쓰지 않는 키다(E · F · V · T · H · O · N · C · Tab · Space · 숫자 · 이동 키와 겹치지 않음). 대화 중에는 G 를 받지 않는다.
- `dialog.open(intent?)` 와 `NpcDialogueContext.intent?` 는 선택이다 — 인자 없는 `open()` 과 intent 를 모르는 공급자는 그대로 동작한다(manual).

### AI 대사 공급자 (어댑터 · 검증 · 시간 초과 · fallback)

`aiDialogueProvider.ts` 는 기존 `NpcDialogueProvider`(open · next) 계약 그대로 대사를 AI 전송(`AiDialogueTransport`)에 묻는다.
**모델 · 백엔드는 연결하지 않았다** — 전송은 주입한다(지금은 검사 · 개발용 가짜 전송 `mockAiTransport.ts` 뿐). 붙일 때는
`dialogue.provider = createAiDialogueProvider({ transport, fallback: createScriptedDialogueProvider(lines) })` (도움 대화는 `helpProvider`).

- **요청** `npc_dialogue_request/0.1`: kind(open/next) · session_id · turn · intent(manual/hint_offer) · speaker · observation · `ai_input`(npc_ai_input/0.1) · final_turn.
  `ai_input` 은 대화 세션이 요청마다 맥락(`NpcDialogueContext.aiInput`, 선택 필드)에 싣는다.
- **검증**: 응답은 `{ text, last?, end? }` 만 쓴다. text — 비지 않은 문자열 · 200자 이하 · 제어 문자 · 방향 바꿈 문자 없음(줄바꿈 · 탭은 허용).
  `last` · `end` 는 boolean 만. AI 가 보낸 `speaker` 는 버린다(NPC 이름은 설정 값). 첫 대사에 `end` 는 받지 않는다.
  **내용(힌트 · 정답 노출 등)은 판단하지 않는다** — 다음 단계의 내용 정책이다.
- **시간 초과**: 전송 2.5 s(대화 세션 응답 제한 5 s 보다 짧게 — fallback 이 세션 안에 답한다). 넘으면 전송을 끊는다.
- **fallback**: 시간 초과 · 전송 실패 · 잘못된 응답이면 고정 대사 공급자가 같은 차례를 답한다. 한 세션에서 한 번 넘어가면 그 세션 끝까지 fallback
  (AI · 고정 대사가 번갈아 나오지 않게). fallback 마저 실패하면 대화 세션이 닫는다(error) — FSM 은 Interact 에 남지 않는다.
- **취소**: 세션이 요청을 끊으면(닫힘 · 지난 세션) 전송도 끊고 fallback 을 부르지 않는다.
- **차례 한도** 6: 마지막 차례는 AI 가 `last` 를 안 붙여도 마지막으로 치고, 그 뒤는 묻지 않는다.
- 결과 기록(`records()`): 차례마다 source(ai · fallback · aborted) · 이유(timeout · transport_error · invalid_response · sticky_fallback · end_on_open) · 걸린 시간.

### HTTP AI 전송 (같은 출처 API)

`httpAiTransport.ts` 의 `createHttpAiTransport({ endpoint })` 는 AI 공급자의 전송을 **같은 출처 상대 경로**(기본 `/api/v1/npc/dialogue`, 설정으로 바꿈)에 잇는다.
다른 출처 · 프로토콜 상대(`//…`) · 상대 경로가 아닌 주소는 만들 때 거부한다 — 브라우저가 외부 모델 서비스에 직접 붙지 않는다.
인증은 같은 출처 쿠키(`credentials: "same-origin"`)뿐이고 헤더로 키를 넣는 옵션이 없다. FastAPI 쪽 엔드포인트는 아직 없다.

- **요청**: `POST` · `Content-Type: application/json` · 본문 = `npc_dialogue_request/0.1` 그대로. AbortSignal 로 fetch 를 끊는다.
- **응답 봉투** `npc_dialogue_response/0.1`: `{ schema, session_id, turn, response_id?, text?, last?, end? }`. 요청의 `session_id` · `turn` 과 같아야 쓴다.
  같은 세션에서 `response_id` 가 다시 오면 버린다(중복 표시 없음). 대사 필드는 공급자의 검증을 그대로 거친다.
- **실패 → fallback**: HTTP 4xx · 5xx · 네트워크 실패 = `transport_error` · JSON 아님 · 봉투 틀림 · 다른 세션/차례 · 중복 = `invalid_response` ·
  2.5 s 넘으면 `timeout`(fetch 끊음) · 세션이 끊으면 fetch 도 끊고 fallback 없음.
- **보내는 데이터**: `ai_input` 은 발견한 단서(`seenClues`)만 담고, 퍼즐 · 정답 필드는 없다(`puzzle` · `backend` 는 null).
- **모의 엔드포인트**: 독립 검사는 `mockAiEndpoint.ts`(fetch 모양 함수 · 진짜 Response), 브라우저 검사 [2g] 는 Playwright `page.route` 가 같은 경로를 네트워크에서 가로챈다.
  개발 서버 · FastAPI 는 그대로다. 개발 훅 `dialog.useHttpAi(endpoint?)` 로 실제 게임에 끼워 볼 수 있다(서버가 없으면 fallback).

### AI 대사 콘텐츠 안전성

게임에 붙일 AI 공급자는 **`createSafeAiDialogueProvider`**(`dialogueContentPolicy.ts`) 다 — 형식 검증 뒤 콘텐츠 정책을 거친 것만 화면에 나간다.
개발 훅 `useMockAi` · `useHttpAi` 도 기본은 이 길이다(`{ contentPolicy: "off" }` 는 전송 층만 보는 검사용).

- **유형**: `ambient`(일반 동행 · 상황 반응) · `help_offer`(도움 수락 뒤 일반 반응) · `puzzle_hint`(퍼즐 진행에 영향). `hint_offer` 는 대화를 연 **까닭**이고
  `puzzle_hint` 는 대사 **내용 유형**이다. manual 대화 → `ambient` 만 · hint_offer 대화 → `help_offer` 만. **`puzzle_hint` 는 늘 막는다**(퍼즐 정의 · 힌트 해금 정보 없음).
- **승인 대사 우선**: 응답이 `line_id` 로 승인 대사를 고르면, 목록에 있고 · 유형이 같고 · 검수됐고(`reviewed`) · 지금 상태 조건(구역 · 발견 단서 · 끝낸 씬)이
  맞을 때만 **목록의 문장**을 내보낸다(AI 가 덧붙인 문장은 버림). 응답 봉투에 선택 필드 `content_type` · `line_id` 가 늘었다.
- **자유 문장은 내보내지 않는다**(`FREE_TEXT_NOT_APPROVED`, 기본 `allowFreeText: false`). 표현 목록 대조(`screenFreeText`)로 미발견 단서 · 정답 · 반전 ·
  상태 모순(끝내지 않은 일을 끝냈다고 함) · 없는 구역 · 힌트 말투를 찾아 개발 기록에 남기지만, **이 대조는 완전하지 않다** — 목록에 없는 바꿔 말하기 ·
  지어낸 정보는 놓친다(평가셋에서 실제로 놓침을 확인). 그래서 자유 문장 허용은 평가 · 개발용 설정이다.
- **요청 검사**: 요청에 아직 비밀인 말(목록의 미발견 단서 · 정답 · 반전 표현)이 섞이면 보내지 않는다(`unsafe_request`). `ai_input` 은 원래 발견한 단서만 담는다.
- **막히면** 검수된 같은 유형 대사로 대신하고, 검수 대사가 하나도 없으면 지금의 임시 고정 대사로. 이유는 기록(`aiRecords` · `content_rejected`)에 남는다.
- **목록**: 게임 목록 `NAJU_DIALOGUE_CATALOG` 는 **비어 있다**(검수 대사 · 퍼즐 · 단서 데이터가 없음 — 지어내지 않았다). 그래서 지금 게임에서는 AI 응답이
  모두 막히고 임시 고정 대사가 나온다. 검사는 ⚠ 가상 목록 `dialogueContentTestCatalog.ts`(실제 데이터 아님)로 한다.

### 대화

| 항목    | 동작                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 안내    | NPC 와 2.5 m 안 · 카메라 화면 안 · 충돌 세계 기준 시선이 트임 · 포인터 잠금 · 진입 컷 아님 · 대화 중 아님 → 화면에 `[F] 대화`               |
| 열기    | F → `START_INTERACT` 가 수락될 때만 대화창(이름 · 대사). NPC 는 그 자리에 멈춘다                                                            |
| 넘기기  | F · Enter → 다음 대사. 마지막 대사 뒤 F · Enter → 닫기                                                                                      |
| 닫기    | 마지막 대사 · Esc(보조) · 4 m 넘게 멀어짐 · 진입 컷 시작 · 씬 멈춤 · 포인터 잠금 풀림 · 대사 공급자 실패·시간 초과 · 언마운트               |
| 닫힌 뒤 | `END_INTERACT` 한 번 → 대화 전 상태(Follow · Idle)로. 대화 중 보류된 게임 이벤트가 적용되고, NPC 는 순간이동 없이 다시 따라온다             |
| 입력    | 키 반복 · Ctrl/Alt/⌘ 조합 · IME 조합 중 · 입력창 포커스는 무시. Shift 는 달리기 키라 허용. 게임 키를 가로채지 않는다                        |
| KeyE    | 쓰지 않는다 — 게임의 편집 모드 토글 그대로                                                                                                  |
| 포인터  | 잠금을 그대로 둔다. 플레이어 이동·카메라는 건드리지 않는다(대화 중에도 걸을 수 있고, 멀어지면 대화가 닫힌다)                                |
| 화면    | `.game-stage` 안에 따로 붙인 React 루트(`npcDialogMount.tsx` · `NajuNpcDialogLayer.tsx`). 못 찾으면 만들지 않는다. z-index 26               |
| 대사    | `NpcDialogueProvider`(`open` · `next`) — 지금은 고정 대사만. 이름·대사 기본값은 임시(`PLACEHOLDER_DIALOGUE`)이고 `dialogue` 옵션으로 넘긴다 |

- **편집 · 부감**: 부감(편집 + Tab)은 씬 active=false 로 막힌다. 편집 모드 자체는 훅이 모른다 — 편집 중엔 대개 포인터 잠금을 풀고 쓰므로
  잠금 조건으로 걸러진다. 잠근 채 편집 모드면 안내가 뜬다(F 는 편집기가 쓰지 않아 충돌은 없다). 정확히 막으려면 통합 패치에서
  `interactionBlocked: isEditing` 을 넘겨야 한다(PM 협의).
- **시선 판정의 한계**: 렌더 메시가 아니라 충돌 모형으로 잰다. 실제 씬에서 잰 차이는 6절 표에 있다.

떠 있는 높이는 지면 + 1.3 m, 충돌 반경 0.35 m, 보이는 반지름 0.2 m.
NPC 보다 낮은 소품(통발 등)은 넘어 다니고, 몸 높이에 닿는 소품만 막는다(소품마다 한 번 정한다).

## 5. 확인 방법

```powershell
npx.cmd tsc -p naju01
npx.cmd eslint naju01/src/npc naju01/src/scene/NajuScene.tsx
npx.cmd prettier --check naju01/src/npc
npx.cmd vite naju01        # http://localhost:5174/?npc · ?npc=z1 · V 로 3인칭
```

콘솔에서 `__game.npcFollow.report` (거리·추적 여부·경로 상태·걸음 비용), `__game.npcFollow.setup` (소품 수·경유점 수),
`__game.npcFollow.propFilter` (소품 높이 필터 결과)를 볼 수 있다 — 개발 서버에서만.
`__game.npcFollow.summary` 는 행동 상태·씬 active·거리·추적 여부·대기·경로 상태를 한 번에 보여 주고,
`__game.npcFollow.behavior` 는 `state` · `log`(마지막 수락·거부 이벤트) · `dispatch(event)` 창구다.
`__game.npcFollow.events` 는 게임 이벤트 — `log`(처리 결과 최근 20) · `pending`(대화 중 보류) · `notes`(비교 기록: 건너뛴 씬·줄어듦·치운 차단물) ·
`game`(지금 읽은 게임 상태) · `state` · `stats`(읽기 횟수·비용) · `rebaseline()` · `handle(event)`(계약 검사를 거치는 주입).
`__game.npcFollow.ai` 는 `input`(npc_ai_input/0.1) · `activity`(추적기 사본). `events.rebaseline()` 은 추적기 · 도움 정책도 같이 지운다.
`__game.npcFollow.help` 는 `assessment`(npc_assessment/0.1) · `decision`(npc_help_decision/0.1) · `policy`(제안 · 거절 기록) · `offer`(지금 · 지난 제안) ·
`accept()` · `decline()`(F · G 와 같은 길 — 도움 안내 중일 때만) · `configure({ assessment, policy, offer })`(개발용 — 이 페이지에서만 임계값 · 쿨다운 · 유효 시간을 바꿈).
`__game.npcFollow.dialog.useMockAi(mode)` 는 개발용 가짜 AI 전송(`ok` · `slow` · `invalid` · `error`, null 이면 해제) — 실제 모델이 아니다.
`dialog.aiRecords` 에 차례별 결과가 남는다. `dialog.useHttpAi(endpoint?)` 는 같은 출처 HTTP 전송을 끼운다(null 이면 해제).
`__game.npcFollow.dialog.prompt` 는 지금 안내 종류(`talk` · `help` · null), `dialog.snapshot.intent` 는 대화를 연 까닭(`manual` · `hint_offer`).
`__game.npcFollow.dialog` 는 대화 — `snapshot`(대화창 상태 · 마지막 닫힌 이유) · `canTalk` · `check`(접근 판정: 막힌 이유 · 거리) ·
`open()` · `advance()` · `close()` · `setRules(rules)`. `summary` 에도 `dialog` · `canTalk` 가 있다.
계측 스위치는 포인터 잠금·`active` 가 바뀌어도 그대로다(훅이 떨어질 때만 끈다).
`?npc&npcprof` 로 열면 계측이 켜지고 `__game.npcFollow.profile.report` 에 느린 프레임 상위 10 · 단계별 시간 · 경로·후보·지형 표본 횟수 ·
그래프 예산 때문에 미룬 횟수가 쌓인다.

회귀 검사는 `naju01/src/npc/checks/README.md` 참고 — `run-npc-checks.mjs` 는 통합 전에도, `browser-follow.mjs` 는 통합 뒤에 돈다.

참고: 이 체크아웃은 CRLF 로 받아져 `prettier --check naju01/src/scene/NajuScene.tsx` 가 패치 전부터 경고를 낸다. `--end-of-line crlf` 로는 패치 전·후 모두 통과한다.

## 6. 측정값 (10/21, 헤드리스 Chrome)

| 항목                                              | 결과                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-npc-checks.mjs` (실제 씬 지형·소품 1623개)   | 443개 (기존 426 + 행동 판단 평가셋 Q 17). 10/22 3회: 441/442(내 검사 실수) · 442/443(Follow→Idle→Follow 한 프레임 17.2 ms — 기계 멈춤) · 443/443                                                                                                                                                                                                                |
| 추적 시나리오 (정지·걷기·달리기·근접·소품·강가 …) | 관통 0 · 못 걷는 땅 0 · 순간이동 0 · 4 ms 초과 0 · 최대 3.3 ms                                                                                                                                                                                                                                                                                                  |
| 우회 부하 (소품 둘레를 계속 돌아 우회를 강제)     | 10/20 기준 0/2401 · 3.5 ms. 그 뒤 8회: 0–28/2401 · 최대 3.5–9.3 ms (1회 28 로 1% 기준 실패). 8회 모두 그래프 풀이 394 · 미룸 36/544 로 일이 같고, 4 ms 초과 수는 풀이당 시간(0.78–1.46 ms)을 따라간다 — 0.78–0.93 ms 인 실행은 0–6, 1.17–1.46 ms 인 실행은 17–28. 이 검사는 이벤트 · 대화 · 추적 코드를 거치지 않는다 → 회귀가 아니라 기계 속도 흔들림으로 본다 |
| 소품 높이 필터 초기화                             | 40–83 ms · 지형 표본 59,599회 · 판정 결과 1,623 바이트 (옛 다섯 점: 10–17 ms · 8,115회)                                                                                                                                                                                                                                                                         |
| 소품 판정 정확도                                  | NPC 높이 규칙 기준(갈 수 있는 소품 405개) 놓침 0 · 과잉 12 (옛 다섯 점도 놓침 0 · 과잉 12). 경계 사례(±0.1 m) 210개                                                                                                                                                                                                                                             |
| `browser-follow.mjs` (패치 적용 복제본)           | 대화 [2d] 포함 3회: 1회차 실패 5(검사 순서 — KeyE 가 편집 모드로 포인터 잠금을 풀어 뒤의 F 가 막힘. T 로 다시 잠그도록 고침) · 2·3회차 전부 통과(입력 재시도 2 · 0). 게임 이벤트 [2c] 1·3인칭 통과                                                                                                                                                              |
| 계측 부담                                         | 꺼짐·켜짐 걸음 평균 차이가 측정 잡음 안. 게임 이벤트 읽기: 프레임당 평균 0.03–0.05 ms · 최대 0.4–7.9 ms(헤드리스)                                                                                                                                                                                                                                               |
| 대화 시선 판정 (실제 씬, 렌더 광선과 비교)        | 충돌로 막힘 40쌍 중 렌더도 막힘 33 · 충돌만 막힘 7(원기둥이 그림보다 굵음). 충돌로 트인 29쌍 중 렌더는 막힘 5(잎·장식 등 충돌 모형에 없는 그림)                                                                                                                                                                                                                 |
| 행동 추적 비용                                    | 추적기 한 프레임 0.0002 ms · AI 입력 만들기 0.008 ms(스냅숏 포함 — 대화 · 디버그 때만)                                                                                                                                                                                                                                                                          |
| 상태 추정 비용                                    | 한 번 0.004 ms (훅은 30 프레임마다) · 평가 시나리오 11개 규칙 기준선 11/11(설계 의도 표시 기준)                                                                                                                                                                                                                                                                 |
| 행동 판단 평가셋(합성 · 초안 레이블)              | 규칙 기준선: 포함 28 사례 상태 · 개입 일치 0.929 · OFFER_HELP P 1.000 R 0.750 F1 0.857 · 제외 2(퍼즐 정보 없음). 실제 플레이어 정확도가 아니다 — `checks/BEHAVIOR_EVAL.md`                                                                                                                                                                                      |
| FPS                                               | 헤드리스라 판단 불가 (30.6 → 35.2 · 34.2 → 29.4). **실제 GPU 에서 다시 재야 한다**                                                                                                                                                                                                                                                                              |

## 7. 되돌리기

```bash
git apply -R naju01/src/npc/naju-integration.patch
```

또는 NajuScene 의 훅 호출·`<NajuNpcBody>` 줄과 import 3줄만 지우면 된다. `?npc` 없이는 원래부터 동작 차이가 없다.

## 8. 남은 것

- `NajuNpcMarker.tsx`(고정 구체)는 통합 전 지금 호출 자리를 받치는 임시판이다. 통합 후에는 쓰이지 않으니 지워도 된다.
- 실제 GPU FPS, 1인칭에서 NPC 가 시야를 가리는 경우(페이드), 멀리 떨어졌을 때 다시 합류하는 방식은 다음 단계에서 정한다.
- 행동 상태(Idle · Follow · Interact)와 게임 이벤트 관측은 연결됐다. 실제 반응 규칙(`eventRules`)과 대화 UI·대화 키는 아직 없다 —
  반환값 `behaviorStore` · `eventController` 로 다음 단계에서 붙인다.
- PM 협의: ① `stage.seenClues` · `stage.cut` · `focus.clearedScenes` 를 공식 API 가 아닌 모듈 필드로 읽어도 되는지(읽기 getter 를 두면 더 안전하다)
  ② 이벤트별 NPC 반응 규칙 ③ 이벤트 이름(`clue_discovered` · `scene_cleared`) ④ 세션 시작 신호(지금은 없음) ⑤ 단서 판정이 임시(2.5 m 근접)라 바뀌면 어댑터도 바뀐다.
