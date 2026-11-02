/**
 * 배 옆 모래에서 조개 캐기 — 통발 미끼.
 *   모래 속에서 빛이 샌다 → 배 옆 호미를 들고 → 그 자리를 판다(호미는 구덩이 옆에 내려놓는다) → 빛나는 조개를 줍는다
 * 맨손으로는 못 판다. 통발은 조개를 든 뒤에야 물에 넣을 수 있다(FishTrapPuzzle).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { clamDig, useClamStage } from "./clamState";
import { M, groundY, makeGlowPoints, pointScaleFor } from "./shared";

/** 뭍에 올린 나룻배 몸통 바로 옆 맨모래 — 미터. 동쪽은 씬4 「배 자국」 판이 깔려 있어 피한다 */
const DIG_SPOT = { x: 17.0, z: 42.55 };
const HOE_SPOT = { x: 16.55, z: 41.95, rotation: 0.9 };
const DIG_SECONDS = 3.6;
const HOE_SCALE = 1.3;
/** 조개도 실물(4~5 cm)보다 키운다 — 구덩이 속에서 껍데기 모양이 보이게 */
const CLAM_SCALE = 1.7;
/** 호미질 세 번 — 진행도 중 날이 모래에 박히는 때 */
const STRIKES = [0.24, 0.52, 0.8];
/** 호미질마다 구덩이가 넓어지는 크기(다 파면 1) */
const HOLE_GROWTH = [0.45, 0.75, 0.95];
/**
 * 호미질 자세 — [진행도, 날 끝 높이(m), 몸 쪽으로 물러난 거리(m), 숙인 각(+면 날이 아래)].
 * 들어 올리고 → 치켜들고 → 찍고 → 몸 쪽으로 긁는다. 두 번.
 */
const DIG_KEYS: [number, number, number, number][] = [
  [0.08, 0.3, 0.18, -0.35],
  [0.18, 0.38, 0.22, -0.55],
  [0.24, -0.03, 0, 0.95],
  [0.33, -0.02, 0.12, 0.6],
  [0.42, 0.3, 0.2, -0.35],
  [0.48, 0.38, 0.22, -0.55],
  [0.52, -0.04, 0.02, 0.95],
  [0.61, -0.02, 0.16, 0.6],
  [0.7, 0.3, 0.2, -0.35],
  [0.76, 0.38, 0.22, -0.55],
  [0.8, -0.05, 0.04, 0.95],
  [0.9, -0.02, 0.2, 0.6],
  [1, 0.02, 0.22, 0.35],
];
/** 호미 날 끝 — 모형 자기 좌표(미터). 날은 +z, 자루는 −z */
const HOE_TIP = new THREE.Vector3(0, 0.03, 0.15);
/** 다 판 호미를 내려놓는 데 걸리는 시간 */
const SETTLE_SECONDS = 0.35;
/** 구덩이에서 조개를 집어 올려 손으로 가져오기 */
const PICK_SECONDS = 0.6;
/** 손에서 통발 입구로 넣기 */
const BAIT_SECONDS = 1.1;
const CLAM_LIGHT = new THREE.Color("#D6E6FF");
/** 반짝이는 자리 — 둥글게 늘어서지 않게 흩어 둔 고정 좌표(미터) */
const GLINTS: [number, number][] = [
  [0.05, -0.02],
  [-0.04, 0.03],
  [0.01, 0.05],
  [0.12, 0.07],
  [-0.1, -0.06],
  [0.03, -0.13],
  [-0.15, 0.1],
];
const SAND = new THREE.Color("#8E8574");

const toon = (color: THREE.ColorRepresentation) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT });

/** 호미 — 국가유산청 실물 모형(31.5 cm, CC BY 4.0). 모래 위에 눕혀 두고, 들면 손에 쥔 자세로 세운다 */
const HOE_MODEL = `${import.meta.env.BASE_URL}_sf_local/lib/ast-prop-weeding-hoe-homi-01.glb`;

