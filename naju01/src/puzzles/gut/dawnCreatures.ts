/**
 * 굿이 풀린 뒤 되살아나는 것들 — 바람에 날려 내려앉는 나뭇잎, 날았다 내려앉기를 되풀이하는 오리, 강에서 뛰어오르는 물고기.
 * 나뭇잎은 평소에도 가끔 내린다(rate 로 조절). 자리는 미터로 셈하고 그릴 때 유닛(M 배)으로 옮긴다.
 */
import * as THREE from "three";

import { SPECIES, buildFishGeometry } from "../cave/fishLooks";
import { RITE_CENTER } from "../cliff/cliffShape";
import { floorAt } from "../cliff/riteScene";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeToonMaterial } from "../materials";
import { buildBird, faceMotion, flapWings, type Bird } from "../ridge/birdFlight";
import { buildFlyingDuck } from "../ridge/birdModels";
import { makeVertexColorMaterial } from "../ridge/vertexPaint";
import { M } from "../units";
import { makeWaterRipple, setRippleAge } from "../waterRipple";

const random = (from: number, to: number) => from + Math.random() * (to - from);
const UP = new THREE.Vector3(0, 1, 0);

// ── 나뭇잎 ──────────────────────────────────────────────────────────────

/** 잎 수 · 잎 길이(미터) · 떨어지는 빠르기(m/s) · 좌우로 흔들리는 너비(m/s) · 땅에 누워 있는 시간(초) */
const LEAF = { count: 80, size: 0.11, fall: 0.8, sway: 0.5, rest: 7 };
/** 잎이 생기는 자리 — 눈에서 떨어진 거리 · 머리 위 높이(미터). 보는 쪽 앞에 주로 생긴다 */
const LEAF_SPAWN = { near: 2.5, far: 12, low: 2.6, high: 6, spread: 2.6 };
/** 바람이 부는 쪽 — 강을 따라 */
const WIND_DIR = new THREE.Vector3(0.82, 0, -0.57);
/** 평소의 잎빛 · 날이 갠 뒤 섞이는 물든 잎빛 */
const GREEN_LEAVES = ["#5E8A34", "#7AA242", "#93AE4E", "#B8A848"];
const BRIGHT_LEAVES = ["#8FBF4A", "#E0B84C", "#D98E3A", "#C9603A", "#A8C25A"];

interface Leaf {
  /** 0 쉼 · 1 떨어짐 · 2 땅에 누움 */
  state: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  floor: number;
  phase: number;
  spin: number;
  age: number;
  seed: number;
}

export function buildLeaves() {
  // 잎 한 장 — 끝이 뾰족한 타원. 잎맥을 따라 살짝 접혔다
  const outline = new THREE.Shape();
  outline.moveTo(0, -0.5);
  outline.quadraticCurveTo(0.34, -0.1, 0, 0.5);
  outline.quadraticCurveTo(-0.34, -0.1, 0, -0.5);
  const geometry = new THREE.ShapeGeometry(outline, 5);
  const at = geometry.attributes.position;
  for (let i = 0; i < at.count; i++) at.setZ(i, Math.abs(at.getX(i)) * 0.35);
  geometry.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geometry, makeToonMaterial("#FFFFFF", { side: THREE.DoubleSide }), LEAF.count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < LEAF.count; i++) {
    mesh.setMatrixAt(i, hidden);
    mesh.setColorAt(i, new THREE.Color("#7AA242"));
  }
  return {
    mesh,
    leaves: Array.from({ length: LEAF.count }, (): Leaf => ({
      state: 0,
      x: 0,
      y: 0,
      z: 0,
      floor: 0,
      phase: 0,
      spin: 0,
      age: 0,
      seed: Math.random(),
    })),
    owed: 0,
    dummy: new THREE.Object3D(),
    forward: new THREE.Vector3(),
    color: new THREE.Color(),
  };
}

type Leaves = ReturnType<typeof buildLeaves>;

interface LeafWeather {
  /** 1초에 새로 떨어지는 잎 수 */
  rate: number;
  /** 바람 세기 0~1 */
  wind: number;
  /** 물든 잎을 섞나(날이 갠 뒤) */
  isBright: boolean;
}

