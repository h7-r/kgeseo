/**
 * 물가 화톳불이 다시 붙는다 — 통발 퍼즐의 끝(fishTrapPuzzle 「lit」).
 * 불씨가 재에 닿으면 불이 오르고 → 연기가 피어올라 화톳불 위에서 플레이어 쪽을 보고 약속의 말을 쓴다
 * → 글이 흩어지며 아비사 쪽으로 흘러간다(「told」). 그다음은 연기 화살표(SmokeGuide)가 길을 이끈다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { createCanvas } from "@/engine/textures/canvas";

import { focusCamera } from "../../scene/cameraFocus";
import { director } from "../../scene/immersion/director";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { M, groundY } from "../units";
import { fishTrapPuzzle } from "./fishTrapState";
import { GUIDE_HEIGHT, GUIDE_PATH, HEARTH } from "./site";

/**
 * 연기가 쓰는 말 — 두 사람이 만나던 때와 곳. 씬2 「바위 아래 조개밭」 물때 퍼즐로 이어진다.
 * 「달이 차오르면」= 보름 사리(물이 가장 많이 빠진다). 정답(보름)을 바로 말하지 않고 플레이어가 풀게 둔다.
 */
const PROMISE_LINES = ["달이 차오르면", "바위 아래", "물이 길을 내준다"];

const FLAME_COUNT = 70;
const AMBIENT_SMOKE = 90;
/** 불에서 글자 획으로 흘러 들어가는 연기 줄기 */
const FEED_SMOKE = 260;

/** 불이 오르는 데 걸리는 초 */
const IGNITE_SECONDS = 1.0;
/** 불이 붙고 글이 모이기 시작할 때까지 */
const FORM_AT = 3.2;
const FORM_SECONDS = 2.2;
/** 글이 흩어지기 시작할 때 */
const RELEASE_AT = 8;
const RELEASE_SECONDS = 3.2;
/** 글이 흩어지기 시작하고 화살표가 모이기 시작할 때까지 */
const GUIDE_HANDOFF = 1.2;
/** 화톳불 위 글 가운데 높이(미터) — 글 아래끝(약 3.3)이 천막 꼭대기(2.9)보다 높게 */
const TEXT_HEIGHT = 4.6;
/** 화톳불이 천막 아래라 바로 위에 쓰면 지붕에 가린다 — 지붕 끝(z 44.1)을 넘어 강 쪽 하늘에 쓴다(미터) */
const TEXT_OUT_Z = 3.4;
/** 천막 기둥 모서리(x 22.5)를 비켜 아비사 쪽(−x) 빈 하늘로 — 천막 아래에서 올려다봐도 안 가린다 */
const TEXT_OUT_X = -1.8;
const TEXT_WIDTH = 2.8;
// 맨 위에 둥근 달, 그 아래 줄마다 150 — 글자 크기(120)보다 넓어야 줄이 안 겹친다
const CANVAS_WIDTH = 1024;
const MOON_Y = 70;
const MOON_RADIUS = 58;
const FIRST_LINE_Y = 240;
const LINE_GAP = 150;
const CANVAS_HEIGHT = FIRST_LINE_Y + LINE_GAP * (PROMISE_LINES.length - 1) + 90;
const TEXT_FONT = '800 120px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

function drawPromiseLines(g: CanvasRenderingContext2D, lines: string[]) {
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = TEXT_FONT;
  g.beginPath();
  g.arc(CANVAS_WIDTH / 2, MOON_Y, MOON_RADIUS, 0, Math.PI * 2);
  g.fill();
  lines.forEach((line, i) => g.fillText(line, CANVAS_WIDTH / 2, FIRST_LINE_Y + LINE_GAP * i));
}

/**
 * 글을 두 가지로 만든다 — 연기 질감을 입힐 가림판(흐린 번짐만 — 또렷한 획이 있으면 글꼴로 읽힌다)과,
 * 연기 줄기가 흘러 들어갈 획 위 자리(0~1, 위가 0).
 */
function makePromiseMask(lines: string[], feedCount: number) {
  const { canvas, g } = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  // 글 자체는 화면 밖에 쓰고 그림자(번짐)만 캔버스에 남긴다 — 넓게 한 번, 좁게 한 번 겹쳐 뭉글한 덩어리로
  const offset = CANVAS_WIDTH * 2;
  g.translate(-offset, 0);
  g.shadowColor = "#fff";
  g.shadowOffsetX = offset;
  g.shadowBlur = 34;
  drawPromiseLines(g, lines);
  g.shadowBlur = 16;
  drawPromiseLines(g, lines);
  const mask = new THREE.CanvasTexture(canvas);

  const sharp = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  drawPromiseLines(sharp.g, lines);
  const data = sharp.g.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
  const hits: [number, number][] = [];
  for (let y = 0; y < CANVAS_HEIGHT; y += 6)
    for (let x = 0; x < CANVAS_WIDTH; x += 6)
      if (data[(y * CANVAS_WIDTH + x) * 4 + 3] > 160) hits.push([x / CANVAS_WIDTH, y / CANVAS_HEIGHT]);
  for (let i = hits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hits[i], hits[j]] = [hits[j], hits[i]];
  }
  return { mask, feedTargets: hits.slice(0, feedCount) };
}

