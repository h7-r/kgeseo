/**
 * 강 밑 생물 — 물고기 말고도 지나가며 볼 거리. 사람이 다가오면 저마다 다르게 군다.
 *   오징어 — 물 가운데 떠서 지느러미를 펄럭이다 이따금 쭉 뻗어 나간다. 가까이 오면 먹물을 뿜고 내뺀다
 *   문어   — 바위 곁 바닥에 앉아 다리를 꿈틀댄다. 가까이 오면 먹물을 뿜고 솟구쳤다가 다시 내려앉는다
 *   복어   — 느릿느릿 떠다니다 가까이 오면 가시 돋친 공처럼 부풀었다가 한참 뒤 가라앉는다
 *   불가사리 · 참게 — 바닥. 참게는 옆걸음으로 오가다 가까이 오면 집게를 치켜들고 달아난다
 *   멸치 떼 · 둘째 피라미 떼 — 따로따로 뭉쳐 돌다가 사람을 피해 흩어진다
 *   뱀장어 — 긴 몸을 물결치며 바닥 가까이 느릿느릿
 * 미터로 만들고 M 배로 그린다. 색은 바랜 물속 빛깔 — 청록은 쓰지 않는다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { createRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { M, makeGlowPoints, pointScaleFor } from "../fishTrap/shared";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { audio } from "../../scene/immersion/audio";
import { showNotice } from "../interaction";
import { FLOOR_Y, SURFACE_Y, floorY, getInkArmed, getUnderwater, hurtBreath, stirSand } from "./caveState";
import { SPECIES, buildFishGeometry } from "./fishLooks";

type Spot = [number, number];

/** 자리(미터) — 길 끝에서 큰 방을 지나 고리문까지 걸어가며 하나씩 마주치게 흩어 둔다. 퍼즐 자리는 비킨다 */
const SQUIDS: Spot[] = [
  [49.6, 61.4],
  [41.4, 70.2],
  [44.0, 55.4],
];
const OCTOPI: Spot[] = [
  [51.4, 59.6],
  [38.4, 71.8],
];
const PUFFERS: Spot[] = [
  [43.0, 60.6],
  [47.9, 67.6],
  [37.9, 62.9],
];
const STARS: Spot[] = [
  [44.0, 59.3],
  [46.6, 61.1],
  [37.8, 64.1],
  [50.3, 72.3],
  [42.7, 72.5],
  [44.3, 51.6],
];
const CRABS: Spot[] = [
  [46.2, 59.2],
  [40.6, 67.9],
  [49.1, 70.7],
  [45.7, 53.2],
];
const EELS: Spot[] = [
  [52.2, 60.6],
  [38.3, 61.4],
];
/** 멸치 떼 둘 · 둘째 피라미 떼(서쪽 — 첫째 떼와 따로 논다) */
const ANCHOVY_SCHOOLS: Spot[] = [
  [39.6, 59.6],
  [51.6, 66.4],
];
const MINNOW_REGION = { x: [37.2, 42.4], z: [66.2, 72.4] };

const INK = { count: 380, life: 3.0 };
/** 먹물 한 번에 뿜는 알갱이 수 · 맞는 거리(미터) · 깎이는 숨(초) */
const INK_PUFF = 78;
const INK_DAMAGE = 7;
/**
 * 먹물 공격 — 가까이 가면 눈앞(카메라 앞 이만큼, 미터)으로 헤엄쳐 와서 얼굴에 대고 뿜는다. 한 번 들르면 이만큼 뿜고 달아나며,
 * 뿜은 먹이 날아와 화면에 닿기까지(초) · 다음 뿜기까지(초) · 다 뿜고 다시 덤비기까지(초)
 */
const INK_ATTACK = { trigger: 2.6, giveUp: 7, front: 1.05, shots: 1, travel: 0.28, between: 1.15, rest: 45 };
/** 복어 가시 — 부푼 복어에 이만큼(미터) 붙으면 찔린다 · 깎이는 숨 · 다시 찔리기까지(초) */
const SPIKE_RADIUS = 0.75;
const SPIKE_DAMAGE = 15;
const SPIKE_COOLDOWN = 3;
/** 위장하는 것들 — 모래와 같은 빛깔로 납작 엎드린 넙치 · 바위와 같은 빛깔의 쏨뱅이. 가까이 가야 정체가 드러난다 */
const FLOUNDERS: Spot[] = [
  [45.8, 62.4],
  [42.3, 65.7],
  [48.3, 71.3],
];
const STONEFISH: Spot[] = [
  [52.6, 65.4],
  [37.7, 59.4],
];
const SAND_CAMO = new THREE.Color("#B6AA8A");
const FLOUNDER_TRUE = new THREE.Color("#5E4A32");
const ROCK_CAMO = new THREE.Color("#5E6B69");
const STONEFISH_TRUE = new THREE.Color("#8A6448");

const toon = (color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRADIENT, ...extra });

