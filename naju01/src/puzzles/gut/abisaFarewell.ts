/**
 * 굿이 풀린 뒤 물가에 선 아비사 — 끝 연출의 작별(11/11 연출 · 대본 정리 K7).
 * 이야기는 아비사의 부탁으로 시작했는데 끝에 아비사가 없었다. 가락지가 오른 뒤 물가에 아비사가 나타나 제 일을 기억해 내고
 * (사실 계약서 GF-01 — 죽음을 모른 채 지금 여기 있던 사람), 인사를 남기고 사라진다.
 *  - 아비사가 구렁이로 바뀌는 모습은 그리지 않는다(GF-02 · 03 — 구렁이의 정체는 확정하지 않는다).
 *  - 첫 장면의 아비사 무리(씬1.아비사)와 같은 모형 · 같은 재질을 따로 그린다(serpentEcho 와 같은 방식). 굽힘(고개 · 숨)은 넣지 않고 서 있기만 한다.
 *  - 이름이 `immersion.` 으로 시작해 단단한 땅 굽기 · 연출 광선에서 빠진다(부딪히지 않는 모습).
 *  - 사라질 때(해랑 11/13): 한 번에 투명해지지 않고 **머리부터 발끝까지 경계가 내려오며** 그 자리의 몸이 작은 불씨로 바뀌어
 *    하늘로 천천히 떠올라 흩어진다. 경계 위는 셰이더가 버리고(discard), 경계 가까이는 불씨 빛으로 달아오르며, 경계를 지난
 *    자리마다 불씨 입자가 하나씩 떠난다(dissolve).
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
import { makeGlowPoints } from "../glowPoints";
import { M, groundY } from "../units";
import { TABLE } from "./gutShape";

export const FAREWELL_MESH_NAME = "immersion.abisaFarewell";

/** 서는 자리 — 소반에서 강 쪽으로 물러난 물가. 소반을 바라본다 */
export const FAREWELL_SPOT = { x: TABLE.x + 1.1, z: TABLE.z + 5.2 };
/** 나타나는 시간(초) */
const FADE_IN = 1.6;
/**
 * 사라짐 — 경계가 머리 위에서 발밑까지 내려오는 시간 · 경계의 너덜거림 폭(미터) · 마지막 불씨가 다 꺼지기까지 더 두는 시간(초).
 * 한 번에 변하지 않고 위에서 아래로 차례로 불씨가 된다(해랑 11/13).
 */
const DISSOLVE = { sweep: 8.4, band: 0.2, linger: 5.6 } as const;
/** 불씨 — 입자 수 · 머무는 시간(초) · 떠오르는 빠르기(m/s) · 크기(미터). 여운이 남게 오래 머물며 천천히 오른다(해랑 11/13) */
const EMBER = { count: 640, life: [3.8, 6.6], rise: [0.09, 0.26], size: [0.05, 0.11], perMeter: 190 } as const;
/**
 * 불씨 색 — 막 떨어져 나올 때 금빛, 식으며 주황(관솔불 EMBER 와 같은 계열).
 * 작별은 날이 갠 하늘을 등지고 일어난다 — 더해 칠하면(additive) 밝은 하늘에서 하얗게 날아가 보이지 않아서(11/13 촬영)
 * 연기처럼 덮어 칠한다(normal). 그래서 1 을 넘기지 않는다
 */
const EMBER_HOT = new THREE.Color(1.0, 0.76, 0.34);
const EMBER_COOL = new THREE.Color(0.95, 0.42, 0.12);

/**
 * 작별의 차례(끝 연출이 시작된 뒤 초) — 가락지가 한참 오른 뒤 물가를 돌아본다.
 *   lookAt 물가로 시선 · first 첫 마디 · second 둘째 마디 · leaveAt 불씨로 흩어지기 시작 · endAt 마지막 불씨까지 사라짐(이 뒤에 엔딩 필름)
 */
/** 두 마디를 말하는 데 걸리는 시간(초) — 그동안만 입이 움직인다 */
const SPEAK_SECONDS = [3.6, 2.4] as const;
const LEAVE_AT = 26.2;
export const FAREWELL = {
  lookAt: 15.2,
  first: 16.4,
  second: 22.0,
  leaveAt: LEAVE_AT,
  endAt: LEAVE_AT + DISSOLVE.sweep + DISSOLVE.linger,
} as const;

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

