/**
 * 증언 능선의 돌새 — 씬2 솟대 두 마리가 돌로 굳어 서로 등을 돌리고 있다(엇갈린 증언). 오른쪽 새는 부리에 열쇠를 물었다.
 *   돌새는 받침이 팔각이라 E 한 번에 45° 씩 돈다. 손이 닿아야 돌린다(걸상 허공 계단을 딛고 올라선다).
 *   둘이 마주 보면 딸깍 맞물려 더는 안 돈다 → 두 기둥 사이 화석 자리에 푸른 눈물을 맞춰 넣으면(BirdHints) 깨어난다:
 *   기둥이 점점 떨리고 → 돌 껍질이 알껍데기처럼 깨져 흩날리며 장막이 풀린다 → 장막 밖에 모여 있던 새 떼
 *   → 두 새가 하늘을 한 바퀴 반 돌며 열쇠를 플레이어 앞에 떨어뜨린다 → 풀린 장막 위로 새 떼와 함께 멀리 날아간다.
 * 씬2 솟대 0·1 번은 그 자리에서 숨기고 여기서 다시 그린다(회전·깨짐을 보여야 해서). 편집으로 옮기면 따라간다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { recall, remember, track } from "../../save/puzzleMemory";
import { playerPose } from "../../movement/playerPose";
import { addDynamicSolid, solidQueries, type DynamicSolid } from "../../movement/solidField";
import { focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { POLE_TOP } from "../../story/scene2";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import { buildBird, faceMotion, flapWings, type Bird } from "./birdFlight";
import { BILL_TIP, buildCarvedDuckAtPoleTop, buildFlyingDuck, buildPole, toStone } from "./birdModels";
import { buildBronzeKey } from "./lockedBox";
import {
  CURTAIN,
  KEY_STATUE,
  RIDGE_CENTER,
  STATUE_IDS,
  curtainDistance,
  curtainPoint,
  isInsideCurtain,
  nearestCurtainT,
} from "./ridgeShape";
import { ridge, ridgeDev, ridgeQuest, useRidgeStage } from "./ridgeState";
import { crackShell, createStoneShell, updateChunks, updateShards } from "./stoneShell";
import { makeVertexColorMaterial } from "./vertexPaint";

/** 팔각 받침 — 한 칸의 각 */
const STEP_ANGLE = Math.PI / 4;
/** 돌새에 손이 닿는 거리(눈에서 새까지, m) — 땅에서는 모자라고 허공 계단 꼭대기에서야 닿는다 */
const TOUCH_REACH = 1.3;
/**
 * 비늘을 맞춘 뒤의 순서(초) — 잠깐은 마음대로 움직인다 → 땅이 낮게 울린다 → 크게 흔들린다 → 화면이 돌새로 가고
 * 기둥이 떨리다 껍질이 깨진다. 돌새로 화면을 돌리는 때 = free + small + big
 */
const QUAKE = { free: 2, small: 1.8, big: 2.4, statue: 3.2 };
const FOCUS_AT = QUAKE.free + QUAKE.small + QUAKE.big;
/** 비늘을 맞춘 뒤 껍질이 깨지기까지(초) */
const SHAKE_SECONDS = FOCUS_AT + QUAKE.statue;
/** 깨어난 오리 크기(몸길이 m 쯤) · 새 떼 수 */
const DUCK_SIZE = 0.72;
const FLOCK = 18;
/** 깨어난 뒤 둥지에서 날개를 터는 시간 · 날아올라 원에 들기까지 · 한 바퀴(초) */
const PERCH_SECONDS = 1.8;
const TAKEOFF_SECONDS = 2.5;
const LAP_SECONDS = 4.2;
/** 하늘을 도는 바퀴 수 — 열쇠를 떨어뜨리고 바로 떠난다 */
const LAPS = 1.5;
const CIRCLE_RADIUS = 5.5;
const CIRCLE_HEIGHT = 8;
/** 이 지점(바퀴 비율)에서 열쇠를 떨어뜨린다 · 열쇠가 떨어지는 시간 */
const THROW_AT = 1.15;
// 천천히 — 떨어지는 열쇠를 시선이 따라가 어디에 떨어지는지 보이게(박람회판 정리 · 미르 11/8, 예전 1.3)
const THROW_SECONDS = 2.4;
/** 떠나는 쪽 — 진부촌 너머 북동 하늘 */
const DEPART = new THREE.Vector3(1, 0, -0.75).normalize();

