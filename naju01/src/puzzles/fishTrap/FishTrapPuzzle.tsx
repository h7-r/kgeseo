/**
 * 통발 퍼즐 — 그날 밤 꺼진 화톳불의 불티가 「빛 물고기」가 되어 물살을 따라 흘러 내려온다.
 *   ① 뭍에 놓인 통발 셋을 [E] 로 하나씩 물에 굴려 넣는다. 셋 다 가라앉아 보이지 않는다
 *   ② 셋 중 하나만 입구가 물살 위쪽을 보고 있어 불티가 들어간다. 들어갈 때마다 그 통발 줄만 파르르 떨리고 잔물결이 인다
 *   ③ 줄은 흰·붉은·검은 세 가닥이 서로 엇갈려 각자 말뚝에 매여 있다. 떨린 줄을 골라 [E] 로 당긴다
 *      틀린 줄은 빈 통발이 올라왔다가 다시 가라앉는다
 *   ④ 불씨 든 통발이 화톳불 곁으로 올라온다 → [E] 불씨를 화톳불에 쏟기 → 불이 붙는다(HearthFire)
 * 통발은 미르의 배치 무리(씬1.통발)를 실행 중에 읽어 같은 자리·모양으로 바꿔 끼운다 — 편집기로 옮겨도 따라온다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { GROUP_IDS } from "../../placement/editFile";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { buildStrawShoeGeometry } from "../itemLooks";
import { FULL_COUNT, fishTrapPuzzle, useFishTrapStage } from "./fishTrapState";
import { EMBER, HEARTH, M, buildFishGeometry, groundY, makeGlowPoints, pointScaleFor } from "./shared";
import { clamDig, useClamStage } from "./clamState";
import { isGaugeActive, startGauge, stopGauge } from "./pullGauge";
import { createWaterSplash } from "./waterSplash";

// ── 물살 (미터) ───────────────────────────────────────
// 물은 −x → +x 로 흐르고 불티 물고기도 물살을 타고 내려온다. 입구가 −x(위쪽)를 본 통발에만 들어간다.
const FLOW = new THREE.Vector3(1, 0, 0);
// 통발 둘레만 돈다 — 길면 한 바퀴가 길어 통발이 늦게 찬다
const STREAM_X: [number, number] = [15, 25];
/** 굴려 넣은 통발이 가라앉는 곳 — 뭍 자리에서 강 쪽으로 */
const THROW_OUT = 1.8;
/** 물고기 길 — 통발이 가라앉은 줄보다 이만큼 먼 물(미터). 물가 바로 앞을 헤엄치면 너무 많이 보인다 */
const LANE_OUT = 1.1;
const LANE_HALF = 0.55;
const FISH_COUNT = 10;
/** 수면에 비치는 주기(초)와 그중 보이는 몫 — 늘 떠 있으면 물고기가 아니라 떠 있는 장식이다 */
const SHOW_CYCLE = 6;
const SHOW_DUTY = 0.2;
const FISH_Y = 0.02;
const CATCH_M = 0.45;
const ATTRACT_M = 2.2;

// ── 말뚝과 줄 ────────────────────────────────────────
// 줄은 서로 엇갈린다 — 통발 자리만 보고는 어느 줄인지 모르게. 떨림을 보고 골라야 한다.
const STAKES = [
  { x: 22.75, z: 43.45, rope: "흰 줄", color: "#D9CFB4" },
  { x: 23.35, z: 43.6, rope: "붉은 줄", color: "#A3402F" },
  { x: 23.95, z: 43.72, rope: "검은 줄", color: "#2F2A26" },
];
const STAKE_HEIGHT = 0.85;
const STAKE_RADIUS = 0.045;
/** 통발 n 번의 줄이 매인 말뚝 */
const TRAP_TO_STAKE = [2, 0, 1];
/** 입구가 물살을 보게 떨어지는 통발 — 이것만 불티가 든다 */
const CATCHING_TRAP = 1;
/** 틀린 줄 통발에 든 것 — 붉은 줄은 엉킨 미역 줄기(장난), 검은 줄은 어부의 짚신 한 짝(줍지 않아도 풀리는 숨은 단서) */
const SEAWEED_ROPE = "붉은 줄";
const SHOE_ROPE = "검은 줄";

