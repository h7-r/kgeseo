/**
 * 물살을 타고 내려오는 빛 물고기 떼와 수면의 물살 결.
 * 물은 −x → +x 로 흐른다. 입구가 물살 위쪽을 본 통발 가까이 오면 끌려가 빨려 든다 — 잠깐 수면에 비쳤다 잠기기를 되풀이한다.
 */
import * as THREE from "three";

import { audio } from "../../scene/immersion/audio";
import type { GlowPoints } from "../glowPoints";
import { M } from "../units";
import { FULL_COUNT, fishTrapPuzzle } from "./fishTrapState";
import { EMBER, buildFishGeometry } from "./lightFish";
import type { Trap } from "./trapRig";

const FLOW = new THREE.Vector3(1, 0, 0);
/** 물고기가 도는 x 범위(미터) — 통발 둘레만. 길면 한 바퀴가 길어 통발이 늦게 찬다 */
const STREAM_X: [number, number] = [15, 25];
/** 물고기 길 — 통발이 가라앉은 줄보다 이만큼 먼 물(미터). 물가 바로 앞을 헤엄치면 너무 많이 보인다 */
export const LANE_OUT = 1.1;
const LANE_HALF = 0.55;
export const DEFAULT_LANE_Z = 45.1;
export const FISH_COUNT = 10;
/** 수면에 비치는 주기(초)와 그중 보이는 몫 — 늘 떠 있으면 물고기가 아니라 떠 있는 장식이다 */
const SHOW_CYCLE = 6;
const SHOW_DUTY = 0.2;
const FISH_Y = 0.02;
/** 입구에 이만큼(미터) 가까우면 빨려 들고, 이 거리부터 끌린다 */
const CATCH_RADIUS = 0.45;
const ATTRACT_RADIUS = 2.2;
/** 빨려 드는 데 걸리는 초 */
const DIVE_SECONDS = 0.7;

export interface Fish {
  /** 미터 */
  position: THREE.Vector3;
  heading: THREE.Vector3;
  speed: number;
  phase: number;
  state: "swim" | "dive";
  /** 빨려 들기 시작한 뒤 흐른 시간 */
  timer: number;
  /** 빨려 들기 시작한 자리 */
  from: THREE.Vector3;
  /** 수면에 비친 정도 0~1 */
  shown: number;
}

/** 시간 uniform — 꼬리 흔들림 셰이더가 본다 */
export type FishTime = { value: number };

const FORWARD = new THREE.Vector3(0, 0, 1);
const scratch = {
  want: new THREE.Vector3(),
  mouth: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  matrix: new THREE.Matrix4(),
};

