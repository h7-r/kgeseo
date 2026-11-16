/**
 * 바위 위 만나던 자리의 물건들 — 선바위 · 너럭바위 · 받침돌 둘 · 사발 셋 · 독의 물 · 흙에 묻힌 귀때동이와,
 * 달빛 줄기 · 선바위에 맺힌 달빛. 진행은 BowlRite 가 맡고, 여기는 만들고 재는 것만 한다. 깨진 뒤의 것은 spill 이 맡는다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import * as THREE from "three";

import { walkTerrain } from "../../movement/playerPose";
import { makeMistTexture } from "../glowTexture";
import { M, groundY } from "../units";
import {
  BOWLS,
  BOWL_SIZES,
  BOWL_WATER,
  JAR,
  JUG,
  MOON_DIR,
  REFLECT_DIR,
  SEAT,
  STANDING,
  type BowlSize,
} from "./cliffShape";
import { createMoonClip } from "./moonClip";

export const MODELS = {
  standing: "/_sf_local/lib/ast-terrain-engraved-rock-01.glb",
  seat: "/_sf_local/lib/ast-terrain-flat-water-rock-01.glb",
  stoneMedium: "/_sf_local/lib/ast-terrain-garden-rock-b-01.glb",
  stoneSmall: "/_sf_local/lib/ast-terrain-rock-round-01.glb",
  jar: "/_sf_local/lib/ast-prop-jar-onggi-01.glb",
  jug: "/_sf_local/lib/ast-prop-spouted-jar-gwittae-01.glb",
  bowl: "/_sf_local/lib/ast-prop-sabal-rice-bowl-01.glb",
} as const;

/** 선바위 몸통(미터) — 충돌 상자 반폭 */
export const STANDING_HALF = { x: 0.72, z: 0.58 };
/** 너럭바위 윗면 높이(땅에서, 미터) — 모형을 읽기 전 어림 */
export const SEAT_TOP = 0.5;
/** 달빛 줄기 굵기(미터) — 사발 지름에 곱한다 · 하늘에서 내려오는 줄기 길이 */
const BEAM_WIDTH = 0.15;
const MOONBEAM_LENGTH = 9;
/** 선바위에 번지는 달빛 — 사발 지름에 곱한 가로 · 세로. 둥근 빛무리가 아니라 옆으로 퍼진 안개결이다 */
const GLOW_SCALE = { wide: 6.2, tall: 3.6 };
/** 물낯에 비친 달 — 사발 지름에 곱한 가로 · 세로. 잔물결에 옆으로 길게 풀린다 */
const WATER_MOON_SCALE = { wide: 0.5, tall: 0.2 };
const UP = new THREE.Vector3(0, 1, 0);

export const floorAt = (x: number, z: number) => walkTerrain.current?.groundAt(x, z).y ?? groundY(x, z);
export const planar = (x: number, z: number, lift = 0) => new THREE.Vector3(x * M, (floorAt(x, z) + lift) * M, z * M);

/**
 * 달빛 줄기 재질 — 빛기둥이 아니라 밤안개에 비친 달빛이다. 가늘고 옅으며, 결이 고르지 않게 흐른다.
 * 가장자리는 풀리고(면이 눈을 보는 정도) 길이를 따라 옅어진다. 눈앞을 지나는 부분은 옅다.
 * uFade.x 는 밑동 세기, uFade.y 는 끝 세기.
 */
