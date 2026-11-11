/**
 * 첫 장면(나루터) 아비사 · 구렁이 — 기획(04 Scene 구성표 Scene 01 · 부록 E)대로 움직인다(미르 11/8, Codex 03 · 04회차).
 *
 * 흐름
 *  1. 구렁이가 아비사 곁에 똬리를 틀고 있다. 늘 숨 쉬고 고개를 흔들며 가끔 혀를 날름. 7 m 안에 오면 고개를 들고 플레이어 쪽으로,
 *     처음 한 번 낮게 쉬익 + 「가만두면 위험해 보인다」(조사관의 판단). 아비사는 두려워하지 않고 가만히 구렁이를 지켜본다.
 *  2. 구렁이를 겨누고 [E] 「구렁이를 쫓아낸다」 → 움찔 고개를 쳐들었다가 물가로 미끄러지며 강물 속으로 가라앉아 사라진다(첨벙).
 *     정체 설명은 없다. 「첫 등장이 끝났다」만 저장한다(firstScene.serpentDriven) — 뒤 장면의 재등장은 따로(아직 없음).
 *  3. 아비사가 사라진 쪽을 잠깐 바라보다가 플레이어에게 돌아서 살짝 숙여 인사하고 의뢰(대사 여섯 줄 — 필수 발견).
 *     줄을 다 들을 때마다 저장해, 끊기면 다음에 그 줄부터 — 다시 겨누고 [F] 로 이어 듣는다(저절로 다시 열지 않는다).
 *     아비사가 먼저 말을 거는 것은 이 첫 의뢰 한 번뿐이다(미르 11/11 「근처에만 가도 먼저 말을 건다」).
 *  4. 그 뒤로는 겨누고 [F] 면 지금 단계 한 줄. 화톳불을 되살린 뒤 [F] 로 말을 걸면 인연의 시작(골라 듣는 이야기, 끊기면 그 줄부터).
 *  말은 누가 하든 [F](터치 💬)로 넘긴다 — 겨누거나 다가가지 않아도(npcSpeech). E 는 물건 전용이다.
 * 자세: A자세라 팔을 몸 쪽으로 조금 모으고, 온몸이 아주 작게 흔들린다(발은 고정). 편집 중(enabled=false)에는 기본 자세로 멈춘다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { requestShadowUpdates } from "@/engine/shadowUpdates";
import { isTouchMode } from "@/engine/input/touchMode";
import { isPointerActive } from "@/engine/input/virtualLock";

import { companionDialog } from "../../companion/companionRuntime";
import { releasePropColliders } from "../../movement/propColliders";
import { GROUP_IDS } from "../../placement/editFile";
import { clamDig } from "../../puzzles/fishTrap/clamState";
import { fishTrapPuzzle } from "../../puzzles/fishTrap/fishTrapState";
import { isGaugeActive } from "../../puzzles/fishTrap/pullGauge";
import { HEARTH } from "../../puzzles/fishTrap/site";
import { isLetterOpenNow } from "../../puzzles/cliff/letters";
import { registerInteractable, showNotice } from "../../puzzles/interaction";
import { setAbisaReachable } from "../../puzzles/leftBehind";
import { isWindowHeld } from "../../puzzles/pointerHold";
import { isPaperOpenNow } from "../../puzzles/ridge/oldPaper";
import { M } from "../../puzzles/units";
import { recall, remember } from "../../save/puzzleMemory";
import { isCameraFocused } from "../cameraFocus";
import { audio } from "../immersion/audio";
import { director } from "../immersion/director";
import { stage } from "../immersion/state";
import {
  ABISA_NAME,
  BACKSTORY_LINES,
  COMPANION_TIP,
  COMPANION_TIP_TOUCH,
  DRIVE_LABEL,
  DRIVE_NOTICE,
  ECHO_LINE,
  REQUEST_LINES,
  REQUEST_STORY_LINES,
  SERPENT_NOTICE,
  WATCHING_NOTICE,
  stageLine,
  type AbisaLine,
  type LookTarget,
} from "./abisaLines";
import { ActorRig } from "./actorRig";
import { firstScenePoints } from "./firstScenePoints";
import { writeAbisaPose, writeSerpentPose, type AbisaPose, type SerpentPose } from "./bendShader";
import { claimTalk, isTalkTaken, registerTalkInterrupter, releaseTalk, setNpcSpeech } from "./npcSpeech";
import { isTalkPaused } from "./storyTalk";
import { SerpentEcho } from "./serpentEcho";
import { betaSignals } from "../../beta/betaSignals";

/** 저장 키 — 앞서 시험한 인사 저장(abisaGreeted · abisaGuided)은 새 의뢰를 들은 것으로 치지 않는다(Codex 04) */
const SERPENT_DRIVEN_KEY = "firstScene.serpentDriven";
const REQUEST_LINE_KEY = "firstScene.requestLine";
const BACKSTORY_KEY = "firstScene.backstoryHeard";
/** 인연 이야기에서 다음에 말할 줄 — 끊기면 그 줄부터(의뢰와 같게) */
const BACKSTORY_LINE_KEY = "firstScene.backstoryLine";
/** 다시 나타나는 구렁이 — 단계(none · staying · away) · 아비사 한 줄 들음 */
const ECHO_KEY = "firstScene.echo";
const ECHO_LINE_KEY = "firstScene.echoLineHeard";

/** 바라볼 곳(미터). 높이는 아비사 발 기준(m) */
const LOOK_SPOTS: Record<Exclude<LookTarget, "echo">, { x: number; z: number; up: number }> = {
  // 퍼즐(ClamDig)의 HOE_SPOT
  hoe: { x: 16.55, z: 41.95, up: 0.4 },
  hearth: { x: HEARTH.x, z: HEARTH.z, up: 0.5 },
  // 앙암바위 — 두 사람이 만나던 절벽 위(Z3 남쪽 끝 화톳불 자리 쪽)
  rock: { x: 45, z: 26, up: 9 },
  // 강 건너 — 택촌 쪽 물가
  river: { x: 22, z: 60, up: 0 },
};
/**
 * 다시 나타나는 구렁이(구렁이 모티프 ②) — 아비사 곁 물가(미터). 물이 시작되는 곳이라 반쯤 잠겨 있어도 어색하지 않다.
 * 화톳불에서 4 m 남짓이라 다가가면 들어가는 거리는 좁게(2.6 m), 나타난 직후엔 유예(Codex 05)
 */
