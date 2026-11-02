/**
 * 증언 능선의 돌새 — 씬2 솟대 두 마리가 돌로 굳어 서로 등을 돌리고 있다(엇갈린 증언). 오른쪽 새는 부리에 열쇠를 물었다.
 *   돌새는 받침이 팔각이라 E 한 번에 45° 씩 돈다. 손이 닿아야 돌린다(걸상 허공 계단을 딛고 올라선다).
 *   둘이 마주 보면 딸깍 맞물려 더는 안 돈다 → 두 기둥 사이 화석 자리에 푸른 비늘을 맞춰 넣으면(BirdHints) 깨어난다:
 *   기둥이 점점 떨리고 → 돌 껍질이 알껍데기처럼 깨져 흩날리며 장막이 풀린다 → 장막 밖에 모여 있던 새 떼(15~20)
 *   → 두 새가 하늘을 한 바퀴 반 돌며 열쇠를 플레이어 앞에 떨어뜨린다 → 풀린 장막 위로 새 떼와 함께 멀리 날아간다.
 * 씬2 솟대 0·1 번은 그 자리에서 숨기고 여기서 다시 그린다(회전·깨짐을 보여야 해서). 편집으로 옮기면 따라간다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { TOON_GRADIENT } from "@/engine/toon";

import { addDynamicSolid, solidQueries, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M, groundY } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { prewarmShaders } from "../prewarm";
import { POLE_TOP } from "../../story/scene2";
import { BILL_TIP, buildCarvedDuckAtPoleTop, buildFlyingDuck, buildPole, toStone } from "./birdModels";
import { buildBronzeKey } from "./lockedBox";
import { CURTAIN, KEY_STATUE, RIDGE_CENTER, STATUE_IDS, curtainDistance, curtainPoint, isInsideCurtain, nearestCurtainT } from "./ridgeShape";
import { ridge, ridgeDev, ridgeQuest, useRidgeStage } from "./ridgeState";

const STEP = Math.PI / 4;
/** 돌새에 손이 닿는 거리(눈에서 새까지, m) — 땅에서는 모자라고 허공 계단 꼭대기에서야 닿는다 */
const TOUCH_REACH = 1.3;
/** 비늘을 맞춘 뒤 기둥이 떨리다 껍질이 깨지기까지(초) */
const SHAKE_SECONDS = 3.2;
/** 깨어난 오리 크기(몸길이 m 쯤) */
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
/** 이 지점(바퀴 비율)에서 열쇠를 떨어뜨린다 */
const THROW_AT = 1.15;
const THROW_SECONDS = 1.3;
/** 떠나는 쪽 — 진부촌 너머 북동 하늘 */
const DEPART = new THREE.Vector3(1, 0, -0.75).normalize();
/** 돌가루 — 껍질 조각 사이로 흩날리는 잔돌 */
const SHARDS = 26;
/** 껍질 조각을 나누는 칸(돌새 모형 표본 단위) · 조각이 날다 사라지기까지(초) */
const CHUNK_CELL = 0.07;
const CHUNK_LIFE = 5.5;

const toonVertex = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT });

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

interface Bird {
  group: THREE.Group;
  /** 어깨 둘 · 팔꿈치 둘(바깥 마디) */
  wings: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  phase: number;
  /** 날기 시작한 시각 등 새마다 다른 값 */
  seed: number;
  previous: THREE.Vector3;
  /** 무리 — 장막 둘레를 도는 타원 */
  orbit: { rx: number; rz: number; height: number; speed: number; angle: number };
}

function buildBird(look: ReturnType<typeof buildFlyingDuck>, material: THREE.Material, size: number, seed: number): Bird {
  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(look.body, material);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);
  const elbows: THREE.Group[] = [];
  const wings = [-1, 1].map((side) => {
    // 왼쪽은 거울로 — 겉면 방향이 뒤집히니 양면 재질(birdMaterial)로 그린다
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.11, 0.07, 0.06);
    shoulder.scale.x = side;
    const inner = new THREE.Mesh(look.inner, material);
    shoulder.add(inner);
    const elbow = new THREE.Group();
    elbow.position.x = look.elbow;
    elbow.add(new THREE.Mesh(look.outer, material));
    shoulder.add(elbow);
    group.add(shoulder);
    elbows.push(elbow);
    return shoulder;
  }) as [THREE.Group, THREE.Group];
  group.scale.setScalar(size * M);
  group.visible = false;
  return {
    group,
    wings,
    elbows: elbows as [THREE.Group, THREE.Group],
    phase: seed * 10,
    seed,
    previous: new THREE.Vector3(),
    orbit: { rx: 0, rz: 0, height: 0, speed: 0, angle: 0 },
  };
}