function buildHoe() {
  const group = new THREE.Group();
  const pivot = new THREE.Group(); // 눕힌 자세 — 날이 모래에 닿는다
  group.add(pivot);
  // 라이브러리 경량본은 meshopt·KTX2 압축 — 기본 로더로는 조용히 실패한다
  createCompressedGltfLoader().load(
    HOE_MODEL,
    (gltf) => {
      const model = gltf.scene;
      model.rotation.x = -Math.PI / 2;
      model.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      // 밑면이 바닥, 가운데가 원점이 되게 — 부모에 붙이기 전에 재야 모형 자기 좌표가 나온다
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      pivot.add(model);
    },
    undefined,
    (error) => console.warn("[ClamDig] 호미 모형을 못 읽었다:", error),
  );
  // 실물보다 조금 크게 — 1인칭 화면에서 호미로 읽히게
  group.scale.setScalar(M * HOE_SCALE);
  return group;
}

/**
 * 바지락 껍데기 한 장 — 경첩(+y 끝)에서 부채꼴로 퍼지는 볼록한 껍데기. 미터.
 * 경첩에서 바깥으로 t(0~1), 좌우로 φ 인 격자로 만들어 나이테·방사 무늬를 꼭짓점 색으로 칠한다.
 */
function buildShellHalf(base: THREE.Color, dark: THREE.Color) {
  const RINGS = 28;
  const RAYS = 48;
  const SPREAD = 1.95; // 좌우로 벌어지는 각
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    for (let j = 0; j <= RAYS; j++) {
      const phi = (j / RAYS - 0.5) * 2 * SPREAD;
      // 테두리 — 아래로 둥글고 경첩 쪽은 좁다
      const edge = 0.046 * (0.62 + 0.38 * Math.cos(phi * 0.62));
      const r = t * edge;
      const x = Math.sin(phi) * r * 1.12;
      const y = 0.02 - Math.cos(phi) * r;
      // 볼록 — 경첩 근처가 가장 높고 가장자리로 얇아진다. 나이테마다 살짝 턱
      const dome = 0.013 * Math.pow(1 - t * t, 0.55) + 0.0005 * Math.sin(t * 46);
      positions.push(x, y, dome);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(t * 46), 3);
      const ray = Math.max(0, Math.sin(phi * 9 + t * 5)) * smooth(0.25, 0.7, t);
      color.copy(base).lerp(dark, Math.min(1, ring * 0.35 + ray * 0.45 + (1 - t) * 0.15));
      colors.push(color.r, color.g, color.b);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < RAYS; j++) {
      const a = i * (RAYS + 1) + j;
      const b = a + RAYS + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2); // 눕힌다 — 볼록한 쪽이 위, 경첩이 -z
  const material = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: TOON_GRADIENT,
    side: THREE.DoubleSide,
    // 껍데기 자체가 아주 은은하게 — 빛 덩어리는 두지 않는다
    emissive: new THREE.Color("#8FA6CC"),
    emissiveIntensity: 0.08,
  });
  return new THREE.Mesh(geometry, material);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 한 움큼 — 크기가 다른 조개 다섯. [x, y, z(미터, 배율 전), 크기, yaw, 기울기] — 가운데 큰 것에 기대 포개진다 */
const HANDFUL: [number, number, number, number, number, number][] = [
  [0, 0, 0, 1.15, 0, 0],
  [0.062, 0.004, 0.026, 0.78, 1.9, 0.18],
  [-0.058, 0.003, 0.02, 0.95, -1.2, -0.14],
  [0.024, 0.008, -0.056, 0.66, 2.8, 0.25],
  [-0.03, 0.012, -0.044, 0.86, -2.4, -0.22],
];

/** 조개 한 움큼 — 껍데기 두 장씩, 살짝 벌어진 조개 다섯. 껍데기 지오·재질은 함께 쓴다 */
function buildClam() {
  const group = new THREE.Group();
  const top = buildShellHalf(new THREE.Color("#D9CDB6"), new THREE.Color("#6B5440"));
  top.position.y = 0.003;
  top.rotation.x = -0.1; // 경첩을 축으로 살짝 벌어짐
  const bottom = buildShellHalf(new THREE.Color("#C9BCA4"), new THREE.Color("#5E4A38"));
  bottom.scale.y = -1;
  for (const [x, y, z, size, yaw, tilt] of HANDFUL) {
    const one = new THREE.Group();
    one.add(top.clone(), bottom.clone());
    one.position.set(x, y, z);
    one.rotation.set(tilt, yaw, tilt * 0.6);
    one.scale.setScalar(size);
    group.add(one);
  }
  group.scale.setScalar(M * CLAM_SCALE);
  group.traverse((o) => (o.castShadow = true));
  return group;
}