function makeBeamMaterial(fadeFrom: number, fadeTo: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uFade: { value: new THREE.Vector2(fadeFrom, fadeTo) },
      uNear: { value: 2.6 * M },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vAround;
      varying float vFacing;
      varying float vDepth;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vAlong = uv.y;
        vAround = uv.x;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-viewPosition.xyz)));
        vDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform float uTime;
      uniform vec2 uFade;
      uniform float uNear;
      varying float vAlong;
      varying float vAround;
      varying float vFacing;
      varying float vDepth;
      #include <logdepthbuf_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        #include <logdepthbuf_fragment>
        float soft = pow(vFacing, 2.6);
        float along = mix(uFade.x, uFade.y, vAlong);
        // 줄기를 따라 오르는 안개결 — 고르지 않아 기둥으로 읽히지 않는다(vAround 0/1 이음매는 풀린 가장자리에 묻힌다)
        float wisp = noise(vec2(vAround * 5.0, vAlong * 7.0 - uTime * 0.22));
        wisp = 0.35 + 0.65 * wisp * (0.6 + 0.4 * noise(vec2(vAround * 11.0 + 3.0, vAlong * 19.0 - uTime * 0.4)));
        float near = smoothstep(uNear * 0.35, uNear, vDepth);
        gl_FragColor = vec4(0.8, 0.87, 1.0, uStrength * soft * along * wisp * near * 0.12);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** 줄기 하나 — 밑동이 원점, +y 로 길이 1. 놓을 때 길이와 방향을 맞춘다 */
function makeBeam(radius: number, flare: number, fadeFrom: number, fadeTo: number) {
  const material = makeBeamMaterial(fadeFrom, fadeTo);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * flare * M, radius * M, 1, 14, 1, true).translate(0, 0.5, 0),
    material,
  );
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** 달빛이 번진 자리 — 안개결 얼룩. wide · tall 은 가로 · 세로(미터) */
function makeMistSprite(color: string, wide: number, tall: number, seed: number) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeMistTexture(seed),
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  sprite.scale.set(wide * M, tall * M, 1);
  sprite.visible = false;
  return sprite;
}

/** 물낯 — 짙은 쪽빛 원반. 밑이 원점인 그릇의 height 높이에 놓인다(미터) */
export function makeWaterDisc(radius: number, height: number) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28).rotateX(-Math.PI / 2).translate(0, height, 0),
    new THREE.MeshBasicMaterial({ color: "#1B2A42", transparent: true, opacity: 0.94 }),
  );
  mesh.visible = false;
  return mesh;
}

/**
 * 땅을 따라 누운 띠 — 점들(미터, 땅 위 자리)을 부드럽게 이어 너비만큼 편다. uv.x 가 나아가는 쪽(0~1), uv.y 가 가로.
 * wobble 이 크면 너비가 흐르며 넓어졌다 좁아진다.
 */
