/**
 * 강 밑 — 갈라진 강물 사이 강바닥 길, 머리 위에서 합쳐지는 수면, 바위 아래 조개밭(큰 방)과 석실, 그리고 숨.
 * 눈에 보이는 세계만 맡는다: 모래 바닥·물벽·수면·바위·물풀·조개껍데기·빛줄기·거품, 물속 안개와 소리, 숨이 다했을 때.
 * 퍼즐(정거장 · 고리문 · 석실)은 AirStations / RingDoor / InnerChamber 가 따로 든다. 카메라는 건드리지 않는다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { smoothstep } from "@/engine/math";
import { createRandom } from "@/engine/random";

import {
  PEBBLE_START_INDEX,
  buildBakedRockPrototypes,
  buildBakedWeedPrototypes,
  buildPebblePrototypes,
} from "../../models/nature";
import { MESH_NAMES } from "../../plan/meshNames";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { mangaInk } from "../../world/mangaStyle";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { showNotice } from "../interaction";
import { makeToonMaterial } from "../materials";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { M } from "../units";
import { DEEP_DROP, buildDoorWall, planDecor, seabedY } from "./caveDecor";
import {
  CORRIDOR,
  DOOR,
  FLOOR_Y,
  HALL,
  INNER,
  INNER_FLOOR,
  MERGE_Z,
  STEPS,
  SURFACE_Y,
  getBreath,
  getLastAirSpot,
  getUnderwater,
  isCaveShown,
  resetCaveState,
  setBreath,
  setCavePlayerFoot,
  setPartOpenness,
  setUnderwater,
  takeSandStir,
  teleportPlayer,
  tickBreath,
} from "./caveState";
import {
  buildGround,
  buildInstances,
  buildShellGeometry,
  makeCeilingMaterial,
  makeCurtainMaterial,
  makeSandMaterial,
  makeSeaweedMaterial,
  makeShaftTexture,
  normalizePrototype,
} from "./seabed";

/** 물이 갈라지는 데 걸리는 시간(초) */
const PART_SECONDS = 7;
/** 물속 안개 — 가깝고 푸르게. 멀리 바위 윤곽은 남게 */
const UNDERWATER_FOG = { color: new THREE.Color("#0C3644"), near: 1.5, far: 27 };
/** 갈라진 길 안 — 물벽 사이 물보라 빛. 길 끝까지 보여야 한다 */
const CORRIDOR_FOG = { color: new THREE.Color("#7FA6AE"), far: 46 };
/** 물벽 꼭대기 — 딱 수면까지. 수면 위 허공에는 아무것도 없다 */
const CURTAIN_TOP = SURFACE_Y - 0.02;
const CURTAIN_BOTTOM = FLOOR_Y - 1;
/** 물속에서 감추는 뭍 소품 — 동굴 바로 위에 있어 올려다보면 떠 보인다 */
const SURFACE_PROPS = new Set(["원경.나루터", "소품.나룻배"]);
/** 물벽이 끝나는 z — 큰 방 어귀 바위 바로 앞 */
const CURTAIN_END = 57.2;
const BUBBLES = 460;
/** 흔들림에 일어나는 모래 먼지 수 · 떠 있는 시간(초) · 흐려진 물빛 */
const SAND_COUNT = 320;
const SAND_LIFE = 4.5;
const SAND_MURK = new THREE.Color("#5C5A4A");
/** 고리문 앞 등불 세기 — 화톳불(2.6)보다 조금 약하게 */
const DOOR_LIGHT = 2.0;
/** 숨이 이 아래로 떨어지면 화면이 떨린다 */
const BREATH_WARNING = 5;

const STONE = { wall: "#4A534F", floor: "#4F5A56", rock: "#5E6B69", farRock: "#2E4A52" };

const smooth = (t: number) => smoothstep(Math.min(1, Math.max(0, t)));