/** 판 구덩이 — 가장자리가 들쭉날쭉하고 가운데로 갈수록 어둡다. 파낸 모래는 옆에 소복이 */
function buildGround() {
  const holeGeometry = new THREE.CircleGeometry(1, 32);
  const position = holeGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const dark = new THREE.Color("#3A342C");
  const rim = new THREE.Color("#7A7262");
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    const wobble = 1 + 0.16 * Math.sin(3 * a + 1.3) + 0.08 * Math.sin(7 * a + 0.4);
    position.setXY(i, x * wobble * 0.3, y * wobble * 0.26);
    color.copy(dark).lerp(rim, Math.pow(r, 2.2));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  holeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  holeGeometry.rotateX(-Math.PI / 2);
  const hole = new THREE.Mesh(
    holeGeometry,
    // 빛을 받아야 주변 모래와 같은 밝기로 앉는다(Basic 은 혼자 밝게 뜬다)
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT }),
  );
  hole.scale.setScalar(M);

  const pileGeometry = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = pileGeometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const bump = 1 + 0.18 * Math.sin(4 * a + 0.7) + 0.1 * Math.sin(9 * a);
    p.setXYZ(i, p.getX(i) * bump, p.getY(i) * (0.85 + 0.3 * Math.sin(5 * a)), p.getZ(i) * bump);
  }
  pileGeometry.computeVertexNormals();
  const pile = new THREE.Mesh(pileGeometry, toon("#9A907D"));
  pile.scale.set(0.3 * M, 0.1 * M, 0.24 * M);
  pile.receiveShadow = true;
  return { hole, pile };
}

/**
 * 먼저 파 놓은 구덩이 셋 — 어디를 파는지 보여 준다(크기 제각각). 하나는 비었고, 하나엔 입 벌린 빈 조개껍데기,
 * 하나엔 조개 대신 고둥 몇 개와 부러진 게 집게. [x, z, 크기, 돌림, 든 것] — 배와 호미 자리는 비킨다
 */
const SIDE_HOLES: [number, number, number, number, "empty" | "shells" | "odds"][] = [
  [16.0, 41.5, 1.1, 0.4, "empty"],
  [16.95, 41.2, 0.8, 1.7, "shells"],
  [15.65, 41.95, 0.62, 2.6, "odds"],
];
/** 파다 만 자국 — 실제로 팔 자리. 호미로 한두 번 긁다 만 얕은 자국과 작은 모래 둔덕 */
const SCRAPE_SIZE = 0.38;

