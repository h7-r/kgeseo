import { useMemo } from "react";

import { buildOutlineSchema, pickOutlineValues, useSavedControls } from "@/engine/leva/savedControls";
import { PAPER_STYLES } from "@/station/headquarters/paper";

interface PaperDefaults {
  x: number;
  z: number;
  rotation: number;
  size?: number;
  height?: number;
  fitToDesk?: boolean;
  sheets: number;
  spread: number;
  slide: number;
  lean: number;
  thickness?: number;
  seed: number;
  paperColor?: string;
  folderColor?: string;
  clipCount?: number;
  stickyCount?: number;
  printed?: boolean;
  printedFolder?: boolean;
  textStyle?: string;
}

// 더미마다 폴더 하나. 슬라이더 목록이 같아 값만 갈아 끼운다.
function paperSchema(d: PaperDefaults) {
  return {
    x: { value: d.x, min: -20, max: 20, step: 0.1 },
    z: { value: d.z, min: -14, max: 14, step: 0.1 },
    // 켜 두면 아래 높이를 무시하고 책상 윗면을 따라간다. 끄면 높이를 손으로 맞춘다.
    fitToDesk: { value: d.fitToDesk ?? true, label: "책상에맞추기" },
    height: { value: d.height ?? 2.05, min: 0, max: 6, step: 0.01, label: "높이" },
    rotation: { value: d.rotation, min: -Math.PI, max: Math.PI, step: 0.01, label: "회전" },
    size: { value: d.size ?? 1, min: 0.3, max: 3, step: 0.01, label: "크기" },
    sheets: { value: d.sheets, min: 1, max: 60, step: 1, label: "낱장수" },
    spread: { value: d.spread, min: 0, max: 1.6, step: 0.01, label: "흐트러짐" },
    slide: { value: d.slide, min: 0, max: 0.8, step: 0.01, label: "밀림" },
    lean: { value: d.lean, min: 0, max: 2, step: 0.01, label: "무너짐" },
    thickness: { value: d.thickness ?? 0.014, min: 0.002, max: 0.06, step: 0.0005, label: "한장두께" },
    seed: { value: d.seed, min: 1, max: 200, step: 1, label: "씨드" },
    paperColor: { value: d.paperColor ?? "#EFEDE4", label: "종이색" },
    folderColor: { value: d.folderColor ?? "#D6C49B", label: "봉투색" },
    clipCount: { value: d.clipCount ?? 1, min: 0, max: 4, step: 1, label: "집게수" },
    stickyCount: { value: d.stickyCount ?? 0, min: 0, max: 5, step: 1, label: "포스트잇수" },
    printed: { value: d.printed ?? false, label: "글자표시" },
    printedFolder: { value: d.printedFolder ?? false, label: "봉투글자" },
    // 선택지 값이 저장 데이터라 한글 그대로 둔다
    textStyle: { value: d.textStyle ?? "섞기", options: PAPER_STYLES, label: "글씨종류" },
  };
}

/**
 * 「서류(공통·선)」·「서류(공통·색)」·「서류1~6, 8」(7번은 없다).
 * 색 밝기는 쓸 때 한 번 눌러 주는 배수 — 순백 낱장이 조명에 날아가는데, 일곱 폴더 색을 직접 고치면 저장값이 코드를 이긴다.
 */