export function buildGroundRibbon(points: readonly (readonly [number, number])[], width: number, wobble = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const count = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const at = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    curve.getPointAt(t, at);
    curve.getTangentAt(t, tangent);
    // 흐르며 조금씩 넓어졌다 좁아진다
    const half = (width / 2) * (1 - wobble * 0.3 + wobble * 0.5 * Math.sin(t * 9 + points[0][0]) ** 2);
    const sideX = -tangent.z * half;
    const sideZ = tangent.x * half;
    for (const s of [-1, 1]) {
      const x = at.x + sideX * s;
      const z = at.z + sideZ * s;
      positions.push(x * M, (floorAt(x, z) + 0.012) * M, z * M);
      uvs.push(t, s < 0 ? 0 : 1);
    }
    if (i < count) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function buildBowl(size: BowlSize) {
  const { diameter } = BOWLS[size];
  const group = new THREE.Group();
  group.scale.setScalar(M);
  // 온전한 사발(모형은 뒤에 끼운다) — 깨진 조각은 spill 이 이 무리에 단다
  const whole = new THREE.Group();
  group.add(whole);
  const water = makeWaterDisc(diameter * BOWL_WATER.radius, diameter * BOWL_WATER.height);
  group.add(water);
  return {
    size,
    diameter,
    group,
    whole,
    water,
    /** 물에 비친 달 — 눈 자리에 따라 물낯 위를 옮겨 다닌다 */
    moon: makeMistSprite(
      "#FFF8E2",
      diameter * WATER_MOON_SCALE.wide,
      diameter * WATER_MOON_SCALE.tall,
      3 + diameter * 100,
    ),
    /** 하늘 달 → 사발 · 사발 → 선바위 줄기 · 선바위에 맺힌 달빛 */
    moonbeam: makeBeam((diameter * BEAM_WIDTH) / 2, 3.2, 1, 0),
    // 선바위로 가며 넓게 풀려, 닿는 데서는 안개결과 이어진다
    reflect: makeBeam((diameter * BEAM_WIDTH) / 2, 4.5, 0.9, 0.5),
    glow: makeMistSprite("#DCE6FF", diameter * GLOW_SCALE.wide, diameter * GLOW_SCALE.tall, 11 + diameter * 100),
    /** 엎어져 있는 자리 · 받침 윗면 · 달빛이 닿는 선바위 자리(유닛) — 모형을 읽은 뒤 잰다 */
    startAt: planar(BOWLS[size].start.x, BOWLS[size].start.z),
    restAt: planar(BOWLS[size].rest.x, BOWLS[size].rest.z, BOWLS[size].stone ? BOWLS[size].stone * 0.6 : SEAT_TOP),
    hitAt: new THREE.Vector3(),
    /** 겨누는 자리 — 엎어진 사발 · 받침 */
    startTarget: new THREE.Vector3(),
    restTarget: new THREE.Vector3(),
    /** 달빛이 켜진 정도 0~1 · 물이 출렁이는 정도 */
    lit: 0,
    ripple: 0,
  };
}

export type RiteBowl = ReturnType<typeof buildBowl>;

export function buildRite() {
  const root = new THREE.Group();
  root.name = "cliff.bowlRite";
  const bowls = BOWL_SIZES.map((size) => buildBowl(size));
  for (const bowl of bowls) root.add(bowl.group, bowl.moon, bowl.moonbeam.mesh, bowl.reflect.mesh, bowl.glow);
  bowls.forEach((bowl) => {
    bowl.moonbeam.mesh.scale.y = MOONBEAM_LENGTH * M;
    bowl.moonbeam.mesh.quaternion.setFromUnitVectors(UP, MOON_DIR);
    bowl.reflect.mesh.quaternion.setFromUnitVectors(UP, REFLECT_DIR);
  });

  // 독의 물 — 아가리 크기를 모형에서 재어 채운다
  const jarWater = makeWaterDisc(1, 0);
  const jarMoon = makeMistSprite("#FFF8E2", 0.2, 0.08, 5);
  root.add(jarWater, jarMoon);

  // 귀때동이 — 흙에 묻혀 있다
  const jug = new THREE.Group();
  jug.position.copy(planar(JUG.x, JUG.z, -JUG.buried));
  jug.rotation.set(0.1, -0.6, -0.14);
  jug.scale.setScalar(M);
  root.add(jug);

  // 영상 판은 root 에 넣지 않는다 — BowlRite 가 후처리 뒤에 따로 그린다(filmClip.useFilmClipLayer)
  const play = createMoonClip();

  const normal = new THREE.Vector3(Math.sin(STANDING.yaw), 0, Math.cos(STANDING.yaw));
  return {
    root,
    bowls,
    jarWater,
    jarMoon,
    /** 독 물낯 가운데(유닛) · 반지름(미터) — 모형을 읽은 뒤 잰다 */
    jarWaterAt: planar(JAR.x, JAR.z, JAR.size * 0.9),
    jarWaterRadius: 0.12,
    jug,
    play,
    /** 선바위 앞면이 보는 쪽(받침돌 쪽) */
    normal,
    jarTarget: planar(JAR.x, JAR.z, JAR.size * 0.8),
    jugTarget: planar(JUG.x, JUG.z, 0.16),
    standingTarget: planar(STANDING.x, STANDING.z, 1.3).addScaledVector(normal, STANDING_HALF.z * M),
    seatTarget: planar(SEAT.x - 0.35, SEAT.z, SEAT_TOP),
  };
}

export type Rite = ReturnType<typeof buildRite>;

/** 물낯 가운데(유닛) — 받침에 놓인 사발 */
export function waterCenterOf(bowl: RiteBowl, out: THREE.Vector3) {
  return out.copy(bowl.restAt).setY(bowl.restAt.y + bowl.diameter * BOWL_WATER.height * M);
}

/**
 * 물에 비친 달을 놓는다 — 눈에서 물낯으로 내려간 시선이 달을 거꾸로 비추는 자리. 물낯 밖이면 안 보인다.
 * center 물낯 가운데(유닛) · radius 물낯 반지름(미터)
 */
export function placeWaterMoon(
  sprite: THREE.Sprite,
  center: THREE.Vector3,
  radius: number,
  camera: THREE.Camera,
  strength: number,
) {
  const material = sprite.material;
  const height = camera.position.y - center.y;
  sprite.visible = false;
  if (height <= 0 || strength <= 0) return;
  const reach = height / MOON_DIR.y;
  const x = camera.position.x + MOON_DIR.x * reach;
  const z = camera.position.z + MOON_DIR.z * reach;
  const off = Math.hypot(x - center.x, z - center.z) / M;
  if (off >= radius) return;
  sprite.visible = true;
  sprite.position.set(x, center.y + 0.004 * M, z);
  material.opacity = Math.min(1, (1 - off / radius) * 1.6) * strength * 0.6;
}

/** 독 아가리 안쪽을 재어 물낯을 채운다 — 맨 위 띠의 꼭짓점 중 축에 가장 가까운 것이 아가리 안쪽이다 */
export function fillJar(rite: Rite, jar: THREE.Object3D) {
  jar.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(jar);
  const center = box.getCenter(new THREE.Vector3());
  const rimFrom = box.max.y - (box.max.y - box.min.y) * 0.05;
  let inner = Infinity;
  const vertex = new THREE.Vector3();
  jar.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (vertex.y >= rimFrom) inner = Math.min(inner, Math.hypot(vertex.x - center.x, vertex.z - center.z));
    }
  });
  const radius = (Number.isFinite(inner) ? inner : 0.14 * M) * 0.97;
  rite.jarWaterRadius = radius / M;
  rite.jarWaterAt.set(center.x, box.max.y - (box.max.y - box.min.y) * 0.07, center.z);
  rite.jarWater.scale.set(radius, 1, radius);
  rite.jarWater.position.copy(rite.jarWaterAt);
  rite.jarWater.visible = true;
}

