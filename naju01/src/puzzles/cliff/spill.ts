/**
 * 깨진 사발과 쏟아진 물 — 그림이 깨지는 순간 사발 셋이 조각나 흩어지고, 물이 받침에서 떨어져 땅을 적시며
 * 흙에 묻힌 귀때동이로 흘러간다. 물이 닿으면 귀때동이를 문 흙 둔덕이 풀려 씻겨 나가고 둘레가 파인다.
 * 언제 깨지는지는 BowlRite 가 정하고, 여기는 만들고 · 재고 · 그 순간의 모습으로 놓는 것만 한다.
 * 좌표는 미터, 그리는 것은 유닛(M 배). 시각은 깨진 뒤 흐른 초.
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeToonMaterial } from "../materials";
import { M } from "../units";
import { BOWLS, JUG, type BowlSize } from "./cliffShape";
import { buildGroundRibbon, floorAt, planar, topOf, type Rite, type RiteBowl } from "./riteScene";

/** 조각이 다 눕는 데 걸리는 시간 · 물이 귀때동이까지 흐르는 시간 · 그 뒤 물기가 마르기 시작하는 때와 걸리는 시간(초) */
export const SPILL = { shatter: 0.85, flow: 4.4, dryAfter: 6, drySeconds: 5 };

/** 큰 조각 셋 — 위에서 본 부채꼴(라디안) · 눕는 각 · 도는 각 · 늦게 떨어지는 시간(초) */
const PIECES = [
  { arc: [0.3, 2.9], tilt: 1.25, spin: 0.5, delay: 0 },
  { arc: [2.9, 4.9], tilt: 2.55, spin: -1.3, delay: 0.06 },
  { arc: [4.9, 6.58], tilt: 1.6, spin: 2.1, delay: 0.12 },
] as const;
/** 조각이 튀어 나가는 거리(사발 지름의 배) — 받침돌 위의 것은 둘이 돌 밖으로 떨어진다 */
const PIECE_REACH: Record<BowlSize, readonly number[]> = {
  large: [0.45, 0.7, 0.6],
  medium: [0.3, 2.0, 1.7],
  small: [0.3, 2.3, 2.0],
};
/** 사발마다 깨지는 방향을 돌려 놓는다(라디안) */
const BREAK_YAW = [0.4, 2.6, 4.9];
/** 사발 옆모습(지름 1 일 때 [반지름, 높이]) — 누운 조각이 땅에 박히지 않게 띄울 높이를 잰다 */
const BOWL_PROFILE: readonly (readonly [number, number])[] = [
  [0.18, 0],
  [0.4, 0.2],
  [0.5, 0.45],
];
/** 잔 조각 수(사발마다) · 물방울 수(받침마다) */
const CHIPS = 7;
const DROPS = 16;
/** 받침에서 물이 떨어지는 동안(초) */
const POUR = { from: 0.1, full: 0.4, wane: 2.0, until: 2.8 };
/** 물줄기 너비 · 젖은 흙이 번지는 너비 · 귀때동이 둘레가 젖는 반지름(미터) */
const WATER_WIDTH = 0.11;
const DAMP_WIDTH = 0.4;
const PUDDLE_RADIUS = 0.78;
/** 둔덕에서 씻겨 나오는 흙덩이 수 */
const CLODS = 9;

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const easeOut = (t: number) => 1 - (1 - t) ** 3;

// 셰이더 문자열에는 ASCII 만 쓴다
const RIBBON_VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;
const groundLayer = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
  toneMapped: false,
};

/**
 * 흐르는 물 — 머리가 uProgress 까지 나아가고, 물살의 결이 흐르는 쪽으로 미끄러지며 달빛이 군데군데 반짝인다.
 * 가장자리는 들쭉날쭉하다. uWater 가 0 이 되면 물은 스며 없어진다. uLength 는 줄기 길이(미터).
 */
