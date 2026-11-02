/**
 * 바람 장막 — 증언 능선(Z4)에 들어서면 바람이 미친 듯이 휘몰아쳐 안개가 걷히고, 5 초 뒤 하늘이 소용돌이로 닫히며
 * 장막이 내려와 능선을 위·옆 통째로 덮는다. 엇갈린 두 돌새가 그날 밤부터 붙들고 있던 바람이다.
 *   갇힌 동안: 장막이 바람결대로 천천히 흐르고, 부딪힌 자리에서 물결치며, 돌멩이가 허공에 떠 있다.
 *   장막 안은 바람이 몸을 떠받쳐 달 위처럼 높이 뛴다(movement/gravityField) — 떠오른 수레바퀴를 붙잡는 데 쓴다.
 * 깨어난 새가 장막을 뚫고 나가는 순간, 뚫린 자리부터 양쪽으로 찢어지고 지붕은 가운데부터 열리며 위로 풀려 흩어진다.
 * 장막이 쳐져 있는 동안 밖으로는 못 나간다(movement/stageGates 가 ridge.isConfining 을 본다).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { TOON_GRADIENT } from "@/engine/toon";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { gravityField } from "../../movement/gravityField";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { focus } from "../../scene/immersion/focusFog";
import { M, groundY, makeGlowPoints, pointScaleFor } from "../fishTrap/shared";
import { showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { fishTrapPuzzle } from "../fishTrap/fishTrapState";
import { CURTAIN, CURTAIN_PERIMETER, RIDGE_CENTER, curtainPoint, isInsideCurtain } from "./ridgeShape";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";

const SEGMENTS = 220;
const ROWS = 14;
const LID_RINGS = 18;
/** 지붕이 가운데서 솟는 높이(m) — 하늘이 둥글게 닫힌 것으로 보이게 */
const DOME = 4;
/** 장막 밑동을 땅 밑으로 묻는 깊이(m) — 바깥 비탈에서 밑이 뜨지 않게 */
const SINK = 2.5;
/** 들어선 뒤 바람만 부는 시간 → 지붕이 닫히고 → 벽이 내려온다(초) */
const WIND_ONLY = 5;
const LID_SECONDS = 2.2;
const DROP_START = WIND_ONLY + 1.2;
const DROP_SECONDS = 3.2;
const SEALED_AT = DROP_START + DROP_SECONDS + 0.4;
/** 장막이 찢어져 풀리는 시간(초) */
const RELEASE_SECONDS = 7;
/** 장막 안 중력 배율 — 점프 힘 1.1 배와 함께 0.55 m → 약 3 m(물속 헤엄 1.1 m 의 세 배쯤), 떠 있는 시간 약 3.6 초 */
const LOW_GRAVITY = 0.215;
/** 바람이 잦아들면(장승 고리를 맞추면) 중력이 이만큼 더 붙는다 — 그래도 맨땅보다는 높이 뛴다 · 등짐을 지면 무거워 덜 뛴다 */
const CALM_GRAVITY = 0.95;
const LOAD_GRAVITY = 1.2;
/** 가벼운 곳으로 치는 중력 배율의 끝(gravityField.isLight 0.5 아래) — 잦아들고 등짐을 져도 맨땅보다는 높이 뛰게 */
const LIGHTEST_CAP = 0.46;
/** 잦아들면 떠다니는 것이 이만큼 낮아지고 · 느려진다 */
const CALM_LOWER = 0.55;
const CALM_SLOWER = 0.6;
const DEBRIS = 160;
const FLOATERS = 46;
const LEAVES = 40;
const TWIGS = 16;
/** 장막 안 걸음 배율(바람을 헤친다) · 등짐 배율 — 물속(0.52)보다는 가볍게 */
const CURTAIN_SPEED = 0.8;
const LOAD_SPEED = { none: 1, jige: 0.9, jigeChest: 0.72 };
/** 떠다니는 것이 몸에서 떨어져 있는 틈(m) · 몸을 막는 크기 아래쪽 한계(이보다 작은 돌은 비켜 가기만) */
const BODY_CLEARANCE = 0.42;
const SOLID_MIN_SIZE = 0.08;
/** 눈에서 발까지 · 눈 위 머리(m) */
const EYE = 1.25;
const HEAD = 0.15;
/** 바람에 들려 떠다니는 물건 — 미르 라이브러리·코드 소품에서 능선에 있을 법한 것들. size 는 가장 긴 변(m) */
const FLOATING_PROPS: { url: string; size: number }[] = [
  { url: "codeprops/broken-branch.glb", size: 0.9 },
  { url: "codeprops/broken-branch.glb", size: 0.6 },
  { url: "codeprops/straw-shoes.glb", size: 0.28 },
  { url: "codeprops/wooden-tags-string.glb", size: 0.5 },
  { url: "codeprops/white-cloth-folded.glb", size: 0.45 },
  { url: "codeprops/rope-broken.glb", size: 0.7 },
  { url: "lib/ast-prop-straw-broom-01.glb", size: 0.75 },
  { url: "lib/ast-prop-wooden-clogs-02.glb", size: 0.26 },
  { url: "lib/ast-prop-wanggol-crane-cushion-01.glb", size: 0.5 },
  { url: "lib/ast-prop-straw-broom-01.glb", size: 0.55 },
];

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const WALL_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aV;
  attribute vec2 aN;
  uniform float uRelease;
  uniform float uTime;
  uniform vec3 uHit;
  uniform float uPerimeter;
  uniform float uHeight;
  uniform float uUnit;
  varying float vT;
  varying float vV;
  varying float vRipple;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vT = aT;
    vV = aV;
    vec3 p = position;
    // touch ripple: rings spreading from where the player pushed against the curtain
    float along = abs(fract(aT - uHit.x + 0.5) - 0.5) * uPerimeter;
    float dist = length(vec2(along, aV * uHeight - uHit.y));
    float age = uTime - uHit.z;
    vRipple = sin(dist * 2.6 - age * 11.0) * exp(-dist * 0.45) * exp(-age * 1.1) * step(0.0, age);
    // the touched spot bulges in
    float inward = vRipple * 0.35;
    p.xz -= aN * inward * uUnit;
    // unravel: what is left of the curtain lifts away as it frays
    p.y += uRelease * uRelease * 22.0 * aV * uUnit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const WALL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uDrop;
  uniform float uRelease;
  uniform float uReleaseT;
  varying float vT;
  varying float vV;
  varying float vRipple;
  #include <logdepthbuf_pars_fragment>
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    // falling: the lower edge of the curtain comes down from the sky, rippling
    float edge = 1.0 - uDrop * 1.05 + 0.025 * sin(vT * 140.0 + uTime * 4.0) + 0.04 * (noise(vec2(vT * 60.0, uTime * 0.8)) - 0.5);
    float fall = smoothstep(edge - 0.015, edge + 0.05, vV);
    // tearing: opens from where the birds broke through and runs both ways round the ridge
    float d = abs(fract(vT - uReleaseT + 0.5) - 0.5);
    float frayed = uRelease * 0.62 + 0.035 * (noise(vec2(vV * 18.0, vT * 40.0 + uTime)) - 0.5);
    float tear = smoothstep(frayed - 0.01, frayed + 0.03, d);
    // wind: long thin streaks racing round the ridge
    float flow = vT * 170.0 - uTime * 9.0;
    float gust = noise(vec2(vT * 25.0 - uTime * 1.3, vV * 2.5));
    float streak = smoothstep(0.62, 0.92, noise(vec2(flow * 0.1, vV * 70.0 + gust * 4.0)));
    float threads = pow(abs(sin(vV * 52.0 + gust * 6.0 + sin(flow * 0.05) * 1.8)), 40.0);
    float veil = 0.08 + 0.09 * gust;
    float fade = smoothstep(0.0, 0.06, vV);
    float front = exp(-abs(d - frayed) * 70.0) * step(0.001, uRelease) * (1.0 - smoothstep(0.85, 1.0, uRelease));
    float ripple = abs(vRipple);
    float a = (veil + streak * 0.45 + threads * 0.3 + ripple * 0.5) * fade * fall * tear * (1.0 - uRelease * 0.6) + front * fade * fall * 0.9;
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.74, 0.71, 0.66), vec3(0.97, 0.94, 0.88), clamp(streak + threads * 0.5 + ripple, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.97, 0.9), clamp(front, 0.0, 1.0));
    gl_FragColor = vec4(col, min(a, 0.9));
  }
