// 코어 동쪽 끝에서 바깥 들판으로 내려가는 경사로.
// 코어 동쪽 가장자리는 들판보다 6.7 m 높아, 이것이 없으면 원경의 마을길이 허공에서 시작한다.
// 도면 밖 설계라 §7 0단계 안건이다. T1~T4 와 고리 75.1 m 는 건드리지 않는다.
// 경사는 T3(14.9°)와 T4(26.6°) 사이 — 짐 지고 오르내리는 마을길이라 T4 만큼 가파르면 안 되고,
// T3 만큼 눕히면 25 m 를 더 뻗어 원경 논밭을 가로지른다.

import * as THREE from "three";

import { CORE, UNITS_PER_METER } from "../plan/sitePlan";
import { EARTH_WALL_STYLE } from "./cliff";
import type { HeightAt } from "./ground";
import { PATH_STYLE } from "./slopePaths";

const RAMP_DESIGN = {
  // 시작은 코어 가장자리 — 안쪽에서 시작하면 이미 내려가는 코어 땅 위로 2 m 가까이 뜬다.
  start: [CORE.x[1], 12], // (80, 12)
  end: [CORE.x[1] + 23, 12], // (103, 12) — 마을길 들머리 (82, 12) 너머 들판
  width: 3.2, // 사람 둘이 지나갈 만큼
  shoulder: 1.4, // 길 밖으로 흘러내리는 어깨
  floorDepth: 0.18, // 길바닥을 주변보다 이만큼 파 넣어야 다져진 길로 읽힌다
} as const;

interface RampMeasurements {
  length: number;
  planLength: number;
  drop: number;
  slope: number;
  startY: number;
  endY: number;
}

export interface ConnectorRamp {
  geometry: THREE.BufferGeometry;
  /** 그 자리 길바닥 높이 — 판정이 쓴다 */
  heightAt: HeightAt;
  /** 길(갓길 포함) 안인가 */
  isOn: (x: number, z: number) => boolean;
  /** 계기판·문서에 그대로 쓴다 */
  measurements: RampMeasurements;
}

interface RampOptions {
  /** 무대 안쪽 지면 */
  coreHeightAt: HeightAt;
  /** 무대 밖 들판 높이 */
  outerHeightAt: HeightAt;
  cellsPerMeter?: number;
}

interface SectionPoint {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
}