function makeWaterMaterial(length: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 }, uWater: { value: 1 }, uLength: { value: length } },
    vertexShader: RIBBON_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uTime;
      uniform float uWater;
      uniform float uLength;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float along = vUv.x * uLength;
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float reached = 1.0 - smoothstep(uProgress - 0.02, uProgress, vUv.x);
        float bank = 0.18 + 0.34 * noise(vec2(along * 5.0, 3.0));
        float body = smoothstep(bank, bank + 0.3, across);
        float slow = noise(vec2(along * 8.0 - uTime * 2.1, vUv.y * 3.0));
        float fast = noise(vec2(along * 17.0 - uTime * 3.6, vUv.y * 6.0 + 4.0));
        float glint = smoothstep(0.56, 0.84, slow * 0.6 + fast * 0.5) * smoothstep(0.25, 0.7, across);
        float head = smoothstep(uProgress - 0.05, uProgress, vUv.x) * reached;
        vec3 water = mix(vec3(0.03, 0.05, 0.10), vec3(0.12, 0.18, 0.32), slow);
        vec3 color = mix(water, vec3(0.76, 0.85, 1.0), clamp(glint * 0.75 + head * 0.5, 0.0, 1.0));
        float alpha = reached * body * (0.6 + 0.35 * glint) * uWater;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
    ...groundLayer,
  });
}

/** 젖은 흙 — 물이 지나간 둘레가 어둡게 번진다. 물이 마른 뒤에도 남는다 */
function makeDampMaterial(length: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uLength: { value: length } },
    vertexShader: RIBBON_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uLength;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float along = vUv.x * uLength;
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        // 젖은 자국은 물머리를 조금 뒤따르고, 시간이 갈수록 넓게 번진다
        float reached = 1.0 - smoothstep(uProgress - 0.12, uProgress - 0.01, vUv.x);
        float ragged = 0.34 * noise(vec2(along * 3.0, 1.0)) + 0.2 * noise(vec2(along * 11.0, 7.0));
        float body = smoothstep(ragged, ragged + 0.5, across);
        float grain = noise(vec2(along * 40.0, vUv.y * 14.0));
        float alpha = reached * body * (0.6 + 0.12 * grain);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vec3(0.014, 0.016, 0.024) + vec3(0.03, 0.04, 0.07) * grain * body, alpha);
      }`,
    ...groundLayer,
  });
}

/**
 * 귀때동이 둘레 — 젖어 번진 흙, 귀때동이를 감싼 파인 자리, 그 안에 고인 물. 판 가운데가 귀때동이다.
 * uSoak 0~1 로 번지고, uWater 가 0 이 되면 고인 물이 스며 젖은 흙만 남는다.
 */
function makePuddleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSoak: { value: 0 }, uWater: { value: 1 }, uTime: { value: 0 } },
    vertexShader: RIBBON_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uSoak;
      uniform float uWater;
      uniform float uTime;
      varying vec2 vUv;
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        vec2 q = (vUv - 0.5) * 2.0;
        float r = length(q);
        float a = atan(q.y, q.x);
        float rim = uSoak * (0.7 + 0.16 * noise(vec2(a * 2.2, 1.0)) + 0.07 * sin(a * 5.0 + 1.3));
        float damp = smoothstep(rim, rim - 0.3, r);
        // 귀때동이 둘레가 씻겨 파인 자리와 거기 고인 물
        float hollow = smoothstep(0.42, 0.28, r) * smoothstep(0.35, 0.8, uSoak);
        float pool = smoothstep(rim * 0.62, rim * 0.62 - 0.1, r) * uWater * smoothstep(0.2, 0.7, uSoak);
        float ring = 0.5 + 0.5 * sin(r * 30.0 - uTime * 4.5 + noise(q * 4.0) * 2.0);
        vec3 mud = mix(vec3(0.018, 0.019, 0.025), vec3(0.004, 0.004, 0.006), hollow);
        vec3 water = mix(vec3(0.03, 0.05, 0.10), vec3(0.22, 0.3, 0.48), ring * 0.55);
        vec3 color = mix(mud, water, pool * (1.0 - hollow * 0.4));
        float alpha = max(damp * 0.62, hollow * 0.8) + pool * 0.22;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, min(alpha, 0.95));
      }`,
    ...groundLayer,
  });
}

