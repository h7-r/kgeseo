import { useMemo } from "react";

import type { PaletteZone } from "@/engine/manga/MangaMaterials";
import { useHasFullPower } from "@/props/workLampPuzzle/workLampState";

/**
 * 만화 팔레트를 입힐 구역 — StationScene·TrainInteriorScene 의 그룹 이름.
 * 복도는 완전 전원 뒤에만 칠하고 밝은 조를 켠다 — 그 전의 어둠은 퍼즐이다. 복도는 색·꼭짓점 색에 깊이 어둠이 구워져 있다.
 */
export function useMangaZones(): readonly PaletteZone[] {
  const isCorridorLit = useHasFullPower();
  return useMemo(
    () => [
      { name: "headquarters", lit: true },
      { name: "platform", lit: true },
      { name: "backdrop", lit: true },
      { name: "trainInterior", lit: true },
      { name: "corridor", lit: isCorridorLit, bakedDepth: true, tone: 0.85 },
    ],
    [isCorridorLit],
  );
}