const ECHO = {
  x: 20.8,
  z: 44.9,
  emerge: 2.0,
  dive: 1.6,
  diveSplash: 0.9,
  near: 2.6,
  grace: 4,
  /** 이만큼 멀리(아비사에서 m) 떠났다가 */
  leave: 30,
  /** 이만큼 안으로 돌아오면 다시 올라온다 */
  back: 18,
  /** 예전 저장본(불은 이미 살렸는데 아직 안 나타남) — 아비사 곁에 오면 */
  firstNear: 15,
};
/** 구렁이가 물러나 들어가는 물가(미터) — 이 일대는 z 45 부터 물로 내려간다 */
const RETREAT_TO = { x: 22.6, z: 46.4 };
/** 물러나기 — 움찔(초) · 미끄러져 가라앉기 끝(초) · 첨벙(초) · 가라앉는 깊이(모형 공간, 키 1 규약 · 구렁이 지름 2.6 m 기준) */
const RETREAT = { recoil: 0.45, end: 2.5, splash: 2.0, sink: 0.62 };

/** 시험 상한(Codex 03 — 승인값 아님). 라디안 */
const LIMITS = { headYaw: 0.7, torsoYaw: 0.3, headUp: -0.25, headDown: 0.35, bow: 0.28, snakeYaw: 0.6 };
/** A자세 팔 모으기 · 흔들림 — 화면 보고 정한다(Codex 04 「정면 · 옆 · 뒤 · 숙임 확인 후 채택」) */
// 모형이 손을 모은 자세(abisa-pose.glb)라 팔 모으기는 0 — A자세 원본으로 되돌리면 0.22
const POSE = { armRest: 0, swayX: 0.011, swayY: 0.008 };
/**
 * 가리키기(팔) — 기본 끔. 정점 굽힘으로 팔을 앞으로 돌리면 소매 안감(붉은 면)이 겉으로 비친다(11/8 화면 확인, Codex 03 「큰 동작은 뼈로」).
 * 개발 훅 setArmGesture(true) 로 켜 볼 수 있다. 지금은 고개 · 몸을 그쪽으로 돌리는 것으로 방향을 준다
 */
const ARM_GESTURE = { enabled: false, maxAngle: 0.75 };

/** 모형 공간 기준점(키 1 규약) */
const ABISA_NECK = new THREE.Vector3(0, 0.83, 0);
const ABISA_HEAD = new THREE.Vector3(0, 0.9, 0);
const REST_ARM_L = new THREE.Vector3(0.105, -0.315, 0).normalize();
const REST_ARM_R = new THREE.Vector3(-0.105, -0.315, 0).normalize();
const SNAKE_NECK = new THREE.Vector3(0.14, 0.11, 0.33);
const SNAKE_HEAD = new THREE.Vector3(0.24, 0.5, 0.4);

const smooth = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => THREE.MathUtils.smootherstep(clamp(t, 0, 1), 0, 1);
/** 0 → 1(올림) → 머묾 → 0(내림) */
const envelope = (t: number, rise: number, hold: number, fall: number) =>
  t < 0 ? 0 : t < rise ? ease(t / rise) : t < rise + hold ? 1 : 1 - ease((t - rise - hold) / fall);
const lineSeconds = (text: string) => clamp(1.6 + text.length * 0.075, 2.8, 5.5);

type TalkKind = "request" | "backstory" | "echo" | "stage";

interface Talk {
  kind: TalkKind;
  lines: AbisaLine[];
  index: number;
  /** 지금 줄이 시작된 뒤 흐른 시간 · 첫 줄 전 기다림(음수) */
  lineTime: number;
  /** 인사(숙임)를 시작한 뒤 시간 — 인사가 없으면 -1 */
  bowTime: number;
  /** 고개 끄덕임 시작 뒤 시간 */
  nodTime: number;
  /** 이 줄이 바라보는 곳으로 몸을 돌리기 시작한 뒤 시간(팔 동작) */
  gestureTime: number;
  /** 창 · 동행 입력 · 조작 풀림으로 멈춰 있다 — 자막도 내려 둔다 */
  isPaused: boolean;
  /** 다 들으면 이어 꺼낼 이야기 — 불을 되살린 뒤 늦게 들은 의뢰는 인연 이야기로 바로 잇는다 */
  then?: "backstory";
}

function createBrain() {
  const abisa: AbisaPose = {
    breath: 0,
    armRest: 0,
    swayX: 0,
    swayY: 0,
    headYaw: 0,
    headPitch: 0,
    torsoYaw: 0,
    bow: 0,
    armL: new THREE.Vector4(1, 0, 0, 0),
    armR: new THREE.Vector4(1, 0, 0, 0),
  };
  const serpent: SerpentPose = {
    breath: 0,
    yaw: 0,
    lift: 0,
    tongue: 0,
    shift: new THREE.Vector3(),
    isGone: false,
  };
  const state = {
    time: 0,
    lookYaw: 0,
    lookPitch: 0,
    isSerpentDriven: recall(SERPENT_DRIVEN_KEY, false),
    /** 물러나는 중이면 흐른 시간(초), 아니면 -1 */
    retreatTime: -1,
    /** 물러난 뒤 아비사가 사라진 쪽을 바라본 시간 — 저장본에서 이미 쫓아낸 뒤면 바로 넘어간다 */
    afterRetreat: recall(SERPENT_DRIVEN_KEY, false) ? 99 : 0,
    retreatShift: new THREE.Vector3(),
    /** 물러나기 직전 구렁이 머리 자리 — 사라진 쪽을 바라볼 때 */
    goneAt: new THREE.Vector3(),
    /** 다음에 말할 의뢰 줄(다 들으면 REQUEST_LINES.length) */
    requestNext: recall(REQUEST_LINE_KEY, 0),
    isBackstoryHeard: recall(BACKSTORY_KEY, false),
    backstoryNext: recall(BACKSTORY_LINE_KEY, 0),
    isSerpentNoticed: false,
    isTipShown: false,
    talk: null as Talk | null,
    inRange: 0,
    /** 이번 접속에 첫 의뢰를 먼저 꺼냈다 — 첫 줄을 다 듣기 전에 멀어져도 다시 먼저 말하지 않는다 */
    hasRequestOpened: false,
    alert: 0,
    isAlertHeard: false,
    snakeYaw: 0,
    tongueTimer: 2.5,
    tongueTime: -1,
    abisaDistance: Infinity,
    serpentDistance: Infinity,
    /** 다시 나타나는 구렁이 — 저장된 단계에서 시작(물러나는 중에 나갔으면 물러난 것으로) */
    echoPhase: recall<"none" | "staying" | "away">(ECHO_KEY, "none") as EchoPhase,
    echoTime: 0,
    /** 물러난 뒤 아비사 곁을 충분히 떠났나 — 불러오기 자체는 다시 찾은 것으로 치지 않는다(Codex 05) */
    echoHasLeft: false,
    isEchoLineHeard: recall(ECHO_LINE_KEY, false),
    echoHead: new THREE.Vector3(0, -1e6, 0),
    echoDistance: Infinity,
    wasTold: fishTrapPuzzle.stage() === "told",
  };
  return { abisa, serpent, state };
}