interface Statue {
  /** 받침 자리(m)와 크기(솟대 키 m) — 그려진 솟대에서 읽는다 */
  x: number;
  z: number;
  ground: number;
  size: number;
  /** 지금 바라보는 쪽(rotation.y) · 돌아가는 목표 */
  yaw: number;
  targetYaw: number;
  group: THREE.Group;
  pivot: THREE.Group;
  stone: THREE.Mesh;
  key: THREE.Mesh | null;
  solid: DynamicSolid;
  touch: THREE.Vector3;
}

const scratch = {
  matrix: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  euler: new THREE.Euler(0, 0, 0, "YXZ"),
  /** 화면 고정이 바라볼 두 돌새 사이(유닛) */
  focusSpot: new THREE.Vector3(),
};

/** 두 돌새 꼭대기 사이 — 깨어나는 동안 바라볼 자리(유닛) */
function statueMidpoint(statues: { touch: THREE.Vector3 }[], out: THREE.Vector3) {
  out.set(0, 0, 0);
  for (const statue of statues) out.add(statue.touch);
  out.divideScalar(Math.max(1, statues.length));
  out.y += 0.3 * M;
  return out;
}
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const snapToStep = (angle: number) => Math.round(angle / STEP_ANGLE) * STEP_ANGLE;
const yawTowards = (from: Statue, to: Statue) => Math.atan2(to.x - from.x, to.z - from.z);
/** 둘이 서로 마주 보나 — 팔각 칸으로 */
const facesEachOther = (statues: Statue[]) =>
  statues.length === 2 &&
  statues.every(
    (statue, k) =>
      Math.abs(wrapAngle(statue.targetYaw - snapToStep(yawTowards(statue, statues[1 - k])))) < STEP_ANGLE / 2,
  );