function buildSideHoles(ground: ReturnType<typeof buildGround>) {
  const group = new THREE.Group();
  const shellTop = buildShellHalf(new THREE.Color("#D9CDB6"), new THREE.Color("#6B5440"));
  const shellBottom = buildShellHalf(new THREE.Color("#C9BCA4"), new THREE.Color("#5E4A38"));
  const snail = toon("#7A6A52");
  const claw = toon("#8A5E44");
  for (const [x, z, size, yaw, contents] of SIDE_HOLES) {
    const y = groundY(x, z);
    const hole = new THREE.Mesh(ground.hole.geometry, ground.hole.material);
    hole.position.set(x * M, (y + 0.006) * M, z * M);
    hole.rotation.y = yaw;
    hole.scale.setScalar(M * size);
    const pile = new THREE.Mesh(ground.pile.geometry, ground.pile.material);
    pile.position.set((x + Math.cos(yaw) * 0.42 * size) * M, y * M, (z - Math.sin(yaw) * 0.42 * size) * M);
    pile.scale.set(0.3 * M * size, 0.1 * M * size, 0.24 * M * size);
    pile.rotation.y = yaw;
    group.add(hole, pile);
    if (contents === "shells") {
      // 입 벌린 빈 조개껍데기 — 누가 먼저 캐 먹고 버린 것
      [[0.04, 0.02, 0.4], [-0.06, -0.03, 2.1], [0.0, 0.07, 4.0]].forEach(([dx, dz, turn]) => {
        const pair = new THREE.Group();
        pair.add(shellBottom.clone());
        const top = shellTop.clone();
        top.rotation.x = -2.3; // 경첩에서 활짝 젖혀졌다
        pair.add(top);
        pair.position.set((x + dx) * M, (y + 0.015) * M, (z + dz) * M);
        pair.rotation.y = turn;
        pair.scale.setScalar(M * CLAM_SCALE * 0.85);
        group.add(pair);
      });
    } else if (contents === "odds") {
      // 조개 대신 — 고둥 셋과 부러진 게 집게 하나
      [[0.03, 0.02], [-0.04, 0.01], [0.0, -0.04]].forEach(([dx, dz], k) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 7), snail);
        cone.position.set((x + dx) * M, (y + 0.014) * M, (z + dz) * M);
        cone.rotation.set(Math.PI / 2 - 0.3, k * 2.1, 0.4);
        cone.scale.setScalar(M);
        group.add(cone);
      });
      const pincer = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.05, 6).rotateZ(Math.PI / 2), claw);
      const tipA = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.04, 5).rotateZ(-Math.PI / 2).translate(0.045, 0.006, 0), claw);
      const tipB = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.032, 5).rotateZ(-Math.PI / 2 - 0.4).translate(0.04, -0.008, 0), claw);
      pincer.add(arm, tipA, tipB);
      pincer.position.set((x - 0.05) * M, (y + 0.012) * M, (z + 0.05) * M);
      pincer.rotation.y = 0.8;
      pincer.scale.setScalar(M);
      group.add(pincer);
    }
  }
  return group;
}

function createSandBurst() {
  const count = 40;
  return {
    points: makeGlowPoints(count, { additive: false, softness: 1.2 }),
    position: Array.from({ length: count }, () => new THREE.Vector3()),
    velocity: Array.from({ length: count }, () => new THREE.Vector3()),
    age: new Float32Array(count).fill(9),
    next: 0,
  };
}
type SandBurst = ReturnType<typeof createSandBurst>;

function throwSand(burst: SandBurst, at: THREE.Vector3) {
  for (let n = 0; n < 14; n++) {
    const k = burst.next;
    burst.next = (burst.next + 1) % burst.age.length;
    const angle = Math.random() * Math.PI * 2;
    burst.position[k].copy(at);
    burst.velocity[k]
      .set(
        Math.cos(angle) * (0.3 + Math.random() * 0.5),
        1 + Math.random() * 0.8,
        Math.sin(angle) * (0.3 + Math.random() * 0.5),
      )
      .multiplyScalar(M);
    burst.age[k] = 0;
  }
}

const spotPoint = (x: number, z: number, lift = 0) => new THREE.Vector3(x * M, (groundY(x, z) + lift) * M, z * M);
const heldOffset = new THREE.Vector3();
const swingQuat = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const heldTilt = new THREE.Quaternion();
const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

const ease = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);

/** 손에 든 호미 — 화면 오른쪽 아래, 자루가 손 쪽 */
function holdHoe(camera: THREE.Camera, position: THREE.Vector3, quaternion: THREE.Quaternion) {
  heldOffset.set(0.3, -0.3, -0.62).multiplyScalar(M).applyQuaternion(camera.quaternion);
  position.copy(camera.position).add(heldOffset);
  quaternion
    .copy(camera.quaternion)
    .multiply(swingQuat.setFromAxisAngle(yAxis, Math.PI))
    .multiply(heldTilt.setFromAxisAngle(xAxis, 0.5));
}

/**
 * 땅을 찍는 호미 자세 — 날 끝이 구덩이 자리에 오도록 몸통을 거꾸로 맞춘다.
 * toPlayer: 구덩이에서 플레이어 쪽 수평 방향
 */
