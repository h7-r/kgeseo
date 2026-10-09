/**
 * 배전반 전선. 상자를 꺾어 이으면 마디마다 턱이 져서 토막으로 보인다 — 가운데 선을 CatmullRom 으로
 * 부드럽게 뽑고 관으로 훑는다(소화전 호스를 띠로 훑은 것과 같은 이유).
 */
import * as THREE from "three";
import type { Vector3Tuple } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { PULL_SIDE, WIRE_BACK_OFFSET, type PanelLayout } from "./panelLayout";

export type WirePath = Vector3Tuple[];

const UP = new THREE.Vector3(0, 1, 0);

/** 장력 0.3 — 기본 0.5 면 꺾이는 데서 밖으로 부풀어 튕겨 나간 것처럼 보인다. */
export function buildWireTubeGeometry(points: WirePath, radius: number, segments = 24, radialSegments = 7) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    "catmullrom",
    0.3,
  );
  return new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
}

/** 여러 가닥을 한 메시로. 색이 같은 것끼리만 부른다. */
export function buildWireBundleGeometry(paths: WirePath[], radius: number, segments = 24) {
  if (!paths.length) return null;
  const pieces = paths.map((points) => buildWireTubeGeometry(points, radius, segments));
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

/**
 * 벗겨 놓은 구리 끝. 선이 끝나는 방향 그대로 세워야 '잘린 자리'로 읽힌다(안 맞으면 '부러진 자리').
 * 위(늘어진 쪽)는 굵은 통, 아래(스위치 쪽)는 가는 핀 — 암수라야 꽂았는지 눈으로 구분된다.
 */
export function buildCopperTipGeometry(paths: WirePath[], baseRadius: number, tipRadius: number, length: number) {
  if (!paths.length) return null;
  const pieces = paths.map((points) => {
    const end = new THREE.Vector3(...points[points.length - 1]);
    const before = new THREE.Vector3(...points[points.length - 2]);
    const direction = end.clone().sub(before).normalize();
    const g = new THREE.CylinderGeometry(tipRadius, baseRadius, length, 8, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction));
    const center = end.clone().addScaledVector(direction, length * 0.4);
    g.translate(center.x, center.y, center.z);
    return g;
  });
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 꽂힌 모양 — 위 선(암) 입구 바로 아래까지 끌어 올린다. 점을 덧붙이기만 한다(원래 경로를 지우면
 * 단자 쪽 앞부분까지 흔들린다). 마지막 마디는 곧게 수직이어야 핀이 통 옆구리로 비껴 들어가지 않는다.
 */
function buildPluggedPath(points: WirePath, target: Vector3Tuple, depth = 0.08): WirePath {
  const end = points[points.length - 1];
  const mouth: Vector3Tuple = [target[0], target[1] - depth, target[2]];
  return [
    ...points,
    [mix(end[0], mouth[0], 0.45), mix(end[1], mouth[1], 0.4), mix(end[2], mouth[2], 0.3)],
    [mix(end[0], mouth[0], 0.82), mix(end[1], mouth[1], 0.78), mix(end[2], mouth[2], 0.76)],
    [mouth[0], mouth[1] - 0.034, mouth[2]],
    mouth,
  ];
}

/** 인입 — 천장 전선관에서 내려와 주차단기 위 단자로. y 가 계속 내려가야 지그재그가 안 생긴다. */
function buildInletPaths({
  deep,
  innerHeight,
  inletZ0,
  inletSpacing,
  mainZ,
  mainWidth,
  mainY,
  mainHeight,
  mainDepth,
}: PanelLayout) {
  const paths: WirePath[] = [];
  for (let i = 0; i < 5; i++) {
    const z0 = inletZ0 + i * inletSpacing;
    const zt = mainZ - mainWidth * 0.34 + (i * mainWidth * 0.68) / 4;
    paths.push([
      [deep(0.075), innerHeight / 2 + 0.05, z0],
      [deep(0.085), innerHeight / 2 - 0.055, z0],
      [deep(0.1), mainY + mainHeight * 0.72, z0 * 0.35 + zt * 0.65],
      [deep(mainDepth * 0.55), mainY + mainHeight * 0.34, zt],
    ]);
  }
  return paths;
}

/** 주차단기 → 접속함. 함 한가운데서 끝난다 — 회로가 여기서 끊겨 있다는 게 이 반의 이야기다. */
function buildFeederPaths({
  deep,
  mainZ,
  mainWidth,
  mainY,
  mainHeight,
  mainDepth,
  junctionY,
  junctionDepth,
  junctionHeight,
}: PanelLayout) {
  const paths: WirePath[] = [];
  for (let j = 0; j < 3; j++) {
    const zt = mainZ + (j - 1) * mainWidth * 0.26;
    paths.push([
      [deep(mainDepth * 0.55), mainY - mainHeight * 0.3, zt],
      [deep(0.105), mainY - mainHeight * 0.62, zt * 0.55],
      [deep(0.09), (mainY - mainHeight + junctionY) / 2, zt * 0.28],
      // 상자 안에서 끝낸다 — 위로 삐져나오면 상자를 뚫은 것처럼 보인다
      [deep(junctionDepth + 0.03), junctionY + junctionHeight * 0.22, (j - 1) * 0.03],
    ]);
  }
  return paths;
}

/**
 * 접속함에서 나와 허공에서 끝나는 세 줄(암). 똑같이 나란하면 그려 넣은 무늬가 되어 조금씩 다르게 늘어뜨린다.
 * 점을 촘촘히 — 나가는 데서 천천히 벌어지고 끝에서는 거의 수직으로 떨어진다.
 */
function buildHangingPaths({ deep, junctionY, junctionDepth, junctionHeight, hangingZ, freeEndY, dims }: PanelLayout) {
  const { wireRadius } = dims;
  return hangingZ.map((across, i): WirePath => {
    const end = freeEndY + (i - 1) * 0.045; // 끝 높이를 엇갈리게
    return [
      // 나오는 자리 간격은 선 지름보다 넉넉해야 서로 파고들지 않는다
      [deep(junctionDepth + 0.015), junctionY - junctionHeight * 0.42, (i - 1) * Math.max(0.072, wireRadius * 3.4)],
      [
        deep(junctionDepth + 0.03),
        junctionY - junctionHeight * 0.9,
        (i - 1) * Math.max(0.078, wireRadius * 3.7) + across * 0.12,
      ],
      [deep(junctionDepth + 0.052), junctionY - junctionHeight * 1.7, across * 0.56],
      [deep(junctionDepth + 0.062), (junctionY + end) * 0.5 - 0.02, across * 0.9],
      [deep(junctionDepth + 0.058), end + 0.135, across * 1.01],
      [deep(junctionDepth + 0.05), end + 0.06, across],
      [deep(junctionDepth + 0.046), end, across * 0.998],
    ];
  });
}

/**
 * 접지 — 동판에서 나와 위로 빠진다. 세 가닥이 한 동판에서 높이만 달리해 나와 서로 스치므로
 * 아래 가닥일수록 바깥으로, 출발도 같은 순서로 벌리고, 깊이 차선을 둔다. 나가는 자리는 벽면 안으로 묶는다.
 */
function buildGroundPaths({
  deep,
  depthScale,
  innerWidth,
  innerHeight,
  wallFace,
  groundZ,
  groundTop,
  groundBottom,
  dims,
}: PanelLayout) {
  const paths: WirePath[] = [];
  for (let k = 0; k < 3; k++) {
    const by = groundBottom + ((k + 0.7) * (groundTop - groundBottom)) / 3.2;
    const spread = innerWidth * 0.032;
    const exitZ = Math.max(-(wallFace - 0.06), groundZ - innerWidth * 0.015 - (2 - k) * spread);
    const startZ = groundZ - (1 - k) * 0.026;
    // 쓸 수 있는 깊이(0.24) 안이라야 한다. 선 굵기는 깊이 배율을 안 타 얕은 함일수록 비중이 크다.
    const lane = Math.min(0.058, (0.2 - (dims.thickWireRadius * 0.55) / depthScale) / 2) * k;
    // 경유점은 늘 올라가야 한다 — 위쪽 가닥은 고정 높이가 오히려 아래라 되꺾인다.
    const via = Math.max(by + 0.09, innerHeight / 2 - 0.1);
    paths.push([
      [deep(0.028 + lane * 0.35), by, startZ],
      // 동판을 떠나자마자 바깥으로 붙는다 — 늦게 벌리면 위 가닥과 스친다
      [deep(0.06 + lane), by + (via - by) * 0.25, exitZ * 0.85 + startZ * 0.15],
      [deep(0.07 + lane), via, exitZ],
      [deep(0.058 + lane), innerHeight / 2 + 0.05, exitZ - 0.012],
    ]);
  }
  return paths;
}

/**
 * 분기 배선(수) — 색은 줄마다 정해진다. 옆으로 나와 위를 보고 끝나 늘어진 세 줄과 마주 본다.
 * 색마다 한쪽 끝에만 낸다 — 양쪽이면 짝이 둘이라 어느 쪽에 이을지 알 수 없다.
 */
function buildBranchPaths(layout: PanelLayout) {
  const { deep, rowYs, colorOfRow, columnZ, outerZ, breakerWidth, breakerDepth } = layout;
  const byColor: WirePath[][] = [[], [], []];
  rowYs.forEach((y, r) => {
    const c = colorOfRow(r);
    const s = PULL_SIDE[c];
    const z = columnZ[s > 0 ? 1 : 0];
    const outer = outerZ(c);
    const side = z + s * (breakerWidth / 2);
    const back = WIRE_BACK_OFFSET[c];
    byColor[c].push([
      [deep(breakerDepth * 0.72), y, side - s * 0.005],
      // 단자에서 나오자마자 살짝 처진다 — 뻣뻣한 관이 아니라 늘어진 선이다
      [deep(breakerDepth + 0.025 - back), y - 0.01, side + s * 0.055],
      [deep(0.135 - back), y - 0.014, side * 0.32 + outer * 0.68],
      // 옆벽 앞에서 천천히 일어선다
      [deep(0.152 - back), y + 0.018, outer],
      [deep(0.156 - back), y + 0.082, outer * 1.005],
      [deep(0.148 - back), y + 0.145, outer * 0.99], // 자유단 — 위를 본다
    ]);
  });
  return byColor;
}

export function buildWirePaths(layout: PanelLayout) {
  return {
    inlet: buildInletPaths(layout),
    feeder: buildFeederPaths(layout),
    hanging: buildHangingPaths(layout),
    ground: buildGroundPaths(layout),
    branch: buildBranchPaths(layout),
  };
}

type WirePaths = ReturnType<typeof buildWirePaths>;

/** 고정 배선 — 검은 상선 · 파란 중성선 · 초록 접지선. 접지선은 셋이 좁게 나란히 지나 가늘게 둔다. */
export function buildFixedWires({ inlet, feeder, ground }: WirePaths, thickRadius: number) {
  return {
    black: buildWireBundleGeometry([...inlet.slice(0, 4), ...feeder.slice(0, 2)], thickRadius),
    blue: buildWireBundleGeometry([inlet[4], feeder[2]], thickRadius),
    green: buildWireBundleGeometry(ground, thickRadius * 0.55),
  };
}

/**
 * 지금 이 순간의 아래 선 모양. 원래 경로는 두고 꼬리만 덧그려야 단자 쪽 앞부분이 고정된다.
 * 색마다 맨 앞 한 가닥만 움직인다 — 줄을 늘려도 잡고 꽂는 것은 늘 한 가닥이다.
 * 쥐고 있는 가닥의 꼬리는 DraggedPanelWire 가 따로 그린다.
 */
export function buildCurrentBranchPaths(
  branch: WirePath[][],
  hanging: WirePath[],
  sockets: readonly number[],
): WirePath[][] {
  return branch.map((strands, c) => {
    const top = sockets[c];
    if (top < 0) return strands;
    const target = hanging[top][hanging[top].length - 1];
    return strands.map((points, k) => (k === 0 ? buildPluggedPath(points, target) : points));
  });
}
