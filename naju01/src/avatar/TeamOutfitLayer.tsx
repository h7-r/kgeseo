// 팀 캐릭터 전용 덧입힘(검토 22회차) — 캡 · 해병대 반팔의 가슴 글자를 뼈에 붙이고, 바지 파츠를 몸 골격에 묶는다(teamOutfit.ts 가 번호를 푼다).
// 몸 GLB 를 새로 굽지 않고, 그 아바타의 실제 정점을 재서 맞춘다:
//   · 캡: 머리 뼈 국소 공간에서 머리(머리 뼈 웨이트가 큰 몸 정점) + 보이는 머리카락 정점을 모아, 위쪽 42% 를 다 감싸는
//     타원 돔을 만든다 — 머리카락이 돔 밖으로 튀어나오지 않게 높이를 정점마다 확인해 정한다. 앞으로 챙.
//   · 해병대 반팔: 가슴 뼈(spine_03) 국소 공간에서 상의(_tint 2) 정점을 재, 가슴에는 노란 「해병대」, 등에는 닻 · 별 마크를
//     그 자리 상의 표면을 따라가는 판(실측 높이장)에 붙인다.
// 축은 바인드 자세에서 뼈가 본 몸의 위(+Y) · 앞(+Z)이다(glTF) — 재는 순간의 자세(걷기 · 인사)와 상관없이 같은 모양이 된다.
// 몸 · 머리카락은 뼈에 단단히 묶인 정점만 쓰므로 재는 자세는 상관없다. 설정(체형 모프 · 머리)이 바뀌면 다시 잰다.
import { useGLTF } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import { attachParts } from "./chibiBodyParts";
import type { MeshAppearanceConfig } from "./meshAppearance";
import type { Disposables, LoadedGltf, PartError, PreparedBody } from "./preparedBody";
import { getTeamPantsUrl, type TeamOutfit, type TeamPantsStyle } from "./teamOutfit";
import { DEFAULT_TOON, makeToonGradientTexture, TOON_UNIFORMS_KEY } from "./toonMaterial";
import { applyOutline, DEFAULT_OUTLINE, type OutlineConfig, type OutlineHandle } from "./toonOutline";

/** 아바타 외곽선과 같은 색(toonOutline DEFAULT_OUTLINE) */
const INK = "#2b2a33";
const CAP_COLOR = "#23252c";
const CAP_BUTTON_COLOR = "#2f323a";
const MARINE_YELLOW = "#ffd23f";
/** 등 마크 원판 — 셔츠 빨강(MARINE_RED)보다 짙게 */
const MARINE_BADGE_RED = "#7a121b";
/** 캡이 덮는 머리 높이 비율(정수리부터) 🟡 */
const CAP_COVER = 0.42;

interface BoneFrame {
  bone: THREE.Bone;
  /** 뼈 국소 공간에서 오른쪽(+X) · 위 · 앞 축을 열로 가진 행렬 */
  basis: THREE.Matrix4;
}

interface CapFit {
  frame: BoneFrame;
  center: THREE.Vector3;
  radius: THREE.Vector3;
}

/**
 * 상의 표면을 따라가는 인쇄 판 — 몸 메시 국소(바인드 자세, 지금 체형 모프를 얹은) 좌표의 격자 정점, 위 줄부터 왼쪽 → 오른쪽.
 * 정점마다 그 아래 셔츠 삼각형의 뼈 웨이트(무게중심 보간)를 받아 몸과 같이 스키닝된다 — 가슴 뼈 하나에 단단히 붙이면
 * 걷기 · 몸통 비틀기에서 등 아래쪽 셔츠가 판을 뚫었다(Codex 24회차)
 */
interface PrintPatch {
  positions: Float32Array;
  /** 정점마다 뼈 번호 4개 · 웨이트 4개 */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  cols: number;
  rows: number;
  /** 등(뒤를 보는 판) — 면 방향 · 글자 좌우를 뒤집는다 */
  back: boolean;
}

interface PrintFit {
  body: THREE.SkinnedMesh;
  chest: PrintPatch;
  back: PrintPatch | null;
}

/**
 * 캐릭터 재질 표식 — 세계 재질을 손보는 쪽(로비 만화풍 MangaMaterials · 나주 WorldToon)은 이 표식이 있는 재질을 건너뛴다.
 * 없으면 바지 · 캡 셰이더를 덮어써 결 무늬가 사라졌다(Codex 리뷰 a2a0fbd). 안의 값은 아무도 읽지 않는다(있는지만 본다)
 */
function markAvatarMaterial<T extends THREE.Material>(material: T): T {
  material.userData[TOON_UNIFORMS_KEY] = {};
  return material;
}

const gradient = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

function findBodyMesh(model: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!found && mesh.isSkinnedMesh && object.userData?.slot === "body") found = mesh;
  });
  return found;
}

/** 바인드 자세에서 그 뼈가 본 몸의 오른쪽 · 위 · 앞 축 */
function restFrame(mesh: THREE.SkinnedMesh, bone: THREE.Bone): BoneFrame | null {
  const index = mesh.skeleton.bones.indexOf(bone);
  const inverse = mesh.skeleton.boneInverses[index];
  if (index < 0 || !inverse) return null;
  const toBone = new THREE.Matrix4().multiplyMatrices(inverse, mesh.bindMatrix);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(toBone);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(toBone);
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  forward.crossVectors(right, up).normalize();
  return { bone, basis: new THREE.Matrix4().makeBasis(right, up, forward) };
}