/** 헤엄 셰이더 — 꼬리 쪽(−x)일수록 좌우로 크게(Fishes 와 같은 셈). 마리마다 aPhase */
function makeSwimMaterial(freq: number, time: { value: number }, amount = 1) {
  const material = new THREE.MeshToonMaterial({ color: "#FFFFFF", vertexColors: true, gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;").replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      {
        float w = clamp((0.2 - position.x) / 0.7, 0.0, 1.0);
        transformed.z += sin(uTime * ${freq.toFixed(1)} + aPhase - position.x * 5.0) * (0.11 * w * w + 0.012) * ${amount.toFixed(2)};
      }`,
    );
  };
  material.customProgramCacheKey = () => `sealife-swim-${freq}-${amount}`;
  return material;
}

/** 오징어 — 앞(+z)이 뾰족한 몸통 · 끝의 지느러미 · 뒤로 늘어진 다리 여덟과 긴 촉완 둘. 미터 */
function buildSquid() {
  const mantle = new THREE.LatheGeometry(
    [
      [0, -0.02],
      [0.05, 0.02],
      [0.068, 0.1],
      [0.062, 0.22],
      [0.038, 0.32],
      [0, 0.38],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  );
  mantle.rotateX(Math.PI / 2);
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.quadraticCurveTo(0.09, 0.03, 0.02, 0.12);
  fin.lineTo(0, 0.12);
  fin.closePath();
  const finGeometry = new THREE.ShapeGeometry(fin);
  finGeometry.rotateX(-Math.PI / 2);
  const arm = new THREE.CylinderGeometry(0.009, 0.004, 0.2, 5);
  arm.translate(0, -0.1, 0);
  arm.rotateX(Math.PI / 2);
  const tentacle = new THREE.CylinderGeometry(0.006, 0.003, 0.36, 5);
  tentacle.translate(0, -0.18, 0);
  tentacle.rotateX(Math.PI / 2);
  return { mantle, finGeometry, arm, tentacle };
}

/** 복어 몸 위 가시 자리 — 고르게 흩은 점 */
function spikeDirections(n: number) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return out;
}

/** 불가사리 — 다섯 팔 별. 바닥에 납작 */
function buildStarfish() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.12 : 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 뱀장어 — 앞(+z)이 머리인 긴 관. 꼬리로 갈수록 가늘다. 꼭짓점 셰이더가 물결치게 한다 */
function buildEel() {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) points.push(new THREE.Vector3(0, 0, 0.45 - (i / 20) * 0.95));
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 40, 0.028, 8, false);
  const p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const back = new THREE.Color("#3F3E2C");
  const belly = new THREE.Color("#B8AE86");
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = (0.45 - z) / 0.95; // 0 머리 · 1 꼬리
    const taper = t < 0.08 ? 0.55 + t * 5.6 : 1 - Math.pow(Math.max(0, t - 0.1) / 0.9, 1.4) * 0.85;
    p.setX(i, p.getX(i) * taper);
    p.setY(i, p.getY(i) * taper * 1.15);
    c.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-p.getY(i), 0, 0.02));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeEelMaterial(time: { value: number }, phase: number) {
  const material = new THREE.MeshToonMaterial({ color: "#FFFFFF", vertexColors: true, gradientMap: TOON_GRADIENT });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      {
        float t = clamp((0.45 - position.z) / 0.95, 0.0, 1.0);
        transformed.x += sin(uTime * 3.2 + ${phase.toFixed(2)} - position.z * 9.0) * (0.015 + 0.07 * t);
      }`,
    );
  };
  material.customProgramCacheKey = () => `sealife-eel-${phase.toFixed(2)}`;
  return material;
}

interface Mover {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  until: number;
  /** 놀람(먹물 · 부풂 · 달아남) 시작 시각 — 없으면 −∞ */
  scaredAt: number;
  heading: number;
  /** 마지막으로 사람을 다치게 한 때 */
  hitAt: number;
  /** 먹물 공격 — 남은 뿜기 수 · 다음 뿜는 때 · 뿜은 먹이 얼굴에 닿는 때(없으면 −1) */
  shotsLeft: number;
  nextShot: number;
  inkDue: number;
}

const mover = (x: number, y: number, z: number): Mover => ({
  home: new THREE.Vector3(x, y, z),
  pos: new THREE.Vector3(x, y, z),
  vel: new THREE.Vector3(),
  target: new THREE.Vector3(x, y, z),
  until: 0,
  scaredAt: -1e9,
  heading: 0,
  hitAt: -1e9,
  shotsLeft: 0,
  nextShot: 0,
  inkDue: -1,
});