export function updateLeaves(part: Leaves, dt: number, camera: THREE.Camera, weather: LeafWeather) {
  const { mesh, leaves, dummy, forward } = part;
  // 새 잎 — 보는 쪽 앞, 머리 위에서 생긴다
  part.owed = Math.min(part.owed + weather.rate * dt, 6);
  camera.getWorldDirection(forward);
  const heading = Math.atan2(forward.x, forward.z);
  const eyeX = camera.position.x / M;
  const eyeY = camera.position.y / M;
  const eyeZ = camera.position.z / M;
  while (part.owed >= 1) {
    part.owed -= 1;
    const leaf = leaves.find((entry) => entry.state === 0);
    if (!leaf) break;
    const angle = heading + random(-LEAF_SPAWN.spread / 2, LEAF_SPAWN.spread / 2);
    const distance = random(LEAF_SPAWN.near, LEAF_SPAWN.far);
    leaf.x = eyeX + Math.sin(angle) * distance - WIND_DIR.x * weather.wind * 3;
    leaf.z = eyeZ + Math.cos(angle) * distance - WIND_DIR.z * weather.wind * 3;
    leaf.y = eyeY + random(LEAF_SPAWN.low, LEAF_SPAWN.high);
    leaf.state = 1;
    leaf.phase = Math.random() * 6.28;
    leaf.spin = Math.random() * 6.28;
    leaf.age = 0;
    const palette = weather.isBright && Math.random() < 0.7 ? BRIGHT_LEAVES : GREEN_LEAVES;
    mesh.setColorAt(leaves.indexOf(leaf), part.color.set(palette[Math.floor(Math.random() * palette.length)]));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  const push = 0.25 + weather.wind * 2.4;
  leaves.forEach((leaf, index) => {
    if (leaf.state === 0) return;
    let scale = LEAF.size * (0.75 + leaf.seed * 0.5);
    if (leaf.state === 1) {
      leaf.phase += dt * (2.2 + leaf.seed * 1.6);
      leaf.spin += dt * (0.8 + leaf.seed * 1.4) * (1 + weather.wind * 2);
      // 좌우로 흔들리며 내린다 — 흔들릴 때마다 살짝 떠올랐다 다시 가라앉는다
      const swing = Math.sin(leaf.phase);
      leaf.x += (WIND_DIR.x * push + Math.cos(leaf.spin) * swing * LEAF.sway) * dt;
      leaf.z += (WIND_DIR.z * push + Math.sin(leaf.spin) * swing * LEAF.sway) * dt;
      leaf.y -= LEAF.fall * (0.7 + leaf.seed * 0.6) * (1 - 0.55 * Math.abs(swing)) * dt;
      // 땅(물이면 물낯)에 닿으면 눕는다
      leaf.floor = Math.max(floorAt(leaf.x, leaf.z), 0);
      if (leaf.y <= leaf.floor + 0.02) {
        leaf.state = 2;
        leaf.age = 0;
        leaf.y = leaf.floor + 0.02;
      }
      dummy.rotation.set(swing * 0.9, leaf.spin, Math.cos(leaf.phase * 0.7) * 0.8);
    } else {
      leaf.age += dt;
      scale *= 1 - THREE.MathUtils.smoothstep(leaf.age, LEAF.rest - 1.5, LEAF.rest);
      dummy.rotation.set(-Math.PI / 2, 0, leaf.spin);
      if (leaf.age >= LEAF.rest) leaf.state = 0;
    }
    dummy.position.set(leaf.x * M, leaf.y * M, leaf.z * M);
    dummy.scale.setScalar(leaf.state === 0 ? 0 : scale * M);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

// ── 오리 ────────────────────────────────────────────────────────────────

/**
 * 오리 수 · 몸길이(미터) · 앉아 있는 시간 · 한 번 나는 시간(초) · 앉는 자리(굿판 가운데서의 거리, 미터) · 나는 높이(미터).
 * 높이 날지 않는다 — 고개를 들지 않아도 보이게
 */
const DUCK = {
  count: 8,
  size: 0.6,
  perch: [3.5, 8] as const,
  flight: [5.5, 8.5] as const,
  ring: [4.4, 9] as const,
  height: [1.5, 3.4] as const,
};
/** 앉을 수 있는 땅 높이(미터) — 물속 · 벼랑 위는 안 된다 */
const PERCH_FLOOR = [0.02, 2.6] as const;
/**
 * 보는 쪽 앞에 앉히는 자리 — 눈에서의 거리(미터) · 시선에서 벌어지는 각(라디안). 셋에 둘은 이렇게 앞에 앉고,
 * 나머지는 굿판 둘레 아무 데나 앉는다(강가에만 몰리지 않게)
 */
const PERCH_AHEAD = { near: 3, far: 9, spread: 1.5, share: 0.67 };

interface DawnDuck {
  bird: Bird;
  mode: "away" | "flying" | "perched";
  time: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  bendFrom: THREE.Vector3;
  bendTo: THREE.Vector3;
  yaw: number;
}

export function buildDucks() {
  const root = new THREE.Group();
  root.name = "gut.dawnDucks";
  const material = makeVertexColorMaterial({ side: THREE.DoubleSide });
  const looks = [buildFlyingDuck(true), buildFlyingDuck(false)];
  const ducks = Array.from({ length: DUCK.count }, (_, k): DawnDuck => {
    const bird = buildBird(looks[k % 2], material, DUCK.size * random(0.85, 1.05), Math.random());
    root.add(bird.group);
    return {
      bird,
      mode: "away",
      // 한 마리씩 차례로 날아든다
      time: -1.5 - k * 1.3,
      duration: 0,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      bendFrom: new THREE.Vector3(),
      bendTo: new THREE.Vector3(),
      yaw: 0,
    };
  });
  return { root, ducks, at: new THREE.Vector3(), forward: new THREE.Vector3() };
}

type Ducks = ReturnType<typeof buildDucks>;

const isPerchable = (x: number, z: number) => {
  const floor = floorAt(x, z);
  return floor > PERCH_FLOOR[0] && floor < PERCH_FLOOR[1];
};

/**
 * 앉을 자리를 고른다(미터) — 대개는 보는 쪽 앞, 가끔은 굿판 둘레의 마른 땅. 몇 번 해도 못 찾으면 굿판 가운데 곁
 */
function pickPerch(out: THREE.Vector3, size: number, camera: THREE.Camera, forward: THREE.Vector3) {
  const heading = Math.atan2(forward.x, forward.z);
  for (let attempt = 0; attempt < 24; attempt++) {
    let x: number;
    let z: number;
    // 앞쪽을 먼저 찾아보고, 물이나 바위뿐이면 굿판 둘레로 돌린다
    if (attempt < 12 && Math.random() < PERCH_AHEAD.share) {
      const angle = heading + random(-PERCH_AHEAD.spread / 2, PERCH_AHEAD.spread / 2);
      const distance = random(PERCH_AHEAD.near, PERCH_AHEAD.far);
      x = camera.position.x / M + Math.sin(angle) * distance;
      z = camera.position.z / M + Math.cos(angle) * distance;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = random(DUCK.ring[0], DUCK.ring[1]);
      x = RITE_CENTER.x + Math.cos(angle) * radius;
      z = RITE_CENTER.z + Math.sin(angle) * radius;
    }
    if (isPerchable(x, z)) return out.set(x, floorAt(x, z) + size * 0.1, z);
  }
  // 끝내 못 찾았으면 굿판 가운데 곁 — 여럿이 한 점에 겹치지 않게 흩는다
  const x = RITE_CENTER.x + random(-2.2, 2.2);
  const z = RITE_CENTER.z + random(1.2, 3);
  return out.set(x, floorAt(x, z) + size * 0.1, z);
}

/** from 에서 다음 앉을 자리까지 휘어 나는 길을 잡는다 */
function planFlight(duck: DawnDuck, size: number, camera: THREE.Camera, forward: THREE.Vector3) {
  pickPerch(duck.to, size, camera, forward);
  const height = random(DUCK.height[0], DUCK.height[1]);
  // 곧장 가지 않고 옆으로 크게 돌아 간다
  const side = new THREE.Vector3().subVectors(duck.to, duck.from).cross(UP).setY(0);
  if (side.lengthSq() < 0.01) side.set(1, 0, 0);
  side.normalize().multiplyScalar(random(2.5, 5.5) * (Math.random() < 0.5 ? -1 : 1));
  duck.bendFrom
    .copy(duck.from)
    .add(side)
    .setY(Math.max(duck.from.y, duck.to.y) + height);
  duck.bendTo
    .copy(duck.to)
    .add(side)
    .setY(duck.to.y + height * 0.8);
  duck.duration = random(DUCK.flight[0], DUCK.flight[1]);
  duck.time = 0;
  duck.mode = "flying";
}

/** 날개를 접는다 — 몸 옆으로 붙여 꽁지 쪽을 향하게. 왼날개는 거울이라 반대로 돈다 */
function foldWings(bird: Bird) {
  for (let k = 0; k < 2; k++) {
    bird.wings[k].rotation.set(0, k === 0 ? -1.38 : 1.38, k === 0 ? 0.16 : -0.16);
    bird.elbows[k].rotation.set(0, 0.5, 0);
  }
  bird.group.children[0].position.y = 0;
}

/** isOut 이면(날이 갠 뒤) 오리들이 날아들어 앉았다 날기를 되풀이한다 */
export function updateDucks(part: Ducks, dt: number, time: number, isOut: boolean, camera: THREE.Camera) {
  part.root.visible = isOut;
  if (!isOut) return;
  const { at, forward } = part;
  camera.getWorldDirection(forward);
  for (const duck of part.ducks) {
    const { bird } = duck;
    const size = bird.group.scale.x / M;
    duck.time += dt;
    if (duck.mode === "away") {
      bird.group.visible = false;
      if (duck.time < 0) continue;
      // 강 건너 쪽 하늘에서 날아든다
      const angle = Math.random() * Math.PI * 2;
      duck.from.set(RITE_CENTER.x + Math.cos(angle) * 26, 9, RITE_CENTER.z + 14 + Math.sin(angle) * 6);
      planFlight(duck, size, camera, forward);
      bird.previous.copy(duck.from).multiplyScalar(M);
      continue;
    }
    bird.group.visible = true;
    if (duck.mode === "flying") {
      const t = Math.min(1, duck.time / duck.duration);
      const eased = THREE.MathUtils.smootherstep(t, 0, 1);
      const inverse = 1 - eased;
      // 굽은 길(3차 베지에) 위의 자리
      at.set(0, 0, 0)
        .addScaledVector(duck.from, inverse ** 3)
        .addScaledVector(duck.bendFrom, 3 * inverse * inverse * eased)
        .addScaledVector(duck.bendTo, 3 * inverse * eased * eased)
        .addScaledVector(duck.to, eased ** 3)
        .multiplyScalar(M);
      bird.group.position.copy(at);
      faceMotion(bird, at);
      // 뜰 때 · 앉을 때는 힘차게 치고, 가운데서는 미끄러지듯
      const effort = t < 0.22 || t > 0.8 ? 1 : 0.35 + 0.3 * Math.sin(time * 0.9 + bird.seed * 6);
      flapWings(bird, dt, effort, t > 0.8 ? 11 : 7);
      if (t >= 1) {
        duck.mode = "perched";
        duck.time = 0;
        duck.duration = random(DUCK.perch[0], DUCK.perch[1]);
        duck.yaw = Math.atan2(RITE_CENTER.x - duck.to.x, RITE_CENTER.z - duck.to.z) + random(-1.2, 1.2);
        foldWings(bird);
      }
      continue;
    }
    // 앉아 있다 — 고개를 까딱이며 쪼고, 가끔 몸을 튼다
    const peck = Math.max(0, Math.sin(time * 1.4 + bird.seed * 9)) ** 6;
    const turn = Math.sin(time * 0.35 + bird.seed * 5) * 0.5;
    bird.group.position.set(duck.to.x * M, duck.to.y * M, duck.to.z * M);
    bird.group.rotation.set(peck * 0.45, duck.yaw + turn, 0, "YXZ");
    if (duck.time >= duck.duration) {
      duck.from.copy(duck.to);
      planFlight(duck, size, camera, forward);
      bird.previous.copy(bird.group.position);
    }
  }
}

// ── 물고기 ──────────────────────────────────────────────────────────────

/**
 * 뛰는 물고기 — 수 · 몸길이(미터) · 솟는 높이 · 나아가는 거리(미터) · 한 번 뛰는 시간 · 다음 뛸 때까지(초).
 * 실물보다 크고 높게 뛴다 — 강 건너에서도 보이게
 */
const LEAP = {
  count: 3,
  size: 0.7,
  height: [1.0, 1.7] as const,
  reach: [1.4, 2.4] as const,
  seconds: 1.1,
  gap: [1.4, 4.2] as const,
};
/** 뛸 수 있는 물 — 굿판에서 이 안(미터)의 네모를 훑어, 이보다 깊은 데(미터). 물가 얕은 데도 넣어야 가까이서 뛴다 */
const WATER_SEARCH = { half: 24, step: 1.5, depth: -0.15 };
/** 눈에서 이 거리(미터) 안의 물에서만 뛴다 — 멀면 점으로 보인다 */
const LEAP_RANGE = [4, 17] as const;
const SPLASHES = 6;
const SPLASH_DROPS = 8;
const SPLASH_SECONDS = 1.4;
/** 물결이 번지는 반지름(미터) */
const SPLASH_RADIUS = 1.3;

interface Leaper {
  mesh: THREE.Mesh;
  wait: number;
  time: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  height: number;
  reach: number;
  hasLanded: boolean;
}

export function buildLeapers() {
  const root = new THREE.Group();
  root.name = "gut.leapingFish";
  // 붕어 — 몸이 높아 멀리서도 물고기로 읽힌다
  const species = SPECIES.find((entry) => entry.name === "붕어") ?? SPECIES[0];
  const geometry = buildFishGeometry(species);
  const material = makeToonMaterial("#FFFFFF", { vertexColors: true, side: THREE.DoubleSide });
  const fish = Array.from({ length: LEAP.count }, (_, k): Leaper => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.scale.setScalar(LEAP.size * random(0.8, 1.15) * M);
    root.add(mesh);
    return {
      mesh,
      wait: 1.5 + k * 1.1,
      time: -1,
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
      height: 1,
      reach: 1.5,
      hasLanded: false,
    };
  });
  // 물결과 튀는 물방울 — 솟을 때 · 떨어질 때
  const rings = Array.from({ length: SPLASHES }, () => {
    const ripple = makeWaterRipple("#F2F8FF");
    root.add(ripple.mesh);
    return { ripple, age: SPLASH_SECONDS, x: 0, z: 0 };
  });
  const drops = makeGlowPoints(SPLASHES * SPLASH_DROPS, { additive: false, softness: 1.2 });
  root.add(drops.points);
  return {
    root,
    fish,
    rings,
    drops,
    nextRing: 0,
    /** 뛸 수 있는 물 자리(미터) — 땅이 준비된 뒤 한 번 훑는다 */
    water: null as [number, number][] | null,
    seeds: Float32Array.from({ length: SPLASHES * SPLASH_DROPS * 2 }, () => Math.random()),
    forward: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    nose: new THREE.Vector3(1, 0, 0),
  };
}

type Leapers = ReturnType<typeof buildLeapers>;

function findWater() {
  const spots: [number, number][] = [];
  const { half, step, depth } = WATER_SEARCH;
  for (let x = RITE_CENTER.x - half; x <= RITE_CENTER.x + half; x += step) {
    for (let z = RITE_CENTER.z - half; z <= RITE_CENTER.z + half; z += step) {
      if (floorAt(x, z) < depth) spots.push([x, z]);
    }
  }
  return spots;
}

function splash(part: Leapers, x: number, z: number) {
  const entry = part.rings[part.nextRing];
  part.nextRing = (part.nextRing + 1) % SPLASHES;
  entry.age = 0;
  entry.x = x;
  entry.z = z;
}

export function updateLeapers(
  part: Leapers,
  dt: number,
  isOut: boolean,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
) {
  part.root.visible = isOut;
  if (!isOut) return;
  part.water ??= findWater();
  const { water, forward, velocity } = part;
  camera.getWorldDirection(forward);
  const eyeX = camera.position.x / M;
  const eyeZ = camera.position.z / M;

  for (const leaper of part.fish) {
    if (leaper.time < 0) {
      leaper.mesh.visible = false;
      leaper.wait -= dt;
      if (leaper.wait > 0 || water.length === 0) continue;
      // 보는 쪽 앞의 물을 고른다 — 몇 번 찾아도 없으면 이번은 거른다
      leaper.wait = random(LEAP.gap[0], LEAP.gap[1]);
      for (let attempt = 0; attempt < 24; attempt++) {
        const [x, z] = water[Math.floor(Math.random() * water.length)];
        const dx = x + random(-1, 1) - eyeX;
        const dz = z + random(-1, 1) - eyeZ;
        const distance = Math.hypot(dx, dz);
        if (distance < LEAP_RANGE[0] || distance > LEAP_RANGE[1]) continue;
        if ((dx * forward.x + dz * forward.z) / distance < 0.35) continue;
        const angle = Math.random() * Math.PI * 2;
        leaper.x = eyeX + dx;
        leaper.z = eyeZ + dz;
        leaper.dirX = Math.cos(angle);
        leaper.dirZ = Math.sin(angle);
        leaper.height = random(LEAP.height[0], LEAP.height[1]);
        leaper.reach = random(LEAP.reach[0], LEAP.reach[1]);
        leaper.time = 0;
        leaper.hasLanded = false;
        splash(part, leaper.x, leaper.z);
        break;
      }
      continue;
    }
    leaper.time += dt;
    const u = leaper.time / LEAP.seconds;
    if (u > 0.93 && !leaper.hasLanded) {
      leaper.hasLanded = true;
      splash(part, leaper.x + leaper.dirX * leaper.reach, leaper.z + leaper.dirZ * leaper.reach);
    }
    if (u >= 1.08) {
      leaper.time = -1;
      continue;
    }
    // 포물선 — 물낯 아래에서 솟아 물낯 아래로 든다. 몸은 나아가는 쪽을 따라 휜다
    const along = leaper.reach * u;
    const y = -0.18 + 4 * (leaper.height + 0.18) * u * (1 - u);
    leaper.mesh.visible = y > -0.25;
    leaper.mesh.position.set((leaper.x + leaper.dirX * along) * M, y * M, (leaper.z + leaper.dirZ * along) * M);
    velocity
      .set(leaper.dirX * leaper.reach, 4 * (leaper.height + 0.18) * (1 - 2 * u), leaper.dirZ * leaper.reach)
      .normalize();
    leaper.mesh.quaternion.setFromUnitVectors(part.nose, velocity);
    // 꼬리를 털며 몸을 뒤튼다
    leaper.mesh.rotateX(Math.sin(leaper.time * 26) * 0.35);
  }

  // 물결 고리 · 물방울
  part.rings.forEach((entry, index) => {
    entry.age += dt;
    const t = entry.age / SPLASH_SECONDS;
    const isShown = t < 1;
    setRippleAge(entry.ripple, t);
    if (isShown) {
      entry.ripple.mesh.position.set(entry.x * M, 0.03 * M, entry.z * M);
      entry.ripple.mesh.scale.setScalar(SPLASH_RADIUS * M);
    }
    for (let k = 0; k < SPLASH_DROPS; k++) {
      const i = index * SPLASH_DROPS + k;
      const angle = part.seeds[i * 2] * Math.PI * 2;
      const power = 0.5 + part.seeds[i * 2 + 1] * 0.7;
      const flight = Math.min(t * 1.6, 1);
      part.drops.position.setXYZ(
        i,
        (entry.x + Math.cos(angle) * power * 0.45 * flight) * M,
        (0.05 + power * 1.3 * flight * (1 - flight)) * M,
        (entry.z + Math.sin(angle) * power * 0.45 * flight) * M,
      );
      part.drops.size.setX(i, (0.05 + 0.04 * part.seeds[i * 2]) * M);
      part.drops.alpha.setX(i, isShown && flight < 1 ? 0.9 * (1 - flight * 0.6) : 0);
      part.drops.color.setXYZ(i, 0.93, 0.97, 1.0);
    }
  });
  part.drops.commit();
  part.drops.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
}
