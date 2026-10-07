import { useMemo } from "react";

import { outlineSchema, useSavedControls } from "@/engine/leva/savedControls";

/** 「증거물(공통)」 + 증거물 6개. 순서가 EVIDENCE_ITEMS 와 같다. */
export function useEvidenceControls() {
  const common = useSavedControls("증거물(공통)", {
    visible: { value: true, label: "보이기" },
    size: { value: 1.0, min: 0.3, max: 3, step: 0.01, label: "크기" },
    ...outlineSchema({ crease: true, creaseAngle: 40 }),
  });
  const envelope = useSavedControls("증거물1(봉투)", {
    x: { value: -13.5, min: -20, max: 20, step: 0.1 },
    z: { value: -6.7, min: -14, max: 14, step: 0.1 },
    height: { value: 2.06, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.34, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    thickness: { value: 0.01, min: 0.008, max: 0.12, step: 0.001, label: "두께" },
    size: { value: 1.0, min: 0.3, max: 2, step: 0.01, label: "크기" },
  });
  const tag2 = useSavedControls("증거물2(번호표)", {
    x: { value: -11.8, min: -20, max: 20, step: 0.1 },
    z: { value: 9.0, min: -14, max: 14, step: 0.1 },
    height: { value: 0.55, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -0.78, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  const box = useSavedControls("증거물3(상자)", {
    x: { value: -1.3, min: -20, max: 20, step: 0.1 },
    z: { value: -3.5, min: -14, max: 14, step: 0.1 },
    height: { value: 0.0, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -1.9, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  // 번호표 1·3 — 1번은 봉투 옆 책상 위, 3번은 캐비닛 위
  const tag1 = useSavedControls("증거물4(번호표1)", {
    x: { value: 0.6, min: -20, max: 20, step: 0.1 },
    z: { value: -1.6, min: -14, max: 14, step: 0.1 },
    height: { value: 2.06, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.83, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  const tag3 = useSavedControls("증거물5(번호표3)", {
    x: { value: -9.5, min: -20, max: 20, step: 0.1 },
    z: { value: 10.1, min: -14, max: 14, step: 0.1 },
    height: { value: 4.3, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: 0.61, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
  });
  // 증거물 상자와 별개 물건이다. 기본 자리는 상자 뚜껑 위.
  const collectionBox = useSavedControls("증거물6(수거품 상자)", {
    x: { value: -1.4, min: -20, max: 20, step: 0.01 },
    z: { value: -3.65, min: -14, max: 14, step: 0.01 },
    height: { value: 0.95, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: -1.5, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    width: { value: 1.19, min: 0.2, max: 2.5, step: 0.01, label: "가로" },
    depth: { value: 0.78, min: 0.2, max: 2.5, step: 0.01, label: "세로" },
    boxHeight: { value: 0.83, min: 0.15, max: 2.0, step: 0.01, label: "상자높이" },
  });
  const items = useMemo(
    () => [envelope, tag2, box, tag1, tag3, collectionBox] as const,
    [envelope, tag2, box, tag1, tag3, collectionBox],
  );
  return { common, items };
}

export type EvidenceControls = ReturnType<typeof useEvidenceControls>;
/** 증거물 한 개의 자리. 봉투·수거품 상자만 칸이 더 있다. */
export type EvidencePose = EvidenceControls["items"][number];
