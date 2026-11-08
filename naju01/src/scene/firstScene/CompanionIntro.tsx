/**
 * 첫 입장 동행 자기소개(미르 11/9 「곁의 동행 NPC 가 뭔지 당황스러울 수 있다 — 자기소개 + 어떻게 시작해 보자」).
 *  - 한 번만(저장 — 끝까지 들었을 때만). 조작이 이어진 지 1.5초 뒤, 다른 사람이 말하지 않고 창 · 연출이 없을 때.
 *  - 클로즈업(미르 11/9 「누가 어디서 말하는지 알 수가 없다」, Codex 08):
 *    1. 대화 차례부터 잡고(아비사 자동 인사 · 구렁이 경고가 끼지 않게) 동행을 카메라 앞으로 부른다(companionStage).
 *    2. 동행이 자리를 고르면 화면 고정으로 돌아보며 당겨 본다. 동행 몸 전체가 대사 상자 위 빈 곳에 들어오게
 *       당김(zoom)을 거리 · 화면 높이로 정하고, 시선은 몸 가운데보다 조금 아래를 본다(상자가 뜨면 실제 높이로 다시 맞춘다).
 *    3. 동행이 닿고 카메라가 다 돌아본 뒤 첫 줄(늦어도 PREP_LIMIT). 제 고정 중에는 대사가 멈추지 않는다(ownsFocus).
 *    4. 「물가에 누가 있어요」 줄은 당기지 않은 넓은 시야로 아비사 쪽을 보여 주고, 다 들으면 그 시선 그대로 조작을 돌려준다.
 *    자리가 없거나(소품 · 땅에 가림) 고정이 거절되면(검사 스크립트) 클로즈업 없이 대사만.
 *  - 줄마다 자동으로 넘어가고, 데스크톱 E(겨누지 않고) · 터치 「다음」 단추로 한 줄씩 넘길 수 있다. 첫 줄 전 · 멈춘 동안은 안 넘어간다.
 *  - 소개 중에는 동행 대화(E · Enter · 💬) · 구역 자동 끼어들기 · 구렁이 첫 경고를 막는다(그쪽 파일들).
 *  - 정체(소속 · 사람인지 · 정령의 기원)는 말하지 않는다 — 동행 조사관의 존재 자체가 미정이다(04 부록 I, Codex 06회차).
 *    이름표도 아직 「동행」(PM 결정 대기).
 *  - 「물가로 가 보자」는 구렁이 · 아비사와 아직 안 마주쳤을 때만(경고를 봤거나 쫓아냈거나 의뢰를 듣는 중이면 의뢰부터),
 *    의뢰를 다 들었으면 소개를 건너뛴다.
 *  - 말 걸기 안내([Enter])는 여기서 하지 않는다 — 아비사 의뢰 끝 안내 한 곳에서(Codex 06회차).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { isTouchMode } from "@/engine/input/touchMode";

import { cancelCompanionHold } from "../../companion/companionPrompt";
import { COMPANION_NAME, IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { callCompanion, companionStage, releaseCompanion, setCompanionIntro } from "../../companion/companionStage";
import { M } from "../../puzzles/units";
import { recall, remember } from "../../save/puzzleMemory";
import { cameraFocusId, endCameraFocus, focusCamera, isCameraFocusTurned } from "../cameraFocus";
import { REQUEST_LINES } from "./abisaLines";
import { firstScenePoints } from "./firstScenePoints";
import { claimTalk, isTalkTaken, releaseTalk } from "./npcSpeech";
import { NPC_SPEECH_TOP_VAR } from "./NpcSpeechHud";
import { StoryTalk, isTalkPaused, type StoryLine } from "./storyTalk";

const SAVE_KEY = "companion.introHeard";
const TALK_ID = "companion-intro";
/** 조작이 이어진 뒤 이만큼(초) 지나 말한다 */
const START_AFTER = 1.5;
/** 동행이 닿고 카메라가 돌아보기를 기다리는 한도(초) — 넘으면 그대로 첫 줄 */
const PREP_LIMIT = 3;
/** 화면 고정 이름 — 동행을 볼 때 · 물가를 보여 줄 때 */
const FOCUS_ID = "companion-intro";
const LOOK_ID = "companion-intro-look";
const ownsFocus = (id: string) => id === FOCUS_ID || id === LOOK_ID;
/** 대사가 끝나는 때를 미리 모르니 머물기는 안전 상한만 걸고 endCameraFocus 로 끝낸다 */
const HOLD = 120;

