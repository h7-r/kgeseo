import { useMemo } from "react";

import MangaMaterials from "@/engine/manga/MangaMaterials";
import type { MangaStyle } from "@/engine/manga/useMangaStyle";

import { useMangaZones } from "./mangaZones";

/**
 * 만화 재질 층 — 구역(복도 전원 등 게임 상태)은 여기서만 구독한다.
 * App 에서 구독하면 복도에 불이 들어오는 순간 App 과 역 씬 전체가 다시 그려져 0.4초 멈췄다.
 */
export default function MangaScene({ manga }: { manga: MangaStyle }) {
  const zones = useMangaZones();
  const palette = useMemo(() => (manga.paletteOn ? { zones } : null), [manga.paletteOn, zones]);
  return <MangaMaterials hideShellLines={manga.hideShellLines} flatten={manga.flatten} palette={palette} />;
}