/**
 * 날갯짓 — flap 1 이면 힘차게, 0 이면 활공. 어깨가 먼저 치고 바깥 마디가 조금 늦게 따라 휜다(내려칠 때 펴지고
 * 올릴 때 접힌다). 날개 끝이 살짝 앞뒤로 비틀린다. 왼날개는 거울(scale.x −1)
 */
function flapWings(bird: Bird, dt: number, flap: number, rate = 7) {
  bird.phase += dt * rate * (0.6 + 0.4 * flap);
  const amount = 0.2 + 0.8 * flap;
  const angle = Math.sin(bird.phase) * amount * 0.85 + 0.12;
  const lag = Math.sin(bird.phase - 0.9) * amount * 0.55 - 0.08 * amount;
  const twist = Math.cos(bird.phase) * 0.18 * amount;
  for (let k = 0; k < 2; k++) {
    // 어깨의 돌림은 거울 바깥에서 걸리니 왼쪽(k 0)은 반대로
    bird.wings[k].rotation.set(twist, 0, k === 0 ? -angle : angle);
    bird.elbows[k].rotation.set(0, Math.max(0, -Math.sin(bird.phase)) * 0.35 * amount, lag);
  }
  // 날갯짓에 맞춰 몸이 살짝 오르내린다
  bird.group.children[0].position.y = -Math.sin(bird.phase) * 0.02 * amount;
}

/** 지난 자리에서 지금 자리로 머리를 돌린다 */
function faceMotion(bird: Bird, position: THREE.Vector3) {
  const motion = position.clone().sub(bird.previous);
  if (motion.lengthSq() > 1e-6) bird.group.lookAt(bird.group.position.clone().add(motion));
  bird.previous.copy(position);
}

/**
 * 껍질 조각 — 돌새 모형의 삼각형을 칸(cell)마다 모아 조각 여럿으로 나눈다. 조각마다 제 가운데가 원점(center 에 적어 둠).
 * 깨질 때 이 조각들이 제자리에서 바깥으로 터져 나가 알껍데기처럼 벗겨진다
 */
