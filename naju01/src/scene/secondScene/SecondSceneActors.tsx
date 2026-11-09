/**
 * 두 번째 구역(바위 아래) 어부 셋 — 살아 있게 + 증언 · 길잡이(미르 11/9 「두 번째 장면 NPC 들도 아비사처럼」).
 *  - 무리(인물.어부 · 어부2 · 어부3)는 그대로 두고 아비사와 같은 정점 굽힘을 심는다(편집기 고르기 · 충돌 원기둥 그대로, Codex 06회차).
 *    공용 「사람」 굽힘에 모형마다 목 기준점만 다르다(bendShader PERSON_BODY). 팔은 그물 · 밧줄을 메고 있어 안 돌린다.
 *  - 숨 · 흔들림 · 둘러보기, 가까이 오면 플레이어 쪽으로 고개(몸통 조금), 말할 때 끄덕임, 처음엔 살짝 숙여 인사.
 *    대사가 바위를 말하면 앙암바위 쪽을 보고, 「고개 돌림」 줄은 시선을 떨구며 비킨다. 늙은 어부는 느리게.
 *  - 처음 가까이(5 m) 마주 보면 먼저 증언을 꺼낸다(한 사람씩 — 대화 차례). 끊기면 다음에 그 줄부터.
 *    다시 말 걸면 지금 단계 길잡이 한 줄 + 증언 한 줄(비교할 수 있게 다시 듣기, Codex 06회차).
 * 대사는 fisherLines.ts(초안).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { requestShadowUpdates } from "@/engine/shadowUpdates";

import { GROUP_IDS } from "../../placement/editFile";
import { registerInteractable } from "../../puzzles/interaction";
import { M } from "../../puzzles/units";
import { recall, remember } from "../../save/puzzleMemory";
import { ActorRig } from "../firstScene/actorRig";
import { personNeck, writePersonPose, type PersonPose } from "../firstScene/bendShader";
import { isTalkTaken } from "../firstScene/npcSpeech";
import { StoryTalk, isTalkPaused } from "../firstScene/storyTalk";
import { FISHER_SCRIPTS, stepHint, type FisherId } from "./fisherLines";
import { currentRockStep } from "./rockStep";

const FISHER_IDS: FisherId[] = ["fisher3", "fisher", "fisher2"];
const GROUPS: Record<FisherId, string> = {
  fisher: GROUP_IDS.fisher,
  fisher2: GROUP_IDS.fisher2,
  fisher3: GROUP_IDS.fisher3,
};
/** 겨냥 · 말 걸기 자리(모형 공간 — 얼굴 앞) */
const HEAD_LOCAL = new THREE.Vector3(0, 0.91, 0.04);
/** 앙암바위 — 두 사람이 만나던 절벽 위(첫 장면 LOOK_SPOTS.rock 과 같은 자리) */
const ROCK = { x: 45, z: 26, up: 9 };
/** 각도 한도(라디안) — 시험 상한(Codex 06회차: 확정값이 아니라 화면 보고 줄인다) */
const LIMITS = { headYaw: 0.8, torsoYaw: 0.25, headUp: -0.25, headDown: 0.35, bow: 0.2 };
const TALK = {
  /** 처음 증언을 먼저 꺼내는 거리(m) · 마주 봄(카메라 정면과 이 각 안) · 머문 시간(초) */
  autoReach: 5,
  faceCos: Math.cos(0.6),
  hold: 0.4,
  /** 이 안이면 플레이어 쪽을 본다 */
  lookReach: 8,
  /** 이보다 멀어지면 말을 그친다 */
  stopFar: 12,
};
/** 사람마다 움직임 빠르기 · 둘러보기 위상 — 늙은 어부는 느리게 */
const TEMPO: Record<FisherId, { speed: number; phase: number }> = {
  fisher3: { speed: 0.7, phase: 0 },
  fisher: { speed: 1.1, phase: 2.1 },
  fisher2: { speed: 0.9, phase: 4.3 },
};
const saveKey = (id: FisherId) => `secondScene.${id}.next`;

const clamp = THREE.MathUtils.clamp;
const smooth = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
const ease = (t: number) => THREE.MathUtils.smootherstep(clamp(t, 0, 1), 0, 1);
/** 0 → 1(올림) → 머묾 → 0(내림) */
const envelope = (t: number, rise: number, hold: number, fall: number) =>
  t < 0 ? 0 : t < rise ? ease(t / rise) : t < rise + hold ? 1 : 1 - ease((t - rise - hold) / fall);

function createFisher(id: FisherId) {
  const script = FISHER_SCRIPTS[id];
  return {
    id,
    script,
    rig: new ActorRig(id, GROUPS[id]),
    talk: new StoryTalk(`fisher:${id}`, script.name, true),
    neck: personNeck(id),
    /** 처음 증언을 이만큼 들었다(다음에 이 줄부터) */
    next: recall<number>(saveKey(id), 0),
    pose: { breath: 0, swayX: 0, swayY: 0, headYaw: 0, headPitch: 0, torsoYaw: 0, bow: 0 } as PersonPose,
    last: { headYaw: 0, torsoYaw: 0, bow: 0 },
    lookYaw: 0,
    lookPitch: 0,
    time: 0,
    inRange: 0,
    distance: Infinity,
    lineIndex: -1,
    nodTime: -1,
    bowTime: -1,
    head: new THREE.Vector3(0, -1e6, 0),
  };
}
type Fisher = ReturnType<typeof createFisher>;

