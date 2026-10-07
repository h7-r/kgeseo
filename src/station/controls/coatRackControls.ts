import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/** 「옷걸이(공통)」·「옷걸이1」·「모자(공통·선)」·「모자1(옷걸이)」·「옷걸이2」 — 패널 순서 그대로. */
export function useCoatRackControls() {
  const common = useSavedControls("옷걸이(공통)", {
    visible: { value: true, label: "보이기" },
    standColor: { value: "#33373c", label: "스탠드색" },
    standHeight: { value: 4.3, min: 3, max: 9, step: 0.05, label: "스탠드높이" },
    ...outlineSchema({ crease: true, creaseAngle: 45 }),
  });
  const rack1 = useSavedControls("옷걸이1", {
    x: { value: -18.5, min: -20, max: 20, step: 0.1 },
    z: { value: -12.3, min: -14, max: 14, step: 0.1 },
    rotation: { value: -1.78, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    coatColor: { value: "#4e3d22", label: "옷색" },
    mirrored: { value: true, label: "좌우반전" },
  });
  // 모자가 늘어나도 같이 쓰도록 선은 공통 폴더로 뺐다
  const hatOutline = useSavedControls("모자(공통·선)", {
    ...outlineSchema({ width: 3.0, color: "#312922", crease: true, creaseAngle: 30 }),
  });
  const hat = useSavedControls("모자1(옷걸이)", {
    visible: { value: true, label: "보이기" },
    x: { value: -0.8, min: -20, max: 20, step: 0.05 },
    z: { value: -12.5, min: -14, max: 14, step: 0.05 },
    height: { value: 3.32, min: 0, max: 8, step: 0.02, label: "높이" },
    rotation: { value: -1.78, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    tilt: { value: 1.15, min: -1.8, max: 1.8, step: 0.01, label: "기울기" },
    size: { value: 1.0, min: 0.3, max: 2.5, step: 0.01, label: "크기" },
    color: { value: "#4e4838", label: "색" },
  });
  const rack2 = useSavedControls("옷걸이2", {
    x: { value: -0.5, min: -20, max: 20, step: 0.1 },
    z: { value: -12.5, min: -14, max: 14, step: 0.1 },
    rotation: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    coatColor: { value: "#4e4838", label: "옷색" },
    mirrored: { value: false, label: "좌우반전" },
  });
  return { common, rack1, hatOutline, hat, rack2 };
}

export type CoatRackControls = ReturnType<typeof useCoatRackControls>;
export type HatValues = CoatRackControls["hat"];
