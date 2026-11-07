// 팀 캐릭터 전용 옷(미르 11/8, 검토 22회차) — 로비에 늘 돌아다니는 팀 NPC 다섯 명(팀 꾸미기 창)만 쓴다. 플레이어
// 카탈로그 · 로비 서버의 사람 허용 목록에는 없다.
// 다른 옷처럼 파츠 번호로 실려 온다(카탈로그 → 번호 → 렌더러). 아바타가 맨 앞에서 번호를 풀어 몸 GLB · 머리 · 색은 기존
// 번호로 그리고, 덧입힐 것(캡 · 해병대 글자)은 TeamOutfitLayer 가 뼈에 붙인다 — 몸 GLB 를 새로 굽지 않는다.
//   헤어 9 · 10 · 11 = 민머리 · 짧은(단발) · 긴 머리 + 캡      상의 1 = 해병대 반팔(흰 티 GLB + 빨강 + 가슴 「해병대」)
import type { MeshAppearanceConfig } from "./meshAppearance";

/** 캡을 쓴 헤어 번호 = 머리 번호 + 이 값(민머리 −1 → 9) */
export const TEAM_CAP_HAIR_OFFSET = 10;
export const TEAM_MARINE_TOP = 1;
/** 해병대 빨강 — 흰 티 텍스처에 곱해진다(곱셈이라 원본보다 밝게는 안 된다) */
export const MARINE_RED = "#b51f2a";

export interface TeamOutfit {
  cap: boolean;
  marine: boolean;
}
export const NO_TEAM_OUTFIT: TeamOutfit = { cap: false, marine: false };

type OutfitFields = Partial<Pick<MeshAppearanceConfig, "hair" | "top" | "clothColor">>;

/** 렌더러 설정에서 전용 옷 번호를 풀어 기존 번호 + 덧입힐 것으로 나눈다. 전용 옷이 없으면 받은 설정을 그대로 돌려준다 */
export function splitTeamOutfit<T extends OutfitFields>(config: T): { config: T; outfit: TeamOutfit } {
  const hair = config.hair ?? -1;
  const cap = hair >= TEAM_CAP_HAIR_OFFSET - 1;
  const marine = config.top === TEAM_MARINE_TOP;
  if (!cap && !marine) return { config, outfit: NO_TEAM_OUTFIT };
  return {
    config: {
      ...config,
      ...(cap ? { hair: hair - TEAM_CAP_HAIR_OFFSET } : {}),
      ...(marine ? { top: 0, clothColor: MARINE_RED } : {}),
    },
    outfit: { cap, marine },
  };
}