export function usePaperControls() {
  // 종이는 선이 굵으면 금방 지저분해져 얇고 연하게 잡았다
  const outline = pickOutlineValues(
    useSavedControls(
      "서류(공통·선)",
      buildOutlineSchema({ width: 1.5, color: "#000000", crease: true, creaseAngle: 40 }),
    ),
  );
  const color = useSavedControls("서류(공통·색)", {
    brightness: { value: 0.85, min: 0.4, max: 1, step: 0.01, label: "밝기" },
  });
  const paper1 = useSavedControls(
    "서류1(삐뚤빼뚤 큰더미)",
    paperSchema({
      height: 2.05,
      x: -10.4,
      z: -5.8,
      rotation: -3.14,
      size: 0.9,
      sheets: 24,
      spread: 0.35,
      slide: 0.16,
      lean: 0.19,
      thickness: 0.01,
      seed: 1,
      paperColor: "#ffffff",
      folderColor: "#efe7dd",
      clipCount: 2,
      stickyCount: 1,
      printed: true,
      printedFolder: true,
      textStyle: "보고서",
    }),
  );
  const paper2 = useSavedControls(
    "서류2(무너진 더미)",
    paperSchema({
      height: 2.05,
      x: -11.3,
      z: -2.6,
      rotation: -1.84,
      size: 0.9,
      sheets: 17,
      spread: 0.38,
      slide: 0.33,
      lean: 1.1,
      thickness: 0.01,
      seed: 129,
      paperColor: "#f4efef",
      folderColor: "#ffffff",
      clipCount: 1,
      stickyCount: 1,
      printed: true,
      printedFolder: true,
      textStyle: "섞기",
    }),
  );
  const paper3 = useSavedControls(
    "서류3(대충 몇장)",
    paperSchema({
      height: 2.05,
      x: 2.6,
      z: -2.1,
      rotation: 2.86,
      size: 0.9,
      sheets: 11,
      spread: 0.75,
      slide: 0.16,
      lean: 0.12,
      thickness: 0.01,
      seed: 58,
      paperColor: "#ffffff",
      folderColor: "#ffffff",
      clipCount: 0,
      stickyCount: 0,
      printed: true,
      printedFolder: false,
      textStyle: "손글씨메모",
    }),
  );
  const paper4 = useSavedControls(
    "서류4(문서+포스트잇)",
    paperSchema({
      height: 2.05,
      x: 1.6,
      z: -3.2,
      rotation: 2.98,
      size: 0.9,
      sheets: 3,
      spread: 0.18,
      slide: 0.12,
      lean: 0.1,
      thickness: 0.01,
      seed: 91,
      paperColor: "#ffffff",
      folderColor: "#d0be96",
      clipCount: 0,
      stickyCount: 2,
      printed: true,
      printedFolder: false,
      textStyle: "표·서식",
    }),
  );
  const paper5 = useSavedControls(
    "서류5(중간더미+포스트잇)",
    paperSchema({
      height: 2.05,
      x: 7,
      z: -5.4,
      rotation: -1.13,
      size: 0.9,
      sheets: 12,
      spread: 0.45,
      slide: 0.26,
      lean: 0.4,
      thickness: 0.01,
      seed: 133,
      paperColor: "#ffffff",
      folderColor: "#ffffff",
      clipCount: 1,
      stickyCount: 2,
      printed: true,
      printedFolder: false,
      textStyle: "체크리스트",
    }),
  );
  const paper6 = useSavedControls(
    "서류6(붙은책상·손글씨)",
    paperSchema({
      height: 2.05,
      x: -9.6,
      z: -3.4,
      rotation: 1.51,
      size: 0.95,
      sheets: 8,
      spread: 0.55,
      slide: 0.35,
      lean: 0.21,
      thickness: 0.01,
      seed: 27,
      paperColor: "#ffffff",
      folderColor: "#ffffff",
      clipCount: 1,
      stickyCount: 1,
      printed: true,
      printedFolder: true,
      textStyle: "손글씨메모",
    }),
  );
  const paper8 = useSavedControls(
    "서류8(빨강책상 오른쪽)",
    paperSchema({
      height: 2.05,
      x: -12.1,
      z: -7.1,
      rotation: 2.7,
      size: 0.9,
      sheets: 4,
      spread: 0.39,
      slide: 0.06,
      lean: 0.1,
      thickness: 0.01,
      seed: 76,
      paperColor: "#ffffff",
      folderColor: "#ffffff",
      clipCount: 0,
      stickyCount: 1,
      printed: true,
      printedFolder: true,
      textStyle: "체크리스트",
    }),
  );
  const papers = useMemo(
    () => [paper1, paper2, paper3, paper4, paper5, paper6, paper8],
    [paper1, paper2, paper3, paper4, paper5, paper6, paper8],
  );
  return { outline, color, papers };
}

export type PaperControlValues = ReturnType<typeof usePaperControls>;
export type PaperValues = PaperControlValues["papers"][number];
