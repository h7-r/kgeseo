// 나주 씬 ↔ NPC 추적 연결 훅. 매 프레임 플레이어 상자(playerState)를 읽어 추적을 한 걸음 진행하고
// NPC 메시 자리를 직접 고친다 — React state 를 쓰지 않아 프레임마다 리렌더가 나지 않는다.
// 프레임 진행 자체는 najuNpcController(순수 로직)가 하고, 이 훅은 R3F 게임 루프에 붙이기만 한다.
//
// [순서] 이 훅의 useFrame 은 usePlayerMovement(useTerrainMovement) 뒤에 등록돼야 같은 프레임의
//   플레이어 자리를 읽는다. R3F 는 우선순위가 같으면 등록 순서대로 돌고 등록은 layout effect 에서 일어난다.
//   NajuScene 본문에서 usePlayerMovement 바로 다음에 부르면 그 순서가 된다. 자식 컴포넌트 안에서 부르면
//   자식 effect 가 먼저 돌아 한 프레임 전 자리를 읽는다(그래도 동작은 하지만 한 프레임 늦다).
// [끄기] enabled=false 면 충돌·월드를 만들지 않고 매 프레임 바로 돌아간다(본편 동작과 무관).
// [행동 상태] behaviorState 저장소(Idle · Follow · Interact)를 프레임마다 getState() 로 읽어
//   「씬 active && 행동 === Follow」 일 때만 추적한다. 상태를 React state 로 옮기지 않는다(리렌더 없음).
//   저장소는 밖에서 넘길 수 있고(behaviorStore), 없으면 이 훅(= NPC 한 마리)이 자기 것을 만든다.
//   행동이 Follow 로 돌아오면 추적 코어가 그 자리에서 다시 시작한다(순간이동 없음).
// [게임 이벤트] najuGameEventSource 가 게임 상태(구역·단서·씬 완료·치운 차단물)를 읽어 이벤트로 만들고 npcEventController 에 넘긴다.
//   규칙(eventRules)이 없으면 기록만 한다. 이벤트는 행동 상태 명령만 보낸다 — NPC 위치·속도는 건드리지 않는다.
//   씬이 멈춘 동안(active=false)은 읽지 않는다. 그동안 바뀐 상태는 다시 움직이는 첫 프레임에 한 번 비교돼 나온다(잃거나 겹치지 않음).
//   마운트할 때마다 새로 만들어 첫 읽기를 기준으로 삼는다 — 이미 있던 상태로는 이벤트를 내지 않는다.
//   규칙이 바뀌어도 컨트롤러는 그대로다(setRules) — 받은 이벤트 기록·대화 중 보류분이 남는다. 저장소가 바뀔 때만 새로 만들고 지난 구독을 뗀다.
// [대화] NPC 곁(2.5 m)에서 화면에 보이고 시선이 막히지 않으면 [F] 대화 안내를 띄운다(npcTargeting). F 로 열면
//   dialogSession 이 START_INTERACT 를 보내고, 끝나면(마지막 대사 · Esc · 4 m 넘게 멀어짐 · 컷 · 씬 멈춤 · 잠금 풀림 · 공급자 실패)
//   END_INTERACT 를 한 번 보낸다. 포인터 잠금은 그대로 두고 플레이어 이동·카메라는 건드리지 않는다.
//   화면은 `.game-stage` 안의 작은 React 루트(NajuNpcDialogLayer)다 — 게임 루트·NajuScene 은 그대로다.
// [행동 추적] playerActivityTracker 가 놀이 시간(씬 active 인 프레임만) 기준 유휴 · 정체 · 구역 방문 · 진행을 센다.
//   게임 이벤트 소스와 같은 수명이다(마운트마다 새로 · 이벤트 기준 다시 잡기 rebaseline 때 같이 지움). getAiInput() 이
//   npc_ai_input/0.1 스냅숏을 만든다 — 읽기 전용 사본이고, 대사 공급자 인터페이스는 그대로다.
// [도움 제안 판단] 30 프레임마다 상태 추정(규칙 기준선 npcAssessment) → 개입 정책(helpPolicy)을 돌려 결과만 남긴다(읽기 전용).
//   OFFER_HELP 가 나와도 대화를 저절로 열거나 FSM 을 바꾸지 않는다.
// [도움 제안] OFFER_HELP 는 helpOffer 에 pending 제안으로 남고, 대화를 걸 수 있을 때만 안내가 [F] 도움 · [G] 괜찮아 로 바뀐다.
//   F = 수락(제안이 유효하고 대화가 열리면 소비 — dialog.open("hint_offer")) · G = 명시적 거절(정책 거절 쿨다운).
//   안내를 숨긴 것(멀어짐 · 컷 · 잠금 풀림)은 거절이 아니다. 실제 힌트는 없다 — 수락하면 임시 도움 대사만 나온다.
// [콘텐츠 안전] 게임에 붙일 AI 공급자는 createSafeAiDialogueProvider(dialogueContentPolicy) — 승인 대사(line_id)만 화면에 내보내고
//   막히면 검수 대사(없으면 임시 고정 대사)로 대신한다. 개발 훅도 기본은 이 길이다.
// [AI 대사] 대사 공급자에 npc_ai_input 을 맥락(aiInput)으로 싣는다. AI 공급자(aiDialogueProvider)는 dialogue.provider ·
//   helpProvider 로 넘긴다(전송은 주입 — 모델 · 백엔드는 연결하지 않았다). 개발 서버에서는 dialog.useMockAi(mode) 로
//   가짜 전송을 끼워 성공 · 실패 · 시간 초과 · 잘못된 응답을 실제 게임 루프에서 본다.
// [연결] NajuScene 연결 방법은 naju01/src/npc/INTEGRATION.md 에 있다.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import { buildPropColliders } from "../movement/propColliders";
import type { InstanceGroup } from "../placement/instanceGroups";
import type { ConnectorRamp } from "../terrain/connectorRamp";
import type { Terrain } from "../terrain/terrain";
import { createAiDialogueProvider, type AiDialogueProvider, type AiDialogueTransport } from "./aiDialogueProvider";
import { trackBehaviorStore, type TrackedBehaviorStore } from "./behaviorLog";
import { NAJU_DIALOGUE_CATALOG } from "./dialogueContent";
import { createSafeAiDialogueProvider } from "./dialogueContentPolicy";
import { TEST_DIALOGUE_CATALOG } from "./dialogueContentTestCatalog";
import { createNpcBehaviorStore, type NpcBehaviorEvent, type NpcBehaviorStore } from "./behaviorState";
import { attachDialogKeys } from "./dialogKeys";
import {
  createDialogSession,
  createInteractionPromptStore,
  type DialogCloseReason,
  type DialogSession,
} from "./dialogSession";
import { findGameStage, mountNpcDialogLayer } from "./npcDialogMount";
import { createNajuNpcWorld, pathCenterlineWaypoints } from "./najuNpcAdapter";
import type { GameEvent } from "./gameEvents";
import { createNajuGameEventSource, createGameEventPollStats, isEntryCutActive } from "./najuGameEventSource";
import { createNajuNpcController, type NajuNpcController } from "./najuNpcController";
import {
  createNpcEventController,
  DEFAULT_NPC_EVENT_RULES,
  type NpcEventController,
  type NpcEventRule,
} from "./npcEventController";
import {
  createScriptedDialogueProvider,
  PLACEHOLDER_DIALOGUE,
  PLACEHOLDER_HELP_LINES,
  type NpcDialogueObservation,
  type NpcDialogueProvider,
} from "./npcDialogue";
import { createHttpAiTransport, DEFAULT_NPC_DIALOGUE_ENDPOINT } from "./httpAiTransport";
import { createMockAiTransport, type MockAiMode } from "./mockAiTransport";
import { createHelpOfferStore, HELP_OFFER_CONFIG, promptKind, type HelpOffer } from "./helpOffer";
import { createHelpPolicy, HELP_POLICY_CONFIG, type HelpDecision } from "./helpPolicy";
import { buildNpcAiInput, type NpcAiInput } from "./npcAiInput";
import { ASSESSMENT_CONFIG, createRuleBaselineAssessor, type NpcAssessment } from "./npcAssessment";
import { npcProfile } from "./npcProfiler";
import { createPlayerActivityTracker } from "./playerActivityTracker";
import { dialogAutoCloseReason, evaluateInteraction, type InteractionResult } from "./npcTargeting";
import { isInsideNpcTestArea, NPC_TEST_AREA, NPC_TEST_SPOT } from "./npcTestConfig";