export default function SeaLife() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";
  const { gl, camera } = useThree();

  const built = useMemo(() => {
    const random = createRandom(4471);
    const time = { value: 0 };
    const squidParts = buildSquid();
    const mats = {
      // 오징어 — 희고 반투명한 날씬한 몸에 잔 갈색 점. 문어(짙은 얼룩 갈색 · 굵은 다리)와 확 다르게
      squid: toon("#E9E0D2", { transparent: true, opacity: 0.9, emissive: new THREE.Color("#2A241E") }),
      squidSpot: toon("#B87862"),
      octopus: toon("#7A5440"),
      octopusPale: toon("#C9A88C"),
      octopusDark: toon("#4E3426"),
      flounder: FLOUNDERS.map(() => toon("#B6AA8A")),
      stonefish: STONEFISH.map(() => toon("#5E6B69")),
      eye: toon("#16130F"),
      eyeWhite: toon("#E6E0CC"),
      puffer: toon("#C2A05A"),
      pufferBelly: toon("#E6DCB8"),
      pufferSpot: toon("#5A4A2C"),
      spike: toon("#D8CDA4"),
      starfish: [toon("#C46A44"), toon("#B88456"), toon("#A4553F")],
      crab: toon("#6E5C42"),
      crabDark: toon("#4A3D2C"),
      crabClaw: toon("#8A6E4C"),
      fin: toon("#E2C6B4", { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    };
    const geo = {
      ...squidParts,
      sphere: new THREE.SphereGeometry(1, 14, 10),
      spike: new THREE.ConeGeometry(0.0045, 0.058, 4).translate(0, 0.029, 0),
      squidFin: (() => {
        // 화살촉 지느러미 — 몸통 끝을 감싸는 마름모
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.2);
        shape.lineTo(0.1, 0.31);
        shape.lineTo(0, 0.42);
        shape.lineTo(-0.1, 0.31);
        shape.closePath();
        return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).scale(1, 1, -1);
      })(),
      star: buildStarfish(),
      leg: new THREE.CylinderGeometry(0.006, 0.004, 0.09, 5).translate(0, -0.045, 0),
      claw: new THREE.BoxGeometry(0.05, 0.022, 0.032),
      eel: buildEel(),
      tail: new THREE.ConeGeometry(0.035, 0.05, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.2),
    };
    const spikes = spikeDirections(74);
    // 멸치 · 피라미 — 물고기 생김새(fishLooks)를 그대로, 멸치는 작고 가늘게
    const anchovySpecies = { ...SPECIES[0], back: "#7E8C90", belly: "#E8ECEA", fin: "#C9D2D0", tall: 0.9, wide: 0.42 };
    const schoolMesh = (species: typeof SPECIES[number], count: number, freq: number) => {
      const geometry = buildFishGeometry(species);
      const phases = new Float32Array(count);
      for (let i = 0; i < count; i++) phases[i] = random() * Math.PI * 2;
      geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
      const mesh = new THREE.InstancedMesh(geometry, makeSwimMaterial(freq, time, 0.8), count);
      mesh.frustumCulled = false;
      return mesh;
    };
    const anchovies = ANCHOVY_SCHOOLS.map(([x, z]) => ({
      mesh: schoolMesh(anchovySpecies, 46, 13),
      center: mover(x, FLOOR_Y + 1.6, z),
      fish: Array.from({ length: 46 }, () => ({ a: random() * Math.PI * 2, r: 0.15 + random() * 0.45, y: (random() - 0.5) * 0.45, speed: 1.4 + random() * 0.9, pos: new THREE.Vector3(x, FLOOR_Y + 1.6, z), vel: new THREE.Vector3() })),
    }));
    const minnow = {
      mesh: schoolMesh(SPECIES[0], 22, 9),
      center: mover(39.8, FLOOR_Y + 2.0, 69.0),
      fish: Array.from({ length: 22 }, () => ({ a: random() * Math.PI * 2, r: 0.4 + random() * 0.9, y: (random() - 0.5) * 0.7, speed: 0.6 + random() * 0.5, pos: new THREE.Vector3(39.8, FLOOR_Y + 2, 69), vel: new THREE.Vector3() })),
    };
    const ink = makeGlowPoints(INK.count, { additive: false, softness: 1.1 });
    const inkState = { pos: Array.from({ length: INK.count }, () => new THREE.Vector3()), vel: Array.from({ length: INK.count }, () => new THREE.Vector3()), age: new Float32Array(INK.count).fill(99), next: 0 };
    const eelMaterials = EELS.map((_, i) => makeEelMaterial(time, i * 2.1));
    const movers = {
      squids: SQUIDS.map(([x, z]) => mover(x, floorY(x, z) + 1.7 + random() * 0.6, z)),
      octopi: OCTOPI.map(([x, z]) => mover(x, floorY(x, z), z)),
      flounders: FLOUNDERS.map(([x, z]) => mover(x, floorY(x, z) + 0.015, z)),
      stonefish: STONEFISH.map(([x, z]) => mover(x, floorY(x, z) + 0.05, z)),
      puffers: PUFFERS.map(([x, z]) => mover(x, floorY(x, z) + 1.0 + random() * 0.5, z)),
      crabs: CRABS.map(([x, z]) => mover(x, floorY(x, z), z)),
      eels: EELS.map(([x, z]) => mover(x, floorY(x, z) + 0.12, z)),
    };
    const stars = STARS.map(([x, z], i) => ({ x, z, yaw: random() * 6.3, size: 0.8 + random() * 0.6, material: i % 3, phase: random() * 6 }));
    return { random, time, mats, geo, spikes, anchovies, minnow, ink, inkState, eelMaterials, movers, stars };
  }, []);

  useEffect(
    () => () => {
      Object.values(built.geo).forEach((g) => g.dispose());
      Object.values(built.mats).forEach((m) => (Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose()));
      built.eelMaterials.forEach((m) => m.dispose());
      [...built.anchovies.map((a) => a.mesh), built.minnow.mesh].forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      built.ink.points.geometry.dispose();
      built.ink.material.dispose();
    },
    [built],
  );

  const squidRefs = useRef<(THREE.Group | null)[]>([]);
  const squidArms = useRef<(THREE.Group | null)[]>([]);
  const octoRefs = useRef<(THREE.Group | null)[]>([]);
  const octoSegments = useRef<(THREE.InstancedMesh | null)[]>([]);
  const octoSuckers = useRef<(THREE.InstancedMesh | null)[]>([]);
  const pufferRefs = useRef<(THREE.Group | null)[]>([]);
  const pufferBodies = useRef<(THREE.Group | null)[]>([]);
  const pufferSpikes = useRef<(THREE.InstancedMesh | null)[]>([]);
  /** 가시마다 자리 · 방향(복어 자기 좌표) — 한 번 재 두고 부풀기만 바꾼다 */
  const spikeFrames = useMemo(
    () => built.spikes.map((dir) => ({ p: new THREE.Vector3(dir.x * 0.066, dir.y * 0.058, dir.z * 0.08), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir) })),
    [built],
  );
  const lastPuff = useRef<number[]>([]);
  const crabRefs = useRef<(THREE.Group | null)[]>([]);
  const crabClaws = useRef<(THREE.Group | null)[]>([]);
  const crabLegs = useRef<(THREE.Group | null)[]>([]);
  const eelRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flounderRefs = useRef<(THREE.Group | null)[]>([]);
  const stonefishRefs = useRef<(THREE.Group | null)[]>([]);
  /** 지금 덤비는 오징어 · 문어(한 마리) · 마지막 공격이 끝난 때 */
  const attacker = useRef<Mover | null>(null);
  const lastAttackEnd = useRef(-1e9);

  useFrame((_, rawDt) => {
    if (!isShown) return;
    const dt = Math.min(rawDt, 0.05);
    const time = performance.now() / 1000;
    built.time.value = time;
    const px = camera.position.x / M;
    const py = camera.position.y / M;
    const pz = camera.position.z / M;
    const near = getUnderwater();
    const { random, inkState, ink } = built;
    const distTo = (p: THREE.Vector3) => Math.hypot(p.x - px, p.z - pz);
    const awayFrom = (p: THREE.Vector3, out: THREE.Vector3) => out.set(p.x - px, 0, p.z - pz).normalize();
    /** 먹물 한 번 — dir 은 뿜는 쪽의 반대(몸 → 사람이면 사람 쪽으로 날아간다). 얼굴에 대고 뿜을 땐 더 세게 */
    const squirt = (at: THREE.Vector3, dir: THREE.Vector3, atFace = false) => {
      const push = atFace ? 2.6 : 1;
      for (let n = 0; n < INK_PUFF; n++) {
        const k = inkState.next;
        inkState.next = (inkState.next + 1) % INK.count;
        inkState.pos[k].copy(at);
        inkState.vel[k].set(
          -dir.x * (0.5 + random()) * push + (random() - 0.5) * 0.7,
          -dir.y * (0.5 + random()) * push + (random() - 0.3) * 0.5,
          -dir.z * (0.5 + random()) * push + (random() - 0.5) * 0.7,
        );
        inkState.age[k] = random() * 0.15;
      }
    };
    const scratch = new THREE.Vector3();
    const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    /**
     * 먹물 공격 — 가까이 가면 사람 눈앞으로 헤엄쳐 와 얼굴에 대고 뿜는다(뿜는 모습이 보이게). 한 번 뿜고 달아난다.
     * 공격 중이면 true — 그동안은 제 헤엄 대신 이걸 따른다
     */
    const inkAttack = (m: Mover, d: number) => {
      if (m.inkDue >= 0 && time >= m.inkDue) {
        m.inkDue = -1;
        if (near) {
          hurtBreath(INK_DAMAGE, "ink");
          showNotice(`먹물을 뒤집어썼다 — 숨이 ${INK_DAMAGE} 줄었다.`, 2.4);
        }
      }
      if (m.shotsLeft <= 0) {
        // 한 번에 한 마리만 덤빈다 — 여럿이 같이 뿜으면 숨이 순식간에 바닥난다
        if (!getInkArmed() || attacker.current || time - lastAttackEnd.current < INK_ATTACK.rest || !near || d > INK_ATTACK.trigger || time - m.scaredAt < INK_ATTACK.rest) return false;
        attacker.current = m;
        m.shotsLeft = INK_ATTACK.shots;
        m.nextShot = time + 0.7;
      }
      // 사람이 멀리 달아나면(제 굴에서 너무 멀어지면) 그만둔다
      if (!near || d > INK_ATTACK.giveUp || m.pos.distanceTo(m.home) > INK_ATTACK.giveUp) {
        m.shotsLeft = 0;
        m.scaredAt = time;
        attacker.current = null;
        return false;
      }
      // 눈앞 자리 — 바라보는 쪽으로 한 걸음, 눈높이 조금 아래
      const spot = scratch.set(px + forward.x * INK_ATTACK.front, py - 0.1, pz + forward.z * INK_ATTACK.front);
      m.pos.lerp(spot, 1 - Math.exp(-dt * 4.5));
      m.vel.set(0, 0, 0);
      m.heading = Math.atan2(px - m.pos.x, pz - m.pos.z);
      if (time >= m.nextShot && m.pos.distanceTo(spot) < 0.4) {
        const away = new THREE.Vector3(m.pos.x - px, m.pos.y - py, m.pos.z - pz).normalize();
        squirt(m.pos, away, true);
        audio.play("첨벙");
        m.inkDue = time + INK_ATTACK.travel;
        m.shotsLeft -= 1;
        m.nextShot = time + INK_ATTACK.between;
        // 뿜은 힘에 살짝 뒤로 밀린다
        m.pos.addScaledVector(away, 0.25);
        if (m.shotsLeft <= 0) {
          // 다 뿜었으면 내뺀다 — 다른 녀석은 쉬었다가 덤빈다
          m.scaredAt = time;
          attacker.current = null;
          lastAttackEnd.current = time;
          m.vel.copy(away.setY(0).normalize()).multiplyScalar(3.2);
          m.vel.y = 0.4;
          return false;
        }
      }
      return true;
    };

    // ── 오징어 — 떠 있다가 이따금 쭉. 가까이 오면 먹물 + 내뺌 ──
    built.movers.squids.forEach((m, i) => {
      const group = squidRefs.current[i];
      if (!group) return;
      const d = distTo(m.pos);
      const sinceScare = time - m.scaredAt;
      const attacking = inkAttack(m, d);
      m.until -= dt;
      if (!attacking && m.until <= 0 && sinceScare > 2) {
        m.until = 2.5 + random() * 2.5;
        m.target.set(m.home.x + (random() - 0.5) * 3, m.home.y + (random() - 0.5) * 0.8, m.home.z + (random() - 0.5) * 3);
        // 쭉 — 몸을 뻗어 한 번에 나아간다
        m.vel.add(scratch.subVectors(m.target, m.pos).normalize().multiplyScalar(0.9));
      }
      m.vel.multiplyScalar(Math.exp(-dt * 1.4));
      m.pos.addScaledVector(m.vel, dt);
      m.pos.y = THREE.MathUtils.clamp(m.pos.y, floorY(m.pos.x, m.pos.z) + 0.6, SURFACE_Y - 0.5);
      const speed = m.vel.length();
      if (!attacking && speed > 0.05) m.heading += (Math.atan2(m.vel.x, m.vel.z) - m.heading) * Math.min(1, dt * 3);
      group.position.copy(m.pos);
      group.rotation.set(0, m.heading, 0);
      // 지느러미 펄럭 · 다리 오므렸다 폈다(빠를수록 모인다)
      const pump = 1 - Math.min(0.35, speed * 0.25);
      group.scale.set(pump, pump, 1 + (1 - pump) * 0.6);
      const arms = squidArms.current[i];
      if (arms) arms.children.forEach((arm, k) => (arm.rotation.x = Math.sin(time * 3 + k) * 0.18 * (1 - Math.min(1, speed))));
    });

    // ── 문어 — 바닥에서 꿈틀. 가까이 오면 먹물 + 솟구쳤다 내려앉는다 ──
    const matrix = new THREE.Matrix4();
    const segmentPos = new THREE.Vector3();
    const segmentScale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    built.movers.octopi.forEach((m, i) => {
      const group = octoRefs.current[i];
      const segments = octoSegments.current[i];
      if (!group || !segments) return;
      const d = distTo(m.pos);
      const attacking = inkAttack(m, d);
      const since = time - m.scaredAt;
      const ground = floorY(m.pos.x, m.pos.z);
      if (attacking) {
        // 눈앞에 떠 있는 동안은 inkAttack 이 자리를 잡는다
      } else if (since < 2.4) {
        m.vel.y -= 1.1 * dt;
      } else {
        m.vel.multiplyScalar(Math.exp(-dt * 3));
        // 천천히 집(바위 곁)으로 기어 돌아간다
        m.vel.x += (m.home.x - m.pos.x) * 0.15 * dt;
        m.vel.z += (m.home.z - m.pos.z) * 0.15 * dt;
      }
      m.vel.x *= Math.exp(-dt * 0.8);
      m.vel.z *= Math.exp(-dt * 0.8);
      m.pos.addScaledVector(m.vel, dt);
      if (m.pos.y < ground) {
        m.pos.y = ground;
        m.vel.y = 0;
      }
      const swim = THREE.MathUtils.clamp((m.pos.y - ground) / 0.6, 0, 1);
      if (!attacking && Math.hypot(m.vel.x, m.vel.z) > 0.1) m.heading += (Math.atan2(m.vel.x, m.vel.z) - m.heading) * Math.min(1, dt * 4);
      group.position.copy(m.pos);
      group.rotation.y = m.heading;
      // 다리 여덟 × 마디 일곱 — 바닥에서는 둘레로 퍼져 꿈틀, 헤엄칠 때는 뒤(아래)로 모여 늘어진다
      let index = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (let j = 0; j < 7; j++) {
          const t = j / 6;
          const curl = Math.sin(time * 1.6 + k * 1.3 + j * 0.7) * 0.25 * t;
          const spreadR = 0.07 + t * 0.26;
          const spreadX = Math.cos(a + curl) * spreadR;
          const spreadZ = Math.sin(a + curl) * spreadR;
          const spreadY = 0.02 + Math.max(0, Math.sin(time * 1.2 + k + j)) * 0.03 * t + (t > 0.75 ? (t - 0.75) * 0.25 : 0);
          // 헤엄 자세 — 아래로 늘어지며 모인다
          const trailX = Math.cos(a) * (0.05 + t * 0.03);
          const trailZ = Math.sin(a) * (0.05 + t * 0.03) - t * 0.1;
          const trailY = -t * 0.32;
          segmentPos.set(THREE.MathUtils.lerp(spreadX, trailX, swim), THREE.MathUtils.lerp(spreadY, trailY, swim), THREE.MathUtils.lerp(spreadZ, trailZ, swim));
          const r = 0.026 * (1 - t * 0.75);
          segmentScale.setScalar(r);
          matrix.compose(segmentPos, quaternion, segmentScale);
          segments.setMatrixAt(index, matrix);
          const suckers = octoSuckers.current[i];
          if (suckers) {
            segmentPos.y -= r * 0.75;
            segmentScale.setScalar(r * 0.55);
            matrix.compose(segmentPos, quaternion, segmentScale);
            suckers.setMatrixAt(index, matrix);
          }
          index++;
        }
      }
      segments.instanceMatrix.needsUpdate = true;
      const suckerMesh = octoSuckers.current[i];
      if (suckerMesh) suckerMesh.instanceMatrix.needsUpdate = true;
      // 숨 쉬듯 머리가 오르내린다
      const head = group.children[0];
      if (head) head.scale.set(0.1, 0.13 + Math.sin(time * 1.8 + i) * 0.008, 0.11);
    });

    // ── 복어 — 둥실. 가까이 오면 가시 공으로 부푼다 ──
    built.movers.puffers.forEach((m, i) => {
      const group = pufferRefs.current[i];
      const body = pufferBodies.current[i];
      const spikes = pufferSpikes.current[i];
      if (!group || !body || !spikes) return;
      const d = Math.hypot(m.pos.x - px, m.pos.z - pz, (m.pos.y - py) * 0.5);
      if (near && d < 2.3 && time - m.scaredAt > 6) m.scaredAt = time;
      const since = time - m.scaredAt;
      const puff = since < 0.4 ? THREE.MathUtils.smoothstep(since / 0.4, 0, 1) : since < 4.6 ? 1 : since < 6 ? 1 - THREE.MathUtils.smoothstep((since - 4.6) / 1.4, 0, 1) : 0;
      m.until -= dt;
      if (m.until <= 0) {
        m.until = 3 + random() * 3;
        m.target.set(m.home.x + (random() - 0.5) * 1.8, m.home.y + (random() - 0.5) * 0.5, m.home.z + (random() - 0.5) * 1.8);
      }
      scratch.subVectors(m.target, m.pos);
      if (scratch.length() > 0.05) m.vel.lerp(scratch.normalize().multiplyScalar(0.22 * (1 - puff)), Math.min(1, dt * 1.5));
      m.pos.addScaledVector(m.vel, dt);
      // 부풀면 살짝 떠오른다
      group.position.set(m.pos.x, m.pos.y + puff * 0.12 + Math.sin(time * 1.4 + i) * 0.03, m.pos.z);
      if (m.vel.length() > 0.02 && puff < 0.5) m.heading += (Math.atan2(m.vel.x, m.vel.z) - m.heading) * Math.min(1, dt * 2);
      group.rotation.y = m.heading + puff * Math.sin(time * 0.8) * 0.4;
      // 부푼 가시에 붙으면 찔린다
      if (near && puff > 0.6 && time - m.hitAt > SPIKE_COOLDOWN && Math.hypot(m.pos.x - px, m.pos.y - (py - 0.3), m.pos.z - pz) < SPIKE_RADIUS) {
        m.hitAt = time;
        hurtBreath(SPIKE_DAMAGE, "spike");
        audio.play("똑");
        showNotice(`복어 가시에 찔렸다 — 숨이 ${SPIKE_DAMAGE} 줄었다.`, 2.6);
      }
      const bodyScale = 1 + puff * 1.15;
      body.scale.setScalar(bodyScale);
      spikes.scale.setScalar(bodyScale);
      // 부푼 정도가 바뀔 때만 가시 행렬을 다시 쓴다
      if (lastPuff.current[i] !== puff) {
        lastPuff.current[i] = puff;
        const spikeScale = new THREE.Vector3(0.6 + puff * 0.4, 0.08 + puff * 0.92, 0.6 + puff * 0.4);
        spikeFrames.forEach((frame, k) => {
          matrix.compose(frame.p, frame.q, spikeScale);
          spikes.setMatrixAt(k, matrix);
        });
        spikes.instanceMatrix.needsUpdate = true;
      }
    });

    // ── 참게 — 옆걸음. 가까이 오면 집게를 치켜들고 내뺀다 ──
    built.movers.crabs.forEach((m, i) => {
      const group = crabRefs.current[i];
      if (!group) return;
      const d = distTo(m.pos);
      const alarmed = near && d < 2.2;
      if (alarmed) m.scaredAt = time;
      const scared = time - m.scaredAt < 1.6;
      m.until -= dt;
      if (alarmed) {
        awayFrom(m.pos, scratch);
        m.target.set(m.pos.x + scratch.x * 1.5, 0, m.pos.z + scratch.z * 1.5);
      } else if (m.until <= 0) {
        m.until = 1.5 + random() * 3.5;
        m.target.set(m.home.x + (random() - 0.5) * 2.2, 0, m.home.z + (random() - 0.5) * 2.2);
      }
      scratch.set(m.target.x - m.pos.x, 0, m.target.z - m.pos.z);
      const far = scratch.length();
      const speed = far > 0.06 ? (scared ? 0.9 : 0.25) : 0;
      if (far > 0.06) scratch.normalize();
      m.vel.x += (scratch.x * speed - m.vel.x) * Math.min(1, dt * 6);
      m.vel.z += (scratch.z * speed - m.vel.z) * Math.min(1, dt * 6);
      m.pos.x += m.vel.x * dt;
      m.pos.z += m.vel.z * dt;
      m.pos.y = floorY(m.pos.x, m.pos.z);
      // 몸은 옆으로 걷는다 — 머리(+z)가 가는 쪽과 직각
      const moving = Math.hypot(m.vel.x, m.vel.z);
      if (moving > 0.05) m.heading += (Math.atan2(m.vel.x, m.vel.z) - Math.PI / 2 - m.heading) * Math.min(1, dt * 2);
      group.position.copy(m.pos);
      group.rotation.y = m.heading;
      const legs = crabLegs.current[i];
      if (legs) legs.children.forEach((leg, k) => (leg.rotation.x = Math.sin(time * 18 * Math.min(1, moving * 2) + k * 1.7) * 0.35 * Math.min(1, moving * 3)));
      const claws = crabClaws.current[i];
      if (claws) claws.rotation.x += ((scared ? -0.9 : 0) + Math.sin(time * 2 + i) * 0.05 - claws.rotation.x) * Math.min(1, dt * 8);
    });

    // ── 뱀장어 — 바닥 가까이 느릿느릿 ──
    built.movers.eels.forEach((m, i) => {
      const mesh = eelRefs.current[i];
      if (!mesh) return;
      m.until -= dt;
      const d = distTo(m.pos);
      if (near && d < 2) {
        awayFrom(m.pos, scratch);
        m.target.set(m.pos.x + scratch.x * 2, 0, m.pos.z + scratch.z * 2);
        m.until = 2;
      } else if (m.until <= 0) {
        m.until = 4 + random() * 4;
        m.target.set(m.home.x + (random() - 0.5) * 3, 0, m.home.z + (random() - 0.5) * 3);
      }
      scratch.set(m.target.x - m.pos.x, 0, m.target.z - m.pos.z);
      const speed = scratch.length() > 0.1 ? (near && d < 2 ? 0.7 : 0.22) : 0;
      if (scratch.lengthSq() > 0) scratch.normalize();
      m.vel.lerp(scratch.multiplyScalar(speed), Math.min(1, dt * 1.2));
      m.pos.addScaledVector(m.vel, dt);
      m.pos.y = floorY(m.pos.x, m.pos.z) + 0.1 + Math.sin(time * 0.7 + i) * 0.04;
      if (m.vel.length() > 0.03) m.heading += (Math.atan2(m.vel.x, m.vel.z) - m.heading) * Math.min(1, dt * 1.5);
      mesh.position.copy(m.pos);
      mesh.rotation.y = m.heading;
    });

    // ── 넙치 — 모래빛으로 엎드려 있다가 가까이 오면 제 빛깔이 드러나며 모래를 털고 미끄러져 달아난다 ──
    built.movers.flounders.forEach((m, i) => {
      const group = flounderRefs.current[i];
      if (!group) return;
      if (near && distTo(m.pos) < 1.8 && time - m.scaredAt > 5) {
        m.scaredAt = time;
        awayFrom(m.pos, scratch);
        m.vel.copy(scratch).multiplyScalar(1.4);
        stirSand(0.12);
      }
      const since = time - m.scaredAt;
      const reveal = since < 0.3 ? since / 0.3 : since < 2.5 ? 1 : Math.max(0, 1 - (since - 2.5) / 2.5);
      m.vel.multiplyScalar(Math.exp(-dt * 1.3));
      m.pos.addScaledVector(m.vel, dt);
      const ground = floorY(m.pos.x, m.pos.z);
      const swimming = Math.min(1, m.vel.length() * 2);
      m.pos.y = ground + 0.015 + swimming * 0.12;
      if (m.vel.length() > 0.05) m.heading += (Math.atan2(m.vel.x, m.vel.z) - m.heading) * Math.min(1, dt * 3);
      group.position.copy(m.pos);
      group.rotation.set(0, m.heading, 0);
      // 헤엄칠 땐 몸 가장자리가 물결친다
      const fringe = group.children[1];
      if (fringe) fringe.scale.set(0.24, 0.012 + Math.sin(time * 9) * 0.004 * swimming, 0.15 + Math.sin(time * 9 + 1) * 0.01 * swimming);
      built.mats.flounder[i].color.copy(SAND_CAMO).lerp(FLOUNDER_TRUE, reveal);
    });
    // ── 쏨뱅이 — 바위빛으로 웅크려 있다가 가까이 오면 지느러미를 펼치고 빛깔이 드러난다 ──
    built.movers.stonefish.forEach((m, i) => {
      const group = stonefishRefs.current[i];
      if (!group) return;
      if (near && distTo(m.pos) < 1.6) m.scaredAt = time;
      const since = time - m.scaredAt;
      const reveal = since < 0.4 ? since / 0.4 : since < 3 ? 1 : Math.max(0, 1 - (since - 3) / 3);
      group.position.copy(m.pos);
      group.position.y += reveal * 0.05;
      group.rotation.set(0, m.heading + Math.sin(time * 0.5 + i) * 0.1, 0);
      const fins = group.children[2];
      if (fins) fins.scale.setScalar(0.25 + reveal * 0.75 + Math.sin(time * 6) * 0.05 * reveal);
      built.mats.stonefish[i].color.copy(ROCK_CAMO).lerp(STONEFISH_TRUE, reveal);
    });

    // ── 멸치 떼 · 둘째 피라미 떼 — 중심이 어슬렁, 마리마다 그 둘레를 돈다. 사람을 피해 흩어진다 ──
    const look = new THREE.Matrix4();
    const zero = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const turn = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2);
    const fishScale = new THREE.Vector3();
    const runSchool = (school: typeof built.minnow, size: number, roam: { x: number[]; z: number[] }, wander: number) => {
      const c = school.center;
      const d = distTo(c.pos);
      const flee = near && d < 3.2;
      c.until -= dt;
      if (flee) {
        awayFrom(c.pos, scratch);
        c.target.set(c.pos.x + scratch.x * 3, c.pos.y, c.pos.z + scratch.z * 3);
      } else if (c.until <= 0) {
        c.until = 3 + random() * 4;
        c.target.set(THREE.MathUtils.lerp(roam.x[0], roam.x[1], random()), FLOOR_Y + 1.1 + random() * 1.8, THREE.MathUtils.lerp(roam.z[0], roam.z[1], random()));
      }
      scratch.subVectors(c.target, c.pos);
      if (scratch.length() > 0.05) c.vel.lerp(scratch.normalize().multiplyScalar(flee ? 1.6 : wander), Math.min(1, dt * 1.5));
      c.pos.addScaledVector(c.vel, dt);
      c.pos.x = THREE.MathUtils.clamp(c.pos.x, roam.x[0], roam.x[1]);
      c.pos.z = THREE.MathUtils.clamp(c.pos.z, roam.z[0], roam.z[1]);
      school.fish.forEach((f, k) => {
        f.a += dt * f.speed * (flee ? 2.2 : 1);
        const spread = flee ? 1.8 : 1;
        scratch.set(c.pos.x + Math.cos(f.a) * f.r * spread, c.pos.y + f.y * spread + Math.sin(f.a * 2) * 0.05, c.pos.z + Math.sin(f.a) * f.r * spread);
        f.vel.subVectors(scratch, f.pos).multiplyScalar(Math.min(1, dt * 6) / Math.max(dt, 1e-3));
        f.pos.lerp(scratch, Math.min(1, dt * 6));
        f.pos.y = Math.max(f.pos.y, floorY(f.pos.x, f.pos.z) + 0.3);
        if (f.vel.lengthSq() > 1e-4) {
          look.lookAt(zero, f.vel, up);
          quaternion.setFromRotationMatrix(look).multiply(turn);
        }
        fishScale.setScalar(size * M);
        matrix.compose(scratch.copy(f.pos).multiplyScalar(M), quaternion, fishScale);
        school.mesh.setMatrixAt(k, matrix);
      });
      school.mesh.instanceMatrix.needsUpdate = true;
    };
    built.anchovies.forEach((school, i) => {
      const [x, z] = ANCHOVY_SCHOOLS[i];
      runSchool(school, 0.075, { x: [x - 3, x + 3], z: [z - 3, z + 3] }, 0.7);
    });
    runSchool(built.minnow, SPECIES[0].size, MINNOW_REGION, 0.55);

    // ── 먹물 — 뿜어진 뒤 퍼지며 옅어진다 ──
    for (let k = 0; k < INK.count; k++) {
      inkState.age[k] += dt;
      const age = inkState.age[k];
      if (age > INK.life) {
        ink.alpha.setX(k, 0);
        continue;
      }
      inkState.vel[k].multiplyScalar(Math.exp(-dt * 1.8));
      inkState.vel[k].y += 0.05 * dt;
      inkState.pos[k].addScaledVector(inkState.vel[k], dt);
      const p = inkState.pos[k];
      ink.position.setXYZ(k, p.x * M, p.y * M, p.z * M);
      const t = age / INK.life;
      ink.size.setX(k, 0.12 + t * 0.55);
      ink.alpha.setX(k, 0.95 * (1 - t * t) * Math.min(1, age * 8));
      ink.color.setXYZ(k, 0.02, 0.018, 0.024);
    }
    ink.commit();
    ink.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  });

  if (!isShown) return null;
  const { mats, geo } = built;
  return (
    <>
      <group scale={M}>
        {/* 오징어 */}
        {SQUIDS.map((_, i) => (
          <group
            key={`squid-${i}`}
            ref={(g) => {
              squidRefs.current[i] = g;
            }}
          >
            <mesh geometry={geo.mantle} material={mats.squid} scale={[0.72, 0.68, 1.15]} castShadow />
            {[0.05, 0.11, 0.17, 0.23, 0.29, 0.35].map((z, k) => (
              <mesh key={k} geometry={geo.sphere} material={mats.squidSpot} position={[0.026 * (k % 2 ? 1 : -1), 0.034, z]} scale={[0.007, 0.004, 0.009]} />
            ))}
            {/* 화살촉 지느러미 — 몸 끝을 감싼다(문어엔 없다) */}
            <mesh geometry={geo.squidFin} material={mats.fin} position={[0, 0, 0.06]} />
            <mesh geometry={geo.sphere} material={mats.squid} position={[0, 0, -0.035]} scale={[0.038, 0.034, 0.045]} />
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 0.036, 0.006, -0.035]}>
                <mesh geometry={geo.sphere} material={mats.eyeWhite} scale={0.017} />
                <mesh geometry={geo.sphere} material={mats.eye} position={[side * 0.006, 0, 0]} scale={0.011} />
              </group>
            ))}
            <group
              ref={(g) => {
                squidArms.current[i] = g;
              }}
              position={[0, 0, -0.06]}
            >
              {Array.from({ length: 8 }, (_, k) => {
                const a = (k / 8) * Math.PI * 2;
                return <mesh key={k} geometry={geo.arm} material={mats.squid} position={[Math.cos(a) * 0.025, Math.sin(a) * 0.025, 0]} rotation={[0, Math.cos(a) * 0.25, 0]} />;
              })}
              {[-1, 1].map((side) => (
                <mesh key={`t${side}`} geometry={geo.tentacle} material={mats.squid} position={[side * 0.015, -0.01, 0]} rotation={[0.1, side * 0.12, 0]} />
              ))}
            </group>
          </group>
        ))}
        {/* 문어 */}
        {OCTOPI.map((_, i) => (
          <group
            key={`octo-${i}`}
            ref={(g) => {
              octoRefs.current[i] = g;
            }}
          >
            <mesh geometry={geo.sphere} material={mats.octopus} position={[0, 0.17, 0.05]} scale={[0.1, 0.13, 0.11]} castShadow />
            {/* 머리 오돌토돌 · 짙은 얼룩(오징어와 다른 맨눈 구별점) */}
            {[[0.05, 0.25, 0.06], [-0.05, 0.22, 0.1], [0.02, 0.27, 0.12], [-0.03, 0.15, 0.15], [0.06, 0.14, 0.13], [-0.07, 0.19, 0.03]].map(([x, y, z], k) => (
              <mesh key={k} geometry={geo.sphere} material={k % 2 ? mats.octopusDark : mats.octopus} position={[x, y, z]} scale={k % 2 ? [0.02, 0.012, 0.02] : 0.016} />
            ))}
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 0.06, 0.12, -0.06]}>
                <mesh geometry={geo.sphere} material={mats.octopusPale} scale={0.022} />
                <mesh geometry={geo.sphere} material={mats.eye} position={[0, 0, -0.015]} scale={[0.012, 0.006, 0.01]} />
              </group>
            ))}
            <instancedMesh
              ref={(m) => {
                octoSegments.current[i] = m;
              }}
              args={[geo.sphere, mats.octopus, 56]}
              frustumCulled={false}
              castShadow
            />
            {/* 빨판 — 다리 밑에 붙은 옅은 알(마디와 같은 자리를 조금 아래로) */}
            <instancedMesh
              ref={(m) => {
                octoSuckers.current[i] = m;
              }}
              args={[geo.sphere, mats.octopusPale, 56]}
              frustumCulled={false}
            />
          </group>
        ))}
        {/* 복어 */}
        {PUFFERS.map((_, i) => (
          <group
            key={`puffer-${i}`}
            ref={(g) => {
              pufferRefs.current[i] = g;
            }}
          >
            <group
              ref={(g) => {
                pufferBodies.current[i] = g;
              }}
            >
              <mesh geometry={geo.sphere} material={mats.puffer} scale={[0.07, 0.06, 0.085]} castShadow />
              <mesh geometry={geo.sphere} material={mats.pufferBelly} position={[0, -0.022, 0.005]} scale={[0.058, 0.04, 0.072]} />
              {[[0.03, 0.035, 0.02], [-0.035, 0.03, -0.01], [0.01, 0.045, -0.035], [-0.02, 0.04, 0.035]].map(([x, y, z], k) => (
                <mesh key={k} geometry={geo.sphere} material={mats.pufferSpot} position={[x, y, z]} scale={0.009} />
              ))}
              {[-1, 1].map((side) => (
                <mesh key={side} geometry={geo.sphere} material={mats.eye} position={[side * 0.04, 0.02, 0.06]} scale={0.011} />
              ))}
              <mesh geometry={geo.tail} material={mats.fin} position={[0, 0, -0.095]} rotation={[0, Math.PI / 2, 0]} />
              <mesh geometry={geo.sphere} material={mats.pufferSpot} position={[0, -0.006, 0.084]} scale={[0.012, 0.008, 0.006]} />
              {[-1, 1].map((side) => (
                <mesh key={`p${side}`} geometry={geo.tail} material={mats.fin} position={[side * 0.068, -0.005, 0.02]} rotation={[0, side * 0.4, 0]} scale={0.55} />
              ))}
            </group>
            {/* 가시 74개 — 한 번에 그린다(따로 그리면 복어 셋에 222 드로우) */}
            <instancedMesh
              ref={(m) => {
                pufferSpikes.current[i] = m;
              }}
              args={[geo.spike, mats.spike, built.spikes.length]}
              frustumCulled={false}
            />
          </group>
        ))}
        {/* 불가사리 */}
        {built.stars.map((s, i) => (
          <mesh key={`star-${i}`} geometry={geo.star} material={mats.starfish[s.material]} position={[s.x, floorY(s.x, s.z) + 0.006, s.z]} rotation={[0, s.yaw, 0]} scale={s.size} receiveShadow />
        ))}
        {/* 참게 */}
        {CRABS.map((_, i) => (
          <group
            key={`crab-${i}`}
            ref={(g) => {
              crabRefs.current[i] = g;
            }}
          >
            <group position={[0, 0.06, 0]}>
              <mesh geometry={geo.sphere} material={mats.crab} scale={[0.085, 0.032, 0.068]} castShadow />
              <mesh geometry={geo.sphere} material={mats.crabDark} position={[0, 0.012, -0.01]} scale={[0.07, 0.024, 0.05]} />
              {[-1, 1].map((side) => (
                <mesh key={side} geometry={geo.sphere} material={mats.eye} position={[side * 0.025, 0.04, 0.055]} scale={0.009} />
              ))}
              <group
                ref={(g) => {
                  crabLegs.current[i] = g;
                }}
              >
                {[-1, 1].flatMap((side) =>
                  [0, 1, 2, 3].map((k) => (
                    <mesh key={`${side}-${k}`} geometry={geo.leg} material={mats.crabDark} position={[side * 0.075, 0, 0.03 - k * 0.022]} rotation={[0, 0, side * 0.9]} />
                  )),
                )}
              </group>
              <group
                ref={(g) => {
                  crabClaws.current[i] = g;
                }}
                position={[0, 0, 0.06]}
              >
                {[-1, 1].map((side) => (
                  <group key={side} position={[side * 0.05, 0, 0.02]} rotation={[0, side * -0.4, 0]}>
                    <mesh geometry={geo.sphere} material={mats.crabClaw} position={[0, 0, 0.02]} scale={[0.012, 0.012, 0.03]} />
                    <mesh geometry={geo.claw} material={mats.crabClaw} position={[0, 0.005, 0.055]} />
                  </group>
                ))}
              </group>
            </group>
          </group>
        ))}
        {/* 넙치 — 모래빛 납작한 몸 · 가장자리 지느러미 · 위로 몰린 두 눈 */}
        {FLOUNDERS.map((_, i) => (
          <group
            key={`flounder-${i}`}
            ref={(g) => {
              flounderRefs.current[i] = g;
            }}
          >
            <mesh geometry={geo.sphere} material={mats.flounder[i]} scale={[0.17, 0.022, 0.11]} receiveShadow />
            <mesh geometry={geo.sphere} material={mats.flounder[i]} scale={[0.24, 0.012, 0.15]} />
            {[-1, 1].map((side) => (
              <mesh key={side} geometry={geo.sphere} material={mats.eye} position={[0.03 + side * 0.015, 0.02, 0.07]} scale={0.011} />
            ))}
          </group>
        ))}
        {/* 쏨뱅이 — 바위빛 울퉁불퉁한 몸, 놀라면 부채 지느러미를 편다 */}
        {STONEFISH.map((_, i) => (
          <group
            key={`stonefish-${i}`}
            ref={(g) => {
              stonefishRefs.current[i] = g;
            }}
          >
            <mesh geometry={geo.sphere} material={mats.stonefish[i]} position={[0, 0.06, 0]} scale={[0.09, 0.07, 0.15]} castShadow />
            <group>
              {[[0.04, 0.11, 0.05], [-0.05, 0.1, -0.02], [0.02, 0.12, -0.06], [-0.03, 0.09, 0.08]].map(([x, y, z], k) => (
                <mesh key={k} geometry={geo.sphere} material={mats.stonefish[i]} position={[x, y, z]} scale={0.03} />
              ))}
              {[-1, 1].map((side) => (
                <mesh key={side} geometry={geo.sphere} material={mats.eye} position={[side * 0.04, 0.1, 0.11]} scale={0.01} />
              ))}
            </group>
            <group position={[0, 0.07, 0]}>
              {[-1, 1].map((side) => (
                <mesh key={side} geometry={geo.tail} material={mats.stonefish[i]} position={[side * 0.1, 0, 0.03]} rotation={[0, side * Math.PI / 2, 0]} scale={2.2} />
              ))}
            </group>
          </group>
        ))}
        {/* 뱀장어 */}
        {EELS.map((_, i) => (
          <mesh
            key={`eel-${i}`}
            ref={(m) => {
              eelRefs.current[i] = m;
            }}
            geometry={geo.eel}
            material={built.eelMaterials[i]}
            castShadow
          />
        ))}
      </group>
      {built.anchovies.map((school, i) => (
        <primitive key={`anchovy-${i}`} object={school.mesh} />
      ))}
      <primitive object={built.minnow.mesh} />
      <primitive object={built.ink.points} />
    </>
  );
}