function splitIntoChunks(geometry: THREE.BufferGeometry, cell: number) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.attributes.position as THREE.BufferAttribute;
  const color = source.attributes.color as THREE.BufferAttribute | undefined;
  const groups = new Map<string, number[]>();
  for (let t = 0; t < position.count; t += 3) {
    const cx = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
    const cy = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3;
    const cz = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
    const key = `${Math.floor(cx / cell)},${Math.floor(cy / cell)},${Math.floor(cz / cell)}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.values()].map((triangles) => {
    const center = new THREE.Vector3();
    for (const t of triangles) for (let k = 0; k < 3; k++) center.add(new THREE.Vector3().fromBufferAttribute(position, t + k));
    center.divideScalar(triangles.length * 3);
    const positions = new Float32Array(triangles.length * 9);
    const colors = new Float32Array(triangles.length * 9);
    triangles.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        positions[i * 9 + k * 3] = position.getX(t + k) - center.x;
        positions[i * 9 + k * 3 + 1] = position.getY(t + k) - center.y;
        positions[i * 9 + k * 3 + 2] = position.getZ(t + k) - center.z;
        if (color) {
          colors[i * 9 + k * 3] = color.getX(t + k);
          colors[i * 9 + k * 3 + 1] = color.getY(t + k);
          colors[i * 9 + k * 3 + 2] = color.getZ(t + k);
        }
      }
    });
    const piece = new THREE.BufferGeometry();
    piece.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    piece.computeVertexNormals();
    return { geometry: piece, center };
  });
}

function createRig() {
  const duck = buildCarvedDuckAtPoleTop();
  const stoneDuck = toStone(duck);
  const poleGeometry = buildPole();
  const stoneMaterial = toonVertex();
  // 돌새 껍질만 따로 — 깨지기 전 금 사이로 흰빛이 새어 나온다(장대는 그대로)
  const shellMaterial = toonVertex();
  shellMaterial.emissive = new THREE.Color("#FFF6EA");
  shellMaterial.emissiveIntensity = 0;
  // 조각은 속이 빈 껍질이라 안쪽 면도 그린다
  shellMaterial.side = THREE.DoubleSide;
  const chunks = splitIntoChunks(stoneDuck, CHUNK_CELL);
  const keyGeometry = buildBronzeKey();
  const keyStone = new THREE.MeshToonMaterial({ color: "#B4BAC1", gradientMap: TOON_GRADIENT });
  const keyBronze = new THREE.MeshToonMaterial({ vertexColors: true, emissive: new THREE.Color("#3A2A10"), gradientMap: TOON_GRADIENT });
  const drake = buildFlyingDuck(true);
  const hen = buildFlyingDuck(false);
  const birdMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
  const heroes = [
    buildBird(drake, birdMaterial, DUCK_SIZE, 0.11),
    buildBird(hen, birdMaterial, DUCK_SIZE, 0.53),
  ];
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
  // 깨진 돌 껍질
  // 깨진 돌 껍질 — 알껍데기처럼 휜 조각(구의 한 귀퉁이). 안쪽도 보이게 양면
  const shardGeometry = new THREE.SphereGeometry(1, 5, 3, 0, 1.0, 0.6, 0.8);
  shardGeometry.translate(0, -Math.cos(1.0), 0);
  const shards = new THREE.InstancedMesh(
    shardGeometry,
    new THREE.MeshToonMaterial({ color: "#B4BAC1", gradientMap: TOON_GRADIENT, side: THREE.DoubleSide }),
    SHARDS * 2,
  );
  shards.count = 0;
  shards.frustumCulled = false;
  const shardState = Array.from({ length: SHARDS * 2 }, () => ({
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    size: 0,
  }));
  // 깨어난 새가 부리에 문 열쇠 — 던질 때 떨어진다(새 표본 단위)
  const heldKey = new THREE.Mesh(keyGeometry, keyBronze);
  heldKey.position.set(0, 0.08, 0.72);
  heldKey.rotation.set(0, 0, 0);
  heldKey.scale.setScalar(1.6 / DUCK_SIZE);
  heroes[KEY_STATUE].group.add(heldKey);
  // 떨어지는 열쇠(던지는 동안만)
  const flyingKey = new THREE.Mesh(keyGeometry, keyBronze);
  flyingKey.scale.setScalar(M * 1.6);
  flyingKey.visible = false;
  return {
    duck: stoneDuck,
    poleGeometry,
    stoneMaterial,
    shellMaterial,
    chunks,
    /** 터져 나간 껍질 조각 */
    flying: [] as { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; age: number }[],
    keyGeometry,
    keyStone,
    keyBronze,
    heroes,
    flock,
    shards,
    shardState,
    flyingKey,
    heldKey,
    statues: [] as Statue[],
    /** 그려진 솟대 무리 — 모양마다 따로 된 메시라 여럿이다. 한 번 찾으면 들고 있는다 */
    sources: [] as THREE.InstancedMesh[],
    searchedAt: -99,
    /** 장막을 뚫은 시각(초) */
    curtainBrokeAt: Infinity,
    /** 열쇠 던지기 */
    throw: null as null | { from: THREE.Vector3; to: THREE.Vector3; startedAt: number },
    thrown: false,
    exitT: 0,
    exitPoint: new THREE.Vector3(),
    broke: false,
    brokeAt: 0,
    toldStatues: false,
    toldRotate: false,
    lastRumble: 0,
    flockShown: false,
    flockAt: 0,
  };
}

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const snap = (a: number) => Math.round(a / STEP) * STEP;
const towards = (from: Statue, to: Statue) => Math.atan2(to.x - from.x, to.z - from.z);
/** 둘이 서로 마주 보나 — 팔각 칸으로 */
const facesEachOther = (statues: Statue[]) =>
  statues.length === 2 && statues.every((s, k) => Math.abs(wrap(s.targetYaw - snap(towards(s, statues[1 - k])))) < STEP / 2);

export default function RidgeBirds() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => createRig(), []);
  const stage = useRidgeStage();
  const stageRef = useRef(stage);
  const departAt = useRef(Infinity);
  const shardAge = useRef(0);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    const objects = [rig.shards, rig.flyingKey, ...rig.heroes.map((b) => b.group), ...rig.flock.map((b) => b.group)];
    scene.add(...objects);
    // 새 · 껍질 조각은 깨어날 때 처음 보인다 — 셰이더를 미리 굽는다(껍질 조각 재질은 돌새와 같다)
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, objects), 3200);
    return () => {
      window.clearTimeout(warm);
      scene.remove(...objects);
      for (const s of rig.statues) scene.remove(s.group);
    };
  }, [scene, rig, gl, camera]);

  // 깨어남·떠남 소리와 안내
  useEffect(() => {
    // 깨어남 — 떨림 · 깨짐 안내는 프레임에서(비늘을 맞춘 안내는 BirdHints)
    if (stage === "awakening") audio.play("우르릉");
    if (stage === "circling") showNotice("장막 밖에서 새 떼가 맴돌며 두 새를 기다린다.", 4);
  }, [stage]);

  // 돌새를 그린다 — 솟대 0·1 번을 찾아 숨기고 그 자리에 다시 세운다
  const placeStatues = (time: number) => {
    if ((!rig.sources.length || rig.sources.some((m) => !m.parent)) && time - rig.searchedAt > 1) {
      rig.searchedAt = time;
      rig.sources = [];
      scene.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh && o.name === "씬2.솟대" && !o.userData.publicAsset)
          rig.sources.push(o as THREE.InstancedMesh);
      });
    }
    const found: { id: number; x: number; z: number; y: number; yaw: number; size: number }[] = [];
    let changed = false;
    for (const mesh of rig.sources) {
      const ids = mesh.userData.ids as Int32Array | undefined;
      if (!ids || mesh.userData.ridgeHiddenFor === ids) continue;
      mesh.userData.ridgeHiddenFor = ids;
      changed = true;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < ids.length; i++) {
        if (!(STATUE_IDS as readonly number[]).includes(ids[i])) continue;
        mesh.getMatrixAt(i, matrix);
        matrix.premultiply(mesh.matrixWorld).decompose(position, quaternion, scale);
        euler.setFromQuaternion(quaternion, "YXZ");
        found.push({ id: ids[i], x: position.x / M, z: position.z / M, y: position.y / M, yaw: euler.y, size: scale.y / M });
        mesh.setMatrixAt(i, ZERO);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (!changed || found.length < STATUE_IDS.length) return;
    found.sort((a, b) => a.id - b.id);
    if (rig.statues.length) return; // 이미 세웠다 — 숨기기만 다시
    found.forEach((spot, k) => {
      const group = new THREE.Group();
      group.position.set(spot.x * M, spot.y * M, spot.z * M);
      group.scale.setScalar(spot.size * M);
      group.add(new THREE.Mesh(rig.poleGeometry, rig.stoneMaterial));
      const pivot = new THREE.Group();
      pivot.position.y = POLE_TOP;
      pivot.rotation.y = spot.yaw;
      group.add(pivot);
      const stone = new THREE.Mesh(rig.duck, rig.shellMaterial);
      pivot.add(stone);
      let key: THREE.Mesh | null = null;
      if (k === KEY_STATUE) {
        key = new THREE.Mesh(rig.keyGeometry, rig.keyStone);
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
      rig.statues.push({
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
    rig.statues.forEach((s, k) => {
      const other = rig.statues[1 - k];
      s.targetYaw = snap(towards(s, other) + Math.PI);
      s.yaw = s.targetYaw;
    });
  };

  // 돌리기 — E 한 번에 45°
  useEffect(() => {
    const removers: (() => void)[] = [];
    const register = () => {
      rig.statues.forEach((statue, k) => {
        removers.push(
          registerInteractable({
            id: `ridge-statue-${k}`,
            position: statue.touch,
            label: "돌새 돌리기",
            radius: 0.6 * M,
            reach: 5 * M,
            enabled: () => stageRef.current === "sealed" && !ridgeQuest.birdsFacing,
            use: () => {
              const eye = camera.position;
              // 돌새는 무겁다 — 허공(장막 안 높은 점프)에서는 힘이 안 들어간다. 딛고 서야 돌린다
              const foot = eye.y / M - 1.6;
              // 발 둘레 다섯 점 — 걷기 판정과 같이 가장자리를 딛고 서도 선 것으로 본다
              let support = -Infinity;
              for (const [dx, dz] of [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) {
                const x = eye.x / M + dx;
                const z = eye.z / M + dz;
                support = Math.max(support, groundY(x, z), solidQueries.current?.supportAt(x, z, foot + 0.08) ?? -Infinity);
              }
              if (foot - support > 0.12) {
                showNotice("허공에서는 돌새를 돌릴 힘이 들어가지 않는다. 단단히 딛고 서서 돌리자.", 3);
                return;
              }
              const distance = eye.distanceTo(statue.touch) / M;
              if (distance > TOUCH_REACH) {
                const low = eye.y / M < statue.touch.y / M - 0.8;
                showNotice(low ? "손이 닿지 않는다. 무언가를 딛고 올라서야 한다." : "조금 더 가까이 가야 손이 닿는다.", 3);
                return;
              }
              // 팔각 받침 — 늘 45° 칸에 맞춰 돈다
              statue.targetYaw = (Math.round(statue.targetYaw / STEP) + 1) * STEP;
              audio.play("똑");
              if (!rig.toldRotate) {
                rig.toldRotate = true;
                showNotice("돌새가 드르륵 돌아간다. 받침이 팔각으로 깎여 여덟 방향으로만 선다.", 4);
              }
            },
          }),
        );
      });
    };
    // 돌새가 세워진 뒤에 등록한다
    const timer = setInterval(() => {
      if (!rig.statues.length || removers.length) return;
      register();
    }, 500);
    ridgeDev.solve = () => {
      rig.statues.forEach((s, k) => (s.targetYaw = snap(towards(s, rig.statues[1 - k]))));
      for (const key of ["chestOnAltar", "postsSolved", "stairs", "birdsFacing", "scaleSet"] as const) ridgeQuest.set(key);
      ridge.advance("awakening");
    };
    return () => {
      clearInterval(timer);
      removers.forEach((remove) => remove());
      ridgeDev.solve = null;
    };
  }, [rig, camera]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    placeStatues(time);
    if (!rig.statues.length) return;
    const now = stageRef.current;
    const since = ridge.elapsed();
    const px = camera.position.x / M;
    const pz = camera.position.z / M;

    // ① 돌새 — 천천히 돈다. 비늘을 맞추면 기둥째 점점 세게 떤다
    const shaking = now === "awakening" && !rig.broke ? THREE.MathUtils.smoothstep(since, 0, SHAKE_SECONDS) : 0;
    for (const s of rig.statues) {
      s.yaw += wrap(s.targetYaw - s.yaw) * (1 - Math.exp(-dt * 6));
      s.pivot.rotation.y = s.yaw;
      s.touch.set(s.x * M, (s.ground + s.size * 1.0) * M, s.z * M);
      s.group.position.set(
        (s.x + Math.sin(time * 41 + s.x) * 0.02 * shaking) * M,
        s.ground * M,
        (s.z + Math.cos(time * 37 + s.z) * 0.02 * shaking) * M,
      );
      s.group.rotation.set(Math.sin(time * 29) * 0.012 * shaking, 0, Math.cos(time * 31) * 0.012 * shaking);
    }
    if (now === "sealed" && !rig.toldStatues && Math.hypot(px - rig.statues[0].x, pz - rig.statues[0].z) < 5) {
      rig.toldStatues = true;
      showNotice("돌로 굳은 새 두 마리가 서로 등을 돌리고 있다. 오른쪽 새는 부리에 무언가를 물었다. 너무 높아 손이 닿지 않는다.", 5);
    }
    if (now === "sealed" && !ridgeQuest.birdsFacing && facesEachOther(rig.statues) && rig.statues.every((s) => Math.abs(wrap(s.targetYaw - s.yaw)) < 0.02)) {
      ridgeQuest.set("birdsFacing");
      audio.play("징");
      showNotice("두 돌새가 마침내 서로 마주 본다 — 받침이 딸깍 맞물린다. 두 기둥 사이 땅의 돌판이 희미하게 빛난다.", 5);
    }
    // 떨리는 동안 껍질 금 사이로 흰빛이 새어 나온다 — 깨지기 직전 가장 밝게, 깜박이며
    rig.shellMaterial.emissiveIntensity = shaking * shaking * (0.35 + 0.25 * Math.sin(time * 23));
    if (now === "awakening" && !rig.broke && since > SHAKE_SECONDS * 0.5 && time - rig.lastRumble > 0.7) {
      rig.lastRumble = time;
      director.cue({ 카메라: "흔들림", 세기: 0.12 + shaking * 0.25 });
    }

    // ② 깨어남 — 떨림 끝에 돌 껍질이 알껍데기처럼 깨지며 장막이 풀린다. 둥지 위에 진짜 새
    const heroes = rig.heroes;
    // 새 떼는 비늘을 맞추는 순간부터 장막 밖에 모여든다(풀리기 전에 보이게)
    if (ridge.isAtLeast("awakening") && !rig.flockShown) {
      rig.flockShown = true;
      rig.flockAt = time;
      for (const bird of rig.flock) bird.group.visible = true;
    }
    if (ridge.isAtLeast("awakening") && !rig.broke && (now !== "awakening" || since > SHAKE_SECONDS)) {
      rig.broke = true;
      rig.brokeAt = time;
      audio.play("우르릉");
      audio.play("전환");
      director.cue({ 카메라: "흔들림", 세기: 0.4 });
      showNotice("돌 껍질이 알껍데기처럼 깨져 흩날린다 — 바람 장막이 한꺼번에 풀린다!", 5);
      const mid = { x: (rig.statues[0].x + rig.statues[1].x) / 2, z: (rig.statues[0].z + rig.statues[1].z) / 2 };
      ridge.breakCurtainAt(nearestCurtainT(mid.x, mid.z));
      rig.curtainBrokeAt = performance.now() / 1000;
      rig.statues.forEach((s, k) => {
        s.stone.visible = false;
        if (s.key) s.key.visible = false;
        crack(s, k);
        s.pivot.updateMatrixWorld(true);
        s.pivot.getWorldPosition(heroes[k].group.position);
        heroes[k].group.rotation.set(0, s.yaw, 0);
        heroes[k].previous.copy(heroes[k].group.position);
        heroes[k].group.visible = true;
      });
    }
    stepShards(dt);
    stepChunks(dt);
    // 깨어난 뒤 — 새 떼와 두 새가 지저귄다
    if (rig.broke && (now === "awakening" || now === "circling" || now === "leaving") && Math.random() < dt * 3) audio.play("짹짹");

    const centerGround = groundY(RIDGE_CENTER.x, RIDGE_CENTER.z);
    const keyBird = heroes[KEY_STATUE];

    // ③ 두 새 — 둥지 → 원 한 바퀴 반(열쇠 던지기) → 풀린 장막 위로 떠남
    if (!rig.broke) {
      // 깨지기 전 — 새 떼만 모여든다(아래 ④)
    } else if (now === "awakening") {
      heroes.forEach((bird, k) => {
        const s = rig.statues[k];
        s.pivot.getWorldPosition(position);
        position.y += Math.abs(Math.sin(time * 9 + k)) * 0.04 * M;
        bird.group.position.copy(position);
        flapWings(bird, dt, 1, 11);
      });
      if (since > SHAKE_SECONDS + PERCH_SECONDS) ridge.advance("circling");
    } else if (now === "circling" || now === "leaving" || now === "rift" || now === "done") {
      const circlingSince = now === "circling" ? since : 99;
      heroes.forEach((bird, k) => {
        if (!bird.group.visible) return;
        const start = rig.statues[k];
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
            const e = THREE.MathUtils.smootherstep(circlingSince, 0, TAKEOFF_SECONDS);
            const from = new THREE.Vector3(start.x * M, (start.ground + start.size * 1.0) * M, start.z * M);
            const to = circlePoint(0);
            bird.group.position.lerpVectors(from, to, e);
            bird.group.position.y += Math.sin(e * Math.PI) * 1.5 * M;
          } else bird.group.position.copy(circlePoint(circlingSince - TAKEOFF_SECONDS));
          flapWings(bird, dt, circlingSince < TAKEOFF_SECONDS ? 1 : 0.5 + 0.5 * Math.sin(time * 0.8 + k));
        } else {
          flyAway(bird, dt, k);
        }
        faceMotion(bird, bird.group.position);
      });
      // 열쇠 — 둘째 바퀴에 플레이어 앞으로
      const throwTime = TAKEOFF_SECONDS + THROW_AT * LAP_SECONDS;
      if (now === "circling" && !rig.throw && circlingSince > throwTime) startThrow(keyBird.group.position);
      stepThrow(time);
      if (now === "circling" && circlingSince > TAKEOFF_SECONDS + LAPS * LAP_SECONDS && rig.thrown) {
        rig.exitT = nearestCurtainT(RIDGE_CENTER.x + DEPART.x * 30, RIDGE_CENTER.z + DEPART.z * 30);
        const p = curtainPoint(rig.exitT, { x: 0, z: 0, nx: 0, nz: 0 });
        rig.exitPoint.set((p.x + p.nx * 9) * M, (centerGround + CIRCLE_HEIGHT + 3) * M, (p.z + p.nz * 9) * M);
        ridge.advance("leaving");
      }
    }

    // ④ 새 떼 — 장막 밖을 맴돌다, 장막이 풀리면 두 오리와 함께 떠난다
    const departing = ridge.releaseFrom() !== null && time - rig.brokeAt > 0 && ridge.isAtLeast("leaving");
    rig.flock.forEach((bird, k) => {
      if (!bird.group.visible) return;
      const o = bird.orbit;
      if (!departing || time - departAt.current < 1.2) {
        o.angle += o.speed * dt;
        const arrive = THREE.MathUtils.smootherstep(time - rig.flockAt, 0.3, 4.5);
        const far = 1 + (1 - arrive) * 1.6;
        position.set(
          (RIDGE_CENTER.x + Math.cos(o.angle) * o.rx * far) * M,
          (centerGround + o.height + Math.sin(time * 0.9 + k) * 0.8 + (1 - arrive) * 6) * M,
          (RIDGE_CENTER.z + Math.sin(o.angle) * o.rz * far) * M,
        );
        bird.group.position.copy(position);
        flapWings(bird, dt, 0.4 + 0.6 * Math.max(0, Math.sin(time * 0.6 + bird.seed * 6)));
      } else flyAway(bird, dt, k + 2);
      faceMotion(bird, bird.group.position);
    });
    if (departing && departAt.current === Infinity) departAt.current = time;
    // 새들이 떠나고 나면 진부촌 문이 일그러진다(GateRift)
    if (now === "leaving" && since > 6) ridge.advance("rift");
  });

  /** 장막을 향해 나가고, 뚫으면 장막을 풀고, 새 떼와 함께 북동 하늘로 */
  function flyAway(bird: Bird, dt: number, k: number) {
    const p = bird.group.position;
    const xm = p.x / M;
    const zm = p.z / M;
    const isHero = rig.heroes.includes(bird);
    let target: THREE.Vector3;
    if (isHero && ridge.releaseFrom() === null) target = rig.exitPoint;
    else
      target = new THREE.Vector3(
        (RIDGE_CENTER.x + DEPART.x * 140 + (k % 5) * 6) * M,
        (groundY(RIDGE_CENTER.x, RIDGE_CENTER.z) + 30 + (k % 4) * 3) * M,
        (RIDGE_CENTER.z + DEPART.z * 140 + Math.floor(k / 5) * 6) * M,
      );
    const step = target.clone().sub(p);
    const speed = (isHero ? 7 : 8.5) * M * dt;
    if (step.length() > speed) step.setLength(speed);
    p.add(step);
    flapWings(bird, dt, 0.8);
    // 장막을 뚫는 순간 — 그 자리부터 풀린다
    if (isHero && ridge.releaseFrom() === null && curtainDistance(xm, zm) > 0) {
      ridge.breakCurtainAt(rig.exitT);
      rig.curtainBrokeAt = performance.now() / 1000;
      audio.play("전환");
    }
    // 멀리 가면 끈다
    if (Math.hypot(xm - RIDGE_CENTER.x, zm - RIDGE_CENTER.z) > 120) bird.group.visible = false;
  }

  function crack(s: Statue, k: number) {
    s.pivot.updateMatrixWorld(true);
    const center = s.pivot.getWorldPosition(new THREE.Vector3());
    // 껍질 — 돌새 모형 그대로의 조각들이 제자리에서 바깥으로 터져 나간다
    const body = new THREE.Vector3(0, 0.07, 0).applyMatrix4(s.stone.matrixWorld);
    for (const chunk of rig.chunks) {
      const mesh = new THREE.Mesh(chunk.geometry, rig.shellMaterial);
      const at = chunk.center.clone().applyMatrix4(s.stone.matrixWorld);
      mesh.position.copy(at);
      s.stone.getWorldQuaternion(mesh.quaternion);
      s.stone.getWorldScale(mesh.scale);
      mesh.castShadow = true;
      scene.add(mesh);
      const out = at.clone().sub(body);
      if (out.lengthSq() < 1e-6) out.set(Math.random() - 0.5, 1, Math.random() - 0.5);
      const v = out.normalize().multiplyScalar((1.2 + Math.random() * 2.2) * M);
      v.y += (0.8 + Math.random() * 1.6) * M;
      rig.flying.push({ mesh, v, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8), age: 0 });
    }
    for (let i = 0; i < 3; i++) window.setTimeout(() => audio.play("짹짹"), 200 + i * 260 + k * 120);
    // 껍질 겉면에서 — 몸 · 펼친 날개 둘레에 고루 퍼져 있다가 바깥으로 터져 나간다
    const size = s.size;
    for (let i = 0; i < SHARDS; i++) {
      const shard = rig.shardState[k * SHARDS + i];
      const a = Math.random() * Math.PI * 2;
      const spread = (i % 3 === 0 ? 0.35 : 0.15) * size;
      const offset = new THREE.Vector3(Math.cos(a) * spread, (0.04 + Math.random() * 0.12) * size, Math.sin(a) * spread * 0.6);
      shard.p.copy(center).addScaledVector(offset, M);
      shard.v.copy(offset).normalize().multiplyScalar((1.5 + Math.random() * 2.5) * M);
      shard.v.y += (1 + Math.random() * 2) * M;
      shard.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      shard.size = (0.04 + Math.random() * 0.07) * M;
    }
    rig.shards.count = rig.shardState.length;
  }

  /** 껍질 조각 — 바람에 실려 날리다 떨어지고, 땅에서 구르다 작아져 사라진다 */
  function stepChunks(dt: number) {
    if (!rig.flying.length) return;
    for (const piece of rig.flying) {
      piece.age += dt;
      piece.v.y -= (piece.age < 1.5 ? 3 : 8) * M * dt;
      piece.v.x += Math.sin(piece.age * 2 + piece.spin.x) * 1.2 * M * dt;
      piece.v.z += Math.cos(piece.age * 1.6 + piece.spin.y) * 1.2 * M * dt;
      piece.mesh.position.addScaledVector(piece.v, dt);
      const floor = groundY(piece.mesh.position.x / M, piece.mesh.position.z / M) * M;
      if (piece.mesh.position.y < floor) {
        piece.mesh.position.y = floor;
        piece.v.multiplyScalar(0.35);
        piece.v.y = Math.abs(piece.v.y) * 0.25;
        piece.spin.multiplyScalar(0.6);
      }
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      const fade = THREE.MathUtils.clamp(1 - (piece.age - (CHUNK_LIFE - 1.5)) / 1.5, 0, 1);
      if (fade < 1) piece.mesh.scale.multiplyScalar(Math.max(0.0001, 1 - dt * 2.5));
      if (fade <= 0) scene.remove(piece.mesh);
    }
    rig.flying = rig.flying.filter((piece) => piece.age < CHUNK_LIFE);
    // 다 흩어지면 빛도 거둔다
    if (!rig.flying.length) rig.shellMaterial.emissiveIntensity = 0;
  }

  function stepShards(dt: number) {
    if (!rig.shards.count) return;
    shardAge.current += dt;
    const fade = THREE.MathUtils.clamp(1 - (shardAge.current - 5) / 2, 0, 1);
    rig.shardState.forEach((shard, i) => {
      if (shard.size === 0) {
        rig.shards.setMatrixAt(i, ZERO);
        return;
      }
      // 풀려 나가는 바람에 실려 한동안 날리다 떨어진다
      shard.v.y -= (shardAge.current < 2 ? 2.5 : 7) * M * dt;
      shard.v.x += Math.sin(shardAge.current * 2 + i) * 1.2 * M * dt;
      shard.v.z += Math.cos(shardAge.current * 1.7 + i) * 1.2 * M * dt;
      shard.p.addScaledVector(shard.v, dt);
      const floor = groundY(shard.p.x / M, shard.p.z / M) * M + shard.size * 0.5;
      if (shard.p.y < floor) {
        shard.p.y = floor;
        shard.v.multiplyScalar(0.3);
        shard.v.y = Math.abs(shard.v.y) * 0.2;
      }
      euler.set(shard.spin.x * shardAge.current, shard.spin.y * shardAge.current, shard.spin.z * shardAge.current);
      quaternion.setFromEuler(euler);
      matrix.compose(shard.p, quaternion, scale.setScalar(shard.size * fade));
      rig.shards.setMatrixAt(i, matrix);
    });
    rig.shards.instanceMatrix.needsUpdate = true;
    if (fade <= 0) rig.shards.count = 0;
  }

  /** 열쇠를 문 새에서 플레이어 발 앞으로 — 어디에 서 있든 앞 1.3 m(막혀 있으면 발밑) */
  function startThrow(from: THREE.Vector3) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const footY = camera.position.y / M - 1.6;
    const spot = (x: number, z: number) => {
      const support = solidQueries.current?.supportAt(x, z, footY + 0.3) ?? -Infinity;
      return Math.max(groundY(x, z), support);
    };
    let x = camera.position.x / M + forward.x * 1.3;
    let z = camera.position.z / M + forward.z * 1.3;
    if (!isInsideCurtain(x, z, 0.5) || solidQueries.current?.blockedAt(x, z, groundY(x, z), 0.1)) {
      x = camera.position.x / M;
      z = camera.position.z / M;
    }
    rig.heldKey.visible = false;
    rig.throw = { from: from.clone(), to: new THREE.Vector3(x * M, spot(x, z) * M, z * M), startedAt: performance.now() / 1000 };
    rig.flyingKey.visible = true;
    showNotice("열쇠를 문 새가 고개를 숙인다 — 무언가 떨어진다!", 3);
  }

  function stepThrow(time: number) {
    const t = rig.throw;
    if (!t || rig.thrown) return;
    const u = Math.min(1, (performance.now() / 1000 - t.startedAt) / THROW_SECONDS);
    const peak = Math.max(t.from.y, t.to.y) + 1.2 * M;
    const y = (1 - u) * (1 - u) * t.from.y + 2 * (1 - u) * u * peak + u * u * t.to.y;
    rig.flyingKey.position.set(THREE.MathUtils.lerp(t.from.x, t.to.x, u), y, THREE.MathUtils.lerp(t.from.z, t.to.z, u));
    rig.flyingKey.rotation.set(time * 9, time * 5, 0);
    if (u >= 1) {
      rig.thrown = true;
      rig.flyingKey.visible = false;
      inventory.spawn("bronzeKey", t.to);
      audio.play("단서");
      showNotice("새가 열쇠를 발 앞에 떨어뜨렸다. 대가 긴 청동 열쇠 — 아랑사의 함 자물통에 맞을 것 같다. [E] 로 줍자.", 5);
    }
  }

  return null;
}
