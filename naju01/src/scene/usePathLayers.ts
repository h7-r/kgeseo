import { useEffect, useMemo } from "react";

import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";

import type { PresentedControls } from "../app/presentation";
import { CORE, SHOULDER_DEFAULTS, UNITS_PER_METER } from "../plan/sitePlan";
import { createNoise } from "../terrain/ground";
import { buildSlopePath, computeRoadsideStoneSpots } from "../terrain/slopePaths";
import { computeFenceSpots } from "../world/fences";
import { computeHillBushSpots, computeRoadsideBushSpots } from "../world/vegetation";
import type { PlanPoint } from "./components/planPoint";
import type { GroundShapes, Terrain } from "./useTerrainLayers";

const U = UNITS_PER_METER;

export type PathShapes = ReturnType<typeof usePathShapes>;
export type PathFallback = ReturnType<typeof usePathFallback>;

/** 통로 T1~T4 — 걷는 폭은 도면 그대로, 갓길·비탈은 그 바깥으로만 낸다. */
export function usePathShapes(controls: PresentedControls, terrain: Terrain, ground: GroundShapes) {
  const pathShapes = useMemo(() => {
    if (!controls.pathDetail) return null;
    const noise = createNoise(133707);
    // 비탈 발치가 닿을 땅 — 구역 고도(평평한 값)를 쓰면 요철 자리에서 비탈 끝이 뜨거나 묻힌다.
    const heightAt = (x: number, z: number) => ground.surface.heightAt(x, z);
    const built = terrain.measuredPaths.map((path) =>
      buildSlopePath({
        path,
        shoulderWidth: controls.shoulderWidth,
        shoulderDrop: controls.shoulderDrop,
        // 절벽과 같은 손잡이를 넘긴다 — 한 공간의 재질로 보이려면 함께 움직여야 한다.
        slopeCarveDepth: controls.slopeCarveDepth,
        strataThickness: controls.strataThickness * 0.65, // 흙비탈은 지층이 더 촘촘하다
        angularity: controls.angularity,
        noise,
        heightAt,
        // 비탈 치마가 다른 길을 덮지 않게 한다. 코드로 가르면 안 된다 — T4 스위치백은 위·아래 다리가 같은 T4 다.
        otherPathAt: (x, z) => {
          const sample = terrain.groundAt(x, z);
          return !!sample?.path && !sample.isShoulder;
        },
      }),
    );
    return {
      built,
      // 절벽과 같은 돌을 비탈에 흩어 두 재질이 서로 물려 들어가게 한다
      slopeRockSpots: controls.slopeDecor ? built.flatMap((v) => v.decor.rocks) : [],
      // 비탈 옆면은 기둥 없는 잎더미 자리 — 비스듬한 면에 기둥을 세우면 막대가 튀어나온다
      slopeShrubSpots: controls.slopeDecor ? built.flatMap((v) => v.decor.bushes) : [],
      // T1 「바위틈」 — 길 양옆의 큰 바위
      crevasseRockSpots: built.flatMap((v) => v.decor.crevasseRocks),
      // 지오메트리가 아니라 자리 — 길 위의 돌 하나를 집어 치울 수 있어야 한다
      stoneSpots: computeRoadsideStoneSpots({
        lines: built.map((v, i) => ({ centerline: v.centerline, halfWidth: terrain.measuredPaths[i].width / 2 })),
        density: controls.roadsideStones,
        seed: 90211,
        shoulderWidth: controls.shoulderWidth,
        heightAt,
      }),
    };
  }, [
    terrain,
    ground,
    controls.pathDetail,
    controls.shoulderWidth,
    controls.shoulderDrop,
    controls.slopeCarveDepth,
    controls.strataThickness,
    controls.angularity,
    controls.roadsideStones,
    controls.slopeDecor,
  ]);
  useEffect(
    () => () => {
      pathShapes?.built.forEach((v) => {
        v.path?.dispose();
        v.slope?.dispose();
      });
    },
    [pathShapes],
  );
  return pathShapes;
}