const SMOKE_TEXT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
// 글자 모양을 연기 결로 칠한다 — 가장자리가 일렁이고 위로 피어오르며, 모일 때는 결을 따라 뭉치고 흩어질 때는 풀려 오른다
const SMOKE_TEXT_FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uForm;
  uniform float uOut;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 uv = vUv;
    float n1 = fbm(uv * vec2(4.0, 2.0) + vec2(0.0, -uTime * 0.18));
    float n2 = fbm(uv * vec2(9.0, 4.5) + vec2(uTime * 0.1, -uTime * 0.4));
    // 뭉글한 덩어리 — 작은 결이 위로 천천히 피어오른다
    float puff = fbm(uv * vec2(16.0, 8.0) + vec2(-uTime * 0.05, -uTime * 0.6));
    float amp = 0.02 + uOut * 0.09 + (1.0 - uForm) * 0.05;
    vec2 warp = (vec2(n1, n2) - 0.5) * amp * 2.0;
    warp.y -= uOut * 0.2 * n1;
    float mask = texture2D(uMask, uv + warp).a;
    float gather = smoothstep(n2 * 0.9 + 0.05, n2 * 0.9 + 0.35, uForm * 1.3);
    float dissolve = 1.0 - smoothstep(n1 * 0.8, n1 * 0.8 + 0.3, uOut * 1.3);
    // 번짐에 덩어리를 곱해 문턱을 넘긴 곳만 짙어진다 — 가장자리가 뭉글뭉글 깎인다
    float density = smoothstep(0.3, 0.78, mask * (0.7 + 0.6 * puff));
    // 둘레 연기(불투명 0.28)보다 조금 짙은 정도 — 연기가 짙어진 자리가 글처럼 보이게
    float a = density * gather * dissolve * 0.5;
    if (a < 0.01) discard;
    vec3 color = mix(vec3(0.46, 0.46, 0.49), vec3(0.33, 0.33, 0.36), density);
    gl_FragColor = vec4(color, a);
  }
