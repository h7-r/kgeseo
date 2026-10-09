// 편집 안내판의 DOM id · 바탕 CSS · 내용 HTML. 판은 <Canvas> 밖 DOM 이라 문자열로 그린다.

import { ASSET_CATALOG, ASSET_CATEGORIES, findAsset, type AssetDefinition } from "./assetCatalog";
import type { Selection } from "./editorConfig";

export const PANEL_ID = "edit-help-panel";
export const ASSET_TRAY_ID = "edit-help-panel__asset-tray";
export const MORE_HINT_ID = "edit-help-panel__more-hint";
export const PANEL_STYLE_ID = "edit-help-panel-style";
export const SAVE_BUTTON_ID = "edit-help-panel__save-button";
export const TRAY_UP_BUTTON_ID = "edit-help-panel__tray-up-button";
export const TRAY_DOWN_BUTTON_ID = "edit-help-panel__tray-down-button";
export const PALETTE_TOGGLE_ID = "edit-help-panel__palette-toggle";
export const BRUSH_DROP_BUTTON_ID = "edit-help-panel__brush-drop-button";

export const PANEL_CSS =
  "position:fixed;left:12px;bottom:12px;z-index:60;pointer-events:none;" +
  "font:12px/1.6 ui-monospace,monospace;color:#E8EAF0;" +
  "background:rgba(16,20,28,.86);padding:10px 12px;border-radius:8px;" +
  "border:1px solid rgba(255,209,102,.35);max-width:min(60ch,70vw);" +
  "max-height:calc(100vh - 24px);overflow:hidden;" +
  "display:flex;flex-direction:column;gap:0";

// 인라인 style 로는 ::-webkit-scrollbar 를 못 꾸민다. 기본 막대는 어두운 판 위에서 안 보인다.
export const ASSET_TRAY_SCROLLBAR_CSS =
  `#${ASSET_TRAY_ID}::-webkit-scrollbar{-webkit-appearance:none;width:10px}` +
  `#${ASSET_TRAY_ID}::-webkit-scrollbar-track{background:rgba(255,255,255,.06);border-radius:5px}` +
  `#${ASSET_TRAY_ID}::-webkit-scrollbar-thumb{background:rgba(255,209,102,.55);` +
  "border-radius:5px;border:2px solid transparent;background-clip:content-box}" +
  `#${ASSET_TRAY_ID}::-webkit-scrollbar-thumb:hover{background:rgba(255,209,102,.85);` +
  "background-clip:content-box}";

interface PanelContent {
  notice: string;
  selected: Selection | null;
  hasUnsaved: boolean;
  editCount: number;
  isSaving: boolean;
  canSave: boolean | null;
  brush: string | null;
  isOpen: boolean;
  overview: boolean;
  thumbnails: Map<string, string> | null;
}

function computeSaveButtonLook({ isSaving, canSave, hasUnsaved, editCount }: PanelContent) {
  const color = isSaving ? "#9AA3B2" : canSave === false ? "#FF8A80" : hasUnsaved ? "#FFD166" : "#9BE3B4";
  const label = isSaving
    ? "저장 중…"
    : canSave === false
      ? "저장 불가 — 서버 재시작"
      : hasUnsaved
        ? `저장하기 (변경 ${editCount})`
        : editCount > 0
          ? `저장됨 (${editCount})`
          : "변경 없음";
  return { color, label };
}

function formatAssetButtonHtml(asset: AssetDefinition, isActive: boolean, image: string | undefined) {
  return (
    `<button type="button" data-asset="${asset.key}" title="${asset.label}" ` +
    'style="pointer-events:auto;cursor:pointer;font:inherit;' +
    `border:1px solid ${isActive ? "#FFD166" : "rgba(255,255,255,.22)"};` +
    `background:${isActive ? "#FFD166" : "rgba(255,255,255,.06)"};` +
    `color:${isActive ? "#12161F" : "#E8EAF0"};` +
    "border-radius:6px;padding:3px 5px 2px;margin:3px 4px 0 0;" +
    "display:inline-flex;flex-direction:column;align-items:center;" +
    'gap:1px;width:62px;vertical-align:top">' +
    (image
      ? `<img src="${image}" width="46" height="46" alt="" ` +
        'style="display:block;border-radius:4px;' +
        `background:${isActive ? "rgba(0,0,0,.10)" : "rgba(0,0,0,.22)"}">`
      : '<span style="display:block;width:46px;height:46px;border-radius:4px;background:rgba(0,0,0,.22)"></span>') +
    `<span style="font-size:10px;line-height:1.15;text-align:center;` +
    `word-break:keep-all">${asset.label}</span></button>`
  );
}

// 에셋함만 pointer-events:auto — 막대를 잡을 수 있어야 하고, 판의 나머지는 뒤가 클릭돼야 한다.
// scrollbar-width/color 를 쓰면 크롬이 ::-webkit-scrollbar 를 무시해 흐린 막대가 나온다.
function formatAssetTrayHtml(brush: string | null, thumbnails: Map<string, string> | null) {
  return (
    `<div id="${ASSET_TRAY_ID}" style="pointer-events:auto;` +
    "flex:1 1 auto;min-height:88px;overflow-y:scroll;" +
    'overflow-x:hidden;margin-top:2px;padding-right:4px">' +
    ASSET_CATEGORIES.map((category) => {
      const buttons = ASSET_CATALOG.filter((asset) => asset.category === category)
        .map((asset) => formatAssetButtonHtml(asset, brush === asset.key, thumbnails?.get(asset.key)))
        .join("");
      return `<div style="margin-top:4px"><span style="opacity:.55">${category}</span><br>${buttons}</div>`;
    }).join("") +
    "</div>"
  );
}

