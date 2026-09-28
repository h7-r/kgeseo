import { useEffect, useRef, useState } from "react";

/* 브라우저가 스크롤에 물린 CSS 애니메이션을 지원하나.
   지원하면 같은 일을 CSS 가 합성 스레드에서 더 매끄럽게 하므로,
   아래 훅들은 스스로 물러나 리스너를 아예 달지 않는다. */
const CSS로된다 = (무엇) =>
  typeof CSS !== "undefined" && CSS.supports?.(`animation-timeline: ${무엇}`);

/* ═══════════════════════════════════════════════════════
   움직임 도우미

   [왜 훅으로 두나]
   구간마다 IntersectionObserver 를 따로 만들면 스크롤할 때마다 수십 개가
   돌아간다. 한 번 보이면 관찰을 끊어서(한 번만 드러난다) 비용을 줄인다.
   ═══════════════════════════════════════════════════════ */

/** 화면에 들어오면 참, 벗어나면 다시 거짓
 *
 *  [왜 한 번만 하지 않나]
 *  처음엔 한 번 드러나면 관찰을 끊었다. 그러면 위로 올라갔다 다시 내려올 때
 *  아무 일도 안 일어나서 "아까는 움직였는데?" 하게 된다.
 *  그래서 **오갈 때마다** 다시 돈다. 대신 화면 밖으로 확실히 나갔을 때만
 *  끄도록 여유를 크게 줘서, 경계에서 깜빡이지 않게 했다.
 */
export function use드러내기(여유 = "0px 0px -12% 0px") {
  const 칸 = useRef(null);
  const [보임, set보임] = useState(false);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return;
    /* 동작 줄이기를 켠 사람에겐 애니메이션 없이 바로 보여 준다 */
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      set보임(true);
      return;
    }
    const 관찰 = new IntersectionObserver(
      ([항목]) => set보임(항목.isIntersecting),
      { rootMargin: 여유, threshold: 0.08 },
    );
    관찰.observe(el);
    return () => 관찰.disconnect();
  }, [여유]);

  return [칸, 보임];
}

/* ═══════════════════════════════════════════════════════
   읽은 만큼 차오르는 막대

   scroll 이벤트마다 상태를 바꾸면 리액트가 매 프레임 다시 그린다.
   그래서 상태는 두지 않고 **DOM 을 직접** 만지고, rAF 로 한 프레임에
   한 번만 처리한다.
   ═══════════════════════════════════════════════════════ */
export function use읽은만큼() {
  const 막대 = useRef(null);

  useEffect(() => {
    /* CSS 가 맡을 수 있으면 여기선 손을 뗀다 */
    if (CSS로된다("scroll()")) return;

    let 예약 = 0;
    const 그리기 = () => {
      예약 = 0;
      const el = 막대.current;
      if (!el) return;
      const 끝 = document.documentElement.scrollHeight - window.innerHeight;
      const 몫 = 끝 <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / 끝));
      el.style.transform = `scaleX(${몫})`;
    };
    const 예약하기 = () => {
      if (!예약) 예약 = requestAnimationFrame(그리기);
    };
    그리기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    window.addEventListener("resize", 예약하기);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
      window.removeEventListener("resize", 예약하기);
    };
  }, []);

  return 막대;
}

/** 드러내기용 className 을 만들어 준다 */
export const 드러남클래스 = (보임) => `드러남${보임 ? " 보임" : ""}`;

/** 깊이까지 주는 드러내기 — 안쪽에서 걸어 나오는 느낌 */
export const 다가옴클래스 = (보임) => `다가옴${보임 ? " 보임" : ""}`;

/* ═══════════════════════════════════════════════════════
   마우스를 따라 층이 조금씩 어긋나는 시차

   층마다 깊이(0~1)를 달리 주면 앞의 것이 더 많이 움직여서 공간감이 난다.
   여기서도 상태 대신 DOM 을 직접 만지고 rAF 로 한 프레임에 한 번만 쓴다.
   ═══════════════════════════════════════════════════════ */