function createBirds() {
  const stoneDuck = toStone(buildCarvedDuckAtPoleTop());
  // 돌새 껍질만 따로 — 깨지기 전 금 사이로 흰빛이 새어 나온다(장대는 그대로). 조각은 속이 빈 껍질이라 안쪽 면도 그린다
  const shellMaterial = makeVertexColorMaterial({
    emissive: new THREE.Color("#FFF6EA"),
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  const keyGeometry = buildBronzeKey();
  const keyBronze = makeVertexColorMaterial({ emissive: new THREE.Color("#3A2A10") });
  const drake = buildFlyingDuck(true);
  const hen = buildFlyingDuck(false);
  const birdMaterial = makeVertexColorMaterial({ side: THREE.DoubleSide });
  const heroes = [buildBird(drake, birdMaterial, DUCK_SIZE, 0.11), buildBird(hen, birdMaterial, DUCK_SIZE, 0.53)];
  const flock = Array.from({ length: FLOCK }, (_, k) => {
    const look = k % 3 === 0 ? hen : drake;
    const bird = buildBird(look, birdMaterial, DUCK_SIZE * (0.75 + Math.random() * 0.25), Math.random());
    bird.orbit = {
      rx: CURTAIN.x[1] - RIDGE_CENTER.x + 6 + Math.random() * 6,
      rz: CURTAIN.z[1] - RIDGE_CENTER.z + 6 + Math.random() * 6,
      height: 7 + Math.random() * 8,
      speed: 0.18 + Math.random() * 0.12,
      angle: (k / FLOCK) * Math.PI * 2 + Math.random() * 0.3,
    };
    return bird;
  });
  const shell = createStoneShell(stoneDuck, shellMaterial, STATUE_IDS.length);
  // 깨어난 새가 부리에 문 열쇠 — 던질 때 떨어진다(새 표본 단위)
  const heldKey = new THREE.Mesh(keyGeometry, keyBronze);
  heldKey.position.set(0, 0.08, 0.72);
  heldKey.rotation.set(0, 0, 0);
  heldKey.scale.setScalar(1.6 / DUCK_SIZE);
  heroes[KEY_STATUE].group.add(heldKey);
  // 떨어지는 열쇠(던지는 동안만)
  const flyingKey = new THREE.Mesh(keyGeometry, keyBronze);
  // 떨어지는 동안 읽히게 크게(예전 1.6)
  flyingKey.scale.setScalar(M * 2.8);
  flyingKey.visible = false;
  return {
    stoneDuck,
    poleGeometry: buildPole(),
    stoneMaterial: makeVertexColorMaterial(),
    shellMaterial,
    shell,
    keyGeometry,
    keyStone: makeToonMaterial("#B4BAC1"),
    heroes,
    flock,
    flyingKey,
    heldKey,
    statues: [] as Statue[],
    /** 그려진 솟대 무리 — 모양마다 따로 된 메시라 여럿이다. 한 번 찾으면 들고 있는다 */
    sources: [] as THREE.InstancedMesh[],
    searchedAt: -99,
    /** 열쇠 던지기 */
    throwing: null as null | { from: THREE.Vector3; to: THREE.Vector3; startedAt: number },
    isThrown: false,
    /** 장막을 뚫고 나가는 자리(둘레 0~1) · 그 바깥 하늘의 한 점 */
    exitT: 0,
    exitPoint: new THREE.Vector3(),
    isBroken: false,
    brokeAt: 0,
    told: { statues: false, rotate: false },
    lastRumbleAt: 0,
    quakePhase: "" as "" | "small" | "big" | "statue",
    isFlockShown: false,
    flockShownAt: 0,
    departAt: Infinity,
  };
}
type Birds = ReturnType<typeof createBirds>;

/** 돌새 둘 — 솟대 0·1 번을 찾아 숨기고 그 자리에 다시 세운다. 구역 초점이 무리를 다시 채우면 다시 숨긴다 */
function placeStatues(birds: Birds, scene: THREE.Scene, time: number) {
  if ((!birds.sources.length || birds.sources.some((mesh) => !mesh.parent)) && time - birds.searchedAt > 1) {
    birds.searchedAt = time;
    birds.sources = [];
    scene.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh && object.name === "씬2.솟대" && !object.userData.publicAsset)
        birds.sources.push(object as THREE.InstancedMesh);
    });
  }
  const { matrix, position, quaternion, scale, euler } = scratch;
  const found: { id: number; x: number; z: number; y: number; yaw: number; size: number }[] = [];
  let hasChanged = false;
  for (const mesh of birds.sources) {
    const ids = mesh.userData.ids as Int32Array | undefined;
    if (!ids || mesh.userData.ridgeHiddenFor === ids) continue;
    mesh.userData.ridgeHiddenFor = ids;
    hasChanged = true;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < ids.length; i++) {
      if (!(STATUE_IDS as readonly number[]).includes(ids[i])) continue;
      mesh.getMatrixAt(i, matrix);
      matrix.premultiply(mesh.matrixWorld).decompose(position, quaternion, scale);
      euler.setFromQuaternion(quaternion, "YXZ");
      found.push({
        id: ids[i],
        x: position.x / M,
        z: position.z / M,
        y: position.y / M,
        yaw: euler.y,
        size: scale.y / M,
      });
      mesh.setMatrixAt(i, ZERO_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  if (!hasChanged || found.length < STATUE_IDS.length) return;
  found.sort((a, b) => a.id - b.id);
  if (birds.statues.length) return; // 이미 세웠다 — 숨기기만 다시
  found.forEach((spot, k) => {
    const group = new THREE.Group();
    group.position.set(spot.x * M, spot.y * M, spot.z * M);
    group.scale.setScalar(spot.size * M);
    group.add(new THREE.Mesh(birds.poleGeometry, birds.stoneMaterial));
    const pivot = new THREE.Group();
    pivot.position.y = POLE_TOP;
    pivot.rotation.y = spot.yaw;
    group.add(pivot);
    const stone = new THREE.Mesh(birds.stoneDuck, birds.shellMaterial);
    pivot.add(stone);
    let key: THREE.Mesh | null = null;
    if (k === KEY_STATUE) {
      key = new THREE.Mesh(birds.keyGeometry, birds.keyStone);
      key.position.copy(BILL_TIP);
      key.rotation.set(0, 0, 0);
      key.scale.setScalar(1.6 / spot.size);
      pivot.add(key);
    }
    scene.add(group);
    // 가는 돌기둥 — 막기만 하고 꼭대기에 서지는 못한다(높이 뛰어 올라앉지 못하게)
    const solid: DynamicSolid = {
      x: spot.x,
      z: spot.z,
      yaw: 0,
      halfX: 0.09,
      halfZ: 0.09,
      bottom: spot.y - 0.2,
      top: spot.y + spot.size * 1.05,
      enabled: true,
      walkable: false,
    };
    addDynamicSolid(solid);
    birds.statues.push({
      x: spot.x,
      z: spot.z,
      ground: spot.y,
      size: spot.size,
      yaw: spot.yaw,
      targetYaw: spot.yaw,
      group,
      pivot,
      stone,
      key,
      solid,
      touch: new THREE.Vector3(spot.x * M, (spot.y + spot.size * 1.0) * M, spot.z * M),
    });
  });
  // 처음엔 서로 등을 돌리고 있다
  birds.statues.forEach((statue, k) => {
    statue.targetYaw = snapToStep(yawTowards(statue, birds.statues[1 - k]) + Math.PI);
    const savedYaw = recall<number[]>("ridge.statueYaw", [])[k];
    if (savedYaw !== undefined) statue.targetYaw = savedYaw;
    statue.yaw = statue.targetYaw;
  });
}

/** 장막을 향해 나가고, 뚫으면 장막을 풀고, 새 떼와 함께 북동 하늘로 */
function flyAway(birds: Birds, bird: Bird, dt: number, k: number) {
  const at = bird.group.position;
  const xm = at.x / M;
  const zm = at.z / M;
  const isHero = birds.heroes.includes(bird);
  const target =
    isHero && ridge.releaseFrom() === null
      ? birds.exitPoint
      : new THREE.Vector3(
          (RIDGE_CENTER.x + DEPART.x * 140 + (k % 5) * 6) * M,
          (groundY(RIDGE_CENTER.x, RIDGE_CENTER.z) + 30 + (k % 4) * 3) * M,
          (RIDGE_CENTER.z + DEPART.z * 140 + Math.floor(k / 5) * 6) * M,
        );
  const step = target.clone().sub(at);
  const speed = (isHero ? 7 : 8.5) * M * dt;
  if (step.length() > speed) step.setLength(speed);
  at.add(step);
  flapWings(bird, dt, 0.8);
  // 장막을 뚫는 순간 — 그 자리부터 풀린다
  if (isHero && ridge.releaseFrom() === null && curtainDistance(xm, zm) > 0) {
    ridge.breakCurtainAt(birds.exitT);
    audio.play("전환");
  }
  // 멀리 가면 끈다
  if (Math.hypot(xm - RIDGE_CENTER.x, zm - RIDGE_CENTER.z) > 120) bird.group.visible = false;
}

/** 열쇠를 문 새에서 플레이어 발 앞으로 — 어디에 서 있든 앞 1.3 m(막혀 있으면 발밑) */
function startThrow(birds: Birds, camera: THREE.Camera, from: THREE.Vector3) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const footY = camera.position.y / M - 1.6;
  const floorAt = (x: number, z: number) => {
    const support = solidQueries.current?.supportAt(x, z, footY + 0.3) ?? -Infinity;
    return Math.max(groundY(x, z), support);
  };
  let x = camera.position.x / M + forward.x * 1.3;
  let z = camera.position.z / M + forward.z * 1.3;
  if (!isInsideCurtain(x, z, 0.5) || solidQueries.current?.blockedAt(x, z, groundY(x, z), 0.1)) {
    x = camera.position.x / M;
    z = camera.position.z / M;
  }
  birds.heldKey.visible = false;
  birds.throwing = {
    from: from.clone(),
    to: new THREE.Vector3(x * M, floorAt(x, z) * M, z * M),
    startedAt: gameNow() / 1000,
  };
  birds.flyingKey.visible = true;
  showNotice("열쇠를 문 새가 고개를 숙인다 — 무언가 떨어진다!", 3);
  // 시선이 떨어지는 열쇠를 따라 내려가 떨어진 자리를 보고 끝난다 — 표식 없이 연출로만(길잡이는 넣지 않는다)
  focusCamera({
    id: "key-drop",
    target: () => birds.flyingKey.position,
    hold: THROW_SECONDS + 0.6,
    turnIn: 0.45,
    turnOut: 0.4,
    zoom: 0.9,
    replace: true,
  });
}