/** 통발에 엉킨 미역 줄기 — 굽이진 띠 여럿, 몇 가닥은 통발 밖으로 늘어진다. 미터, 통발 가운데가 원점 */
function buildSeaweedTangle() {
  const group = new THREE.Group();
  const material = new THREE.MeshToonMaterial({ color: "#4E5B2C", gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
  for (let k = 0; k < 7; k++) {
    const length = 0.35 + (k % 3) * 0.18;
    const geometry = new THREE.PlaneGeometry(0.035 + (k % 2) * 0.015, length, 1, 10);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      // 물결치며 비틀린 띠
      p.setZ(i, Math.sin(y * 14 + k) * 0.03);
      p.setX(i, p.getX(i) + Math.sin(y * 6 + k * 2) * 0.04);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    const a = (k / 7) * Math.PI * 2;
    mesh.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.05, (k - 3) * 0.06);
    mesh.rotation.set(Math.PI / 2 + (k % 3) * 0.4, a, (k % 2) * 0.6);
    group.add(mesh);
  }
  group.scale.setScalar(M);
  return group;
}

const ROLL_SECONDS = 1.5;
const PULL_SECONDS = 1.8;
/** 들어 옮기고 → 기울여 쏟고 → 내려놓기까지 */
const POUR_SECONDS = 3.6;
/** 쏟은 물고기가 떨어지는 무게 — 실제 중력(9.8)보다 조금 느리게 보이게 */
const FALL_GRAVITY = 6.5;
/** 건져 올린 통발엔 적어도 이만큼 들어 있다 — 화톳불에 부을 게 넉넉해 보이게 */
const MIN_CATCH = 4;
/** 마지막 한 마리 — 나머지를 다 부은 뒤 따로 앞에 털어 낸다(쏟기 진행 몫 · 날아가는 초) */
const LAST_RELEASE = 0.8;
const LAST_FLIGHT = 0.6;
const SPARK_COUNT = 60;

/** baiting = 뭍에서 조개가 입구로 들어가는 동안 기다린다 */
type TrapPlace = "shore" | "baiting" | "rolling" | "water" | "pulling" | "landed" | "returning";

interface Trap {
  index: number;
  stake: number;
  object: THREE.Group;
  mesh: THREE.InstancedMesh;
  baseQuaternion: THREE.Quaternion;
  shorePosition: THREE.Vector3;
  waterPosition: THREE.Vector3;
  landPosition: THREE.Vector3;
  place: TrapPlace;
  /** 지금 움직임의 진행 0~1 */
  motion: number;
  /** 물속에서 돌려 놓는 yaw(원래 자세에 더한다) */
  waterYaw: number;
  /** 물속 입구가 보는 쪽(절대 yaw) */
  mouthAngle: number;
  centerLocalY: number;
  height: number;
  halfLength: number;
  center: THREE.Vector3;
  closedEnd: THREE.Vector3;
  mouthWater: THREE.Vector3;
  caught: number;
  /** 줄 떨림 0~1 */
  tug: number;
  rope: THREE.Mesh;
  ropeKey: string;
  surface: THREE.Vector3 | null;
  /** 다음 줄 짓기 때 수면 자리에서 물을 튀긴다 */
  splashPending: boolean;
  waitTimer: number;
}

type FishState = "swim" | "dive";

interface Fish {
  position: THREE.Vector3;
  heading: THREE.Vector3;
  speed: number;
  phase: number;
  state: FishState;
  timer: number;
  from: THREE.Vector3;
  /** 수면에 비친 정도 0~1 */
  shown: number;
}

const yawAxis = new THREE.Vector3(0, 1, 0);
const forwardAxis = new THREE.Vector3(0, 0, 1);
const tmpQuat = new THREE.Quaternion();
const tmpQuat2 = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const DEFAULT_LANE_Z = 45.1;

/** 미르 무리 「씬1.통발」 을 찾는다 */
function findTrapSource(scene: THREE.Scene): THREE.InstancedMesh | null {
  let found: THREE.InstancedMesh | null = null;
  scene.traverse((object) => {
    if (!found && object.name === GROUP_IDS.scene1FishTraps && (object as THREE.InstancedMesh).isInstancedMesh)
      found = object as THREE.InstancedMesh;
  });
  return found;
}

/** 대나무 색은 인스턴스 색에 있다. 무리가 처음 설 때는 아직 비어 있어 늦게 채워지면 그때 옮긴다 */
function copyTrapColors(source: THREE.InstancedMesh, traps: Trap[]) {
  if (!source.instanceColor) return;
  const color = new THREE.Color();
  for (const trap of traps) {
    if (trap.mesh.instanceColor || trap.index >= source.count) continue;
    source.getColorAt(trap.index, color);
    trap.mesh.setColorAt(0, color);
    trap.mesh.instanceColor!.needsUpdate = true;
  }
}

/** 꼬리를 흔든다 — 뒤로 갈수록 크게 */
function makeFishMaterial(time: { value: number }) {
  const material = new THREE.MeshBasicMaterial({ color: EMBER.clone().multiplyScalar(2.4), toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aPhase;\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float back = clamp(-position.z / 0.23, 0.0, 1.0);
        transformed.x += sin(uTime * 11.0 + aPhase - position.z * 22.0) * 0.035 * back;`,
      );
  };
  return material;
}

function newFish(laneZ: number, startAtHead: boolean): Fish {
  return {
    position: new THREE.Vector3(
      startAtHead ? STREAM_X[0] - Math.random() * 2 : STREAM_X[0] + Math.random() * (STREAM_X[1] - STREAM_X[0]),
      FISH_Y,
      laneZ + (Math.random() * 2 - 1) * LANE_HALF,
    ),
    heading: FLOW.clone(),
    speed: 0.35 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    state: "swim",
    timer: 0,
    from: new THREE.Vector3(),
    shown: 0,
  };
}

const createFish = () => Array.from({ length: FISH_COUNT }, () => newFish(DEFAULT_LANE_Z, false));

function createSchool(time: { value: number }, count = FISH_COUNT) {
  const mesh = new THREE.InstancedMesh(buildFishGeometry(), makeFishMaterial(time), count);
  const phases = new Float32Array(count).map(() => Math.random() * Math.PI * 2);
  mesh.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

const createCaughtFish = (time: { value: number }) => createSchool(time, FULL_COUNT);

/** 물살 결 — 수면 위로 흘러가는 짧은 흰 줄. 어느 쪽에서 흘러오는지 보이게 */
function createStreaks() {
  const count = 26;
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: "#E8F0F4",
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  const items = Array.from({ length: count }, () => ({
    x: STREAM_X[0] + Math.random() * (STREAM_X[1] - STREAM_X[0]),
    dz: Math.random() * 1.6 - 0.5,
    length: 0.35 + Math.random() * 0.5,
    speed: 0.5 + Math.random() * 0.3,
  }));
  return { mesh, items };
}

/** 말뚝 — 꼭대기에 줄과 같은 색 천을 감아 어느 줄인지 보이게 */
function createStake(index: number) {
  const def = STAKES[index];
  const group = new THREE.Group();
  const wood = new THREE.CylinderGeometry(STAKE_RADIUS * 0.8 * M, STAKE_RADIUS * M, STAKE_HEIGHT * M, 7);
  wood.translate(0, (STAKE_HEIGHT / 2) * M, 0);
  const pole = new THREE.Mesh(wood, new THREE.MeshToonMaterial({ color: "#5A4632", gradientMap: TOON_GRADIENT }));
  pole.castShadow = true;
  const cloth = new THREE.CylinderGeometry(STAKE_RADIUS * 1.25 * M, STAKE_RADIUS * 1.25 * M, 0.13 * M, 8);
  cloth.translate(0, (STAKE_HEIGHT - 0.12) * M, 0);
  const tag = new THREE.Mesh(cloth, new THREE.MeshToonMaterial({ color: def.color, gradientMap: TOON_GRADIENT }));
  group.add(pole, tag);
  group.position.set(def.x * M, groundY(def.x, def.z) * M, def.z * M);
  return group;
}

const stakeTop = (index: number) =>
  new THREE.Vector3(
    STAKES[index].x * M,
    (groundY(STAKES[index].x, STAKES[index].z) + STAKE_HEIGHT - 0.06) * M,
    STAKES[index].z * M,
  );

/** 통발 끝 → 말뚝. 가운데가 처지고, 떨릴 때는 옆으로 잘게 흔들린다. 수면을 지나는 자리를 돌려준다 */
function updateRope(trap: Trap, to: THREE.Vector3, time: number): THREE.Vector3 | null {
  const from = trap.closedEnd;
  // 가만히 있으면 다시 짓지 않는다
  const key = trap.tug > 0.001 ? "" : `${from.x.toFixed(2)},${from.y.toFixed(2)},${from.z.toFixed(2)}`;
  if (key && key === trap.ropeKey) return trap.surface;
  trap.ropeKey = key;
  // 물에 잠긴 통발이면 줄은 말뚝에서 땅을 타고 내려와 수면 위에 떠서 통발 바로 위까지 간 뒤 물속으로 든다.
  // 물에 드는 자리(entry)가 물이 튀는 자리다. 뭍에 있으면 처지는 줄 하나.
  const isUnderwater = from.y < 0;
  const guide: THREE.Vector3[] = [];
  let entry: THREE.Vector3 | null = null;
  if (isUnderwater) {
    // 물결(최대 약 9 cm) 위로 띄운다 — 낮으면 물결에 묻혀 줄이 끊겨 보인다
    const floatY = 0.1 * M;
    entry = new THREE.Vector3(from.x, floatY, from.z);
    const ground = (x: number, z: number) => Math.max(groundY(x / M, z / M) * M, 0) + 0.025 * M;
    const shore = new THREE.Vector3().lerpVectors(to, entry, 0.45);
    shore.y = ground(shore.x, shore.z);
    const foot = new THREE.Vector3().lerpVectors(to, entry, 0.12);
    foot.y = ground(foot.x, foot.z) + 0.05 * M;
    const onWater = new THREE.Vector3().lerpVectors(to, entry, 0.75);
    onWater.y = Math.max(ground(onWater.x, onWater.z), floatY);
    guide.push(from.clone(), entry.clone(), onWater, shore, foot, to.clone());
  } else {
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(groundY(mid.x / M, mid.z / M) * M + 0.02 * M, Math.min(from.y, to.y) - 0.08 * M);
    guide.push(from.clone(), mid, to.clone());
  }
  const curve = new THREE.CatmullRomCurve3(guide);
  const side = tmpVec2.subVectors(to, from).cross(yawAxis).normalize();
  const points: THREE.Vector3[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const point = curve.getPoint(t);
    if (trap.tug > 0.001) {
      const shake = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 5 + time * 48) * trap.tug * 0.05 * M;
      point.addScaledVector(side, shake);
      point.y += Math.abs(shake) * 0.4;
    }
    points.push(point);
  }
  const surface = entry;
  trap.rope.geometry.dispose();
  trap.rope.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, 0.014 * M, 5, false);
  trap.surface = surface;
  return surface;
}

const hearthPoint = () => new THREE.Vector3(HEARTH.x * M, (groundY(HEARTH.x, HEARTH.z) + 0.04) * M, HEARTH.z * M);

/** 쏟고 남은 한 마리가 떨어지는 자리 — 내려놓은 통발 너머, 불에서 먼 쪽 */
function leftoverFishSpot(trap: Trap) {
  const hearth = hearthPoint();
  const away = new THREE.Vector3().subVectors(trap.landPosition, hearth).setY(0).normalize();
  const spot = hearth.addScaledVector(away, 1.35 * M);
  spot.y = groundY(spot.x / M, spot.z / M) * M;
  return spot;
}

/** 쏟는 동안 통발 자세 — 들어 올려 화톳불 위로 → 입구를 재 쪽으로 기울여 멈춤 → 곁에 내려놓기 */
function poseForPour(trap: Trap, p: number, startQuat: THREE.Quaternion) {
  const hearth = hearthPoint();
  const away = tmpVec2.subVectors(trap.landPosition, hearth).setY(0).normalize();
  const above = hearth
    .clone()
    .addScaledVector(away, 0.45 * M)
    .add(new THREE.Vector3(0, 0.85 * M, 0));
  const rest = hearth.clone().addScaledVector(away, 0.8 * M);
  rest.y = groundY(rest.x / M, rest.z / M) * M;
  const tiltDir = hearth.clone().sub(above).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tiltDir);
  if (p < 0.25) {
    const t = THREE.MathUtils.smootherstep(p / 0.25, 0, 1);
    trap.object.position.lerpVectors(trap.landPosition, above, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.2 * M;
    trap.object.quaternion.slerpQuaternions(startQuat, tilt, t);
  } else if (p < 0.72) {
    // 털어 내듯 잘게 흔든다
    trap.object.position.copy(above);
    trap.object.position.x += Math.sin(p * 90) * 0.012 * M;
    trap.object.quaternion.copy(tilt);
  } else {
    const t = THREE.MathUtils.smootherstep((p - 0.72) / 0.28, 0, 1);
    trap.object.position.lerpVectors(above, rest, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.15 * M;
    trap.object.quaternion.slerpQuaternions(tilt, trap.baseQuaternion, t);
  }
}

/** 쏟는 물고기 하나하나의 떨어짐 — 나온 자리·빠르기·재에 닿았나 */
function createPourState() {
  return {
    startQuat: new THREE.Quaternion(),
    from: Array.from({ length: FULL_COUNT }, () => new THREE.Vector3()),
    velocity: Array.from({ length: FULL_COUNT }, () => new THREE.Vector3()),
    released: new Uint8Array(FULL_COUNT),
    landed: new Uint8Array(FULL_COUNT),
  };
}

/** 재에 닿을 때 튀는 불티 */
function createSparks() {
  return {
    points: makeGlowPoints(SPARK_COUNT, { additive: true }),
    position: Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3()),
    velocity: Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3()),
    age: new Float32Array(SPARK_COUNT).fill(9),
    next: 0,
  };
}
type Sparks = ReturnType<typeof createSparks>;

function emitSparks(sparks: Sparks, at: THREE.Vector3, count: number) {
  for (let n = 0; n < count; n++) {
    const k = sparks.next;
    sparks.next = (sparks.next + 1) % SPARK_COUNT;
    sparks.position[k].copy(at);
    const angle = Math.random() * Math.PI * 2;
    const out = 0.3 + Math.random() * 0.5;
    sparks.velocity[k].set(Math.cos(angle) * out, 1 + Math.random() * 1.2, Math.sin(angle) * out).multiplyScalar(M);
    sparks.age[k] = 0;
  }
}

export default function FishTrapPuzzle() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const stage = useFishTrapStage();
  const clam = useClamStage();
  const root = useMemo(() => new THREE.Group(), []);
  const trapsRef = useRef<Trap[]>([]);
  const sourceRef = useRef<THREE.InstancedMesh | null>(null);
  const [trapVersion, setTrapVersion] = useState(0);
  const lightRef = useRef<THREE.PointLight>(null);
  const scanTimer = useRef(0);
  const laneZ = useRef(DEFAULT_LANE_Z);
  const pourRef = useRef(-1);
  /** 게이지로 당기는 중인 말뚝 — 멀어지면 그만둔다 */
  const pullingStake = useRef(-1);
  const pourState = useMemo(() => createPourState(), []);
  const sparks = useMemo(() => createSparks(), []);
  const splash = useMemo(() => createWaterSplash(), []);
  const nextTugRef = useRef(0);
  // 틀린 줄 통발에 든 것 — 통발을 따라다닌다. 짚신은 뭍에 올라오면 털어 떨궈 주울 수 있게 한다
  const seaweed = useMemo(() => buildSeaweedTangle(), []);
  const shoe = useMemo(() => {
    const mesh = new THREE.Mesh(buildStrawShoeGeometry(), new THREE.MeshToonMaterial({ color: "#8E7748", gradientMap: TOON_GRADIENT }));
    mesh.scale.setScalar(M * 1.3);
    return mesh;
  }, []);
  const shoeDropped = useRef(false);

  const stakes = useMemo(() => STAKES.map((_, index) => createStake(index)), []);
  const stakeTops = useMemo(() => STAKES.map((_, index) => stakeTop(index)), []);
  const ropeMaterials = useMemo(
    () => STAKES.map((def) => new THREE.MeshToonMaterial({ color: def.color, gradientMap: TOON_GRADIENT })),
    [],
  );

  const fishTime = useMemo(() => ({ value: 0 }), []);
  const fish = useMemo(() => createFish(), []);
  const school = useMemo(() => createSchool(fishTime), [fishTime]);
  const halos = useMemo(() => makeGlowPoints(FISH_COUNT, { additive: true }), []);
  const streaks = useMemo(() => createStreaks(), []);
  // 건져 올린 통발 안의 불씨 — 쏟을 때 화톳불로 날아간다
  const caughtEmbers = useMemo(() => makeGlowPoints(FULL_COUNT, { additive: true }), []);
  // 통발 안에 든 물고기 — 잡힌 모습 그대로 보이고, 쏟으면 하나씩 떨어진다
  const caughtFish = useMemo(() => createCaughtFish(fishTime), [fishTime]);

  useEffect(() => {
    root.add(
      school,
      halos.points,
      streaks.mesh,
      caughtEmbers.points,
      caughtFish,
      sparks.points.points,
      splash.group,
      seaweed,
      shoe,
      ...stakes,
    );
    scene.add(root);
    return () => {
      scene.remove(root);
      if (sourceRef.current) sourceRef.current.visible = true;
    };
  }, [root, scene, school, halos, streaks, caughtEmbers, caughtFish, sparks, splash, stakes, seaweed, shoe]);

  /** 미르 무리에서 통발을 읽어 퍼즐 통발로 바꿔 끼운다. 편집으로 무리가 다시 서면 다시 읽는다 */
  const adoptTraps = (source: THREE.InstancedMesh) => {
    const previous = trapsRef.current;
    for (const trap of previous) root.remove(trap.object, trap.rope);
    source.geometry.computeBoundingBox();
    const box = source.geometry.boundingBox!;
    const traps: Trap[] = [];
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, tmpMatrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      tmpMatrix.decompose(position, quaternion, scale);
      const object = new THREE.Group();
      // 원본과 같은 인스턴스 메시로 하나씩 — 대나무 색이 인스턴스 색에 들어 있다
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object.add(mesh);
      object.position.copy(position);
      // 옮겨 둔 자세 그대로 — 빠뜨리면 기본 자세로 서서 땅에 박힌다
      object.quaternion.copy(quaternion);
      object.scale.copy(scale);
      const height = (box.max.y - box.min.y) * scale.y;
      const halfLength = ((box.max.z - box.min.z) / 2) * scale.z;
      const waterPosition = position.clone();
      waterPosition.z += THROW_OUT * M;
      waterPosition.y = -height * 2.2; // 다 잠긴다 — 어느 것에 불티가 들었는지 눈으로는 모른다
      const stake = TRAP_TO_STAKE[i % TRAP_TO_STAKE.length] % STAKES.length;
      const landPosition = new THREE.Vector3(
        STAKES[stake].x * M,
        groundY(STAKES[stake].x, STAKES[stake].z + 0.5) * M,
        (STAKES[stake].z + 0.5) * M,
      );
      // 들어가는 통발만 입구가 물살 위쪽(−x)을, 나머지는 아래쪽을 본다
      const mouthAngle = i === CATCHING_TRAP ? -Math.PI / 2 : Math.PI / 2;
      const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
      const baseAngle = Math.atan2(baseDir.x, baseDir.z);
      const keep = previous[i];
      const rope = keep?.rope ?? new THREE.Mesh(new THREE.BufferGeometry(), ropeMaterials[stake]);
      traps.push({
        index: i,
        stake,
        object,
        mesh,
        baseQuaternion: quaternion,
        shorePosition: position.clone(),
        waterPosition,
        landPosition,
        // 불씨가 드는 흰 줄 통발만 뭍에 두고, 나머지 둘은 처음부터 물속에 가라앉아 있다
        place: keep?.place ?? (i === CATCHING_TRAP ? "shore" : "water"),
        motion: keep?.motion ?? 0,
        waterYaw: mouthAngle - baseAngle,
        mouthAngle,
        centerLocalY: (box.max.y + box.min.y) / 2,
        height,
        halfLength,
        center: new THREE.Vector3(),
        closedEnd: new THREE.Vector3(),
        mouthWater: new THREE.Vector3(),
        caught: keep?.caught ?? 0,
        tug: 0,
        rope,
        ropeKey: "",
        surface: null,
        splashPending: false,
        waitTimer: 0,
      });
      root.add(object, rope);
    }
    source.visible = false;
    sourceRef.current = source;
    copyTrapColors(source, traps);
    if (traps.length)
      laneZ.current = traps.reduce((sum, trap) => sum + trap.waterPosition.z / M, 0) / traps.length + LANE_OUT;
    trapsRef.current = traps;
    setTrapVersion((version) => version + 1);
  };

  const trapAction = useRef<(trap: Trap) => void>(() => {});
  const stakeAction = useRef<(stake: number) => void>(() => {});
  // 개발용 — 헤드리스는 마우스를 못 잠가 [E] 를 못 누른다. __game.najuFishTrapDev.throwIn(0) · .pull(2)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFishTrapDev", {
      traps: () => trapsRef.current,
      throwIn: (index: number) => {
        const trap = trapsRef.current[index];
        if (trap) trapAction.current(trap);
      },
      pull: (stake: number) => stakeAction.current(stake),
      pour: () => {
        const trap = trapsRef.current.find((t) => t.place === "landed" && t.index === CATCHING_TRAP);
        if (trap) trapAction.current(trap);
      },
    });
  }, []);

  // ── 상호작용 등록 ──
  useEffect(() => {
    if (!trapVersion) return undefined;
    const traps = trapsRef.current;
    const isBusy = () => traps.some((t) => t.place === "baiting" || t.place === "rolling" || t.place === "pulling" || t.place === "returning");

    const handleTrap = (trap: Trap) => {
      if (trap.place === "shore") {
        // 미끼 없이는 넣지 않는다 — 통발 바닥의 조개껍데기가 무엇을 캐야 하는지 알려 준다
        if (clamDig.stage() !== "held") {
          showNotice("통발 바닥에 깨진 조개껍데기가 붙어 있다. 직접 캔 미끼가 필요하다.");
          return;
        }
        // 조개가 입구로 다 들어가면(ClamDig 이 baited 로 바꾸면) 그때 굴러간다
        clamDig.putInto(trap);
        trap.place = "baiting";
      } else if (trap.place === "landed" && fishTrapPuzzle.stage() === "pulled" && pourRef.current < 0) {
        pourRef.current = 0;
        pourState.startQuat.copy(trap.object.quaternion);
        pourState.released.fill(0);
        pourState.landed.fill(0);
        audio.play("첨벙");
      }
      setTrapVersion((version) => version + 1);
    };
    const pullStake = (stake: number) => {
      const trap = traps.find((t) => t.stake === stake);
      if (!trap || isBusy()) return;
      if (traps.some((t) => t.place === "shore" || t.place === "baiting")) {
        showNotice("흰 줄 통발이 아직 뭍에 있다. 먼저 물에 넣어야 한다.");
        return;
      }
      if (trap.place !== "water" || isGaugeActive()) return;
      // 게이지 — 가운데에서 [E] 세 번이면 올라온다. 맞출 때마다 줄이 당겨지며 물이 튄다
      pullingStake.current = stake;
      startGauge(`${STAKES[stake].rope} 당기기`, {
        onHit: () => {
          trap.tug = 1;
          trap.splashPending = true;
          audio.play("첨벙");
        },
        onDone: () => {
          pullingStake.current = -1;
          // 맞는 통발이면 적어도 넷은 들어 있다
          if (trap.index === CATCHING_TRAP && trap.caught > 0) trap.caught = Math.min(FULL_COUNT, Math.max(MIN_CATCH, trap.caught));
          trap.place = "pulling";
          trap.motion = 0;
          trap.tug = 1;
          trap.splashPending = true;
          setTrapVersion((version) => version + 1);
        },
      });
      setTrapVersion((version) => version + 1);
    };
    trapAction.current = handleTrap;
    stakeAction.current = pullStake;

    const cleanups = traps.map((trap) =>
      registerInteractable({
        id: `fish-trap-${trap.index}`,
        position: trap.center,
        label:
          trap.place === "landed"
            ? "불씨를 화톳불에 쏟기"
            : clam === "held"
              ? "조개를 미끼로 넣고 물에 굴려 넣기"
              : "통발 살펴보기",
        radius: 0.6 * M,
        reach: 3.4 * M,
        enabled: () =>
          trap.place === "shore" ||
          (trap.place === "landed" && fishTrapPuzzle.stage() === "pulled" && pourRef.current < 0),
        use: () => handleTrap(trap),
      }),
    );
    const stakeCleanups = STAKES.map((def, index) =>
      registerInteractable({
        id: `fish-trap-stake-${index}`,
        position: stakeTops[index],
        label: `${def.rope} 당기기`,
        radius: 0.45 * M,
        reach: 3 * M,
        enabled: () => {
          const s = fishTrapPuzzle.stage();
          return (s === "idle" || s === "full") && !isBusy() && !isGaugeActive();
        },
        use: () => pullStake(index),
      }),
    );
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      stakeCleanups.forEach((cleanup) => cleanup());
    };
  }, [trapVersion, stage, stakeTops, pourState, clam]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    fishTime.value = time;

    scanTimer.current -= dt;
    if (scanTimer.current <= 0) {
      scanTimer.current = 1;
      const source = findTrapSource(scene);
      if (source && source !== sourceRef.current) adoptTraps(source);
      else if (source) {
        source.visible = false;
        copyTrapColors(source, trapsRef.current);
      }
    }
    const traps = trapsRef.current;
    if (!traps.length) return;
    if (pullingStake.current >= 0) {
      if (!isGaugeActive()) pullingStake.current = -1;
      else if (state.camera.position.distanceTo(stakeTops[pullingStake.current]) > 4 * M) {
        stopGauge();
        pullingStake.current = -1;
      }
    }
    const currentStage = fishTrapPuzzle.stage();
    let changed = false;

    // ── 통발 움직임 ──
    for (const trap of traps) {
      const stakePoint = stakeTops[trap.stake];
      if (trap.place === "shore" || trap.place === "baiting") {
        trap.object.position.copy(trap.shorePosition);
        trap.object.quaternion.copy(trap.baseQuaternion);
        if (trap.place === "baiting" && clamDig.stage() === "baited") {
          trap.place = "rolling";
          trap.motion = 0;
          changed = true;
        }
      } else if (trap.place === "rolling") {
        trap.motion = Math.min(1, trap.motion + dt / ROLL_SECONDS);
        const t = THREE.MathUtils.smootherstep(trap.motion, 0, 1);
        trap.object.position.lerpVectors(trap.shorePosition, trap.waterPosition, t);
        trap.object.position.y += Math.sin(t * Math.PI) * 0.15 * M;
        // 긴 축으로 데굴데굴 구르며 물 쪽(+z)을 향해 돌아눕는다
        tmpQuat.setFromAxisAngle(yawAxis, trap.waterYaw * t);
        tmpQuat2.setFromAxisAngle(forwardAxis, t * Math.PI * 4);
        trap.object.quaternion.copy(tmpQuat).multiply(trap.baseQuaternion).multiply(tmpQuat2);
        if (trap.motion >= 1) {
          trap.place = "water";
          audio.play("첨벙");
          changed = true;
        }
      } else if (trap.place === "water") {
        trap.object.position.copy(trap.waterPosition);
        tmpQuat.setFromAxisAngle(yawAxis, trap.waterYaw);
        trap.object.quaternion.copy(tmpQuat).multiply(trap.baseQuaternion);
      } else if (trap.place === "pulling" || trap.place === "returning") {
        trap.motion = Math.min(1, trap.motion + dt / (trap.place === "pulling" ? PULL_SECONDS : ROLL_SECONDS));
        const t = THREE.MathUtils.smootherstep(trap.motion, 0, 1);
        const [a, b] =
          trap.place === "pulling" ? [trap.waterPosition, trap.landPosition] : [trap.landPosition, trap.waterPosition];
        trap.object.position.lerpVectors(a, b, t);
        trap.object.position.y += Math.sin(t * Math.PI) * 0.3 * M;
        trap.tug = Math.max(trap.tug, trap.place === "pulling" ? 0.5 : 0);
        if (trap.motion >= 1) {
          changed = true;
          if (trap.place === "returning") trap.place = "water";
          else {
            trap.place = "landed";
            trap.waitTimer = 0;
            // 불씨가 하나라도 들었으면 건진 것이다 — 덜 찼다고 되돌리지 않는다
            const isFull = trap.index === CATCHING_TRAP && trap.caught > 0;
            if (isFull) {
              fishTrapPuzzle.pull();
              audio.play("단서"); // 카메라는 건드리지 않는다 — 불이 붙을 때만 줌
              showNotice("불씨 든 통발이 올라왔다. 그날 밤 꺼진 화톳불의 불티들이다.");
            } else if (STAKES[trap.stake].rope === SEAWEED_ROPE) {
              audio.play("첨벙");
              showNotice("미역 줄기만 잔뜩 엉켜 올라왔다. 물고기 대신 미역국 거리다.", 3.5);
            } else if (STAKES[trap.stake].rope === SHOE_ROPE && !shoeDropped.current) {
              // 짚신을 털어 통발 앞 뭍에 떨군다 — 주워 두면 단서(안 주워도 풀린다)
              shoeDropped.current = true;
              shoe.visible = false;
              const drop = trap.landPosition.clone().add(new THREE.Vector3(-0.5 * M, 0, -0.45 * M));
              drop.y = groundY(drop.x / M, drop.z / M) * M;
              inventory.spawn("strawShoe", drop);
              audio.play("단서");
              showNotice("통발 안에 큰 짚신 한 짝이 걸려 있었다. 어부의 신이다 — 신코에 물고기 하나가 새겨져 있다.", 5);
            } else {
              showNotice("빈 통발이다. 물만 줄줄 흐른다.");
            }
          }
        }
      } else if (trap.place === "landed") {
        if (trap.index === CATCHING_TRAP && pourRef.current >= 0)
          poseForPour(trap, Math.min(1, pourRef.current), pourState.startQuat);
        else trap.object.position.copy(trap.landPosition);
        // 틀린 통발은 잠시 보여 주고 다시 물로
        const keep = trap.index === CATCHING_TRAP && currentStage !== "idle" && currentStage !== "full";
        if (!keep) {
          trap.waitTimer += dt;
          if (trap.waitTimer > 2.2) {
            trap.place = "returning";
            trap.motion = 0;
            changed = true;
          }
        }
      }
      trap.center
        .set(0, trap.centerLocalY, 0)
        .multiply(trap.object.scale)
        .applyQuaternion(trap.object.quaternion)
        .add(trap.object.position);
      tmpVec.set(0, 0, 1).applyQuaternion(trap.object.quaternion);
      trap.closedEnd.copy(tmpVec).multiplyScalar(trap.halfLength).add(trap.center);
      // 물속 입구 — 들어갈 자리는 가라앉은 자리 기준
      tmpVec.set(Math.sin(trap.mouthAngle), 0, Math.cos(trap.mouthAngle));
      trap.mouthWater.copy(trap.waterPosition).addScaledVector(tmpVec, trap.halfLength);

      // 틀린 줄 통발 속 — 미역 줄기 · 짚신이 통발을 따라간다
      const rope = STAKES[trap.stake].rope;
      if (rope === SEAWEED_ROPE) {
        seaweed.position.copy(trap.center);
        seaweed.quaternion.copy(trap.object.quaternion);
      } else if (rope === SHOE_ROPE && !shoeDropped.current) {
        shoe.position.copy(trap.center).add(tmpVec.set(0, -0.08 * M, 0));
        shoe.quaternion.copy(trap.object.quaternion);
      }
      // 줄 — 떨릴 때만 다시 짓고, 아니면 자리가 바뀔 때만
      trap.tug = Math.max(0, trap.tug - dt * 1.6);
      const surface = updateRope(trap, stakePoint, time);
      // 줄이 수면을 지나는 자리에서 물이 튄다
      if (trap.splashPending && surface) {
        splash.trigger(surface, trap.tug);
        trap.splashPending = false;
      }
    }
    if (changed) setTrapVersion((version) => version + 1);

    // 찬 뒤에도 불티가 부딪혀 그 줄만 이따금 떨린다 — 어느 줄을 당길지의 단서
    const catching = traps[CATCHING_TRAP];
    if (catching && catching.place === "water" && catching.caught > 0) {
      nextTugRef.current -= dt;
      if (nextTugRef.current <= 0) {
        nextTugRef.current = 1.4 + ((time * 7.3) % 1.6);
        catching.tug = 1;
        catching.splashPending = true;
      }
    }

    // ── 빛 물고기 ──
    const target = catching && catching.place === "water" && catching.caught < FULL_COUNT ? catching : null;
    fish.forEach((f, i) => {
      if (f.state === "swim") {
        const wantZ = laneZ.current + Math.sin(time * 0.5 + f.phase) * LANE_HALF;
        tmpVec.set(FLOW.x, 0, (wantZ - f.position.z) * 1.4);
        let isDrawn = false;
        if (target) {
          tmpVec2.copy(target.mouthWater).divideScalar(M);
          const dist = Math.hypot(tmpVec2.x - f.position.x, tmpVec2.z - f.position.z);
          if (f.position.x <= tmpVec2.x + 0.1 && dist < ATTRACT_M) {
            isDrawn = true;
            const pull = 1 - dist / ATTRACT_M;
            tmpVec.x += (tmpVec2.x - f.position.x) * 3 * pull;
            tmpVec.z += (tmpVec2.z - f.position.z) * 3 * pull;
            if (dist < CATCH_M) {
              f.state = "dive";
              f.timer = 0;
              f.from.copy(f.position);
            }
          }
        }
        tmpVec.normalize();
        f.heading.lerp(tmpVec, Math.min(1, dt * 3)).normalize();
        f.position.addScaledVector(f.heading, f.speed * dt);
        // 잠깐 수면에 비쳤다가 다시 잠긴다. 통발로 끌려갈 때는 계속 보인다
        const cycle = SHOW_CYCLE + (f.phase % 1) * 3;
        const surfaced = ((time + f.phase * 5) / cycle) % 1 < SHOW_DUTY;
        f.shown += ((isDrawn || surfaced ? 1 : 0) - f.shown) * Math.min(1, dt * 2.5);
        f.position.y = FISH_Y - (1 - f.shown) * 0.1 + Math.sin(time * 2.4 + f.phase) * 0.015;
        if (f.position.x > STREAM_X[1]) Object.assign(f, newFish(laneZ.current, true));
      } else {
        // 물속 입구로 빨려 들어간다
        f.timer += dt;
        const t = Math.min(1, f.timer / 0.7);
        tmpVec2.copy(catching!.mouthWater).divideScalar(M);
        f.position.lerpVectors(f.from, tmpVec2, t * t);
        if (t >= 1) {
          catching!.caught += 1;
          catching!.tug = 1;
          catching!.splashPending = true;
          audio.play("똑");
          // 첫 불씨가 들면 「걸렸다」 — 그 줄이 떨리기 시작한다
          if (catching!.caught === 1) fishTrapPuzzle.fill();
          Object.assign(f, newFish(laneZ.current, true));
        }
      }

      tmpVec.set(f.heading.x, 0, f.heading.z);
      if (tmpVec.lengthSq() < 1e-6) tmpVec.copy(FLOW);
      tmpQuat.setFromUnitVectors(forwardAxis, tmpVec.normalize());
      tmpVec2.copy(f.position).multiplyScalar(M);
      const fade = (f.state === "dive" ? 1 - Math.min(1, f.timer / 0.7) : 1) * f.shown;
      tmpScale.setScalar(M * Math.max(0.0001, fade));
      tmpMatrix.compose(tmpVec2, tmpQuat, tmpScale);
      school.setMatrixAt(i, tmpMatrix);
      halos.position.setXYZ(i, tmpVec2.x, tmpVec2.y, tmpVec2.z);
      halos.size.setX(i, 0.42 * M);
      halos.alpha.setX(i, 0.32 * fade * (0.85 + Math.sin(time * 7 + f.phase) * 0.15));
      halos.color.setXYZ(i, EMBER.r * 1.1, EMBER.g * 1.1, EMBER.b * 1.1);
    });
    school.instanceMatrix.needsUpdate = true;
    halos.commit();

    // ── 물살 결 ──
    streaks.items.forEach((s, k) => {
      s.x += s.speed * dt;
      if (s.x > STREAM_X[1]) s.x = STREAM_X[0];
      const edge = Math.max(0.01, Math.min(1, (s.x - STREAM_X[0]) / 1.5, (STREAM_X[1] - s.x) / 1.5));
      tmpVec2.set(s.x * M, 0.012 * M, (laneZ.current + s.dz) * M);
      tmpScale.set(s.length * M * edge, 1, 0.025 * M);
      tmpMatrix.compose(tmpVec2, tmpQuat.identity(), tmpScale);
      streaks.mesh.setMatrixAt(k, tmpMatrix);
    });
    streaks.mesh.instanceMatrix.needsUpdate = true;

    // ── 건져 올린 통발 안 불씨 · 쏟기 ──
    // 맞는 통발이 끌려 올라오는 순간부터 안의 불씨가 함께 딸려 온다
    const carrier =
      catching &&
      catching.caught > 0 &&
      (catching.place === "pulling" || catching.place === "landed" || catching.place === "returning")
        ? catching
        : null;
    const carried = carrier ? Math.min(FULL_COUNT, carrier.caught) : 0;
    if (pourRef.current >= 0 && pourRef.current < 1) {
      pourRef.current = Math.min(1, pourRef.current + dt / POUR_SECONDS);
      if (pourRef.current >= 1) fishTrapPuzzle.light();
    }
    const pour = pourRef.current;
    const hearth = hearthPoint();
    let remaining = 0;
    for (let k = 0; k < FULL_COUNT; k++) {
      const hidden = !carrier || k >= carried || currentStage === "lit" || currentStage === "told";
      if (hidden || pourState.landed[k]) {
        caughtEmbers.alpha.setX(k, 0);
        caughtFish.setMatrixAt(k, tmpMatrix.makeScale(0, 0, 0));
        continue;
      }
      // 차례가 오면 입구로 미끄러져 나와 떨어진다. 마지막 한 마리는 나머지를 다 부은 뒤 따로 앞에 털어 낸다
      const isLast = k === carried - 1;
      const releaseAt = isLast ? LAST_RELEASE : 0.27 + (0.4 * k) / Math.max(1, carried - 2);
      const isFalling = pour >= 0 && pour >= releaseAt;
      if (isFalling && !pourState.released[k]) {
        pourState.released[k] = 1;
        tmpVec.set(0, 0, -1).applyQuaternion(carrier.object.quaternion);
        pourState.from[k].copy(carrier.center).addScaledVector(tmpVec, carrier.halfLength * 0.9);
        if (isLast) {
          // 떨어질 자리로 곧장 — 포물선 한 번에 닿게 빠르기를 거꾸로 푼다
          const spot = leftoverFishSpot(carrier);
          pourState.velocity[k]
            .subVectors(spot, pourState.from[k])
            .divideScalar(LAST_FLIGHT)
            .add(tmpVec.set(0, 0.5 * FALL_GRAVITY * M * LAST_FLIGHT, 0));
        } else pourState.velocity[k].copy(tmpVec).multiplyScalar(0.7 * M);
      }
      const position = tmpVec2;
      const heading = tmpVec;
      if (isFalling && isLast) {
        const elapsed = (pour - releaseAt) * POUR_SECONDS;
        position.copy(pourState.from[k]).addScaledVector(pourState.velocity[k], elapsed);
        position.y -= 0.5 * FALL_GRAVITY * M * elapsed * elapsed;
        heading.copy(pourState.velocity[k]);
        heading.y -= FALL_GRAVITY * M * elapsed;
        if (elapsed >= LAST_FLIGHT) {
          // 뭍에 떨어져 파닥인다 — 소지품에 챙길 수 있다
          pourState.landed[k] = 1;
          inventory.spawn("lightFish", leftoverFishSpot(carrier));
          audio.play("첨벙");
          showNotice("한 마리는 따로 털어 앞에 떨궜다. 뭍에서 파닥인다 — 챙겨 두자.");
          caughtEmbers.alpha.setX(k, 0);
          caughtFish.setMatrixAt(k, tmpMatrix.makeScale(0, 0, 0));
          continue;
        }
      } else if (isFalling) {
        const elapsed = (pour - releaseAt) * POUR_SECONDS;
        position.copy(pourState.from[k]).addScaledVector(pourState.velocity[k], elapsed);
        position.y -= 0.5 * FALL_GRAVITY * M * elapsed * elapsed;
        heading.copy(pourState.velocity[k]);
        heading.y -= FALL_GRAVITY * M * elapsed;
        if (position.y <= hearth.y) {
          pourState.landed[k] = 1;
          emitSparks(sparks, position.set(position.x, hearth.y, position.z), 7);
          audio.play("똑");
          caughtEmbers.alpha.setX(k, 0);
          caughtFish.setMatrixAt(k, tmpMatrix.makeScale(0, 0, 0));
          continue;
        }
      } else {
        // 통발 안에서 맴돈다 — 통발과 함께 움직인다
        const a = time * (1.4 + (k % 4) * 0.25) + k * 1.7;
        const r = (0.05 + (k % 3) * 0.03) * M;
        position.set(Math.cos(a) * r, Math.sin(a * 1.3) * r * 0.6, Math.sin(a) * r).add(carrier.center);
        heading.set(-Math.sin(a), 0, Math.cos(a));
      }
      remaining += 1;
      if (heading.lengthSq() < 1e-8) heading.set(0, -1, 0);
      tmpQuat.setFromUnitVectors(forwardAxis, heading.normalize());
      tmpScale.setScalar(M * 0.75);
      tmpMatrix.compose(position, tmpQuat, tmpScale);
      caughtFish.setMatrixAt(k, tmpMatrix);
      caughtEmbers.position.setXYZ(k, position.x, position.y, position.z);
      caughtEmbers.size.setX(k, 0.3 * M);
      caughtEmbers.alpha.setX(k, 0.35);
      caughtEmbers.color.setXYZ(k, EMBER.r * 1.2, EMBER.g * 1.2, EMBER.b * 1.2);
    }
    caughtFish.instanceMatrix.needsUpdate = true;
    caughtEmbers.commit();

    // 불티 — 위로 튀었다가 식으며 떨어진다
    for (let k = 0; k < SPARK_COUNT; k++) {
      sparks.age[k] += dt;
      const life = 0.7;
      if (sparks.age[k] > life) {
        sparks.points.alpha.setX(k, 0);
        continue;
      }
      sparks.velocity[k].y -= 4 * M * dt;
      sparks.position[k].addScaledVector(sparks.velocity[k], dt);
      const t = sparks.age[k] / life;
      const p = sparks.position[k];
      sparks.points.position.setXYZ(k, p.x, p.y, p.z);
      sparks.points.size.setX(k, (0.07 - t * 0.04) * M);
      sparks.points.alpha.setX(k, 1 - t);
      sparks.points.color.setXYZ(k, 2, 0.9 - t * 0.4, 0.3 - t * 0.2);
    }
    sparks.points.commit();

    const scale = pointScaleFor(gl, state.camera);
    halos.material.uniforms.uPointScale.value = scale;
    caughtEmbers.material.uniforms.uPointScale.value = scale;
    sparks.points.material.uniforms.uPointScale.value = scale;
    splash.update(dt, time, scale);

    // 건져 올린 통발이 둘레를 밝힌다
    const light = lightRef.current;
    if (light) {
      if (carrier) light.position.copy(carrier.center);
      const want = carrier && currentStage !== "lit" && currentStage !== "told" ? 2 * (remaining / FULL_COUNT) : 0;
      light.intensity += (want - light.intensity) * Math.min(1, dt * 3);
    }
  });

  // 빛은 처음부터 붙여 두고 세기만 바꾼다 — 나중에 붙이면 모든 재질의 셰이더가 다시 컴파일돼 한 번 멈춘다
  return <pointLight ref={lightRef} color={EMBER} intensity={0} distance={5 * M} decay={1.4} />;
}