/** 길가 자리 — 낭떠러지 쪽 울타리, 길 양옆 수풀, 언덕 수풀. 전부 자리만 내고 인스턴스 무리가 심는다. */
export function useRoadsideSpots(controls: PresentedControls, terrain: Terrain, ground: GroundShapes) {
  const { measuredPaths } = terrain;
  // 울타리는 낙차를 재서 세운다. 막지는 않는다(헛디디면 떨어지는 것이 이 공간의 사건이다).
  const fences = useMemo(() => {
    if (!controls.fences || !ground?.surface) return null;
    return computeFenceSpots({
      measuredPaths,
      heightAt: (x, z) => ground.surface.heightAt(x, z),
      minDrop: controls.fenceMinDrop,
    });
  }, [controls.fences, controls.fenceMinDrop, measuredPaths, ground]);

  // 실제 산길은 양옆이 가장 빽빽하다.
  const roadside = useMemo(() => {
    if (!controls.roadsideBushes) return null;
    return computeRoadsideBushSpots({
      measuredPaths: terrain.measuredPaths,
      surface: ground.surface,
      terrain,
      shoulderEdge: SHOULDER_DEFAULTS.reach * controls.shoulderWidth,
      margin: controls.roadsideMargin,
      band: controls.roadsideBand,
      spacing: controls.roadsideDensity,
    });
  }, [
    terrain,
    ground,
    controls.roadsideBushes,
    controls.roadsideMargin,
    controls.roadsideBand,
    controls.roadsideDensity,
    controls.shoulderWidth,
  ]);

  const hill = useMemo(() => {
    if (!controls.hillVegetation) return null;
    const noise = createNoise(818221);
    return computeHillBushSpots({
      terrain,
      surface: ground.surface,
      core: CORE,
      treeCount: controls.hillTreeCount,
      shrubCount: controls.hillShrubCount,
      noise,
    });
  }, [terrain, ground, controls.hillVegetation, controls.hillTreeCount, controls.hillShrubCount]);

  return { fences, roadside, hill };
}

/** 길디테일을 껐을 때의 통로 — 조각난 리본과 그 밑을 받치는 흙더미. */
export function usePathFallback(measuredPaths: Terrain["measuredPaths"]) {
  const pathSegments = useMemo(
    () =>
      measuredPaths.flatMap((t) =>
        t.segments.map((s, i) => {
          const elevationAt = (distance: number) => t.startElevation + t.rise * (distance / t.planarLength);
          return {
            key: `${t.code}-${i}`,
            a: [s.x1, s.z1, elevationAt(s.startDistance)] as PlanPoint,
            b: [s.x2, s.z2, elevationAt(s.startDistance + s.length)] as PlanPoint,
            width: t.width,
          };
        }),
      ),
    [measuredPaths],
  );

  // 1.5 m 마다 상자를 세워 하나로 합친다(드로우콜 1).
  const embankment = useMemo(() => {
    const boxes: BoxPiece[] = [];
    for (const t of measuredPaths) {
      if (t.rise === 0) continue; // 평지 통로(T1)는 받칠 것이 없다
      for (const s of t.segments) {
        const n = Math.max(1, Math.round(s.length / 1.5));
        const angle = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const arc = s.startDistance + (s.length * (i + 0.5)) / n;
          const y = t.startElevation + t.rise * (arc / t.planarLength) - 0.3; // 길 판 아래까지만
          if (y < 0.4) continue;
          boxes.push({
            size: [(t.width + 1.2) * U, y * U, (s.length / n + 0.15) * U],
            position: [(s.x1 + (s.x2 - s.x1) * f) * U, (y / 2) * U, (s.z1 + (s.z2 - s.z1) * f) * U],
            rotation: [0, angle, 0],
          });
        }
      }
    }
    return buildMergedBoxes(boxes);
  }, [measuredPaths]);
  useEffect(() => () => embankment?.dispose(), [embankment]);

  return { pathSegments, embankment };
}
