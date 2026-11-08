/**
 * 첫 장면(나루터) 아비사 · 구렁이 — 서 있기만 하던 두 모형에 숨 · 시선 · 인사 · 대사를 준다(미르 11/8, Codex 03회차).
 *
 * 흐름
 *  - 구렁이: 늘 숨 쉬고 고개를 천천히 흔들며 가끔 혀를 날름. 7 m 안에 오면 고개를 들고 플레이어 쪽으로 — 처음 한 번 낮게 쉬익.
 *    말은 하지 않는다(기획 ④ 「첫 등장 · 정체 불명」). 시점을 억지로 돌리지 않는다.
 *  - 아비사: 늘 숨 쉬고 천천히 둘러본다. 10 m 안이면 고개 · 몸을 조금 돌려 플레이어를 본다.
 *    처음 6 m 안에서 마주 보면(구렁이가 먼저 반응한 뒤) 살짝 숙여 인사하고 대사 네 줄 — 마지막 줄은 호미 쪽을 본다.
 *    그 뒤로는 겨누고 [E] 면 지금 단계 한 줄. 인사를 시작했는지 · 끝까지 들었는지를 따로 저장한다(중간에 나가면 안내만 다시).
 * 편집 중(enabled=false)에는 기본 자세로 돌아가고 멈춘다.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { requestShadowUpdates } from "@/engine/shadowUpdates";
import { isPointerActive } from "@/engine/input/virtualLock";

import { IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { GROUP_IDS } from "../../placement/editFile";
import { clamDig } from "../../puzzles/fishTrap/clamState";
import { fishTrapPuzzle } from "../../puzzles/fishTrap/fishTrapState";
import { isGaugeActive } from "../../puzzles/fishTrap/pullGauge";
import { registerInteractable, showNotice } from "../../puzzles/interaction";
import { isWindowHeld } from "../../puzzles/pointerHold";
import { isPaperOpenNow } from "../../puzzles/ridge/oldPaper";
import { M } from "../../puzzles/units";
import { recall, remember } from "../../save/puzzleMemory";
import { isCameraFocused } from "../cameraFocus";
import { audio } from "../immersion/audio";
import { stage } from "../immersion/state";
import { ABISA_NAME, COMPANION_TIP, GREETING_LINES, stageLine, type AbisaLine } from "./abisaLines";
import { ActorRig } from "./actorRig";
import { writeAbisaPose, writeSerpentPose, type AbisaPose, type SerpentPose } from "./bendShader";
import { isNpcSpeaking, setNpcSpeech } from "./npcSpeech";

/** 호미 자리(미터) — 퍼즐(ClamDig)의 HOE_SPOT 과 같다 */
const HOE = { x: 16.55, z: 41.95 };
const GREETED_KEY = "firstScene.abisaGreeted";
const GUIDED_KEY = "firstScene.abisaGuided";

/** 시험 상한(Codex 03 — 승인값 아님). 라디안 */
const LIMITS = { headYaw: 0.7, torsoYaw: 0.3, headUp: -0.25, headDown: 0.35, bow: 0.28, snakeYaw: 0.6 };
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

const smooth = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => THREE.MathUtils.smootherstep(clamp(t, 0, 1), 0, 1);
/** 0 → 1(올림) → 머묾 → 0(내림) */
const envelope = (t: number, rise: number, hold: number, fall: number) =>
  t < 0 ? 0 : t < rise ? ease(t / rise) : t < rise + hold ? 1 : 1 - ease((t - rise - hold) / fall);
const lineSeconds = (text: string) => clamp(1.6 + text.length * 0.075, 2.8, 5.5);