function formatPaletteHtml({ brush, isOpen, thumbnails }: PanelContent) {
  const brushLabel = brush ? (findAsset(brush)?.label ?? brush) : null;
  return (
    // flex 자식이라 min-height:0 이 없으면 안쪽 스크롤이 안 먹는다
    '<div style="margin-top:8px;padding-top:8px;flex:1 1 auto;min-height:0;' +
    "display:flex;flex-direction:column;" +
    'border-top:1px solid rgba(255,255,255,.14)">' +
    // 머리줄을 한 블록으로 감싸야 단추들이 세로 flex 자식으로 늘어나지 않는다
    '<div style="flex:0 0 auto">' +
    `<button id="${PALETTE_TOGGLE_ID}" type="button" style="pointer-events:auto;cursor:pointer;` +
    "font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);border:1px solid " +
    'rgba(255,255,255,.2);border-radius:5px;padding:3px 9px">' +
    `${isOpen ? "▾" : "▸"} 놓을 것</button>` +
    (brushLabel
      ? ` <span style="color:#FFD166">붓: ${brushLabel}</span>` +
        ` <button id="${BRUSH_DROP_BUTTON_ID}" type="button" style="pointer-events:auto;` +
        "cursor:pointer;font:inherit;color:#12161F;background:#FFD166;border:none;" +
        'border-radius:5px;padding:2px 8px">내려놓기 (ESC)</button>' +
        '<span style="opacity:.6"> — 화면을 클릭해 놓는다</span>'
      : '<span style="opacity:.6"> — 눌러서 고른다</span>') +
    (isOpen
      ? // 맥 크롬은 스크롤바를 겹쳐 그려 굴리기 전엔 안 보인다 — 눌리는 단추를 둔다
        ` <span id="${MORE_HINT_ID}" style="color:#FFD166"></span>` +
        `<button id="${TRAY_UP_BUTTON_ID}" type="button" style="pointer-events:auto;` +
        "cursor:pointer;font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);" +
        "border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:1px 7px;" +
        'margin-left:6px">▲</button>' +
        `<button id="${TRAY_DOWN_BUTTON_ID}" type="button" style="pointer-events:auto;` +
        "cursor:pointer;font:inherit;color:#E8EAF0;background:rgba(255,255,255,.08);" +
        "border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:1px 7px;" +
        'margin-left:3px">▼</button>'
      : "") +
    "</div>" +
    (isOpen ? formatAssetTrayHtml(brush, thumbnails) + "</div>" : "")
  );
}

/** 안내판 전체 내용 */
export function formatPanelHtml(content: PanelContent) {
  const { notice, selected, isSaving, canSave, overview } = content;
  const save = computeSaveButtonLook(content);
  const degrees = ((((((selected?.rotation ?? 0) * 180) / Math.PI) % 360) + 360) % 360) | 0;
  return (
    '<b style="color:#FFD166">편집 모드</b>' +
    '<span style="opacity:.75"> · 클릭·드래그 고르고 옮기기 · 우클릭 드래그 시점 · WASD 걷기</span><br>' +
    '<span style="opacity:.75">방향키 밀기(Shift 크게) · R 회전 · [ ] 크기 · ' +
    '<b style="color:#9BD6FF">, . 시점 돌리기</b> · ' +
    "Ctrl+C/V 복사·붙여넣기 · X 지우기 · Ctrl+Z 되돌리기 · ESC 해제</span><br>" +
    (overview
      ? '<span style="color:#9BD6FF">부감 — ' +
        "WASD·방향키 밀기 · <b>휠 돌리기</b>(, . 도 됨) · <b>핀치/⌘+휠 높낮이</b> · Tab 내려오기</span>"
      : '<span style="opacity:.75">Tab — 공중에서 내려다보기</span>') +
    (selected
      ? `<br><span style="color:#9BE3B4">${selected.groupId} #${selected.id}</span>` +
        `<span style="color:#C9CEDA">  (${selected.x.toFixed(1)}, ${selected.z.toFixed(1)})` +
        ` · 키 ${selected.size.toFixed(1)} m · ∠ ${degrees}°</span>`
      : "") +
    '<div style="margin-top:8px;display:flex;align-items:center;gap:8px">' +
    `<button id="${SAVE_BUTTON_ID}" type="button"${isSaving ? " disabled" : ""} ` +
    'style="pointer-events:auto;cursor:pointer;font:inherit;color:#12161F;' +
    `background:${save.color};border:none;border-radius:6px;padding:5px 12px;font-weight:700">` +
    `${save.label}</button>` +
    '<span style="opacity:.6">또는 Ctrl+S</span></div>' +
    (notice
      ? `<div style="margin-top:6px;color:${notice.startsWith("✘") ? "#FF8A80" : "#FFD166"}">${notice}</div>`
      : "") +
    (canSave === false
      ? '<div style="margin-top:4px;color:#FF8A80">개발 서버에 저장 기능이 없다 — ' +
        "<b>npx vite naju01</b> 을 다시 띄워라</div>"
      : "") +
    formatPaletteHtml(content)
  );
}
