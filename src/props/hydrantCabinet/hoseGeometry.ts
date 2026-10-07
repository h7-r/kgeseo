/**
 * 접어 넣은 소방호스. 실물은 한 줄짜리 납작한 천 호스를 지그재그로 접어 건다 —
 * 아래 끝은 U자로 돌아 올라가고 위쪽은 걸이 막대를 넘어 다시 내려온다.
 * 상자를 쌓으면 마디마다 턱이 져서, 가운데 선 하나를 처음부터 끝까지 이은 뒤 납작한 단면으로 훑는다.
 * 축: z 가 가로, y 가 세로, x 가 깊이.
 */
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { makeRandom } from "@/engine/random";

/**
 * 가운데 선을 따라 납작한 띠를 훑는다. 넓은 면은 늘 앞(x)을 보고, 폭 방향만 진행 방향과 직각으로 돌린다 —
 * 안 돌리면 옆으로 꺾이는 U자 구간에서 띠가 날처럼 선다.
 */
function ribbonGeometry(centerline: Vector3Tuple[], width: number, thickness: number) {
  const n = centerline.length;
  const across: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = centerline[Math.max(0, i - 1)];
    const b = centerline[Math.min(n - 1, i + 1)];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const length = Math.hypot(ty, tz) || 1;
    ty /= length;
    tz /= length;
    across.push([-tz, ty]); // 진행 방향을 90° 돌린 것
  }
  const positions: number[] = [];
  const corner = (i: number, sx: number, sw: number): Vector3Tuple => {
    const c = centerline[i];
    const w = across[i];
    return [c[0] + (sx * thickness) / 2, c[1] + ((sw * width) / 2) * w[0], c[2] + ((sw * width) / 2) * w[1]];
  };
  const faces: [[number, number], [number, number]][] = [
    [
      [1, -1],
      [1, 1],
    ], // +x
    [
      [-1, 1],
      [-1, -1],
    ], // −x
    [
      [1, 1],
      [-1, 1],
    ], // 폭 +쪽 모서리
    [
      [-1, -1],
      [1, -1],
    ], // 폭 −쪽 모서리
  ];
  for (const [a, b] of faces)
    for (let i = 0; i < n - 1; i++) {
      const A = corner(i, a[0], a[1]);
      const B = corner(i, b[0], b[1]);
      const C = corner(i + 1, b[0], b[1]);
      const D = corner(i + 1, a[0], a[1]);
      positions.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
  const cap = (i: number, isStart: boolean) => {
    const q = [corner(i, -1, -1), corner(i, 1, -1), corner(i, 1, 1), corner(i, -1, 1)];
    for (const k of isStart ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) positions.push(...q[k]);
  };
  cap(0, true);
  cap(n - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

export interface HoseOptions {
  width?: number;
  height?: number;
  depth?: number;
  /** 지금 함에 남은 가닥 수. 밸브 쪽(i=0)부터 세므로 줄면 관창 쪽부터 빠진다. */
  strands?: number;
  /**
   * 처음에 걸려 있던 가닥 수. 자리·굵기·길이를 이것으로 정한다 —
   * 남은 수로 정하면 한 가닥 빠질 때마다 다발이 통째로 출렁인다.
   */
  totalStrands?: number | null;
  seed?: number;
  /** 첫 가닥 위에서 여기까지 이어 붙인다(밸브 자리) */
  start?: Vector3Tuple | null;
  /** 마지막 가닥 끝에서 여기까지 U자로 빠져나간다(관창 자리) */
  end?: Vector3Tuple | null;
}

/**
 * 접힌 호스의 가운데 선. 지오와 나눈 이유: 관창을 끌고 나가면 다발을 줄여 다시 그리고,
 * 남은 호스 끝을 알고, 전체 길이를 재야 하는데 셋 다 가운데 선만 있으면 된다.
 */
export function hoseCenterline({
  width = 1.0,
  height = 0.9,
  depth = 0.16,
  strands: requestedStrands = 16,
  totalStrands = null,
  seed = 7,
  start = null,
  end = null,
}: HoseOptions = {}): Vector3Tuple[] {
  const total = Math.max(1, totalStrands ?? requestedStrands);
  const strands = Math.max(1, Math.min(total, requestedStrands));
  const random = makeRandom(seed);

  // 총가닥만큼 뽑는다 — 남은 수로 뽑으면 난수 순서가 달라져 남은 가닥 생김새가 전부 바뀐다.
  const lengths: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < total; i++) {
    const u = total === 1 ? 0.5 : i / (total - 1);
    lengths.push(height * (0.62 + 0.38 * Math.sin(u * Math.PI)) * (0.9 + random() * 0.2));
    offsets.push((random() - 0.5) * depth);
  }
  // 관창으로 빠지는 마지막 가닥은 길게 — 짧으면 U자를 그릴 자리가 없어 관창 옆구리에 비스듬히 붙는다.
  if (end) lengths[strands - 1] = lengths[strands - 1] * 1.35;

  const line: Vector3Tuple[] = [];
  const point = (x: number, y: number, z: number) => line.push([x, y, z]);
  const zOf = (i: number) => (i / Math.max(1, total - 1) - 0.5) * width;
  const vertical = (i: number, isDown: boolean) => {
    const z = zOf(i);
    const length = lengths[i];
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const s = isDown ? k / steps : 1 - k / steps;
      // 천이라 반듯하지 않다 — 아래로 갈수록 살짝 흔들린다
      const wobble = Math.sin(s * 2.2 * Math.PI + i) * 0.014 * s;
      point(offsets[i] + wobble, -length * s, z + wobble * 0.4);
    }
  };
  const bottomTurn = (i: number, j: number) => {
    const zi = zOf(i);
    const zj = zOf(j);
    const dip = Math.abs(zj - zi) * 0.6 + 0.02;
    const steps = 8;
    for (let k = 1; k < steps; k++) {
      const s = k / steps;
      point(
        offsets[i] + (offsets[j] - offsets[i]) * s,
        -(lengths[i] + (lengths[j] - lengths[i]) * s) - dip * Math.sin(s * Math.PI),
        zi + (zj - zi) * s,
      );
    }
  };
  const overBar = (i: number, j: number) => {
    const zi = zOf(i);
    const zj = zOf(j);
    const steps = 8;
    for (let k = 1; k < steps; k++) {
      const s = k / steps;
      point(
        offsets[i] + (offsets[j] - offsets[i]) * s,
        0.055 * Math.sin(s * Math.PI), // 막대 위로 살짝 솟는다
        zi + (zj - zi) * s,
      );
    }
  };

  if (start) {
    const z0 = -width / 2;
    const steps = 8;
    for (let k = 0; k < steps; k++) {
      const s = k / steps;
      point(
        start[0] + (offsets[0] - start[0]) * s,
        start[1] + (0 - start[1]) * s + 0.03 * Math.sin(s * Math.PI),
        start[2] + (z0 - start[2]) * s,
      );
    }
  }

  for (let i = 0; i < strands; i++) {
    vertical(i, i % 2 === 0); // 짝수는 내려가고 홀수는 올라온다
    if (i === strands - 1) break;
    if (i % 2 === 0) bottomTurn(i, i + 1);
    else overBar(i, i + 1);
  }

  // 마지막 가닥 끝 → 관창. 곧장 이으면 옆구리에 붙으므로 바닥을 찍고 관창 바로 밑에서 올라가 물린다.
  if (end) {
    const last = line[line.length - 1];
    const bottom = Math.min(last[1], end[1]) - 0.16;
    const route: Vector3Tuple[] = [
      [last[0], bottom + 0.04, last[2]],
      [(last[0] + end[0]) / 2, bottom, (last[2] + end[2]) / 2],
      [end[0], bottom + 0.04, end[2]],
      end,
    ];
    let previous = last;
    for (const target of route) {
      const steps = 5;
      for (let k = 1; k <= steps; k++) {
        const s = k / steps;
        point(
          previous[0] + (target[0] - previous[0]) * s,
          previous[1] + (target[1] - previous[1]) * s,
          previous[2] + (target[2] - previous[2]) * s,
        );
      }
      previous = target;
    }
  }

  return line;
}

/** 가운데 선을 납작한 띠로 훑는다. 띠 굵기는 총가닥 간격에서 나온다 — 남은 수로 재면 빠질수록 굵어진다. */
export function hoseRibbon(
  centerline: Vector3Tuple[],
  { width = 1.0, strands = 16, totalStrands = null }: Pick<HoseOptions, "width" | "strands" | "totalStrands"> = {},
) {
  const spacing = width / Math.max(1, (totalStrands ?? strands) - 1);
  return ribbonGeometry(centerline, spacing * 0.78, 0.028);
}

/** 선을 뽑아 바로 띠로 만든다. */
export function hoseGeometry(options: HoseOptions = {}) {
  return hoseRibbon(hoseCenterline(options), options);
}

/** 꺾은선의 길이. "호스가 이만큼이라 여기까지만 간다"의 근거. */
export function polylineLength(line: Vector3Tuple[]) {
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}