type Brain = ReturnType<typeof createBrain>;
type EchoPhase = "none" | "emerging" | "staying" | "diving" | "away";

const tmp = {
  local: new THREE.Vector3(),
  target: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  toActor: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  desired: new THREE.Vector3(),
  eye: new THREE.Vector3(),
  snakeHead: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
};

const isRequestDone = (brain: Brain) => brain.state.requestNext >= REQUEST_LINES.length;
const isFireBack = () => fishTrapPuzzle.stage() === "lit" || fishTrapPuzzle.stage() === "told";

/** 아비사의 대화 차례 이름(npcSpeech) */
const TALK_ID = "abisa";

function startTalk(brain: Brain, kind: TalkKind, lines: AbisaLine[], bow: boolean, then?: Talk["then"]) {
  // 다른 사람(어부 · 동행 소개)이 말하는 중이면 시작하지 않는다
  if (!claimTalk(TALK_ID)) return;
  brain.state.talk = {
    kind,
    lines,
    index: -1,
    lineTime: bow ? -0.5 : -0.15,
    bowTime: bow ? 0 : -1,
    nodTime: bow ? -1 : 0,
    gestureTime: -1,
    isPaused: false,
    then,
  };
}

/** 의뢰는 끊긴 줄부터, 처음이면 숙여 인사하고. 한 번 열었으면(먼저 꺼냈든 [F] 로 열었든) 다시 먼저 꺼내지 않는다 */
function startRequest(brain: Brain) {
  const from = brain.state.requestNext;
  startTalk(brain, "request", REQUEST_LINES.slice(from), from === 0);
  if (brain.state.talk) brain.state.hasRequestOpened = true;
}

/** 의뢰의 일 지시(화톳불 · 조개)는 이미 지난 일 — 들은 것으로 친다 */
function skipRequestTasks(brain: Brain) {
  // 베타 기록 — 일 지시 줄은 건너뛰었다(정상 경로). 설화 근거 줄은 이 앞에서 따로 남는다
  if (brain.state.requestNext < REQUEST_LINES.length)
    betaSignals.story("abisa_request", "skipped", { from: brain.state.requestNext, total: REQUEST_LINES.length });
  brain.state.requestNext = REQUEST_LINES.length;
  remember(REQUEST_LINE_KEY, REQUEST_LINES.length);
}

/**
 * 불을 되살린 뒤 의뢰를 마저 들을 때 — 사건 이야기(남은 줄만)에 인연 이야기를 바로 잇는다. 일 지시는 건너뛴다(지난 일을 지금 하라는 말이
 * 된다). 바위 아래로 넘어가기 전에 꼭 들어야 하는 이야기라(leftBehind.isAbisaStoryOwed, 미르 11/11) [F] 한 번에 끝까지 이어진다
 */
function startLateRequest(brain: Brain) {
  const from = brain.state.requestNext;
  if (from >= REQUEST_STORY_LINES) {
    skipRequestTasks(brain);
    startBackstory(brain);
    return;
  }
  startTalk(brain, "request", REQUEST_LINES.slice(from, REQUEST_STORY_LINES), from === 0, "backstory");
  if (brain.state.talk) brain.state.hasRequestOpened = true;
}

/** 인연 이야기도 끊긴 줄부터 */
function startBackstory(brain: Brain) {
  const from = Math.min(brain.state.backstoryNext, BACKSTORY_LINES.length - 1);
  startTalk(brain, "backstory", BACKSTORY_LINES.slice(from), false);
}

/** [F] 로 아비사에게 말을 걸었다 — 말하는 중이면 다음 줄 */
function talkToAbisa(brain: Brain) {
  if (brain.state.talk) {
    nextLine(brain);
    return;
  }
  if (!brain.state.isSerpentDriven || brain.state.retreatTime >= 0) {
    showNotice(WATCHING_NOTICE, 3);
    return;
  }
  // 불을 되살린 뒤면 꼭 들어야 할 이야기(사건 · 인연)부터 — 물가의 구렁이 한마디는 그다음(미르 11/11)
  if (!isRequestDone(brain)) {
    if (isFireBack()) startLateRequest(brain);
    else startRequest(brain);
  } else if (!brain.state.isBackstoryHeard && isFireBack()) startBackstory(brain);
  else if (brain.state.echoPhase === "staying" && !brain.state.isEchoLineHeard)
    startTalk(brain, "echo", [ECHO_LINE], false);
  else startTalk(brain, "stage", [stageLine(clamDig.stage(), fishTrapPuzzle.stage())], false);
}

/** 설화 확인 문제의 정답 근거 줄인가 — C3(사람을 찾아 · 그날) · C2(앙암바위) */
function evidenceOf(text: string): string | null {
  if (text.includes("앙암바위")) return "c2_rock";
  if (text.includes("그날")) return "c3_that_day";
  if (text.includes("사람을 찾아")) return "c3_ask";
  return null;
}

/** 대화창에 지금 줄을 띄운다 — [F] · 💬 로 다음 줄(어디서든) */
const showLine = (brain: Brain, line: AbisaLine) =>
  setNpcSpeech({ speaker: ABISA_NAME, text: line.text, onNext: () => nextLine(brain) }, TALK_ID);

