/**
 * 깨지는 돌 껍질 — 돌새 모형을 칸마다 조각내 둔 것(chunk)과 그 사이로 흩날리는 잔돌(shard).
 * 깨질 때 조각들이 제자리에서 바깥으로 터져 나가 알껍데기처럼 벗겨진다. 단위는 유닛(M 배)
 */
import * as THREE from "three";

import { audio } from "../../scene/immersion/audio";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";

/** 돌가루 — 껍질 조각 사이로 흩날리는 잔돌(돌새마다) */
const SHARDS = 26;
/** 껍질 조각을 나누는 칸(돌새 모형 표본 단위) · 조각이 날다 사라지기까지(초) */
const CHUNK_CELL = 0.07;
const CHUNK_LIFE = 5.5;

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const scratch = {
  matrix: new THREE.Matrix4(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  euler: new THREE.Euler(0, 0, 0, "YXZ"),
};

/** 껍질 조각 — 모형의 삼각형을 칸(cell)마다 모아 조각 여럿으로 나눈다. 조각마다 제 가운데가 원점(center 에 적어 둠) */
function splitIntoChunks(geometry: THREE.BufferGeometry, cell: number) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.attributes.position as THREE.BufferAttribute;
  const color = source.attributes.color as THREE.BufferAttribute | undefined;
  const groups = new Map<string, number[]>();
  for (let t = 0; t < position.count; t += 3) {
    const cx = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
    const cy = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3;
    const cz = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
    const key = `${Math.floor(cx / cell)},${Math.floor(cy / cell)},${Math.floor(cz / cell)}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.values()].map((triangles) => {
    const center = new THREE.Vector3();
    for (const t of triangles)
      for (let k = 0; k < 3; k++) center.add(new THREE.Vector3().fromBufferAttribute(position, t + k));
    center.divideScalar(triangles.length * 3);
    const positions = new Float32Array(triangles.length * 9);
    const colors = new Float32Array(triangles.length * 9);
    triangles.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        positions[i * 9 + k * 3] = position.getX(t + k) - center.x;
        positions[i * 9 + k * 3 + 1] = position.getY(t + k) - center.y;
        positions[i * 9 + k * 3 + 2] = position.getZ(t + k) - center.z;
        if (color) {
          colors[i * 9 + k * 3] = color.getX(t + k);
          colors[i * 9 + k * 3 + 1] = color.getY(t + k);
          colors[i * 9 + k * 3 + 2] = color.getZ(t + k);
        }
      }
    });
    const piece = new THREE.BufferGeometry();
    piece.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    piece.computeVertexNormals();
    return { geometry: piece, center };
  });
}

interface FlyingChunk {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
}

interface Shard {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
}

/** 돌새 하나의 껍질 — 깨질 조각 목록과 잔돌(두 마리 몫) */
export function createStoneShell(
  stone: THREE.BufferGeometry,
  shellMaterial: THREE.MeshToonMaterial,
  statueCount: number,
) {
  // 알껍데기처럼 휜 잔돌(구의 한 귀퉁이). 안쪽도 보이게 양면
  const shardGeometry = new THREE.SphereGeometry(1, 5, 3, 0, 1.0, 0.6, 0.8);
  shardGeometry.translate(0, -Math.cos(1.0), 0);
  const shards = new THREE.InstancedMesh(
    shardGeometry,
    makeToonMaterial("#B4BAC1", { side: THREE.DoubleSide }),
    SHARDS * statueCount,
  );
  shards.count = 0;
  shards.frustumCulled = false;
  return {
    chunks: splitIntoChunks(stone, CHUNK_CELL),
    shellMaterial,
    shards,
    shardStates: Array.from({ length: SHARDS * statueCount }, (): Shard => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      size: 0,
    })),
    /** 터져 나간 껍질 조각 */
    flying: [] as FlyingChunk[],
    shardAge: 0,
  };
}
export type StoneShell = ReturnType<typeof createStoneShell>;

/**
 * 돌새 하나가 깨진다 — 모형 그대로의 조각들이 제자리에서 바깥으로 터져 나가고, 껍질 겉면(몸 · 펼친 날개 둘레)에서
 * 잔돌이 흩어진다. 짹짹 소리는 조금씩 어긋나게
 */
export function crackShell(
  shell: StoneShell,
  scene: THREE.Scene,
  pivot: THREE.Object3D,
  stone: THREE.Mesh,
  size: number,
  k: number,
) {
  pivot.updateMatrixWorld(true);
  const center = pivot.getWorldPosition(new THREE.Vector3());
  const body = new THREE.Vector3(0, 0.07, 0).applyMatrix4(stone.matrixWorld);
  for (const chunk of shell.chunks) {
    const mesh = new THREE.Mesh(chunk.geometry, shell.shellMaterial);
    const at = chunk.center.clone().applyMatrix4(stone.matrixWorld);
    mesh.position.copy(at);
    stone.getWorldQuaternion(mesh.quaternion);
    stone.getWorldScale(mesh.scale);
    mesh.castShadow = true;
    scene.add(mesh);
    const out = at.clone().sub(body);
    if (out.lengthSq() < 1e-6) out.set(Math.random() - 0.5, 1, Math.random() - 0.5);
    const velocity = out.normalize().multiplyScalar((1.2 + Math.random() * 2.2) * M);
    velocity.y += (0.8 + Math.random() * 1.6) * M;
    shell.flying.push({
      mesh,
      velocity,
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8),
      age: 0,
    });
  }
  for (let i = 0; i < 3; i++) window.setTimeout(() => audio.play("짹짹"), 200 + i * 260 + k * 120);
  for (let i = 0; i < SHARDS; i++) {
    const shard = shell.shardStates[k * SHARDS + i];
    const angle = Math.random() * Math.PI * 2;
    const spread = (i % 3 === 0 ? 0.35 : 0.15) * size;
    const offset = new THREE.Vector3(
      Math.cos(angle) * spread,
      (0.04 + Math.random() * 0.12) * size,
      Math.sin(angle) * spread * 0.6,
    );
    shard.position.copy(center).addScaledVector(offset, M);
    shard.velocity
      .copy(offset)
      .normalize()
      .multiplyScalar((1.5 + Math.random() * 2.5) * M);
    shard.velocity.y += (1 + Math.random() * 2) * M;
    shard.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    shard.size = (0.04 + Math.random() * 0.07) * M;
  }
  shell.shards.count = shell.shardStates.length;
}

/** 껍질 조각 — 바람에 실려 날리다 떨어지고, 땅에서 구르다 작아져 사라진다 */
export function updateChunks(shell: StoneShell, scene: THREE.Scene, dt: number) {
  if (!shell.flying.length) return;
  for (const piece of shell.flying) {
    piece.age += dt;
    piece.velocity.y -= (piece.age < 1.5 ? 3 : 8) * M * dt;
    piece.velocity.x += Math.sin(piece.age * 2 + piece.spin.x) * 1.2 * M * dt;
    piece.velocity.z += Math.cos(piece.age * 1.6 + piece.spin.y) * 1.2 * M * dt;
    piece.mesh.position.addScaledVector(piece.velocity, dt);
    const floor = groundY(piece.mesh.position.x / M, piece.mesh.position.z / M) * M;
    if (piece.mesh.position.y < floor) {
      piece.mesh.position.y = floor;
      piece.velocity.multiplyScalar(0.35);
      piece.velocity.y = Math.abs(piece.velocity.y) * 0.25;
      piece.spin.multiplyScalar(0.6);
    }
    piece.mesh.rotation.x += piece.spin.x * dt;
    piece.mesh.rotation.y += piece.spin.y * dt;
    piece.mesh.rotation.z += piece.spin.z * dt;
    const fade = THREE.MathUtils.clamp(1 - (piece.age - (CHUNK_LIFE - 1.5)) / 1.5, 0, 1);
    if (fade < 1) piece.mesh.scale.multiplyScalar(Math.max(0.0001, 1 - dt * 2.5));
    if (fade <= 0) scene.remove(piece.mesh);
  }
  shell.flying = shell.flying.filter((piece) => piece.age < CHUNK_LIFE);
  // 다 흩어지면 빛도 거둔다
  if (!shell.flying.length) shell.shellMaterial.emissiveIntensity = 0;
}

/** 잔돌 — 풀려 나가는 바람에 실려 한동안 날리다 떨어진다 */
export function updateShards(shell: StoneShell, dt: number) {
  if (!shell.shards.count) return;
  const { matrix, quaternion, scale, euler } = scratch;
  shell.shardAge += dt;
  const age = shell.shardAge;
  const fade = THREE.MathUtils.clamp(1 - (age - 5) / 2, 0, 1);
  shell.shardStates.forEach((shard, i) => {
    if (shard.size === 0) {
      shell.shards.setMatrixAt(i, ZERO_MATRIX);
      return;
    }
    shard.velocity.y -= (age < 2 ? 2.5 : 7) * M * dt;
    shard.velocity.x += Math.sin(age * 2 + i) * 1.2 * M * dt;
    shard.velocity.z += Math.cos(age * 1.7 + i) * 1.2 * M * dt;
    shard.position.addScaledVector(shard.velocity, dt);
    const floor = groundY(shard.position.x / M, shard.position.z / M) * M + shard.size * 0.5;
    if (shard.position.y < floor) {
      shard.position.y = floor;
      shard.velocity.multiplyScalar(0.3);
      shard.velocity.y = Math.abs(shard.velocity.y) * 0.2;
    }
    euler.set(shard.spin.x * age, shard.spin.y * age, shard.spin.z * age);
    quaternion.setFromEuler(euler);
    matrix.compose(shard.position, quaternion, scale.setScalar(shard.size * fade));
    shell.shards.setMatrixAt(i, matrix);
  });
  shell.shards.instanceMatrix.needsUpdate = true;
  if (fade <= 0) shell.shards.count = 0;
}
