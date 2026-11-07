// 팀 캐릭터 전용 옷(미르 11/8, 검토 22회차) — 로비에 늘 돌아다니는 팀 NPC 다섯 명(팀 꾸미기 창)만 쓴다. 플레이어
// 카탈로그 · 로비 서버의 사람 허용 목록에는 없다.
// 다른 옷처럼 파츠 번호로 실려 온다(카탈로그 → 번호 → 렌더러). 아바타가 맨 앞에서 번호를 풀어 몸 GLB · 머리 · 색은 기존
// 번호로 그리고, 덧입힐 것(캡 · 해병대 글자)은 TeamOutfitLayer 가 뼈에 붙인다 — 몸 GLB 를 새로 굽지 않는다.
//   헤어 9 · 10 · 11 = 민머리 · 짧은(단발) · 긴 머리 + 캡      상의 1 = 해병대 반팔(흰 티 GLB + 빨강 + 가슴 「해병대」)
//   하의 1 · 2 = 스키니 청바지 · 통 큰 바지 — 하의 없는 몸 GLB + 따로 구운 바지 파츠(tools/team_pants_build.py)
import { sharedAssetUrl } from "@/config/env";

import type { MeshAppearanceConfig } from "./meshAppearance";

/** 캡을 쓴 헤어 번호 = 머리 번호 + 이 값(민머리 −1 → 9) */
export const TEAM_CAP_HAIR_OFFSET = 10;
export const TEAM_MARINE_TOP = 1;
/** 해병대 빨강 — 흰 티 텍스처에 곱해진다(곱셈이라 원본보다 밝게는 안 된다) */
export const MARINE_RED = "#b51f2a";

export type TeamPantsStyle = "jeans" | "baggy";
/** 하의 번호 → 바지 */
export const TEAM_PANTS_BY_BOTTOM: Readonly<Record<number, TeamPantsStyle>> = { 1: "jeans", 2: "baggy" };
/**
 * 하의 색이 「원본」(흰색)이면 그 바지의 기본색 — 결 무늬가 회색이라 흰색 그대로면 청바지가 하얗게 나온다.
 * 다른 색을 고르면 그 색을 곱한다
 */
export const TEAM_PANTS_DEFAULT_COLOR: Readonly<Record<TeamPantsStyle, string>> = {
  jeans: "#4a6896",
  baggy: "#3a3d45",
};
/** 바지 파츠를 다시 구우면 올린다(파일 이름이 그대로라 브라우저가 새 GLB 를 받게) */
export const TEAM_PANTS_VERSION = 1;

export interface TeamOutfit {
  cap: boolean;
  marine: boolean;
  pants: TeamPantsStyle | null;
}
export const NO_TEAM_OUTFIT: TeamOutfit = { cap: false, marine: false, pants: null };

type OutfitFields = Partial<Pick<MeshAppearanceConfig, "hair" | "top" | "bottom" | "clothColor" | "bottomColor">>;

/** 렌더러 설정에서 전용 옷 번호를 풀어 기존 번호 + 덧입힐 것으로 나눈다. 전용 옷이 없으면 받은 설정을 그대로 돌려준다 */
export function splitTeamOutfit<T extends OutfitFields>(config: T): { config: T; outfit: TeamOutfit } {
  const hair = config.hair ?? -1;
  const cap = hair >= TEAM_CAP_HAIR_OFFSET - 1;
  const marine = config.top === TEAM_MARINE_TOP;
  const pants = TEAM_PANTS_BY_BOTTOM[config.bottom ?? -1] ?? null;
  if (!cap && !marine && !pants) return { config, outfit: NO_TEAM_OUTFIT };
  const bottomColor = (config.bottomColor ?? "#ffffff").toLowerCase();
  return {
    config: {
      ...config,
      ...(cap ? { hair: hair - TEAM_CAP_HAIR_OFFSET } : {}),
      ...(marine ? { top: 0, clothColor: MARINE_RED } : {}),
      // 바지는 하의 없는 몸 위에 따로 입는다
      ...(pants
        ? { bottom: -1, bottomColor: bottomColor === "#ffffff" ? TEAM_PANTS_DEFAULT_COLOR[pants] : bottomColor }
        : {}),
    },
    outfit: { cap, marine, pants },
  };
}

/** 그 몸(상의 있음 · 없음 착장, 성별)에 맞춰 구운 바지 파츠 */
export function getTeamPantsUrl(style: TeamPantsStyle, config: Partial<Pick<MeshAppearanceConfig, "gender" | "top">>) {
  const combo = (config.top ?? -1) >= 0 ? "top" : "base";
  const gender = config.gender === "feminine" ? "female" : "male";
  return sharedAssetUrl(`/models/team-pants-${style}-${combo}-${gender}.glb?v=${TEAM_PANTS_VERSION}`);
}
