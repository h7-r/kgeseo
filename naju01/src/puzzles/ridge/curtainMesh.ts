/**
 * 바람 장막의 모양 — 둘레를 감싼 벽, 가운데가 솟은 지붕, 장막에 휘말린 먼지 · 뜬 돌 · 잎 · 가지 · 소품.
 * 좌표는 미터, 그리는 것은 유닛(M 배)
 */
import * as THREE from "three";

import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { makeGlowPoints } from "../glowPoints";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { LID_FRAGMENT, LID_VERTEX, WALL_FRAGMENT, WALL_VERTEX } from "./curtainShaders";
import { CURTAIN, CURTAIN_PERIMETER, RIDGE_CENTER, curtainPoint } from "./ridgeShape";

const SEGMENTS = 220;
const ROWS = 14;
const LID_RINGS = 18;
/** 지붕이 가운데서 솟는 높이(m) — 하늘이 둥글게 닫힌 것으로 보이게 */
const DOME = 4;
/** 장막 밑동을 땅 밑으로 묻는 깊이(m) — 바깥 비탈에서 밑이 뜨지 않게 */
export const SINK = 2.5;
export const DEBRIS = 160;
const FLOATERS = 46;
const LEAVES = 40;
const TWIGS = 16;
/** 바람에 들려 떠다니는 물건 — 라이브러리 · 코드 소품에서 능선에 있을 법한 것들. size 는 가장 긴 변(m) */
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

function buildWallGeometry() {
  const positions: number[] = [];
  const ts: number[] = [];
  const vs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const point = { x: 0, z: 0, nx: 0, nz: 0 };
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    curtainPoint(t, point);
    const base = groundY(point.x, point.z) - SINK;
    const top = groundY(point.x, point.z) + CURTAIN.height;
    for (let j = 0; j <= ROWS; j++) {
      const v = j / ROWS;
      positions.push(point.x * M, (base + (top - base) * v) * M, point.z * M);
      ts.push(t);
      vs.push(v);
      normals.push(point.nx, point.nz);
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
  const point = { x: 0, z: 0, nx: 0, nz: 0 };
  const centerTop = groundY(RIDGE_CENTER.x, RIDGE_CENTER.z) + CURTAIN.height;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    curtainPoint(t, point);
    const edgeTop = groundY(point.x, point.z) + CURTAIN.height;
    for (let j = 0; j <= LID_RINGS; j++) {
      const r = j / LID_RINGS;
      const x = RIDGE_CENTER.x + (point.x - RIDGE_CENTER.x) * r;
      const z = RIDGE_CENTER.z + (point.z - RIDGE_CENTER.z) * r;
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

/** 바람을 타고 맴도는 것 하나 — 잎 · 가지 · 소품 */
export interface Drifter {
  x: number;
  z: number;
  ground: number;
  height: number;
  size: number;
  phase: number;
  spin: THREE.Vector3;
  drift: number;
  /** 풀려 떨어질 때의 높이 · 속도 */
  fallY: number;
  fallV: number;
}

/** 능선 안에 흩어 놓는다 — 가운데가 빽빽하지 않게 반지름을 제곱근으로 */
function scatter(count: number, sizes: [number, number], heights: [number, number]): Drifter[] {
  return Array.from({ length: count }, () => {
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
}

/** 허공에 뜬 돌멩이 — 모래알만 한 것부터 주먹보다 큰 것까지, 작은 것이 많게 */
function scatterFloaters() {
  return Array.from({ length: FLOATERS }, () => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const x = RIDGE_CENTER.x + Math.cos(angle) * radius * 6;
    const z = RIDGE_CENTER.z + Math.sin(angle) * radius * 10;
    return {
      x,
      z,
      ground: groundY(x, z),
      height: 0.4 + Math.random() * 3.4,
      size: 0.025 + Math.random() ** 2.2 * 0.26,
      flat: Math.random() < 0.4 ? 0.35 + Math.random() * 0.3 : 1,
      phase: Math.random() * 10,
      spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()),
      fallY: 0,
      fallV: 0,
    };
  });
}

/** 소품이 읽히면 셰이더를 미리 굽는 손 — 장막이 서면서 건다 */
let warmProp: ((holder: THREE.Object3D) => void) | null = null;
export const setPropWarmer = (warmer: typeof warmProp) => {
  warmProp = warmer;
};

/** 라이브러리 소품 — 읽히는 대로 하나씩 떠오른다. holder.userData.ready 가 서면 그릴 수 있다 */
function loadFloatingProps(props: THREE.Group, seeds: Drifter[]) {
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
        model.traverse((object) => (object.castShadow = true));
        holder.add(model);
        holder.userData.ready = true;
        // 소품은 장막이 칠 때 처음 보인다 — 읽히자마자 셰이더를 미리 굽는다
        warmProp?.(holder);
        seeds[k].size = entry.size;
      },
      undefined,
      (error) => console.warn("[WindCurtain] 떠다닐 소품을 못 읽었다:", entry.url, error),
    );
  });
}

export function buildCurtain() {
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
  const debrisSeeds = Array.from({ length: DEBRIS }, () => ({
    t: Math.random(),
    height: Math.random(),
    speed: 0.012 + Math.random() * 0.02,
    out: (Math.random() - 0.5) * 1.6,
    size: 0.05 + Math.random() * 0.12,
    isLeaf: Math.random() < 0.35,
  }));
  // 허공에 뜬 돌멩이 — 장막 안은 몸도 돌도 가볍다. 풀리면 툭툭 떨어진다
  const floaters = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), makeToonMaterial("#8C857A"), FLOATERS);
  floaters.frustumCulled = false;
  floaters.visible = false;
  const floaterSeeds = scatterFloaters();
  // 나뭇잎 — 마름모 한 장, 빛깔이 제각각. 나뭇가지 — 가는 막대
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, -1, 0.45, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1, -0.45, 0, 0], 3),
  );
  leafGeometry.computeVertexNormals();
  const leaves = new THREE.InstancedMesh(leafGeometry, makeToonMaterial("#FFFFFF", { side: THREE.DoubleSide }), LEAVES);
  const leafTones = ["#5E7A3A", "#7C8F3E", "#A39A45", "#8A5E2E", "#6B7F4A"];
  for (let k = 0; k < LEAVES; k++) leaves.setColorAt(k, new THREE.Color(leafTones[k % leafTones.length]));
  const twigs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.5, 0.7, 1, 5).rotateZ(Math.PI / 2),
    makeToonMaterial("#5A4330"),
    TWIGS,
  );
  for (const mesh of [leaves, twigs]) {
    mesh.frustumCulled = false;
    mesh.visible = false;
  }
  const leafSeeds = scatter(LEAVES, [0.05, 0.11], [0.5, 4.2]);
  const twigSeeds = scatter(TWIGS, [0.2, 0.55], [0.6, 3.6]);
  const props = new THREE.Group();
  const propSeeds = scatter(FLOATING_PROPS.length, [1, 1], [1.0, 3.8]);
  loadFloatingProps(props, propSeeds);
  return {
    wall,
    lid,
    wallMaterial,
    lidMaterial,
    shared,
    debris,
    debrisSeeds,
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
export type Curtain = ReturnType<typeof buildCurtain>;
