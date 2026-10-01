// 설정.js — 게임 안 **설정 값** 한곳 (배경음악·효과음·밝기·해상도·마우스 감도)
//
// [어디에 저장되나] 이 브라우저의 localStorage("kgeseo.설정.v1"). 새로고침해도 남는다.
//   같은 출처라 나주(/naju01/)에서도 같은 값을 읽을 수 있다.
// [누가 읽나]
//   · 효과음   → 소리.js (모든 효과음이 지나가는 마스터 볼륨)
//   · 배경음악 → 설정/배경음악.js
//   · 밝기·해상도·감도 → App.jsx (캔버스 filter · dpr · PointerLockControls)
//
// 콘솔: `__설정.값()` · `__설정.바꾸기({ 밝기: 1.2 })` · `__설정.기본으로()`

import { useSyncExternalStore } from "react";

const 저장키 = "kgeseo.설정.v1";

export const 기본설정 = {
  배경음악: 0.6, // 0 ~ 1 — 10 중 6. naju01/src/전환/로딩영상.jsx 도 이 값을 기본으로 쓴다
  효과음: 0.65, // 0 ~ 1 — (2026-10-01 사용자 지시) 전 0.9 를 「10 중 7」로 보고 5 로: 0.9 × 5/7 ≈ 0.65
  밝기: 1, // 0.6 ~ 1.4 (화면 밝기 배율)
  해상도: "자동", // 자동 · 낮음 · 보통 · 높음 · 최고
  감도: 1, // 0.4 ~ 2 (마우스 시점 회전 빠르기)
};

// 해상도 이름 → 렌더 배율(dpr). 「자동」은 App 이 원래 쓰던 값을 그대로 쓴다.
export const 해상도배율 = { 낮음: 0.75, 보통: 1, 높음: 1.5, 최고: 2 };

function 읽기() {
  try {
    const v = JSON.parse(localStorage.getItem(저장키) || "{}");
    return { ...기본설정, ...v };
  } catch {
    return { ...기본설정 };
  }
}

let 값 = typeof window === "undefined" ? { ...기본설정 } : 읽기();
const 듣는이 = new Set();
function 알리기() {
  for (const f of 듣는이) f(값);
}

export const 설정 = {
  값: () => 값,
  구독: (f) => {
    듣는이.add(f);
    return () => 듣는이.delete(f);
  },
};
export const use설정 = () => useSyncExternalStore(설정.구독, 설정.값, 설정.값);

export function 설정바꾸기(부분) {
  값 = { ...값, ...부분 };
  try {
    localStorage.setItem(저장키, JSON.stringify(값));
  } catch {
    /* 사생활 보호 창 등 — 저장만 못 할 뿐 이번 판에는 먹는다 */
  }
  알리기();
}

export function 설정기본으로() {
  설정바꾸기({ ...기본설정 });
}

if (typeof window !== "undefined") {
  window.__설정 = { 값: () => 값, 바꾸기: 설정바꾸기, 기본으로: 설정기본으로 };
}
