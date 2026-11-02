/**
 * 통나무 걸상 — 평상 곁 걸상 다섯 윗면에 그림이 하나씩 새겨져 있다(해 · 달 · 물결 · 새 · 불).
 * 평상 널에 누군가 칼로 새긴 그날 밤 이야기(STORY) — 해 · 달 · 물결 · 새 · 불이 차례로 나온다.
 * 이야기 차례대로 걸상에 올라서면 [C] 로 꾹 밟을 때마다 새김에 흰빛이 들고, 틀리면 다 꺼진다(처음부터).
 * 바람이 잦아든 뒤에야(장승 고리) 걸상이 흔들리지 않아 디딜 수 있다. 다 맞히면 남은 바람이 걸상을 들어 올려
 * 돌새 곁에 허공 계단으로 띄운다 — 밟고 올라가면 돌새에 손이 닿는다.
 * 평상 널의 글은 처음엔 없다 — 장승 고리를 맞춰 횃불이 치솟으면 불티 하나가 날아와 평상에 떨어지고, 널이 왼쪽에서 오른쪽으로
 * 타들어 가며 꺼진 자리에 새김이 드러난다(불이 오른쪽 끝까지 가야 다 읽힌다).
 * 걸상 모양은 화면의 「씬2.걸상」을 그대로 빌려 그리고, 원래 것은 숨긴다(걷기 판정도 같이 비운다). 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { releasePropColliders } from "../../movement/propColliders";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M, groundY, makeGlowPoints, pointScaleFor } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { setPuzzlePanel } from "../puzzlePanel";
import { GATE } from "./ridgeShape";
import { ridge, ridgeQuest } from "./ridgeState";

const SYMBOLS = ["해", "달", "물결", "새", "불"] as const;
/** 이야기 차례 — 해 · 달 · 물결 · 새 · 불 */
const ANSWER = [0, 1, 2, 3, 4];
/** 걸상마다 새긴 그림 — 남(z 작은 쪽)에서 북으로 늘어선 차례에 */
const CARVED = [2, 0, 4, 1, 3];
/** 평상 널에 새긴 이야기 — 옛 글투로 다섯 줄. 그림 차례가 줄 차례다 */
const STORY_LINES = [
  "해가 서산 너머로 기울어 저물고",
  "둥근 달이 강 위로 떠오르매",
  "그이는 물결을 헤치고 바위로 건너갔더라",
  "밤새가 세 번 길게 울더니",
  "마침내 등불이 스러져 꺼졌더라",
];
const STORY = STORY_LINES.join(" / ");
/** 평상 가운데(edits.json 「씬2.평상」) */
const PLATFORM = { x: 74.03, z: 16.65 };
/** 허공 계단 — 두 돌새 사이 서쪽 곁에서 남서로 내려간다. 윗면 높이(땅 위 m) */
const STAIR_TOP = { x: 73.8, z: 21.55 };
const STAIR_STEP = { x: -0.55, z: -0.3 };
const STEP_HEIGHTS = [0.45, 0.85, 1.25, 1.65, 2.05];
const FLY_SECONDS = 2.6;
const FLY_STAGGER = 0.45;
/** 눈에서 발까지(m) */
const EYE = 1.25;
/** 불티가 횃불에서 평상까지 날아가는 시간 · 널이 왼쪽 끝에서 오른쪽 끝까지 타는 시간(초) · 불꽃 알갱이 수 */
const EMBER_SECONDS = 1.8;
const BURN_SECONDS = 9;
const FLAME_POINTS = 150;
const TRAIL_POINTS = 14;
/** 글판 크기(m) */
const STORY_PLANE = { width: 2.8, height: 1.4 };

/**
 * 걸상 윗면에 새긴 그림 — 두 겹 테두리 안에 그림 하나. 판 홈(어둡게) 아래로 밝은 턱, 빛이 들면 발광으로 희게 빛난다.
 * 해: 겹동그라미와 뾰족한 빛살 열둘 · 달: 초승달과 둥근 달무리 · 물결: 끝이 말린 물결 세 겹 · 새: 날개 편 새 · 불: 세 갈래 불꽃
 */