/** 꼬리를 흔든다 — 뒤로 갈수록 크게 */
function makeFishMaterial(time: FishTime) {
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

export function spawnFish(laneZ: number, startAtHead: boolean): Fish {
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

export const createFishes = () => Array.from({ length: FISH_COUNT }, () => spawnFish(DEFAULT_LANE_Z, false));

/** 물고기 떼 인스턴스 — 통발 안에 든 물고기도 같은 모양 · 재질을 쓴다 */
export function buildSchool(time: FishTime, count = FISH_COUNT) {
  const mesh = new THREE.InstancedMesh(buildFishGeometry(), makeFishMaterial(time), count);
  const phases = new Float32Array(count).map(() => Math.random() * Math.PI * 2);
  mesh.geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/** 물살 결 — 수면 위로 흘러가는 짧은 흰 줄. 어느 쪽에서 흘러오는지 보이게 */
export function buildStreaks() {
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
export type Streaks = ReturnType<typeof buildStreaks>;

/**
 * 물고기 떼 한 프레임 — 물살을 따라 흐르다 불씨 드는 통발(catching, 물속 · 아직 덜 찬)에 끌려 빨려 든다.
 * 빨려 들면 통발의 잡은 수가 늘고 그 줄이 떨린다. 첫 불씨가 들면 통발이 「찼다」로 넘어간다
 */
export function updateShoreFish(
  fishes: Fish[],
  school: THREE.InstancedMesh,
  halos: GlowPoints,
  catching: Trap | null,
  laneZ: number,
  time: number,
  dt: number,
) {
  const target = catching && catching.place === "water" && catching.caught < FULL_COUNT ? catching : null;
  fishes.forEach((fish, i) => {
    if (fish.state === "swim") {
      const wantZ = laneZ + Math.sin(time * 0.5 + fish.phase) * LANE_HALF;
      scratch.want.set(FLOW.x, 0, (wantZ - fish.position.z) * 1.4);
      let isDrawn = false;
      if (target) {
        scratch.mouth.copy(target.mouthWater).divideScalar(M);
        const distance = Math.hypot(scratch.mouth.x - fish.position.x, scratch.mouth.z - fish.position.z);
        if (fish.position.x <= scratch.mouth.x + 0.1 && distance < ATTRACT_RADIUS) {
          isDrawn = true;
          const pull = 1 - distance / ATTRACT_RADIUS;
          scratch.want.x += (scratch.mouth.x - fish.position.x) * 3 * pull;
          scratch.want.z += (scratch.mouth.z - fish.position.z) * 3 * pull;
          if (distance < CATCH_RADIUS) {
            fish.state = "dive";
            fish.timer = 0;
            fish.from.copy(fish.position);
          }
        }
      }
      scratch.want.normalize();
      fish.heading.lerp(scratch.want, Math.min(1, dt * 3)).normalize();
      fish.position.addScaledVector(fish.heading, fish.speed * dt);
      // 잠깐 수면에 비쳤다가 다시 잠긴다. 통발로 끌려갈 때는 계속 보인다
      const cycle = SHOW_CYCLE + (fish.phase % 1) * 3;
      const isSurfaced = ((time + fish.phase * 5) / cycle) % 1 < SHOW_DUTY;
      fish.shown += ((isDrawn || isSurfaced ? 1 : 0) - fish.shown) * Math.min(1, dt * 2.5);
      fish.position.y = FISH_Y - (1 - fish.shown) * 0.1 + Math.sin(time * 2.4 + fish.phase) * 0.015;
      if (fish.position.x > STREAM_X[1]) Object.assign(fish, spawnFish(laneZ, true));
    } else {
      // 물속 입구로 빨려 들어간다
      fish.timer += dt;
      const t = Math.min(1, fish.timer / DIVE_SECONDS);
      scratch.mouth.copy(catching!.mouthWater).divideScalar(M);
      fish.position.lerpVectors(fish.from, scratch.mouth, t * t);
      if (t >= 1) {
        catching!.caught += 1;
        catching!.tug = 1;
        catching!.splashPending = true;
        audio.play("똑");
        if (catching!.caught === 1) fishTrapPuzzle.fill();
        Object.assign(fish, spawnFish(laneZ, true));
      }
    }

    scratch.want.set(fish.heading.x, 0, fish.heading.z);
    if (scratch.want.lengthSq() < 1e-6) scratch.want.copy(FLOW);
    scratch.quaternion.setFromUnitVectors(FORWARD, scratch.want.normalize());
    scratch.mouth.copy(fish.position).multiplyScalar(M);
    const fade = (fish.state === "dive" ? 1 - Math.min(1, fish.timer / DIVE_SECONDS) : 1) * fish.shown;
    scratch.scale.setScalar(M * Math.max(0.0001, fade));
    scratch.matrix.compose(scratch.mouth, scratch.quaternion, scratch.scale);
    school.setMatrixAt(i, scratch.matrix);
    halos.position.setXYZ(i, scratch.mouth.x, scratch.mouth.y, scratch.mouth.z);
    halos.size.setX(i, 0.42 * M);
    halos.alpha.setX(i, 0.32 * fade * (0.85 + Math.sin(time * 7 + fish.phase) * 0.15));
    halos.color.setXYZ(i, EMBER.r * 1.1, EMBER.g * 1.1, EMBER.b * 1.1);
  });
  school.instanceMatrix.needsUpdate = true;
  halos.commit();
}

/** 물살 결 한 프레임 — 끝에 닿으면 처음으로, 양 끝에서는 짧게 */
export function updateStreaks(streaks: Streaks, laneZ: number, dt: number) {
  streaks.items.forEach((streak, k) => {
    streak.x += streak.speed * dt;
    if (streak.x > STREAM_X[1]) streak.x = STREAM_X[0];
    const edge = Math.max(0.01, Math.min(1, (streak.x - STREAM_X[0]) / 1.5, (STREAM_X[1] - streak.x) / 1.5));
    scratch.mouth.set(streak.x * M, 0.012 * M, (laneZ + streak.dz) * M);
    scratch.scale.set(streak.length * M * edge, 1, 0.025 * M);
    scratch.matrix.compose(scratch.mouth, scratch.quaternion.identity(), scratch.scale);
    streaks.mesh.setMatrixAt(k, scratch.matrix);
  });
  streaks.mesh.instanceMatrix.needsUpdate = true;
}