interface Talk {
  lines: AbisaLine[];
  index: number;
  /** 지금 줄이 시작된 뒤 흐른 시간 · 첫 줄 전 기다림 */
  lineTime: number;
  /** 인사(숙임)를 시작한 뒤 시간 — 인사가 없으면 -1 */
  bowTime: number;
  /** 고개 끄덕임 시작 뒤 시간 */
  nodTime: number;
  isGreeting: boolean;
  /** 창 · 동행 입력 · 조작 풀림으로 멈춰 있다 — 자막도 내려 둔다 */
  isPaused: boolean;
  /** 이 줄이 바라보는 곳으로 몸을 돌리기 시작한 뒤 시간(팔 동작) */
  gestureTime: number;
}

function createBrain() {
  const abisa: AbisaPose = {
    breath: 0,
    headYaw: 0,
    headPitch: 0,
    torsoYaw: 0,
    bow: 0,
    armL: new THREE.Vector4(1, 0, 0, 0),
    armR: new THREE.Vector4(1, 0, 0, 0),
  };
  const serpent: SerpentPose = { breath: 0, yaw: 0, lift: 0, tongue: 0 };
  const state = {
    time: 0,
    lookYaw: 0,
    lookPitch: 0,
    greeted: recall(GREETED_KEY, false),
    guided: recall(GUIDED_KEY, false),
    /** 이번 판에 안내를 다시 들려줬나(인사만 하고 끊긴 저장본) */
    resumed: false,
    tipShown: false,
    talk: null as Talk | null,
    inRange: 0,
    alert: 0,
    alertSeen: false,
    snakeYaw: 0,
    tongueTimer: 2.5,
    tongueTime: -1,
    abisaDistance: Infinity,
    serpentDistance: Infinity,
  };
  return { abisa, serpent, state };
}

type Brain = ReturnType<typeof createBrain>;

const tmp = {
  local: new THREE.Vector3(),
  target: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  toActor: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  desired: new THREE.Vector3(),
  eye: new THREE.Vector3(),
};

function startTalk(brain: Brain, lines: AbisaLine[], { isGreeting, bow }: { isGreeting: boolean; bow: boolean }) {
  brain.state.talk = {
    lines,
    index: -1,
    lineTime: bow ? -0.5 : -0.15,
    bowTime: bow ? 0 : -1,
    nodTime: bow ? -1 : 0,
    isGreeting,
    gestureTime: -1,
    isPaused: false,
  };
}

function nextLine(brain: Brain) {
  const talk = brain.state.talk;
  if (!talk) return;
  talk.index += 1;
  talk.lineTime = 0;
  talk.gestureTime = talk.lines[talk.index]?.lookAt ? 0 : -1;
  const line = talk.lines[talk.index];
  if (line) {
    setNpcSpeech({ speaker: ABISA_NAME, text: line.text, canAdvance: true });
    return;
  }
  // 끝까지 들었다
  setNpcSpeech(null);
  if (talk.isGreeting || !brain.state.guided) {
    brain.state.guided = true;
    remember(GUIDED_KEY, true);
    if (IS_COMPANION_ENABLED && !brain.state.tipShown) {
      brain.state.tipShown = true;
      showNotice(COMPANION_TIP, 5);
    }
  }
  brain.state.talk = null;
}

function stopTalk(brain: Brain) {
  if (!brain.state.talk) return;
  brain.state.talk = null;
  setNpcSpeech(null);
}

/** 플레이 중이고 다른 일(창 · 종이 · 게이지 · 연출 · 다른 말)에 묶여 있지 않다 */
const isFree = () =>
  isPointerActive() &&
  !isCameraFocused() &&
  !stage.cut &&
  !isWindowHeld() &&
  !isPaperOpenNow() &&
  !isGaugeActive() &&
  !isNpcSpeaking();