export interface NajuNpcFollowOptions {
  /** false 면 NPC 를 만들지 않는다 (?npc 가 없을 때) */
  enabled: boolean;
  /**
   * 씬이 움직이는 동안만 true — 플레이어가 걸을 수 있을 때(부감·검수 고정 중에는 false).
   * 행동 상태와는 따로다: 실제 추적은 이 값 && 행동 === Follow 일 때만 한다.
   */
  active: boolean;
  /** 행동 상태 저장소(선택). 없으면 이 NPC 의 저장소를 새로 만든다 — 초기 상태 Follow */
  behaviorStore?: NpcBehaviorStore;
  /**
   * 게임 이벤트 → 행동 명령 규칙(선택). 없으면 기록만 한다 — 실제 반응 규칙은 아직 정해지지 않았다.
   * 배열이 바뀌어도 컨트롤러는 그대로 두고 규칙 표만 바꾼다(받은 기록·대화 중 보류분 유지).
   */
  eventRules?: readonly NpcEventRule[];
  /**
   * 대화 설정(선택). 이름·대사는 기획에서 정해지지 않아 기본은 임시값(PLACEHOLDER_DIALOGUE)이다.
   * provider 를 주면 lines 대신 그 공급자를 쓴다. 대화를 열 때마다 최신 값을 읽는다.
   */
  dialogue?: {
    name?: string;
    lines?: readonly string[];
    provider?: NpcDialogueProvider;
    /** 도움 제안을 수락했을 때 대사 (없으면 PLACEHOLDER_HELP_LINES — 힌트가 아닌 임시 대사) */
    helpLines?: readonly string[];
    helpProvider?: NpcDialogueProvider;
  };
  /** true 면 대화를 걸 수 없다(편집 · 부감 등). 지금 통합 패치는 넘기지 않는다 — 편집 모드는 포인터 잠금 여부로 거른다 */
  interactionBlocked?: boolean;
  /** 나주 씬의 플레이어 상자. 읽기만 한다 */
  playerState: RefObject<AvatarLink>;
  /** 지금 씬이 쓰는 terrain (절벽 높이·높이표·치운 차단물이 반영된 것) */
  terrain: Terrain;
  /** 소품 충돌을 만들 인스턴스 무리 — 플레이어 이동과 같은 목록 */
  instanceGroups: readonly InstanceGroup[];
  /** 연결로. allowLeavingCore 와 함께 플레이어 이동의 canLeaveCore 와 같은 조건으로 코어 밖을 연다 */
  ramp: ConnectorRamp | null;
  allowLeavingCore: boolean;
}

