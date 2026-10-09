import { useMemo } from "react";

import { buildOutlineSchema, useSavedControls } from "@/engine/leva/savedControls";
import { DESK_SPOTS, type DeskSpot } from "@/station/headquarters/deskLayout";

// 수사본부실 가구 — 책상·의자·캐비닛·옷걸이와 모자·게시판 둘.

/** 「책상(공통)」 — 책상 다섯 개에 함께 쓰는 크기·바닥 높이·선. */
export function useDeskCommonControls() {
  return useSavedControls("책상(공통)", {
    size: { value: 2.2, min: 0.5, max: 5, step: 0.05, label: "크기" },
    lift: { value: -0.3, min: -2, max: 2, step: 0.02, label: "높이미세" },
    ...buildOutlineSchema({ crease: true, creaseAngle: 50 }),
  });
}

// 책상마다 폴더 하나. 기본값은 DESK_SPOTS(「★ 책상값 출력」으로 뽑아 고정한 값).
function deskSchema([x, z, rotation, width, depth, height]: DeskSpot) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    width: { value: width, min: 0.5, max: 3, step: 0.05, label: "가로길이" },
    depth: { value: depth, min: 0.5, max: 3, step: 0.05, label: "세로길이" },
    height: { value: height, min: 0.5, max: 2, step: 0.05, label: "높이" },
  };
}

/** 「책상1(빨강)」~「책상5(보라)」 */
export function useDeskControls() {
  const desk1 = useSavedControls("책상1(빨강)", deskSchema(DESK_SPOTS[0]));
  const desk2 = useSavedControls("책상2(파랑)", deskSchema(DESK_SPOTS[1]));
  const desk3 = useSavedControls("책상3(초록)", deskSchema(DESK_SPOTS[2]));
  const desk4 = useSavedControls("책상4(노랑)", deskSchema(DESK_SPOTS[3]));
  const desk5 = useSavedControls("책상5(보라)", deskSchema(DESK_SPOTS[4]));
  return useMemo(() => [desk1, desk2, desk3, desk4, desk5], [desk1, desk2, desk3, desk4, desk5]);
}

// 의자마다 폴더 하나.
function chairSchema(x: number, z: number, rotation: number) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    sizeMul: { value: 1.0, min: 0.2, max: 4, step: 0.01, label: "개별크기" },
  };
}

/** 「의자(공통·색)」·「의자 끌기」·「의자1~5」. 왼쪽 자리에 셋, 오른쪽에 둘. */
export function useChairControls() {
  const common = useSavedControls("의자(공통·색)", {
    size: { value: 1.03, min: 0.2, max: 3, step: 0.01, label: "크기" },
    color: { value: "#363b46", label: "색" },
    collidable: { value: true, label: "충돌" },
    ...buildOutlineSchema({ width: 2.0, color: "#1a1614", crease: true, creaseAngle: 65 }),
  });
  // 기본값은 보정 없이 끄는 상태다.
  const drag = useSavedControls("의자 끌기", {
    distance: { value: 1.55, min: 0.8, max: 3.2, step: 0.01, label: "거리" },
    followBody: { value: false, label: "몸기준" },
    slack: { value: 0, min: 0, max: 1.5, step: 0.01, label: "느슨함" },
  });
  const chair1 = useSavedControls("의자1(노트북2 앞)", chairSchema(-7.2, -2.5, -1.3));
  const chair2 = useSavedControls("의자2(노트북3 앞)", chairSchema(-14.3, -1.9, 1.98));
  const chair3 = useSavedControls("의자3(컴퓨터1 앞)", chairSchema(-9.5, -9.7, 0.41));
  const chair4 = useSavedControls("의자4(노트북1 앞)", chairSchema(1.7, -5.1, -0.1));
  const chair5 = useSavedControls("의자5(컴퓨터3 앞)", chairSchema(4.3, -6.0, 0.82));
  const chairs = useMemo(() => [chair1, chair2, chair3, chair4, chair5], [chair1, chair2, chair3, chair4, chair5]);
  return { common, drag, chairs };
}

