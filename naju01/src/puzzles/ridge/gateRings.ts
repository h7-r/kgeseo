/**
 * 장승 고리 수수께끼 — 장승마다 머리 고리 · 발 고리(그림 넷 중 하나가 앞을 본다). 정답은 궤 속 종이에.
 * 장승은 공개 에셋이라 늦게 서므로, 선 뒤에 광선으로 굵기를 재서 고리와 이름판을 단다. 단위는 미터, 그리는 것은 유닛
 */
import * as THREE from "three";

import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { makeNameTexture } from "./gateArt";
import { GATE, RIDGE_CENTER } from "./ridgeShape";

/** 고리 그림 — 칸 차례대로 */
export const SYMBOLS = ["해", "달", "물결", "새"] as const;
/** 장승 — GATE.posts 차례. 이름과 정답(머리 · 발 고리 그림 번호) */
export const POSTS = [
  { name: "천하대장군", answer: [1, 2] },
  { name: "지하여장군", answer: [0, 3] },
] as const;
/** 처음 고리 그림 — 정답이 아니게 */
const START = [
  [0, 3],
  [2, 1],
];
/** 고리 높이(땅 위 m) — 머리 · 발. 고리 두께 · 이름 새김 가운데 높이 */
const RING_HEIGHTS = [1.78, 0.5];
const RING_TALL = 0.2;
const NAME_HEIGHT = 1.12;

export interface Ring {
  mesh: THREE.Mesh;
  post: number;
  /** 0 머리 · 1 발 */
  slot: number;
  symbol: number;
  /** 지금 각 · 목표 각(rotation.y) */
  angle: number;
  target: number;
  /** 정면(rotation.y 기준) — 그림 0 이 앞을 볼 때의 각 */
  front: number;
  touch: THREE.Vector3;
}

/** 그림 symbol 이 정면을 볼 때의 rotation.y — 면 k 가운데는 원기둥 각 (k + 0.5)·45° */
export const angleFor = (front: number, symbol: number) => front - ((2 * symbol + 0.5) * Math.PI) / 4;

export const isSolved = (rings: Ring[]) => rings.every((ring) => ring.symbol === POSTS[ring.post].answer[ring.slot]);

/** 장승을 잰 결과로 만든 고리와 이름판. 못 재면(아직 안 섰으면) null */
export function buildPostRings(
  scene: THREE.Scene,
  camera: THREE.Camera,
  ringMaterial: THREE.Material,
): { rings: Ring[]; names: THREE.Mesh[] } | null {
  const ray = new THREE.Raycaster();
  ray.camera = camera;
  const targets: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && object.name.endsWith("장승")) targets.push(object);
  });
  if (!targets.length) return null;
  // 정면 — 두 장승을 잇는 줄에 수직, 능선 안쪽(돌단 · 문 앞에 선 사람 쪽)
  const [left, right] = GATE.posts;
  const frontDir = new THREE.Vector3(-(right.z - left.z), 0, right.x - left.x).normalize();
  if (frontDir.x * (RIDGE_CENTER.x - GATE.center.x) + frontDir.z * (RIDGE_CENTER.z - GATE.center.z) < 0)
    frontDir.negate();
  const side = new THREE.Vector3(-frontDir.z, 0, frontDir.x);
  const front = Math.atan2(frontDir.x, frontDir.z);
  const rings: Ring[] = [];
  const names: THREE.Mesh[] = [];
  for (let k = 0; k < GATE.posts.length; k++) {
    const post = GATE.posts[k];
    const ground = groundY(post.x, post.z);
    /** 그 높이에서 dir 쪽 겉면까지 거리(m) — 못 맞히면 null */
    const surface = (height: number, dir: THREE.Vector3) => {
      const origin = new THREE.Vector3(post.x, ground + height, post.z).addScaledVector(dir, 1.2).multiplyScalar(M);
      ray.set(origin, dir.clone().negate());
      ray.far = 1.2 * M;
      const hit = ray.intersectObjects(targets, false).find((entry) => entry.object.visible);
      return hit ? 1.2 - hit.distance / M : null;
    };
    const radii = RING_HEIGHTS.map((height) =>
      [frontDir, frontDir.clone().negate(), side, side.clone().negate()].map((dir) => surface(height, dir)),
    );
    // 이름 판이 걸친 높이 전체에서 가장 튀어나온 겉면 — 울퉁불퉁한 장승 몸에 글자 일부가 묻혀 잘리지 않게
    const half = (0.17 * POSTS[k].name.length) / 2;
    const depths = Array.from({ length: 9 }, (_, i) => surface(NAME_HEIGHT - half + (i / 8) * half * 2, frontDir));
    const known = depths.filter((depth): depth is number => depth !== null);
    if (radii.some((list) => list.some((r) => r === null)) || !known.length) return null;
    const nameDepth = Math.max(...known);
    RING_HEIGHTS.forEach((height, slot) => {
      const list = radii[slot] as number[];
      // 정면 · 뒤 · 양옆 가운데를 다시 잡고, 가장 먼 겉면에 손가락 하나 여유
      const cx = post.x + (frontDir.x * (list[0] - list[1]) + side.x * (list[2] - list[3])) / 2;
      const cz = post.z + (frontDir.z * (list[0] - list[1]) + side.z * (list[2] - list[3])) / 2;
      const radius = Math.max((list[0] + list[1]) / 2, (list[2] + list[3]) / 2) / Math.cos(Math.PI / 8) + 0.035;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * M, radius * M, RING_TALL * M, 8), ringMaterial);
      mesh.position.set(cx * M, (ground + height) * M, cz * M);
      mesh.castShadow = true;
      const symbol = START[k][slot];
      const angle = angleFor(front, symbol);
      mesh.rotation.y = angle;
      scene.add(mesh);
      rings.push({
        mesh,
        post: k,
        slot,
        symbol,
        angle,
        target: angle,
        front,
        touch: new THREE.Vector3(cx + frontDir.x * radius, ground + height, cz + frontDir.z * radius).multiplyScalar(M),
      });
    });
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(0.17 * M, 0.17 * POSTS[k].name.length * M),
      makeToonMaterial("#FFFFFF", { map: makeNameTexture(POSTS[k].name), transparent: true, alphaTest: 0.3 }),
    );
    name.position
      .set(post.x + frontDir.x * (nameDepth + 0.02), ground + NAME_HEIGHT, post.z + frontDir.z * (nameDepth + 0.02))
      .multiplyScalar(M);
    name.rotation.y = front;
    scene.add(name);
    names.push(name);
  }
  return { rings, names };
}