function nextLine(brain: Brain) {
  const talk = brain.state.talk;
  if (!talk) return;
  // 의뢰는 줄을 다 들을 때마다 남긴다 — 끊기면 다음에 그 줄부터
  if (talk.kind === "request" && talk.index >= 0) {
    const heard = brain.state.requestNext;
    brain.state.requestNext = Math.min(REQUEST_LINES.length, brain.state.requestNext + 1);
    remember(REQUEST_LINE_KEY, brain.state.requestNext);
    // 베타 기록 — 의뢰 줄을 끝까지 띄우고 넘겼다. 설화 확인 문제의 근거 줄(사람 찾기 · 앙암바위 · 그날)을 표시한다(L10a)
    if (heard < REQUEST_LINES.length) betaSignals.story("abisa_request", "heard", { line: heard, total: REQUEST_LINES.length, evidence: evidenceOf(REQUEST_LINES[heard].text) });
  }
  if (talk.kind === "backstory" && talk.index >= 0) {
    const heard = brain.state.backstoryNext;
    brain.state.backstoryNext = Math.min(BACKSTORY_LINES.length, brain.state.backstoryNext + 1);
    remember(BACKSTORY_LINE_KEY, brain.state.backstoryNext);
    if (heard < BACKSTORY_LINES.length) betaSignals.story("abisa_backstory", "heard", { line: heard, total: BACKSTORY_LINES.length });
  }
  talk.index += 1;
  talk.lineTime = 0;
  const line = talk.lines[talk.index];
  talk.gestureTime = line?.lookAt ? 0 : -1;
  if (line) {
    showLine(brain, line);
    return;
  }
  // 끝까지 들었다
  releaseTalk(TALK_ID);
  brain.state.talk = null;
  if (talk.then === "backstory") {
    skipRequestTasks(brain);
    if (!brain.state.isBackstoryHeard) startBackstory(brain);
  }
  if (talk.kind === "backstory") {
    brain.state.isBackstoryHeard = true;
    remember(BACKSTORY_KEY, true);
  }
  if (talk.kind === "echo") {
    brain.state.isEchoLineHeard = true;
    remember(ECHO_LINE_KEY, true);
  }
  // 말 걸기가 실제로 켜져 있을 때만(모형은 있어도 대화 세션이 없을 수 있다 — Codex 06회차)
  if (talk.kind === "request" && companionDialog.getState().isEnabled && !brain.state.isTipShown) {
    brain.state.isTipShown = true;
    showNotice(isTouchMode() ? COMPANION_TIP_TOUCH : COMPANION_TIP, 5);
  }
}

function stopTalk(brain: Brain) {
  if (!brain.state.talk) return;
  brain.state.talk = null;
  releaseTalk(TALK_ID);
}

/** 플레이 중이고 다른 일(창 · 종이 · 게이지 · 연출 · 다른 말)에 묶여 있지 않다 */
const isFree = () =>
  isPointerActive() &&
  !isCameraFocused() &&
  !stage.cut &&
  !isWindowHeld() &&
  !isPaperOpenNow() &&
  !isLetterOpenNow() &&
  !isGaugeActive() &&
  !isTalkTaken(TALK_ID);

/** 구렁이를 쫓아낸다 — 「첫 등장이 끝났다」는 E 를 받는 순간 남긴다(물러나는 중에 나가도 다시 들어오면 사라진 상태) */
function driveSerpent(brain: Brain, rig: ActorRig) {
  const { state } = brain;
  if (state.isSerpentDriven || state.retreatTime >= 0) return;
  state.isSerpentDriven = true;
  remember(SERPENT_DRIVEN_KEY, true);
  state.retreatTime = 0;
  state.afterRetreat = 0;
  rig.toWorld(SNAKE_HEAD, state.goneAt);
  // 물러날 길 — 지금 자리에서 물가까지(모형 공간)
  rig.toLocal(rig.position, tmp.a);
  rig.toLocal(tmp.b.set(RETREAT_TO.x * M, rig.position.y, RETREAT_TO.z * M), state.retreatShift).sub(tmp.a);
  state.retreatShift.y = 0;
  audio.play("쉬익");
  director.cue({ 카메라: "흔들림", 세기: 0.25 });
  showNotice(DRIVE_NOTICE, 4.5);
}

function updateSerpent(brain: Brain, rig: ActorRig, eye: THREE.Vector3, dt: number) {
  const { state, serpent } = brain;
  state.serpentDistance = rig.position.distanceTo(eye) / M;
  rig.toWorld(SNAKE_HEAD, tmp.snakeHead);
  serpent.breath = 0.012 * Math.sin((state.time * Math.PI * 2) / 3.6);

  firstScenePoints.isSerpentClose = false;
  // 물러나는 중 — 움찔 쳐들었다가 물가로 미끄러지며 가라앉는다. 몸을 좌우로 틀며 기어가는 듯이
  if (state.retreatTime >= 0) {
    const before = state.retreatTime;
    state.retreatTime += dt;
    const t = state.retreatTime;
    if (before < RETREAT.splash && t >= RETREAT.splash) audio.play("첨벙");
    const recoil = envelope(t, 0.18, 0.12, 0.4);
    const go = ease((t - RETREAT.recoil) / (RETREAT.end - RETREAT.recoil));
    serpent.lift = 0.45 * recoil - 0.25 * go;
    serpent.yaw = Math.sin(t * 9) * 0.22 * go;
    serpent.tongue = t < 0.4 ? 1 : 0;
    serpent.shift.copy(state.retreatShift).multiplyScalar(go);
    serpent.shift.y = -RETREAT.sink * ease((t - RETREAT.recoil - 0.3) / (RETREAT.end - RETREAT.recoil - 0.3));
    serpent.isGone = false;
    state.goneAt.copy(tmp.snakeHead);
    if (t >= RETREAT.end) {
      state.retreatTime = -1;
      serpent.isGone = true;
    }
    return;
  }
  if (state.isSerpentDriven) {
    serpent.isGone = true;
    return;
  }
  serpent.isGone = false;
  serpent.shift.set(0, 0, 0);

  const wantsAlert = state.serpentDistance < 7 ? 1 : 0;
  firstScenePoints.isSerpentClose = wantsAlert === 1;
  state.alert = smooth(state.alert, wantsAlert, wantsAlert ? 1.6 : 0.6, dt);
  // 처음 다가가면 — 조사관의 판단(위험해 보인다). 소리는 날 수 있을 때 한 번(Codex 리뷰).
  // 화면 고정 · 다른 사람(동행 소개 등)이 말하는 중이면 한 번뿐인 알림을 쓰지 않고 미룬다(Codex 08)
  const isHeldBack = isCameraFocused() || isTalkTaken(TALK_ID);
  if (state.alert > 0.5 && !state.isSerpentNoticed && isPointerActive() && !isHeldBack) {
    state.isSerpentNoticed = true;
    firstScenePoints.isSerpentNoticed = true;
    showNotice(SERPENT_NOTICE, 4);
  }
  if (state.alert > 0.5 && !state.isAlertHeard && audio.ctx?.state === "running" && !isHeldBack) {
    state.isAlertHeard = true;
    audio.play("쉬익");
  }
  rig.toLocal(eye, tmp.local).sub(SNAKE_NECK);
  const toPlayer = clamp(Math.atan2(tmp.local.x, tmp.local.z), -LIMITS.snakeYaw, LIMITS.snakeYaw);
  const sway = Math.sin(state.time * 0.7) * 0.07 + Math.sin(state.time * 0.31 + 1.3) * 0.04;
  state.snakeYaw = smooth(state.snakeYaw, sway * (1 - state.alert) + toPlayer * state.alert, 2.2, dt);
  serpent.yaw = state.snakeYaw;
  serpent.lift = state.alert * 0.18 + Math.sin(state.time * 0.5) * 0.015;
  // 혀 — 두 번 빠르게 날름, 경계하면 더 자주
  state.tongueTimer -= dt;
  if (state.tongueTimer <= 0) {
    state.tongueTime = 0;
    state.tongueTimer = state.alert > 0.5 ? 1.2 + Math.random() * 1.4 : 3 + Math.random() * 3;
  }
  if (state.tongueTime >= 0) {
    state.tongueTime += dt;
    const t = state.tongueTime;
    serpent.tongue = t < 0.54 ? Math.pow(Math.max(0, Math.sin((Math.PI * t) / 0.27)), 0.6) : 0;
    if (t >= 0.54) state.tongueTime = -1;
  } else serpent.tongue = 0;
}