/**
 * 메시 정점을 그 뼈의 축 좌표(오른쪽 · 위 · 앞)로. pick 이 거짓인 정점은 뺀다. 지금 자세 · 모프가 들어간 자리를 재고
 * 뼈 국소로 옮기므로 뼈에 단단히 묶인 정점은 자세와 상관없다.
 */
function measure(mesh: THREE.Mesh, frame: BoneFrame, pick: (index: number) => boolean, into: THREE.Vector3[]) {
  const toFrame = new THREE.Matrix4()
    .copy(frame.basis)
    .invert()
    .multiply(new THREE.Matrix4().copy(frame.bone.matrixWorld).invert())
    .multiply(mesh.matrixWorld);
  const count = mesh.geometry.getAttribute("position").count;
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    if (!pick(i)) continue;
    mesh.getVertexPosition(i, point);
    into.push(point.clone().applyMatrix4(toFrame));
  }
}

/** 그 정점에서 이 뼈들이 차지하는 웨이트 합 */
function weightOn(mesh: THREE.SkinnedMesh, boneIndices: readonly number[]) {
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  return (i: number) => {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) if (boneIndices.includes(index.getComponent(i, k))) sum += weight.getComponent(i, k);
    return sum;
  };
}

function fitCap(prepared: PreparedBody): CapFit | null {
  const body = findBodyMesh(prepared.model);
  const head = prepared.headBone;
  if (!body || !head) return null;
  const frame = restFrame(body, head);
  if (!frame) return null;
  const onHead = weightOn(body, [body.skeleton.bones.indexOf(head)]);
  const headPoints: THREE.Vector3[] = [];
  measure(body, frame, (i) => onHead(i) >= 0.5, headPoints);
  if (headPoints.length < 20) return null;
  const points = [...headPoints];
  for (const part of prepared.parts) {
    if (part.slot !== "hair" || !part.object.visible) continue;
    part.object.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) measure(mesh, frame, () => true, points);
    });
  }
  const top = Math.max(...points.map((p) => p.y));
  const chin = Math.min(...headPoints.map((p) => p.y));
  const rim = top - CAP_COVER * (top - chin);
  const above = points.filter((p) => p.y >= rim);
  const span = (axis: "x" | "z") => {
    const values = above.map((p) => p[axis]);
    return [Math.min(...values), Math.max(...values)] as const;
  };
  const [minX, maxX] = span("x");
  const [minZ, maxZ] = span("z");
  const center = new THREE.Vector3((minX + maxX) / 2, rim, (minZ + maxZ) / 2);
  const radius = new THREE.Vector3(((maxX - minX) / 2) * 1.06 + 0.004, 0, ((maxZ - minZ) / 2) * 1.06 + 0.004);
  // 높이 — 모든 정점이 타원 돔 안에 들도록(가장자리 정점은 테두리가 덮으니 뺀다)
  let height = radius.x * 0.6;
  for (const p of above) {
    const inside = 1 - ((p.x - center.x) / radius.x) ** 2 - ((p.z - center.z) / radius.z) ** 2;
    if (inside > 0.03) height = Math.max(height, (p.y - rim) / Math.sqrt(inside));
  }
  radius.y = height * 1.03 + 0.003;
  return { frame, center, radius };
}

/** 판이 상의 표면에서 떨어지는 거리(m) */
const PRINT_LIFT = 0.004;
/** 가슴 글자 폭(가슴 뼈에 묶인 몸통 폭 대비) — 미르 11/8 「글자좀 키워줄 수 있나」(0.36 → 0.78, 약 2.2배) */
const CHEST_PRINT_WIDTH = 0.78;
/** 등 마크 폭(몸통 폭 대비) · 높이(상의 몸통 아래에서 비율) */
const BACK_PRINT_WIDTH = 0.62;
const BACK_PRINT_HEIGHT = 0.56;

/** 몸 메시 국소 바인드 자리 + 지금 체형 모프(스키닝 전) — 자세와 상관없다. 정점 전부를 한 번에 */
function bindPositions(mesh: THREE.SkinnedMesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    out[i * 3] = position.getX(i);
    out[i * 3 + 1] = position.getY(i);
    out[i * 3 + 2] = position.getZ(i);
  }
  const morphs = geometry.morphAttributes.position ?? [];
  const influences = mesh.morphTargetInfluences ?? [];
  morphs.forEach((attribute, k) => {
    const influence = influences[k] ?? 0;
    if (!influence) return;
    for (let i = 0; i < position.count; i += 1) {
      const base = geometry.morphTargetsRelative ? [0, 0, 0] : [position.getX(i), position.getY(i), position.getZ(i)];
      out[i * 3] += influence * (attribute.getX(i) - base[0]!);
      out[i * 3 + 1] += influence * (attribute.getY(i) - base[1]!);
      out[i * 3 + 2] += influence * (attribute.getZ(i) - base[2]!);
    }
  });
  return out;
}

interface SurfaceHit {
  z: number;
  /** 뼈 번호 → 웨이트(삼각형 세 꼭짓점을 무게중심 좌표로 섞은 것) */
  bones: Map<number, number>;
}