`;

const LID_VERTEX = /* glsl */ `
  attribute float aR;
  attribute float aT;
  uniform float uRelease;
  uniform float uUnit;
  varying float vR;
  varying float vT;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vR = aR;
    vT = aT;
    vec3 p = position;
    // the sky lifts away when released
    p.y += uRelease * uRelease * 14.0 * uUnit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const LID_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIris;
  uniform float uRelease;
  varying float vR;
  varying float vT;
  #include <logdepthbuf_pars_fragment>
  ${NOISE}
  void main() {
    #include <logdepthbuf_fragment>
    float r = max(vR, 0.015);
    float theta = vT * 6.2832;
    // a vortex: spiral arms winding into the eye above the ridge
    float spiral = theta * 3.0 + log(r) * 4.5 - uTime * 1.4;
    float arms = smoothstep(0.5, 0.95, noise(vec2(spiral * 1.3, r * 12.0 - uTime * 0.6)));
    float threads = pow(abs(sin(spiral * 5.0 + noise(vec2(theta * 4.0, r * 9.0)) * 2.0)), 26.0);
    float eye = exp(-abs(r - 0.13) * 38.0);
    // closing: the iris closes in from the rim to the eye
    float rim = 1.0 - uIris * 1.08 + 0.05 * (noise(vec2(theta * 6.0, uTime)) - 0.5);
    float iris = smoothstep(rim - 0.03, rim + 0.05, vR) * smoothstep(0.0, 0.06, uIris);
    // releasing: a hole opens from the eye outwards
    float hole = smoothstep(uRelease * 1.25 - 0.06, uRelease * 1.25 + 0.04, vR);
    float a = (0.1 + arms * 0.42 + threads * 0.25 + eye * 0.5) * iris * hole * (1.0 - uRelease * 0.4);
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.72, 0.69, 0.64), vec3(0.98, 0.95, 0.88), clamp(arms + threads * 0.6 + eye, 0.0, 1.0));
    gl_FragColor = vec4(col, min(a, 0.9));
  }