/** 땅을 따라 누운 둥근 판 — uv 는 가운데가 (0.5, 0.5) */
function buildGroundDisc(x: number, z: number, radius: number) {
  const rings = 6;
  const spokes = 28;
  const positions: number[] = [x * M, (floorAt(x, z) + 0.012) * M, z * M];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    for (let spoke = 0; spoke < spokes; spoke++) {
      const angle = (spoke / spokes) * Math.PI * 2;
      const reach = ring / rings;
      const px = x + Math.cos(angle) * radius * reach;
      const pz = z + Math.sin(angle) * radius * reach;
      positions.push(px * M, (floorAt(px, pz) + 0.012) * M, pz * M);
      uvs.push(0.5 + 0.5 * Math.cos(angle) * reach, 0.5 + 0.5 * Math.sin(angle) * reach);
      const here = 1 + (ring - 1) * spokes + spoke;
      const next = 1 + (ring - 1) * spokes + ((spoke + 1) % spokes);
      if (ring === 1) indices.push(0, next, here);
      else indices.push(here - spokes, next - spokes, next, here - spokes, next, here);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** 누운 조각을 땅에서 띄울 높이(지름 1 일 때) — 기울인 쪽 벽이 바닥 밑으로 내려가는 만큼 */
function lyingLift(tilt: number) {
  return Math.max(0, ...BOWL_PROFILE.map(([radius, height]) => radius * Math.sin(tilt) - height * Math.cos(tilt)));
}

function buildPieces(bowl: RiteBowl, index: number) {
  return PIECES.map((spec, k) => {
    const from = spec.arc[0] + BREAK_YAW[index];
    const to = spec.arc[1] + BREAK_YAW[index];
    const middle = (from + to) / 2;
    const group = new THREE.Group();
    group.visible = false;
    bowl.group.add(group);
    const out = new THREE.Vector3(Math.cos(middle), 0, Math.sin(middle));
    return {
      group,
      /** 부채꼴 두 변 — 조각 자리에서 본 면과, 그리는 순간 월드로 옮긴 면 */
      cuts: [
        new THREE.Plane(new THREE.Vector3(-Math.sin(from), 0, Math.cos(from)), 0),
        new THREE.Plane(new THREE.Vector3(Math.sin(to), 0, -Math.cos(to)), 0),
      ],
      planes: [new THREE.Plane(), new THREE.Plane()],
      /** 튀어 나가는 쪽 · 눕는 축 */
      out,
      axis: new THREE.Vector3().crossVectors(UP, out),
      reach: PIECE_REACH[bowl.size][k] * bowl.diameter,
      tilt: spec.tilt,
      spin: spec.spin,
      delay: spec.delay,
      /** 내려앉는 높이(받침 윗면에서, 미터) — 모형을 읽은 뒤 잰다 */
      drop: 0,
      lift: lyingLift(spec.tilt) * bowl.diameter,
    };
  });
}

/** 물줄기 하나 — 받침에서 귀때동이로. 물과 그 둘레의 젖은 흙 */
function buildStream(points: [number, number][]) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const water = new THREE.Mesh(buildGroundRibbon(points, WATER_WIDTH, 1), makeWaterMaterial(length));
  const damp = new THREE.Mesh(buildGroundRibbon(points, DAMP_WIDTH, 0.6), makeDampMaterial(length));
  damp.renderOrder = 1;
  water.renderOrder = 2;
  water.visible = damp.visible = false;
  return { water, damp, start: points[0] };
}

/** 귀때동이를 문 흙 — 둘레가 볼록하게 솟은 둔덕 */
function buildMound() {
  const profile: [number, number][] = [
    [0.13, 0.0],
    [0.16, 0.045],
    [0.22, 0.055],
    [0.32, 0.03],
    [0.46, 0.0],
  ];
  const material = makeToonMaterial("#8C8573", { side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    ),
    material,
  );
  mesh.position.copy(planar(JUG.x, JUG.z, -0.005));
  mesh.scale.setScalar(M);
  mesh.receiveShadow = true;
  return { mesh, material, dry: new THREE.Color("#8C8573"), wet: new THREE.Color("#2C2822") };
}

export function buildSpill(rite: Rite) {
  const root = new THREE.Group();
  root.name = "cliff.spill";
  const random = createRandom(4117);

  const bowls = rite.bowls.map((bowl, index) => {
    const rest = BOWLS[bowl.size].rest;
    const side = [0.5, 0.42, 0.34][index];
    const lerp = THREE.MathUtils.lerp;
    // 큰 사발 것은 너럭바위를 돌아 내려온다
    const stream = buildStream([
      [rest.x + side, rest.z + 0.06],
      [lerp(rest.x, JUG.x, 0.38), lerp(rest.z, JUG.z, 0.3) + [0.5, 0.25, -0.1][index]],
      [lerp(rest.x, JUG.x, 0.72), lerp(rest.z, JUG.z, 0.75) + [0.2, 0.12, 0.0][index]],
      [JUG.x - 0.2, JUG.z + [-0.06, 0.02, 0.1][index]],
    ]);
    root.add(stream.damp, stream.water);
    const chips = Array.from({ length: CHIPS }, () => {
      const angle = random() * Math.PI * 2;
      const reach = Math.max(0.12, (0.6 + random() * 2.0) * bowl.diameter);
      return {
        x: rest.x + Math.cos(angle) * reach,
        z: rest.z + Math.sin(angle) * reach,
        /** 내려앉는 높이(유닛) — 모형을 읽은 뒤 잰다 */
        landY: floorAt(rest.x, rest.z) * M,
        size: (0.05 + random() * 0.06) * bowl.diameter,
        seconds: 0.35 + random() * 0.35,
        arc: 0.12 + random() * 0.18,
        spin: new THREE.Vector3(random() * 9 - 4.5, random() * 9 - 4.5, random() * 9 - 4.5),
        rest: new THREE.Euler(Math.PI / 2 + (random() - 0.5) * 0.5, random() * 6.3, (random() - 0.5) * 0.5),
      };
    });
    return { bowl, pieces: buildPieces(bowl, index), stream, chips };
  });

  // 잔 조각 — 한 번에 그린다
  const chipMesh = new THREE.InstancedMesh(
    new THREE.TetrahedronGeometry(1).scale(1, 0.16, 0.7),
    makeToonMaterial("#DADBE2", { side: THREE.DoubleSide }),
    bowls.length * CHIPS,
  );
  chipMesh.visible = false;
  chipMesh.frustumCulled = false;
  chipMesh.castShadow = true;
  root.add(chipMesh);

  // 받침에서 떨어지는 물방울
  const drops = makeGlowPoints(bowls.length * DROPS, { additive: true, softness: 1.5 });
  drops.points.visible = false;
  root.add(drops.points);

  // 귀때동이 둘레 — 젖은 흙 · 파인 자리 · 고인 물, 둔덕, 씻겨 나오는 흙덩이
  const puddleMaterial = makePuddleMaterial();
  const puddle = new THREE.Mesh(buildGroundDisc(JUG.x, JUG.z, PUDDLE_RADIUS), puddleMaterial);
  puddle.renderOrder = 1;
  puddle.visible = false;
  const mound = buildMound();
  const clodMaterial = makeToonMaterial("#857B68");
  const clodGeometry = new THREE.IcosahedronGeometry(1, 0);
  const clods = Array.from({ length: CLODS }, (_, k) => {
    // 물이 오는 쪽(서)의 반대편으로 더 많이 밀려 나간다
    const angle = -1.3 + (k / (CLODS - 1)) * 2.6 + (random() - 0.5) * 0.3;
    const mesh = new THREE.Mesh(clodGeometry, clodMaterial);
    const size = 0.022 + random() * 0.03;
    mesh.scale.set(size * M, size * 0.7 * M, size * (0.8 + random() * 0.5) * M);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    mesh.castShadow = true;
    root.add(mesh);
    return {
      mesh,
      angle,
      from: 0.17 + random() * 0.12,
      to: 0.4 + random() * 0.3,
      late: random() * 0.35,
      roll: 2 + random() * 3,
    };
  });
  root.add(puddle, mound.mesh);

  return {
    root,
    bowls,
    chipMesh,
    drops,
    puddle,
    puddleMaterial,
    mound,
    clods,
    /** 가만히 놓인 뒤에는 다시 놓지 않는다 */
    isSettled: false,
  };
}

export type Spill = ReturnType<typeof buildSpill>;

/**
 * 사발 모형으로 큰 조각 셋을 만든다 — 같은 모형을 부채꼴 두 면으로 잘라 쓴다.
 * 재질은 처음부터 툰으로 만든다. 씬의 툰 변환(WorldToon)은 표준 재질을 새 재질로 갈아 끼우며 자르는 면을 잃는다
 */
export function fitPieces(spill: Spill, index: number, source: THREE.Object3D) {
  for (const piece of spill.bowls[index].pieces) {
    const copy = source.clone(true);
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const cut = (material: THREE.Material) => {
        const from = material as THREE.MeshStandardMaterial;
        return new THREE.MeshToonMaterial({
          map: from.map ?? null,
          color: from.color?.clone() ?? new THREE.Color("#FFFFFF"),
          side: THREE.DoubleSide,
          clippingPlanes: piece.planes,
        });
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cut) : cut(mesh.material);
      mesh.castShadow = true;
    });
    piece.group.add(copy);
  }
}