const isHeard = (fisher: Fisher) => fisher.next >= fisher.script.first.length;

const tmp = {
  local: new THREE.Vector3(),
  target: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  toActor: new THREE.Vector3(),
  eye: new THREE.Vector3(),
};

function lookAngles(fisher: Fisher, worldTarget: THREE.Vector3) {
  fisher.rig.toLocal(worldTarget, tmp.local).sub(fisher.neck);
  return {
    yaw: Math.atan2(tmp.local.x, tmp.local.z),
    pitch: Math.atan2(-tmp.local.y, Math.hypot(tmp.local.x, tmp.local.z)),
  };
}

/** 처음 — 증언(끊긴 줄부터). 처음 줄이면 숙여 인사 */
function startFirst(fisher: Fisher) {
  const from = fisher.next;
  fisher.talk.onLineDone = (index) => {
    fisher.next = Math.min(fisher.script.first.length, Math.max(fisher.next, from + index + 1));
    remember(saveKey(fisher.id), fisher.next);
  };
  if (!fisher.talk.start(fisher.script.first.slice(from), from === 0 ? 0.55 : 0.2)) return;
  fisher.bowTime = from === 0 ? 0 : -1;
}

/** 다시 — 지금 단계 길잡이 + 증언 한 줄 */
function startAgain(fisher: Fisher) {
  fisher.talk.onLineDone = null;
  fisher.talk.start([stepHint(fisher.id, currentRockStep()), fisher.script.recap]);
}

function talkTo(fisher: Fisher) {
  if (fisher.talk.isActive) {
    fisher.talk.next();
    return;
  }
  if (isTalkTaken(fisher.talk.id)) return;
  if (!isHeard(fisher)) startFirst(fisher);
  else startAgain(fisher);
}

function updateFisher(fisher: Fisher, eye: THREE.Vector3, camera: THREE.Camera, dt: number) {
  const { rig, talk, pose } = fisher;
  const tempo = TEMPO[fisher.id];
  fisher.time += dt * tempo.speed;
  fisher.distance = rig.position.distanceTo(eye) / M;
  talk.tick(dt);
  const line = talk.line;
  if (talk.isActive && talk.index !== fisher.lineIndex && talk.index >= 0) fisher.nodTime = 0;
  fisher.lineIndex = talk.isActive ? talk.index : -1;

  // 바라볼 곳 — 대사가 가리키는 바위 · 가까운 플레이어 · 아니면 천천히 둘러보기
  const t = fisher.time + tempo.phase;
  let yaw = Math.sin(t * 0.21) * 0.28 + Math.sin(t * 0.09 + 0.5) * 0.12;
  let pitch = 0.06;
  if (line?.lookAt === "rock") {
    tmp.target.set(ROCK.x * M, rig.position.y + ROCK.up * M, ROCK.z * M);
    ({ yaw, pitch } = lookAngles(fisher, tmp.target));
  } else if (talk.isActive || fisher.distance < TALK.lookReach) {
    const look = lookAngles(fisher, eye);
    // 뒤쪽(110° 넘게)이면 억지로 목을 꺾지 않는다
    if (Math.abs(look.yaw) < 1.9) ({ yaw, pitch } = look);
  }
  const down = talk.isActive && line?.isDown ? envelope(talk.lineTime, 0.6, 99, 0.6) : 0;
  // 고개 돌림 줄 — 시선을 떨구며 옆으로 비킨다
  yaw += down * 0.45 * Math.sign(yaw || 1);
  const limitYaw = LIMITS.headYaw + LIMITS.torsoYaw;
  fisher.lookYaw = smooth(fisher.lookYaw, clamp(yaw, -limitYaw, limitYaw), 2.6 * tempo.speed, dt);
  fisher.lookPitch = smooth(fisher.lookPitch, clamp(pitch, LIMITS.headUp, LIMITS.headDown), 2.6 * tempo.speed, dt);
  pose.torsoYaw = clamp(fisher.lookYaw * 0.3, -LIMITS.torsoYaw, LIMITS.torsoYaw);
  pose.headYaw = clamp(fisher.lookYaw - pose.torsoYaw, -LIMITS.headYaw, LIMITS.headYaw);
  pose.breath = 0.045 * Math.sin((fisher.time * Math.PI * 2) / 4.2);
  pose.swayX = 0.01 * Math.sin(fisher.time * 0.6);
  pose.swayY = 0.007 * Math.sin(fisher.time * 0.43 + 1);

  // 인사(숙임) · 끄덕임
  let bow = 0;
  let nod = 0;
  if (fisher.bowTime >= 0) {
    fisher.bowTime += dt;
    bow = envelope(fisher.bowTime, 0.7, 0.4, 0.8);
    if (fisher.bowTime > 2) fisher.bowTime = -1;
  }
  if (fisher.nodTime >= 0) {
    fisher.nodTime += dt;
    nod = envelope(fisher.nodTime, 0.25, 0.1, 0.35);
    if (fisher.nodTime > 1) fisher.nodTime = -1;
  }
  pose.bow = bow * LIMITS.bow;
  pose.headPitch = fisher.lookPitch + bow * 0.12 + nod * 0.12 + down * 0.22;

  // 처음 증언 — 가까이 마주 보고 잠깐 머물면 먼저 말한다(다른 사람이 말하는 중이 아닐 때)
  if (!isHeard(fisher) && !talk.isActive) {
    camera.getWorldDirection(tmp.forward);
    tmp.toActor.subVectors(fisher.head, eye).normalize();
    const isFacing = tmp.forward.dot(tmp.toActor) > TALK.faceCos;
    const isFree = !isTalkTaken() && !isTalkPaused();
    if (fisher.distance < TALK.autoReach && isFacing && isFree) fisher.inRange += dt;
    else fisher.inRange = 0;
    if (fisher.inRange > TALK.hold) {
      fisher.inRange = 0;
      startFirst(fisher);
    }
  }
  // 멀리 가 버리면 그친다 — 증언은 들은 줄까지 남는다
  if (talk.isActive && fisher.distance > TALK.stopFar) talk.stop();
}

