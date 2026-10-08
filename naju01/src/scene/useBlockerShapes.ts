import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { makeRandom } from "@/engine/random";

import type { PresentedControls } from "../app/presentation";
import { buildBoulders } from "../terrain/cliff";
import { createNoise } from "../terrain/ground";
import { treeBeltSpots } from "../world/vegetation";
import { zoneOf, type GroundLayer, type Terrain } from "./useTerrainLayers";

export type BlockerShapes = ReturnType<typeof useBlockerShapes>;

/**
 * 차단물 조형 — 막는 부피는 그대로 두고 겉모습만 바꾼다. 바위는 안쪽으로만 파야 보이는 것과 막히는 것이 안 어긋난다.
 * 높이 있는 구역의 옆구리 바위와 발치 너덜 자리도 여기서 같이 낸다.
 */
export function useBlockerShapes(T: PresentedControls, terrain: Terrain, ground: GroundLayer) {
  const blockerShapes = useMemo(() => {
    if (!T.blockerDetail) return null;
    const grainNoise = createNoise(884412);
    const strataNoise = createNoise(220719);
    const rock = (
      x: [number, number],
      z: [number, number],
      foot: number,
      top: number | ((x: number, z: number) => number),
    ) =>
      buildBoulders({
        x,
        z,
        foot,
        top,
        cellsPerMeter: T.rockCellsPerMeter,
        carveDepth: T.rockCarveDepth,
        angularity: T.angularity,
        strataThickness: T.strataThickness * 0.5, // 작은 덩어리라 지층도 촘촘해야 어울린다
        grainNoise,
        strataNoise,
        patternScale: T.rockPatternScale,
      });
    // Z3(+14)와 Z4(+8) 사이 골은 비스듬한 능선으로 본다(도면에 고도가 없어 내린 해석 — 팀 확인 필요).
    // 평평한 +14 벽이면 V3 의 주 차단 장치인 수목대가 눈높이 위로 올라가 구실을 못 한다.
    const z3Elevation = zoneOf(terrain, "Z3").elevation;
    const z4Elevation = zoneOf(terrain, "Z4").elevation;
    const ridgeTop = (x: number) =>
      THREE.MathUtils.lerp(z3Elevation, z4Elevation, THREE.MathUtils.clamp((x - 58) / 4, 0, 1));

    const pieces = terrain.blockers.map((b, i) => {
      const foot = b.foot ?? 0;
      const isInHollow = !!b.floorZone; // 빈 골에 선 것(B2 · 수목대)
      const isTreeBelt = b.code === "수목대";
      const top = isInHollow ? (x: number) => ridgeTop(x) + (isTreeBelt ? 0 : b.height) : b.floor + b.height;
      const topY = isInHollow ? ridgeTop((b.x[0] + b.x[1]) / 2) + b.height : (top as number);
      return {
        code: b.code,
        name: b.name,
        role: b.role,
        clearing: b.clearing ?? null,
        top: topY,
        // 무너뜨릴 때 내려야 하는 실제 키. 골에 선 것은 발이 0 인데 머리가 18 m 라 height 로는 14 m 가 남는다.
        actualHeight: topY - foot,
        center: [(b.x[0] + b.x[1]) / 2, (b.z[0] + b.z[1]) / 2] as [number, number],
        // 수목대는 '능선 바위 + 그 위의 나무', 나머지는 통짜 바위 덩이
        rock: rock(b.x, b.z, foot, top),
        // 나무는 자리만 낸다 — 심는 것은 인스턴스 무리다(편집기가 고를 수 있다).
        treeSpots: isTreeBelt
          ? treeBeltSpots({
              x: b.x,
              z: b.z,
              ground: ridgeTop,
              height: b.height,
              count: T.treeCount,
              seed: 5511 + i,
            })
          : null,
      };
    });

    // 높이 있는 구역(Z3·Z4)의 옆구리도 같은 바위로 세운다. 윗면은 땅 표면 그대로 조회하되,
    // 걷는 길 위에서는 노면 아래로 누른다 — 지표가 지면보다 높은 자리에서 바위가 노면 위로 솟았다.
    const zoneRocks = terrain.zones
      .filter((z) => z.elevation > 0)
      .map((z) => ({
        code: z.code,
        geometry: rock(z.x, z.z, -0.5, (x, zz) => {
          const surfaceY = ground.surface.heightAt(x, zz) - 0.02;
          const sample = terrain.groundAt(x, zz);
          return sample?.path && !sample.isShoulder ? Math.min(surfaceY, sample.y - 0.75) : surfaceY;
        }),
      }));

    // 발치 너덜 — 덩어리와 바닥이 만나는 선이 곧으면 얹어 놓은 것으로 보인다. 떨어져 나온 돌이 쌓여야 땅에서 솟은 것이 된다.
    const footScreeSpots: { x: number; z: number; y: number; size: number }[] = [];
    const scatterAround = (X: [number, number], Z: [number, number], floor: number, count: number, seed: number) => {
      const random = makeRandom(seed >>> 0);
      const w = X[1] - X[0];
      const d = Z[1] - Z[0];
      const perimeter = 2 * (w + d);
      for (let i = 0; i < count; i++) {
        let p = random() * perimeter;
        let x: number;
        let z: number;
        if (p < w) {
          x = X[0] + p;
          z = Z[0];
        } else if ((p -= w) < d) {
          x = X[1];
          z = Z[0] + p;
        } else if ((p -= d) < w) {
          x = X[1] - p;
          z = Z[1];
        } else {
          x = X[0];
          z = Z[1] - (p - w);
        }
        const out = 0.15 + random() * 1.1;
        const angle = random() * Math.PI * 2;
        // 대부분 잔돌, 가끔 큰 바위 — 크기가 중간에 몰리면 복사해 둔 돌로 보인다.
        const isBig = random() < 0.08;
        footScreeSpots.push({
          x: x + Math.cos(angle) * out,
          z: z + Math.sin(angle) * out,
          y: floor,
          size: isBig ? 1.4 + random() * 2.1 : 0.15 + Math.pow(random(), 2.6) * 1.0,
        });
      }
    };
    for (const b of terrain.blockers) scatterAround(b.x, b.z, b.foot ?? 0, 26, 4001 + b.code.length * 37);
    for (const z of terrain.zones) if (z.elevation > 0) scatterAround(z.x, z.z, 0, 90, 9001 + z.elevation * 13);

    return { pieces, zoneRocks, footScreeSpots };
  }, [
    terrain,
    T.blockerDetail,
    T.rockCellsPerMeter,
    T.rockCarveDepth,
    T.rockPatternScale,
    ground.surface,
    T.angularity,
    T.strataThickness,
    T.treeCount,
  ]);
  useEffect(
    () => () => {
      blockerShapes?.pieces.forEach((b) => b.rock?.dispose());
      blockerShapes?.zoneRocks.forEach((z) => z.geometry?.dispose());
    },
    [blockerShapes],
  );
  return blockerShapes;
}
