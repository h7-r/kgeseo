// 탭 01~05 — 탭 순서가 곧 만드는 순서다.
import type { DraftColors } from "./appearanceData";

export type TabId = "basics" | "body" | "hair" | "outfit" | "name";
export type AppearanceTab = Exclude<TabId, "name">;

export const TABS: readonly { id: TabId; label: string; summary: string }[] = [
  { id: "basics", label: "기본", summary: "성별 · 피부" },
  { id: "body", label: "체형", summary: "키 · 비율 · 체격" },
  { id: "hair", label: "헤어", summary: "머리 모양 · 색" },
  { id: "outfit", label: "의상", summary: "옷 · 신발 · 색" },
  { id: "name", label: "이름", summary: "조사관 이름" },
];

// 다음 단추에 적는 말 — 「어디로 가나」만
export const NEXT_LABELS: Partial<Record<TabId, string>> = {
  body: "체형 설정",
  hair: "헤어 설정",
  outfit: "의상 설정",
  name: "조사관 이름",
};

export const TAB_DESCRIPTIONS: Record<TabId, string> = {
  basics: "조사관의 성별과 피부색을 정합니다.",
  body: "키와 몸의 비율을 조절합니다. 기본값 그대로 넘어가도 됩니다.",
  hair: "머리 모양과 머리색을 고릅니다.",
  outfit: "지금 준비된 옷과 신발입니다. 아래에서 상의 · 하의 · 신발을 하나씩 고르세요.",
  name: "게임 안에서 불릴 조사관의 이름입니다.",
};

export type OutfitSlot = "top" | "bottom" | "shoes";
export const OUTFIT_SLOTS: readonly OutfitSlot[] = ["top", "bottom", "shoes"];

// 의상 칸 → 색 갈래. 상의 색 열쇠는 저장 데이터 이름 그대로 cloth
export const OUTFIT_COLOR_SLOTS: Record<OutfitSlot, keyof DraftColors> = {
  top: "cloth",
  bottom: "bottom",
  shoes: "shoes",
};
export const OUTFIT_DESCRIPTIONS: Record<OutfitSlot, string> = {
  top: "상의 종류와 상의 컬러를 고릅니다.",
  bottom: "하의 종류와 하의 컬러를 고릅니다.",
  shoes: "신발 종류와 신발 컬러를 고릅니다.",
};
