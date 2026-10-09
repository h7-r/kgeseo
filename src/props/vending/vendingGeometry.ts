import * as THREE from "three";

import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";

/** 상자가 하나 이상이면 buildMergedBoxes 는 늘 지오를 돌려준다. */
export function buildMergedBoxGeometry(boxes: BoxPiece[]): THREE.BufferGeometry {
  const geometry = buildMergedBoxes(boxes);
  if (!geometry) throw new Error("합칠 상자가 없습니다.");
  return geometry;
}

// 몸통과 뒤판이 같은 값을 써야 한다. 다르면 틈이 비치거나 같은 평면에서 다시 겹친다.
const BACK_PANEL_THICKNESS = 0.18;

interface BodySize {
  width: number;
  height: number;
  depth: number;
}

/**
 * 두 자판기가 같이 쓰는 몸통 껍데기(드로우콜 1).
 * 좌·우·위·아래 판은 뒤판 두께만큼 짧다 — 뒤끝까지 차지하면 다섯 면이 한 평면에 겹쳐 뒤 모서리가 지글거린다.
 */
export function buildVendingBodyGeometry({ width, height, depth, trim }: BodySize & { trim: number }) {
  const halfDepth = depth / 2;
  const innerDepth = Math.max(0.1, depth - BACK_PANEL_THICKNESS);
  const innerCenter = BACK_PANEL_THICKNESS / 2;
  return buildMergedBoxGeometry([
    { size: [0.2, height, innerDepth], position: [-width / 2 + 0.1, height / 2, innerCenter] },
    { size: [0.2, height, innerDepth], position: [width / 2 - 0.1, height / 2, innerCenter] },
    { size: [width, 0.22, innerDepth], position: [0, height - 0.11, innerCenter] },
    { size: [width, 0.3, innerDepth], position: [0, 0.15, innerCenter] },
    { size: [width, trim, 0.16], position: [0, height - trim / 2, halfDepth - 0.08] },
    { size: [trim, height, 0.16], position: [-width / 2 + trim / 2, height / 2, halfDepth - 0.08] },
    { size: [trim, height, 0.16], position: [width / 2 - trim / 2, height / 2, halfDepth - 0.08] },
    { size: [width, trim, 0.16], position: [0, trim / 2, halfDepth - 0.08] },
  ]);
}

/**
 * 벽을 등진 뒤판. 벽 너머에서 보이므로 색을 따로 준다.
 * 폭·높이를 0.01 씩 들인다 — 몸통 면과 같은 평면을 공유하면 비스듬히 볼 때 띠가 깨진다.
 */
export function buildBackPanelGeometry({ width, height, depth }: BodySize) {
  const inset = 0.01;
  return buildMergedBoxGeometry([
    {
      size: [width - inset * 2, height - inset * 2, BACK_PANEL_THICKNESS],
      position: [0, height / 2, -depth / 2 + 0.09],
    },
  ]);
}