/**
 * 몸 표면을 앞(side 1, +Z) 또는 뒤(−1)에서 Z 축으로 쏴 처음 닿는 삼각형 — 정점이 성긴 곳(큰 삼각형)에서는 칸 안에 정점이
 * 없어 판 깊이가 몸 안쪽으로 잡혔다. 그쪽을 보는 면만 본다(안쪽 면 · 반대쪽 면 제외), 팔 · 머리 웨이트가 큰 정점이 낀 면도 뺀다
 */
function surfaceSampler(
  body: THREE.SkinnedMesh,
  positions: Float32Array,
  side: 1 | -1,
  region: { minX: number; maxX: number; minY: number; maxY: number },
  skip: (index: number) => boolean,
) {
  const geometry = body.geometry;
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : positions.length / 9;
  const vertex = (t: number, c: number) => (index ? index.getX(t * 3 + c) : t * 3 + c);
  const picked: number[] = [];
  for (let t = 0; t < triangles; t += 1) {
    const a = vertex(t, 0);
    const b = vertex(t, 1);
    const c = vertex(t, 2);
    if (skip(a) || skip(b) || skip(c)) continue;
    const [ax, ay, bx, by, cx, cy] = [a, b, c].flatMap((v) => [positions[v * 3]!, positions[v * 3 + 1]!]);
    if (Math.max(ax!, bx!, cx!) < region.minX || Math.min(ax!, bx!, cx!) > region.maxX) continue;
    if (Math.max(ay!, by!, cy!) < region.minY || Math.min(ay!, by!, cy!) > region.maxY) continue;
    // XY 로 본 감기 방향 = 면이 +Z(앞) · −Z(뒤) 중 어디를 보는지
    const area = (bx! - ax!) * (cy! - ay!) - (by! - ay!) * (cx! - ax!);
    if (area * side <= 1e-12) continue;
    picked.push(a, b, c);
  }
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  return (x: number, y: number): SurfaceHit | null => {
    let best: { z: number; t: number; w: [number, number, number] } | null = null;
    for (let t = 0; t < picked.length; t += 3) {
      const [a, b, c] = [picked[t]!, picked[t + 1]!, picked[t + 2]!];
      const ax = positions[a * 3]!;
      const ay = positions[a * 3 + 1]!;
      const bx = positions[b * 3]!;
      const by = positions[b * 3 + 1]!;
      const cx = positions[c * 3]!;
      const cy = positions[c * 3 + 1]!;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-14) continue;
      const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const z = wa * positions[a * 3 + 2]! + wb * positions[b * 3 + 2]! + wc * positions[c * 3 + 2]!;
      if (!best || z * side > best.z * side) best = { z, t, w: [wa, wb, wc] };
    }
    if (!best) return null;
    const bones = new Map<number, number>();
    [picked[best.t]!, picked[best.t + 1]!, picked[best.t + 2]!].forEach((v, n) => {
      for (let k = 0; k < 4; k += 1) {
        const w = skinWeight.getComponent(v, k) * best.w[n]!;
        if (w > 0) bones.set(skinIndex.getComponent(v, k), (bones.get(skinIndex.getComponent(v, k)) ?? 0) + w);
      }
    });
    return { z: best.z, bones };
  };
}

/**
 * 상의 표면을 따라가는 판. 격자 정점마다 몸 표면 깊이(surfaceSampler)에 PRINT_LIFT 를 더하고, 이웃 평균으로 고르되 표면
 * 안으로는 안 들어가게 한다. 2차식으로 휘던 예전 판은 넓히면 여자 가슴처럼 가운데가 들어간 곳에서 판 일부가 몸에 묻혔다.
 * 맞는 면이 없는 칸은 같은 줄 가장 가까운 칸으로, 줄 전체가 비면 판을 만들지 않는다
 */
function conformPatch(
  sample: (x: number, y: number) => SurfaceHit | null,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  side: 1 | -1,
  cols: number,
  rows: number,
): PrintPatch | null {
  const count = (cols + 1) * (rows + 1);
  const hits: (SurfaceHit | null)[] = [];
  const xy: [number, number][] = [];
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const x = centerX - width / 2 + (width * i) / cols;
      const y = centerY + height / 2 - (height * j) / rows;
      xy.push([x, y]);
      hits.push(sample(x, y));
    }
  }
  for (let j = 0; j <= rows; j += 1) {
    const row = Array.from({ length: cols + 1 }, (_, i) => j * (cols + 1) + i);
    const filled = row.filter((k) => hits[k]);
    if (!filled.length) return null;
    for (const k of row) {
      if (hits[k]) continue;
      hits[k] = hits[filled.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a))]!;
    }
  }
  const surface = Float32Array.from(hits, (hit) => hit!.z + side * PRINT_LIFT);
  let current = Float32Array.from(surface);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = Float32Array.from(current);
    for (let j = 0; j <= rows; j += 1) {
      for (let i = 0; i <= cols; i += 1) {
        const k = j * (cols + 1) + i;
        const around = [
          [i - 1, j],
          [i + 1, j],
          [i, j - 1],
          [i, j + 1],
        ].filter(([a, b]) => a! >= 0 && a! <= cols && b! >= 0 && b! <= rows);
        const mean = around.reduce((sum, [a, b]) => sum + current[b! * (cols + 1) + a!]!, 0) / around.length;
        const smoothed = (current[k]! + mean) / 2;
        // 고른 판이 표면 안으로 들어가지 않게
        next[k] = side > 0 ? Math.max(smoothed, surface[k]!) : Math.min(smoothed, surface[k]!);
      }
    }
    current = next;
  }
  const positions = new Float32Array(count * 3);
  xy.forEach(([x, y], k) => positions.set([x, y, current[k]!], k * 3));
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  hits.forEach((hit, k) => {
    const top = [...hit!.bones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((sum, [, w]) => sum + w, 0) || 1;
    top.forEach(([bone, w], c) => {
      skinIndex[k * 4 + c] = bone;
      skinWeight[k * 4 + c] = w / total;
    });
  });
  return { positions, skinIndex, skinWeight, cols, rows, back: side < 0 };
}

