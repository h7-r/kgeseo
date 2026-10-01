import { useSyncExternalStore } from "react";

/* ═══════════════════════════════════════════════════════
   영상 모달 저장소 — 「지금 크게 열린 영상」 하나를 들고 있는 아주 작은 상태

   [왜 리액트 상태(useState)가 아니라 모듈 변수인가]
   여는 쪽(경주 원·카드)과 그리는 쪽(앱.jsx 에 한 번 놓인 영상모달)이 서로 멀리 떨어져 있다.
   props 로 내려보내려면 중간 컴포넌트를 전부 거쳐야 한다.
   → 파일 하나에 값을 두고, 바뀌면 구독자에게 알린다(useSyncExternalStore).
     로그인상태.js 와 같은 방식이다.
   ═══════════════════════════════════════════════════════ */
let 지금 = null; // { 영상, 출발요소, 모양, 시각, 돌아오기 } 또는 null
const 듣는이 = new Set();
const 알리기 = () => 듣는이.forEach((f) => f());

/** 크게 열기 — use미리보기 가 부른다 */
export function 영상열기(요청) {
  지금 = 요청;
  알리기();
}
/** 닫기 — 모달이 줄어드는 연출을 끝낸 뒤 부른다 */
export function 영상닫기() {
  지금 = null;
  알리기();
}
/** 지금 열린 영상(없으면 null) — 영상모달이 쓴다 */
export function use열린영상() {
  return useSyncExternalStore(
    (f) => { 듣는이.add(f); return () => 듣는이.delete(f); },
    () => 지금,
    () => null,
  );
}
