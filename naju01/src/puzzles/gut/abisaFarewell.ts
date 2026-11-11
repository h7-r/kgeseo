/**
 * 굿이 풀린 뒤 물가에 선 아비사 — 끝 연출의 작별(11/11 연출 · 대본 정리 K7).
 * 이야기는 아비사의 부탁으로 시작했는데 끝에 아비사가 없었다. 가락지가 오른 뒤 물가에 아비사가 나타나 제 일을 기억해 내고
 * (사실 계약서 GF-01 — 죽음을 모른 채 지금 여기 있던 사람), 인사를 남기고 옅어진다.
 *  - 아비사가 구렁이로 바뀌는 모습은 그리지 않는다(GF-02 · 03 — 구렁이의 정체는 확정하지 않는다).
 *  - 첫 장면의 아비사 무리(씬1.아비사)와 같은 모형 · 같은 재질을 따로 그린다(serpentEcho 와 같은 방식). 굽힘(고개 · 숨)은 넣지 않고 서 있기만 한다.
 *  - 이름이 `immersion.` 으로 시작해 단단한 땅 굽기 · 연출 광선에서 빠진다(부딪히지 않는 모습).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import * as THREE from "three";

import { loadTexturedModel } from "../../loaders/useTexturedModel";
import { GROUP_IDS } from "../../placement/editFile";
import {
  attachBend,
  createBendUniforms,
  stepFace,
  writeAbisaPose,
  type AbisaPose,
} from "../../scene/firstScene/bendShader";
import { M, groundY } from "../units";
import { TABLE } from "./gutShape";

export const FAREWELL_MESH_NAME = "immersion.abisaFarewell";

/** 서는 자리 — 소반에서 강 쪽으로 물러난 물가. 소반을 바라본다 */
export const FAREWELL_SPOT = { x: TABLE.x + 1.1, z: TABLE.z + 5.2 };
/** 나타나고 옅어지는 시간(초) */
const FADE_IN = 1.6;
const FADE_OUT = 2.2;

/**
 * 작별의 차례(끝 연출이 시작된 뒤 초) — 가락지가 한참 오른 뒤에 물가를 돌아본다.
 *   lookAt 물가로 시선 · first 첫 마디 · second 둘째 마디 · leaveAt 옅어지기 시작 · endAt 다 사라짐(이 뒤에 엔딩 필름)
 */
/** 두 마디를 말하는 데 걸리는 시간(초) — 그동안만 입이 움직인다 */
const SPEAK_SECONDS = [3.6, 2.4] as const;
export const FAREWELL = { lookAt: 15.2, first: 16.4, second: 22.0, leaveAt: 26.2, endAt: 28.6 } as const;

/** 아비사의 말(자막 띠) — 한 벌(아비사는 늘 해요체) */
export const FAREWELL_LINES = [
  "아비사 — 이제 기억나요. 그날 바위에서… 저도 돌아오지 못했어요.",
  "아비사 — 끝까지 들어 줘서 고마워요.",
] as const;

const textureMapOf = (material: THREE.Material | null | undefined) =>
  material && "map" in material && material.map instanceof THREE.Texture ? material.map : null;

/** 재질 복제 — 세계툰이 userData 에 원본 재질을 넣어 두면 복제가 텍스처까지 문자열로 굽는다. 잠깐 비우고 복제(serpentEcho 와 같다) */
function cloneMaterial<T extends THREE.Material>(source: T): T {
  const saved = source.userData;
  source.userData = {};
  const copy = source.clone() as T;
  source.userData = saved;
  copy.userData = { worldToonSource: true };
  return copy;
}

export class AbisaFarewell {
  readonly root = new THREE.Group();
  /** 얼굴 높이의 한 점(유닛) — 카메라가 돌아볼 곳 */
  readonly head = new THREE.Vector3();
  private body: THREE.Mesh | null = null;
  private isBuilding = false;
  /** 이 아비사만의 굽힘 값 — 첫 장면 아비사와 따로 움직인다(눈 깜박임 · 입 · 숨 · 고개 숙임) */
  private readonly uniforms = createBendUniforms("abisa");
  private readonly pose: AbisaPose = {
    breath: 0,
    armRest: 0,
    swayX: 0,
    swayY: 0,
    headYaw: 0,
    headPitch: 0,
    torsoYaw: 0,
    bow: 0,
    bodyYaw: 0,
    blink: 0,
    mouth: 0,
    armL: new THREE.Vector4(1, 0, 0, 0),
    armR: new THREE.Vector4(1, 0, 0, 0),
  };
  private lastSince = -1;
  /** 몸을 만들기 시작한 차례 — 그사이 치웠으면(release) 늦게 도착한 모형으로 몸을 만들지 않는다 */
  private buildTurn = 0;

  constructor() {
    this.root.name = FAREWELL_MESH_NAME;
    this.root.visible = false;
  }