/**
 * 클로즈업 구도 — 동행(키 0.4 m, 위아래로 0.08 m 떠다님)의 반 높이(m)와, 대사 상자 위 빈 곳 중 그 몸이 차지할 몫.
 * 빈 곳 = 화면 높이 − 상자 윗변 − 위 여백(터치는 위쪽 단추 자리). 당김은 0.4~1 사이(가까운 자리일수록 덜 당긴다).
 */
const HALF_SPAN = 0.28;
const FILL = 0.75;
const MIN_ZOOM = 0.4;
const TOP_PAD = { desktop: 24, touch: 48 };

/** 초안(이야기팀 승인 전) */
const LINES = {
  hello: { text: "안녕하세요, 조사관님. 저는 이번 조사에 함께하는 동행이에요. 곁에서 도울게요." },
  place: { text: "여기는 영산강 앙암바위 아래 나루터예요." },
  go: { text: "저기 물가에 누가 있어요. 먼저 가까이 가서 살펴봐요." },
  request: { text: "아비사의 부탁부터 차근차근 풀어 봐요." },
} satisfies Record<string, StoryLine>;

/** 대사 상자 윗변(무대 아래끝에서 px) — 아직 안 떴으면 어림값(두 줄 대사 기준) */
function speechTop(height: number, isTouch: boolean) {
  const shown = parseFloat(document.documentElement.style.getPropertyValue(NPC_SPEECH_TOP_VAR));
  if (shown > 0) return shown;
  return isTouch ? Math.max(130, height * 0.36) : THREE.MathUtils.clamp(height * 0.22, 150, 200);
}

type Phase = "idle" | "prep" | "talk";