/**
 * 몸 메시 국소(glTF: 오른쪽 +X · 위 +Y · 앞 +Z) 바인드 자리에서 잰다. 몸통 크기는 가슴 뼈(spine_02 · 03)에 묶인 상의(_tint 2)
 * 정점으로, 판 깊이 · 웨이트는 팔 · 머리를 뺀 몸 표면 삼각형에서 — 상의 표식만 보면 다른 표식이 잘못 찍힌 셔츠가 판을 뚫었다
 */
function fitPrint(prepared: PreparedBody): PrintFit | null {
  const body = findBodyMesh(prepared.model);
  const tint = body?.geometry.getAttribute("_tint");
  if (!body || !tint) return null;
  const bones = ["spine_03", "spine_02"].map((name) => body.skeleton.bones.findIndex((bone) => bone.name === name));
  const onChest = weightOn(body, bones);
  const armBones = body.skeleton.bones.flatMap((bone, index) =>
    /^(upperarm|lowerarm|hand|neck|head)/.test(bone.name) ? [index] : [],
  );
  const onArmOrHead = weightOn(body, armBones);
  const positions = bindPositions(body);
  let [minX, maxX, minY, maxY, count] = [Infinity, -Infinity, Infinity, -Infinity, 0];
  for (let i = 0; i < tint.count; i += 1) {
    // 상의 표식(2) — 반올림해 본다(경계 삼각형은 중간값)
    if (Math.round(tint.getX(i)) !== 2 || onChest(i) < 0.6 || onArmOrHead(i) >= 0.5) continue;
    const [x, y] = [positions[i * 3]!, positions[i * 3 + 1]!];
    [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
    count += 1;
  }
  if (count < 50) return null;
  const centerX = (minX + maxX) / 2;
  const torso = maxX - minX;
  const skip = (i: number) => onArmOrHead(i) >= 0.5;
  const patch = (centerY: number, width: number, height: number, side: 1 | -1, cols: number, rows: number) => {
    const region = { minX: centerX - width, maxX: centerX + width, minY: centerY - height, maxY: centerY + height };
    const sample = surfaceSampler(body, positions, side, region, skip);
    return conformPatch(sample, centerX, centerY, width, height, side, cols, rows);
  };
  // 가슴 글자 — 캔버스 비율(512 × 200)대로
  const chestWidth = CHEST_PRINT_WIDTH * torso;
  const chest = patch(minY + 0.62 * (maxY - minY), chestWidth, chestWidth * 0.39, 1, 24, 8);
  if (!chest) return null;
  const backWidth = BACK_PRINT_WIDTH * torso;
  const back = patch(minY + BACK_PRINT_HEIGHT * (maxY - minY), backWidth, backWidth, -1, 16, 16);
  return { body, chest, back };
}

function makeMarineTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 200;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const draw = () => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = MARINE_YELLOW;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '900 150px "Paperlogy", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
    g.fillText("해병대", canvas.width / 2, canvas.height / 2 + 6, canvas.width - 24);
    texture.needsUpdate = true;
  };
  draw();
  // 글꼴이 늦게 오면 다시 그린다
  void document.fonts?.ready.then(draw);
  return texture;
}

/**
 * 등 마크 — 짙은 빨강 원판에 닻 · 별 · 물결(바다 · 군의 일반 모티프), 양옆이 끊긴 노란 테. 실제 해병대 휘장을 베끼지 않은
 * 도안이다(미르 11/8 「해병대 로고랑 비슷한 모양」). 공식 휘장과 덜 헷갈리게 테를 끊고 물결을 넣었다(Codex 24회차)
 */
function makeMarineBackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (g) {
    const c = 256;
    g.fillStyle = MARINE_BADGE_RED;
    g.beginPath();
    g.arc(c, c, 236, 0, Math.PI * 2);
    g.fill();
    // 테 — 위아래 두 호(양옆이 끊긴다)
    g.strokeStyle = MARINE_YELLOW;
    g.lineWidth = 22;
    g.lineCap = "round";
    for (const start of [Math.PI * 1.12, Math.PI * 0.12]) {
      g.beginPath();
      g.arc(c, c, 228, start, start + Math.PI * 0.76);
      g.stroke();
    }
    // 별
    g.fillStyle = MARINE_YELLOW;
    g.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 ? 22 : 54;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(c + r * Math.cos(a), 128 + r * Math.sin(a));
    }
    g.closePath();
    g.fill();
    // 닻 — 고리 · 가로대 · 몸대 · 아래 팔(호) · 양 끝 갈고리
    g.lineCap = "round";
    g.lineWidth = 16;
    g.beginPath();
    g.arc(c, 214, 22, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 26;
    g.beginPath();
    g.moveTo(c, 238);
    g.lineTo(c, 404);
    g.stroke();
    g.lineWidth = 22;
    g.beginPath();
    g.moveTo(c - 70, 268);
    g.lineTo(c + 70, 268);
    g.stroke();
    g.lineWidth = 24;
    g.beginPath();
    g.arc(c, 312, 102, Math.PI * 0.18, Math.PI * 0.82);
    g.stroke();
    for (const s of [-1, 1]) {
      const a = s > 0 ? Math.PI * 0.18 : Math.PI * 0.82;
      const tipX = c + 102 * Math.cos(a);
      const tipY = 312 + 102 * Math.sin(a);
      g.beginPath();
      g.moveTo(tipX + s * 30, tipY - 44);
      g.lineTo(tipX + s * 18, tipY + 14);
      g.lineTo(tipX - s * 30, tipY + 4);
      g.closePath();
      g.fill();
    }
    // 닻 아래 물결
    g.lineWidth = 12;
    g.beginPath();
    for (let x = -120; x <= 120; x += 4) g.lineTo(c + x, 452 + 10 * Math.sin((x / 120) * Math.PI * 3));
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 챙 두께(m) */
const BRIM_THICKNESS = 0.009;
/**
 * 챙 크기 — 돔 테두리 대비 옆 폭 · 앞으로 나온 정도. 옆 폭을 돔보다 좁게 둬 챙 양 끝이 돔 옆벽 안으로 들어간다 — 일반 캡처럼
 * 앞쪽(약 140°)에만 챙이 보인다(돔보다 넓으면 옆을 따라 귀 쪽까지 띠가 생기고 끝에 턱이 졌다)
 */
const BRIM_WIDEN = 0.86;
const BRIM_REACH = 1.7;
/** 테두리에서 바깥 끝까지 숙이는 기울기(높이/길이) */
const BRIM_DROOP = 0.16;
/** 양옆 끝이 아래로 휘는 정도(돔 반폭 대비) — 일반 캡의 둥근 챙 */
const BRIM_CURL = 0.32;
/** 돔 밑면(안감) 색 — 챙 밑으로 올려다볼 때 보인다 */
const CAP_LINING_COLOR = "#1a1c22";
/**
 * 외곽선 껍데기 두께(m). 몸은 화면 픽셀로 일정한 뒤집은 껍데기를 쓴다 — 캡은 작아서 몇 mm 의 세계 두께로 같은 굵기에 맞춘다
 * (drei Outlines 는 늘린 반원판에서 껍데기가 얼굴을 덮는 큰 삼각형으로 깨졌다).
 */
const HULL = 0.0035;

/**
 * 곡선 챙(닫힌 입체). 돔 테두리의 앞 호에 그대로 붙어 있고(뿌리는 돔 벽 안쪽 1.2cm 부터), 바깥으로 갈수록 살짝 숙이며 양옆이
 * 아래로 휜다. 예전엔 평평한 반원판을 돔 한가운데를 축으로 숙여, 돔 앞 벽에서 챙이 테두리보다 1cm 남짓 내려가 그 틈으로
 * 이마가 비쳤다(미르 11/8). offset 은 외곽선 껍데기용 — 바깥 · 위아래로 그만큼 키운다.
 */
function makeBrimGeometry(radius: THREE.Vector3, offset: number) {
  const across = 28;
  const along = 10;
  const outerX = radius.x * BRIM_WIDEN + offset;
  const outerZ = radius.z * BRIM_REACH + offset;
  const rimZ = (x: number) => {
    const t = 1 - (x / radius.x) ** 2;
    return t > 0 ? radius.z * Math.sqrt(t) : 0;
  };
  const edgeZ = (x: number) => {
    const t = 1 - (x / outerX) ** 2;
    return t > 0 ? outerZ * Math.sqrt(t) : 0;
  };
  const positions: number[] = [];
  const rows = across + 1;
  const cols = along + 1;
  for (const layer of [0, 1]) {
    for (let i = 0; i < rows; i += 1) {
      const x = (i / across) * 2 * outerX - outerX;
      const inner = rimZ(x) - 0.012 - offset;
      const outer = Math.max(inner + 1e-4, edgeZ(x));
      for (let j = 0; j < cols; j += 1) {
        const z = inner + ((outer - inner) * j) / along;
        // 테두리 호에서 바깥 끝까지 0 → 1. 테두리 안쪽(뿌리)은 평평하게 테두리 높이
        const reach = outer - rimZ(x);
        const t = reach > 1e-4 ? Math.min(1, Math.max(0, (z - rimZ(x)) / reach)) : 0;
        const drop = t * reach * BRIM_DROOP + t ** 1.5 * BRIM_CURL * radius.x * (x / outerX) ** 2;
        const y = layer === 0 ? offset - drop : -BRIM_THICKNESS - offset - drop;
        positions.push(x, y, z);
      }
    }
  }
  const top = (i: number, j: number) => i * cols + j;
  const bottom = (i: number, j: number) => rows * cols + i * cols + j;
  const index: number[] = [];
  for (let i = 0; i < across; i += 1) {
    for (let j = 0; j < along; j += 1) {
      // 윗면(+y) · 아랫면(−y)
      index.push(top(i, j), top(i, j + 1), top(i + 1, j), top(i + 1, j), top(i, j + 1), top(i + 1, j + 1));
      index.push(
        bottom(i, j),
        bottom(i + 1, j),
        bottom(i, j + 1),
        bottom(i + 1, j),
        bottom(i + 1, j + 1),
        bottom(i, j + 1),
      );
    }
    // 바깥 끝(+z) · 뿌리(−z, 돔 안)
    index.push(
      top(i, along),
      bottom(i, along),
      top(i + 1, along),
      top(i + 1, along),
      bottom(i, along),
      bottom(i + 1, along),
    );
    index.push(top(i, 0), top(i + 1, 0), bottom(i, 0), top(i + 1, 0), bottom(i + 1, 0), bottom(i, 0));
  }
  for (let j = 0; j < along; j += 1) {
    // 양 끝 벽(−x · +x)
    index.push(top(0, j), bottom(0, j), top(0, j + 1), top(0, j + 1), bottom(0, j), bottom(0, j + 1));
    index.push(
      top(across, j),
      top(across, j + 1),
      bottom(across, j),
      top(across, j + 1),
      bottom(across, j + 1),
      bottom(across, j),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function Cap({ fit, outline }: { fit: CapFit; outline: OutlineConfig }) {
  const material = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ color: CAP_COLOR, gradientMap: gradient })),
    [],
  );
  const buttonMaterial = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ color: CAP_BUTTON_COLOR, gradientMap: gradient })),
    [],
  );
  const liningMaterial = useMemo(
    () =>
      markAvatarMaterial(
        new THREE.MeshToonMaterial({ color: CAP_LINING_COLOR, gradientMap: gradient, side: THREE.DoubleSide }),
      ),
    [],
  );
  const inkMaterial = useMemo(
    () => markAvatarMaterial(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })),
    [],
  );
  // 아바타 외곽선 설정을 따른다(끄면 캡 껍데기도 숨긴다)
  useEffect(() => {
    inkMaterial.color.set(outline.color);
    inkMaterial.visible = outline.enabled;
  }, [inkMaterial, outline.color, outline.enabled]);
  const dome = useMemo(() => new THREE.SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), []);
  // 돔 밑면 — 머리와 돔 테두리 사이의 빈 곳을 막는다(머리 안쪽은 머리 표면에 가려 안 보인다)
  const lining = useMemo(() => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), []);
  const { center, radius, frame } = fit;
  const brim = useMemo(() => makeBrimGeometry(radius, 0), [radius]);
  const brimHull = useMemo(() => makeBrimGeometry(radius, HULL), [radius]);
  useEffect(
    () => () => {
      [material, buttonMaterial, liningMaterial, inkMaterial, dome, lining].forEach((item) => item.dispose());
    },
    [material, buttonMaterial, liningMaterial, inkMaterial, dome, lining],
  );
  useEffect(
    () => () => {
      brim.dispose();
      brimHull.dispose();
    },
    [brim, brimHull],
  );
  const button = Math.max(0.006, radius.x * 0.07);
  return createPortal(
    <group matrixAutoUpdate={false} matrix={frame.basis}>
      {/* 돔 — 위 반구를 머리에 맞춰 늘린다 */}
      <mesh position={center} scale={radius} geometry={dome} material={material} castShadow receiveShadow />
      <mesh
        position={center}
        scale={[radius.x + HULL, radius.y + HULL, radius.z + HULL]}
        geometry={dome}
        material={inkMaterial}
      />
      <mesh
        position={[center.x, center.y + 0.0005, center.z]}
        scale={[radius.x, 1, radius.z]}
        geometry={lining}
        material={liningMaterial}
        receiveShadow
      />
      {/* 챙 — 테두리 앞 호에 붙은 곡선 챙 */}
      <group position={center}>
        <mesh geometry={brim} material={material} castShadow receiveShadow />
        <mesh geometry={brimHull} material={inkMaterial} />
      </group>
      {/* 꼭대기 단추 */}
      <mesh position={[center.x, center.y + radius.y - button * 0.3, center.z]} material={buttonMaterial}>
        <sphereGeometry args={[button, 12, 8]} />
      </mesh>
    </group>,
    frame.bone,
  );
}