/** 디졸브 값 — 경계 높이(유닛, 세계 y) · 너덜거림 폭(유닛) · 켬(0 이면 아무것도 안 버린다) */
interface DissolveUniforms {
  uDissolveEdge: THREE.IUniform<number>;
  uDissolveBand: THREE.IUniform<number>;
  uDissolveOn: THREE.IUniform<number>;
}

/**
 * 굽힘 셰이더 뒤에 디졸브를 덧붙인다 — 정점에서 세계 좌표를 넘기고, 조각에서 경계 위는 버리고 경계 근처는 불씨 빛으로.
 * 경계는 잡음으로 너덜거려 직선으로 잘린 듯 보이지 않는다.
 */
function attachDissolve(material: THREE.Material, uniforms: DissolveUniforms) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDissolveWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvDissolveWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vDissolveWorld;
uniform float uDissolveEdge;
uniform float uDissolveBand;
uniform float uDissolveOn;
float dissolveHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dissolveNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = dissolveHash(i), n100 = dissolveHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = dissolveHash(i + vec3(0.0, 1.0, 0.0)), n110 = dissolveHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = dissolveHash(i + vec3(0.0, 0.0, 1.0)), n101 = dissolveHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = dissolveHash(i + vec3(0.0, 1.0, 1.0)), n111 = dissolveHash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
if (uDissolveOn > 0.5) {
  float ragged = (dissolveNoise(vDissolveWorld * 2.6) - 0.5) * uDissolveBand * 2.0;
  float above = vDissolveWorld.y - (uDissolveEdge + ragged);
  if (above > 0.0) discard;
  // 경계 바로 아래 — 달아올라 불씨 색으로. 그 아래는 제 색
  float heat = smoothstep(-uDissolveBand * 1.6, 0.0, above);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.5, 0.7, 0.24), heat * heat);
}`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|farewellDissolve`;
  material.needsUpdate = true;
}

interface Ember {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

export class AbisaFarewell {
  readonly root = new THREE.Group();
  /** 얼굴 높이의 한 점(유닛) — 카메라가 돌아볼 곳 */
  readonly head = new THREE.Vector3();
  /** 카메라가 따라볼 곳 — 서 있을 땐 얼굴, 불씨가 되어 오르는 동안은 불씨를 따라 천천히 위로 */
  readonly lookTarget = new THREE.Vector3();
  private lift = 0;
  /** 몸에서 떨어져 떠오르는 불씨 — 세계 좌표(유닛)라 root 가 아니라 장면에 바로 둔다 */
  readonly embers = makeGlowPoints(EMBER.count, { additive: false, softness: 1.4 });
  private body: THREE.Mesh | null = null;
  private isBuilding = false;
  /** 이 아비사만의 굽힘 값 — 첫 장면 아비사와 따로 움직인다(눈 깜박임 · 입 · 숨 · 고개 숙임) */
  private readonly uniforms = createBendUniforms("abisa");
  private readonly dissolve: DissolveUniforms = {
    uDissolveEdge: { value: 0 },
    uDissolveBand: { value: DISSOLVE.band * M },
    uDissolveOn: { value: 0 },
  };
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
  /** 몸의 세계 y 범위(유닛) — 경계가 머리 위에서 발밑까지 내려온다 */
  private top = 0;
  private bottom = 0;
  /** 불씨가 떠날 자리 — 몸 정점의 세계 좌표(유닛), 높은 곳부터. 경계가 지나간 정점마다 하나씩 떠난다 */
  private seeds: Float32Array = new Float32Array(0);
  private nextSeed = 0;
  private readonly live: Ember[] = [];
  private readonly pool: Ember[] = [];