function digPose(
  spot: THREE.Vector3,
  toPlayer: THREE.Vector3,
  [, height, back, pitch]: [number, number, number, number],
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
) {
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z); // 날이 플레이어 반대쪽(구덩이)을 본다
  quaternion.setFromEuler(tmpEuler.set(pitch, yaw, 0));
  const tip = tmpVec.copy(spot).addScaledVector(toPlayer, back * M);
  tip.y += height * M;
  position.copy(tip).sub(tmpVec2.copy(HOE_TIP).applyQuaternion(quaternion).multiplyScalar(M * HOE_SCALE));
}

/** 진행도 p 의 호미질 자세 — 맨 앞은 손에서 넘어오고, 그 뒤는 열쇠 자세 사이를 부드럽게 */
function digKeyAt(p: number): [number, number, number, number] {
  for (let k = 1; k < DIG_KEYS.length; k++) {
    const [p1] = DIG_KEYS[k];
    if (p > p1) continue;
    const a = DIG_KEYS[k - 1];
    const b = DIG_KEYS[k];
    const t = ease((p - a[0]) / (b[0] - a[0]));
    return [p, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return DIG_KEYS[DIG_KEYS.length - 1];
}

/** 움직임 하나 — 진행도와 시작 자세 */
function createMove() {
  return { t: -1, fromPosition: new THREE.Vector3(), fromQuaternion: new THREE.Quaternion() };
}
type Move = ReturnType<typeof createMove>;

function startMove(move: Move, object: THREE.Object3D) {
  move.t = 0;
  move.fromPosition.copy(object.position);
  move.fromQuaternion.copy(object.quaternion);
}

export default function ClamDig() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const stage = useClamStage();
  const digRef = useRef(-1);
  const settle = useMemo(() => createMove(), []);
  const pick = useMemo(() => createMove(), []);
  const bait = useMemo(() => createMove(), []);
  /** 미끼 든 통발이 물에 잠기면 조개는 더 그리지 않는다 */
  const sunkRef = useRef(false);
  /** 다 판 뒤 호미가 누운 자세 — 파기를 마친 쪽에 따라 정한다 */
  const dropped = useMemo(
    () => ({ position: spotPoint(DIG_SPOT.x, DIG_SPOT.z - 0.4, 0.005), quaternion: new THREE.Quaternion() }),
    [],
  );
  /** 구덩이에서 플레이어 쪽 — 파기 시작할 때 정한다 */
  const toPlayer = useMemo(() => new THREE.Vector3(0, 0, -1), []);

  const hoe = useMemo(() => buildHoe(), []);
  const clam = useMemo(() => buildClam(), []);
  const ground = useMemo(() => buildGround(), []);
  const sideHoles = useMemo(() => buildSideHoles(ground), [ground]);
  // 파다 만 자국 — 구덩이 모양을 작게, 둔덕도 작게
  const scrape = useMemo(() => {
    const hole = new THREE.Mesh(ground.hole.geometry, ground.hole.material);
    const pile = new THREE.Mesh(ground.pile.geometry, ground.pile.material);
    return { hole, pile };
  }, [ground]);
  const glow = useMemo(() => makeGlowPoints(GLINTS.length, { additive: true }), []);
  const sand = useMemo(() => createSandBurst(), []);
  const spot = useMemo(() => spotPoint(DIG_SPOT.x, DIG_SPOT.z), []);
  const hoeRest = useMemo(() => spotPoint(HOE_SPOT.x, HOE_SPOT.z, 0.02), []);
  const clamTarget = useMemo(() => spot.clone().add(new THREE.Vector3(0, 0.03 * M, 0)), [spot]);

  useEffect(() => {
    const group = new THREE.Group();
    ground.hole.position.copy(spot).add(new THREE.Vector3(0, 0.006 * M, 0));
    // 파낸 모래 더미 — 구덩이 옆. 바닥이 기울어 있어 제자리 땅 높이에 앉혀야 뜨지 않는다(살짝 묻는다)
    const pileX = DIG_SPOT.x + 0.45;
    const pileZ = DIG_SPOT.z - 0.2;
    ground.pile.position.set(pileX * M, (groundY(pileX, pileZ) - 0.02) * M, pileZ * M);
    scrape.hole.position.copy(spot).add(new THREE.Vector3(0.03 * M, 0.004 * M, 0.02 * M));
    scrape.hole.rotation.y = 0.9;
    scrape.hole.scale.set(M * SCRAPE_SIZE, M * SCRAPE_SIZE, M * SCRAPE_SIZE * 0.7);
    scrape.pile.position.copy(spot).add(new THREE.Vector3(0.2 * M, 0, -0.12 * M));
    scrape.pile.scale.set(0.12 * M, 0.04 * M, 0.09 * M);
    group.add(hoe, clam, ground.hole, ground.pile, glow.points, sand.points.points, sideHoles, scrape.hole, scrape.pile);
    scene.add(group);
    return () => {
      scene.remove(group);
    };
  }, [scene, hoe, clam, ground, glow, sand, spot, sideHoles, scrape]);

  // ── 상호작용 ──
  useEffect(() => {
    const hoeTarget = registerInteractable({
      id: "clam-hoe",
      position: hoeRest,
      label: "호미 들기",
      radius: 0.5 * M,
      reach: 3 * M,
      enabled: () => clamDig.stage() === "buried",
      use: () => {
        clamDig.set("hoe");
        audio.play("똑");
        showNotice("호미를 들었다. 갯가에서 조개를 캘 때 쓰던 것이다.");
      },
    });
    const spotTarget = registerInteractable({
      id: "clam-spot",
      position: spot,
      label: stage === "hoe" ? "호미로 파기" : "모래 살펴보기",
      radius: 0.55 * M,
      reach: 2.2 * M, // 가까이 와야 판다 — 멀리서 호미만 날아가 보이지 않게
      enabled: () => (clamDig.stage() === "buried" || clamDig.stage() === "hoe") && digRef.current < 0,
      use: () => {
        if (clamDig.stage() !== "hoe") {
          showNotice("모래 속에서 무언가 희미하게 빛난다. 맨손으로는 팔 수 없다.");
          return;
        }
        digRef.current = 0;
      },
    });
    const clamTargetHandle = registerInteractable({
      id: "clam-pick",
      position: clamTarget,
      label: "조개 한 움큼 줍기",
      radius: 0.45 * M,
      reach: 2.4 * M,
      enabled: () => clamDig.stage() === "dug" && settle.t < 0,
      use: () => {
        startMove(pick, clam);
        clamDig.set("held");
        audio.play("단서");
        showNotice("조개를 한 움큼 주웠다. 미끼로 쓸 수 있겠다.");
      },
    });
    return () => {
      hoeTarget();
      spotTarget();
      clamTargetHandle();
    };
  }, [stage, spot, hoeRest, clamTarget, clam, settle, pick]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    const camera = state.camera;
    const current = clamDig.stage();

    // 파기 — 호미 날이 구덩이 자리를 두 번 찍고 몸 쪽으로 긁는다
    if (digRef.current >= 0) {
      if (digRef.current === 0) {
        toPlayer.set(camera.position.x - spot.x, 0, camera.position.z - spot.z).normalize();
      }
      const before = digRef.current;
      digRef.current = Math.min(1, digRef.current + dt / DIG_SECONDS);
      const p = digRef.current;
      for (const strike of STRIKES) {
        if (before < strike && p >= strike) {
          throwSand(sand, spot.clone().add(new THREE.Vector3(0, 0.03 * M, 0)));
          audio.play("똑");
        }
      }
      if (p < DIG_KEYS[0][0]) {
        // 손에서 첫 자세로
        holdHoe(camera, tmpVec2, tmpQuat);
        const from = tmpVec2.clone();
        const fromQuat = tmpQuat.clone();
        digPose(spot, toPlayer, DIG_KEYS[0], hoe.position, hoe.quaternion);
        const t = ease(p / DIG_KEYS[0][0]);
        hoe.position.lerpVectors(from, hoe.position, t);
        hoe.quaternion.slerpQuaternions(fromQuat, hoe.quaternion, t);
      } else {
        digPose(spot, toPlayer, digKeyAt(p), hoe.position, hoe.quaternion);
      }
      if (p >= 1) {
        digRef.current = -1;
        // 구덩이 옆, 플레이어 쪽에 자루를 두고 눕힌다
        const side = tmpVec.set(-toPlayer.z, 0, toPlayer.x);
        dropped.position
          .copy(spot)
          .addScaledVector(toPlayer, 0.34 * M)
          .addScaledVector(side, 0.16 * M);
        dropped.position.y = groundY(dropped.position.x / M, dropped.position.z / M) * M + 0.005 * M;
        dropped.quaternion.setFromAxisAngle(yAxis, Math.atan2(-toPlayer.x, -toPlayer.z) + 0.35);
        startMove(settle, hoe);
        clamDig.set("dug");
        showNotice("모래를 걷어 내자 크고 작은 조개가 한 움큼 드러났다.");
      }
    }
    const isDigging = digRef.current >= 0;

    // 호미 — 바닥 / 손 / (파는 중은 위에서) / 구덩이 옆에 내려놓음
    if (isDigging) {
      // 위에서 자세를 잡았다
    } else if (current === "hoe") {
      holdHoe(camera, hoe.position, hoe.quaternion);
    } else if (current === "buried") {
      hoe.position.copy(hoeRest);
      hoe.rotation.set(0, HOE_SPOT.rotation, 0);
    } else if (settle.t >= 0) {
      settle.t = Math.min(1, settle.t + dt / SETTLE_SECONDS);
      const t = ease(settle.t);
      hoe.position.lerpVectors(settle.fromPosition, dropped.position, t);
      hoe.quaternion.slerpQuaternions(settle.fromQuaternion, dropped.quaternion, t);
      if (settle.t >= 1) settle.t = -1;
    } else {
      hoe.position.copy(dropped.position);
      hoe.quaternion.copy(dropped.quaternion);
    }

    // 땅 — 첫 호미질에 구덩이가 생기고 두 번째에 넓어진다
    const digP = digRef.current;
    const isDug = current !== "buried" && current !== "hoe";
    const struck = STRIKES.filter((strike) => digP >= strike).length;
    const holeSize = isDug ? 1 : struck > 0 ? HOLE_GROWTH[struck - 1] : 0;
    ground.hole.visible = holeSize > 0;
    // 파다 만 자국은 제대로 파기 시작하면 구덩이에 묻힌다
    scrape.hole.visible = holeSize === 0;
    scrape.pile.visible = holeSize === 0;
    ground.pile.visible = holeSize > 0;
    ground.hole.scale.setScalar(M * holeSize);
    ground.pile.scale.set(0.3 * M * holeSize, 0.1 * M * holeSize, 0.24 * M * holeSize);

    // 조개 — 구덩이 속 → 집어 올려 손으로 → 통발 입구로 → 통발 안
    if (current === "baited" && !sunkRef.current) {
      const trap = clamDig.baitTrap();
      if (trap) {
        clam.position.copy(trap.center);
        // 통발이 물에 잠기면 그만 그린다(다시 건져도 미끼는 물고기가 먹었다)
        if (trap.center.y < -0.02 * M) sunkRef.current = true;
      }
    }
    clam.visible = isDug && !sunkRef.current;
    // 손에 든 한 움큼은 눈 바로 앞이라 줄여 든다 — 화면을 가리지 않게
    clam.scale.setScalar(M * CLAM_SCALE * (current === "held" ? 0.6 : 1));
    if (current === "held") {
      heldOffset.set(0.2, -0.24, -0.62).multiplyScalar(M).applyQuaternion(camera.quaternion);
      const handPosition = tmpVec2.copy(camera.position).add(heldOffset);
      if (pick.t >= 0) {
        pick.t = Math.min(1, pick.t + dt / PICK_SECONDS);
        // 먼저 구덩이에서 똑바로 집어 올리고, 그다음 손으로 가져온다
        const lift = tmpVec.copy(pick.fromPosition);
        lift.y += 0.16 * M;
        if (pick.t < 0.4) {
          clam.position.lerpVectors(pick.fromPosition, lift, ease(pick.t / 0.4));
          clam.quaternion.copy(pick.fromQuaternion);
        } else {
          const t = ease((pick.t - 0.4) / 0.6);
          clam.position.lerpVectors(lift, handPosition, t);
          clam.quaternion.slerpQuaternions(pick.fromQuaternion, camera.quaternion, t);
        }
        if (pick.t >= 1) pick.t = -1;
      } else {
        clam.position.copy(handPosition);
        clam.quaternion.copy(camera.quaternion);
      }
    } else if (current === "baiting") {
      const trap = clamDig.baitTrap();
      if (bait.t < 0) startMove(bait, clam);
      if (trap) {
        bait.t = Math.min(1, bait.t + dt / BAIT_SECONDS);
        // 입구 = 막힌 끝의 반대쪽. 입구 앞에서 한 번 멈칫했다가 안으로 밀어 넣는다
        const mouth = tmpVec.copy(trap.center).multiplyScalar(2).sub(trap.closedEnd);
        const outward = tmpVec2.copy(mouth).sub(trap.center).normalize();
        const front = mouth.clone().addScaledVector(outward, 0.18 * M);
        front.y += 0.06 * M;
        tmpQuat.setFromAxisAngle(yAxis, Math.atan2(outward.x, outward.z));
        if (bait.t < 0.55) {
          const t = ease(bait.t / 0.55);
          clam.position.lerpVectors(bait.fromPosition, front, t);
          clam.position.y += Math.sin(t * Math.PI) * 0.12 * M;
          clam.quaternion.slerpQuaternions(bait.fromQuaternion, tmpQuat, t);
        } else {
          const t = ease((bait.t - 0.55) / 0.45);
          clam.position.lerpVectors(front, trap.center, t);
          clam.quaternion.copy(tmpQuat);
        }
        if (bait.t >= 1) {
          bait.t = -1;
          audio.play("똑");
          clamDig.set("baited"); // 통발이 이걸 보고 굴러간다
        }
      }
    } else if (current !== "baited") {
      clam.position.copy(clamTarget);
      clam.rotation.set(0.22, 0.6, 0.12); // 모래에 반쯤 기울어 박힌 채
    }

    // 반짝임 — 빛 덩어리 대신 모래 틈·껍데기 위에서 작게 반짝였다 사라진다
    const glowAt = current === "held" || current === "baiting" ? clam.position : current === "buried" || current === "hoe" ? spot : clamTarget;
    const isBuried = current === "buried" || current === "hoe";
    const strength = current === "baited" ? 0 : 1;
    for (let k = 0; k < GLINTS.length; k++) {
      const [dx, dz] = GLINTS[k];
      // 파낸 뒤엔 껍데기 가장자리 세 점만
      const isShown = isBuried || k < 3;
      const spread = (isBuried ? 1 : 0.35) * M;
      glow.position.setXYZ(
        k,
        glowAt.x + dx * spread,
        glowAt.y + (isBuried ? 0.01 : 0.03) * M,
        glowAt.z + dz * spread,
      );
      const twinkle = Math.pow(Math.max(0, Math.sin(time * (1.3 + k * 0.37) + k * 2.1)), 10);
      glow.size.setX(k, (isBuried ? 0.05 : 0.035) * M);
      glow.alpha.setX(k, isShown ? strength * twinkle * 0.8 : 0);
      glow.color.setXYZ(k, CLAM_LIGHT.r, CLAM_LIGHT.g, CLAM_LIGHT.b);
    }
    glow.commit();

    // 튄 모래
    for (let k = 0; k < sand.age.length; k++) {
      sand.age[k] += dt;
      if (sand.age[k] > 0.8) {
        sand.points.alpha.setX(k, 0);
        continue;
      }
      sand.velocity[k].y -= 9.8 * M * dt;
      sand.position[k].addScaledVector(sand.velocity[k], dt);
      const p = sand.position[k];
      sand.points.position.setXYZ(k, p.x, Math.max(p.y, spot.y), p.z);
      sand.points.size.setX(k, 0.04 * M);
      sand.points.alpha.setX(k, 1 - sand.age[k] / 0.8);
      sand.points.color.setXYZ(k, SAND.r, SAND.g, SAND.b);
    }
    sand.points.commit();

    const scale = pointScaleFor(gl, camera);
    glow.material.uniforms.uPointScale.value = scale;
    sand.points.material.uniforms.uPointScale.value = scale;
  });

  return null;
}