function updateSerpent(brain: Brain, rig: ActorRig, eye: THREE.Vector3, dt: number) {
  const { state, serpent } = brain;
  state.serpentDistance = rig.position.distanceTo(eye) / M;
  const wantsAlert = state.serpentDistance < 7 ? 1 : 0;
  state.alert = smooth(state.alert, wantsAlert, wantsAlert ? 1.6 : 0.6, dt);
  // 소리가 아직 못 나는 때(첫 몸짓 전 — 저장 자리가 구렁이 곁)에는 아껴 뒀다가 나는 때에 한 번(Codex 리뷰)
  if (state.alert > 0.5 && !state.alertSeen && audio.ctx?.state === "running") {
    state.alertSeen = true;
    audio.play("쉬익");
  }
  rig.toLocal(eye, tmp.local).sub(SNAKE_NECK);
  const toPlayer = clamp(Math.atan2(tmp.local.x, tmp.local.z), -LIMITS.snakeYaw, LIMITS.snakeYaw);
  const sway = Math.sin(state.time * 0.7) * 0.07 + Math.sin(state.time * 0.31 + 1.3) * 0.04;
  state.snakeYaw = smooth(state.snakeYaw, sway * (1 - state.alert) + toPlayer * state.alert, 2.2, dt);
  serpent.yaw = state.snakeYaw;
  serpent.lift = state.alert * 0.18 + Math.sin(state.time * 0.5) * 0.015;
  serpent.breath = 0.012 * Math.sin((state.time * Math.PI * 2) / 3.6);
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

/** 모형 공간 목표점 쪽을 보는 고개 · 몸 각 */
function lookAngles(rig: ActorRig, worldTarget: THREE.Vector3) {
  rig.toLocal(worldTarget, tmp.local).sub(ABISA_NECK);
  const yaw = Math.atan2(tmp.local.x, tmp.local.z);
  const pitch = Math.atan2(-tmp.local.y, Math.hypot(tmp.local.x, tmp.local.z));
  return { yaw, pitch };
}

function updateAbisa(brain: Brain, rig: ActorRig, eye: THREE.Vector3, camera: THREE.Camera, dt: number) {
  const { state, abisa } = brain;
  state.abisaDistance = rig.position.distanceTo(eye) / M;
  const talk = state.talk;
  const line = talk && talk.index >= 0 ? talk.lines[talk.index] : null;

  // 바라볼 곳 — 대사가 가리키는 곳(호미) · 가까운 플레이어 · 아니면 천천히 둘러보기
  let yaw = Math.sin(state.time * 0.23) * 0.25 + Math.sin(state.time * 0.11 + 0.7) * 0.12;
  let pitch = 0.05;
  if (line?.lookAt === "hoe") {
    tmp.target.set(HOE.x * M, rig.position.y + 0.4 * M, HOE.z * M);
    ({ yaw, pitch } = lookAngles(rig, tmp.target));
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

  // 인사(숙임) · 끄덕임
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
  abisa.bow = bow * LIMITS.bow;
  abisa.headPitch = state.lookPitch + bow * 0.15 + nod * 0.14;

  // 가리키기 — 대사가 가리키는 곳 쪽 팔을 앞 · 아래 · 바깥으로(몸통 비틀기를 뺀 몸통 기준)
  abisa.armL.set(1, 0, 0, 0);
  abisa.armR.set(1, 0, 0, 0);
  if (ARM_GESTURE.enabled && talk && line?.lookAt && talk.gestureTime >= 0) {
    talk.gestureTime += dt;
    const lift = envelope(talk.gestureTime - 0.3, 0.7, Math.max(0.5, lineSeconds(line.text) - 2.2), 0.7);
    rig.toLocal(tmp.target, tmp.local);
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

  // 대사 진행 — 창(소지품 · 설정 · 힌트함 · 동행 입력)이 떠 있거나 조작이 풀려 있으면 멈추고 자막을 내린다.
  // 안 그러면 창을 보는 사이 한 번뿐인 인사가 다 흘러가 「끝까지 들음」으로 저장된다(Codex 리뷰)
  if (talk) {
    const shouldPause = isWindowHeld() || !isPointerActive();
    if (shouldPause !== talk.isPaused) {
      talk.isPaused = shouldPause;
      if (shouldPause) setNpcSpeech(null);
      else if (line) setNpcSpeech({ speaker: ABISA_NAME, text: line.text, canAdvance: true });
    }
    if (shouldPause) return;
    talk.lineTime += dt;
    if (talk.index < 0 ? talk.lineTime >= 0 : talk.lineTime >= lineSeconds(line?.text ?? "")) nextLine(brain);
    // 멀리 가 버리면 그친다 — 인사를 끝까지 못 들었으면 다음에 다가올 때 안내만 다시
    if (brain.state.talk && state.abisaDistance > 14) stopTalk(brain);
    return;
  }

  // 처음 인사 — 마주 보고 6 m 안, 구렁이가 먼저 반응한 뒤
  camera.getWorldDirection(tmp.forward);
  tmp.toActor
    .copy(rig.position)
    .setY(rig.position.y + 1.3 * M)
    .sub(eye)
    .normalize();
  const isFacing = tmp.forward.dot(tmp.toActor) > 0.55;
  const serpentFirst = state.serpentDistance > 9 || state.alert > 0.85;
  const wantsGreeting = !state.greeted || (!state.guided && !state.resumed);
  if (wantsGreeting && state.abisaDistance < 6 && isFacing && serpentFirst && isFree()) state.inRange += dt;
  else state.inRange = 0;
  if (state.inRange < 0.6) return;
  state.inRange = 0;
  if (!state.greeted) {
    state.greeted = true;
    remember(GREETED_KEY, true);
    startTalk(brain, GREETING_LINES, { isGreeting: true, bow: true });
  } else {
    // 인사는 했지만 안내를 끝까지 못 들었다 — 지금 단계 한 줄만
    state.resumed = true;
    startTalk(brain, [stageLine(clamDig.stage(), fishTrapPuzzle.stage())], { isGreeting: false, bow: false });
  }
}

function writeRest(brain: Brain) {
  const { abisa, serpent } = brain;
  Object.assign(abisa, { breath: 0, headYaw: 0, headPitch: 0, torsoYaw: 0, bow: 0 });
  abisa.armL.set(1, 0, 0, 0);
  abisa.armR.set(1, 0, 0, 0);
  Object.assign(serpent, { breath: 0, yaw: 0, lift: 0, tongue: 1 });
}

export default function FirstSceneActors({ enabled }: { enabled: boolean }) {
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
  const headPosition = useMemo(() => new THREE.Vector3(0, -1e6, 0), []);
  const frame = useMemo(() => ({ count: 0 }), []);
  const lastPose = useMemo(() => ({ headYaw: 0, torsoYaw: 0, bow: 0, snakeYaw: 0, snakeLift: 0 }), []);

  // 겨누고 [E] — 처음 인사 뒤에는 지금 단계 한 줄, 말하는 중이면 다음 줄
  useEffect(() => {
    const target = {
      id: "abisa",
      position: headPosition,
      label: "아비사에게 말 걸기",
      radius: 0.55 * M,
      reach: 3.5 * M,
      enabled: () => enabled && rigs.abisa.isPlaced,
      use: () => {
        if (brain.state.talk) {
          nextLine(brain);
          return;
        }
        // 다가오기 전에 먼저 말을 걸면 그때 인사한다
        if (!brain.state.greeted) {
          brain.state.greeted = true;
          remember(GREETED_KEY, true);
          startTalk(brain, GREETING_LINES, { isGreeting: true, bow: true });
          return;
        }
        startTalk(brain, [stageLine(clamDig.stage(), fishTrapPuzzle.stage())], { isGreeting: false, bow: false });
      },
    };
    const remove = registerInteractable(target);
    return remove;
  }, [enabled, rigs, brain, headPosition]);

  useEffect(() => () => setNpcSpeech(null), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFirstScene", {
      state: () => ({ ...brain.state, talk: brain.state.talk && { ...brain.state.talk } }),
      pose: () => ({ abisa: { ...brain.abisa }, serpent: { ...brain.serpent } }),
      placed: () => ({ abisa: rigs.abisa.isPlaced, serpent: rigs.serpent.isPlaced }),
      /** 인사를 처음부터 다시(저장도 지운다) */
      resetGreeting: () => {
        stopTalk(brain);
        Object.assign(brain.state, { greeted: false, guided: false, resumed: false, tipShown: false });
        remember(GREETED_KEY, false);
        remember(GUIDED_KEY, false);
      },
      greet: () => startTalk(brain, GREETING_LINES, { isGreeting: true, bow: true }),
      talk: () =>
        startTalk(brain, [stageLine(clamDig.stage(), fishTrapPuzzle.stage())], { isGreeting: false, bow: false }),
      /** 팔 동작 켜고 끄기(화면 보고 정한다) */
      setArmGesture: (on: boolean) => {
        ARM_GESTURE.enabled = on;
      },
      /** 시험 — 자세를 직접(시간이 덮어쓰지 않게 멈춘 채) */
      freeze: (pose?: Partial<AbisaPose & { snakeYaw: number; snakeLift: number; tongue: number }>) => {
        frozen = pose ?? null;
      },
    });
  }, [brain, rigs]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (frame.count++ % 20 === 0) {
      rigs.abisa.sync(scene);
      rigs.serpent.sync(scene);
    } else {
      rigs.abisa.updatePlacement();
      rigs.serpent.updatePlacement();
    }
    if (rigs.abisa.isPlaced) rigs.abisa.toWorld(ABISA_HEAD, headPosition);
    else headPosition.set(0, -1e6, 0);

    if (!enabled) {
      stopTalk(brain);
      writeRest(brain);
    } else if (frozen) {
      writeRest(brain);
      const { snakeYaw, snakeLift, tongue, armL, armR, ...abisaPose } = frozen;
      Object.assign(brain.abisa, abisaPose);
      if (armL) brain.abisa.armL.copy(armL);
      if (armR) brain.abisa.armR.copy(armR);
      Object.assign(brain.serpent, {
        yaw: snakeYaw ?? 0,
        lift: snakeLift ?? 0,
        tongue: tongue ?? 1,
      });
    } else {
      brain.state.time += dt;
      const eye = camera.getWorldPosition(tmp.eye);
      if (rigs.serpent.isPlaced) updateSerpent(brain, rigs.serpent, eye, dt);
      if (rigs.abisa.isPlaced) updateAbisa(brain, rigs.abisa, eye, camera, dt);
    }
    // 그림자는 평소 몇 초에 한 번만 다시 그린다 — 가까이서 고개 · 몸이 크게 움직이는 동안은 촘촘히(Codex 리뷰)
    const motion =
      Math.abs(brain.abisa.headYaw - lastPose.headYaw) +
      Math.abs(brain.abisa.torsoYaw - lastPose.torsoYaw) +
      Math.abs(brain.abisa.bow - lastPose.bow) +
      Math.abs(brain.serpent.yaw - lastPose.snakeYaw) +
      Math.abs(brain.serpent.lift - lastPose.snakeLift);
    if (dt > 0 && motion / dt > 0.04 && Math.min(brain.state.abisaDistance, brain.state.serpentDistance) < 20)
      requestShadowUpdates(0.3);
    Object.assign(lastPose, {
      headYaw: brain.abisa.headYaw,
      torsoYaw: brain.abisa.torsoYaw,
      bow: brain.abisa.bow,
      snakeYaw: brain.serpent.yaw,
      snakeLift: brain.serpent.lift,
    });
    writeAbisaPose(rigs.abisa.uniforms, brain.abisa);
    writeSerpentPose(rigs.serpent.uniforms, brain.serpent);
  });

  return null;
}

/** (개발) 자세를 손으로 고정해 보는 값 — null 이면 평소대로 */
let frozen: Partial<AbisaPose & { snakeYaw: number; snakeLift: number; tongue: number }> | null = null;
