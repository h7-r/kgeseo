/**
 * 모바일 터치 조작 — 본편과 나주가 같이 쓴다(계획서 `왜곡_모바일최적화_작업계획서_v0.3_1107.md` 8.1).
 * PC(터치 모드가 아님)에서는 화면도 동작도 지금과 똑같다.
 */
export { FpsBadge } from "./FpsBadge";
export { SHOW_FPS } from "./inputFlags";
export { touchifyText, touchKeyName, useKeyLabels } from "./keyLabels";
export {
  isGameFrozen,
  isGamePausedFlag,
  onGameFreeze,
  onGameThaw,
  setDesktopPauses,
  trackAudioContext,
  trackMedia,
  useGameFrozen,
} from "./gamePause";
export { FovCap, MAX_HORIZONTAL_FOV } from "./FovCap";
export {
  addFullscreenExitListener,
  canRequestFullscreen,
  enterFullscreenLandscape,
  hasPassedFirstTap,
  isMediaHeld,
  isPortraitNow,
  passFirstTap,
  subscribeLandscape,
  useLandscapeState,
} from "./landscape";
export { LandscapeGuard } from "./LandscapeGuard";
export { MobileGate } from "./MobileGate";
export { PauseClockGuard } from "./PauseClockGuard";
export { getTouchMove, onInputCancel, tapKey } from "./touchInput";
export { TouchHud, type TouchButton } from "./TouchHud";
export { TOUCH_HUD, topRowWidth } from "./touchHudLayout";
export { TouchLook } from "./TouchLook";
export { isTouchMode, useTouchMode } from "./touchMode";
export { addPointerActiveListener, isPointerActive } from "./virtualLock";
