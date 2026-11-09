/**
 * FE 초안 대사(승인 대기 — 퍼즐 넛지 · 상황 대사 · 잡담)를 올리는가 — 정하는 곳은 여기 하나다.
 *
 * 계약 v0.4.16 §1 · §9: 배포판에서 플레이어가 보는 동행 대사는 서버가 고른 승인 원문(npc.json)뿐이다. FE 는 대사를 고르거나
 * 짓지 않는다. 그래서 초안(draftLines.ts)은 개발 빌드(vite dev)나 `VITE_NPC_PREVIEW=1` 로 만든 미리 보기 빌드에서만 동적 import 로
 * 올라온다. 운영 빌드는 이 조건이 상수 false 라 import 자체가 빠져 번들에 초안 글이 없다(#52 의 「런타임으로만 막음」을 고쳤다 —
 * 그래서 운영 주소의 ?npc-preview 는 없앴다).
 * FE 문구(인사 · [F] 보기 · 「여기서 뭘 해야 해요?」 대답 · 물음)는 lines.ts 에 있어 늘 낸다.
 * 순수 모듈(director)은 import.meta.env 를 읽지 않는다 — 초안이 올라왔는지(hasDraftLines)를 묻는다.
 */
import { registerDraftLines } from "./lines.ts";

/** 이 빌드가 초안을 싣는가 — 운영 빌드에서 상수 false 가 되어야 동적 import 가 번들에서 빠진다 */
export const IS_DRAFT_BUILD = import.meta.env.DEV || import.meta.env.VITE_NPC_PREVIEW === "1";

let loading: Promise<void> | null = null;

/** 초안을 올린다(앱이 뜰 때 한 번). 운영 빌드에서는 아무것도 하지 않는다 */
export function loadDraftLines(): Promise<void> {
  if (!IS_DRAFT_BUILD) return Promise.resolve();
  loading ??= import("./draftLines.ts").then(
    (module) => registerDraftLines(module.DRAFT_LINES),
    () => {
      // 못 올렸으면 초안 없이 간다 — 운영과 같은 화면
    },
  );
  return loading;
}
