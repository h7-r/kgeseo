/**
 * 진부촌 문 — 두 장승 사이 돌단 · 횃불 · 장승 고리.
 *   궤를 돌단에 올리면(RidgeCart) 문 양옆 횃불에 불이 붙는다. 처음 횃불에는 불꽃 모양이 없다(모형에서 뺀다).
 *   궤 뚜껑이 저절로 열리고 안에 낡은 종이 — 「하늘 장군은 달을 이고 물결을 밟는다. 땅 장군은 해를 이고 새를 딛는다.」
 *   먹이 군데군데 지워졌지만 하늘 · 땅 · 달 · 해 · 물결 · 새는 또렷하다(oldPaper).
 *   장승마다 머리 고리 · 발 고리가 있고(E 한 번에 한 칸, 네 그림: 해 · 달 · 물결 · 새), 장승 몸에는 이름이 새겨져 있다
 *   (천하대장군 = 하늘 아래 장군, 지하여장군 = 땅 아래 장군). 넷을 글대로 맞추면 땅이 울리며 흔들리다가,
 *   고리가 저절로 돌기 시작하고 횃불이 불티를 뿜으며 크게 치솟는다 → 바람이 잦아든다(ridgeQuest.postsSolved).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { addDynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { M, groundY, makeGlowPoints, pointScaleFor } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { setPuzzlePanel } from "../puzzlePanel";
import { PAPER_READING, openPaper } from "./oldPaper";
import { ALTAR, GATE, RIDGE_CENTER } from "./ridgeShape";
import { ridge, ridgeQuest, useRidgeQuest } from "./ridgeState";

/** 고리 그림 — 칸 차례대로 */
const SYMBOLS = ["해", "달", "물결", "새"] as const;
/** 장승 — GATE.posts 차례. 이름과 정답(머리 · 발 고리 그림 번호) */
const POSTS = [
  { name: "천하대장군", answer: [1, 2] },
  { name: "지하여장군", answer: [0, 3] },
] as const;
/** 처음 고리 그림 — 정답이 아니게 */
const START = [
  [0, 3],
  [2, 1],
];
/** 고리 높이(땅 위 m) — 머리 · 발 · 높이(두께) · 이름 새김 가운데 높이 */
const RING_HEIGHTS = [1.78, 0.5];
const RING_TALL = 0.2;
const NAME_HEIGHT = 1.12;
const FLAME_POINTS = 90;
/** 크게 치솟을 때 튀는 불티(횃불마다) */
const SPARKS = 36;
/** 고리를 맞춘 뒤 땅이 흔들리는 시간(초) — 끝나면 바람이 잦아든다 */
const QUAKE_SECONDS = 3;
/** 맞춘 뒤 고리가 저절로 도는 빠르기(rad/s) — 머리 고리와 발 고리는 반대로 */
const SPIN_SPEED = 3.2;
const TURN_SPEED = 7;