function updateThrow(birds: Birds, time: number) {
  const throwing = birds.throwing;
  if (!throwing || birds.isThrown) return;
  const u = Math.min(1, (gameNow() / 1000 - throwing.startedAt) / THROW_SECONDS);
  const peak = Math.max(throwing.from.y, throwing.to.y) + 1.2 * M;
  const y = (1 - u) * (1 - u) * throwing.from.y + 2 * (1 - u) * u * peak + u * u * throwing.to.y;
  birds.flyingKey.position.set(
    THREE.MathUtils.lerp(throwing.from.x, throwing.to.x, u),
    y,
    THREE.MathUtils.lerp(throwing.from.z, throwing.to.z, u),
  );
  birds.flyingKey.rotation.set(time * 9, time * 5, 0);
  if (u >= 1) {
    birds.isThrown = true;
    remember("ridge.isKeyThrown", true);
    birds.flyingKey.visible = false;
    inventory.spawn("bronzeKey", throwing.to, { followsPlayer: true });
    audio.play("단서");
    showNotice(
      "새가 열쇠를 발 앞에 떨어뜨렸다. 대가 긴 청동 열쇠 — 아랑사의 함 자물통에 맞을 것 같다. [E] 로 줍자.",
      5,
      // 기다리는 사이 이미 주웠으면 지난 말
      { isValid: () => inventory.world().some((item) => item.kind === "bronzeKey") },
    );
  }
}