// 캐비닛마다 폴더 하나. 셋 다 뒷벽을 등지고 선다.
function cabinetSchema(x: number, z: number, seed: number) {
  return {
    x: { value: x, min: -20, max: 20, step: 0.1 },
    z: { value: z, min: -14, max: 14, step: 0.1 },
    rotation: { value: 3.14, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    seed: { value: seed, min: 1, max: 9999, step: 1, label: "시드" },
  };
}

/** 「캐비닛(공통)」 + 「캐비닛1~3」. 색·크기는 공통, 시드만 달라 얼룩·찌그러짐이 서로 다르다. */
export function useCabinetControls() {
  const common = useSavedControls("캐비닛(공통)", {
    visible: { value: true, label: "보이기" },
    color: { value: "#4d5460", label: "색" },
    height: { value: 4.3, min: 2, max: 8, step: 0.05, label: "높이" },
    dentCount: { value: 4, min: 0, max: 12, step: 1, label: "찌그러짐" },
    dentDepth: { value: 0.016, min: 0, max: 0.026, step: 0.001, label: "깊이" },
    stainCount: { value: 10, min: 0, max: 24, step: 1, label: "얼룩" },
    stainStrength: { value: 0.0, min: 0, max: 2, step: 0.05, label: "얼룩세기" },
    showLines: { value: true, label: "선보이기" },
    lineColor: { value: "#000000", label: "선색" },
    drawersOpen: { value: true, label: "서랍열기" },
    slightOpen: { value: 0.12, min: 0, max: 0.25, step: 0.005, label: "살짝열림" },
    wideOpen: { value: 0.14, min: 0, max: 0.25, step: 0.005, label: "많이열림" },
    showPapers: { value: true, label: "서류보이기" },
    drawerWear: { value: 1.0, min: 0, max: 2, step: 0.05, label: "서랍낡음" },
    ...buildOutlineSchema({ crease: true, creaseAngle: 40 }),
  });
  const cabinet1 = useSavedControls("캐비닛1", cabinetSchema(-11.6, 10.2, 6511));
  const cabinet2 = useSavedControls("캐비닛2", cabinetSchema(-10.0, 10.2, 6145));
  const cabinet3 = useSavedControls("캐비닛3", cabinetSchema(-8.4, 10.2, 4022));
  const cabinets = useMemo(() => [cabinet1, cabinet2, cabinet3], [cabinet1, cabinet2, cabinet3]);
  return { common, cabinets };
}

/** 「옷걸이(공통)」·「옷걸이1」·「모자(공통·선)」·「모자1(옷걸이)」·「옷걸이2」 — 패널 순서 그대로. */
export function useCoatRackControls() {
  const common = useSavedControls("옷걸이(공통)", {
    visible: { value: true, label: "보이기" },
    standColor: { value: "#33373c", label: "스탠드색" },
    standHeight: { value: 4.3, min: 3, max: 9, step: 0.05, label: "스탠드높이" },
    ...buildOutlineSchema({ crease: true, creaseAngle: 45 }),
  });
  const rack1 = useSavedControls("옷걸이1", {
    x: { value: -18.5, min: -20, max: 20, step: 0.1 },
    z: { value: -12.3, min: -14, max: 14, step: 0.1 },
    rotation: { value: -1.78, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    coatColor: { value: "#4e3d22", label: "옷색" },
    mirrored: { value: true, label: "좌우반전" },
  });
  // 선은 모자 공통 폴더에 둔다 — 모자가 늘어도 같이 쓴다
  const hatOutline = useSavedControls("모자(공통·선)", {
    ...buildOutlineSchema({ width: 3.0, color: "#312922", crease: true, creaseAngle: 30 }),
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

/** 「증거 핀보드」·「화이트보드」 */
export function useBoardControls() {
  const pinBoard = useSavedControls("증거 핀보드", {
    x: { value: 1.6, min: -20, max: 20, step: 0.1 },
    z: { value: 3.2, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: -2.9, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    size: { value: 1.08, min: 0.3, max: 3, step: 0.01, label: "크기" },
    frameColor: { value: "#2B3137", label: "테두리색" },
    ...buildOutlineSchema({ crease: true, creaseAngle: 15 }),
  });
  const whiteboard = useSavedControls("화이트보드", {
    x: { value: -3.6, min: -20, max: 20, step: 0.1 },
    z: { value: 4.1, min: -14, max: 14, step: 0.1 },
    height: { value: 0, min: -1, max: 4, step: 0.01, label: "높이" },
    rotation: { value: -2.98, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    size: { value: 1.1, min: 0.3, max: 3, step: 0.01, label: "크기" },
    frameColor: { value: "#2B3137", label: "테두리색" },
    ...buildOutlineSchema({ crease: false }),
  });
  return { pinBoard, whiteboard };
}

export type DeskCommonValues = ReturnType<typeof useDeskCommonControls>;
export type DeskValues = ReturnType<typeof useDeskControls>[number];
export type ChairControlValues = ReturnType<typeof useChairControls>;
export type CabinetControlValues = ReturnType<typeof useCabinetControls>;
export type CabinetCommonValues = CabinetControlValues["common"];
export type CabinetValues = CabinetControlValues["cabinets"][number];
export type CoatRackControlValues = ReturnType<typeof useCoatRackControls>;
export type HatValues = CoatRackControlValues["hat"];
export type BoardControlValues = ReturnType<typeof useBoardControls>;