export default function CompanionIntro({ enabled }: { enabled: boolean }) {
  const talk = useMemo(() => {
    const next = new StoryTalk(TALK_ID, COMPANION_NAME, false);
    next.ownsFocus = ownsFocus;
    next.canPress = true;
    return next;
  }, []);
  const state = useMemo(
    () => ({
      isHeard: recall(SAVE_KEY, false),
      activeTime: 0,
      phase: "idle" as Phase,
      prepTime: 0,
      lines: [] as StoryLine[],
      /** 물가를 보여 줄 줄 번호(-1 = 안 보여 줌) · 이미 넘겼는지 */
      lookIndex: -1,
      hasLooked: false,
      /** 클로즈업 — 고정을 걸었나 · 당긴 시야각(°) · 화면 높이(px) · 터치인가 · 시선이 볼 자리 */
      isClose: false,
      closeFov: 60,
      height: 0,
      isTouch: false,
      target: new THREE.Vector3(),
    }),
    [],
  );

  // 클로즈업 시선 — 동행 몸 가운데를 대사 상자 위 빈 곳 가운데로 올린다(상자가 뜨면 실제 높이로)
  const closeTarget = useMemo(
    () => () => {
      const spot = companionStage.spot;
      if (!spot) return state.target;
      const { height, isTouch } = state;
      const top = TOP_PAD[isTouch ? "touch" : "desktop"];
      const free = Math.max(80, height - speechTop(height, isTouch) - top);
      const raisePx = height / 2 - (top + free / 2);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(state.closeFov) / 2);
      const camera = cameraRef.current;
      const distance = camera ? camera.position.distanceTo(spot) : 1.5 * M;
      state.target.copy(spot);
      state.target.y -= distance * (raisePx / (height / 2)) * tanHalf;
      return state.target;
    },
    [state],
  );

  useEffect(() => {
    const wrapUp = () => {
      const id = cameraFocusId();
      if (id && ownsFocus(id)) endCameraFocus(id);
      releaseCompanion();
      setCompanionIntro(false);
      releaseTalk(TALK_ID);
      state.phase = "idle";
    };
    talk.onDone = () => {
      state.isHeard = true;
      remember(SAVE_KEY, true);
      wrapUp();
    };
    // 데스크톱 E — 겨누지 않고 한 줄 넘긴다(화면 고정 중에는 겨냥 E 가 쉰다). 누르고 있기 · 첫 줄 전 · 멈춤은 무시
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (state.phase !== "talk" || !talk.press()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      talk.stop();
      wrapUp();
    };
  }, [talk, state]);

  const startTalk = (lead: number) => {
    state.phase = "talk";
    if (!talk.start(state.lines, lead)) {
      // 차례를 잡아 둔 채라 실패할 일은 없지만, 실패하면 깨끗이 물린다(저장은 안 한다)
      const id = cameraFocusId();
      if (id && ownsFocus(id)) endCameraFocus(id);
      releaseCompanion();
      setCompanionIntro(false);
      releaseTalk(TALK_ID);
      state.phase = "idle";
    }
  };

  useFrame(({ camera, size }, rawDt) => {
    cameraRef.current = camera;
    const dt = Math.min(rawDt, 1 / 20);
    if (!enabled) {
      if (state.phase !== "idle") {
        talk.stop();
        const id = cameraFocusId();
        if (id && ownsFocus(id)) endCameraFocus(id);
        releaseCompanion();
        setCompanionIntro(false);
        releaseTalk(TALK_ID);
        state.phase = "idle";
      }
      return;
    }

    if (state.phase === "talk") {
      // 「물가로 가 보자」 줄 — 동행을 보던 시선을 당기지 않은 넓은 시야로 아비사 쪽에 넘긴다(Codex 08)
      if (!state.hasLooked && talk.index === state.lookIndex && cameraFocusId() === FOCUS_ID) {
        state.hasLooked = true;
        const head = firstScenePoints.abisaHead;
        if (head) {
          focusCamera({ id: LOOK_ID, replace: true, target: head.clone(), hold: HOLD, turnIn: 1.2, zoom: 1 });
        }
      }
      talk.tick(dt);
      return;
    }

    if (state.phase === "prep") {
      state.prepTime += dt;
      const { status, spot } = companionStage;
      if (status === "picking" && state.prepTime < PREP_LIMIT) return;
      if (status === "picking" || status === "failed" || !spot) {
        // 카메라 앞에 마땅한 자리가 없다(또는 동행이 답이 없다) — 클로즈업 없이 대사만
        releaseCompanion();
        startTalk(0.2);
        return;
      } else if (!state.isClose) {
        state.height = size.height;
        state.isTouch = isTouchMode();
        const top = TOP_PAD[state.isTouch ? "touch" : "desktop"];
        const free = Math.max(80, size.height - speechTop(size.height, state.isTouch) - top);
        const distance = camera.position.distanceTo(spot) / M;
        const homeFov = (camera as THREE.PerspectiveCamera).fov ?? 60;
        const wantFov = THREE.MathUtils.radToDeg(2 * Math.atan((size.height * HALF_SPAN) / (distance * free * FILL)));
        const zoom = THREE.MathUtils.clamp(wantFov / homeFov, MIN_ZOOM, 1);
        state.closeFov = homeFov * zoom;
        state.isClose = focusCamera({ id: FOCUS_ID, target: closeTarget, hold: HOLD, turnIn: 1.0, zoom });
        if (!state.isClose) {
          // 고정이 거절됐다(검사 스크립트가 껐다) — 동행만 앞에 세워 두면 플레이어가 걸어가 버린다. 대사만
          releaseCompanion();
          startTalk(0.2);
        }
        return;
      }
      const isReady = status === "arrived" && isCameraFocusTurned(FOCUS_ID);
      if (isReady || state.prepTime >= PREP_LIMIT) startTalk(0.15);
      return;
    }

    if (state.isHeard || !IS_COMPANION_ENABLED) return;
    if (!isTalkPaused()) state.activeTime += dt;
    if (state.activeTime < START_AFTER || isTalkTaken() || isTalkPaused()) return;
    const requestNext = recall<number>("firstScene.requestLine", 0);
    // 아비사 의뢰를 다 들은 뒤라면(진행 중인 저장) 소개를 건너뛴다 — 지금 자리와 안 맞는 말이 나온다
    if (requestNext >= REQUEST_LINES.length) {
      state.isHeard = true;
      remember(SAVE_KEY, true);
      return;
    }
    // 차례부터 잡는다 — 동행이 날아오는 동안 아비사 자동 인사 · 구렁이 경고가 끼지 않게(Codex 08)
    if (!claimTalk(TALK_ID)) return;
    const isContacted =
      requestNext > 0 || recall("firstScene.serpentDriven", false) || firstScenePoints.isSerpentNoticed;
    state.lines = [LINES.hello, LINES.place, isContacted ? LINES.request : LINES.go];
    state.lookIndex = isContacted ? -1 : 2;
    state.hasLooked = false;
    state.isClose = false;
    state.prepTime = 0;
    state.phase = "prep";
    setCompanionIntro(true);
    cancelCompanionHold();
    if (IS_COMPANION_ENABLED) callCompanion();
  });

  return null;
}

/** 시선 계산이 읽는 카메라 — useFrame 이 매 프레임 적는다 */
const cameraRef: { current: THREE.Camera | null } = { current: null };
