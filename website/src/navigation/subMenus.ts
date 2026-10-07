import { ANGAM_PIN_LENGTH, CASE_FILE_PIN_LENGTH } from "@/pages/home/homeLayout";

import { ROUTES } from "./routes";

/** 하위 메뉴가 찾아갈 덩이 이름. 덩이 요소에 `{...sectionAnchor(id)}` 로 붙인다. */
export type SectionId =
  | "intro"
  | "case-file"
  | "legend-regions"
  | "scenarios"
  | "angam"
  | "start"
  | "media-hero"
  | "immersive"
  | "characters"
  | "videos"
  | "plans"
  | "payment"
  | "benefits";

export function sectionAnchor(id: SectionId) {
  return { "data-section": id } as const;
}

const bySection = (id: SectionId) => `[data-section="${id}"]`;

export interface SectionItem {
  id: string;
  label: string;
  /** 덩이를 찾는 선택자. null 이면 페이지 맨 위. */
  selector: string | null;
  /** 덩이가 화면에 멈춰 있는(핀) 스크롤 거리(설계 px). 그동안은 맞춤을 하지 않는다. */
  pinLength?: number;
}

export interface SubMenu {
  items: readonly SectionItem[];
  /** false 면 하위 메뉴 줄은 띄우지 않고 스크롤 맞춤만 쓴다. */
  showBar?: boolean;
}

/**
 * 머리띠 메뉴를 눌렀을 때만 그 아래 열리는 한 줄.
 * 소개·구독·브랜드·고객센터에는 줄을 띄우지 않아서 탭 페이지는 여기 없다. 탭은 주소 ?tab= 으로 열린다.
 */
const SUB_MENUS: Readonly<Record<string, SubMenu>> = {
  [ROUTES.home]: {
    items: [
      { id: "top", label: "처음", selector: null },
      { id: "intro", label: "소개", selector: bySection("intro") },
      { id: "case-file", label: "사건 파일", selector: bySection("case-file"), pinLength: CASE_FILE_PIN_LENGTH },
      { id: "legend-regions", label: "전설 지역", selector: bySection("legend-regions") },
      { id: "scenarios", label: "시나리오", selector: bySection("scenarios") },
      { id: "angam", label: "앙암바위", selector: bySection("angam"), pinLength: ANGAM_PIN_LENGTH },
      { id: "start", label: "시작하기", selector: bySection("start") },
    ],
  },
  [ROUTES.media]: {
    items: [
      { id: "media-hero", label: "게임 영상", selector: bySection("media-hero") },
      { id: "immersive", label: "몰입 경험", selector: bySection("immersive") },
      { id: "characters", label: "캐릭터", selector: bySection("characters") },
      { id: "videos", label: "영상 모음", selector: bySection("videos") },
    ],
  },
  [ROUTES.pricing]: {
    showBar: false,
    items: [
      { id: "plans", label: "플랜 비교", selector: bySection("plans") },
      { id: "payment", label: "결제 정보", selector: bySection("payment") },
      { id: "benefits", label: "혜택 안내", selector: bySection("benefits") },
    ],
  },
};

export function getSubMenu(path: string): SubMenu | undefined {
  return Object.hasOwn(SUB_MENUS, path) ? SUB_MENUS[path] : undefined;
}

/** 하위 메뉴 줄 높이(설계 px). 머리띠(HEADER_HEIGHT) 바로 아래에 붙는다. */
export const SUB_NAV_HEIGHT = 56;