export function buildConnectorRamp({ coreHeightAt, outerHeightAt, cellsPerMeter = 0.5 }: RampOptions): ConnectorRamp {
  const [x0, z0] = RAMP_DESIGN.start;
  const [x1, z1] = RAMP_DESIGN.end;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const planLength = Math.hypot(dx, dz);
  const ux = dx / planLength;
  const uz = dz / planLength;
  const nx = -uz; // 왼쪽 법선
  const nz = ux;

  const startY = coreHeightAt(x0, z0);
  const endY = outerHeightAt(x1, z1);
  const drop = startY - endY;
  const slope = (Math.atan2(drop, planLength) * 180) / Math.PI;

  // 양 끝에서 기울기 0 이라야 땅과 부드럽게 만난다. 직선으로 이으면 판자를 걸쳐 놓은 꼴이다.
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const centerY = (u: number) => startY - drop * smooth(THREE.MathUtils.clamp(u, 0, 1));

  const measure = (x: number, z: number) => {
    const px = x - x0;
    const pz = z - z0;
    const u = (px * ux + pz * uz) / planLength; // 0(시작) ~ 1(끝)
    const side = px * nx + pz * nz; // 중심선에서 옆으로 몇 m
    return { u, side };
  };
  const halfWidth = RAMP_DESIGN.width / 2;
  const isOn = (x: number, z: number) => {
    const { u, side } = measure(x, z);
    return u >= -0.02 && u <= 1.02 && Math.abs(side) <= halfWidth + RAMP_DESIGN.shoulder;
  };
  // 파 넣은 깊이는 양 끝에서 0 으로 뺀다 — 끝까지 파면 아랫자락이 들판 밑으로 들어가 덮인다
  const floorY = (u: number) => {
    const ending = Math.max(0, Math.min(1, Math.min(u, 1 - u) / 0.12));
    return centerY(u) - RAMP_DESIGN.floorDepth * ending;
  };
  const heightAt = (x: number, z: number) => {
    const { u, side } = measure(x, z);
    const y = floorY(u);
    const outside = Math.max(0, Math.abs(side) - halfWidth);
    if (outside <= 0) return y;
    // 갓길 — 길 밖으로 갈수록 주변 땅으로 녹아든다
    const t = THREE.MathUtils.clamp(outside / RAMP_DESIGN.shoulder, 0, 1);
    const around = u < 0.5 ? coreHeightAt(x, z) : outerHeightAt(x, z);
    return THREE.MathUtils.lerp(y, around, smooth(t));
  };

  // 지오메트리. 길이 가장자리에서 5 m 넘게 떠 있어 갓길만 달면 허공을 가로지르는 널판이다.
  // 진짜 산길처럼 안식각(33°)으로 흘러내리는 흙둑을 붙인다 — 높이차가 클수록 넓어진다.
  const restAngle = (33 * Math.PI) / 180;
  const restSlope = Math.tan(restAngle);
  const surroundingHeight = (x: number, z: number) =>
    x <= CORE.x[1] && x >= CORE.x[0] && z >= CORE.z[0] && z <= CORE.z[1] ? coreHeightAt(x, z) : outerHeightAt(x, z);

  // 흙 표면 흔들림 — 자로 잰 비탈은 콘크리트로 보인다
  const grain = (x: number, z: number) =>
    Math.sin(x * 0.7 + z * 0.4) * 0.5 +
    Math.sin(x * 1.9 - z * 1.3 + 2.1) * 0.28 +
    Math.sin(x * 3.7 + z * 2.9 + 4.4) * 0.14;

  const centerPoint = (u: number, side: number) => {
    const x = x0 + ux * planLength * u + nx * side;
    const z = z0 + uz * planLength * u + nz * side;
    return [x, z];
  };

  // 한 지점의 둑 폭 — 길 가장자리와 둘레 땅의 높이 차로 정한다
  const bankWidth = (u: number, sideSign: number) => {
    const [ex, ez] = centerPoint(u, halfWidth * sideSign);
    const roadY = floorY(u);
    const groundY = surroundingHeight(ex, ez);
    const w = Math.abs(roadY - groundY) / restSlope;
    return THREE.MathUtils.clamp(w, 0.9, 11);
  };

  const rows = Math.max(14, Math.round(planLength * cellsPerMeter));
  const bankSteps = [1, 0.62, 0.28, 0]; // 둑 바깥 → 길 가장자리
  const positions: number[] = [];
  const colors: number[] = [];
  const packed = new THREE.Color(PATH_STYLE.packed);
  const edge = new THREE.Color(PATH_STYLE.edge);
  const earthBright = new THREE.Color(EARTH_WALL_STYLE.bright);
  const earthDark = new THREE.Color(EARTH_WALL_STYLE.dark);
  const temp = new THREE.Color();

  const section = (i: number) => {
    const u = i / rows;
    const points: SectionPoint[] = [];
    const wL = bankWidth(u, -1);
    const wR = bankWidth(u, +1);
    const roadY = floorY(u);
    const add = (side: number) => {
      const [x, z] = centerPoint(u, side);
      let y: number;
      let color: THREE.Color;
      const outside = Math.abs(side) - halfWidth;
      if (outside <= 0) {
        // 길바닥 — 한복판이 다져지고 살짝 굼실거린다
        y = roadY + grain(x, z) * 0.035;
        const edgeShare = Math.abs(side) / halfWidth;
        color = temp
          .copy(packed)
          .lerp(edge, Math.pow(edgeShare, 1.7) * 0.8)
          .clone();
      } else {
        // 둑 비탈 — 오목하게 흘러내린다. 직선이면 각재를 덧댄 꼴이다.
        const w = side < 0 ? wL : wR;
        const t = THREE.MathUtils.clamp(outside / w, 0, 1);
        const groundY = surroundingHeight(x, z);
        const ease = 1 - Math.pow(1 - t, 2.1);
        y = THREE.MathUtils.lerp(roadY, groundY, ease) + grain(x, z) * 0.16 * (1 - t);
        // 비탈 한복판이 가장 어둡고 아래로 갈수록 땅빛
        color = temp
          .copy(earthDark)
          .lerp(earthBright, 0.35 + Math.pow(t, 0.8) * 0.55)
          .clone();
      }
      points.push({ x, y, z, color });
    };
    for (let k = 0; k < bankSteps.length; k++) add(-(halfWidth + wL * bankSteps[k]));
    add(0);
    for (let k = bankSteps.length - 1; k >= 0; k--) add(halfWidth + wR * bankSteps[k]);
    return points;
  };

  const push = (p: SectionPoint) => {
    positions.push(p.x * UNITS_PER_METER, p.y * UNITS_PER_METER, p.z * UNITS_PER_METER);
    colors.push(p.color.r, p.color.g, p.color.b);
  };

  let front = section(0);
  for (let i = 0; i < rows; i++) {
    const back = section(i + 1);
    for (let j = 0; j < front.length - 1; j++) {
      const a = front[j];
      const b = back[j];
      const c2 = front[j + 1];
      const d2 = back[j + 1];
      // a→b→c 로 감으면 법선이 전부 아래를 봐 해를 등지고 통째로 검게 나온다
      push(a);
      push(c2);
      push(b);
      push(b);
      push(c2);
      push(d2);
    }
    front = back;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return {
    geometry,
    heightAt,
    isOn,
    measurements: {
      length: Math.hypot(planLength, drop),
      planLength,
      drop,
      slope,
      startY,
      endY,
    },
  };
}
