// 조사시스템.js — 물건을 겨냥하고 조사하는 상태 (USR-051)
//
// [왜 App.jsx 밖에 두는가]
//   ① 3D 씬(Canvas 안)과 화면 위 UI(Canvas 밖)가 **같은 값**을 봐야 하는데
//      둘은 부모-자식이 아니라 props 로 못 넘긴다 → 바깥 상자를 하나 두고 둘 다 본다.
//   ② 조사할 물건은 앞으로 백엔드가 정해서 내려준다. 그때 화면 코드를 안 건드리려면
//      「대상 목록」과 「지금 겨냥 중인 것」이 코드가 아니라 데이터여야 한다.

import { useSyncExternalStore } from "react";

// ── 판정 상수 (S7-015 「판정 거리와 각도를 상수로 고정한다」) ──
export const 판정 = {
  // 손 닿는 거리. 1 유닛 ≈ 0.30m 이므로 6 ≈ 1.8m.
  //   멀리서부터 표식이 뜨면 방이 아이콘 밭이 되어 탐색 재미가 사라진다(S7-002).
  거리: 6,
  // 광선을 얼마나 자주 쏘나(초). 매 프레임은 낭비다.
  주기: 0.08,
};

let 값 = {
  겨냥: null, // 지금 조준 중인 물건 id
  열림: null, // 조사창에 띄운 물건 id
  이력: {}, // { id: 조사한 횟수 } — 한 번 본 물건은 표식을 약하게 (S7-016)
};

const 듣는이 = new Set();
function 세팅(부분) {
  값 = { ...값, ...부분 };
  for (const f of 듣는이) f();
}

export const 조사상태 = {
  값: () => 값,
  구독: (f) => {
    듣는이.add(f);
    return () => 듣는이.delete(f);
  },
  세팅,
};

// 콘솔·자동 확인용. 렌더에는 영향이 없다.
if (typeof window !== "undefined") window.__조사상태 = 조사상태;

// ★ 단순값만 돌려준다. 객체를 새로 만들어 돌려주면 매번 다른 값으로 보여 무한 렌더가 된다.
export const use겨냥 = () =>
  useSyncExternalStore(조사상태.구독, () => 조사상태.값().겨냥);
export const use열림 = () =>
  useSyncExternalStore(조사상태.구독, () => 조사상태.값().열림);
export const use이력횟수 = (id) =>
  useSyncExternalStore(조사상태.구독, () => 조사상태.값().이력[id] || 0);

export const 겨냥설정 = (id) => {
  if (조사상태.값().겨냥 !== id) 세팅({ 겨냥: id });
};

// S7-017 — 조사하면 이력을 남긴다. 두 번째부터는 표식이 약해진다.
export function 조사열기(id) {
  const 이력 = { ...조사상태.값().이력 };
  이력[id] = (이력[id] || 0) + 1;
  세팅({ 열림: id, 겨냥: null, 이력 });
}
export const 조사닫기 = () => 세팅({ 열림: null });

// ── 대상 목록 ────────────────────────────────────────────────
// 지금은 파일에 적어 두지만, **모양을 이대로 유지하면 백엔드 응답을 그대로 꽂을 수 있다.**
//   { id, 이름, 분류, 설명, 단서 }
const 목록 = new Map();
export function 대상등록(항목) {
  목록.set(항목.id, 항목);
}
export function 대상등록여러개(배열) {
  for (const a of 배열) 대상등록(a);
}
export const 대상찾기 = (id) => 목록.get(id) || null;
