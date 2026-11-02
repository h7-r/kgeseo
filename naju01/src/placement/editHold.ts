// editHold.ts — [E] 편집 모드에서 이미 놓인 에셋 하나를 고르는 동안
//   ① 원래 자리의 그 인스턴스를 그리지 않고(행렬 0)
//   ② 같은 기하·재질로 만든 「진짜 모양 유령」을 초안 뿌리에 붙여 손잡이·화살표·, . 회전을 그대로 따라오게 한다.
// (10/15 미르: 「, . 를 누르면 영역은 움직이는데 실제 에셋은 움직이지 않는다」)
//
// 생성 무리(InstanceGroupMesh)와 공개 에셋 배치(publicAssets)는 매 프레임(또는 몇 프레임마다) 인스턴스 행렬을 다시 채운다.
//   그래서 숨김은 scene.onBeforeRender — 모든 useFrame 이 끝난 뒤, 렌더러가 행렬을 GPU 로 올리기 전 — 에서 매번 다시 건다.
//   풀 때(release)는 그 자리가 아직 0 이면 마지막으로 본 원래 행렬로 되돌린다(다시 채워졌으면 그대로 둔다).
import * as THREE from "three";

import type { PlaceEditInfo } from "../loaders/publicAssetPlacement";

export type HoldSpec =
  | { kind: "instance"; groupId: string; id: number }
  | { kind: "place"; manifestIndex: number; spot: number };

const RECOLLECT_EVERY = 30;
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _c = new THREE.Color();

function matches(spec: HoldSpec, mesh: THREE.InstancedMesh): ArrayLike<number> | null {
  if (spec.kind === "instance") {
    if (mesh.userData.groupId !== spec.groupId && mesh.name !== spec.groupId) return null;
    return (mesh.userData.ids as ArrayLike<number> | undefined) ?? null;
  }
  const info = mesh.userData.placeEdit as PlaceEditInfo | undefined;
  if (!info || info.manifestIndex !== spec.manifestIndex) return null;
  return (mesh.userData.placeSpots as ArrayLike<number> | undefined) ?? null;
}
const wanted = (spec: HoldSpec) => (spec.kind === "instance" ? spec.id : spec.spot);

function isZero(array: ArrayLike<number>, k: number) {
  for (let i = 0; i < 16; i++) if (array[k * 16 + i] !== 0) return false;
  return true;
}

export class InstanceHold {
  private meshes: THREE.InstancedMesh[] = [];
  /** 메시마다 마지막으로 본 원래 행렬 */
  private readonly saved = new Map<THREE.InstancedMesh, Float32Array>();
  private frame = 0;
  private readonly previous: THREE.Scene["onBeforeRender"];
  private readonly wrapper: THREE.Scene["onBeforeRender"];
  private released = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly spec: HoldSpec,
  ) {
    this.collect();
    this.previous = scene.onBeforeRender;
    this.wrapper = (...args) => {
      this.previous.apply(scene, args);
      this.apply();
    };
    scene.onBeforeRender = this.wrapper;
    this.apply();
  }

  private collect() {
    const found: THREE.InstancedMesh[] = [];
    this.scene.traverse((node) => {
      const mesh = node as THREE.InstancedMesh;
      if (mesh.isInstancedMesh && !mesh.userData.reviewDraft && matches(this.spec, mesh)) found.push(mesh);
    });
    this.meshes = found;
  }

  /** 각 메시에서 지금 그 인스턴스가 담긴 칸들 */
  private slots(mesh: THREE.InstancedMesh): number[] {
    const list = matches(this.spec, mesh);
    if (!list) return [];
    const want = wanted(this.spec);
    const out: number[] = [];
    const n = Math.min(mesh.count, list.length);
    for (let k = 0; k < n; k++) if (list[k] === want) out.push(k);
    return out;
  }

  private apply() {
    if (this.released) return;
    if (++this.frame % RECOLLECT_EVERY === 0) this.collect();
    for (const mesh of this.meshes) {
      const array = mesh.instanceMatrix.array as Float32Array;
      let touched = false;
      for (const k of this.slots(mesh)) {
        if (isZero(array, k)) continue;
        this.saved.set(mesh, array.slice(k * 16, k * 16 + 16));
        array.fill(0, k * 16, k * 16 + 16);
        touched = true;
      }
      if (touched) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 원래 모양 유령 — 원경판이 아닌 메시마다 1개짜리 InstancedMesh(같은 기하·재질 = 같은 셰이더).
   * 뿌리(root)의 국소 좌표로 붙여 뿌리를 옮기고 돌리면 그대로 따라온다. 기하·재질은 게임 것을 빌려 쓰므로 버리지 않는다.
   */
  buildGhosts(root: THREE.Object3D): THREE.Object3D[] {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const ghosts: THREE.Object3D[] = [];
    for (const mesh of this.meshes) {
      if (mesh.userData.isDistant) continue;
      const matrix = this.saved.get(mesh);
      if (!matrix) continue;
      mesh.updateMatrixWorld();
      const ghost = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
      ghost.setMatrixAt(0, _m.identity());
      if (mesh.instanceColor) {
        const k = this.slots(mesh)[0];
        if (k !== undefined) ghost.setColorAt(0, mesh.getColorAt(k, _c));
      }
      ghost.matrixAutoUpdate = false;
      ghost.matrix.multiplyMatrices(_inv, mesh.matrixWorld).multiply(_m.fromArray(matrix));
      ghost.matrixWorldNeedsUpdate = true;
      ghost.frustumCulled = false;
      ghost.castShadow = mesh.castShadow;
      ghost.receiveShadow = mesh.receiveShadow;
      ghost.name = `edit-ghost:${mesh.name}`;
      ghost.userData.reviewDraft = true;
      ghost.userData.borrowedResources = true;
      root.add(ghost);
      ghosts.push(ghost);
    }
    return ghosts;
  }

  /** 숨김을 풀고 원래 행렬을 되돌린다(그 사이 다시 채워진 칸은 그대로) */
  release() {
    if (this.released) return;
    this.released = true;
    // 뒤에 다른 숨김이 감쌌으면 그대로 둔다(이쪽 apply 는 released 로 멈춘다)
    if (this.scene.onBeforeRender === this.wrapper) this.scene.onBeforeRender = this.previous;
    for (const [mesh, matrix] of this.saved) {
      const array = mesh.instanceMatrix.array as Float32Array;
      let touched = false;
      for (const k of this.slots(mesh)) {
        if (!isZero(array, k)) continue;
        array.set(matrix, k * 16);
        touched = true;
      }
      if (touched) mesh.instanceMatrix.needsUpdate = true;
    }
    this.saved.clear();
  }
}