/** 고리 둘레 그림 — 여덟 면 중 짝수 면에 그림, 홀수 면에 홈 두 줄. 나무 바탕에 판 홈(어둡게) + 아래 턱(밝게) */
function makeRingTexture() {
  const cell = 128;
  const canvas = document.createElement("canvas");
  canvas.width = cell * 8;
  canvas.height = cell;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#7E5E40";
  c.fillRect(0, 0, canvas.width, canvas.height);
  // 결
  for (let i = 0; i < 60; i++) {
    c.strokeStyle = `rgba(40,26,14,${0.08 + Math.random() * 0.1})`;
    c.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * cell;
    c.beginPath();
    c.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += 32) c.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    c.stroke();
  }
  const carve = (draw: (ctx: CanvasRenderingContext2D) => void, x: number) => {
    for (const [dx, dy, color] of [
      [1.5, 2.5, "rgba(214,184,140,0.6)"],
      [0, 0, "#22160C"],
    ] as const) {
      c.save();
      c.translate(x + dx, dy);
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = 7;
      c.lineCap = "round";
      c.lineJoin = "round";
      draw(c);
      c.restore();
    }
  };
  const mid = cell / 2;
  const symbolDraw: ((ctx: CanvasRenderingContext2D) => void)[] = [
    // 해 — 동그라미와 짧은 빛살 여덟
    (ctx) => {
      ctx.beginPath();
      ctx.arc(mid, mid, 20, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(mid + Math.cos(a) * 30, mid + Math.sin(a) * 30);
        ctx.lineTo(mid + Math.cos(a) * 44, mid + Math.sin(a) * 44);
        ctx.stroke();
      }
    },
    // 달 — 초승달
    (ctx) => {
      ctx.beginPath();
      ctx.arc(mid, mid, 38, Math.PI * 0.3, Math.PI * 1.7);
      ctx.arc(mid + 18, mid, 30, Math.PI * 1.62, Math.PI * 0.38, true);
      ctx.closePath();
      ctx.fill();
    },
    // 물결 — 세 줄
    (ctx) => {
      for (let row = -1; row <= 1; row++) {
        ctx.beginPath();
        for (let x = 14; x <= cell - 14; x += 4) ctx.lineTo(x, mid + row * 22 + Math.sin(x * 0.11) * 7);
        ctx.stroke();
      }
    },
    // 새 — 날개 편 새 한 마리
    (ctx) => {
      ctx.beginPath();
      ctx.moveTo(14, mid - 4);
      ctx.quadraticCurveTo(40, mid - 34, mid, mid + 6);
      ctx.quadraticCurveTo(cell - 40, mid - 34, cell - 14, mid - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mid, mid + 12, 7, 0, Math.PI * 2);
      ctx.fill();
    },
  ];
  for (let face = 0; face < 8; face++) {
    const x = face * cell;
    if (face % 2 === 0) carve(symbolDraw[face / 2], x);
    else
      carve((ctx) => {
        for (const y of [mid - 16, mid + 16]) {
          ctx.beginPath();
          ctx.moveTo(26, y);
          ctx.lineTo(cell - 26, y);
          ctx.stroke();
        }
      }, x);
  }
  // 위아래 테 홈
  c.fillStyle = "#3A2614";
  c.fillRect(0, 0, canvas.width, 6);
  c.fillRect(0, cell - 6, canvas.width, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 장승 몸에 새긴 이름 — 세로 글씨, 바탕은 비우고 판 홈만 */
function makeNameTexture(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128 * name.length;
  const c = canvas.getContext("2d")!;
  // 칸(128)보다 넉넉히 작게 — 획 끝이 판 가장자리에서 잘리지 않게
  c.font = '800 84px "Nanum Myeongjo","AppleMyungjo","Batang",serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  [...name].forEach((ch, i) => {
    const y = 64 + i * 128;
    c.fillStyle = "rgba(200,168,124,0.55)";
    c.fillText(ch, 66, y + 3);
    c.fillStyle = "#170E07";
    c.fillText(ch, 64, y);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 돌단 — 땅에서 살짝 솟은 넓적한 바위. 윗면만 반듯하게 깎였다 */
function buildAltar() {
  const geometry = new THREE.DodecahedronGeometry(1, 1);
  const p = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + Math.sin(v.x * 5.1 + v.z * 3.7) * 0.06;
    v.set(v.x * 0.66 * bump, Math.min(v.y, 0.62) * 0.5, v.z * 0.52 * bump);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // 윗면(깎은 면)이 ALTAR.top 에 오게
  geometry.translate(0, ALTAR.top - 0.31, 0);
  geometry.computeVertexNormals();
  const colors = new Float32Array(p.count * 3);
  const base = new THREE.Color("#7C766C");
  const tone = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    tone.copy(base).offsetHSL(0, 0, (Math.sin(i * 12.9898) * 0.5) * 0.06 + (y > ALTAR.top - 0.01 ? 0.06 : -0.02));
    tone.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(M);
  return mesh;
}

/** 횃불 모형에서 불꽃(밝은 뿔)만 뺀 사본 — 그 횃불 하나에만 쓴다 */
function stripFlame(geometry: THREE.BufferGeometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const color = source.attributes.color as THREE.BufferAttribute | undefined;
  if (!color) return { geometry: source, top: new THREE.Box3().setFromBufferAttribute(source.attributes.position as THREE.BufferAttribute).max.y };
  const keep: number[] = [];
  for (let t = 0; t < source.attributes.position.count; t += 3) {
    // 불꽃 뿔은 붉은 값이 거의 1 — 기둥 · 감은 천은 훨씬 어둡다
    if (color.getX(t) > 0.85 && color.getX(t + 1) > 0.85 && color.getX(t + 2) > 0.85) continue;
    keep.push(t, t + 1, t + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const a = attribute as THREE.BufferAttribute;
    const array = new Float32Array(keep.length * a.itemSize);
    keep.forEach((index, i) => {
      for (let k = 0; k < a.itemSize; k++) array[i * a.itemSize + k] = a.array[index * a.itemSize + k];
    });
    out.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { geometry: out, top: out.boundingBox!.max.y };
}

interface Ring {
  mesh: THREE.Mesh;
  post: number;
  slot: number;
  symbol: number;
  /** 지금 각 · 목표 각(rotation.y) */
  angle: number;
  target: number;
  /** 정면(rotation.y 기준) — 그림 0 이 앞을 볼 때의 각 */
  front: number;
  touch: THREE.Vector3;
}

/** 그림 sym 이 정면을 볼 때의 rotation.y — 면 k 가운데는 원기둥 각 (k + 0.5)·45° */
const angleFor = (front: number, symbol: number) => front - ((2 * symbol + 0.5) * Math.PI) / 4;

function createRig() {
  const altar = buildAltar();
  const ringTexture = makeRingTexture();
  const ringMaterial = new THREE.MeshToonMaterial({ map: ringTexture, gradientMap: TOON_GRADIENT });
  const flames = makeGlowPoints(FLAME_POINTS * GATE.torches.length, { additive: true, softness: 1.6 });
  flames.points.visible = false;
  const lights = GATE.torches.map(() => new THREE.PointLight("#FF9A45", 0, 7 * M, 1.4));
  const seeds = Float32Array.from({ length: FLAME_POINTS * GATE.torches.length * 4 }, () => Math.random());
  const sparks = makeGlowPoints(SPARKS * GATE.torches.length, { additive: true, softness: 1.2 });
  sparks.points.visible = false;
  const sparkSeeds = Float32Array.from({ length: SPARKS * GATE.torches.length * 4 }, () => Math.random());
  return {
    altar,
    ringMaterial,
    flames,
    lights,
    seeds,
    sparks,
    sparkSeeds,
    /** 고리를 다 맞춘 때(초) — 땅이 흔들리고 나서 바람이 잦아든다 */
    ringsSolvedAt: -1,
    lastQuake: 0,
    rings: [] as Ring[],
    names: [] as THREE.Mesh[],
    /** 횃불 불꽃 밑동(유닛) — 모형을 찾으면 적는다 */
    torchTops: GATE.torches.map(() => null as THREE.Vector3 | null),
  /** 불꽃 뿔을 뺀 횃불 사본 */
  torchCopies: GATE.torches.map(() => null as THREE.Mesh | null),
  torchMeshes: [] as THREE.InstancedMesh[],
    litAt: -1,
    solvedAt: -1,
    toldLid: false,
    measuredAt: -99,
    torchesFound: false,
  torchCheckAt: -99,
  };
}

/** 고리 넷이 맞물렸다 — 땅이 울리며 흔들리고(QUAKE_SECONDS) 그 뒤 바람이 잦아든다(프레임에서) */
function solveRings(rig: ReturnType<typeof createRig>) {
  if (rig.ringsSolvedAt >= 0) return;
  rig.ringsSolvedAt = performance.now() / 1000;
  audio.play("징");
  audio.play("우르릉");
  showNotice("고리 넷이 딸깍 맞물린다 — 발밑에서 땅이 우르르 울린다…", 4);
}

export default function GateAltar() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  useRidgeQuest();
  const rig = useMemo(() => createRig(), []);
  const state = useRef({ told: false });

  useEffect(() => {
    rig.altar.position.set(ALTAR.x * M, groundY(ALTAR.x, ALTAR.z) * M, ALTAR.z * M);
    rig.altar.rotation.y = Math.atan2(RIDGE_CENTER.x - ALTAR.x, RIDGE_CENTER.z - ALTAR.z);
    scene.add(rig.altar, rig.flames.points, rig.sparks.points, ...rig.lights);
    // 불꽃 · 불티는 궤를 올려야 처음 보인다 — 셰이더를 미리 굽는다
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, [rig.flames.points, rig.sparks.points]), 3400);
    const solid = {
      x: ALTAR.x,
      z: ALTAR.z,
      yaw: rig.altar.rotation.y,
      halfX: 0.5,
      halfZ: 0.4,
      bottom: groundY(ALTAR.x, ALTAR.z) - 0.4,
      top: groundY(ALTAR.x, ALTAR.z) + ALTAR.top,
      enabled: true,
    };
    const removeSolid = addDynamicSolid(solid);
    return () => {
      window.clearTimeout(warm);
      scene.remove(rig.altar, rig.flames.points, rig.sparks.points, ...rig.lights);
      for (const ring of rig.rings) scene.remove(ring.mesh);
      for (const name of rig.names) scene.remove(name);
      for (const copy of rig.torchCopies) if (copy) scene.remove(copy);
      removeSolid();
    };
  }, [scene, rig, gl, camera]);

  /**
   * 장승을 재서 고리 · 이름을 단다 — 장승은 공개 에셋이라 늦게 선다. 정면(능선 안쪽)과 양옆에서 광선을 쏴
   * 그 높이의 굵기를 잰다. 다 재면 다시 안 본다
   */
  const measurePosts = (time: number) => {
    if (rig.rings.length || time - rig.measuredAt < 1) return;
    // 문 가까이 왔을 때만, 장승 메시에만 쏜다 — 장면 전체에 쏘면 프레임이 끊긴다
    if (Math.hypot(camera.position.x / M - GATE.center.x, camera.position.z / M - GATE.center.z) > 25) return;
    rig.measuredAt = time;
    const ray = new THREE.Raycaster();
    ray.camera = camera;
    const targets: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name.endsWith("장승")) targets.push(o);
    });
    if (!targets.length) return;
    const built: { rings: Ring[]; names: THREE.Mesh[] } = { rings: [], names: [] };
    for (let k = 0; k < GATE.posts.length; k++) {
      const post = GATE.posts[k];
      const ground = groundY(post.x, post.z);
      // 정면 — 두 장승을 잇는 줄에 수직, 능선 안쪽(돌단 · 문 앞에 선 사람 쪽)
      const [a, b] = GATE.posts;
      const frontDir = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
      if (frontDir.x * (RIDGE_CENTER.x - GATE.center.x) + frontDir.z * (RIDGE_CENTER.z - GATE.center.z) < 0) frontDir.negate();
      const side = new THREE.Vector3(-frontDir.z, 0, frontDir.x);
      /** 그 높이에서 dir 쪽 겉면까지 거리(m) — 못 맞히면 null */
      const surface = (height: number, dir: THREE.Vector3) => {
        const origin = new THREE.Vector3(post.x, ground + height, post.z).addScaledVector(dir, 1.2).multiplyScalar(M);
        ray.set(origin, dir.clone().negate());
        ray.far = 1.2 * M;
        const hit = ray.intersectObjects(targets, false).find((h) => h.object.visible);
        return hit ? 1.2 - hit.distance / M : null;
      };
      const radii = RING_HEIGHTS.map((h) => [frontDir, frontDir.clone().negate(), side, side.clone().negate()].map((d) => surface(h, d)));
      // 이름 판이 걸친 높이 전체에서 가장 튀어나온 겉면 — 울퉁불퉁한 장승 몸에 글자 일부가 묻혀 잘리지 않게
      const half = (0.17 * POSTS[k].name.length) / 2;
      const depths = Array.from({ length: 9 }, (_, i) => surface(NAME_HEIGHT - half + (i / 8) * half * 2, frontDir));
      const known = depths.filter((d): d is number => d !== null);
      if (radii.some((list) => list.some((r) => r === null)) || !known.length) return;
      const nameDepth = Math.max(...known);
      const front = Math.atan2(frontDir.x, frontDir.z);
      RING_HEIGHTS.forEach((height, slot) => {
        const list = radii[slot] as number[];
        // 정면 · 뒤 · 양옆 가운데를 다시 잡고, 가장 먼 겉면에 손가락 하나 여유
        const cx = post.x + (frontDir.x * (list[0] - list[1]) + side.x * (list[2] - list[3])) / 2;
        const cz = post.z + (frontDir.z * (list[0] - list[1]) + side.z * (list[2] - list[3])) / 2;
        const radius = Math.max((list[0] + list[1]) / 2, (list[2] + list[3]) / 2) / Math.cos(Math.PI / 8) + 0.035;
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * M, radius * M, RING_TALL * M, 8), rig.ringMaterial);
        mesh.position.set(cx * M, (ground + height) * M, cz * M);
        mesh.castShadow = true;
        const symbol = START[k][slot];
        const angle = angleFor(front, symbol);
        mesh.rotation.y = angle;
        scene.add(mesh);
        built.rings.push({
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
        new THREE.MeshToonMaterial({ map: makeNameTexture(POSTS[k].name), transparent: true, alphaTest: 0.3, gradientMap: TOON_GRADIENT }),
      );
      name.position.set(post.x + frontDir.x * (nameDepth + 0.02), ground + NAME_HEIGHT, post.z + frontDir.z * (nameDepth + 0.02)).multiplyScalar(M);
      name.rotation.y = front;
      scene.add(name);
      built.names.push(name);
    }
    rig.rings = built.rings;
    rig.names = built.names;
    // 방금 만든 고리 · 이름판 — 첫 프레임에 굽느라 멈추지 않게
    prewarmShaders(gl, scene, camera, [...built.rings.map((r) => r.mesh), ...built.names]);
  };

  /**
   * 문 양옆 횃불 — 화면의 횃불(인스턴스 무리)에서 그 자리만 숨기고, 불꽃 뿔을 뺀 사본을 그 자리에 세운다.
   * 구역 초점이 무리를 다시 채우면(ids 가 바뀌면) 다시 숨긴다. 처음엔 불이 없다
   */
  const hideTorches = (time: number) => {
    // 0.3 초에 한 번 찾고, 찾은 무리는 매 장면 숨긴다(구역 초점이 도로 보이게 해도 깜박이지 않게)
    if (!rig.torchesFound && time - rig.torchCheckAt > 0.3) {
      rig.torchCheckAt = time;
      const matrix = new THREE.Matrix4();
      const at = new THREE.Vector3();
      scene.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || !o.name.replace(/^AI허브:/, "").startsWith("소품.횃불")) return;
        mesh.updateMatrixWorld(true);
        // 이 무리의 인스턴스가 전부 문 횃불이면 통째로 숨긴다(다른 횃불이 섞여 있으면 그 자리만 0 으로)
        const full = mesh.userData.fullSet as { matrices: Float32Array; n: number } | undefined;
        const count = full ? full.n : mesh.count;
        let mine = 0;
        for (let i = 0; i < count; i++) {
          if (full) matrix.fromArray(full.matrices, i * 16);
          else mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld);
          at.setFromMatrixPosition(matrix).divideScalar(M);
          const k = GATE.torches.findIndex((t) => Math.hypot(t.x - at.x, t.z - at.z) < 0.6);
          if (k < 0) continue;
          mine++;
          if (!rig.torchCopies[k] && !o.name.endsWith("·원경")) {
            const { geometry, top } = stripFlame(mesh.geometry);
            const copy = new THREE.Mesh(geometry, mesh.material);
            matrix.decompose(copy.position, copy.quaternion, copy.scale);
            copy.castShadow = true;
            scene.add(copy);
            copy.updateMatrixWorld(true);
            rig.torchCopies[k] = copy;
            rig.torchTops[k] = new THREE.Vector3(0, top, 0).applyMatrix4(copy.matrixWorld);
          }
        }
        if (mine > 0 && mine === count) rig.torchMeshes.push(mesh);
      });
      rig.torchesFound = rig.torchTops.every(Boolean);
    }
    for (const mesh of rig.torchMeshes) mesh.visible = false;
  };

  // 고리 돌리기 — E 한 번에 한 칸(90°)
  useEffect(() => {
    const removers: (() => void)[] = [];
    const timer = setInterval(() => {
      if (!rig.rings.length || removers.length) return;
      rig.rings.forEach((ring, i) =>
        removers.push(
          registerInteractable({
            id: `ridge-post-ring-${i}`,
            position: ring.touch,
            label: `${POSTS[ring.post].name} ${ring.slot === 0 ? "머리" : "발"} 고리 돌리기`,
            highlight: () => ring.mesh,
            radius: 0.3 * M,
            reach: 2.6 * M,
            enabled: () => ridge.stage() === "sealed" && rig.ringsSolvedAt < 0,
            use: () => {
              if (!ridgeQuest.chestOnAltar) {
                showNotice("고리가 꿈쩍도 않는다 — 두 장승 사이 돌단이 비어 있다. 무언가 올려야 하는 듯하다.", 3.5);
                return;
              }
              ring.symbol = (ring.symbol + 1) % SYMBOLS.length;
              ring.target -= Math.PI / 2;
              audio.play("똑");
              const solved = rig.rings.every((r) => r.symbol === POSTS[r.post].answer[r.slot]);
              if (solved) solveRings(rig);
            },
          }),
        ),
      );
    }, 500);
    const removeLid = registerInteractable({
      id: "ridge-chest-lid",
      position: new THREE.Vector3(ALTAR.x * M, (groundY(ALTAR.x, ALTAR.z) + ALTAR.top + 0.45) * M, ALTAR.z * M),
      label: "궤 속 낡은 종이 읽기",
      radius: 0.35 * M,
      reach: 2.4 * M,
      enabled: () => ridgeQuest.chestOnAltar,
      use: () => openPaper(),
    });
    return () => {
      clearInterval(timer);
      removers.forEach((remove) => remove());
      removeLid();
    };
  }, [rig]);

  useEffect(() => {
    exposeDevHook("najuGateDev", {
      solvePosts: () => {
        for (const ring of rig.rings) {
          ring.symbol = POSTS[ring.post].answer[ring.slot];
          ring.target = angleFor(ring.front, ring.symbol);
        }
        solveRings(rig);
      },
      rings: () => rig.rings.map((r) => SYMBOLS[r.symbol]),
    });
  }, [rig]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    hideTorches(time);
    measurePosts(time);

    // 맞춘 뒤 — 땅이 점점 세게 흔들리다 멎으면 바람이 잦아든다
    const nowSec = performance.now() / 1000;
    if (rig.ringsSolvedAt >= 0 && !ridgeQuest.postsSolved) {
      const quake = (nowSec - rig.ringsSolvedAt) / QUAKE_SECONDS;
      if (time - rig.lastQuake > 0.45) {
        rig.lastQuake = time;
        director.cue({ 카메라: "흔들림", 세기: 0.12 + 0.3 * Math.min(1, quake) });
      }
      if (quake >= 1) {
        ridgeQuest.set("postsSolved");
        audio.play("전환");
        showNotice("고리가 저절로 돌기 시작하자 문 양옆 횃불에 불이 붙어 미친 듯 타오른다 — 불던 바람이 잠잠해진다.", 5.5);
      }
    }
    for (const ring of rig.rings) {
      if (ridgeQuest.postsSolved) {
        // 저절로 돈다 — 머리 고리와 발 고리가 서로 반대로
        ring.target += (ring.slot === 0 ? 1 : -1) * SPIN_SPEED * dt;
        ring.angle = ring.target;
      } else ring.angle += (ring.target - ring.angle) * (1 - Math.exp(-dt * TURN_SPEED));
      ring.mesh.rotation.y = ring.angle;
    }

    // 불 — 궤를 올리면 붙고, 고리를 맞추면 크게
    if (ridgeQuest.chestOnAltar && !rig.toldLid) {
      rig.toldLid = true;
      audio.play("단서");
      showNotice("궤를 돌단에 올리자 뚜껑이 삐걱 열린다. 안에 낡은 종이가 있다 — [E] 로 꺼내 읽자.", 5);
    }
    // 불은 고리를 맞춘 뒤에야 — 횃불이 나타나며 바로 크게 타오른다
    if (ridgeQuest.postsSolved && rig.solvedAt < 0) {
      rig.solvedAt = time;
      rig.litAt = time;
    }
    const lit = rig.litAt < 0 ? 0 : THREE.MathUtils.smoothstep(time - rig.litAt, 0, 0.5);
    const big = rig.solvedAt < 0 ? 0 : THREE.MathUtils.smoothstep(time - rig.solvedAt, 0, 1.5);
    // 치솟는 순간 한 번 확 솟았다가 크게 타오르는 채로
    const flare = rig.solvedAt < 0 ? 0 : Math.exp(-(time - rig.solvedAt) * 1.2) * Math.min(1, (time - rig.solvedAt) * 4);
    const fire = lit * (1 + 1.6 * big + 1.2 * flare);
    rig.flames.points.visible = lit > 0 && rig.torchesFound;
    if (rig.flames.points.visible) {
      const { flames, seeds } = rig;
      rig.torchTops.forEach((top, t) => {
        if (!top) return;
        for (let k = 0; k < FLAME_POINTS; k++) {
          const i = t * FLAME_POINTS + k;
          const s = i * 4;
          const life = 0.5 + seeds[s] * 0.45;
          const u = (time / life + seeds[s + 1]) % 1;
          const angle = seeds[s + 2] * Math.PI * 2;
          const radius = (0.02 + seeds[s + 3] * 0.07) * (1 - u * 0.7) * (0.8 + 0.9 * big);
          const sway = Math.sin(time * 6 + k) * 0.03 * u;
          flames.position.setXYZ(
            i,
            top.x + (Math.cos(angle) * radius + sway) * M,
            top.y + (0.02 + u * (0.3 + seeds[s] * 0.22) * fire) * M,
            top.z + Math.sin(angle) * radius * M,
          );
          flames.size.setX(i, (0.17 - u * 0.12) * M * fire);
          // 작을 때는 절반만 쓴다 — 크게 타오르면 나머지도 보탠다
          flames.alpha.setX(i, (1 - u) * 0.85 * lit * (k < FLAME_POINTS / 2 ? 1 : big));
          const hot = 1 - u;
          flames.color.setXYZ(i, 1.8, 0.55 + hot * 0.9, 0.12 + hot * hot * 0.6);
        }
      });
      flames.commit();
      flames.material.uniforms.uPointScale.value = pointScaleFor(gl, frame.camera);
    }
    // 불티 — 크게 타오른 뒤 위로 튀어 바람에 흩날린다
    rig.sparks.points.visible = big > 0 && rig.torchesFound;
    if (rig.sparks.points.visible) {
      const { sparks, sparkSeeds } = rig;
      rig.torchTops.forEach((top, t) => {
        if (!top) return;
        for (let k = 0; k < SPARKS; k++) {
          const i = t * SPARKS + k;
          const s = i * 4;
          const life = 1.2 + sparkSeeds[s] * 1.2;
          const u = (time / life + sparkSeeds[s + 1]) % 1;
          const angle = sparkSeeds[s + 2] * Math.PI * 2 + u * 3;
          const spread = u * (0.25 + sparkSeeds[s + 3] * 0.5);
          sparks.position.setXYZ(
            i,
            top.x + Math.cos(angle) * spread * M,
            top.y + (0.3 + u * (1.4 + sparkSeeds[s] * 1.2)) * M,
            top.z + Math.sin(angle) * spread * M,
          );
          sparks.size.setX(i, (0.035 * (1 - u) + 0.01) * M);
          sparks.alpha.setX(i, (1 - u) * big * (0.5 + 0.5 * Math.sin(time * 20 + k)));
          sparks.color.setXYZ(i, 1.9, 0.9 - u * 0.4, 0.3);
        }
      });
      sparks.commit();
      sparks.material.uniforms.uPointScale.value = pointScaleFor(gl, frame.camera);
    }
    rig.lights.forEach((light, t) => {
      const top = rig.torchTops[t];
      if (!top) return;
      light.position.set(top.x, top.y + 0.25 * M, top.z);
      light.intensity = lit * (1.6 + 3.2 * big + 3 * flare) * (1 + Math.sin(time * 13 + t) * 0.1 + Math.sin(time * 7.7 + t * 2) * 0.08);
    });

    // 안내판 — 불이 붙은 뒤 문 가까이에서
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    const distance = Math.hypot(px - GATE.center.x, pz - GATE.center.z);
    if (ridge.stage() === "sealed" && ridgeQuest.chestOnAltar && rig.ringsSolvedAt < 0 && distance < 6 && rig.rings.length) {
      if (!state.current.told) {
        state.current.told = true;
        showNotice("두 장승에 머리 고리 · 발 고리가 끼워져 있다. 장승 몸에는 이름이 새겨져 있다 — 궤 속 종이와 맞춰 보자.", 4.5);
      }
      setPuzzlePanel("ridge-posts", {
        title: "장승 고리",
        rule: `궤 속 종이 — 「${PAPER_READING}」 장승마다 머리 고리 · 발 고리를 [E] 로 돌려 그 그림을 앞으로 맞춘다.`,
        rows: rig.rings.map((r) => ({ label: `${POSTS[r.post].name} · ${r.slot === 0 ? "머리" : "발"}`, value: SYMBOLS[r.symbol] })),
        distance,
      });
    } else setPuzzlePanel("ridge-posts", null);
  });

  return null;
}
