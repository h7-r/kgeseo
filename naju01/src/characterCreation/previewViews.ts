// 생성 화면 미리보기가 담는 부위와 화질 단계.
import type { Option } from "../avatar/sidekickOptions";

/** upperBody 는 이름 단계 전용이라 보기 전환 단추에는 없다 */
export type PreviewView = "full" | "head" | "hands" | "feet" | "upperBody";

export type PreviewQuality = "low" | "medium" | "high";

export const PREVIEW_VIEWS: readonly Option<PreviewView>[] = [
  ["full", "전신"],
  ["head", "머리"],
  ["hands", "손"],
  ["feet", "발"],
];
