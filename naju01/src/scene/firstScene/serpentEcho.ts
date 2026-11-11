/**
 * 다시 나타나는 구렁이(구렁이 모티프 ② — 04 Scene 구성표 「조사 중 구렁이가 다시 아비사의 주변을 맴돈다 · 정체 설명 없음」).
 * 첫 장면의 구렁이 무리와 같은 모형을 따로 그린다(Codex 05 — 무리에 둘째 자리를 넣으면 손잡이 구조부터 바뀐다).
 *  - 이름이 `immersion.` 으로 시작해 단단한 땅 굽기(solidField) · 연출 광선에서 빠진다 — 부딪히지 않는 모습(Codex 05 「비충돌」).
 *  - 재질 · 외곽선은 첫 구렁이 무리의 것을 복제해(같은 색 · 같은 툰 · 같은 선) 자기 굽힘 값을 심는다.
 *  - 움직임은 같은 굽힘 셰이더(목 · 혀 · 숨 · 짧은 들고 남 uShift)로. 자리는 메시 행렬로 놓는다(먼 이동은 uShift 로 하지 않는다).
 */
import * as THREE from "three";
import { toCreasedNormals } from "three-stdlib";

import { loadTexturedModel } from "../../loaders/useTexturedModel";
import {
  attachBend,
  attachOutlineBend,
  createBendUniforms,
  createBentDepthMaterial,
  writeSerpentPose,
  type BendUniforms,
  type SerpentPose,
} from "./bendShader";

export const ECHO_MESH_NAME = "immersion.serpentEcho";

const textureMapOf = (material: THREE.Material | null | undefined) =>
  material && "map" in material && material.map instanceof THREE.Texture ? material.map : null;

/** 재질 복제 — 복제는 userData 를 JSON 으로 깊게 베끼는데, 세계툰이 원본 재질을 거기 넣어 두면 텍스처까지 문자열로 굽는다. 잠깐 비우고 복제 */
function cloneMaterial<T extends THREE.Material>(source: T): T {
  const saved = source.userData;
  source.userData = {};
  const copy = source.clone() as T;
  source.userData = saved;
  copy.userData = { worldToonSource: true };
  return copy;
}

export class SerpentEcho {
  readonly root = new THREE.Group();
  readonly uniforms: BendUniforms = createBendUniforms("serpent");
  readonly pose: SerpentPose = {
    breath: 0,
    yaw: 0,
    lift: 0,
    tongue: 0,
    shift: new THREE.Vector3(),
    wave: 0,
    wavePhase: 0,
    isGone: true,
  };
  private body: THREE.Mesh | null = null;
  private outline: THREE.Mesh | null = null;
  private readonly depthMaterial = createBentDepthMaterial("serpent", this.uniforms);
  readonly world = new THREE.Matrix4();
  readonly worldInverse = new THREE.Matrix4();
  readonly position = new THREE.Vector3();

  constructor() {
    this.root.name = ECHO_MESH_NAME;
    this.root.visible = false;
  }

  /** 첫 구렁이 무리 메시가 보이면 그 재질 · 외곽선을 본떠 몸을 만든다(한 번) */
  build(source: THREE.InstancedMesh | null) {
    if (this.body || !source) return;
    const material = Array.isArray(source.material) ? null : source.material;
    if (!material || !textureMapOf(material)) return;
    void loadTexturedModel("serpent").then((model) => {
      if (this.body || !model.geometry) return;
      const body = new THREE.Mesh(model.geometry, cloneMaterial(material));
      body.name = ECHO_MESH_NAME;
      body.castShadow = source.castShadow;
      body.receiveShadow = true;
      body.frustumCulled = false;
      body.customDepthMaterial = this.depthMaterial;
      attachBend(body.material as THREE.Material, "serpent", this.uniforms);
      this.root.add(body);
      this.body = body;
      // 외곽선 — 무리의 drei 껍데기 재질을 복제해 굽힘을 심는다(같은 두께 · 색)
      let outlineMaterial: THREE.ShaderMaterial | null = null;
      source.traverse((child) => {
        const candidate = (child as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (!outlineMaterial && child !== source && candidate?.isShaderMaterial && candidate.uniforms?.thickness)
          outlineMaterial = candidate;
      });
      if (outlineMaterial) {
        const copy = cloneMaterial(outlineMaterial as THREE.ShaderMaterial);
        // 굽힘 표시만 지운다 — 몰입연출의 외곽선 보정(fixOutlines) 표시는 남겨야 복제본을 또 고쳐 셰이더가 겹치지 않는다(Codex 리뷰)
        const source = outlineMaterial as THREE.ShaderMaterial;
        copy.userData = source.userData.wgOutline ? { wgOutline: true } : {};
        attachOutlineBend(copy, "serpent", this.uniforms);
        const outline = new THREE.Mesh(toCreasedNormals(model.geometry, Math.PI), copy);
        outline.name = ECHO_MESH_NAME;
        outline.frustumCulled = false;
        this.root.add(outline);
        this.outline = outline;
      }
    });
  }

  /** 자리 · 방향 · 크기(첫 구렁이 무리와 같은 배율) */
  place(position: THREE.Vector3, yaw: number, scale: number) {
    this.world.compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(scale, scale, scale),
    );
    this.worldInverse.copy(this.world).invert();
    this.position.copy(position);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.world);
    this.root.matrixWorldNeedsUpdate = true;
  }

  toWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyMatrix4(this.world);
  }

  toLocal(world: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(world).applyMatrix4(this.worldInverse);
  }

  get isReady() {
    return !!this.body;
  }

  /** 자세를 쓰고, 다 들어갔으면 아예 안 그린다 */
  write() {
    writeSerpentPose(this.uniforms, this.pose);
    this.root.visible = !!this.body && !this.pose.isGone;
  }

  dispose() {
    this.root.removeFromParent();
    this.outline?.geometry.dispose();
    (this.body?.material as THREE.Material | undefined)?.dispose();
    (this.outline?.material as THREE.Material | undefined)?.dispose();
    this.depthMaterial.dispose();
  }
}