export interface NajuNpcFollowHandle {
  /** NajuNpcBody 에 넘길 메시 ref */
  meshRef: RefObject<THREE.Mesh | null>;
  /** 추적 상태·보고값(읽기 전용으로 쓴다). enabled=false 거나 첫 프레임 전이면 null */
  controllerRef: RefObject<NajuNpcController | null>;
  /** 이 NPC 의 행동 상태 저장소 (넘겨준 것, 또는 훅이 만든 것). 대화·게임 이벤트는 여기로 dispatch 한다 */
  behaviorStore: NpcBehaviorStore;
  /** 게임 이벤트 컨트롤러 (처리 기록·대화 중 보류). 대화 UI·백엔드 이벤트도 여기로 handle 한다 */
  eventController: NpcEventController;
  /** 대화 세션 (열기 · 다음 · 닫기). 화면과 F/Enter/Esc 는 훅이 붙인다 */
  dialog: DialogSession;
  /** AI 입력 스냅숏 npc_ai_input/0.1 (읽기 전용 사본). NPC 가 꺼져 있으면 null */
  getAiInput(): NpcAiInput | null;
  /** 마지막 도움 제안 판단 (상태 추정 · 정책 결정). NPC 가 꺼져 있거나 아직 한 번도 안 돌았으면 null */
  getHelpState(): { assessment: NpcAssessment; decision: HelpDecision; offer: HelpOffer | null } | null;
}

/** 개발용 AI 공급자 선택 — 콘텐츠 정책(기본 켬) · 목록(기본 게임 목록) */
interface DevAiOptions {
  contentPolicy?: "strict" | "off";
  catalog?: "naju" | "test";
}

/** 일반 · 도움 대화용 AI 공급자 한 쌍 (개발 훅용) */
function devAiProviders(
  label: string,
  transport: () => AiDialogueTransport,
  opts: DevAiOptions,
  lines: readonly string[] = PLACEHOLDER_DIALOGUE.lines,
  helpLines: readonly string[] = PLACEHOLDER_HELP_LINES,
): { mode: string; manual: AiDialogueProvider; hint: AiDialogueProvider } {
  const policy = opts.contentPolicy ?? "strict";
  const catalog = opts.catalog === "test" ? TEST_DIALOGUE_CATALOG : NAJU_DIALOGUE_CATALOG;
  const make = (intent: "manual" | "hint_offer", base: readonly string[]) =>
    policy === "off"
      ? createAiDialogueProvider({ transport: transport(), fallback: createScriptedDialogueProvider(base) })
      : createSafeAiDialogueProvider({
          transport: transport(),
          intent,
          baseFallback: createScriptedDialogueProvider(base),
          catalog,
        });
  return {
    mode: `${label} · ${policy === "off" ? "정책 끔" : `정책 · ${catalog.id}`}`,
    manual: make("manual", lines),
    hint: make("hint_offer", helpLines),
  };
}

