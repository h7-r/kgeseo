// NPC 대화 화면을 `.game-stage` 안의 따로 된 React 루트로 붙이고 뗀다(화면 컴포넌트는 NajuNpcDialogLayer.tsx).
import { createRoot } from "react-dom/client";

import type { DialogSession, InteractionPromptStore } from "./dialogSession";
import { NajuNpcDialogLayer } from "./NajuNpcDialogLayer";

export const NPC_DIALOG_LAYER_ATTR = "data-npc-dialog-layer";
/** 첫 안내(25) · 개발 도움말(20) 위, 레터박스(30) · 연출 설정 창(40) 아래 */
const LAYER_Z_INDEX = 26;

/** 캔버스가 든 `.game-stage` 를 찾는다. 없으면 null — 그때는 화면을 만들지 않는다 */
export function findGameStage(canvas: HTMLElement | null | undefined): HTMLElement | null {
  return (canvas?.closest(".game-stage") as HTMLElement | null) ?? null;
}

/**
 * host 안에 대화 화면 루트를 붙인다. 돌려준 함수로 떼면 컨테이너를 바로 빼고, 루트는 다음 틱에 내린다
 * (게임 루트가 커밋하는 중에 다른 루트를 동기적으로 내리면 React 가 경고한다).
 */
export function mountNpcDialogLayer(
  host: HTMLElement,
  props: { session: DialogSession; prompt: InteractionPromptStore },
): () => void {
  const container = document.createElement("div");
  container.setAttribute(NPC_DIALOG_LAYER_ATTR, "");
  container.style.cssText = `position:absolute;inset:0;z-index:${LAYER_Z_INDEX};pointer-events:none;overflow:hidden`;
  host.appendChild(container);
  const root = createRoot(container);
  root.render(<NajuNpcDialogLayer {...props} />);
  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    container.remove();
    setTimeout(() => root.unmount(), 0);
  };
}