/** 물체 위로 내리쏴 (x, z) 미터 자리의 윗면 높이(유닛)를 잰다 — 못 맞히면 null */
export function topOf(object: THREE.Object3D, x: number, z: number) {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(x * M, (floorAt(x, z) + 4) * M, z * M),
    new THREE.Vector3(0, -1, 0),
  );
  const hit = ray.intersectObject(object, true)[0];
  return hit ? hit.point.y : null;
}

/** 사발 물에서 튄 달빛이 선바위에 닿는 자리 — 바위를 못 맞히면 바위 앞면 평면으로 잰다 */
export function measureHit(rite: Rite, bowl: RiteBowl, rock: THREE.Object3D | null) {
  const from = waterCenterOf(bowl, new THREE.Vector3());
  const hit = rock ? new THREE.Raycaster(from, REFLECT_DIR.clone(), 0, 14 * M).intersectObject(rock, true)[0] : null;
  if (hit) {
    bowl.hitAt.copy(hit.point);
    return;
  }
  const facePoint = planar(STANDING.x, STANDING.z).addScaledVector(rite.normal, STANDING_HALF.z * M);
  const distance = facePoint.sub(from).dot(rite.normal) / REFLECT_DIR.dot(rite.normal);
  bowl.hitAt.copy(from).addScaledVector(REFLECT_DIR, distance);
}
