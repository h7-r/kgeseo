import { useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════
   가까워지면 반응하기

   커서를 따라다니는 **새로운 물건을 만들지 않는다.** 대신 원래 있던
   것들(지역 갈래 동그라미·카드·메뉴)이 커서가 가까워질수록 밝아진다.

   [왜 이 방식인가]
   이 페이지 바탕은 거의 검정이다. 바탕 위에 빛이나 렌즈를 얹으면 비칠 게
   없어서 회색 얼룩으로만 보인다(두 번 해 보고 둘 다 버렸다).
   반대로 **이미 테두리와 색을 가진 것**을 밝히면 바탕은 그대로 검정이고
   반응만 보인다.

   [어떻게 만드나]
   · 리스너는 **창에 딱 하나**. 요소마다 붙이면 수십 개가 된다.
   · 한 프레임에 한 번만(rAF) 계산한다.
   · 화면 밖 요소는 건너뛴다.
   · 리액트를 다시 그리지 않는다 — CSS 변수(--가까움)만 바꾼다.
     그래서 이 값이 매 프레임 바뀌어도 리렌더가 0 이다.
   ═══════════════════════════════════════════════════════ */

/* 지금 화면에 붙어 있는 반응 요소들 */
const 명단 = new Set();

let 예약 = 0;
let 마우스x = -9999;
let 마우스y = -9999;
let 듣는중 = false;

const 계속지울것 = [];

function 그리기() {
  예약 = 0;
  계속지울것.length = 0;
  const 창높이 = window.innerHeight;
  const 창너비 = window.innerWidth;

  for (const { el, 반경 } of 명단) {
    if (!el.isConnected) {
      /* 화면에서 사라진 요소는 명단에서 뺀다 — 안 그러면 계속 쌓인다 */
      계속지울것.push(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    /* 화면 밖은 계산할 값어치가 없다 */
    if (r.bottom < -80 || r.top > 창높이 + 80 || r.right < -80 || r.left > 창너비 + 80) {
      if (el.style.getPropertyValue("--가까움") !== "0") el.style.setProperty("--가까움", "0");
      continue;
    }
    /* 요소 가장자리까지의 거리 — 가운데 기준으로 재면 큰 카드가 불리하다 */
    const dx = Math.max(r.left - 마우스x, 0, 마우스x - r.right);
    const dy = Math.max(r.top - 마우스y, 0, 마우스y - r.bottom);
    const 거리 = Math.hypot(dx, dy);
    const 값 = 거리 >= 반경 ? 0 : 1 - 거리 / 반경;
    /* 끝으로 갈수록 뚝 떨어지게 제곱한다 — 선형이면 멀리서도 늘 희미하게 켜져 있다 */
    el.style.setProperty("--가까움", (값 * 값).toFixed(3));
  }

  /* 떨어져 나간 요소 정리 — 돌면서 지우면 순회가 깨지니 끝나고 한다 */
  if (계속지울것.length) {
    for (const 표 of 명단) {
      if (계속지울것.includes(표.el)) {
        명단.delete(표);
        직접명단.delete(표.el);
      }
    }
  }
}

function 움직임(e) {
  마우스x = e.clientX;
  마우스y = e.clientY;
  if (!예약) 예약 = requestAnimationFrame(그리기);
}

function 나감() {
  마우스x = -9999;
  마우스y = -9999;
  if (!예약) 예약 = requestAnimationFrame(그리기);
}

function 듣기시작() {
  if (듣는중) return;
  듣는중 = true;
  window.addEventListener("mousemove", 움직임, { passive: true });
  window.addEventListener("mouseleave", 나감);
  window.addEventListener("scroll", () => {
    if (!예약) 예약 = requestAnimationFrame(그리기);
  }, { passive: true });
}

/* ref 콜백에서 바로 쓰는 등록기.
   이미 다른 용도로 ref 를 쓰고 있어서 훅을 못 붙이는 자리(예: nav 메뉴는
   밑줄 위치를 재려고 ref 를 이미 쓴다)에 쓴다.
   같은 요소를 다시 넘겨도 중복으로 쌓이지 않는다. */
const 직접명단 = new Map();
export function 가까이등록(el, 반경 = 170) {
  if (!el) return;
  if (직접명단.has(el)) return;
  if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const 표 = { el, 반경 };
  직접명단.set(el, 표);
  명단.add(표);
  듣기시작();
}

/** 이 요소를 「커서가 가까우면 밝아지는 것」으로 등록한다.
 *  반경(px) 안에 들어오면 --가까움 이 0 → 1 로 올라간다. */
export function use가까움(반경 = 190) {
  const 칸 = useRef(null);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return undefined;
    /* 마우스가 없는 기기나 동작 줄이기에서는 아예 등록하지 않는다 */
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const 표 = { el, 반경 };
    명단.add(표);
    듣기시작();
    return () => {
      명단.delete(표);
      el.style.removeProperty("--가까움");
    };
  }, [반경]);

  return 칸;
}