/** 조각이 내려앉을 높이를 잰다 — 받침 위면 그 윗면, 밖이면 땅. supports 는 사발마다의 받침 모형 */
export function measureSpill(spill: Spill, supports: (THREE.Object3D | null)[]) {
  spill.bowls.forEach(({ bowl, pieces, chips }, index) => {
    const support = supports[index];
    const rest = BOWLS[bowl.size].rest;
    const heightAt = (x: number, z: number) => (support ? topOf(support, x, z) : null) ?? floorAt(x, z) * M;
    for (const piece of pieces) {
      const x = rest.x + piece.out.x * piece.reach;
      const z = rest.z + piece.out.z * piece.reach;
      piece.drop = Math.min(0, (heightAt(x, z) - bowl.restAt.y) / M);
    }
    for (const chip of chips) chip.landY = heightAt(chip.x, chip.z);
  });
  spill.isSettled = false;
}

const scratch = {
  tilt: new THREE.Quaternion(),
  spin: new THREE.Quaternion(),
  dummy: new THREE.Object3D(),
};

/**
 * 깨진 뒤 seconds 초의 모습으로 놓는다(깨지기 전이면 음수). 귀때동이 둘레 흙이 풀린 정도(0~1)를 돌려준다.
 */
export function updateSpill(
  spill: Spill,
  seconds: number,
  time: number,
  view: { gl: THREE.WebGLRenderer; camera: THREE.Camera },
) {
  const isBroken = seconds >= 0;
  const flow = isBroken ? clamp01((seconds - 0.3) / (SPILL.flow - 0.3)) : 0;
  const soaked = THREE.MathUtils.smoothstep(flow, 0.7, 1);
  const dried = clamp01((seconds - SPILL.flow - SPILL.dryAfter) / SPILL.drySeconds);
  const isMoving = seconds < SPILL.shatter + 0.6;

  // 큰 조각 · 잔 조각 — 다 누운 뒤에는 그대로 둔다
  if (!isBroken) spill.isSettled = false;
  if (!spill.isSettled) {
    spill.chipMesh.visible = isBroken;
    spill.bowls.forEach(({ bowl, pieces, chips }, index) => {
      for (const piece of pieces) {
        piece.group.visible = isBroken;
        if (!isBroken) continue;
        const u = clamp01((seconds - piece.delay) / SPILL.shatter);
        const travel = easeOut(u);
        const hop = 0.35 * bowl.diameter * Math.sin(Math.PI * u) * (1 - 0.6 * u);
        piece.group.position
          .copy(piece.out)
          .multiplyScalar(piece.reach * travel)
          .setY((piece.drop + piece.lift) * u * u + hop);
        scratch.tilt.setFromAxisAngle(piece.axis, piece.tilt * travel);
        scratch.spin.setFromAxisAngle(UP, piece.spin * travel);
        piece.group.quaternion.copy(scratch.spin).multiply(scratch.tilt);
      }
      bowl.group.updateMatrixWorld(true);
      for (const piece of pieces)
        piece.cuts.forEach((cut, side) => piece.planes[side].copy(cut).applyMatrix4(piece.group.matrixWorld));

      const rest = BOWLS[bowl.size].rest;
      chips.forEach((chip, k) => {
        const u = clamp01(seconds / chip.seconds);
        const { dummy } = scratch;
        const fromY = bowl.restAt.y + bowl.diameter * 0.3 * M;
        dummy.position.set(
          THREE.MathUtils.lerp(rest.x, chip.x, u) * M,
          THREE.MathUtils.lerp(fromY, chip.landY + 0.006 * M, u * u) + chip.arc * Math.sin(Math.PI * u) * M,
          THREE.MathUtils.lerp(rest.z, chip.z, u) * M,
        );
        const air = (1 - u) * chip.seconds;
        dummy.rotation.set(
          chip.rest.x + chip.spin.x * air,
          chip.rest.y + chip.spin.y * air,
          chip.rest.z + chip.spin.z * air,
        );
        dummy.scale.setScalar(chip.size * M);
        dummy.updateMatrix();
        spill.chipMesh.setMatrixAt(index * CHIPS + k, dummy.matrix);
      });
    });
    spill.chipMesh.instanceMatrix.needsUpdate = true;
    spill.isSettled = isBroken && !isMoving;
  }

  // 받침에서 떨어지는 물 — 사발 가장자리에서 물줄기 머리로
  const pour = isBroken
    ? THREE.MathUtils.smoothstep(seconds, POUR.from, POUR.full) *
      (1 - THREE.MathUtils.smoothstep(seconds, POUR.wane, POUR.until))
    : 0;
  spill.drops.points.visible = pour > 0;
  if (pour > 0) {
    spill.bowls.forEach(({ bowl, stream }, index) => {
      const rest = BOWLS[bowl.size].rest;
      const [toX, toZ] = stream.start;
      const span = Math.hypot(toX - rest.x, toZ - rest.z) || 1;
      const edge = (bowl.diameter * 0.5) / span;
      const fromY = bowl.restAt.y + bowl.diameter * 0.2 * M;
      const toY = floorAt(toX, toZ) * M;
      for (let k = 0; k < DROPS; k++) {
        const i = index * DROPS + k;
        const u = (seconds / 0.42 + k / DROPS + index * 0.37) % 1;
        const along = THREE.MathUtils.lerp(edge, 1, Math.sqrt(u));
        const jitter = Math.sin(k * 12.9898 + index) * 0.02;
        spill.drops.position.setXYZ(
          i,
          (THREE.MathUtils.lerp(rest.x, toX, along) + jitter) * M,
          THREE.MathUtils.lerp(fromY, toY, u * u),
          (THREE.MathUtils.lerp(rest.z, toZ, along) + jitter) * M,
        );
        spill.drops.size.setX(i, (0.035 + 0.02 * ((k * 7) % 3)) * M);
        spill.drops.alpha.setX(i, pour * 0.8 * (1 - 0.5 * u));
        spill.drops.color.setXYZ(i, 0.55, 0.68, 0.95);
      }
    });
    spill.drops.commit();
    spill.drops.material.uniforms.uPointScale.value = pointScaleFor(view.gl, view.camera);
  }

  // 물줄기 — 받침에서 귀때동이로. 다 흐른 뒤에는 물이 스며 젖은 자국만 남는다
  spill.bowls.forEach(({ stream }, index) => {
    const progress = clamp01(flow * 1.25 - index * 0.07);
    stream.water.visible = isBroken && dried < 1;
    stream.damp.visible = isBroken;
    const water = (stream.water.material as THREE.ShaderMaterial).uniforms;
    water.uProgress.value = progress;
    water.uTime.value = time;
    water.uWater.value = 1 - dried;
    (stream.damp.material as THREE.ShaderMaterial).uniforms.uProgress.value = progress;
  });

  // 귀때동이 둘레 — 젖어 번지고, 둔덕이 풀려 내려앉고, 흙덩이가 씻겨 나온다
  spill.puddle.visible = soaked > 0;
  spill.puddleMaterial.uniforms.uSoak.value = soaked;
  spill.puddleMaterial.uniforms.uWater.value = 1 - dried;
  spill.puddleMaterial.uniforms.uTime.value = time;
  spill.mound.mesh.scale.set(M * (1 + 0.22 * soaked), M * (1 - 0.82 * soaked), M * (1 + 0.22 * soaked));
  spill.mound.material.color.copy(spill.mound.dry).lerp(spill.mound.wet, soaked);
  for (const clod of spill.clods) {
    const u = easeOut(clamp01((soaked - clod.late) / (1 - clod.late)));
    const reach = THREE.MathUtils.lerp(clod.from, clod.to, u);
    const x = JUG.x + Math.cos(clod.angle) * reach;
    const z = JUG.z + Math.sin(clod.angle) * reach;
    clod.mesh.position.set(x * M, (floorAt(x, z) + THREE.MathUtils.lerp(0.045, 0.012, u)) * M, z * M);
    clod.mesh.rotation.x = clod.roll * u;
  }
  return soaked;
}