function writeRest(fisher: Fisher) {
  Object.assign(fisher.pose, { breath: 0, swayX: 0, swayY: 0, headYaw: 0, headPitch: 0, torsoYaw: 0, bow: 0 });
  fisher.lookYaw = 0;
  fisher.lookPitch = 0;
}

interface SecondSceneActorsProps {
  /** 편집 중이면 끈다(기본 자세로) */
  enabled: boolean;
}

export default function SecondSceneActors({ enabled }: SecondSceneActorsProps) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const fishers = useMemo(() => FISHER_IDS.map(createFisher), []);
  const frame = useMemo(() => ({ count: 0 }), []);

  useEffect(() => {
    const removers = fishers.map((fisher) =>
      registerInteractable({
        id: `second-${fisher.id}`,
        position: fisher.head,
        label: `${fisher.script.name}에게 말 걸기`,
        radius: 0.5 * M,
        reach: 3.5 * M,
        enabled: () => enabled && fisher.rig.isPlaced,
        use: () => talkTo(fisher),
      }),
    );
    return () => removers.forEach((remove) => remove());
  }, [enabled, fishers]);

  useEffect(() => () => fishers.forEach((fisher) => fisher.talk.stop()), [fishers]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuSecondScene", {
      state: () =>
        fishers.map((fisher) => ({
          id: fisher.id,
          next: fisher.next,
          isTalking: fisher.talk.isActive,
          line: fisher.talk.line?.text ?? null,
          distance: +fisher.distance.toFixed(2),
          placed: fisher.rig.isPlaced,
          pose: { ...fisher.pose },
        })),
      step: currentRockStep,
      /** 처음부터 다시(저장도 지운다) */
      reset: () =>
        fishers.forEach((fisher) => {
          fisher.talk.stop();
          fisher.next = 0;
          remember(saveKey(fisher.id), 0);
        }),
      talk: (id: FisherId) => {
        const fisher = fishers.find((item) => item.id === id);
        if (fisher) talkTo(fisher);
      },
    });
  }, [fishers]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    // 무리를 다시 찾는 일(장면 전체 훑기)은 60 프레임에 한 사람씩 엇갈려 — 첫 장면 둘과 겹치지 않게
    const tick = frame.count++ % 60;
    const eye = camera.getWorldPosition(tmp.eye);
    let isMoving = false;
    for (const [index, fisher] of fishers.entries()) {
      // 아직 못 찾았으면(모형을 읽는 중) 20 프레임마다
      if (tick === 7 + index * 20 || (!fisher.rig.isPlaced && tick % 20 === index)) fisher.rig.sync(scene);
      else fisher.rig.updatePlacement();
      if (fisher.rig.isPlaced) fisher.rig.toWorld(HEAD_LOCAL, fisher.head);
      else fisher.head.set(0, -1e6, 0);
      if (!enabled || !fisher.rig.isPlaced) {
        fisher.talk.stop();
        writeRest(fisher);
      } else {
        updateFisher(fisher, eye, camera, dt);
      }
      // 그림자는 고개 · 몸이 크게 움직이는 동안만 촘촘히(아비사와 같다)
      const motion =
        Math.abs(fisher.pose.headYaw - fisher.last.headYaw) +
        Math.abs(fisher.pose.torsoYaw - fisher.last.torsoYaw) +
        Math.abs(fisher.pose.bow - fisher.last.bow);
      if (dt > 0 && motion / dt > 0.04 && fisher.distance < 20) isMoving = true;
      fisher.last.headYaw = fisher.pose.headYaw;
      fisher.last.torsoYaw = fisher.pose.torsoYaw;
      fisher.last.bow = fisher.pose.bow;
      writePersonPose(fisher.rig.uniforms, fisher.pose);
    }
    if (isMoving) requestShadowUpdates(0.3);
  });

  return null;
}
