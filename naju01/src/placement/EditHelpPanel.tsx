import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type * as THREE from "three";

import { ASSET_CATALOG, assetPrototype } from "./assetCatalog";
import type { Selection } from "./editorConfig";
import {
  BRUSH_DROP_ID,
  MORE_ID,
  PALETTE_TOGGLE_ID,
  PANEL_CSS,
  PANEL_ID,
  SAVE_BUTTON_ID,
  STYLE_ID,
  TRAY_DOWN_ID,
  TRAY_ID,
  TRAY_SCROLLBAR_CSS,
  TRAY_UP_ID,
  panelHtml,
} from "./helpPanelHtml";
import { bakeThumbnail } from "./thumbnails";

interface EditHelpPanelProps {
  notice: string;
  selected: Selection | null;
  hasUnsaved: boolean;
  editCount: number;
  isSaving: boolean;
  canSave: boolean | null;
  onSave: () => void;
  brush: string | null;
  setBrush: Dispatch<SetStateAction<string | null>>;
  overview: boolean;
  gl: THREE.WebGLRenderer;
}

/**
 * fixed 는 레이아웃 뷰포트에 붙는다. 핀치 줌·가로 스크롤 때 보이는 영역(visualViewport)과 어긋나
 * 판이 화면 밖으로 잘리므로 그만큼 밀어 둔다.
 */
function fitToVisualViewport(panel: HTMLDivElement) {
  const vv = window.visualViewport;
  if (!vv) return;
  panel.style.left = `${vv.offsetLeft + 12}px`;
  panel.style.bottom = "auto";
  panel.style.top = `${vv.offsetTop + vv.height - panel.offsetHeight - 12}px`;
  panel.style.maxHeight = `${Math.max(120, vv.height - 24)}px`;
  // 위 계산이 못 잡는 경우(조상의 transform 등)까지 — 안 보이는 것보다 조금 어긋난 게 낫다
  const r = panel.getBoundingClientRect();
  const left = vv.offsetLeft;
  const top = vv.offsetTop;
  if (r.left < left) panel.style.left = `${parseFloat(panel.style.left) + (left - r.left)}px`;
  if (r.top < top) panel.style.top = `${parseFloat(panel.style.top) + (top - r.top)}px`;
  const bottomEdge = top + vv.height;
  const r2 = panel.getBoundingClientRect();
  if (r2.bottom > bottomEdge) panel.style.top = `${parseFloat(panel.style.top) - (r2.bottom - bottomEdge)}px`;
}

/**
 * 화면 구석 안내 + 저장 단추 + 팔레트. Ctrl+S 는 S(뒤로 걷기)와 맞물려 눌렸는지 모르니 단추와 상태를 보인다.
 * <Canvas> 안이라 R3F 재조정기가 div 를 three 객체로 해석해 터진다(createPortal 도 같다) — DOM 을 직접 만든다.
 */
export default function EditHelpPanel({
  notice,
  selected,
  hasUnsaved,
  editCount,
  isSaving,
  canSave,
  onSave,
  brush,
  setBrush,
  overview,
  gl,
}: EditHelpPanelProps) {
  // 팔레트는 접어 둔다 — 펼치면 놓을 자리를 가린다
  const [isOpen, setIsOpen] = useState(false);
  // 썸네일은 펼칠 때 한 번만 굽는다
  const [thumbnails, setThumbnails] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!isOpen || thumbnails) return;
    // 한 프레임 넘기고 — 펼치는 순간 화면이 멈칫하지 않게
    const timer = setTimeout(() => setThumbnails(bakeThumbnail(ASSET_CATALOG, assetPrototype, gl)), 0);
    return () => clearTimeout(timer);
  }, [isOpen, thumbnails, gl]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onSaveRef = useRef(onSave);
  const setBrushRef = useRef(setBrush);
  const placeRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    onSaveRef.current = onSave;
    setBrushRef.current = setBrush;
  });

  // 판은 한 번만 만든다
  useEffect(() => {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    // 세로 flex — 판은 화면 높이를 안 넘고, 넘치는 건 제 스크롤바를 가진 에셋함뿐이다.
    // 판 전체가 pointer-events:none 이라 판 자체가 스크롤되면 막대를 잡을 수 없다.
    panel.style.cssText = PANEL_CSS;
    document.body.appendChild(panel);
    panelRef.current = panel;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = TRAY_SCROLLBAR_CSS;
    document.head.appendChild(style);

    const place = () => fitToVisualViewport(panel);
    place();
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    placeRef.current = place;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest(`#${SAVE_BUTTON_ID}`)) {
        onSaveRef.current?.();
        return;
      }
      // 한 줄(단추 한 칸 높이)씩 굴린다
      const scroller = target.closest(`#${TRAY_UP_ID}, #${TRAY_DOWN_ID}`);
      if (scroller) {
        const tray = document.getElementById(TRAY_ID);
        if (tray) tray.scrollTop += scroller.id === TRAY_UP_ID ? -78 : 78;
        return;
      }
      if (target.closest(`#${PALETTE_TOGGLE_ID}`)) {
        setIsOpen((v) => !v);
        return;
      }
      if (target.closest(`#${BRUSH_DROP_ID}`)) {
        setBrushRef.current?.(null);
        return;
      }
      const button = target.closest("[data-asset]");
      if (button) {
        // 같은 것을 다시 누르면 내려놓는다 — 해제할 길이 하나뿐이면 갇힌다
        const key = button.getAttribute("data-asset");
        setBrushRef.current?.((v) => (v === key ? null : key));
      }
    };
    panel.addEventListener("click", handleClick);
    return () => {
      panel.removeEventListener("click", handleClick);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      panel.remove();
      style.remove();
      panelRef.current = null;
      placeRef.current = null;
    };
  }, []);

  // 내용만 갱신
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.innerHTML = panelHtml({
      notice,
      selected,
      hasUnsaved,
      editCount,
      isSaving,
      canSave,
      brush,
      isOpen,
      overview,
      thumbnails,
    });
    // 그린 뒤에 재야 한다 — 그려지기 전엔 높이가 0 이다
    const tray = panel.querySelector(`#${TRAY_ID}`);
    const more = panel.querySelector(`#${MORE_ID}`);
    if (tray && more && tray.scrollHeight > tray.clientHeight + 2) more.textContent = "  ↕ 굴려서 더 보기";
    // 내용이 바뀌면 판 높이가 달라진다 — 아래 12 px 을 다시 맞춘다
    placeRef.current?.();
  }, [notice, selected, hasUnsaved, editCount, isSaving, canSave, brush, isOpen, overview, thumbnails]);

  return null;
}