  constructor() {
    this.root.name = FAREWELL_MESH_NAME;
    this.root.visible = false;
    this.embers.points.name = `${FAREWELL_MESH_NAME}.embers`;
    this.embers.points.visible = false;
    this.embers.points.renderOrder = 6;
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
      attachDissolve(material, this.dissolve);
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
      this.lookTarget.copy(this.head);
      this.bottom = ground * M;
      this.top = ground * M + (topY - footY) * scale;
      this.seeds = this.sampleSeeds(model.geometry, topY - footY, scale);
      this.resetDissolve();
    });
  }

  /**
   * 불씨가 떠날 자리 — 모형 정점을 키 1 m 당 EMBER.perMeter 개만 고르게 뽑아 세계 좌표로 바꾸고 높은 곳부터 늘어놓는다.
   * 그러면 경계가 내려오는 동안 정점 하나가 경계를 지날 때마다 거기서 불씨가 떠나 「그 자리가 불씨로 변하는」 모습이 된다.
   */
  private sampleSeeds(geometry: THREE.BufferGeometry, height: number, scale: number) {
    const position = geometry.getAttribute("position");
    const wanted = Math.min(EMBER.count * 3, Math.max(60, Math.round((height * scale * EMBER.perMeter) / M)));
    const stride = Math.max(1, Math.floor(position.count / wanted));
    this.root.updateMatrixWorld(true);
    const local = new THREE.Vector3();
    const picked: number[] = [];
    for (let i = 0; i < position.count; i += stride) {
      local.fromBufferAttribute(position, i);
      this.root.localToWorld(local);
      picked.push(local.x, local.y, local.z);
    }
    const rows = picked.length / 3;
    const order = Array.from({ length: rows }, (_, i) => i).sort((a, b) => picked[b * 3 + 1] - picked[a * 3 + 1]);
    const seeds = new Float32Array(rows * 3);
    order.forEach((row, k) => {
      seeds[k * 3] = picked[row * 3];
      seeds[k * 3 + 1] = picked[row * 3 + 1];
      seeds[k * 3 + 2] = picked[row * 3 + 2];
    });
    return seeds;
  }

  get isReady() {
    return !!this.body;
  }

  private resetDissolve() {
    this.dissolve.uDissolveOn.value = 0;
    this.dissolve.uDissolveEdge.value = this.top + DISSOLVE.band * M * 2;
    this.nextSeed = 0;
    this.pool.push(...this.live.splice(0));
    this.commitEmbers();
    this.embers.points.visible = false;
  }

  /** 끝 연출이 시작된 뒤 since 초의 모습으로 — 그 전 · 다 사라진 뒤에는 안 그린다 */
  update(since: number) {
    const body = this.body;
    if (!body) return;
    // 되감기 · 처음으로(since 가 줄었다) — 앞서 벌린 입 · 감던 눈 · 흩어진 불씨가 남지 않게 처음으로(Codex 리뷰 4)
    if (since < this.lastSince) {
      this.pose.mouth = 0;
      this.pose.blink = 0;
      this.resetDissolve();
    }
    const dt = this.lastSince >= 0 && since > this.lastSince ? Math.min(since - this.lastSince, 0.1) : 0;
    this.lastSince = since;

    const appear = THREE.MathUtils.smoothstep(since, FAREWELL.lookAt - 0.4, FAREWELL.lookAt - 0.4 + FADE_IN);
    (body.material as THREE.Material).opacity = appear;
    // 사라짐 — 경계가 머리 위에서 발밑까지. 처음엔 천천히, 중간은 고르게, 끝은 조금 서두른다
    const leaving = Math.max(0, since - FAREWELL.leaveAt);
    const sweep = THREE.MathUtils.smootherstep(leaving / DISSOLVE.sweep, 0, 1);
    const span = this.top - this.bottom + DISSOLVE.band * M * 3;
    const edge = this.top + DISSOLVE.band * M * 2 - span * sweep;
    this.dissolve.uDissolveOn.value = leaving > 0 ? 1 : 0;
    this.dissolve.uDissolveEdge.value = edge;
    this.root.visible = appear > 0.01 && leaving < DISSOLVE.sweep;

    if (leaving > 0) this.emit(edge, since);
    this.stepEmbers(dt, since);
    // 시선 — 불씨가 되기 시작하면 떠오르는 불씨를 따라 눈높이에서 천천히 위로(최대 1.1 m)
    this.lift = THREE.MathUtils.smootherstep(leaving, 0.8, DISSOLVE.sweep + DISSOLVE.linger) * 1.1 * M;
    this.lookTarget.copy(this.head).setY(this.head.y + this.lift);

    // 살아 있는 사람처럼 — 숨 · 눈 깜박임, 말하는 동안 입, 고맙다는 말에 고개를 숙인다
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

  /** 경계가 지나간 정점마다 불씨 하나 — 높은 곳부터 차례로, 한 번씩만 */
  private emit(edge: number, since: number) {
    const seeds = this.seeds;
    while (this.nextSeed * 3 < seeds.length && seeds[this.nextSeed * 3 + 1] > edge) {
      const i = this.nextSeed * 3;
      this.nextSeed += 1;
      const ember = this.pool.pop() ?? {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        size: 1,
        seed: 0,
      };
      if (this.live.length >= EMBER.count) this.pool.push(this.live.shift() as Ember);
      const seed = Math.random();
      const spread = 0.25;
      ember.x = seeds[i];
      ember.y = seeds[i + 1];
      ember.z = seeds[i + 2];
      ember.vx = (Math.random() - 0.5) * spread * M;
      ember.vz = (Math.random() - 0.5) * spread * M;
      ember.vy = (EMBER.rise[0] + (EMBER.rise[1] - EMBER.rise[0]) * Math.random()) * M;
      ember.age = 0;
      ember.life = EMBER.life[0] + (EMBER.life[1] - EMBER.life[0]) * Math.random();
      ember.size = (EMBER.size[0] + (EMBER.size[1] - EMBER.size[0]) * Math.random()) * M;
      ember.seed = seed * 6.283 + since;
      this.live.push(ember);
    }
  }

  /** 불씨 — 바람에 살짝 흔들리며 점점 빨리 떠오르고, 밝게 태어나 식으며 작아져 꺼진다 */
  private stepEmbers(dt: number, since: number) {
    if (this.live.length === 0) {
      if (this.embers.points.visible) {
        this.commitEmbers();
        this.embers.points.visible = false;
      }
      return;
    }
    for (let k = this.live.length - 1; k >= 0; k--) {
      const ember = this.live[k];
      ember.age += dt;
      if (ember.age >= ember.life) {
        this.pool.push(ember);
        this.live.splice(k, 1);
        continue;
      }
      // 떠오를수록 조금 빨라지고(더운 공기), 옆으로는 제자리에서 흔들린다
      ember.vy += 0.05 * M * dt;
      ember.x += (ember.vx + Math.sin(since * 2.1 + ember.seed) * 0.12 * M) * dt;
      ember.z += (ember.vz + Math.cos(since * 1.7 + ember.seed) * 0.12 * M) * dt;
      ember.y += ember.vy * dt;
    }
    this.commitEmbers();
    this.embers.points.visible = true;
  }

  private commitEmbers() {
    const { position, size, alpha, color, count } = this.embers;
    const cool = EMBER_COOL;
    const hot = EMBER_HOT;
    for (let i = 0; i < count; i++) {
      const ember = this.live[i];
      if (!ember) {
        alpha.setX(i, 0);
        size.setX(i, 0);
        continue;
      }
      const u = ember.age / ember.life;
      // 태어날 때 한순간 밝았다가 식는다. 끝에 꺼지는 건 천천히
      const bright = Math.min(1, ember.age / 0.18) * (1 - u * u);
      position.setXYZ(i, ember.x, ember.y, ember.z);
      size.setX(i, ember.size * (1 - u * 0.55));
      alpha.setX(i, 0.9 * bright);
      const t = Math.min(1, u * 1.4);
      color.setXYZ(i, hot.r + (cool.r - hot.r) * t, hot.g + (cool.g - hot.g) * t, hot.b + (cool.b - hot.b) * t);
    }
    this.embers.commit();
  }

  hide() {
    this.root.visible = false;
    this.embers.points.visible = false;
  }

  /**
   * 장면을 떠날 때 — 복제한 재질(GPU 자원)을 내려놓는다. 모형 · 그림은 같이 쓰는 것이라 두고,
   * 다시 들어오면 build 가 몸을 새로 만든다(Codex 리뷰 4)
   */
  release() {
    this.buildTurn += 1;
    this.isBuilding = false;
    this.pool.push(...this.live.splice(0));
    this.embers.points.visible = false;
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
    this.embers.points.removeFromParent();
    this.embers.points.geometry.dispose();
    this.embers.material.dispose();
    (this.body?.material as THREE.Material | undefined)?.dispose();
  }
}