/**
 * 다시 나타나는 구렁이 — 불을 되살려 연기가 아비사 쪽으로 흐르면(told) 아비사 곁 물가에서 올라와 머문다.
 * 가까이(2.6 m) 오면 스르르 물로 들어가고, 아비사 곁을 충분히 떠났다 돌아오면 또 올라와 있다(맴돈다). 정체 설명은 없다.
 */
function updateEcho(brain: Brain, echo: SerpentEcho, eye: THREE.Vector3, abisaAt: THREE.Vector3 | null, dt: number) {
  const { state } = brain;
  const pose = echo.pose;
  echo.toWorld(SNAKE_HEAD, state.echoHead);
  state.echoDistance = Math.hypot(eye.x - echo.position.x, eye.z - echo.position.z) / M;
  const fromAbisa = abisaAt ? Math.hypot(eye.x - abisaAt.x, eye.z - abisaAt.z) / M : Infinity;
  const isTold = fishTrapPuzzle.stage() === "told";
  const isJustTold = isTold && !state.wasTold;
  state.wasTold = isTold;
  const setPhase = (phase: EchoPhase) => {
    state.echoPhase = phase;
    state.echoTime = 0;
    // 들고 나는 중간 단계는 끝난 쪽으로 남긴다(Codex 05)
    if (phase === "staying" || phase === "away") remember(ECHO_KEY, phase);
    if (phase === "emerging") remember(ECHO_KEY, "staying");
    if (phase === "diving") remember(ECHO_KEY, "away");
  };
  state.echoTime += dt;
  pose.breath = 0.012 * Math.sin((state.time * Math.PI * 2) / 3.6 + 1.1);
  pose.tongue = 0;

  switch (state.echoPhase) {
    case "none": {
      pose.isGone = true;
      // 불을 되살려 연기가 아비사 쪽으로 흐르는 그때 올라온다. 예전 저장본(이미 told)은 아비사 곁에 다가오면
      if (state.isSerpentDriven && isTold && (isJustTold || fromAbisa < ECHO.firstNear)) {
        setPhase("emerging");
        audio.play("첨벙");
      }
      return;
    }
    case "away": {
      pose.isGone = true;
      if (fromAbisa > ECHO.leave) state.echoHasLeft = true;
      if (state.echoHasLeft && fromAbisa < ECHO.back) {
        state.echoHasLeft = false;
        setPhase("emerging");
        audio.play("첨벙");
      }
      return;
    }
    case "emerging": {
      const t = ease(state.echoTime / ECHO.emerge);
      pose.isGone = false;
      pose.shift.set(0, -0.55 * (1 - t), 0.15 * (1 - t));
      pose.lift = -0.3 + 0.4 * t;
      pose.yaw = Math.sin(state.echoTime * 5) * 0.12 * (1 - t);
      if (state.echoTime >= ECHO.emerge) setPhase("staying");
      return;
    }
    case "staying": {
      pose.isGone = false;
      pose.shift.set(0, 0, 0);
      const sway = Math.sin(state.time * 0.6 + 0.4) * 0.08 + Math.sin(state.time * 0.27) * 0.05;
      pose.yaw = sway;
      pose.lift = 0.1 + Math.sin(state.time * 0.45) * 0.02;
      // 혀 — 가끔
      if (Math.sin(state.time * 0.9) > 0.985) pose.tongue = 1;
      const isTalking = !!state.talk;
      if (state.echoTime > ECHO.grace && !isTalking && state.echoDistance < ECHO.near) setPhase("diving");
      return;
    }
    case "diving": {
      const t = state.echoTime;
      if (t - dt < ECHO.diveSplash && t >= ECHO.diveSplash) audio.play("첨벙");
      const recoil = envelope(t, 0.15, 0.1, 0.35);
      const go = ease((t - 0.3) / (ECHO.dive - 0.3));
      pose.isGone = false;
      pose.lift = 0.1 + 0.3 * recoil - 0.35 * go;
      pose.yaw = Math.sin(t * 9) * 0.18 * go;
      pose.shift.set(0, -0.6 * go, 0.25 * go);
      if (t >= ECHO.dive) {
        pose.isGone = true;
        state.echoHasLeft = false;
        setPhase("away");
      }
      return;
    }
  }
}

/** 모형 공간 목표점 쪽을 보는 고개 · 몸 각 */
function lookAngles(rig: ActorRig, worldTarget: THREE.Vector3) {
  rig.toLocal(worldTarget, tmp.local).sub(ABISA_NECK);
  const yaw = Math.atan2(tmp.local.x, tmp.local.z);
  const pitch = Math.atan2(-tmp.local.y, Math.hypot(tmp.local.x, tmp.local.z));
  return { yaw, pitch };
}

function lookSpot(rig: ActorRig, target: LookTarget, out: THREE.Vector3, brain?: Brain) {
  if (target === "echo") return out.copy(brain?.state.echoHead ?? rig.position);
  const spot = LOOK_SPOTS[target];
  return out.set(spot.x * M, rig.position.y + spot.up * M, spot.z * M);
}

