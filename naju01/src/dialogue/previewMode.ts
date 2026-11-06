/**
 * FE 초안 대사를 화면에 내는가 — 막는 곳은 여기 하나다.
 *
 * 계약 v0.4.16 §1 · §9: 배포판에서 플레이어가 보는 동행 대사는 서버가 고른 승인 원문(npc.json)뿐이다. FE 는 대사를 고르거나
 * 짓지 않는다. 그래서 lines.ts 의 퍼즐 넛지 · 상황 대사 · 잡담(G3 승인 대기 초안)은 개발 빌드나 ?npc-preview 주소에서만 미리 보인다.
 * FE 문구(인사 · [F] 보기 · 「도와 드릴까요?」 · 「여기서 뭘 해야 해요?」 대답 · 남은 수 · 퍼즐 문장의 동행 말투)는 늘 낸다.
 *
 * 런타임 조건이라 초안 글은 배포 번들에 남는다(화면에만 안 나온다). 번들에서 빼려면 초안을 동적 import 로 나눠야 한다.
 * 순수 모듈(director)은 import.meta.env 를 읽지 않는다 — 이 값을 주입받는다(dialogueRuntime).
 */
const QUERY = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

export const IS_DRAFT_LINES_VISIBLE = import.meta.env.DEV || QUERY.has("npc-preview");
