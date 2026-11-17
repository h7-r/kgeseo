import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";

/** three 가 정렬에 넘기는 그리기 항목 가운데 여기서 보는 칸 */
interface RenderItem {
  id: number;
  groupOrder: number;
  renderOrder: number;
  z: number;
  material: { id: number };
  materialVariant?: number;
}

// 바라는 순서 — 거꾸로 깊이에서는 z 가 클수록 가깝다
function opaqueOrder(a: RenderItem, b: RenderItem) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.materialVariant !== b.materialVariant) return (a.materialVariant ?? 0) - (b.materialVariant ?? 0);
  if (a.z !== b.z) return b.z - a.z; // 가까운 것부터
  return a.id - b.id;
}
function transparentOrder(a: RenderItem, b: RenderItem) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return a.z - b.z; // 먼 것부터
  return a.id - b.id;
}

/**
 * Canvas 안에 둔다. 거꾸로 깊이(reversedDepthBuffer)일 때 그리는 순서와 면 밀기 방향을 바로잡는다.
 * three r185 는 거꾸로 깊이면 정렬한 목록을 통째로 뒤집는다(WebGLRenderList.sort) — z 순서를 맞추려는 것인데
 * renderOrder · groupOrder 까지 뒤집혀, 「먼저 그려라」(renderOrder −1)고 한 하늘돔이 맨 나중에 그려져 먼 산 · 구름 · 먼 강을
 * 덮었다(11/17 실측). 뒤집힌 뒤에 바라는 순서가 되도록 거꾸로 된 정렬을 넘긴다
 */
export function ReversedDepthSort() {
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    if (!gl.capabilities.reversedDepthBuffer) return undefined;
    gl.setOpaqueSort((a, b) => opaqueOrder(b as RenderItem, a as RenderItem));
    gl.setTransparentSort((a, b) => transparentOrder(b as RenderItem, a as RenderItem));
    // 면 밀기(polygonOffset)도 반만 뒤집힌다 — three 는 factor 만 뒤집고 units 는 그대로 넘겨, 앞으로 당기려던 데칼 · 덧옷이
    // 뒤로 밀린다(Codex 리뷰). three 가 재질을 걸 때 안쪽 함수를 바로 불러 state 를 감싸서는 안 걸린다 — WebGL 호출에서 뒤집는다
    const context = gl.getContext();
    const polygonOffset = context.polygonOffset;
    context.polygonOffset = (factor, units) => polygonOffset.call(context, factor, -units);
    return () => {
      context.polygonOffset = polygonOffset;
      gl.setOpaqueSort(null as unknown as Parameters<typeof gl.setOpaqueSort>[0]);
      gl.setTransparentSort(null as unknown as Parameters<typeof gl.setTransparentSort>[0]);
    };
  }, [gl]);
  return null;
}