function updateAbisa(brain: Brain, rig: ActorRig, eye: THREE.Vector3, camera: THREE.Camera, dt: number) {
  const { state, abisa } = brain;
  state.abisaDistance = rig.position.distanceTo(eye) / M;
  const talk = state.talk;
  const line = talk && talk.index >= 0 ? talk.lines[talk.index] : null;
  const isRetreating = state.retreatTime >= 0;
  if (state.isSerpentDriven && !isRetreating) state.afterRetreat += dt;
  // 구렁이가 있거나 막 물러난 동안은 그쪽을 가만히 지켜본다(두려워하지 않는다 — Codex 04)
  const isWatchingSerpent = !state.isSerpentDriven || isRetreating || state.afterRetreat < 1.4;

  // 바라볼 곳 — 구렁이(사라진 자리) · 대사가 가리키는 곳 · 가까운 플레이어 · 아니면 천천히 둘러보기
  let yaw = Math.sin(state.time * 0.23) * 0.25 + Math.sin(state.time * 0.11 + 0.7) * 0.12;
  let pitch = 0.05;
  if (isWatchingSerpent && !talk) {
    ({ yaw, pitch } = lookAngles(rig, state.isSerpentDriven ? state.goneAt : tmp.snakeHead));
  } else if (line?.lookAt) {
    ({ yaw, pitch } = lookAngles(rig, lookSpot(rig, line.lookAt, tmp.target, brain)));
  } else if (!talk && state.echoPhase === "staying" && state.abisaDistance > 6) {
    // 다시 나타난 구렁이를 가만히 바라본다(두려워하지 않는다)
    ({ yaw, pitch } = lookAngles(rig, state.echoHead));
  } else if (state.abisaDistance < 10 || talk) {
    const look = lookAngles(rig, eye);
    // 뒤쪽(110° 넘게)이면 억지로 목을 꺾지 않는다
    if (Math.abs(look.yaw) < 1.9) ({ yaw, pitch } = look);
  }
  const limitYaw = LIMITS.headYaw + LIMITS.torsoYaw;
  state.lookYaw = smooth(state.lookYaw, clamp(yaw, -limitYaw, limitYaw), 3, dt);
  state.lookPitch = smooth(state.lookPitch, clamp(pitch, LIMITS.headUp, LIMITS.headDown), 3, dt);
  abisa.torsoYaw = clamp(state.lookYaw * 0.3, -LIMITS.torsoYaw, LIMITS.torsoYaw);
  abisa.headYaw = clamp(state.lookYaw - abisa.torsoYaw, -LIMITS.headYaw, LIMITS.headYaw);
  abisa.breath = 0.05 * Math.sin((state.time * Math.PI * 2) / 4.2);
  abisa.armRest = POSE.armRest;
  // 구렁이를 지켜보는 동안은 몸이 잠깐 굳는다(흔들림을 거의 멈춘다)
  const sway = isWatchingSerpent && !talk ? 0.15 : 1;
  abisa.swayX = POSE.swayX * sway * Math.sin(state.time * 0.6);
  abisa.swayY = POSE.swayY * sway * Math.sin(state.time * 0.43 + 1);

  // 인사(숙임) · 끄덕임 · 고개 떨굼
  let bow = 0;
  let nod = 0;
  if (talk) {
    if (talk.bowTime >= 0) {
      talk.bowTime += dt;
      bow = envelope(talk.bowTime, 0.7, 0.5, 0.8);
    }
    if (talk.nodTime >= 0) {
      talk.nodTime += dt;
      nod = envelope(talk.nodTime, 0.25, 0.1, 0.35);
    }
  }
  const down = talk && line?.isDown ? envelope(talk.lineTime, 0.6, 99, 0.6) : 0;
  abisa.bow = bow * LIMITS.bow;
  abisa.headPitch = state.lookPitch + bow * 0.15 + nod * 0.14 + down * 0.2;

  // 가리키기 — 대사가 가리키는 곳 쪽 팔을 앞 · 아래 · 바깥으로(몸통 비틀기를 뺀 몸통 기준). 기본 끔
  abisa.armL.set(1, 0, 0, 0);
  abisa.armR.set(1, 0, 0, 0);
  if (ARM_GESTURE.enabled && talk && line?.lookAt && talk.gestureTime >= 0) {
    talk.gestureTime += dt;
    const lift = envelope(talk.gestureTime - 0.3, 0.7, Math.max(0.5, lineSeconds(line.text) - 2.2), 0.7);
    rig.toLocal(lookSpot(rig, line.lookAt, tmp.target, brain), tmp.local);
    const away = Math.atan2(tmp.local.x, tmp.local.z) - abisa.torsoYaw;
    const isLeft = Math.sin(away) > 0;
    tmp.desired.set(Math.sin(away) * 0.62, -0.62, Math.cos(away) * 0.62).normalize();
    const rest = isLeft ? REST_ARM_L : REST_ARM_R;
    tmp.axis.crossVectors(rest, tmp.desired);
    if (tmp.axis.lengthSq() > 1e-6) {
      tmp.axis.normalize();
      const angle = Math.min(Math.acos(clamp(rest.dot(tmp.desired), -1, 1)), ARM_GESTURE.maxAngle) * lift;
      (isLeft ? abisa.armL : abisa.armR).set(tmp.axis.x, tmp.axis.y, tmp.axis.z, angle);
    }
  }

  // 대사 진행 — 창(소지품 · 설정 · 힌트함 · 동행 입력) · 종이 · 게이지 · 연출 중이거나 조작이 풀려 있으면 멈추고 자막을 내린다.
  // 안 그러면 창을 보는 사이 한 번뿐인 의뢰가 다 흘러가 「들었음」으로 저장된다(Codex 리뷰)
  if (talk) {
    const shouldPause = isTalkPaused();
    if (shouldPause !== talk.isPaused) {
      talk.isPaused = shouldPause;
      if (shouldPause) setNpcSpeech(null, TALK_ID);
      else if (line) showLine(brain, line);
    }
    if (shouldPause) return;
    talk.lineTime += dt;
    if (talk.index < 0 ? talk.lineTime >= 0 : talk.lineTime >= lineSeconds(line?.text ?? "")) nextLine(brain);
    // 멀리 가 버리면 그친다 — 의뢰 · 인연 이야기는 들은 줄까지 남아, 다시 겨누고 [F] 면 그 줄부터 잇는다(저절로 다시 열지 않는다)
    if (brain.state.talk && state.abisaDistance > 14) stopTalk(brain);
    return;
  }

  // 먼저 말을 거는 때 — 첫 의뢰 한 번뿐(꼭 들어야 하는 말). 구렁이가 물러나 사라진 쪽을 잠깐 본 뒤, 마주 보고 가까이 있으면.
  // 끊긴 의뢰 · 인연 이야기 · 단계 한 줄은 플레이어가 [F] 로 말을 걸 때만(미르 11/11 「근처에만 가도 먼저 말을 건다」)
  if (isWatchingSerpent || state.requestNext > 0 || state.hasRequestOpened) return;
  camera.getWorldDirection(tmp.forward);
  tmp.toActor
    .copy(rig.position)
    .setY(rig.position.y + 1.3 * M)
    .sub(eye)
    .normalize();
  const isFacing = tmp.forward.dot(tmp.toActor) > 0.3;
  if (state.abisaDistance < 9 && isFacing && isFree()) state.inRange += dt;
  else state.inRange = 0;
  if (state.inRange < 0.6) return;
  state.inRange = 0;
  startRequest(brain);
}