let chestPrintMaterial: THREE.MeshToonMaterial | null = null;
let backPrintMaterial: THREE.MeshToonMaterial | null = null;

/** 인쇄 재질 — 모든 팀 NPC 가 같이 쓴다(지우지 않는다). 불투명 + alphaTest(정렬 문제 없게), 그림자는 받기만 */
function printMaterial(back: boolean) {
  const make = (texture: THREE.Texture) =>
    markAvatarMaterial(
      new THREE.MeshToonMaterial({
        map: texture,
        gradientMap: gradient,
        alphaTest: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
  if (back) return (backPrintMaterial ??= make(makeMarineBackTexture()));
  return (chestPrintMaterial ??= make(makeMarineTexture()));
}

/**
 * 인쇄 판 격자 → 스키닝 기하(웨이트는 그 아래 셔츠 삼각형에서 받아 둔 것). 등 판은 면이 뒤를 보게 감기를 뒤집고, 뒤에서
 * 읽히게 글자 좌우(u)를 뒤집는다
 */
function printGeometry(patch: PrintPatch) {
  const plane = new THREE.PlaneGeometry(1, 1, patch.cols, patch.rows);
  plane.setAttribute("position", new THREE.BufferAttribute(patch.positions.slice(), 3));
  plane.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(patch.skinIndex, 4));
  plane.setAttribute("skinWeight", new THREE.Float32BufferAttribute(patch.skinWeight, 4));
  if (patch.back) {
    const uv = plane.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) uv.setX(i, 1 - uv.getX(i));
    const index = plane.getIndex();
    if (index) {
      const array = index.array;
      for (let i = 0; i < array.length; i += 3) {
        const swap = array[i + 1]!;
        array[i + 1] = array[i + 2]!;
        array[i + 2] = swap;
      }
      index.needsUpdate = true;
    }
  }
  plane.computeVertexNormals();
  return plane;
}

/** 가슴 글자 · 등 마크 — 몸 메시 옆에 같은 골격으로 묶은 스키닝 메시(바지 파츠와 같은 방식) */
function MarinePrint({ fit }: { fit: PrintFit }) {
  useEffect(() => {
    const { body } = fit;
    const parent = body.parent;
    if (!parent) return;
    const meshes = [fit.chest, fit.back].flatMap((patch) => {
      if (!patch) return [];
      const mesh = new THREE.SkinnedMesh(printGeometry(patch), printMaterial(patch.back));
      mesh.name = patch.back ? "MarinePrintBack" : "MarinePrintChest";
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      mesh.scale.copy(body.scale);
      mesh.bind(body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return [mesh];
    });
    return () => {
      meshes.forEach((mesh) => {
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
      });
    };
  }, [fit]);
  return null;
}

/** 바지 파일이 없거나 못 받아도 바지만 빠지고 아바타(로비 화면)는 그대로 — useGLTF 는 실패하면 오류를 던진다 */
class SkipOnError extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn(`[TeamOutfitLayer] ${this.props.label} 를 그리지 못했다`, error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 아바타 몸과 같은 명암 계단(툰) */
const pantsGradient = makeToonGradientTexture(DEFAULT_TOON.steps, DEFAULT_TOON.threshold);
/** 바지 파츠의 −1 끝 체형 모프 이름 꼬리(tools/team_pants_build.py 가 붙인다) */
const NEGATIVE_MORPH_SUFFIX = "__neg";

/**
 * 바지 — 따로 구운 파츠 GLB(tools/team_pants_build.py)를 신발처럼 몸 골격에 묶는다(attachParts: 뼈 이름으로 다시 묶기).
 * 굽을 때 가장 가까운 몸 표면에서 웨이트 · 모프를 옮겨 받아 몸과 같은 모프 이름을 갖고 있다 — 매 프레임 몸의 모프 값
 * (다리 두께 · 골반 · 체형)을 옮겨 체형 슬라이더를 따라간다. 결 무늬(회색)에 바지 색을 곱하고, 외곽선은 아바타와 같은
 * 껍데기(applyOutline)다.
 */
function Pants({
  prepared,
  style,
  color,
  config,
  outline,
  framePriority,
}: {
  prepared: PreparedBody;
  style: TeamPantsStyle;
  color: string;
  config: Partial<MeshAppearanceConfig>;
  outline: OutlineConfig;
  framePriority: number;
}) {
  const gltf = useGLTF(getTeamPantsUrl(style, config)) as unknown as LoadedGltf;
  const material = useMemo(
    () => markAvatarMaterial(new THREE.MeshToonMaterial({ gradientMap: pantsGradient, side: THREE.DoubleSide })),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.color.set(color);
  }, [material, color]);
  const attached = useRef<{ body: THREE.SkinnedMesh; meshes: THREE.SkinnedMesh[] } | null>(null);
  // 외곽선은 아바타 설정을 따른다(끄기 · 굵기 · 색) — 붙일 때 지금 값으로, 바뀌면 핸들을 고친다
  const outlineRef = useRef(outline);
  const outlineHandles = useRef<OutlineHandle[]>([]);
  useEffect(() => {
    outlineRef.current = outline;
    outlineHandles.current.forEach((handle) => handle.update(outline));
  }, [outline]);
  useEffect(() => {
    const body = findBodyMesh(prepared.model);
    if (!body) return;
    const errors: PartError[] = [];
    const disposables: Disposables = { geometries: [], materials: [] };
    const meshes = attachParts(gltf, body, errors, disposables);
    if (errors.length) console.warn("[TeamOutfitLayer] 바지 파츠 뼈가 몸에 없다", errors);
    const originals = new Map<string, THREE.SkinnedMesh>();
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) originals.set(object.name, object);
    });
    for (const mesh of meshes) {
      const original = originals.get(mesh.name);
      // 골반 높이 벽(두 다리 통이 가운데 평면에서 맞붙은 면 — 몸 · 바지 안에 숨는다)은 외곽선 · 그림자에서 뺀다.
      // 껍데기가 앞뒤 가운데 이음으로 비쳐 검은 줄이 된다(Codex 23회차). 재질 이름은 tools/team_pants_build.py 가 붙인다
      const wall = (mesh.material as THREE.Material | undefined)?.name === "TeamPantsWall";
      // 새 메시는 모프 이름을 모른다(번호만) — 원본 이름표를 옮긴다. 결 무늬는 원본 재질의 텍스처
      if (original?.morphTargetDictionary) mesh.morphTargetDictionary = { ...original.morphTargetDictionary };
      const map = (original?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
      if (map && material.map !== map) {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
        material.map = map;
        material.needsUpdate = true;
      }
      mesh.material = material;
      mesh.frustumCulled = false;
      // 몸 · 신발처럼 그림자를 드리우고 받는다(attachParts 는 둘 다 끈 채 만든다 — Codex 리뷰 a2a0fbd)
      mesh.castShadow = !wall;
      mesh.receiveShadow = true;
      mesh.userData.teamPants = style;
      mesh.userData.teamPantsWall = wall;
    }
    const outlines = meshes
      .filter((mesh) => !mesh.userData.teamPantsWall)
      .map((mesh) => applyOutline(mesh, outlineRef.current));
    outlineHandles.current = outlines;
    attached.current = { body, meshes };
    return () => {
      attached.current = null;
      outlineHandles.current = [];
      outlines.forEach((outline) => outline.remove());
      meshes.forEach((mesh) => mesh.parent?.remove(mesh));
      disposables.geometries.forEach((geometry) => geometry.dispose());
    };
  }, [gltf, prepared, material, style]);
  // 몸의 체형 모프 값을 이름으로 옮긴다(몸 GLB 와 바지 파츠의 모프 순서가 같다는 보장은 없다).
  // 음수로도 쓰는 체형(골반 · 다리 두께 · 신발 신은 발)은 바지에 −1 끝 모양이 따로 있다(「이름__neg」) — 양수는 원래 이름,
  // 음수는 __neg 에 크기로 넣는다. 바지 통은 최대 필터라 +1 모양을 뒤집어 쓰면 몸보다 더 오그라들었다
  useFrame(() => {
    const current = attached.current;
    const bodyInfluences = current?.body.morphTargetInfluences;
    const bodyDictionary = current?.body.morphTargetDictionary;
    if (!current || !bodyInfluences || !bodyDictionary) return;
    for (const mesh of current.meshes) {
      const influences = mesh.morphTargetInfluences;
      const dictionary = mesh.morphTargetDictionary;
      if (!influences || !dictionary) continue;
      for (const [name, index] of Object.entries(dictionary)) {
        const negative = name.endsWith(NEGATIVE_MORPH_SUFFIX);
        const bodyName = negative ? name.slice(0, -NEGATIVE_MORPH_SUFFIX.length) : name;
        const source = bodyDictionary[bodyName];
        const value = source === undefined ? 0 : (bodyInfluences[source] ?? 0);
        const split = negative || dictionary[`${name}${NEGATIVE_MORPH_SUFFIX}`] !== undefined;
        influences[index] = !split ? value : negative ? Math.max(0, -value) : Math.max(0, value);
      }
    }
  }, framePriority);
  return null;
}