`;

function createSmokeText() {
  const material = new THREE.ShaderMaterial({
    vertexShader: SMOKE_TEXT_VERTEX,
    fragmentShader: SMOKE_TEXT_FRAGMENT,
    uniforms: { uMask: { value: null }, uTime: { value: 0 }, uForm: { value: 0 }, uOut: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TEXT_WIDTH * M, (TEXT_WIDTH * CANVAS_HEIGHT * M) / CANVAS_WIDTH),
    material,
  );
  mesh.visible = false;
  mesh.renderOrder = 4;
  return { mesh, material };
}

function createSeeds(count: number) {
  return Float32Array.from({ length: count * 4 }, () => Math.random());
}

const fract = (value: number) => value - Math.floor(value);
const UP = new THREE.Vector3(0, 1, 0);
const scratch = {
  target: new THREE.Vector3(),
  control: new THREE.Vector3(),
  position: new THREE.Vector3(),
  basis: new THREE.Matrix4(),
  release: new THREE.Vector3(),
  fireTop: new THREE.Vector3(),
};

export default function HearthFire() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const lightRef = useRef<THREE.PointLight>(null);
  const litAtRef = useRef(-1);
  const isToldRef = useRef(false);
  /** 글이 선 자리 — 가운데와 오른쪽 방향(유닛). 글이 모이는 순간 정한다 */
  const textFrameRef = useRef<{ center: THREE.Vector3; right: THREE.Vector3 } | null>(null);
  const feedTargetsRef = useRef<[number, number][]>([]);

  const flames = useMemo(() => makeGlowPoints(FLAME_COUNT, { additive: true, softness: 1.6 }), []);
  const smoke = useMemo(() => makeGlowPoints(AMBIENT_SMOKE, { additive: false, softness: 1.4 }), []);
  const words = useMemo(() => makeGlowPoints(FEED_SMOKE, { additive: false, softness: 1.3 }), []);
  const smokeText = useMemo(() => createSmokeText(), []);
  const flameSeeds = useMemo(() => createSeeds(FLAME_COUNT), []);
  const smokeSeeds = useMemo(() => createSeeds(AMBIENT_SMOKE), []);
  const wordSeeds = useMemo(() => createSeeds(FEED_SMOKE), []);

  const base = useMemo(() => new THREE.Vector3(HEARTH.x * M, groundY(HEARTH.x, HEARTH.z) * M, HEARTH.z * M), []);

  useEffect(() => {
    const group = new THREE.Group();
    group.add(flames.points, smoke.points, words.points, smokeText.mesh);
    scene.add(group);
    return () => {
      scene.remove(group);
    };
  }, [scene, flames, smoke, words, smokeText]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const stage = fishTrapPuzzle.stage();
    if (stage !== "lit" && stage !== "told") {
      litAtRef.current = -1;
      flames.alpha.array.fill(0);
      smoke.alpha.array.fill(0);
      words.alpha.array.fill(0);
      flames.commit();
      smoke.commit();
      words.commit();
      smokeText.mesh.visible = false;
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }
    if (litAtRef.current < 0) {
      litAtRef.current = time;
      // 불이 붙는 순간만 짧게 확대했다 바로 돌아온다 — 흔들림·돌리줌·시선 끌기 없이
      director.cue({ 소리: "징" });
      director.cue({ 카메라: "줌인", 세기: 0.55, 초: 0.9 });
      const promise = makePromiseMask(PROMISE_LINES, FEED_SMOKE);
      smokeText.material.uniforms.uMask.value = promise.mask;
      feedTargetsRef.current = promise.feedTargets;
    }
    const age = time - litAtRef.current;
    const fire = THREE.MathUtils.smoothstep(age, 0, IGNITE_SECONDS);

    // 불꽃 — 아래는 희게 달고 위로 갈수록 주황·빨강으로 식는다
    for (let k = 0; k < FLAME_COUNT; k++) {
      const seed = k * 4;
      const life = 0.6 + flameSeeds[seed] * 0.5;
      const t = fract(time / life + flameSeeds[seed + 1]);
      const angle = flameSeeds[seed + 2] * Math.PI * 2;
      const radius = (0.05 + flameSeeds[seed + 3] * 0.17) * (1 - t * 0.7);
      const sway = Math.sin(time * 6 + k) * 0.04 * t;
      flames.position.setXYZ(
        k,
        base.x + (Math.cos(angle) * radius + sway) * M,
        base.y + (0.04 + t * (0.55 + flameSeeds[seed] * 0.45) * fire) * M,
        base.z + Math.sin(angle) * radius * M,
      );
      flames.size.setX(k, (0.3 - t * 0.22) * M * fire);
      flames.alpha.setX(k, (1 - t) * 0.85 * fire);
      const hot = 1 - t;
      flames.color.setXYZ(k, 1.8, 0.55 + hot * 0.9, 0.12 + hot * hot * 0.6);
    }
    flames.commit();

    // 화톳불 연기 — 불이 붙은 뒤로 늘 피어오른다
    for (let k = 0; k < AMBIENT_SMOKE; k++) {
      const seed = k * 4;
      const life = 3.5 + smokeSeeds[seed] * 1.5;
      const t = fract(time / life + smokeSeeds[seed + 1]);
      const drift = Math.sin(time * 0.7 + k) * 0.15 * t;
      smoke.position.setXYZ(
        k,
        base.x + ((smokeSeeds[seed + 2] - 0.5) * 0.3 + drift + t * TEXT_OUT_X * 0.8) * M,
        base.y + (0.6 + t * 2.6) * M,
        base.z + ((smokeSeeds[seed + 3] - 0.5) * 0.3 + t * TEXT_OUT_Z * 0.8) * M,
      );
      smoke.size.setX(k, (0.25 + t * 0.6) * M);
      smoke.alpha.setX(k, Math.sin(t * Math.PI) * 0.28 * THREE.MathUtils.smoothstep(age, 0.8, 2.2));
      smoke.color.setXYZ(k, 0.42, 0.42, 0.45);
    }
    smoke.commit();

    // 연기 글씨 — 모이는 순간 플레이어 쪽을 본다. 그 뒤로는 그 자리에 선다
    if (age >= FORM_AT && !textFrameRef.current) {
      const center = base.clone().add(new THREE.Vector3(TEXT_OUT_X * M, TEXT_HEIGHT * M, TEXT_OUT_Z * M));
      const toCamera = new THREE.Vector3().subVectors(state.camera.position, center).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(UP, toCamera).normalize();
      textFrameRef.current = { center, right };
      // 글이 서는 동안만 시선을 붙든다 — 모르고 지나치면 길잡이를 놓친다
      focusCamera({ id: "hearth-promise", target: center, hold: 3.0, turnIn: 0.8, turnOut: 0.6, zoom: 0.85 });
      smokeText.mesh.position.copy(center);
      smokeText.mesh.quaternion.setFromRotationMatrix(scratch.basis.makeBasis(right, UP, toCamera));
    }
    const frame = textFrameRef.current;
    const form = THREE.MathUtils.clamp((age - FORM_AT - 0.5) / FORM_SECONDS, 0, 1);
    const out = THREE.MathUtils.clamp((age - RELEASE_AT) / RELEASE_SECONDS, 0, 1);
    smokeText.mesh.visible = !!frame && out < 1;
    smokeText.material.uniforms.uTime.value = time;
    smokeText.material.uniforms.uForm.value = form;
    smokeText.material.uniforms.uOut.value = out;

    // 불에서 오른 연기 줄기가 글자 획으로 흘러 들어가 스며든다 · 흩어질 때는 획에서 풀려 화살표가 모일 자리로(SmokeGuide)
    const targets = feedTargetsRef.current;
    const [gatherX, gatherZ] = GUIDE_PATH[0];
    const { target, control, position, release, fireTop } = scratch;
    release.set(gatherX * M, (groundY(gatherX, gatherZ) + GUIDE_HEIGHT) * M, gatherZ * M);
    fireTop.copy(base).addScaledVector(UP, 0.7 * M);
    for (let k = 0; k < FEED_SMOKE; k++) {
      const point = targets[k];
      if (!frame || !point) {
        words.alpha.setX(k, 0);
        continue;
      }
      const seed = k * 4;
      target
        .copy(frame.center)
        .addScaledVector(frame.right, (point[0] - 0.5) * TEXT_WIDTH * M)
        .addScaledVector(UP, ((0.5 - point[1]) * TEXT_WIDTH * CANVAS_HEIGHT * M) / CANVAS_WIDTH);
      const feed = THREE.MathUtils.clamp((age - FORM_AT - wordSeeds[seed] * FORM_SECONDS * 0.8) / 1.5, 0, 1);
      const leave = THREE.MathUtils.clamp((age - RELEASE_AT - wordSeeds[seed + 1] * 1.6) / 3, 0, 1);
      let alpha = 0;
      let size = 0;
      if (leave > 0) {
        position.lerpVectors(target, release, 1 - Math.pow(1 - leave, 2));
        position.x += (wordSeeds[seed + 2] - 0.5) * 0.8 * M;
        position.y += (Math.sin(leave * Math.PI) * 0.6 + Math.sin(time * 0.9 + k) * 0.1) * M;
        position.z += (wordSeeds[seed + 3] - 0.5) * 0.8 * M;
        alpha = Math.sin(leave * Math.PI) * 0.3;
        size = (0.25 + leave * 0.5) * M;
      } else if (feed > 0 && feed < 1) {
        const eased = 1 - Math.pow(1 - feed, 2);
        control.copy(fireTop).lerp(target, 0.5);
        control.y = target.y + 0.3 * M;
        control.x += Math.sin(k * 1.7) * 0.4 * M;
        position
          .copy(fireTop)
          .multiplyScalar((1 - eased) * (1 - eased))
          .addScaledVector(control, 2 * eased * (1 - eased))
          .addScaledVector(target, eased * eased);
        alpha = 0.4 * (1 - THREE.MathUtils.smoothstep(feed, 0.7, 1));
        size = (0.4 - eased * 0.25) * M;
      }
      words.position.setXYZ(k, position.x, position.y, position.z);
      words.size.setX(k, size);
      words.alpha.setX(k, alpha);
      words.color.setXYZ(k, 0.4, 0.4, 0.42);
    }
    words.commit();

    // 흩어진 연기가 모일 무렵 화살표에 넘긴다 — 이다음은 SmokeGuide 가 길을 이끈다
    if (!isToldRef.current && age > RELEASE_AT + GUIDE_HANDOFF) {
      isToldRef.current = true;
      fishTrapPuzzle.tell();
    }

    const scale = pointScaleFor(gl, state.camera);
    flames.material.uniforms.uPointScale.value = scale;
    smoke.material.uniforms.uPointScale.value = scale;
    words.material.uniforms.uPointScale.value = scale;

    const light = lightRef.current;
    if (light) {
      light.position.set(base.x, base.y + 0.5 * M, base.z);
      light.intensity = fire * (2.6 + Math.sin(time * 13) * 0.3 + Math.sin(time * 7.7) * 0.25);
    }
  });

  // 빛은 처음부터 붙여 두고 세기만 바꾼다 — 나중에 붙이면 모든 재질의 셰이더가 다시 컴파일돼 한 번 멈춘다
  return <pointLight ref={lightRef} color="#FF9A45" intensity={0} distance={7 * M} decay={1.3} />;
}