  /** 첫 장면의 아비사 무리를 찾아 재질 · 크기를 본떠 몸을 만든다(한 번). 못 찾으면 모형의 제 재질 · 사람 키로 */
  build(scene: THREE.Object3D) {
    if (this.body || this.isBuilding) return;
    this.isBuilding = true;
    let source: THREE.InstancedMesh | null = null;
    scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!source && mesh.isInstancedMesh && mesh.name === GROUP_IDS.scene1Abisa && !mesh.userData.isDistant)
        source = mesh;
    });
    const turn = ++this.buildTurn;
    void loadTexturedModel("abisa").then((model) => {
      if (turn !== this.buildTurn) return;
      this.isBuilding = false;
      if (this.body || !model.geometry) return;
      const found = source as THREE.InstancedMesh | null;
      const sourceMaterial = found && !Array.isArray(found.material) ? found.material : null;
      const base = sourceMaterial && textureMapOf(sourceMaterial) ? sourceMaterial : model.material;
      if (!base) return;
      const material = cloneMaterial(base);
      material.transparent = true;
      material.opacity = 0;
      // 복제한 재질에는 굽힘 · 얼굴 셰이더가 따라오지 않는다 — 이 아비사의 값 묶음으로 새로 심는다(Codex 리뷰 3)
      attachBend(material, "abisa", this.uniforms);
      const body = new THREE.Mesh(model.geometry, material);
      body.name = FAREWELL_MESH_NAME;
      body.castShadow = false;
      body.receiveShadow = false;
      body.frustumCulled = false;
      // 크기 — 첫 장면 무리의 인스턴스 배율을 그대로(없으면 모형 높이를 사람 키 1.58 m 로)
      let scale: number;
      const matrices = found?.userData.originalMatrices as Float32Array | undefined;
      if (found && matrices && matrices.length >= 16) {
        found.updateWorldMatrix(true, false);
        const world = new THREE.Matrix4().fromArray(matrices, 0).premultiply(found.matrixWorld);
        scale = new THREE.Vector3().setFromMatrixScale(world).y;
      } else {
        model.geometry.computeBoundingBox();
        const height = model.geometry.boundingBox
          ? model.geometry.boundingBox.max.y - model.geometry.boundingBox.min.y
          : 1;
        scale = (1.58 * M) / Math.max(height, 1e-3);
      }
      model.geometry.computeBoundingBox();
      const box = model.geometry.boundingBox;
      const footY = box ? box.min.y : 0;
      const topY = box ? box.max.y : 1;
      const x = FAREWELL_SPOT.x;
      const z = FAREWELL_SPOT.z;
      const ground = groundY(x, z);
      this.root.position.set(x * M, ground * M - footY * scale, z * M);
      this.root.scale.setScalar(scale);
      // 소반을 바라본다(모형 앞은 +z)
      this.root.rotation.y = Math.atan2(TABLE.x - x, TABLE.z - z);
      this.root.add(body);
      this.body = body;
      this.head.set(x * M, ground * M + (topY - footY) * scale * 0.88, z * M);
    });
  }

  get isReady() {
    return !!this.body;
  }

  /** 끝 연출이 시작된 뒤 since 초의 모습으로 — 그 전 · 다 사라진 뒤에는 안 그린다 */
  update(since: number) {
    const body = this.body;
    if (!body) return;
    const shown =
      THREE.MathUtils.smoothstep(since, FAREWELL.lookAt - 0.4, FAREWELL.lookAt - 0.4 + FADE_IN) *
      (1 - THREE.MathUtils.smoothstep(since, FAREWELL.leaveAt, FAREWELL.leaveAt + FADE_OUT));
    (body.material as THREE.Material).opacity = shown;
    this.root.visible = shown > 0.01;
    // 살아 있는 사람처럼 — 숨 · 눈 깜박임, 말하는 동안 입, 고맙다는 말에 고개를 숙인다
    // 되감기 · 처음으로(since 가 줄었다) — 앞서 벌린 입 · 감던 눈이 남지 않게 얼굴을 처음으로(Codex 리뷰 4)
    if (since < this.lastSince) {
      this.pose.mouth = 0;
      this.pose.blink = 0;
    }
    const dt = this.lastSince >= 0 && since > this.lastSince ? Math.min(since - this.lastSince, 0.1) : 0;
    this.lastSince = since;
    const pose = this.pose;
    const isSpeaking =
      (since > FAREWELL.first && since < FAREWELL.first + SPEAK_SECONDS[0]) ||
      (since > FAREWELL.second && since < FAREWELL.second + SPEAK_SECONDS[1]);
    stepFace(pose, dt, isSpeaking);
    pose.breath = 0.05 * Math.sin((since * Math.PI * 2) / 4.2);
    const thanks = THREE.MathUtils.smoothstep(since, FAREWELL.second + 0.6, FAREWELL.second + 1.5);
    const rise = THREE.MathUtils.smoothstep(since, FAREWELL.second + 2.6, FAREWELL.second + 3.6);
    pose.bow = 0.2 * thanks * (1 - rise);
    pose.headPitch = 0.12 * thanks * (1 - rise);
    writeAbisaPose(this.uniforms, pose);
  }

  hide() {
    this.root.visible = false;
  }

  /**
   * 장면을 떠날 때 — 복제한 재질(GPU 자원)을 내려놓는다. 모형 · 그림은 같이 쓰는 것이라 두고,
   * 다시 들어오면 build 가 몸을 새로 만든다(Codex 리뷰 4)
   */
  release() {
    this.buildTurn += 1;
    this.isBuilding = false;
    if (!this.body) return;
    (this.body.material as THREE.Material).dispose();
    this.root.remove(this.body);
    this.body = null;
    this.root.visible = false;
    this.lastSince = -1;
  }

  dispose() {
    this.buildTurn += 1;
    this.root.removeFromParent();
    (this.body?.material as THREE.Material | undefined)?.dispose();
  }
}