`;

function buildWallGeometry() {
  const positions: number[] = [];
  const ts: number[] = [];
  const vs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const p = { x: 0, z: 0, nx: 0, nz: 0 };
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    curtainPoint(t, p);
    const base = groundY(p.x, p.z) - SINK;
    const top = groundY(p.x, p.z) + CURTAIN.height;
    for (let j = 0; j <= ROWS; j++) {
      const v = j / ROWS;
      positions.push(p.x * M, (base + (top - base) * v) * M, p.z * M);
      ts.push(t);
      vs.push(v);
      normals.push(p.nx, p.nz);
    }
  }
  for (let i = 0; i < SEGMENTS; i++)
    for (let j = 0; j < ROWS; j++) {
      const a = i * (ROWS + 1) + j;
      const b = a + ROWS + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
  geometry.setAttribute("aV", new THREE.Float32BufferAttribute(vs, 1));
  geometry.setAttribute("aN", new THREE.Float32BufferAttribute(normals, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** 지붕 — 벽 윗변에서 가운데로 모이며 둥글게 솟는다 */
function buildLidGeometry() {
  const positions: number[] = [];
  const rs: number[] = [];
  const ts: number[] = [];
  const indices: number[] = [];
  const p = { x: 0, z: 0, nx: 0, nz: 0 };
  const centerTop = groundY(RIDGE_CENTER.x, RIDGE_CENTER.z) + CURTAIN.height;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    curtainPoint(t, p);
    const edgeTop = groundY(p.x, p.z) + CURTAIN.height;
    for (let j = 0; j <= LID_RINGS; j++) {
      const r = j / LID_RINGS;
      const x = RIDGE_CENTER.x + (p.x - RIDGE_CENTER.x) * r;
      const z = RIDGE_CENTER.z + (p.z - RIDGE_CENTER.z) * r;
      const y = centerTop + (edgeTop - centerTop) * r + DOME * (1 - r * r);
      positions.push(x * M, y * M, z * M);
      rs.push(r);
      ts.push(t);
    }
  }
  for (let i = 0; i < SEGMENTS; i++)
    for (let j = 0; j < LID_RINGS; j++) {
      const a = i * (LID_RINGS + 1) + j;
      const b = a + LID_RINGS + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aR", new THREE.Float32BufferAttribute(rs, 1));
  geometry.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
  geometry.setIndex(indices);
  return geometry;
}

/** 떠다니는 소품이 읽히면 셰이더를 미리 굽는 손 — 장막이 서면서 건다 */
let warmProp: ((holder: THREE.Object3D) => void) | null = null;

function createCurtain() {
  const shared = {
    uTime: { value: 0 },
    uRelease: { value: 0 },
    uUnit: { value: M },
  };
  const wallMaterial = new THREE.ShaderMaterial({
    vertexShader: WALL_VERTEX,
    fragmentShader: WALL_FRAGMENT,
    uniforms: {
      ...shared,
      uDrop: { value: 0 },
      uReleaseT: { value: 0 },
      uHit: { value: new THREE.Vector3(0, 0, -99) },
      uPerimeter: { value: CURTAIN_PERIMETER },
      uHeight: { value: CURTAIN.height + SINK },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lidMaterial = new THREE.ShaderMaterial({
    vertexShader: LID_VERTEX,
    fragmentShader: LID_FRAGMENT,
    uniforms: { ...shared, uIris: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wall = new THREE.Mesh(buildWallGeometry(), wallMaterial);
  const lid = new THREE.Mesh(buildLidGeometry(), lidMaterial);
  for (const mesh of [wall, lid]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
  }
  // 장막에 휘말린 흙먼지·잎 — 둘레를 따라 돌며 장막이 풀릴 때 위로 흩어진다
  const debris = makeGlowPoints(DEBRIS, { additive: false, softness: 1.4 });
  debris.points.visible = false;
  const seeds = Array.from({ length: DEBRIS }, () => ({
    t: Math.random(),
    height: Math.random(),
    speed: 0.012 + Math.random() * 0.02,
    out: (Math.random() - 0.5) * 1.6,
    size: 0.05 + Math.random() * 0.12,
    leaf: Math.random() < 0.35,
  }));
  // 허공에 뜬 돌멩이 — 장막 안은 몸도 돌도 가볍다. 풀리면 툭툭 떨어진다
  const floaters = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshToonMaterial({ color: "#8C857A", gradientMap: TOON_GRADIENT }),
    FLOATERS,
  );
  floaters.frustumCulled = false;
  floaters.visible = false;
  const floaterSeeds = Array.from({ length: FLOATERS }, () => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const x = RIDGE_CENTER.x + Math.cos(angle) * radius * 6;
    const z = RIDGE_CENTER.z + Math.sin(angle) * radius * 10;
    return {
      x,
      z,
      ground: groundY(x, z),
      height: 0.4 + Math.random() * 3.4,
      // 모래알만 한 것부터 주먹보다 큰 것까지 — 작은 것이 많게
      size: 0.025 + Math.random() ** 2.2 * 0.26,
      flat: Math.random() < 0.4 ? 0.35 + Math.random() * 0.3 : 1,
      phase: Math.random() * 10,
      spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()),
      fallY: 0,
      fallV: 0,
    };
  });
  // 나뭇잎 — 마름모 한 장, 빛깔이 제각각. 나뭇가지 — 가는 막대
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, -1, 0.45, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, -0.45, 0, 0], 3),
  );
  leafGeometry.computeVertexNormals();
  const leaves = new THREE.InstancedMesh(
    leafGeometry,
    new THREE.MeshToonMaterial({ color: "#FFFFFF", gradientMap: TOON_GRADIENT, side: THREE.DoubleSide }),
    LEAVES,
  );
  const leafTones = ["#5E7A3A", "#7C8F3E", "#A39A45", "#8A5E2E", "#6B7F4A"];
  for (let k = 0; k < LEAVES; k++) leaves.setColorAt(k, new THREE.Color(leafTones[k % leafTones.length]));
  const twigs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.7, 1, 5).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: "#5A4330", gradientMap: TOON_GRADIENT }),
    TWIGS,
  );
  const scatter = (count: number, sizes: [number, number], heights: [number, number]) =>
    Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random());
      const x = RIDGE_CENTER.x + Math.cos(angle) * radius * 6;
      const z = RIDGE_CENTER.z + Math.sin(angle) * radius * 10;
      return {
        x,
        z,
        ground: groundY(x, z),
        height: heights[0] + Math.random() * (heights[1] - heights[0]),
        size: sizes[0] + Math.random() * (sizes[1] - sizes[0]),
        phase: Math.random() * 10,
        spin: new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1),
        drift: 0.3 + Math.random() * 0.6,
        fallY: 0,
        fallV: 0,
      };
    });
  const leafSeeds = scatter(LEAVES, [0.05, 0.11], [0.5, 4.2]);
  const twigSeeds = scatter(TWIGS, [0.2, 0.55], [0.6, 3.6]);
  // 라이브러리 소품 — 읽히는 대로 하나씩 떠오른다
  const props = new THREE.Group();
  const propSeeds = scatter(FLOATING_PROPS.length, [1, 1], [1.0, 3.8]);
  const loader = createCompressedGltfLoader();
  FLOATING_PROPS.forEach((entry, k) => {
    const holder = new THREE.Group();
    holder.visible = false;
    props.add(holder);
    loader.load(
      `${import.meta.env.BASE_URL}_sf_local/${entry.url}`,
      (gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = (entry.size / Math.max(size.x, size.y, size.z, 1e-3)) * M;
        const center = box.getCenter(new THREE.Vector3());
        model.scale.setScalar(scale);
        model.position.copy(center).multiplyScalar(-scale);
        model.traverse((o) => (o.castShadow = true));
        holder.add(model);
        holder.userData.ready = true;
        // 소품은 장막이 칠 때 처음 보인다 — 읽히자마자 셰이더를 미리 굽는다
        warmProp?.(holder);
        propSeeds[k].size = entry.size;
      },
      undefined,
      (error) => console.warn("[WindCurtain] 떠다닐 소품을 못 읽었다:", entry.url, error),
    );
  });
  for (const mesh of [leaves, twigs]) {
    mesh.frustumCulled = false;
    mesh.visible = false;
  }
  return {
    wall,
    lid,
    wallMaterial,
    lidMaterial,
    shared,
    debris,
    seeds,
    floaters,
    floaterSeeds,
    leaves,
    leafSeeds,
    twigs,
    twigSeeds,
    props,
    propSeeds,
  };
}

/** 지금 단계에서 바람 세기 — 장막이 내려올 때 가장 세다 */
/** 바람 세기(소리 · 흔들림 배율) — 잦아들면(calm) 절반 가까이로 */
function windFor(stage: string, sinceStage: number, calm: number) {
  if (stage === "sealing") return sinceStage < SEALED_AT ? (sinceStage < WIND_ONLY ? 4.3 : 6) : 3.4;
  if (stage === "sealed" || stage === "awakening" || stage === "circling") return 2.6 - 1.75 * calm;
  return null;
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();

export default function WindCurtain() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const curtain = useMemo(() => createCurtain(), []);
  const stage = useRidgeStage();
  const release = useRef<{ startedAt: number; fromT: number } | null>(null);
  const windCueAt = useRef(-99);
  const windClock = useRef(0);
  /** 몸을 막는 떠다니는 돌 · 소품 — 매 장면 자리를 옮긴다 */
  const solids = useRef<{ floaters: (DynamicSolid | null)[]; props: DynamicSolid[] }>({ floaters: [], props: [] });
  const lastCalm = useRef(0);
  const told = useRef(false);

  useEffect(() => {
    const objects = [curtain.wall, curtain.lid, curtain.debris.points, curtain.floaters, curtain.leaves, curtain.twigs, curtain.props];
    scene.add(...objects);
    // 장막 · 떠다니는 것은 능선에 들어서야 처음 보인다 — 그 순간 셰이더를 굽느라 멈추지 않게 미리 굽는다
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, objects), 3000);
    warmProp = (holder) => prewarmShaders(gl, scene, camera, [holder]);
    for (const holder of curtain.props.children) if (holder.userData.ready) warmProp(holder);
    // 떠다니는 큰 돌 · 소품은 몸을 막는다(위에 서지는 못한다) — 뚫고 지나가지 않게
    const blocker = (): DynamicSolid => ({ x: 0, z: 0, yaw: 0, halfX: 0.1, halfZ: 0.1, bottom: 0, top: 0, enabled: false, walkable: false });
    solids.current = {
      floaters: curtain.floaterSeeds.map((f) => (f.size > SOLID_MIN_SIZE ? blocker() : null)),
      props: curtain.propSeeds.map(() => blocker()),
    };
    const removeSolids = [...solids.current.floaters, ...solids.current.props].filter((b): b is DynamicSolid => !!b).map(addDynamicSolid);
    // 장막 안은 몸이 가볍고, 바람을 헤치느라 걸음은 느리다. 등짐을 지면 더 느리다
    const isIn = (x: number, z: number) => ridge.isConfining() && isInsideCurtain(x, z);
    gravityField.scaleAt = (x, z) =>
      isIn(x, z)
        ? Math.min(LIGHTEST_CAP, LOW_GRAVITY * (1 + CALM_GRAVITY * ridgeQuest.calm) * (ridgeCarry.load === "none" ? 1 : LOAD_GRAVITY))
        : 1;
    gravityField.speedScaleAt = (x, z) => (isIn(x, z) ? CURTAIN_SPEED : 1) * LOAD_SPEED[ridgeCarry.load];
    return () => {
      window.clearTimeout(warm);
      warmProp = null;
      scene.remove(...objects);
      removeSolids.forEach((remove) => remove());
      gravityField.scaleAt = null;
      gravityField.speedScaleAt = null;
      focus.lift = 0;
    };
  }, [scene, curtain, gl, camera]);

  // 단계가 바뀌는 순간의 소리·안내
  useEffect(() => {
    if (stage === "sealing") {
      audio.play("우르릉");
      showNotice("바람이 미친 듯이 휘몰아친다 — 능선을 덮던 안개가 한꺼번에 걷힌다.", 4);
      const timers = [
        setTimeout(() => showNotice("하늘이 낮게 내려앉는다. 바람이 능선 위로 모여 소용돌이친다…", 3.5), 2600),
        setTimeout(() => {
          audio.play("징");
          director.cue({ 카메라: "흔들림", 세기: 0.3 });
        }, WIND_ONLY * 1000),
        setTimeout(() => {
          audio.play("우르릉");
          director.cue({ 카메라: "흔들림", 세기: 0.45 });
          showNotice("바람이 장막이 되어 능선을 위아래 통째로 덮었다 — 갇혔다.", 5);
        }, (DROP_START + DROP_SECONDS * 0.7) * 1000),
      ];
      return () => timers.forEach(clearTimeout);
    }
    if (stage === "sealed") {
      showNotice("몸이 이상하게 가볍다. 장막 안에선 바람이 몸을 떠받친다 — 힘껏 뛰면 높이 뜬다.", 5);
      const timer = setTimeout(
        () => showNotice("엇갈린 두 돌새가 그날 밤의 바람을 붙들고 있다. 둘의 눈이 한곳에 맞아야 장막이 걷힐 것 같다.", 6),
        6000,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [stage]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    const camera = state.camera;
    const now = ridge.stage();
    const since = ridge.elapsed();

    // ① 들어서면 시작 — 강변 비탈에서 능선 안쪽으로 2 m 넘게 들어섰을 때. 앞 스테이지(통발)를 건너뛴 시험은 받지 않는다
    if (now === "idle") {
      const x = camera.position.x / M;
      const z = camera.position.z / M;
      if (isInsideCurtain(x, z, 2) && camera.position.y / M > 7 && fishTrapPuzzle.stage() === "told") ridge.advance("sealing");
      return;
    }
    if (now === "sealing" && since > SEALED_AT) ridge.advance("sealed");

    // ② 바람·안개 — 장막이 있는 동안 안개를 걷어 바깥의 새 떼까지 보이게 한다
    // 잦아듦 — 장승 고리를 맞추면 몇 초에 걸쳐. 떠다니는 것은 이 시계로 움직여 느려져도 튀지 않는다
    ridgeQuest.calm += ((ridgeQuest.postsSolved ? 1 : 0) - ridgeQuest.calm) * (1 - Math.exp(-dt * 0.5));
    windClock.current += dt * (1 - CALM_SLOWER * ridgeQuest.calm);
    const wt = windClock.current;
    const lower = 1 - CALM_LOWER * ridgeQuest.calm;
    const wind = windFor(now, since, ridgeQuest.calm);
    // 잦아드는 동안은 바로바로 세기를 새로 건다
    const calmMoved = Math.abs(ridgeQuest.calm - lastCalm.current) > 0.05;
    if (wind !== null && (time - windCueAt.current > 3 || calmMoved)) {
      lastCalm.current = ridgeQuest.calm;
      windCueAt.current = time;
      director.cue({ 바람: wind, 초: 4 });
    }
    const liftTarget = now === "done" ? 0 : 1;
    focus.lift += (liftTarget - focus.lift) * (1 - Math.exp(-dt * (liftTarget > focus.lift ? 1.6 : 0.35)));

    // ③ 장막 — 지붕이 닫히고 · 벽이 내려오고 · 숨 쉬듯 조이고 · 찢어져 풀린다
    const s = curtain.shared;
    s.uTime.value = time;
    const iris = now === "sealing" ? THREE.MathUtils.smootherstep(since - WIND_ONLY, 0, LID_SECONDS) : 1;
    const drop = now === "sealing" ? THREE.MathUtils.smootherstep(since - DROP_START, 0, DROP_SECONDS) : 1;
    curtain.lidMaterial.uniforms.uIris.value = iris;
    curtain.wallMaterial.uniforms.uDrop.value = drop;

    // 갇힌 동안은 조이지 않는다 — 바람결이 장막을 따라 흐르기만 한다

    // 부딪힌 자리 물결 — 시각을 이 시계로 옮겨 넣는다
    const touch = ridge.lastTouch();
    const hitHeight = camera.position.y / M - (groundY(camera.position.x / M, camera.position.z / M) - SINK);
    curtain.wallMaterial.uniforms.uHit.value.set(touch.t, hitHeight, time - (performance.now() / 1000 - touch.at));

    const from = ridge.releaseFrom();
    if (from !== null && !release.current) {
      release.current = { startedAt: time, fromT: from };
      audio.play("우르릉");
      director.cue({ 바람: 1, 초: 0.5 });
    }
    let released = 0;
    if (release.current) {
      released = THREE.MathUtils.clamp((time - release.current.startedAt) / RELEASE_SECONDS, 0, 1);
      curtain.wallMaterial.uniforms.uReleaseT.value = release.current.fromT;
      if (released > 0.35 && !told.current) {
        told.current = true;
        showNotice("새가 지나간 자리부터 장막이 찢어진다 — 지붕의 소용돌이도 풀려 하늘이 열린다.", 5);
      }
    }
    s.uRelease.value = released;
    ridge.setCurtainClosed(drop * (1 - THREE.MathUtils.smoothstep(released, 0, 0.25)));
    curtain.wall.visible = drop > 0.001 && released < 0.999;
    curtain.lid.visible = iris > 0.001 && released < 0.999;

    // ④ 먼지·잎 — 둘레를 따라 휘돈다. 풀릴 때는 위로 날려 흩어진다
    const { debris, seeds } = curtain;
    debris.points.visible = curtain.wall.visible;
    if (debris.points.visible) {
      const point = { x: 0, z: 0, nx: 0, nz: 0 };
      for (let k = 0; k < DEBRIS; k++) {
        const seed = seeds[k];
        seed.t = (seed.t + seed.speed * dt * (1 - CALM_SLOWER * ridgeQuest.calm) * (1 + 0.5 * Math.sin(wt * 0.7 + k))) % 1;
        curtainPoint(seed.t, point);
        const ground = groundY(point.x, point.z);
        const lift = released * released * 25 * (0.5 + seed.height);
        const y = ground + 0.3 + seed.height * CURTAIN.height * 0.6 * drop * lower + Math.sin(wt * 2 + k) * 0.3 + lift;
        const out = seed.out;
        debris.position.setXYZ(k, (point.x + point.nx * out) * M, y * M, (point.z + point.nz * out) * M);
        debris.size.setX(k, seed.size * M);
        debris.alpha.setX(k, 0.55 * drop * (1 - released));
        if (seed.leaf) debris.color.setXYZ(k, 0.42, 0.45, 0.25);
        else debris.color.setXYZ(k, 0.62, 0.58, 0.5);
      }
      debris.commit();
      debris.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
    }

    /** 몸과 겹치면 바깥으로 비켜 선 자리(미터) — 떠다니는 것은 사람을 뚫고 지나가지 않는다 */
    const eye = camera.position.y / M;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const clear = { x: 0, z: 0 };
    const keepClear = (x: number, y: number, z: number, radius: number) => {
      clear.x = x;
      clear.z = z;
      if (y + radius < eye - EYE || y - radius > eye + HEAD) return clear;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      const need = radius + BODY_CLEARANCE;
      if (d >= need) return clear;
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      clear.x = px + nx * need;
      clear.z = pz + nz * need;
      return clear;
    };
    const block = (solid: DynamicSolid | null | undefined, x: number, y: number, z: number, half: number, enabled: boolean) => {
      if (!solid) return;
      Object.assign(solid, { x, z, halfX: half, halfZ: half, bottom: y - half, top: y + half, enabled });
    };

    // ⑤ 허공에 뜬 돌멩이 — 장막이 다 내려오면 땅에서 떠올라 맴돌고, 풀리면 떨어진다
    const floatIn = now === "sealing" ? THREE.MathUtils.smoothstep(since, DROP_START, SEALED_AT + 1) : 1;
    curtain.floaters.visible = ridge.isAtLeast("sealing");
    if (!curtain.floaters.visible) for (const solid of [...solids.current.floaters, ...solids.current.props]) if (solid) solid.enabled = false;
    if (curtain.floaters.visible) {
      curtain.floaterSeeds.forEach((f, k) => {
        let y: number;
        if (!release.current) {
          y = f.ground + f.size + (f.height * lower + Math.sin(wt * 0.6 + f.phase) * 0.35) * floatIn;
          f.fallY = y;
          f.fallV = 0;
        } else {
          f.fallV -= 9.8 * dt;
          f.fallY = Math.max(f.ground + f.size * 0.6, f.fallY + f.fallV * dt);
          y = f.fallY;
        }
        euler.set(f.spin.x * wt, f.spin.y * wt, f.spin.z * wt);
        quaternion.setFromEuler(euler);
        const at = keepClear(f.x, y, f.z, f.size);
        position.set(at.x * M, y * M, at.z * M);
        block(solids.current.floaters[k], at.x, y, at.z, f.size * 0.8, true);
        matrix.compose(position, quaternion, scale.set(f.size, f.size * f.flat, f.size).multiplyScalar(M));
        curtain.floaters.setMatrixAt(k, matrix);
      });
      curtain.floaters.instanceMatrix.needsUpdate = true;
    }

    // ⑥ 나뭇잎·나뭇가지·소품 — 바람을 타고 천천히 맴돌며 뒤집힌다. 풀리면 떨어진다
    const drifting = ridge.isAtLeast("sealing");
    curtain.leaves.visible = drifting;
    curtain.twigs.visible = drifting;
    curtain.props.visible = drifting;
    if (drifting) {
      type Drifter = (typeof curtain.leafSeeds)[number];
      const place = (f: Drifter, swirl: number) => {
        const wander = wt * 0.25 * f.drift + f.phase;
        const x = f.x + Math.sin(wander) * swirl;
        const z = f.z + Math.cos(wander * 0.8) * swirl;
        if (!release.current) {
          f.fallY = f.ground + 0.05 + (f.height * lower + Math.sin(wt * 0.7 + f.phase) * 0.4) * floatIn;
          f.fallV = 0;
        } else {
          f.fallV -= 6 * dt;
          f.fallY = Math.max(groundY(x, z) + 0.03, f.fallY + f.fallV * dt);
        }
        const at = keepClear(x, f.fallY, z, f.size * 0.5);
        position.set(at.x * M, f.fallY * M, at.z * M);
        const tumble = release.current ? 0 : 1;
        euler.set(f.spin.x * wt * tumble, f.spin.y * wt, f.spin.z * wt * tumble);
        quaternion.setFromEuler(euler);
      };
      curtain.leafSeeds.forEach((f, k) => {
        place(f, 1.4);
        matrix.compose(position, quaternion, scale.set(f.size, f.size, f.size * 1.6).multiplyScalar(M));
        curtain.leaves.setMatrixAt(k, matrix);
      });
      curtain.leaves.instanceMatrix.needsUpdate = true;
      curtain.twigSeeds.forEach((f, k) => {
        place(f, 0.9);
        matrix.compose(position, quaternion, scale.set(f.size, 0.018, 0.018).multiplyScalar(M));
        curtain.twigs.setMatrixAt(k, matrix);
      });
      curtain.twigs.instanceMatrix.needsUpdate = true;
      curtain.props.children.forEach((holder, k) => {
        if (!holder.userData.ready) return;
        holder.visible = true;
        place(curtain.propSeeds[k], 1.1);
        holder.position.copy(position);
        block(solids.current.props[k], position.x / M, position.y / M, position.z / M, curtain.propSeeds[k].size * 0.4, true);
        holder.quaternion.copy(quaternion);
      });
    }
  });

  return null;
}