function makeTopTexture(symbol: number) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d")!;
  const mid = size / 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  const draw = (color: string, dx: number, dy: number) => {
    c.save();
    c.translate(mid + dx, mid + dy);
    c.strokeStyle = color;
    c.fillStyle = color;
    // 두 겹 테두리
    c.lineWidth = 12;
    c.beginPath();
    c.arc(0, 0, 214, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 0, 190, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 16;
    if (symbol === 0) {
      c.beginPath();
      c.arc(0, 0, 62, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(0, 0, 26, 0, Math.PI * 2);
      c.fill();
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const long = k % 2 === 0 ? 160 : 130;
        c.beginPath();
        c.moveTo(Math.cos(a - 0.12) * 88, Math.sin(a - 0.12) * 88);
        c.lineTo(Math.cos(a) * long, Math.sin(a) * long);
        c.lineTo(Math.cos(a + 0.12) * 88, Math.sin(a + 0.12) * 88);
        c.closePath();
        c.fill();
      }
    } else if (symbol === 1) {
      c.beginPath();
      c.arc(-10, 0, 120, Math.PI * 0.28, Math.PI * 1.72);
      c.bezierCurveTo(-30, -70, -30, 70, Math.cos(Math.PI * 0.28) * 120 - 10, Math.sin(Math.PI * 0.28) * 120);
      c.closePath();
      c.fill();
      // 달무리 — 끊어진 둥근 테
      c.lineWidth = 7;
      for (let k = 0; k < 10; k++) {
        const a0 = (k / 10) * Math.PI * 2;
        c.beginPath();
        c.arc(0, 0, 160, a0, a0 + 0.42);
        c.stroke();
      }
    } else if (symbol === 2) {
      // 끝이 동그랗게 말린 물결 세 겹
      for (let row = -1; row <= 1; row++) {
        const y = row * 62;
        c.beginPath();
        c.moveTo(-150, y + 20);
        for (let x = -150; x <= 150; x += 6) c.lineTo(x, y + Math.sin((x / 150) * Math.PI * 2) * 22);
        c.stroke();
        c.beginPath();
        c.arc(150, y - 12, 18, Math.PI * 0.6, Math.PI * 2.2);
        c.stroke();
      }
    } else if (symbol === 3) {
      // 날개 편 새 — 몸 · 머리 · 부리 · 깃 끝이 갈라진 날개 · 부채 꽁지
      c.beginPath();
      c.ellipse(0, 20, 30, 70, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(0, -62, 26, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(-9, -84);
      c.lineTo(0, -122);
      c.lineTo(9, -84);
      c.fill();
      for (const side of [-1, 1]) {
        c.beginPath();
        c.moveTo(side * 20, -10);
        c.quadraticCurveTo(side * 90, -90, side * 168, -70);
        // 깃 끝 — 톱니처럼 넷
        for (let f = 0; f < 4; f++) {
          c.lineTo(side * (150 - f * 30), -40 + f * 14);
          c.lineTo(side * (140 - f * 30), -54 + f * 14);
        }
        c.quadraticCurveTo(side * 60, 10, side * 20, 30);
        c.closePath();
        c.fill();
      }
      c.beginPath();
      c.moveTo(-14, 80);
      c.lineTo(-46, 150);
      c.lineTo(0, 132);
      c.lineTo(46, 150);
      c.lineTo(14, 80);
      c.closePath();
      c.fill();
    } else {
      // 세 갈래 불꽃 — 테두리 선으로, 가운데 혀만 속을 채운다
      c.lineWidth = 14;
      const tongue = (x: number, h: number, w: number, fill: boolean) => {
        c.beginPath();
        c.moveTo(x, 130);
        c.bezierCurveTo(x + w, 70, x + w * 0.9, -h * 0.35, x + w * 0.1, -h);
        c.bezierCurveTo(x - w * 0.15, -h * 0.45, x - w, 50, x, 130);
        if (fill) c.fill();
        else c.stroke();
      };
      tongue(-78, 70, 48, false);
      tongue(78, 80, 48, false);
      tongue(0, 155, 72, false);
      tongue(0, 70, 32, true);
    }
    c.restore();
  };
  draw("rgba(216,186,140,0.55)", 3, 4);
  draw("#1B1008", 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 평상 널에 새긴 글 — 다섯 줄, 판 홈. 가장 긴 줄이 판 폭 안에 들어오게 글 크기를 맞춘다(잘리지 않게) */
const STORY_CANVAS = { width: 2048, height: 1024, margin: 90 };
function makeStoryTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_CANVAS.width;
  canvas.height = STORY_CANVAS.height;
  const c = canvas.getContext("2d")!;
  const family = '"Nanum Myeongjo","AppleMyungjo","Batang",serif';
  let size = 150;
  const fits = () => {
    c.font = `800 ${size}px ${family}`;
    return STORY_LINES.every((line) => c.measureText(line).width <= STORY_CANVAS.width - STORY_CANVAS.margin * 2);
  };
  while (!fits() && size > 40) size -= 4;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const gap = Math.min(size * 1.35, (STORY_CANVAS.height - STORY_CANVAS.margin) / STORY_LINES.length);
  const top = STORY_CANVAS.height / 2 - (gap * (STORY_LINES.length - 1)) / 2;
  STORY_LINES.forEach((line, i) => {
    const y = top + gap * i;
    // 칼로 갓 판 홈 — 검은 널 위에서 속살(밝은 나무)이 드러나고, 위쪽 턱에 그늘
    c.fillStyle = "rgba(10,5,2,0.85)";
    c.fillText(line, STORY_CANVAS.width / 2 - 3, y - 4);
    c.fillStyle = "#C9A27A";
    c.fillText(line, STORY_CANVAS.width / 2, y);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Stump {
  group: THREE.Group;
  /** 땅 위 처음 자리 · 계단 자리(미터) */
  home: THREE.Vector3;
  stair: THREE.Vector3;
  symbol: number;
  /** 윗면 높이(밑동 기준 m) · 반지름(m) */
  height: number;
  radius: number;
  top: THREE.MeshToonMaterial;
  solid: DynamicSolid;
  lit: number;
  /** [C] 로 밟은 때 — 살짝 눌렸다 올라온다 */
  pressedAt: number;
}

function createRig() {
  return {
    stumps: [] as Stump[],
    sources: [] as THREE.Mesh[],
    progress: 0,
    pressQueued: false,
    onNow: -1,
    lastOn: -1,
    lastOnAt: -99,
    toldPress: false,
    solvedAt: -1,
    toldWindy: false,
    toldNear: false,
    searchedAt: -99,
    storyTriedAt: -99,
    storyPlaced: false,
    story: makeStoryMaterial(),
    storyPlane: null as THREE.Mesh | null,
    /** 불티가 떠난 때(초, −1 이면 아직) · 다 탔나 */
    emberAt: -1,
    burnDone: false,
    flames: makeGlowPoints(FLAME_POINTS + TRAIL_POINTS, { additive: true, softness: 1.6 }),
    flameSeeds: Float32Array.from({ length: (FLAME_POINTS + TRAIL_POINTS) * 3 }, () => Math.random()),
    fireLight: new THREE.PointLight("#FF9A45", 0, 6 * M, 1.5),
  };
}

/**
 * 평상 글판 재질 — 타들어 간 자리(uBurn 왼쪽)만 보인다: 그을린 널 위에 새김이 밝은 속살로 드러나고, 타는 앞전은 불빛,
 * 그 뒤로는 불씨가 깜박인다. 아직 안 탄 자리는 투명(널 그대로)
 */
function makeStoryMaterial() {
  const material = new THREE.MeshToonMaterial({ map: makeStoryTexture(), transparent: true, depthWrite: false, gradientMap: TOON_GRADIENT, polygonOffset: true, polygonOffsetFactor: -2 });
  const uniforms = { uBurn: { value: 0 }, uTime: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = uniforms.uBurn;
    shader.uniforms.uTime = uniforms.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uBurn;\nuniform float uTime;\nfloat burnHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }")
      .replace("#include <map_fragment>", "#include <map_fragment>\nfloat storyInk = diffuseColor.a;\ndiffuseColor.a = 1.0;")
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        {
          float n = burnHash(floor(vMapUv * vec2(80.0, 40.0)));
          float edge = vMapUv.x + (n - 0.5) * 0.06 + 0.03 * sin(vMapUv.y * 23.0);
          float front = uBurn * 1.12 - 0.06;
          float burned = 1.0 - smoothstep(front - 0.015, front + 0.015, edge);
          float burning = step(0.001, uBurn) * step(uBurn, 0.999);
          float flame = exp(-abs(edge - front) * 16.0) * burning;
          float ember = exp(-max(front - edge, 0.0) * 7.0) * burning * (0.4 + 0.6 * n) * (0.6 + 0.4 * sin(uTime * 9.0 + n * 30.0));
          // 글자만 남는다 — 타고 난 자리에 그을린 글씨, 앞전엔 불빛, 뒤로는 글자 위에만 불씨
          vec3 ink = vec3(0.92, 0.74, 0.5);
          vec3 col = ink + vec3(1.0, 0.45, 0.12) * ember * 1.2;
          col += vec3(1.0, 0.55, 0.15) * flame * 3.0;
          float inkAlpha = storyInk * burned;
          gl_FragColor = vec4(mix(vec3(1.0, 0.6, 0.2), col, step(0.5, inkAlpha)), max(inkAlpha, flame * 1.4));
        }`,
      );
  };
  material.customProgramCacheKey = () => "storyBurn";
  return { material, uniforms };
}

export default function StumpStairs() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => createRig(), []);
  const removers = useRef<(() => void)[]>([]);

  useEffect(
    () => () => {
      removers.current.forEach((remove) => remove());
      for (const stump of rig.stumps) scene.remove(stump.group);
    },
    [scene, rig],
  );

  /** 화면의 걸상 다섯을 찾아 빌려 그린다 — 원래 것은 숨긴다(숨기면 걷기 격자도 새로 구워 비운다) */
  const borrow = (time: number) => {
    if (rig.stumps.length || time - rig.searchedAt < 1) return;
    rig.searchedAt = time;
    const found: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isMesh || o.name !== "씬2.걸상") return;
      o.updateMatrixWorld(true);
      if (mesh.isInstancedMesh)
        for (let i = 0; i < mesh.count; i++) {
          const m = new THREE.Matrix4();
          mesh.getMatrixAt(i, m);
          found.push({ mesh, matrix: m.premultiply(o.matrixWorld) });
        }
      else found.push({ mesh, matrix: o.matrixWorld.clone() });
    });
    if (found.length < CARVED.length) return;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    // 남(z 작은 쪽)에서 북으로
    found.sort((a, b) => a.matrix.elements[14] - b.matrix.elements[14]);
    found.slice(0, CARVED.length).forEach(({ mesh, matrix }, k) => {
      matrix.decompose(position, quaternion, scale);
      const group = new THREE.Group();
      const part = new THREE.Mesh(mesh.geometry, mesh.material);
      part.quaternion.copy(quaternion);
      part.scale.copy(scale);
      part.castShadow = true;
      part.receiveShadow = true;
      group.add(part);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, scale));
      // 밑동이 원점에 오게
      part.position.y = -box.min.y;
      const height = (box.max.y - box.min.y) / M;
      const radius = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2 / M;
      const top = new THREE.MeshToonMaterial({
        map: makeTopTexture(CARVED[k]),
        transparent: true,
        alphaTest: 0.3,
        gradientMap: TOON_GRADIENT,
        emissive: new THREE.Color("#FFF8EE"),
        emissiveIntensity: 0,
      });
      const decal = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86 * M, 24), top);
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = (height + 0.004) * M;
      group.add(decal);
      const home = new THREE.Vector3(position.x / M, groundY(position.x / M, position.z / M), position.z / M);
      group.position.set(home.x * M, home.y * M, home.z * M);
      scene.add(group);
      const t = CARVED.length - 1 - k;
      const stairX = STAIR_TOP.x + STAIR_STEP.x * t;
      const stairZ = STAIR_TOP.z + STAIR_STEP.z * t;
      const solid: DynamicSolid = {
        x: home.x,
        z: home.z,
        yaw: 0,
        halfX: radius * 0.95,
        halfZ: radius * 0.95,
        bottom: home.y - 0.1,
        top: home.y + height,
        enabled: true,
      };
      removers.current.push(addDynamicSolid(solid));
      releasePropColliders("걸상", home.x, home.z, 0.4);
      rig.stumps.push({
        group,
        home,
        stair: new THREE.Vector3(stairX, groundY(stairX, stairZ) + STEP_HEIGHTS[CARVED.length - 1 - t] - height, stairZ),
        symbol: CARVED[k],
        height,
        radius,
        top,
        solid,
        lit: 0,
        pressedAt: -99,
      });
    });
    // 원래 걸상은 숨긴다 — 같은 모양을 우리가 그린다. 새 새김 재질은 미리 굽는다
    for (const { mesh } of found) mesh.visible = false;
    prewarmShaders(gl, scene, camera, rig.stumps.map((s) => s.group));
    rig.sources = found.map((f) => f.mesh);
  };

  /** 평상 널 위 글 — 평상 윗면 높이를 위에서 쏴 잰다 */
  const placeStory = (time: number) => {
    if (rig.storyPlaced || time - rig.storyTriedAt < 1) return;
    // 평상 가까이에서만, 평상 메시에만 쏜다 — 장면 전체에 쏘면 프레임이 끊긴다
    if (Math.hypot(camera.position.x / M - PLATFORM.x, camera.position.z / M - PLATFORM.z) > 25) return;
    rig.storyTriedAt = time;
    const targets: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible && o.name.endsWith("평상")) targets.push(o);
    });
    const ray = new THREE.Raycaster(new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + 3) * M, PLATFORM.z * M), new THREE.Vector3(0, -1, 0), 0, 3 * M);
    ray.camera = camera;
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return;
    // 판 크기는 글판 비율 그대로(2.8 m × 1.4 m) — 평상(약 4 m × 5 m) 널 한가운데
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(STORY_PLANE.width * M, STORY_PLANE.height * M), rig.story.material);
    plane.position.copy(hit.point).addScaledVector(new THREE.Vector3(0, 1, 0), 0.006 * M);
    // 걸상 쪽(서쪽)에 서서 읽게 — 글 위쪽이 동쪽(+x)
    plane.rotation.set(-Math.PI / 2, -Math.PI / 2, 0, "YXZ");
    scene.add(plane, rig.flames.points, rig.fireLight);
    rig.flames.points.visible = false;
    removers.current.push(() => scene.remove(plane, rig.flames.points, rig.fireLight));
    rig.storyPlane = plane;
    rig.storyPlaced = true;
    prewarmShaders(gl, scene, camera, [plane, rig.flames.points]);
  };

  /**
   * 평상이 탄다 — 고리를 맞춘 순간(횃불이 치솟을 때) 왼쪽 횃불에서 불티 하나가 날아와 글판 왼쪽 끝에 떨어지고,
   * 널이 왼쪽에서 오른쪽으로 타들어 가며 꺼진 자리에 새김이 드러난다. 불꽃 알갱이는 타는 앞전을 따라간다
   */
  const burnStory = (time: number, dt: number) => {
    const plane = rig.storyPlane;
    if (!plane || rig.burnDone) return;
    if (!ridgeQuest.postsSolved) return;
    if (rig.emberAt < 0) {
      rig.emberAt = time;
      audio.play("단서");
      showNotice("횃불에서 튄 불티 하나가 바람을 타고 평상으로 날아간다…", 3.5);
    }
    const since = time - rig.emberAt;
    const flames = rig.flames;
    flames.points.visible = true;
    // 글판 자기 좌표 → 세계(유닛). 왼쪽 끝 = u 0
    const at = (u: number, v: number, lift: number) => plane.localToWorld(new THREE.Vector3((u - 0.5) * STORY_PLANE.width * M, (v - 0.5) * STORY_PLANE.height * M, lift * M));
    const torch = GATE.torches[0];
    const from = new THREE.Vector3(torch.x * M, (groundY(torch.x, torch.z) + GATE.flameHeight) * M, torch.z * M);
    const landing = at(0.02, 0.5, 0.02);
    if (since < EMBER_SECONDS) {
      // 불티 — 포물선을 그리며 날아간다. 꼬리가 따른다
      for (let k = 0; k < TRAIL_POINTS; k++) {
        const u = THREE.MathUtils.clamp((since - k * 0.045) / EMBER_SECONDS, 0, 1);
        const p = from.clone().lerp(landing, u);
        p.y += Math.sin(u * Math.PI) * 1.6 * M;
        flames.position.setXYZ(k, p.x, p.y, p.z);
        flames.size.setX(k, (0.2 - k * 0.008) * M);
        flames.alpha.setX(k, (1 - k / TRAIL_POINTS) * 0.9);
        flames.color.setXYZ(k, 1.9, 0.8 - k * 0.02, 0.25);
      }
      for (let k = TRAIL_POINTS; k < TRAIL_POINTS + FLAME_POINTS; k++) flames.alpha.setX(k, 0);
      rig.fireLight.position.copy(from.clone().lerp(landing, since / EMBER_SECONDS));
      rig.fireLight.intensity = 1.6;
      if (since + dt >= EMBER_SECONDS) {
        audio.play("첨벙");
        director.cue({ 카메라: "흔들림", 세기: 0.1 });
        showNotice("불티가 평상 널에 떨어져 불이 붙는다 — 널이 타들어 가며 무언가 드러난다.", 4);
      }
    } else {
      const burn = Math.min(1, (since - EMBER_SECONDS) / BURN_SECONDS);
      rig.story.uniforms.uBurn.value = burn;
      rig.story.uniforms.uTime.value = time;
      const front = burn * 1.12 - 0.06;
      for (let k = 0; k < TRAIL_POINTS; k++) flames.alpha.setX(k, 0);
      for (let k = TRAIL_POINTS; k < TRAIL_POINTS + FLAME_POINTS; k++) {
        const s = k * 3;
        const life = 0.5 + rig.flameSeeds[s] * 0.5;
        const u = (time / life + rig.flameSeeds[s + 1]) % 1;
        const p = at(THREE.MathUtils.clamp(front + (rig.flameSeeds[s + 2] - 0.5) * 0.1, 0, 1), rig.flameSeeds[s], 0.02 + u * 0.9);
        flames.position.setXYZ(k, p.x, p.y, p.z);
        flames.size.setX(k, (0.5 - u * 0.32) * M * (burn < 1 ? 1 : 0));
        flames.alpha.setX(k, (1 - u) * 0.95 * (burn < 1 ? 1 : 0));
        flames.color.setXYZ(k, 1.8, 0.55 + (1 - u) * 0.9, 0.12);
      }
      rig.fireLight.position.copy(at(THREE.MathUtils.clamp(front, 0, 1), 0.5, 0.4));
      rig.fireLight.intensity = burn < 1 ? 5 + Math.sin(time * 13) * 0.8 : 0;
      if (burn >= 1) {
        rig.burnDone = true;
        flames.points.visible = false;
        showNotice("불이 오른쪽 끝까지 타고 꺼졌다. 그을린 널에 칼로 새긴 글이 다 드러났다 — 걸상 다섯을 그 차례대로.", 5);
      }
    }
    flames.commit();
    flames.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  };

  // [C] — 올라선 걸상을 꾹 밟는다(앉기 키와 같다)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyC" && !event.repeat) rig.pressQueued = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rig]);

  useEffect(() => {
    const removeStory = registerInteractable({
      id: "ridge-platform-story",
      position: new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + 0.55) * M, PLATFORM.z * M),
      label: "타다 만 평상 널 살피기",
      radius: 0.8 * M,
      reach: 2.4 * M,
      enabled: () => rig.burnDone,
      use: () => showNotice(`불에 그을린 널에 칼로 새긴 글이 드러났다 — 「${STORY}」`, 9),
    });
    exposeDevHook("najuStumpDev", {
      solve: () => {
        rig.progress = ANSWER.length;
        for (const stump of rig.stumps) stump.lit = 1;
        ridgeQuest.set("stairs");
      },
      state: () => ({ progress: rig.progress, on: rig.onNow, stumps: rig.stumps.map((s) => ({ symbol: SYMBOLS[s.symbol], x: s.home.x, z: s.home.z, top: s.group.position.y / M + s.height, r: s.radius })) }),
    });
    return removeStory;
  }, [rig]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    if (ridge.isAtLeast("sealing")) borrow(time);
    placeStory(time);
    burnStory(time, dt);
    if (!rig.stumps.length) return;
    // 원래 걸상이 다시 보이게 되면(구역 초점 등) 도로 숨긴다
    for (const mesh of rig.sources) mesh.visible = false;

    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const foot = camera.position.y / M - EYE;
    const sealed = ridge.stage() === "sealed";

    // 지금 딛고 선 걸상
    let on = -1;
    rig.stumps.forEach((stump, k) => {
      const top = stump.group.position.y / M + stump.height;
      // 넉넉히 — 높이 뛰어 내려앉을 때 가장자리를 딛거나 막 내려앉는 중이어도 밟은 것으로 본다
      // 아래쪽은 앉은 눈높이까지(C 로 밟으면 앉으며 눈이 내려간다)
      if (foot > top - 0.75 && foot < top + 0.4 && Math.hypot(px - stump.group.position.x / M, pz - stump.group.position.z / M) < stump.radius + 0.3) on = k;
    });
    // 걸상 위에 올라서면 한 번 알려 준다 — 밟기는 [C] 로 꾹
    if (sealed && ridgeQuest.postsSolved && !ridgeQuest.stairs && on >= 0 && !rig.toldPress) {
      rig.toldPress = true;
      showNotice("걸상 위에 올라섰다. [C] 로 꾹 밟으면 걸상이 눌린다.", 3.5);
    }
    rig.onNow = on;
    if (on >= 0) {
      rig.lastOn = on;
      rig.lastOnAt = time;
    }
    const pressed = rig.pressQueued;
    rig.pressQueued = false;
    // 누른 바로 그 장면에 판정이 흔들려도 — 방금까지 서 있던 걸상으로 친다
    const pressedOn = on >= 0 ? on : time - rig.lastOnAt < 0.4 ? rig.lastOn : -1;
    if (sealed && !ridgeQuest.stairs && pressedOn >= 0 && pressed) {
      const stump = rig.stumps[pressedOn];
      stump.pressedAt = time;
      if (!ridgeQuest.postsSolved) {
        if (!rig.toldWindy) {
          rig.toldWindy = true;
          showNotice("걸상이 바람에 들썩여 디딜 때마다 흔들린다. 새김도 읽을 수가 없다 — 먼저 바람부터 잠재워야겠다.", 4.5);
        }
      } else if (stump.lit > 0) {
        // 이미 빛이 든 걸상을 또 밟았다 — 그대로 둔다
      } else if (stump.symbol === ANSWER[rig.progress]) {
        rig.progress++;
        stump.lit = 1;
        audio.play("똑");
        if (rig.progress === ANSWER.length) {
          rig.solvedAt = time;
          ridgeQuest.set("stairs");
          audio.play("징");
          director.cue({ 카메라: "흔들림", 세기: 0.18 });
          showNotice("다섯 새김에 흰빛이 다 들자, 남은 바람이 걸상을 하나씩 들어 올린다 — 돌새 곁에 허공 계단이 놓인다!", 5.5);
        }
      } else if (rig.progress > 0) {
        rig.progress = 0;
        for (const s of rig.stumps) s.lit = 0;
        audio.play("우르릉");
        showNotice("걸상이 덜컹 내려앉으며 새김의 빛이 다 꺼진다. 처음부터 — 평상 널의 이야기 차례대로.", 4);
      }
    }

    // 다 맞히면 — 차례로 들려 날아가 계단 자리에 뜬다
    if (ridgeQuest.stairs && rig.solvedAt < 0) rig.solvedAt = time;
    rig.stumps.forEach((stump, k) => {
      stump.top.emissiveIntensity += (stump.lit * 1.4 - stump.top.emissiveIntensity) * (1 - Math.exp(-dt * 6));
      let x = stump.home.x;
      let y = stump.home.y;
      let z = stump.home.z;
      let arrived = rig.solvedAt < 0;
      if (rig.solvedAt >= 0) {
        const u = THREE.MathUtils.clamp((time - rig.solvedAt - 1.2 - k * FLY_STAGGER) / FLY_SECONDS, 0, 1);
        const e = THREE.MathUtils.smootherstep(u, 0, 1);
        x = THREE.MathUtils.lerp(stump.home.x, stump.stair.x, e);
        z = THREE.MathUtils.lerp(stump.home.z, stump.stair.z, e);
        y = THREE.MathUtils.lerp(stump.home.y, stump.stair.y, e) + Math.sin(e * Math.PI) * 1.2;
        arrived = u >= 1;
        stump.group.rotation.set(Math.sin(e * Math.PI) * 0.6, Math.sin(e * Math.PI) * 1.4, 0);
      }
      // 밟으면 4 cm 꾹 눌렸다가 올라온다
      const press = rig.solvedAt < 0 ? Math.max(0, 1 - (time - stump.pressedAt) / 0.35) : 0;
      y -= 0.04 * Math.sin(press * Math.PI);
      stump.group.position.set(x * M, y * M, z * M);
      // 날아가는 동안은 막지 않는다(몸에 걸리지 않게), 자리에 서면 디딤판
      Object.assign(stump.solid, { x, z, bottom: y - 0.1, top: y + stump.height, enabled: arrived });
    });

    // 안내판 — 장막 안, 걸상 곁에서
    const center = rig.stumps[2].home;
    const distance = Math.hypot(px - center.x, pz - center.z);
    if (sealed && ridgeQuest.postsSolved && !ridgeQuest.stairs && distance < 5) {
      if (!rig.toldNear) {
        rig.toldNear = true;
        showNotice("바람이 잦아드니 걸상 윗면의 새김이 보인다 — 해 · 달 · 물결 · 새 · 불. 평상 널이 타며 드러난 글과 맞춰 보자.", 5);
      }
      setPuzzlePanel("ridge-stumps", {
        title: "통나무 걸상",
        rule: "걸상 다섯 윗면에 그림이 하나씩 새겨져 있다. 불에 탄 평상 널에 드러난 이야기 차례대로 올라서서 [C] 로 꾹 밟는다. 틀리면 처음부터.",
        rows: [{ label: "빛이 든 새김", value: `${rig.progress} / ${ANSWER.length}` }],
        distance,
      });
    } else setPuzzlePanel("ridge-stumps", null);
  });

  return null;
}
