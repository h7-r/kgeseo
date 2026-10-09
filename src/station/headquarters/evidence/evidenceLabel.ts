import type * as THREE from "three";

import { drawGrain, makeCachedCanvasTexture } from "@/engine/textures/canvas";

/** 사건번호 라벨 텍스처. 사건번호가 찍히는 순간 상자가 증거가 된다. */
export function makeEvidenceLabelTexture(
  key: string,
  draw: (g: CanvasRenderingContext2D, width: number, height: number) => void,
  width = 256,
  height = 160,
): THREE.CanvasTexture {
  return makeCachedCanvasTexture(
    `label|${key}`,
    (g, w, h) => {
      draw(g, w, h);
      // 인쇄물처럼 너무 깨끗하지 않게 — 열쇠로 시드를 만들어 늘 같은 얼룩이 나온다.
      let seed = 0;
      for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 99991;
      drawGrain(g, w, h, seed + 1, 0.9);
    },
    { width, height, anisotropy: null },
  );
}