export default function RidgeBirds() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const centerGround = useMemo(() => groundY(RIDGE_CENTER.x, RIDGE_CENTER.z), []);
  // 저장본이 깨어난 다음 단계면 처음부터 깨진 뒤로 친다. 깨어나는 중이었다면 그 연출은 다시 본다.
  const [isRestoredBroken] = useState(() => ridge.isAtLeast("circling"));
  const birds = useMemo(() => {
    const created = createBirds();
    created.isThrown = recall("ridge.isKeyThrown", false);
    return created;
  }, []);
  useEffect(
    () =>
      track("ridge.statueYaw", () =>
        birds.statues.length ? birds.statues.map((statue) => statue.targetYaw) : undefined,
      ),
    [birds],
  );
  const stage = useRidgeStage();
  const stageRef = useRef(stage);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    const objects = [
      birds.shell.shards,
      birds.flyingKey,
      ...birds.heroes.map((bird) => bird.group),
      ...birds.flock.map((bird) => bird.group),
    ];
    scene.add(...objects);
    // 새 · 껍질 조각은 깨어날 때 처음 보인다 — 셰이더를 미리 굽는다(껍질 조각 재질은 돌새와 같다)
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, objects), 3200);
    return () => {
      window.clearTimeout(warm);
      scene.remove(...objects);
      for (const statue of birds.statues) scene.remove(statue.group);
    };
  }, [scene, birds, gl, camera]);

  // 깨어남·떠남 소리와 안내(떨림 · 깨짐 안내는 프레임에서, 비늘을 맞춘 안내는 BirdHints)
  useEffect(() => {
    // 깨어남의 소리·화면 고정은 프레임에서(quakeGround) — 비늘을 맞추고 2초는 마음대로 움직인다
    if (stage === "circling") {
      showNotice("장막 밖에서 새 떼가 맴돌며 두 새를 기다린다.", 4);
      // 열쇠를 문 새가 날아올라 하늘을 돌기 시작하는 것을 따라본다
      focusCamera({
        id: "birds-circling",
        target: () => birds.heroes[KEY_STATUE].group.position,
        hold: TAKEOFF_SECONDS + 1.8,
        turnIn: 0.7,
        turnOut: 0.7,
        zoom: 0.85,
        replace: true,
      });
    }
  }, [stage, birds]);

  // 돌리기 — E 한 번에 45°. 돌새가 세워진 뒤에 등록한다
  useEffect(() => {
    const removers: (() => void)[] = [];
    const register = () => {
      birds.statues.forEach((statue, k) => {
        removers.push(
          registerInteractable({
            id: `ridge-statue-${k}`,
            position: statue.touch,
            label: "돌새 돌리기",
            radius: 0.6 * M,
            reach: 5 * M,
            enabled: () => stageRef.current === "sealed" && !ridgeQuest.birdsFacing,
            use: () => {
              if (!ridgeQuest.stairs) {
                showNotice(
                  "돌새가 꿈쩍도 않는다 — 걸상이 바람에 떠올라 계단이 되어야 손이 닿는다. 평상 널의 이야기부터.",
                  4,
                );
                return;
              }
              const eye = camera.position;
              // 돌새는 무겁다 — 허공(장막 안 높은 점프)에서는 힘이 안 들어간다. 딛고 서야 돌린다.
              // 발 둘레 다섯 점 — 걷기 판정과 같이 가장자리를 딛고 서도 선 것으로 본다
              const foot = playerPose.footY;
              let support = -Infinity;
              for (const [dx, dz] of [
                [0, 0],
                [0.18, 0],
                [-0.18, 0],
                [0, 0.18],
                [0, -0.18],
              ]) {
                const x = eye.x / M + dx;
                const z = eye.z / M + dz;
                support = Math.max(
                  support,
                  groundY(x, z),
                  solidQueries.current?.supportAt(x, z, foot + 0.08) ?? -Infinity,
                );
              }
              if (foot - support > 0.12) {
                showNotice("허공에서는 돌새를 돌릴 힘이 들어가지 않는다. 단단히 딛고 서서 돌리자.", 3, {
                  urgent: true,
                  fleeting: true,
                });
                return;
              }
              const distance = eye.distanceTo(statue.touch) / M;
              if (distance > TOUCH_REACH) {
                const isLow = eye.y / M < statue.touch.y / M - 0.8;
                showNotice(
                  isLow ? "손이 닿지 않는다. 무언가를 딛고 올라서야 한다." : "조금 더 가까이 가야 손이 닿는다.",
                  3,
                );
                return;
              }
              // 팔각 받침 — 늘 45° 칸에 맞춰 돈다
              statue.targetYaw = (Math.round(statue.targetYaw / STEP_ANGLE) + 1) * STEP_ANGLE;
              audio.play("똑");
              if (!birds.told.rotate) {
                birds.told.rotate = true;
                showNotice("돌새가 드르륵 돌아간다. 받침이 팔각으로 깎여 여덟 방향으로만 선다.", 4);
              }
            },
          }),
        );
      });
    };
    const timer = setInterval(() => {
      if (!birds.statues.length || removers.length) return;
      register();
    }, 500);
    ridgeDev.solve = () => {
      birds.statues.forEach((statue, k) => (statue.targetYaw = snapToStep(yawTowards(statue, birds.statues[1 - k]))));
      for (const key of ["chestOnAltar", "postsSolved", "stairs", "birdsFacing", "scaleSet"] as const)
        ridgeQuest.set(key);
      ridge.advance("awakening");
    };
    return () => {
      clearInterval(timer);
      removers.forEach((remove) => remove());
      ridgeDev.solve = null;
    };
  }, [birds, camera]);

  /** 돌새 — 천천히 돈다. 비늘을 맞추면 기둥째 점점 세게 떤다. 둘이 마주 보면 딸깍 */
  const turnStatues = (now: string, since: number, time: number, dt: number) => {
    const shaking =
      now === "awakening" && !birds.isBroken ? THREE.MathUtils.smoothstep(since, QUAKE.free, SHAKE_SECONDS) : 0;
    for (const statue of birds.statues) {
      statue.yaw += wrapAngle(statue.targetYaw - statue.yaw) * (1 - Math.exp(-dt * 6));
      statue.pivot.rotation.y = statue.yaw;
      statue.touch.set(statue.x * M, (statue.ground + statue.size * 1.0) * M, statue.z * M);
      statue.group.position.set(
        (statue.x + Math.sin(time * 41 + statue.x) * 0.02 * shaking) * M,
        statue.ground * M,
        (statue.z + Math.cos(time * 37 + statue.z) * 0.02 * shaking) * M,
      );
      statue.group.rotation.set(Math.sin(time * 29) * 0.012 * shaking, 0, Math.cos(time * 31) * 0.012 * shaking);
    }
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    if (now === "sealed" && !birds.told.statues && Math.hypot(px - birds.statues[0].x, pz - birds.statues[0].z) < 5) {
      birds.told.statues = true;
      showNotice(
        "돌로 굳은 새 두 마리가 서로 등을 돌리고 있다. 오른쪽 새는 부리에 무언가를 물었다. 너무 높아 손이 닿지 않는다.",
        5,
      );
    }
    if (
      now === "sealed" &&
      !ridgeQuest.birdsFacing &&
      facesEachOther(birds.statues) &&
      birds.statues.every((statue) => Math.abs(wrapAngle(statue.targetYaw - statue.yaw)) < 0.02)
    ) {
      ridgeQuest.set("birdsFacing");
      audio.play("징");
      showNotice(
        "두 돌새가 마침내 서로 마주 본다 — 받침이 딸깍 맞물린다. 두 기둥 사이 땅의 돌판이 희미하게 빛난다.",
        5,
      );
    }
    // 떨리는 동안 껍질 금 사이로 흰빛이 새어 나온다 — 깨지기 직전 가장 밝게, 깜박이며
    birds.shellMaterial.emissiveIntensity = shaking * shaking * (0.35 + 0.25 * Math.sin(time * 23));
  };

  /** 지진 — 작게 울리다 크게 흔들리고, 그 다음에야 화면이 돌새로 간다. 떨림은 director 트라우마로(위아래만) */
  const quakeGround = (now: string, since: number, time: number) => {
    if (now !== "awakening" || birds.isBroken || since < QUAKE.free) return;
    const phase = since < QUAKE.free + QUAKE.small ? "small" : since < FOCUS_AT ? "big" : "statue";
    if (birds.quakePhase !== phase) {
      birds.quakePhase = phase;
      audio.play("우르릉");
      if (phase === "small") showNotice("발밑에서 땅이 낮게 울린다…", 2.5);
      if (phase === "big") {
        director.cue({ 카메라: "흔들림", 세기: 0.45 });
        showNotice("흔들림이 커진다 — 두 기둥 쪽이다!", 2.5);
      }
      if (phase === "statue")
        // 기둥이 떨리다 껍질이 깨지고 진짜 새가 되는 것을 본다
        focusCamera({
          id: "birds-awakening",
          target: () => statueMidpoint(birds.statues, scratch.focusSpot),
          hold: QUAKE.statue + 0.5,
          turnIn: 0.6,
          turnOut: 0.6,
          zoom: 0.8,
          replace: true,
        });
    }
    const gap = phase === "small" ? 0.35 : 0.3;
    if (time - birds.lastRumbleAt < gap) return;
    birds.lastRumbleAt = time;
    // 트라우마는 제곱으로 먹히고 초당 0.8 씩 빠진다 — 작은 지진도 보이려면 0.3 쯤은 되어야 한다
    const strength =
      phase === "small"
        ? 0.3 + 0.05 * Math.sin(time * 5)
        : phase === "big"
          ? 0.42 + 0.1 * Math.sin(time * 7)
          : 0.25 + 0.3 * THREE.MathUtils.smoothstep(since, FOCUS_AT, SHAKE_SECONDS);
    director.cue({ 카메라: "흔들림", 세기: strength });
  };

  /** 깨어남 — 떨림 끝에 돌 껍질이 알껍데기처럼 깨지며 장막이 풀린다. 둥지 위에 진짜 새 */
  const awaken = (now: string, since: number, time: number) => {
    // 새 떼는 비늘을 맞추는 순간부터 장막 밖에 모여든다(풀리기 전에 보이게)
    if (ridge.isAtLeast("awakening") && !birds.isFlockShown) {
      birds.isFlockShown = true;
      birds.flockShownAt = time;
      for (const bird of birds.flock) bird.group.visible = true;
    }
    // 이어 하기: 깨어난 뒤라면 깨지는 연출 없이 그 뒤 모습으로 시작한다.
    if (!birds.isBroken && isRestoredBroken && birds.statues.length) {
      birds.isBroken = true;
      birds.brokeAt = time;
      const areBirdsAround = now === "circling" || now === "leaving";
      birds.statues.forEach((statue, k) => {
        statue.stone.visible = false;
        if (statue.key) statue.key.visible = false;
        statue.pivot.updateMatrixWorld(true);
        const hero = birds.heroes[k];
        statue.pivot.getWorldPosition(hero.group.position);
        hero.group.rotation.set(0, statue.yaw, 0);
        hero.previous.copy(hero.group.position);
        hero.group.visible = areBirdsAround;
      });
      if (!areBirdsAround) for (const bird of birds.flock) bird.group.visible = false;
      return;
    }
    if (!ridge.isAtLeast("awakening") || birds.isBroken || (now === "awakening" && since <= SHAKE_SECONDS)) return;
    birds.isBroken = true;
    birds.brokeAt = time;
    audio.play("우르릉");
    audio.play("전환");
    director.cue({ 카메라: "흔들림", 세기: 0.4 });
    showNotice("돌 껍질이 알껍데기처럼 깨져 흩날린다 — 바람 장막이 한꺼번에 풀린다!", 5);
    const mid = { x: (birds.statues[0].x + birds.statues[1].x) / 2, z: (birds.statues[0].z + birds.statues[1].z) / 2 };
    ridge.breakCurtainAt(nearestCurtainT(mid.x, mid.z));
    birds.statues.forEach((statue, k) => {
      statue.stone.visible = false;
      if (statue.key) statue.key.visible = false;
      crackShell(birds.shell, scene, statue.pivot, statue.stone, statue.size, k);
      statue.pivot.updateMatrixWorld(true);
      const hero = birds.heroes[k];
      statue.pivot.getWorldPosition(hero.group.position);
      hero.group.rotation.set(0, statue.yaw, 0);
      hero.previous.copy(hero.group.position);
      hero.group.visible = true;
    });
  };

  /** 두 새 — 둥지 → 원 한 바퀴 반(열쇠 던지기) → 풀린 장막 위로 떠남 */
  const flyHeroes = (now: string, since: number, time: number, dt: number, centerGround: number) => {
    const { position } = scratch;
    const { heroes } = birds;
    if (now === "awakening") {
      heroes.forEach((bird, k) => {
        const statue = birds.statues[k];
        statue.pivot.getWorldPosition(position);
        position.y += Math.abs(Math.sin(time * 9 + k)) * 0.04 * M;
        bird.group.position.copy(position);
        flapWings(bird, dt, 1, 11);
      });
      if (since > SHAKE_SECONDS + PERCH_SECONDS) ridge.advance("circling");
      return;
    }
    if (now !== "circling" && now !== "leaving" && now !== "rift" && now !== "done") return;
    const circlingSince = now === "circling" ? since : 99;
    heroes.forEach((bird, k) => {
      if (!bird.group.visible) return;
      const start = birds.statues[k];
      const angleOffset = k * 0.55;
      const circlePoint = (t: number) => {
        const angle = (t / LAP_SECONDS) * Math.PI * 2 + angleOffset;
        return new THREE.Vector3(
          (RIDGE_CENTER.x + Math.cos(angle) * CIRCLE_RADIUS) * M,
          (centerGround + CIRCLE_HEIGHT + Math.sin(angle * 2) * 0.6) * M,
          (RIDGE_CENTER.z + Math.sin(angle) * CIRCLE_RADIUS) * M,
        );
      };
      if (now === "circling") {
        if (circlingSince < TAKEOFF_SECONDS) {
          const eased = THREE.MathUtils.smootherstep(circlingSince, 0, TAKEOFF_SECONDS);
          const from = new THREE.Vector3(start.x * M, (start.ground + start.size * 1.0) * M, start.z * M);
          bird.group.position.lerpVectors(from, circlePoint(0), eased);
          bird.group.position.y += Math.sin(eased * Math.PI) * 1.5 * M;
        } else bird.group.position.copy(circlePoint(circlingSince - TAKEOFF_SECONDS));
        flapWings(bird, dt, circlingSince < TAKEOFF_SECONDS ? 1 : 0.5 + 0.5 * Math.sin(time * 0.8 + k));
      } else {
        flyAway(birds, bird, dt, k);
      }
      faceMotion(bird, bird.group.position);
    });
    // 열쇠 — 둘째 바퀴에 플레이어 앞으로
    const throwTime = TAKEOFF_SECONDS + THROW_AT * LAP_SECONDS;
    if (now === "circling" && !birds.throwing && circlingSince > throwTime)
      startThrow(birds, camera, heroes[KEY_STATUE].group.position);
    updateThrow(birds, time);
    if (now === "circling" && circlingSince > TAKEOFF_SECONDS + LAPS * LAP_SECONDS && birds.isThrown) {
      birds.exitT = nearestCurtainT(RIDGE_CENTER.x + DEPART.x * 30, RIDGE_CENTER.z + DEPART.z * 30);
      const exit = curtainPoint(birds.exitT, { x: 0, z: 0, nx: 0, nz: 0 });
      birds.exitPoint.set(
        (exit.x + exit.nx * 9) * M,
        (centerGround + CIRCLE_HEIGHT + 3) * M,
        (exit.z + exit.nz * 9) * M,
      );
      ridge.advance("leaving");
    }
  };

  /** 새 떼 — 장막 밖을 맴돌다, 장막이 풀리면 두 오리와 함께 떠난다 */
  const flyFlock = (time: number, dt: number, centerGround: number) => {
    const { position } = scratch;
    const isDeparting = ridge.releaseFrom() !== null && time - birds.brokeAt > 0 && ridge.isAtLeast("leaving");
    birds.flock.forEach((bird, k) => {
      if (!bird.group.visible) return;
      const orbit = bird.orbit;
      if (!isDeparting || time - birds.departAt < 1.2) {
        orbit.angle += orbit.speed * dt;
        const arrive = THREE.MathUtils.smootherstep(time - birds.flockShownAt, 0.3, 4.5);
        const far = 1 + (1 - arrive) * 1.6;
        position.set(
          (RIDGE_CENTER.x + Math.cos(orbit.angle) * orbit.rx * far) * M,
          (centerGround + orbit.height + Math.sin(time * 0.9 + k) * 0.8 + (1 - arrive) * 6) * M,
          (RIDGE_CENTER.z + Math.sin(orbit.angle) * orbit.rz * far) * M,
        );
        bird.group.position.copy(position);
        flapWings(bird, dt, 0.4 + 0.6 * Math.max(0, Math.sin(time * 0.6 + bird.seed * 6)));
      } else flyAway(birds, bird, dt, k + 2);
      faceMotion(bird, bird.group.position);
    });
    if (isDeparting && birds.departAt === Infinity) birds.departAt = time;
  };

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    placeStatues(birds, scene, time);
    if (!birds.statues.length) return;
    const now = stageRef.current;
    const since = ridge.elapsed();

    turnStatues(now, since, time, dt);
    quakeGround(now, since, time);
    awaken(now, since, time);
    updateShards(birds.shell, dt);
    updateChunks(birds.shell, scene, dt);
    // 깨어난 뒤 — 새 떼와 두 새가 지저귄다
    if (birds.isBroken && (now === "awakening" || now === "circling" || now === "leaving") && Math.random() < dt * 3)
      audio.play("짹짹");

    if (birds.isBroken) flyHeroes(now, since, time, dt, centerGround);
    flyFlock(time, dt, centerGround);
    // 새들이 떠나고 나면 진부촌 문이 일그러진다(GateRift)
    if (now === "leaving" && since > 6) ridge.advance("rift");
  });

  return null;
}