/** 모래 먼지 · 거품 같은 빛점 묶음의 알갱이 상태 */
function createParticleState(count: number) {
  return {
    pos: Array.from({ length: count }, () => new THREE.Vector3()),
    vel: Array.from({ length: count }, () => new THREE.Vector3()),
    age: new Float32Array(count).fill(99),
    next: 0,
    carry: 0,
  };
}

function createCaveAssets() {
  const random = createRandom(991);
  const time = { value: 0 };
  const seabed = buildGround({
    width: 150,
    depth: 112,
    centerX: CORRIDOR.x,
    centerZ: CORRIDOR.zStart + 56,
    segmentsX: 190,
    segmentsZ: 150,
    heightAt: seabedY,
  });
  const rockMaterial = makeToonMaterial(STONE.rock, { vertexColors: true });
  const farRockMaterial = makeToonMaterial(STONE.farRock, { vertexColors: true });
  const seaweed = makeSeaweedMaterial(time);
  const shellMaterial = makeToonMaterial("#C9BDA6", { vertexColors: true, side: THREE.DoubleSide });
  const shaftTexture = makeShaftTexture();
  const materials = {
    wall: makeToonMaterial(STONE.wall, { emissive: new THREE.Color("#0E1A1E") }),
    floor: makeToonMaterial(STONE.floor),
    sand: makeSandMaterial(),
    curtain: makeCurtainMaterial(CURTAIN_BOTTOM, CURTAIN_TOP),
    ceiling: makeCeilingMaterial(),
    seaweed,
    rockMaterial,
    farRockMaterial,
    shellMaterial,
    shaft: new THREE.MeshBasicMaterial({
      map: shaftTexture,
      color: "#F4F7F5",
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    // 멀리 둘러친 벽 — 안개 색 그대로라 보이진 않지만, 바닥→벽→수면의 깊이가 이어져 지평선에 윤곽선이 안 생긴다
    horizon: new THREE.MeshBasicMaterial({ color: UNDERWATER_FOG.color, side: THREE.BackSide, fog: true }),
  };

  const plan = planDecor();
  const rockPrototypes = buildBakedRockPrototypes().map(normalizePrototype);
  const farPrototypes = buildBakedRockPrototypes(true).map(normalizePrototype);
  const pebblePrototypes = buildPebblePrototypes().slice(PEBBLE_START_INDEX).map(normalizePrototype);
  const weedPrototypes = buildBakedWeedPrototypes().map(normalizePrototype);
  const shellPrototypes = [
    buildShellGeometry(),
    buildShellGeometry(10, 18).scale(0.85, 1.2, 1),
    buildShellGeometry(12, 22).scale(1.15, 0.8, 0.9),
  ];
  const instances = [
    ...buildInstances(rockPrototypes, plan.rocks, rockMaterial),
    ...buildInstances(farPrototypes, plan.farRocks, farRockMaterial),
    ...buildInstances(pebblePrototypes, plan.pebbles, rockMaterial),
    ...buildInstances(weedPrototypes, plan.weeds, seaweed),
    ...buildInstances(shellPrototypes, plan.shells, shellMaterial),
  ];
  const prototypes = [...rockPrototypes, ...farPrototypes, ...pebblePrototypes, ...weedPrototypes, ...shellPrototypes];

  // 일어난 모래 — 흔들림에 바닥에서 피어올라 물을 흐린다
  const silt = makeGlowPoints(SAND_COUNT, { additive: false, softness: 0.9 });
  const bubbles = makeGlowPoints(BUBBLES, { additive: false, softness: 1.4 });
  const bubbleSeeds = new Float32Array(BUBBLES * 3);
  for (let i = 0; i < BUBBLES; i++) {
    bubbleSeeds[i * 3] = random();
    bubbleSeeds[i * 3 + 1] = random();
    bubbleSeeds[i * 3 + 2] = random();
    // 반은 거품, 반은 떠다니는 티끌
    const isDust = i % 2 === 1;
    bubbles.size.setX(i, isDust ? 0.012 + random() * 0.02 : 0.025 + random() * 0.05);
    bubbles.color.setXYZ(i, 0.78, 0.92, 0.95);
  }
  bubbles.points.visible = false;
  return {
    time,
    seabed,
    doorWall: buildDoorWall(),
    materials,
    instances,
    prototypes,
    shafts: plan.shafts,
    shaftTexture,
    bubbles,
    bubbleSeeds,
    silt,
    siltState: createParticleState(SAND_COUNT),
  };
}

function disposeCaveAssets(assets: ReturnType<typeof createCaveAssets>) {
  assets.seabed.dispose();
  assets.doorWall.dispose();
  assets.prototypes.forEach((geometry) => geometry.dispose());
  assets.instances.forEach((mesh) => mesh.dispose());
  Object.values(assets.materials).forEach((material) => material.dispose());
  assets.shaftTexture.dispose();
  for (const glow of [assets.bubbles, assets.silt]) {
    glow.points.geometry.dispose();
    glow.material.dispose();
  }
}

type SiltState = ReturnType<typeof createParticleState>;
type Silt = ReturnType<typeof makeGlowPoints>;

/** 흔들림에 모래가 인다 — 바닥에서 모래 먼지가 피어올라 떠돌다 가라앉는다 */
function updateSilt(
  silt: Silt,
  state: SiltState,
  stir: number,
  isUnderwater: boolean,
  x: number,
  z: number,
  dt: number,
) {
  if (isUnderwater && stir > 0.02) {
    state.carry += stir * 140 * dt;
    while (state.carry >= 1) {
      state.carry -= 1;
      const k = state.next;
      state.next = (state.next + 1) % SAND_COUNT;
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 4.5;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      state.pos[k].set(sx, seabedY(sx, sz) + 0.05, sz);
      state.vel[k].set((Math.random() - 0.5) * 0.4, 0.35 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4);
      state.age[k] = 0;
    }
  }
  for (let k = 0; k < SAND_COUNT; k++) {
    state.age[k] += dt;
    const age = state.age[k];
    if (age > SAND_LIFE) {
      silt.alpha.setX(k, 0);
      continue;
    }
    state.vel[k].multiplyScalar(Math.exp(-dt * 1.1));
    state.vel[k].y -= 0.05 * dt;
    state.pos[k].addScaledVector(state.vel[k], dt);
    const pos = state.pos[k];
    silt.position.setXYZ(k, pos.x * M, pos.y * M, pos.z * M);
    const t = age / SAND_LIFE;
    silt.size.setX(k, 0.18 + t * 0.9);
    silt.alpha.setX(k, 0.32 * Math.min(1, age * 4) * (1 - t));
    silt.color.setXYZ(k, 0.62, 0.57, 0.46);
  }
  silt.commit();
}

/** 거품·티끌 — 카메라 둘레 상자 안에서 떠오른다 */
function updateBubbles(bubbles: Silt, seeds: Float32Array, mix: number, x: number, z: number, time: number) {
  const box = 16;
  const height = SURFACE_Y - FLOOR_Y;
  for (let i = 0; i < BUBBLES; i++) {
    const seedX = seeds[i * 3];
    const seedY = seeds[i * 3 + 1];
    const seedZ = seeds[i * 3 + 2];
    const isDust = i % 2 === 1;
    const bx = x + (((((seedX - 0.5) * box - x + box * 0.5) % box) + box) % box) - box * 0.5;
    const bz = z + (((((seedZ - 0.5) * box - z + box * 0.5) % box) + box) % box) - box * 0.5;
    const by = FLOOR_Y + ((seedY * height + time * (isDust ? 0.04 + seedX * 0.05 : 0.25 + seedX * 0.3)) % height);
    bubbles.position.setXYZ(
      i,
      (bx + Math.sin(time * (isDust ? 0.4 : 1.3) + i) * (isDust ? 0.25 : 0.08)) * M,
      by * M,
      bz * M,
    );
    bubbles.alpha.setX(i, mix * (isDust ? 0.3 : 0.55) * (1 - (by - FLOOR_Y) / height));
  }
  bubbles.commit();
}

export default function CaveWorld() {
  const stage = useRitualStage();
  const isShown = isCaveShown();
  const { scene, gl, camera } = useThree();

  const assets = useMemo(() => createCaveAssets(), []);
  useEffect(() => () => disposeCaveAssets(assets), [assets]);

  const partedAt = useRef(-1);
  const underwaterMix = useRef(0);
  const murk = useRef(0);
  const wasUnderwater = useRef(false);
  const clipPlanes = useRef<THREE.Plane[] | null>(null);
  const curtains = useRef<THREE.Mesh[]>([]);
  const horizonWall = useRef<THREE.Mesh>(null);

  // 동굴 바로 위 뭍 소품(나루터 · 나룻배) — 물속에서 올려다보면 허공에 뜬 돌처럼 보여서, 물속에 있는 동안만 감춘다
  const surfaceProps = useRef<{ meshes: THREE.Object3D[]; hidden: boolean } | null>(null);
  const hideSurfaceProps = (hide: boolean) => {
    if (!surfaceProps.current) {
      if (!hide) return;
      const meshes: THREE.Object3D[] = [];
      scene.traverse((node) => {
        if (SURFACE_PROPS.has(node.name)) meshes.push(node);
      });
      // 아직 안 읽힌 모형이면 다음 장면에서 다시 찾는다
      if (!meshes.length) return;
      surfaceProps.current = { meshes, hidden: false };
    }
    const props = surfaceProps.current;
    if (props.hidden === hide) return;
    props.hidden = hide;
    for (const mesh of props.meshes) mesh.visible = !hide;
  };

  // 물이 갈라지면 강 수면과 강바닥 메시를 길 폭만큼 잘라 낸다 — 재질은 안 바꾸고 자르는 면만 건다.
  // 강바닥 지형이 길보다 높아서 안 자르면 길 위에 검은 판처럼 덮인다. 길 구간(z 44.5~58)에서만 자른다
  useEffect(() => {
    if (!isShown) return undefined;
    const names = new Set<string>([
      MESH_NAMES.riverSurface,
      MESH_NAMES.ground,
      MESH_NAMES.riverStones,
      MESH_NAMES.groundPebbles,
    ]);
    const materials = new Set<THREE.Material>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // 이름 없는 땅 밑받침(NajuScene 의 어두운 상자)도 — 길이 그 밑으로 내려가서 안 자르면 검은 판으로 길을 덮는다
      const isBaseSlab =
        mesh.geometry.type === "BoxGeometry" && (list[0] as THREE.MeshToonMaterial)?.color?.getHexString() === "2e323a";
      if (names.has(mesh.name) || isBaseSlab) for (const material of list) if (material) materials.add(material);
    });
    if (!materials.size) return undefined;
    const planes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), CORRIDOR.x * M),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -CORRIDOR.x * M),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), CORRIDOR.zStart * M),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -CORRIDOR.zEnd * M),
    ];
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    materials.forEach((material) => {
      material.clippingPlanes = planes;
      material.clipIntersection = true;
      material.needsUpdate = true;
    });
    clipPlanes.current = planes;
    return () => {
      materials.forEach((material) => {
        material.clippingPlanes = null;
        material.clipIntersection = false;
        material.needsUpdate = true;
      });
      gl.localClippingEnabled = previous;
      clipPlanes.current = null;
    };
  }, [isShown, scene, gl]);

  // 물에서 나오면(강가로 돌아오면) 소리·안개를 되돌린다
  useEffect(() => {
    if (stage !== "cleared") return;
    setUnderwater(false);
    audio.setAmbientLevel(1);
    audio.setReverb(0.25);
    director.cue({ 날씨: "갬", 초: 0 });
  }, [stage]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuCaveDev", {
      teleport: (x: number, z: number) => teleportPlayer(x, z),
      setBreath,
      reset: resetCaveState,
    });
  }, []);

  useFrame((_, dt) => {
    const time = performance.now() / 1000;
    // 물속에서는 만화 선을 먹빛으로 — 둘레 등빛을 타 갈색으로 물들지 않게
    mangaInk.black = isShown && getUnderwater() ? 1 : 0;
    hideSurfaceProps(isShown && getUnderwater());
    // 발 자리 — 눈높이에서 키(1.25 m)만큼 아래
    setCavePlayerFoot(camera.position.x / M, camera.position.y / M - 1.25, camera.position.z / M);
    if (!isShown) {
      if (partedAt.current >= 0) {
        partedAt.current = -1;
        setPartOpenness(0);
        assets.bubbles.points.visible = false;
      }
      return;
    }
    // 갈라짐
    if (partedAt.current < 0) {
      partedAt.current = time;
      audio.play("우르릉");
      showNotice("강물이 양쪽으로 갈라진다. 강바닥에 길이 드러났다.", 5);
    }
    const openness = THREE.MathUtils.smoothstep((time - partedAt.current) / PART_SECONDS, 0, 1);
    setPartOpenness(openness);
    // 갈라지는 동안 땅이 운다 — 지진처럼 흔들리고 우르릉이 겹친다
    if (openness < 1) {
      director.cue({ 카메라: "흔들림", 세기: dt * 1.4 });
      if (Math.floor((time - partedAt.current) / 2.2) !== Math.floor((time - partedAt.current - dt) / 2.2))
        audio.play("우르릉");
    }
    const gap = CORRIDOR.halfWidth * openness;
    if (clipPlanes.current) {
      clipPlanes.current[0].constant = (CORRIDOR.x - gap) * M;
      clipPlanes.current[1].constant = -(CORRIDOR.x + gap) * M;
    }
    curtains.current[0]?.position.setX(CORRIDOR.x - gap);
    curtains.current[1]?.position.setX(CORRIDOR.x + gap);
    assets.time.value = time;
    assets.materials.curtain.uniforms.uTime.value = time;
    assets.materials.ceiling.uniforms.uTime.value = time;
    assets.materials.sand.uniforms.uTime.value = time;

    // 물속 판정 — 길 끝(MERGE_Z)을 지나면 물이 머리 위에서 합쳐진다
    const x = camera.position.x / M;
    const z = camera.position.z / M;
    const isUnderwater = getUnderwater() ? z > MERGE_Z - 1 : z > MERGE_Z;
    if (isUnderwater !== wasUnderwater.current) {
      wasUnderwater.current = isUnderwater;
      setUnderwater(isUnderwater);
      audio.setAmbientLevel(isUnderwater ? 0.1 : 1);
      audio.setReverb(isUnderwater ? 0.55 : 0.25);
      // 물속에서는 비가 안 보인다 — 걷히는 큐를 길게 걸고, 올라오면 바로 끝낸다
      director.cue({ 날씨: "갬", 초: isUnderwater ? 3600 : 0 });
      if (isUnderwater) {
        audio.play("첨벙");
        director.cue({ 카메라: "흔들림", 세기: 0.8 });
        if (ritual.stage() === "parted") {
          ritual.enterCave();
          showNotice("물이 머리 위에서 닫혔다. 숨은 60초 — 거품이 솟는 곳에 서면 다시 찬다.", 5.5);
        }
      }
    }
    // 안개 — 연출(director)이 이 프레임에 써 둔 값 위에 물속 색을 섞는다
    underwaterMix.current += ((isUnderwater ? 1 : 0) - underwaterMix.current) * Math.min(1, dt * 2.5);
    const mix = underwaterMix.current;
    assets.materials.sand.uniforms.uCaustic.value = 0.2 + mix * 0.5;
    if (horizonWall.current) horizonWall.current.visible = mix > 0.3;
    // 갈라진 길 안에서는 비안개 대신 물보라 빛 — 길이 잿빛 네모로 뭉개지지 않게 멀리까지 보인다
    const inCorridor = isUnderwater
      ? 0
      : smooth((z - (CORRIDOR.zStart - 3)) / 3) * smooth((CORRIDOR.halfWidth + 3 - Math.abs(x - CORRIDOR.x)) / 2);
    if (scene.fog instanceof THREE.Fog && (mix > 0.001 || inCorridor > 0.001)) {
      if (inCorridor > 0.001) {
        scene.fog.color.lerp(CORRIDOR_FOG.color, inCorridor);
        scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, CORRIDOR_FOG.far * M, inCorridor);
      }
      scene.fog.color.lerp(UNDERWATER_FOG.color, mix);
      scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, UNDERWATER_FOG.near * M, mix);
      scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, UNDERWATER_FOG.far * M, mix);
      if ((scene.background as THREE.Color | null)?.isColor) (scene.background as THREE.Color).copy(scene.fog.color);
    }
    // 흔들림에 모래가 일어 물이 잠깐 흐려진다 — 안개가 가까이 오고 모래빛이 섞인다
    const stir = takeSandStir(dt);
    updateSilt(assets.silt, assets.siltState, stir, isUnderwater, x, z, dt);
    assets.silt.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
    murk.current += (Math.min(1, stir) - murk.current) * Math.min(1, dt * 2);
    if (isUnderwater && scene.fog instanceof THREE.Fog && murk.current > 0.01) {
      scene.fog.far *= 1 - 0.55 * murk.current;
      scene.fog.near *= 1 - 0.6 * murk.current;
      scene.fog.color.lerp(SAND_MURK, murk.current * 0.45);
      if ((scene.background as THREE.Color | null)?.isColor) (scene.background as THREE.Color).copy(scene.fog.color);
    }
    // 숨이 얼마 안 남으면 화면이 떨린다
    if (isUnderwater && getBreath() < BREATH_WARNING)
      director.cue({ 카메라: "흔들림", 세기: dt * (1.2 + (BREATH_WARNING - getBreath()) * 0.4) });
    if (tickBreath(dt, x, z)) {
      const spot = getLastAirSpot();
      teleportPlayer(spot.x, spot.z);
      audio.play("전환");
      showNotice("숨이 다했다. 마지막으로 숨 쉰 자리로 돌아왔다.", 4);
    }

    const { bubbles } = assets;
    bubbles.points.visible = mix > 0.05;
    if (bubbles.points.visible) {
      bubbles.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
      updateBubbles(bubbles, assets.bubbleSeeds, mix, x, z, time);
    }
    assets.materials.shaft.opacity = 0.13 + 0.05 * Math.sin(time * 0.9);
  });

  if (!isShown) return null;
  const { materials } = assets;
  const curtainHeight = CURTAIN_TOP - CURTAIN_BOTTOM;
  const curtainY = (CURTAIN_TOP + CURTAIN_BOTTOM) / 2;
  const stepsEnd = STEPS.zStart + STEPS.depth * STEPS.count;
  return (
    <>
      <group scale={M}>
        {/* 모래 바닥 — 길 · 큰 방 · 그 너머 깊은 데까지 한 장 */}
        <mesh geometry={assets.seabed} material={materials.sand} receiveShadow />
        {/* 바위 · 자갈 · 물풀 · 조개껍데기 */}
        {assets.instances.map((mesh, i) => (
          <primitive key={i} object={mesh} />
        ))}
        {/* 고리문이 앉는 돌벽 — 구멍이 뚫려 있고 두께가 곧 석실로 가는 통로 */}
        <mesh geometry={assets.doorWall} material={materials.wall} position={[0, 0, HALL.z[1]]} />
        {/* 석실 — 돌로 깐 한 단 높은 바닥 */}
        <mesh
          material={materials.floor}
          position={[(INNER.x[0] + INNER.x[1]) / 2, INNER_FLOOR - 0.2, (HALL.z[1] + INNER.z[1] + 0.6) / 2]}
          receiveShadow
        >
          <boxGeometry args={[INNER.x[1] - INNER.x[0] + 1, 0.4, INNER.z[1] + 0.6 - HALL.z[1]]} />
        </mesh>
        {/* 문 앞 낮은 돌계단 — 올라서면 문까지 평평한 단 */}
        {Array.from({ length: STEPS.count }, (_, i) => i + 1).map((step) => (
          <mesh
            key={step}
            material={materials.floor}
            position={[CORRIDOR.x, FLOOR_Y + (STEPS.rise * step) / 2, STEPS.zStart + STEPS.depth * (step - 0.5)]}
          >
            <boxGeometry args={[STEPS.halfWidth * 2, STEPS.rise * step, STEPS.depth]} />
          </mesh>
        ))}
        <mesh
          material={materials.floor}
          position={[CORRIDOR.x, FLOOR_Y + (INNER_FLOOR - FLOOR_Y) / 2, (stepsEnd + DOOR.z) / 2]}
        >
          <boxGeometry args={[STEPS.halfWidth * 2, INNER_FLOOR - FLOOR_Y, DOOR.z - stepsEnd]} />
        </mesh>
        {/* 수면 — 길 끝부터 멀리까지 천장 */}
        <mesh
          material={materials.ceiling}
          position={[CORRIDOR.x, SURFACE_Y, MERGE_Z + 60]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[160, 121]} />
        </mesh>
        {/* 물벽 — 갈라진 강물. 바닥에서 수면까지. 자리는 매 프레임 벌어진 폭을 따른다 */}
        {[0, 1].map((side) => (
          <mesh
            key={side}
            ref={(mesh) => {
              if (mesh) curtains.current[side] = mesh;
            }}
            material={materials.curtain}
            position={[CORRIDOR.x, curtainY, (CORRIDOR.zStart + CURTAIN_END) / 2]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[CURTAIN_END - CORRIDOR.zStart, curtainHeight]} />
          </mesh>
        ))}
        {/* 멀리 둘러친 벽(안개 속) — 물속에서만. 수면 위까지 높아야 수면 너머로 빈 하늘이 안 새어 윤곽선이 안 생긴다 */}
        <mesh
          ref={horizonWall}
          material={materials.horizon}
          position={[CORRIDOR.x, (FLOOR_Y - DEEP_DROP - 4 + 40) / 2, 68]}
          visible={false}
        >
          <cylinderGeometry args={[72, 72, 40 - (FLOOR_Y - DEEP_DROP - 4), 48, 1, true]} />
        </mesh>
        {/* 고리문 앞 · 밸브 옆 — 돌벽이 그늘에 묻히지 않게 */}
        <pointLight
          position={[CORRIDOR.x, FLOOR_Y + 3.2, HALL.z[1] - 4]}
          color="#BFE8EA"
          intensity={DOOR_LIGHT}
          distance={13 * M}
          decay={1.4}
        />
        <pointLight
          position={[CORRIDOR.x - 4, FLOOR_Y + 2.2, HALL.z[1] - 2]}
          color="#F2D9A8"
          intensity={DOOR_LIGHT * 0.6}
          distance={7 * M}
          decay={1.4}
        />
        <pointLight
          position={[CORRIDOR.x, INNER_FLOOR + 2.6, INNER.z[0] + 4]}
          color="#BFE8EA"
          intensity={DOOR_LIGHT * 0.8}
          distance={10 * M}
          decay={1.4}
        />
        {/* 빛줄기 — 비스듬히 내려온다 */}
        {assets.shafts.map((shaft, i) => (
          <mesh
            key={i}
            material={materials.shaft}
            position={[shaft.x, (FLOOR_Y + SURFACE_Y) / 2, shaft.z]}
            rotation={[0, shaft.yaw, shaft.tilt]}
          >
            <planeGeometry args={[shaft.width, SURFACE_Y - FLOOR_Y + 2]} />
          </mesh>
        ))}
      </group>
      <primitive object={assets.bubbles.points} />
      <primitive object={assets.silt.points} />
    </>
  );
}
