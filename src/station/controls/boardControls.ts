import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/** 「증거 핀보드」·「화이트보드」 */
export function useBoardControls() {
  const pinBoard = useSavedControls("증거 핀보드", {
    x: { value: 1.6, min: -20, max: 20, step: 0.1 },
    z: { value: 3.2, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: -2.9, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    size: { value: 1.08, min: 0.3, max: 3, step: 0.01, label: "크기" },
    frameColor: { value: "#2B3137", label: "테두리색" },
    ...outlineSchema({ crease: true, creaseAngle: 15 }),
  });
  const whiteboard = useSavedControls("화이트보드", {
    x: { value: -3.6, min: -20, max: 20, step: 0.1 },
    z: { value: 4.1, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: -2.98, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    size: { value: 1.1, min: 0.3, max: 3, step: 0.01, label: "크기" },
    frameColor: { value: "#2B3137", label: "테두리색" },
    ...outlineSchema({ crease: false }),
  });
  return { pinBoard, whiteboard };
}

export type BoardControls = ReturnType<typeof useBoardControls>;