/**
 * 아바타 안에 둔다. fitKey(설정)가 바뀌면 두 프레임 뒤(모프 · 뼈 배율이 들어간 뒤) 다시 잰다.
 * framePriority 는 아바타보다 뒤 — 그 프레임의 자세가 다 잡힌 다음에 잰다.
 */
export default function TeamOutfitLayer({
  prepared,
  outfit,
  config,
  outline = DEFAULT_OUTLINE,
  framePriority,
}: {
  prepared: PreparedBody;
  outfit: TeamOutfit;
  /** 번호를 푼 렌더러 설정 — 바뀌면 다시 잰다(fitKey). 바지 파일 · 색도 여기서 */
  config: Partial<MeshAppearanceConfig>;
  /** 아바타 외곽선 설정(끄기 · 굵기 · 색) */
  outline?: OutlineConfig;
  framePriority: number;
}) {
  const fitKey = config;
  // 잰 결과는 어느 몸 · 설정으로 쟀는지와 함께 둔다 — 바뀐 뒤 다시 재기 전(두 프레임)에는 그리지 않는다
  const [fits, setFits] = useState<{
    prepared: PreparedBody;
    fitKey: unknown;
    cap: CapFit | null;
    print: PrintFit | null;
  } | null>(null);
  const pending = useRef(2);
  useEffect(() => {
    pending.current = 2;
  }, [prepared, outfit.cap, outfit.marine, fitKey]);
  useFrame(() => {
    if (pending.current <= 0) return;
    pending.current -= 1;
    if (pending.current > 0) return;
    prepared.model.updateMatrixWorld(true);
    setFits({
      prepared,
      fitKey,
      cap: outfit.cap ? fitCap(prepared) : null,
      print: outfit.marine ? fitPrint(prepared) : null,
    });
  }, framePriority);
  const current = fits && fits.prepared === prepared && fits.fitKey === fitKey ? fits : null;
  const cap = current?.cap ?? null;
  const print = current?.print ?? null;
  return (
    <>
      {outfit.cap && cap && <Cap fit={cap} outline={outline} />}
      {outfit.marine && print && <MarinePrint fit={print} />}
      {outfit.pants && (
        // 바지 파일을 받는 동안 아바타 전체가 사라지지 않게 따로 기다린다
        <SkipOnError key={`${outfit.pants}:${config.gender}:${config.top}`} label="바지">
          <Suspense fallback={null}>
            <Pants
              prepared={prepared}
              style={outfit.pants}
              color={outfit.pantsColor ?? "#ffffff"}
              config={config}
              outline={outline}
              framePriority={framePriority}
            />
          </Suspense>
        </SkipOnError>
      )}
    </>
  );
}