export function use마우스시차(최대 = 14) {
  const 무대 = useRef(null);

  useEffect(() => {
    const el = 무대.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let 예약 = 0;
    let x = 0;
    let y = 0;

    const 그리기 = () => {
      예약 = 0;
      for (const 층 of el.querySelectorAll("[data-깊이]")) {
        const ㄲ = parseFloat(층.dataset.깊이) || 0;
        층.style.transform = `translate3d(${(-x * 최대 * ㄲ).toFixed(2)}px, ${(-y * 최대 * ㄲ).toFixed(2)}px, 0)`;
      }
    };

    const 움직임 = (e) => {
      const r = el.getBoundingClientRect();
      x = (e.clientX - r.left) / r.width - 0.5;  // -0.5 ~ 0.5
      y = (e.clientY - r.top) / r.height - 0.5;
      if (!예약) 예약 = requestAnimationFrame(그리기);
    };
    const 나감 = () => { x = 0; y = 0; if (!예약) 예약 = requestAnimationFrame(그리기); };

    el.addEventListener("mousemove", 움직임);
    el.addEventListener("mouseleave", 나감);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      el.removeEventListener("mousemove", 움직임);
      el.removeEventListener("mouseleave", 나감);
    };
  }, [최대]);

  return 무대;
}

/** 마우스를 따라 살짝 기울어지는 카드 — 최대 ±각도 만큼만 */
export function use기울임(각도 = 6) {
  const 칸 = useRef(null);

  const 움직임 = (e) => {
    const el = 칸.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5; // -0.5 ~ 0.5
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${x * 각도 * 2}deg) rotateX(${-y * 각도 * 2}deg) translateZ(0)`;
  };
  const 나감 = () => {
    const el = 칸.current;
    if (el) el.style.transform = "";
  };

  return { ref: 칸, onMouseMove: 움직임, onMouseLeave: 나감 };
}


/* ═══════════════════════════════════════════════════════
   스크롤하면 뒤로 물러나며 커지는 칸

   첫 화면을 지나 내려갈 때 그 화면이 **조금 커지면서 옅어진다.**
   카메라가 그 안으로 들어가는 것처럼 보여서, 다음 구간이 앞으로
   당겨 나오는 느낌이 난다.

   [주의]
   · 글자가 흐려지면 안 되므로 배율은 아주 조금만(최대 1.1) 준다.
   · scroll 마다 상태를 바꾸면 매 프레임 다시 그린다 → DOM 직접 + rAF.
   · 다 지나가면 transform 을 지워, 아래 요소의 고정 위치 기준이
     되지 않게 한다.
   ═══════════════════════════════════════════════════════ */
export function use스크롤확대({ 길이 = 780, 최대배율 = 1.1, 최소투명 = 0.25, 바탕변형 = "" } = {}) {
  const 칸 = useRef(null);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let 예약 = 0;
    const 그리기 = () => {
      예약 = 0;
      const 몫 = Math.min(1, Math.max(0, window.scrollY / 길이));
      if (몫 <= 0) {
        /* 원래 걸려 있던 변형(가운데 맞춤 등)은 지우면 안 된다 */
        el.style.transform = 바탕변형;
        el.style.opacity = "";
        return;
      }
      el.style.transform = `${바탕변형} scale(${(1 + (최대배율 - 1) * 몫).toFixed(4)})`.trim();
      el.style.opacity = (1 - (1 - 최소투명) * 몫).toFixed(3);
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(그리기); };
    그리기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
    };
  }, [길이, 최대배율, 최소투명, 바탕변형]);

  return 칸;
}

/* ═══════════════════════════════════════════════════════
   지나가며 다가왔다 멀어지는 칸

   화면 아래에서 올라올 때는 **멀리 있다가**, 화면 한가운데에 오면 제 크기,
   위로 빠져나갈 때는 **살짝 커지며 지나간다.** 카메라가 그 사이를 통과하는
   것처럼 보인다.

   [읽기를 해치지 않게]
   · 배율 폭을 좁게 잡는다(0.92 ~ 1.05). 크게 주면 글자가 출렁여 멀미가 난다.
   · 글이 많은 칸에는 쓰지 않는다 — 그림·카드처럼 덩어리로 보는 것에만.
   · 동작 줄이기를 켠 사람에겐 아예 걸지 않는다.

   [성능]
   scroll 마다 상태를 바꾸면 매 프레임 리액트가 다시 그린다.
   상태를 두지 않고 DOM 을 직접 만지며, rAF 로 한 프레임에 한 번만 쓴다.
   ═══════════════════════════════════════════════════════ */
export function use지나가며({ 들어올때 = 0.92, 나갈때 = 1.05, 깊이 = 70 } = {}) {
  const 칸 = useRef(null);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    /* CSS 가 맡을 수 있으면 여기선 손을 뗀다 (.지나가며 클래스가 처리) */
    if (CSS로된다("view()")) return;

    let 예약 = 0;
    const 그리기 = () => {
      예약 = 0;
      const r = el.getBoundingClientRect();
      const 창 = window.innerHeight;
      /* 0 = 아래에서 막 들어옴, 0.5 = 한가운데, 1 = 위로 다 빠져나감 */
      const 몫 = Math.min(1, Math.max(0, (창 - r.top) / (창 + r.height)));
      const 배율 = 몫 < 0.5
        ? 들어올때 + (1 - 들어올때) * (몫 / 0.5)
        : 1 + (나갈때 - 1) * ((몫 - 0.5) / 0.5);
      /* 들어올 때만 뒤로 물러나 있다 — 나갈 땐 앞으로 지나간다 */
      const z = 몫 < 0.5 ? -깊이 * (1 - 몫 / 0.5) : 0;
      el.style.transform = `perspective(1600px) translate3d(0, 0, ${z.toFixed(1)}px) scale(${배율.toFixed(4)})`;
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(그리기); };
    그리기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    window.addEventListener("resize", 예약하기);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
      window.removeEventListener("resize", 예약하기);
    };
  }, [들어올때, 나갈때, 깊이]);

  return 칸;
}

/* ═══════════════════════════════════════════════════════
   스크롤 진행도를 CSS 변수로 흘려보내기

   [왜 animation-timeline 을 안 쓰나]
   CSS 의 scroll-driven animation 은 이 페이지에서 두 번 어긋났다.
   ① 움직이는 요소 자신을 기준(view())으로 삼으면 되먹임 고리에 빠진다 —
      키우면 자리가 바뀌고, 자리가 바뀌면 진행도가 바뀌고, 다시 크기가 바뀐다.
   ② 기준을 따로 빼도, 무대가 transform: scale 로 줄어 있어서 브라우저가
      잡는 구간이 우리가 계산한 것과 수백 px 어긋났다.

   그래서 진행도는 **직접 잰다.** 기준 칸의 위쪽이 창 아래에 닿을 때 0,
   창 위로 올라올 때 1. 이 값을 :root 의 CSS 변수로 넣으면 그 뒤는 CSS 가
   calc 으로 알아서 쓴다 — 리액트는 다시 그리지 않는다.
   덤으로 사파리에서도 똑같이 돈다(scroll-driven animation 미지원).
   ═══════════════════════════════════════════════════════ */
export function use스크롤진행(이름, { 시작 = 0.92, 끝 = 0.12 } = {}) {
  const 칸 = useRef(null);

  useEffect(() => {
    const el = 칸.current;
    if (!el) return undefined;
    const 뿌리 = document.documentElement;

    /* 동작 줄이기를 켠 사람에겐 끝난 상태로 고정한다 */
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      뿌리.style.setProperty(이름, "1");
      return () => 뿌리.style.removeProperty(이름);
    }

    let 예약 = 0;
    const 그리기 = () => {
      예약 = 0;
      const r = el.getBoundingClientRect();
      const 창 = window.innerHeight;
      const 시작y = 창 * 시작;
      const 끝y = 창 * 끝;
      const 몫 = (시작y - r.top) / (시작y - 끝y || 1);
      뿌리.style.setProperty(이름, Math.min(1, Math.max(0, 몫)).toFixed(4));
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(그리기); };

    그리기();
    window.addEventListener("scroll", 예약하기, { passive: true });
    window.addEventListener("resize", 예약하기);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
      window.removeEventListener("resize", 예약하기);
      뿌리.style.removeProperty(이름);
    };
  }, [이름, 시작, 끝]);

  return 칸;
}