/** 도움 제안 판단을 몇 프레임마다 돌릴지 (60 fps 에서 0.5 s) */
const HELP_EVAL_FRAMES = 30;

/** 개발 도구에 함께 내보내는 준비 정보 */
interface NpcSetupReport {
  spot: { x: number; z: number };
  area: string | null;
  propCount: number;
  waypointCount: number;
}

export function useNajuNpcFollow({
  enabled,
  active,
  playerState,
  terrain,
  instanceGroups,
  ramp,
  allowLeavingCore,
  behaviorStore: externalStore,
  eventRules = DEFAULT_NPC_EVENT_RULES,
  dialogue,
  interactionBlocked = false,
}: NajuNpcFollowOptions): NajuNpcFollowHandle {
  const meshRef = useRef<THREE.Mesh>(null);
  const controllerRef = useRef<NajuNpcController | null>(null);
  // 개발 서버에서는 마지막 수락·거부 이벤트를 남기도록 감싼다(behaviorLog). 일반 실행은 원래 저장소 그대로다.
  const behaviorStore = useMemo<NpcBehaviorStore | TrackedBehaviorStore>(() => {
    const store = externalStore ?? createNpcBehaviorStore();
    return import.meta.env.DEV ? trackBehaviorStore(store) : store;
  }, [externalStore]);
  // 감싼 저장소(개발 서버)의 구독 — 저장소가 바뀌거나 떨어지면 뗀다
  useEffect(() => ("attach" in behaviorStore ? behaviorStore.attach() : undefined), [behaviorStore]);
  // 저장소마다 하나. 규칙은 아래 setRules 로만 바꾼다 — 규칙 배열이 바뀌어도 새로 만들지 않는다
  const eventController = useMemo(() => createNpcEventController(behaviorStore), [behaviorStore]);
  useEffect(() => eventController.attach(), [eventController]);
  useLayoutEffect(() => eventController.setRules(eventRules), [eventController, eventRules]);
  // NPC 가 꺼져 있으면 만들지 않는다 — 게임 상태를 읽지 않는다
  const gameEvents = useMemo(() => (enabled ? createNajuGameEventSource() : null), [enabled]);
  const pollStats = useMemo(() => createGameEventPollStats(), []);

  // 대화 — 설정·컨트롤러는 열 때마다 최신 값을 읽는다(상자 하나에 담아 둔다). 세션은 저장소마다 하나
  const live = useMemo<{
    dialogue: NajuNpcFollowOptions["dialogue"];
    controller: NajuNpcController | null;
    /** AI 입력 만들기 — 아래에서 만든 뒤 넣는다(대화 세션이 먼저 만들어지므로) */
    aiInput: (() => NpcAiInput | null) | null;
    /** 개발용 가짜 AI 공급자 (dialog.useMockAi) — 있으면 설정의 공급자보다 먼저 쓴다 */
    devAi: { mode: string; manual: AiDialogueProvider; hint: AiDialogueProvider } | null;
  }>(() => ({ dialogue: undefined, controller: null, aiInput: null, devAi: null }), []);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    live.dialogue = dialogue;
    activeRef.current = active;
  });
  const dialog = useMemo(
    () =>
      createDialogSession({
        store: behaviorStore,
        getProvider: (intent) =>
          live.devAi
            ? intent === "hint_offer"
              ? live.devAi.hint
              : live.devAi.manual
            : intent === "hint_offer"
              ? (live.dialogue?.helpProvider ??
                createScriptedDialogueProvider(live.dialogue?.helpLines ?? PLACEHOLDER_HELP_LINES))
              : (live.dialogue?.provider ??
                createScriptedDialogueProvider(live.dialogue?.lines ?? PLACEHOLDER_DIALOGUE.lines)),
        getSpeaker: () => live.dialogue?.name ?? PLACEHOLDER_DIALOGUE.name,
        getAiInput: () => live.aiInput?.() ?? null,
        observe: (): NpcDialogueObservation | null => {
          const report = live.controller?.report;
          if (!report) return null;
          return {
            distance: report.distance,
            zone: gameEvents?.last?.zone ?? null,
            recentEvents: eventController
              .getSnapshot()
              .log.slice(-5)
              .map((l) => `${l.event?.event_type ?? "?"}:${l.event?.target_id ?? "?"}`),
          };
        },
      }),
    [behaviorStore, gameEvents, eventController, live],
  );
  // 떨어질 때(재마운트 · 저장소 교체) 열린 대화를 닫아 Interact 에 남지 않게 한다
  useEffect(() => {
    const detach = dialog.attach();
    return () => {
      dialog.close("unmount");
      detach();
    };
  }, [dialog]);
  const prompt = useMemo(() => createInteractionPromptStore(), []);
  // 행동 · 진행 추적 — 게임 이벤트 소스와 같은 수명(NPC 가 꺼져 있으면 없음)
  const activity = useMemo(() => (gameEvents ? createPlayerActivityTracker() : null), [gameEvents]);
  const getAiInput = useMemo(
    () => (): NpcAiInput | null => {
      if (!activity) return null;
      const report = live.controller?.report;
      const snap = dialog.getSnapshot();
      return buildNpcAiInput({
        intent: snap.phase === "closed" ? null : "manual",
        dialog: snap.sessionId !== null ? { sessionId: snap.sessionId, turn: snap.turn } : null,
        activity: activity.snapshot(),
        npc: {
          behavior: behaviorStore.getState().current,
          distance: report?.player ? report.distance : null,
          following: report ? report.following : null,
          waiting: report ? report.waiting : null,
        },
      });
    },
    [activity, dialog, behaviorStore, live],
  );
  useLayoutEffect(() => {
    live.aiInput = getAiInput;
  }, [live, getAiInput]);
  // 도움 제안 판단 — 추적기와 같은 수명. 결과는 이 상자에만 남긴다
  const help = useMemo(
    () =>
      activity
        ? {
            assessor: createRuleBaselineAssessor(),
            policy: createHelpPolicy(),
            offers: createHelpOfferStore(),
            frames: 0,
            assessment: null as NpcAssessment | null,
            decision: null as HelpDecision | null,
          }
        : null,
    [activity],
  );
  const getHelpState = useMemo(
    () => () =>
      help?.assessment && help.decision
        ? { assessment: help.assessment, decision: help.decision, offer: help.offers.snapshot().current }
        : null,
    [help],
  );
  // 도움 제안 수락 · 거절 — 안내가 [F] 도움 으로 떠 있을 때만. 수락은 대화가 실제로 열린 뒤에 소비한다
  const offerActions = useMemo(
    () => ({
      accept(): boolean {
        if (!help || !activity || prompt.get() !== "help") return false;
        const now = activity.now();
        const offer = help.offers.pending(now);
        if (!offer || !dialog.open("hint_offer")) return false;
        return help.offers.accept(offer.offerId, now);
      },
      decline(): boolean {
        if (!help || !activity || prompt.get() !== "help") return false;
        const now = activity.now();
        const offer = help.offers.pending(now);
        if (!offer || !help.offers.decline(offer.offerId, now)) return false;
        help.policy.decline(offer.offerId, now);
        return true;
      },
    }),
    [help, activity, prompt, dialog],
  );
  const talkCheck = useMemo<InteractionResult>(() => ({ ok: false, reason: null, distance: NaN }), []);
  const gl = useThree((state) => state.gl);

  // 플레이어 이동(usePlayerMovement)이 만든 소품 충돌은 밖으로 나오지 않는다 — 같은 목록으로 한 벌 더 만든다.
  // instanceGroups 가 바뀔 때만 다시 만든다.
  const props = useMemo(() => (enabled ? buildPropColliders(instanceGroups) : null), [enabled, instanceGroups]);
  const waypoints = useMemo(() => (enabled ? pathCenterlineWaypoints(terrain) : []), [enabled, terrain]);
  // usePlayerMovement 의 canLeaveCore 와 같은 조건이다 — 둘이 어긋나면 NPC 만 연결로에 못 오르거나 떨어진다.
  const canLeaveCore = useMemo(
    () => (allowLeavingCore && ramp ? (x: number, z: number) => ramp.isOn(x, z) : null),
    [allowLeavingCore, ramp],
  );
  const world = useMemo(
    () =>
      enabled
        ? createNajuNpcWorld({
            playerState,
            terrain,
            props,
            canLeaveCore,
            isAllowed: NPC_TEST_AREA ? (x, z) => isInsideNpcTestArea(x, z) : null,
            waypoints,
          })
        : null,
    [enabled, playerState, terrain, props, canLeaveCore, waypoints],
  );

  // 지형·소품이 다시 만들어지면 월드만 갈아끼우고 추적 상태는 이어간다
  useEffect(() => {
    if (world && controllerRef.current) controllerRef.current.setWorld(world);
  }, [world]);

  const setup = useMemo<NpcSetupReport>(
    () => ({ spot: { ...NPC_TEST_SPOT }, area: NPC_TEST_AREA, propCount: 0, waypointCount: 0 }),
    [],
  );
  useEffect(() => {
    setup.propCount = props?.count ?? 0;
    setup.waypointCount = waypoints.length;
  }, [props, waypoints, setup]);

  const drawn = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock, camera }, delta) => {
    const mesh = meshRef.current;
    if (!world || !mesh) return;
    // 게임 이벤트 — 추적 계산과 따로, 그 앞에서 읽는다. 규칙이 행동을 바꾸면 이번 프레임 걸음부터 반영된다
    let polled: GameEvent[] | null = null;
    if (active && gameEvents) {
      const timed = npcProfile.enabled;
      const start = timed ? performance.now() : 0;
      const events = gameEvents.poll(playerState.current ?? null, terrain);
      for (const event of events) eventController.handle(event);
      pollStats.polls++;
      pollStats.emitted += events.length;
      if (timed) {
        const ms = performance.now() - start;
        pollStats.timed++;
        pollStats.totalMs += ms;
        pollStats.maxMs = Math.max(pollStats.maxMs, ms);
      }
      polled = events;
    }
    // 행동 추적 — 시계를 먼저 올리고(멈춘 동안은 안 오름) 이번 프레임 이벤트를 그 시각으로 적는다
    if (activity) {
      const link = playerState.current;
      activity.frame({
        dt: delta,
        active,
        moving: !!link?.moving,
        running: !!link?.running,
        zone: gameEvents?.last?.zone ?? null,
      });
      if (polled?.length) activity.record(polled);
    }
    const controller = (controllerRef.current ??= createNajuNpcController(world, NPC_TEST_SPOT));
    live.controller = controller;
    // 행동 상태는 매 프레임 저장소에서 바로 읽는다 — 대화 시작·종료가 그 프레임부터 반영된다
    const following = behaviorStore.getState().current === "Follow";
    mesh.position.copy(controller.step(delta, active && following, clock.elapsedTime, drawn));

    // 대화 — 이번 프레임 자리로 접근 판정(안내) · 대화 중 자동 종료. 플레이어·카메라는 읽기만 한다
    const report = controller.report;
    const lockTarget = document.pointerLockElement;
    const locked = !!lockTarget && (lockTarget === gl.domElement || lockTarget.contains(gl.domElement));
    const cutActive = isEntryCutActive();
    // 도움 제안 만료 — 유효 시간 · 새 진행 · 추정이 탐색으로 바뀜
    if (help && activity)
      help.offers.tick({
        now: activity.now(),
        progressCount: activity.progressCount(),
        assessmentState: help.assessment?.state ?? null,
      });
    if (dialog.isOpen()) {
      prompt.set(null);
      const reason = dialogAutoCloseReason({
        sceneActive: active,
        pointerLocked: locked,
        cutActive,
        distance: report.player ? report.distance : NaN,
      });
      if (reason) dialog.close(reason);
    } else {
      evaluateInteraction(
        {
          behavior: behaviorStore.getState().current,
          sceneActive: active,
          pointerLocked: locked,
          cutActive,
          blocked: interactionBlocked,
          npc: report.position,
          player: report.player,
          npcDrawn: mesh.position,
          camera,
          getCollision: () => world.collisionNear(report.position.x, report.position.z),
        },
        talkCheck,
      );
      prompt.set(promptKind(talkCheck.ok, !!(help && activity && help.offers.pending(activity.now()))));
    }

    // 도움 제안 판단 — 읽기 전용. 결정을 남기기만 하고 대화 · FSM 은 건드리지 않는다
    if (help && ++help.frames >= HELP_EVAL_FRAMES) {
      help.frames = 0;
      const input = getAiInput();
      if (input) {
        const open = dialog.isOpen();
        help.assessment = help.assessor.assess(input);
        help.decision = help.policy.decide(help.assessment, {
          sceneActive: active,
          pointerLocked: locked,
          cutActive,
          dialogOpen: open,
          canInteract: !open && talkCheck.ok,
          interactionBlock: open ? null : talkCheck.reason,
        });
        if (help.decision.action === "OFFER_HELP" && activity)
          help.offers.present(help.decision, activity.progressCount());
      }
    }
  });

  // 대화 화면 — `.game-stage` 를 못 찾으면 만들지 않는다
  useEffect(() => {
    if (!enabled) return;
    const host = findGameStage(gl.domElement);
    if (!host) return;
    return mountNpcDialogLayer(host, { session: dialog, prompt });
  }, [enabled, gl, dialog, prompt]);
  // 대화 키 — 리스너 하나. 안내가 떠 있을 때만 F 로 연다
  useEffect(() => {
    if (!enabled) return;
    return attachDialogKeys(window, {
      isOpen: () => dialog.isOpen(),
      onAction: (action) => {
        if (action === "talk") {
          const kind = prompt.get();
          if (kind === "help") offerActions.accept();
          else if (kind === "talk") dialog.open();
        } else if (action === "decline") offerActions.decline();
        else if (action === "advance") dialog.advance();
        else dialog.close("escape");
      },
    });
  }, [enabled, dialog, prompt, offerActions]);

  // 계측 스위치 — ?npcprof 일 때 켜고 훅이 떨어질 때만 끈다(포인터 잠금 · active 가 바뀌어도 그대로)
  useEffect(() => {
    if (!enabled || !import.meta.env.DEV) return;
    if (new URLSearchParams(location.search).has("npcprof")) npcProfile.enabled = true;
    return () => {
      npcProfile.enabled = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !import.meta.env.DEV) return;
    // 개발 도구: report 는 매 프레임 갱신되는 같은 객체. playerState 는 같은 프레임 자리 검사용(읽기만)
    exposeDevHook("npcFollow", {
      setup,
      playerState,
      get report() {
        return controllerRef.current?.report ?? null;
      },
      get propFilter() {
        return world?.propFilter ?? null;
      },
      // 행동 상태 — 콘솔에서 behavior.dispatch({ type: "START_INTERACT" }) 처럼 보낼 수 있다(개발 서버에서만)
      behavior: {
        get state() {
          return behaviorStore.getState();
        },
        get log() {
          return "log" in behaviorStore ? behaviorStore.log : null;
        },
        dispatch: (event: NpcBehaviorEvent) => behaviorStore.dispatch({ source: "dev", ...event }),
      },
      // 게임 이벤트 — log(처리 결과) · pending(대화 중 보류) · notes(비교 기록) · game(지금 읽은 게임 상태) · stats(읽기 비용)
      events: {
        get log() {
          return eventController.getSnapshot().log;
        },
        get pending() {
          return eventController.getSnapshot().pending;
        },
        get received() {
          return eventController.getSnapshot().received;
        },
        get notes() {
          return gameEvents?.differ.notes ?? [];
        },
        get state() {
          return gameEvents?.differ.state() ?? null;
        },
        get game() {
          const s = gameEvents?.last;
          return s
            ? {
                zone: s.zone,
                seenClues: [...s.seenClues],
                clearedScenes: s.clearedScenes,
                clearedBlockers: [...s.clearedBlockers],
                cutActive: s.cutActive,
              }
            : null;
        },
        get stats() {
          return { ...pollStats, avgMs: pollStats.timed ? pollStats.totalMs / pollStats.timed : null };
        },
        // 기준 다시 잡기 = 새 세션 — 행동 추적도 같이 지운다
        rebaseline: (reason = "dev") => {
          gameEvents?.rebaseline(reason);
          activity?.reset(reason);
          if (help) {
            help.policy.reset();
            help.offers.reset();
            help.assessment = null;
            help.decision = null;
          }
        },
        // 개발용 이벤트 주입 (계약 검사를 거친다)
        handle: (input: unknown) => eventController.handle(input),
      },
      // 한눈에 보는 요약: 행동 · 거리 · 대기 · 경로 상태
      get summary() {
        const report = controllerRef.current?.report;
        const state = behaviorStore.getState();
        return {
          behavior: state.current,
          resumeTo: state.resumeTo,
          sceneActive: activeRef.current,
          distance: report ? Number(report.distance.toFixed(2)) : null,
          following: report?.following ?? null,
          waiting: report?.waiting ?? null,
          pathStatus: report?.pathStatus ?? null,
          teleportCount: report?.teleportCount ?? null,
          pendingEvents: eventController.getSnapshot().pending.length,
          dialog: dialog.getSnapshot().phase,
          canTalk: prompt.get() !== null,
          prompt: prompt.get(),
          lastEvent: (() => {
            const last = eventController.getSnapshot().log.at(-1);
            return last
              ? `${last.event?.event_type ?? "?"}:${last.event?.target_id ?? "?"} → ${last.status}${last.reason ? `(${last.reason})` : ""}`
              : null;
          })(),
        };
      },
      // 대화 — snapshot(대화창 상태) · check(마지막 접근 판정: 막힌 이유 · 거리) · open/advance/close
      dialog: {
        get snapshot() {
          return dialog.getSnapshot();
        },
        get canTalk() {
          return prompt.get() !== null;
        },
        get prompt() {
          return prompt.get();
        },
        get check() {
          return { ...talkCheck };
        },
        open: () => dialog.open(),
        advance: () => dialog.advance(),
        close: (reason: DialogCloseReason = "user") => dialog.close(reason),
        setRules: (rules: readonly NpcEventRule[]) => eventController.setRules(rules),
        // 개발용: 가짜 AI 전송(ok · slow · invalid · error)을 끼운다 — null 이면 설정의 공급자로 돌아간다. 실제 모델이 아니다
        // 개발용: 가짜 AI 전송(ok · slow · invalid · error · catalog · spoiler)을 끼운다 — null 이면 설정의 공급자로 돌아간다. 실제 모델이 아니다.
        //   기본은 콘텐츠 정책을 거친다(승인 대사만 · 게임 목록은 검수 대사가 없어 임시 고정 대사로 대신). opts.catalog="test" 면 검사 전용 가상 목록.
        //   opts.contentPolicy="off" 는 전송 층만 보는 검사용(자유 문장이 화면에 나온다 — 게임 경로가 아니다)
        useMockAi: (mode: MockAiMode | null, opts: DevAiOptions = {}) => {
          live.devAi = mode ? devAiProviders(mode, () => createMockAiTransport(mode), opts) : null;
          return live.devAi?.mode ?? null;
        },
        // 개발용: 같은 출처 HTTP 전송을 끼운다(기본 /api/v1/npc/dialogue) — 서버가 없으면 fallback 으로 떨어진다. null 이면 해제
        useHttpAi: (endpoint: string | null = DEFAULT_NPC_DIALOGUE_ENDPOINT, opts: DevAiOptions = {}) => {
          if (endpoint === null) {
            live.devAi = null;
            return null;
          }
          const transport = createHttpAiTransport({ endpoint });
          live.devAi = devAiProviders(`http:${endpoint}`, () => transport, opts);
          return live.devAi.mode;
        },
        get aiRecords() {
          return live.devAi ? [...live.devAi.manual.records(), ...live.devAi.hint.records()] : [];
        },
      },
      // AI 입력 — input(npc_ai_input/0.1 스냅숏) · activity(추적기 사본)
      ai: {
        get input() {
          return getAiInput();
        },
        get activity() {
          return activity?.snapshot() ?? null;
        },
      },
      // 도움 제안 판단 — assessment(npc_assessment/0.1) · decision(npc_help_decision/0.1) · policy(제안·거절 기록)
      //   decline() 은 다음 단계 UI 를 흉내 내는 개발용 거절(가장 최근 제안)
      help: {
        get assessment() {
          return help?.assessment ?? null;
        },
        get decision() {
          return help?.decision ?? null;
        },
        get policy() {
          return help?.policy.state() ?? null;
        },
        get offer() {
          return help?.offers.snapshot() ?? null;
        },
        // F · G 와 같은 길(안내가 [F] 도움 일 때만)
        accept: () => offerActions.accept(),
        decline: () => offerActions.decline(),
        // 개발용: 판단 임계값 · 쿨다운 · 제안 유효 시간을 이 페이지에서만 바꾼다(브라우저 검사가 몇 분 기다리지 않게). 정책 · 제안 기록은 새로 시작한다
        configure: (overrides: {
          assessment?: Partial<typeof ASSESSMENT_CONFIG>;
          policy?: Partial<typeof HELP_POLICY_CONFIG>;
          offer?: Partial<typeof HELP_OFFER_CONFIG>;
        }) => {
          if (!help) return false;
          help.assessor = createRuleBaselineAssessor({ ...ASSESSMENT_CONFIG, ...overrides.assessment });
          help.policy = createHelpPolicy({ ...HELP_POLICY_CONFIG, ...overrides.policy });
          help.offers = createHelpOfferStore({ ...HELP_OFFER_CONFIG, ...overrides.offer });
          help.assessment = null;
          help.decision = null;
          return true;
        },
      },
      profile: {
        enable(on = true) {
          npcProfile.enabled = on;
        },
        get enabled() {
          return npcProfile.enabled;
        },
        get report() {
          return controllerRef.current?.profile() ?? null;
        },
        reset() {
          controllerRef.current?.resetProfile();
        },
      },
    });
  }, [
    enabled,
    setup,
    playerState,
    world,
    behaviorStore,
    eventController,
    gameEvents,
    pollStats,
    dialog,
    prompt,
    talkCheck,
    activity,
    getAiInput,
    help,
    offerActions,
    live,
  ]);

  return { meshRef, controllerRef, behaviorStore, eventController, dialog, getAiInput, getHelpState };
}
