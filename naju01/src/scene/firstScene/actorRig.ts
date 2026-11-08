/**
 * 무리 하나(씬1.아비사 · 씬1.구렁이)에 굽힘을 거는 손잡이. 무리 메시는 그대로 두고(편집기가 인스턴스 번호로 집는다 — Codex 03회차)
 * 그 재질 · 외곽선(drei Outlines 껍데기) · 그림자 깊이 재질에 같은 굽힘을 심는다.
 * 무리가 다시 세워지거나(편집 · 공개 에셋 교체) 세계툰이 재질을 갈아 끼우면 새 것에 다시 심는다 — 그래서 자주 다시 찾는다.
 * 재질이 그 모형 전용(모형 텍스처를 쓴다)일 때만 심는다. 바닥 재질처럼 여러 무리가 나눠 쓰는 재질이면 다 같이 휘어 버린다.
 */
import * as THREE from "three";

import { loadTexturedModel } from "../../loaders/useTexturedModel";
import {
  attachBend,
  attachOutlineBend,
  bendUniformsFor,
  createBentDepthMaterial,
  type ActorKind,
  type BendUniforms,
} from "./bendShader";

const textureMapOf = (material: THREE.Material | null | undefined) =>
  material && "map" in material && material.map instanceof THREE.Texture ? material.map : null;

export class ActorRig {
  readonly uniforms: BendUniforms;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private modelMap: THREE.Texture | null = null;
  /** 가까이 그리는 무리 메시(원경판이 아닌 것) — 인물 자리를 읽는다 */
  private near: THREE.InstancedMesh | null = null;
  private readonly instance = new THREE.Matrix4();
  readonly world = new THREE.Matrix4();
  readonly worldInverse = new THREE.Matrix4();
  readonly position = new THREE.Vector3();
  /** 이번에 찾은 무리가 있고 인물이 놓여 있다 */
  isPlaced = false;
  /** 무리 메시를 아예 숨긴다(물러난 구렁이) — 단단한 땅 굽기(solidField)는 보이는 메시만 읽으므로 안 숨기면 보이지 않는 벽이 남는다 */
  private isHidden = false;
  private meshes: THREE.InstancedMesh[] = [];

  constructor(
    readonly kind: ActorKind,
    private readonly groupName: string,
  ) {
    this.uniforms = bendUniformsFor(kind);
    this.depthMaterial = createBentDepthMaterial(kind, this.uniforms);
    void loadTexturedModel(kind).then((model) => {
      this.modelMap = textureMapOf(model.material);
    });
  }

  /** 무리 메시를 다시 찾아 굽힘을 심는다(가볍다 — 몇 프레임에 한 번) */
  sync(scene: THREE.Object3D) {
    this.near = null;
    this.meshes = [];
    if (!this.modelMap) return;
    scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.name !== this.groupName) return;
      const material = Array.isArray(mesh.material) ? null : mesh.material;
      // 그 모형 전용 재질(같은 텍스처)이어야 한다 — 툰 변환 뒤에도 같은 텍스처를 들고 있다
      if (!material || textureMapOf(material) !== this.modelMap) return;
      attachBend(material, this.kind, this.uniforms);
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.traverse((child) => {
        const outline = (child as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (child !== mesh && outline?.isShaderMaterial && outline.uniforms?.thickness)
          attachOutlineBend(outline, this.kind, this.uniforms);
      });
      if (!mesh.userData.isDistant) this.near = mesh;
      this.meshes.push(mesh);
      mesh.visible = !this.isHidden;
    });
    this.updatePlacement();
  }

  /** 가까이 그리는 무리 메시 — 다시 나타나는 구렁이가 재질 · 외곽선을 본뜬다 */
  get nearMesh() {
    return this.near;
  }

  /** 숨기기 · 다시 보이기 — 바뀔 때만 메시에 적는다 */
  setHidden(isHidden: boolean) {
    if (this.isHidden === isHidden) return;
    this.isHidden = isHidden;
    for (const mesh of this.meshes) mesh.visible = !isHidden;
  }

  /** 인물 자리(인스턴스 #0 원본 행렬 × 무리 월드 행렬). 거리 · 초점 거르기가 지금 그리는 행렬을 다시 쓰므로 원본을 읽는다 */
  updatePlacement() {
    const mesh = this.near;
    const matrices = mesh?.userData.originalMatrices as Float32Array | undefined;
    if (!mesh || !matrices || matrices.length < 16 || !mesh.parent) {
      this.isPlaced = false;
      return;
    }
    mesh.updateWorldMatrix(true, false);
    this.instance.fromArray(matrices, 0);
    this.world.multiplyMatrices(mesh.matrixWorld, this.instance);
    this.worldInverse.copy(this.world).invert();
    this.position.setFromMatrixPosition(this.world);
    this.isPlaced = true;
  }

  /** 모형 공간(키 1 규약) 점 → 세계 */
  toWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyMatrix4(this.world);
  }

  /** 세계 점 → 모형 공간 */
  toLocal(world: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(world).applyMatrix4(this.worldInverse);
  }
}
