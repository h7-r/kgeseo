// 자판기상태.js — 자판기 한 대의 '지금 상태'와 버튼 연출 계산
//
// [왜 React state 를 안 쓰나]
//   버튼 불빛과 눌림은 **매 프레임 바뀌는 값**이다. state 로 두면 초당 60번
//   복도 전체가 다시 그려진다. 그래서 값은 여기 상자에 담아 두고, 화면 쪽은
//   useFrame 에서 직접 읽어 재질·위치만 손으로 고친다.
//   드물게 바뀌는 것(뽑힌 캔·컵)만 구독으로 알린다.
//
// [지켜야 하는 가드레일]
//   GRD-01 되돌릴 수 있음 — 연 문은 다시 E 로 닫힌다. 막히는 상태가 없다.
//   GRD-11 한 모달 — 여기서는 창을 안 띄운다. 전부 물건 자체로 보여 준다.

import { useSyncExternalStore } from "react";

const 기본 = () => ({
  돈: false, // 동전을 넣었나 (넣으면 버튼이 전부 켜진다)
  누른: -1, // 마지막으로 누른 버튼 번호
  누른때: 0, // 누른 시각(ms)
  유효: false, // 돈이 있는 상태에서 눌렀나 (깜빡임은 이때만)
  문: false, // 커피 배출부 투명문 열림
  덮개: false, // 음료 배출구 덮개 열림
  나온것: -1, // 배출구에 나온 음료 번호 (음료 자판기)
  컵: false, // 종이컵이 나왔나 (커피 자판기)
  선택: null, // "핫" | "아이스"
});

const 상자 = new Map();
const 듣는이 = new Set();
const 알리기 = () => {
  for (const f of 듣는이) f();
};
let 판 = 0;

const 꺼내기 = (id) => {
  let s = 상자.get(id);
  if (!s) {
    s = 기본();
    상자.set(id, s);
  }
  return s;
};

export const 자판기상태 = {
  값: (id) => 꺼내기(id),
  판: () => 판,
  구독: (f) => {
    듣는이.add(f);
    return () => 듣는이.delete(f);
  },
};

// 드물게 바뀌는 것(뽑힌 캔·컵·문)만 알린다
const 바뀜 = () => {
  판++;
  알리기();
};

/** 동전 투입 — 그 자판기 버튼이 전부 켜진다 */
export function 돈넣기(id) {
  const s = 꺼내기(id);
  s.돈 = true;
  s.누른 = -1;
  s.유효 = false;
  바뀜();
}

/**
 * 버튼을 누른다.
 * 돈이 없으면 **눌리기만 하고** 아무 일도 안 일어난다(실물과 같다).
 * @param 종류 "음료" | "커피"
 * @param 온도 커피일 때 "핫" | "아이스"
 */
export function 버튼누르기(id, i, { 종류 = "음료", 온도 = null } = {}) {
  const s = 꺼내기(id);
  s.누른 = i;
  s.누른때 = performance.now();
  s.유효 = s.돈;
  if (s.돈) {
    s.돈 = false; // 한 번 넣은 돈으로 하나
    if (종류 === "음료") s.나온것 = i;
    else {
      s.컵 = true;
      s.선택 = 온도;
    }
  }
  바뀜();
}

export function 문토글(id) {
  const s = 꺼내기(id);
  s.문 = !s.문;
  바뀜();
}

export function 덮개토글(id) {
  const s = 꺼내기(id);
  s.덮개 = !s.덮개;
  // 덮개를 열면 나온 음료를 집어 간 것으로 본다 — 닫을 때 사라진다.
  if (!s.덮개) s.나온것 = -1;
  바뀜();
}

/** 커피 컵을 치운다(문을 닫을 때) */
export function 컵치우기(id) {
  const s = 꺼내기(id);
  if (!s.컵) return;
  s.컵 = false;
  s.선택 = null;
  바뀜();
}

// ── 연출 계산 ──────────────────────────────────────────────
// 눌림 — 0.16초 동안 들어갔다 나온다(사인 반주기라 끝이 부드럽다)
const 누름시간 = 0.16;
export function 누름세기(id, i, 지금) {
  const s = 꺼내기(id);
  if (s.누른 !== i) return 0;
  const t = (지금 - s.누른때) / 1000;
  if (t < 0 || t > 누름시간) return 0;
  return Math.sin((t / 누름시간) * Math.PI);
}

// 불빛 — 돈을 넣으면 전부 켜지고, 하나를 누르면 **그것만** 깜빡이다 꺼진다.
//   나머지는 그 순간 바로 꺼진다(어느 걸 골랐는지가 한눈에 보인다).
const 깜빡시간 = 1.1;
const 깜빡주기 = 0.16;
export function 불세기(id, i, 지금) {
  const s = 꺼내기(id);
  if (s.유효 && s.누른 >= 0) {
    if (i !== s.누른) return 0;
    const t = (지금 - s.누른때) / 1000;
    if (t > 깜빡시간) return 0;
    // 사각파 — 은은한 사인보다 '깜빡'이 또렷하다
    return Math.floor(t / (깜빡주기 / 2)) % 2 === 0 ? 1 : 0;
  }
  return s.돈 ? 1 : 0;
}

// 드물게 바뀌는 값(뽑힌 캔·컵·문)만 화면이 구독한다.
//   ★ 단순값(판)만 구독하고 내용은 그때 꺼내 쓴다 — 객체를 돌려주면
//     매번 다른 값으로 보여 React 가 무한 렌더에 빠진다.
export const use자판기 = (id) => {
  useSyncExternalStore(자판기상태.구독, 자판기상태.판);
  return 자판기상태.값(id);
};

// 콘솔 확인용
if (typeof window !== "undefined")
  window.__자판기 = { 자판기상태, 돈넣기, 버튼누르기, 문토글, 덮개토글 };