function writeRest(brain: Brain) {
  const { abisa, serpent } = brain;
  Object.assign(abisa, { breath: 0, armRest: 0, swayX: 0, swayY: 0, headYaw: 0, headPitch: 0, torsoYaw: 0, bow: 0 });
  abisa.armL.set(1, 0, 0, 0);
  abisa.armR.set(1, 0, 0, 0);
  // 편집 중엔 원래 모형 그대로(혀도 내민 채) 보인다 — 쫓아낸 뒤라도 자리를 잡을 수 있게
  Object.assign(serpent, { breath: 0, yaw: 0, lift: 0, tongue: 1, isGone: false });
  serpent.shift.set(0, 0, 0);
}

type FrozenPose = Partial<Omit<AbisaPose, "armL" | "armR">> & {
  armL?: THREE.Vector4;
  armR?: THREE.Vector4;
  snakeYaw?: number;
  snakeLift?: number;
  tongue?: number;
};

interface FirstSceneActorsProps {
  enabled: boolean;
  /** 땅 높이(미터) — 다시 나타나는 구렁이를 물가에 놓을 때 */
  groundY: (x: number, z: number) => number;
}

export default function FirstSceneActors({ enabled, groundY }: FirstSceneActorsProps) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const rigs = useMemo(
    () => ({
      abisa: new ActorRig("abisa", GROUP_IDS.scene1Abisa),
      serpent: new ActorRig("serpent", GROUP_IDS.scene1Serpent),
    }),
    [],
  );
  const brain = useMemo(() => createBrain(), []);
  const abisaHead = useMemo(() => new THREE.Vector3(0, -1e6, 0), []);
  const serpentHead = useMemo(() => new THREE.Vector3(0, -1e6, 0), []);
  const frame = useMemo(() => ({ count: 0 }), []);
  const lastPose = useMemo(() => ({ headYaw: 0, torsoYaw: 0, bow: 0, snakeYaw: 0, snakeLift: 0, shift: 0 }), []);
  const dev = useMemo(() => ({ frozen: null as FrozenPose | null }), []);
  const colliders = useMemo(() => ({ isReleased: false }), []);
  const echo = useMemo(() => new SerpentEcho(), []);
  const echoPlace = useMemo(() => ({ isPlaced: false, position: new THREE.Vector3(), scale: new THREE.Vector3() }), []);
  const groundRef = useRef(groundY);
  useEffect(() => {
    groundRef.current = groundY;
  }, [groundY]);

  // 다시 나타나는 구렁이 — 무리 밖 별도 메시라 장면에 직접 붙인다
  useEffect(() => {
    scene.add(echo.root);
    return () => echo.dispose();
  }, [scene, echo]);
  useEffect(
    () => () => {
      firstScenePoints.abisaHead = null;
      firstScenePoints.isSerpentClose = false;
    },
    [],
  );

  // 아비사 — 구렁이가 있으면 지켜볼 뿐, 그 뒤로는 의뢰(끊긴 줄부터) · 인연 이야기 · 지금 단계 한 줄. 말하는 중이면 다음 줄
  useEffect(() => {
    const remove = registerInteractable({
      id: "abisa",
      position: abisaHead,
      label: "아비사에게 말 걸기",
      radius: 0.55 * M,
      // 겨누고 [F] 로 말을 건다(E 는 물건 전용 — 계약 §10-2). 넘기기는 겨누지 않아도 [F] 라 거리는 말을 거는 때만 쓴다
      reach: 5 * M,
      isTalk: true,
      talkId: TALK_ID,
      enabled: () => enabled && rigs.abisa.isPlaced,
      use: () => talkToAbisa(brain),
    });
    // 바위틈 문은 아비사 이야기가 남으면 닫힌다 — 말을 걸 수 없는 판(편집 · 모형 없음)에선 잡아 두지 않는다
    setAbisaReachable(() => enabled && rigs.abisa.isPlaced);
    // 말하는 중 다른 것과 상호작용하면 그친다 — 들은 줄까지만 남는다(미르 11/11)
    const removeInterrupter = registerTalkInterrupter(TALK_ID, () => stopTalk(brain));
    return () => {
      remove();
      removeInterrupter();
      setAbisaReachable(null);
    };
  }, [enabled, rigs, brain, abisaHead]);

  // 구렁이 — 겨누고 E 로 쫓아낸다(조사관이 위험 요소로 판단 · 부록 E)
  useEffect(() => {
    const remove = registerInteractable({
      id: "first-serpent",
      position: serpentHead,
      label: DRIVE_LABEL,
      radius: 0.9 * M,
      reach: 5 * M,
      enabled: () => enabled && rigs.serpent.isPlaced && !brain.state.isSerpentDriven && brain.state.retreatTime < 0,
      use: () => driveSerpent(brain, rigs.serpent),
    });
    return remove;
  }, [enabled, rigs, brain, serpentHead]);

  useEffect(() => () => releaseTalk(TALK_ID), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFirstScene", {
      state: () => ({ ...brain.state, talk: brain.state.talk && { ...brain.state.talk } }),
      pose: () => ({ abisa: { ...brain.abisa }, serpent: { ...brain.serpent } }),
      placed: () => ({ abisa: rigs.abisa.isPlaced, serpent: rigs.serpent.isPlaced }),
      /** 첫 장면을 처음부터 다시(저장도 지운다) — 구렁이가 돌아오고 의뢰를 처음부터 */
      reset: () => {
        stopTalk(brain);
        Object.assign(brain.state, {
          isSerpentDriven: false,
          retreatTime: -1,
          afterRetreat: 0,
          requestNext: 0,
          isBackstoryHeard: false,
          backstoryNext: 0,
          hasRequestOpened: false,
          isSerpentNoticed: false,
          isTipShown: false,
          isAlertHeard: false,
        });
        remember(SERPENT_DRIVEN_KEY, false);
        remember(REQUEST_LINE_KEY, 0);
        remember(BACKSTORY_KEY, false);
        remember(BACKSTORY_LINE_KEY, 0);
        Object.assign(brain.state, { echoPhase: "none", echoTime: 0, echoHasLeft: false, isEchoLineHeard: false });
        remember(ECHO_KEY, "none");
        remember(ECHO_LINE_KEY, false);
      },
      /** 다시 나타나는 구렁이를 바로 올라오게(시험) */
      emerge: () => Object.assign(brain.state, { echoPhase: "emerging", echoTime: 0 }),
      echo: () => ({
        phase: brain.state.echoPhase,
        placed: echoPlace.isPlaced,
        ready: echo.isReady,
        at: echoPlace.position.toArray(),
      }),
      drive: () => driveSerpent(brain, rigs.serpent),
      /** [F] 로 말을 건 것처럼 */
      talk: () => talkToAbisa(brain),
      request: () => startRequest(brain),
      backstory: () => startBackstory(brain),
      /** 팔 동작 켜고 끄기(화면 보고 정한다) */
      setArmGesture: (on: boolean) => {
        ARM_GESTURE.enabled = on;
      },
      /** 팔 모으기 · 흔들림 크기(라디안) */
      setPose: (next: Partial<typeof POSE>) => Object.assign(POSE, next),
      /** 시험 — 자세를 직접(시간이 덮어쓰지 않게 멈춘 채). 인자 없이 부르면 풀린다 */
      freeze: (pose?: FrozenPose) => {
        dev.frozen = pose ?? null;
      },
    });
  }, [brain, rigs, dev, echo, echoPlace]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (frame.count++ % 20 === 0) {
      rigs.abisa.sync(scene);
      rigs.serpent.sync(scene);
    } else {
      rigs.abisa.updatePlacement();
      rigs.serpent.updatePlacement();
    }
    // 다시 나타나는 구렁이 — 첫 구렁이 무리를 본떠 만들고, 아비사 곁 물가에 아비사 쪽을 보게 놓는다
    if (frame.count % 20 === 1) echo.build(rigs.serpent.nearMesh);
    if (echo.isReady && !echoPlace.isPlaced && rigs.serpent.isPlaced && rigs.abisa.isPlaced) {
      echoPlace.isPlaced = true;
      echoPlace.position.set(ECHO.x * M, groundRef.current(ECHO.x, ECHO.z) * M, ECHO.z * M);
      echoPlace.scale.setFromMatrixScale(rigs.serpent.world);
      const toAbisa = Math.atan2(
        rigs.abisa.position.x - echoPlace.position.x,
        rigs.abisa.position.z - echoPlace.position.z,
      );
      echo.place(echoPlace.position, toAbisa, echoPlace.scale.x);
    }
    if (rigs.abisa.isPlaced) rigs.abisa.toWorld(ABISA_HEAD, abisaHead);
    else abisaHead.set(0, -1e6, 0);
    firstScenePoints.abisaHead = rigs.abisa.isPlaced ? abisaHead : null;
    if (rigs.serpent.isPlaced && !brain.state.isSerpentDriven) rigs.serpent.toWorld(SNAKE_HEAD, serpentHead);
    else serpentHead.set(0, -1e6, 0);

    if (!enabled) {
      stopTalk(brain);
      writeRest(brain);
    } else if (dev.frozen) {
      writeRest(brain);
      const { snakeYaw, snakeLift, tongue, armL, armR, ...abisaPose } = dev.frozen;
      Object.assign(brain.abisa, abisaPose);
      if (armL) brain.abisa.armL.copy(armL);
      if (armR) brain.abisa.armR.copy(armR);
      Object.assign(brain.serpent, { yaw: snakeYaw ?? 0, lift: snakeLift ?? 0, tongue: tongue ?? 1 });
    } else {
      brain.state.time += dt;
      const eye = camera.getWorldPosition(tmp.eye);
      if (rigs.serpent.isPlaced) updateSerpent(brain, rigs.serpent, eye, dt);
      if (echoPlace.isPlaced) updateEcho(brain, echo, eye, rigs.abisa.isPlaced ? rigs.abisa.position : null, dt);
      if (rigs.abisa.isPlaced) updateAbisa(brain, rigs.abisa, eye, camera, dt);
    }
    // 그림자는 평소 몇 초에 한 번만 다시 그린다 — 가까이서 고개 · 몸이 크게 움직이는 동안은 촘촘히(Codex 리뷰)
    const shift = brain.serpent.shift.length();
    const motion =
      Math.abs(brain.abisa.headYaw - lastPose.headYaw) +
      Math.abs(brain.abisa.torsoYaw - lastPose.torsoYaw) +
      Math.abs(brain.abisa.bow - lastPose.bow) +
      Math.abs(brain.serpent.yaw - lastPose.snakeYaw) +
      Math.abs(brain.serpent.lift - lastPose.snakeLift) +
      Math.abs(shift - lastPose.shift) +
      (echo.root.visible && brain.state.echoPhase !== "staying" ? 1 : 0);
    if (dt > 0 && motion / dt > 0.04 && Math.min(brain.state.abisaDistance, brain.state.serpentDistance) < 20)
      requestShadowUpdates(0.3);
    Object.assign(lastPose, {
      headYaw: brain.abisa.headYaw,
      torsoYaw: brain.abisa.torsoYaw,
      bow: brain.abisa.bow,
      snakeYaw: brain.serpent.yaw,
      snakeLift: brain.serpent.lift,
      shift,
    });
    // 물러나 사라진 구렁이 — 메시를 숨기고(단단한 땅 굽기에서 빠진다) 소품 충돌 원기둥도 푼다(Codex 리뷰). 편집 중엔 다시 보인다
    rigs.serpent.setHidden(enabled && brain.serpent.isGone);
    if (brain.serpent.isGone && !colliders.isReleased && rigs.serpent.isPlaced) {
      colliders.isReleased = true;
      releasePropColliders("구렁이", rigs.serpent.position.x / M, rigs.serpent.position.z / M, 2.2);
    }
    writeAbisaPose(rigs.abisa.uniforms, brain.abisa);
    writeSerpentPose(rigs.serpent.uniforms, brain.serpent);
    // 편집 중엔 다시 나타나는 구렁이를 숨긴다(편집 대상이 아니다)
    if (!enabled) echo.pose.isGone = true;
    echo.write();
  });

  return null;
}
