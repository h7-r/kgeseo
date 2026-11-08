/** ?fps — 실기기 측정용 프레임 표시(FpsBadge)를 띄운다 */
export const SHOW_FPS = typeof location !== "undefined" && new URLSearchParams(location.search).has("fps");
