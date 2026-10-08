/**
 * 본편이 naju01 에서 가져다 쓰는 것을 한곳에 모은 입구.
 * 본편 파일은 naju01 경로를 직접 적지 않고 여기만 본다 — naju01 안 파일을 옮겨도 이 파일 하나만 고치면 된다.
 * 화면 컴포넌트(캐릭터 생성·아바타·패널)는 첫 화면에 필요 없어 lazy 로 미룬다.
 */
import { lazy } from "react";

export type { AvatarLink as AvatarPlayerLink } from "@/engine/avatarLink";

// 로딩 영상
export {
  continueLoadingVideoAt,
  showLoadingVideo,
  type LoadingVideoKind,
  type LoadingVideoOptions,
} from "../../naju01/src/transition/loadingVideo";
// 첫 화면부터 덮어야 해서 lazy 로 미루지 않는다
export { default as LoadingVideoOverlay } from "../../naju01/src/transition/LoadingVideoOverlay";

// 캐릭터 생성
export { DEFAULT_CATALOG, type CharacterCatalog } from "../../naju01/src/characterCreation/catalog";
export {
  toRendererConfig,
  type CompletedCharacter,
  type CompleteResult,
} from "../../naju01/src/characterCreation/appearanceData";
export {
  validateNameFormat,
  type NameCheckResult,
  type NameFormatResult,
} from "../../naju01/src/characterCreation/nameRules";
export const CharacterCreationScreen = lazy(() => import("../../naju01/src/characterCreation/CharacterCreationScreen"));

// 로비 아바타 외형
export {
  DEFAULT_MESH_CONFIG,
  normalizeMeshConfig,
  readMeshAppearance,
  type MeshAppearanceConfig as ChibiConfig,
} from "../../naju01/src/avatar/meshAppearance";
export {
  DEFAULT_SIDEKICK_CONFIG,
  readSidekickAppearance,
  type AvatarGender,
  type SidekickConfig,
} from "../../naju01/src/avatar/sidekickOptions";
export { DEFAULT_TOON, type ToonConfig } from "../../naju01/src/avatar/toonMaterial";
export { DEFAULT_OUTLINE, type OutlineConfig } from "../../naju01/src/avatar/toonOutline";
export type { ChibiBody } from "../../naju01/src/avatar/ChibiGameAvatar";

// 로비 아바타와 꾸미기 패널
export const LobbyChibi = lazy(() => import("../../naju01/src/avatar/ChibiGameAvatar"));
export const LobbySidekick = lazy(() => import("../../naju01/src/avatar/SidekickGameAvatar"));
export const LobbyChibiPanel = lazy(() => import("../../naju01/src/avatar/ChibiTestPanel"));
export const LobbySidekickPanel = lazy(() => import("../../naju01/src/avatar/SidekickCustomizerPanel"));
