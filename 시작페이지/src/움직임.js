import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
/* ★ 여유를 −12% 에서 +8% 로 바꿨다.
   −12% 는 「화면 안으로 12% 들어와야 켠다」는 뜻이라, 굴리고 한참 뒤에야
   나타나 스크롤보다 늦다는 말이 나왔다. +8% 는 화면에 닿기 **직전**에 켠다.
   threshold 도 0.08 → 0 으로 내려, 큰 칸이 조금만 걸쳐도 바로 시작한다. */
/* ★ 성능·체감(스크롤할 때마다 늦게 뜬다는 의견)
   [전엔] 화면 밖으로 나가면 **어느 쪽으로 나가든** 다시 숨겼다. 그래서 내렸다 올렸다 할 때마다
          다시 투명 → 스윽 나타나기를 반복했고, 화면에 닿기 직전(8%)에야 시작해서 늘 늦어 보였다.
   [지금] ① 화면 아래 18% 앞에서 미리 시작한다 → 화면에 닿을 즈음엔 거의 다 나타나 있다.
          ② 위로 지나간 것(이미 본 것)은 숨기지 않는다. 화면 **아래로** 벗어났을 때만(= 위로 되돌아가
             그보다 위를 볼 때만) 되감아서, 다시 내려오면 한 번 더 나타난다.
   되감기="양쪽" — 도는글처럼 「안 보이면 멈춰야」 하는 곳은 예전처럼 양쪽 다 끈다. */
/* (2026-10-01) 18% → 30% — 그래도 늦다는 의견. 화면에 닿을 때쯤 이미 다 나타나 있게 더 일찍 시작한다 */
export function use드러내기(여유 = "0px 0px 30% 0px", 되감기 = "아래") {
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
      ([항목]) => {
        if (항목.isIntersecting) set보임(true);
        /* 요소 윗변이 화면 윗변보다 아래(top > 0) = 화면 아래쪽으로 빠졌다 → 이때만 되감는다 */
        else if (되감기 === "양쪽" || 항목.boundingClientRect.top > 0) set보임(false);
      },
      { rootMargin: 여유, threshold: 0 },
    );
    관찰.observe(el);
    return () => 관찰.disconnect();
  }, [여유, 되감기]);

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

/* ═══════════════════════════════════════════════════════
   가운데에서 멈춘 채 스크롤한 만큼 스윽 — 앙암바위 구간

   [흐름 — 힉스필드처럼]
   ① 스크롤해 내려오면 앙암바위 구간(왼쪽 원·오른쪽 글 상자·뒤 고리)이 올라온다.
      이때 오른쪽 글은 아직 투명해서 안 보인다.
   ② 오른쪽 글 상자의 가운데가 **화면 가운데**에 딱 맞으면, 구간이 그 자리에 **멈춘다**(핀).
   ③ 멈춘 채로 「잠금」 거리만큼 더 스크롤하는 동안, 글이 위 덩이부터 차례로
      왼쪽→오른쪽 스윽 드러난다. 잠금의 80%(끝몫) 지점에서 전부 다 보이고,
      나머지 20% 는 다 보인 채로 잠깐 머문다.
   ④ 잠금이 끝나면 다시 평소처럼 위로 스크롤돼 올라간다.

   [멈춤(핀)은 어떻게 하나]
   멈춰 보이려면 「스크롤로 올라간 만큼 다시 아래로」 밀어 주면 된다.
   · 스크롤에 묶인 CSS 애니메이션(animation-timeline: scroll())을 지원하면 → CSS 가 한다.
     스크롤 값이 [핀시작, 핀끝] 사이일 때 translateY 를 0 → 잠금 으로 민다.
     브라우저의 합성 스레드에서 스크롤과 **같은 프레임**에 움직여서 떨림이 없다.
     JS 는 핀시작·핀끝 숫자만 계산해 CSS 변수로 넘겨 준다(창 크기가 바뀔 때만 바뀐다).
   · 지원 안 하면 → JS 가 매 프레임 transform 을 직접 쓴다(한 프레임 늦어 살짝 떨릴 수 있음).
   ※ view() 를 안 쓰는 이유: 이 페이지는 1920 무대를 transform 으로 줄여 보여 주는데,
     view() 는 줄이기 **전** 자리로 계산해서 한참 늦게 움직였다. 그래서 자리를 직접 잰다.

   [자리 재기 — transform 에 속지 않게]
   offsetTop/offsetHeight 는 transform 을 무시한 **원래 배치** 값이다(무대 px).
   핀으로 밀어 놓은 상태에서도 값이 안 변하니 계산이 꼬이지 않는다.
     화면 배율 = 무대속의 실제 폭 / 1920
     핀시작(스크롤 값) = 무대 윗변 + (상자 가운데 × 배율) − 화면높이/2
     핀길이           = 잠금 × 배율

   [덩이별 순서 — 겹치며 차례로]
   덩이 n 개가 진행도를 나눠 쓴다. 각자 「폭」(52%) 만큼 맡고, 시작은 「간격」씩 늦는다.
   폭이 간격보다 넓어서 앞 덩이가 끝나기 전에 다음 덩이가 시작된다 → 파도처럼 이어진다.
     간격 = (1 − 폭) / (n − 1)  → 마지막 덩이가 정확히 1 에서 끝난다.

   [왜 상태(useState)가 아닌가]
   스크롤마다 리액트를 다시 그리면 무겁다. DOM 스타일에 숫자만 직접 쓰고,
   rAF 로 한 프레임에 한 번만 계산한다. 값이 안 바뀌면 아무것도 안 쓴다.

   [useLayoutEffect]
   첫 그림이 나가기 **전에** 0 을 넣어야 한다. useEffect 면 다 보였다가 사라지는 깜빡임이 생긴다.
   ═══════════════════════════════════════════════════════ */
/* 무대 안에서의 세로 자리(무대 px) — offsetTop 을 무대속까지 거슬러 올라가며 더한다.
   구간이 밀림 상자(시작화면.jsx) 안에 들어가면 offsetTop 이 **그 상자 기준**이 되므로,
   한 칸만 보면 틀린다. transform 은 여전히 무시되니 핀으로 밀어 둔 상태에서도 값이 같다. */
function 무대속위치(el, 무대속) {
  let y = 0;
  for (let e = el; e && e !== 무대속; e = e.offsetParent) y += e.offsetTop;
  return y;
}

/* 핀이름   : 같이 멈출 요소들의 class (구간마다 다르게 — "앙암핀", "영상핀")
   진행쓰기 : true 면 판에 --들어옴(가운데로 올라오는 동안 0→1)·--진행(멈춘 뒤 0→1)을 써 준다.
              그림 확대·밝기처럼 글 말고도 스크롤에 묶을 게 있을 때 CSS 가 이 값을 쓴다. */
/* 글시작 : 멈춘 뒤 이 비율(0~1)까지는 글을 숨겨 둔다 — 그동안 그림이 먼저 움직인다(사건 파일의 카메라) */
export function use스윽({ 잠금 = 600, 폭 = 0.52, 끝몫 = 0.8, 핀이름 = "앙암핀", 진행쓰기 = false, 글시작 = 0 } = {}) {
  const 판 = useRef(null);

  useLayoutEffect(() => {
    const 바깥 = 판.current;
    const 무대속 = 바깥?.closest(".무대속");
    if (!바깥 || !무대속) return;
    const 덩이들 = [...바깥.querySelectorAll(".스윽")];
    const 핀들 = [...document.querySelectorAll(`.${핀이름}`)]; // 같이 멈출 것들
    const CSS핀 = CSS로된다("scroll()");
    /* 동작 줄이기를 켠 사람: 글은 처음부터 다 보이게(멈춤 자리는 그대로 둔다 — 움직임이 아니라 자리라서) */
    const 줄임 = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (줄임) 덩이들.forEach((el) => el.classList.add("다봄"));

    const 간격 = 덩이들.length > 1 ? (1 - 폭) / (덩이들.length - 1) : 0;
    const 이전 = new Map(); // 같은 값을 또 쓰지 않도록 마지막 값을 기억
    let 이전핀 = ""; // 지난번에 넘긴 핀시작·핀끝

    let 예약 = 0;
    const 그리기 = () => {
      예약 = 0;
      const 높이 = window.innerHeight;
      const 속상자 = 무대속.getBoundingClientRect();
      const 배율 = 속상자.width / (무대속.offsetWidth || 1920); // 1920 무대가 몇 배로 줄었나
      const 무대윗변 = 속상자.top + window.scrollY; // 문서 맨 위에서 무대까지
      const 가운데 = 무대속위치(바깥, 무대속) + 바깥.offsetHeight / 2; // 판 세로 가운데(무대 px, transform 무시)
      const 핀시작 = Math.round(무대윗변 + 가운데 * 배율 - 높이 / 2);
      const 핀길이 = Math.round(잠금 * 배율);

      /* ── 멈춤(핀) ── */
      const 핀값 = `${핀시작}|${핀길이}`;
      if (CSS핀 && 핀값 !== 이전핀) {
        이전핀 = 핀값;
        for (const el of 핀들) {
          el.style.setProperty("--핀시작", `${핀시작}px`);
          el.style.setProperty("--핀끝", `${핀시작 + 핀길이}px`);
          el.style.setProperty("--핀거리", `${잠금}px`);
          el.classList.add("핀켜짐"); // 숫자가 준비된 뒤에야 CSS 애니메이션을 켠다
        }
      }
      const 지남 = Math.min(핀길이, Math.max(0, window.scrollY - 핀시작)); // 멈춘 뒤 스크롤한 거리(화면 px)
      if (!CSS핀) {
        const 밀기 = `translate3d(0, ${(지남 / 배율).toFixed(2)}px, 0)`; // 화면 px → 무대 px
        for (const el of 핀들) el.style.transform = 밀기;
      }
      /* ── 진행 값 ── CSS 가 그림 확대·밝기 등에 쓴다 (소수 셋째 자리까지만 — 같은 값은 안 쓴다) */
      if (진행쓰기) {
        const 들어옴 = Math.min(1, Math.max(0, 1 - (핀시작 - window.scrollY) / 높이)); // 한 화면 전부터 0 → 멈추는 순간 1
        const 진행 = 핀길이 > 0 ? 지남 / 핀길이 : 1;
        const 값 = `${들어옴.toFixed(3)}|${진행.toFixed(3)}`;
        if (이전.get(바깥) !== 값) {
          이전.set(바깥, 값);
          바깥.style.setProperty("--들어옴", 들어옴.toFixed(3));
          바깥.style.setProperty("--진행", 줄임 ? "1" : 진행.toFixed(3));
        }
      }
      if (줄임) return;

      /* ── 스윽 드러나기 ── 멈춘 뒤 스크롤한 만큼(끝몫까지 가면 1) */
      const 전체 = 핀길이 > 0 ? (지남 / 핀길이 - 글시작) / Math.max(0.01, 끝몫 - 글시작) : 1;
      덩이들.forEach((el, 번호) => {
        /* 이 덩이가 맡은 구간 [번호×간격, 번호×간격+폭] 안에서 얼마나 왔나 */
        let 몫 = (전체 - 번호 * 간격) / 폭;
        몫 = Math.min(1, Math.max(0, 몫));
        몫 = Math.round(몫 * 1000) / 1000; // 소수 셋째 자리면 충분
        if (이전.get(el) === 몫) return;
        이전.set(el, 몫);
        el.style.setProperty("--스윽", String(몫));
        el.classList.toggle("다봄", 몫 >= 1); // 다 보이면 가면을 벗긴다
      });
    };
    const 예약하기 = () => {
      if (!예약) 예약 = requestAnimationFrame(그리기);
    };
    그리기(); // 첫 그림 전에 한 번
    window.addEventListener("scroll", 예약하기, { passive: true });
    window.addEventListener("resize", 예약하기);
    /* 위쪽 구간 높이가 바뀌면(영상·폰트 늦게 로드 등) 무대 자리가 달라진다 → 다시 잰다 */
    const 크기관찰 = new ResizeObserver(예약하기);
    크기관찰.observe(document.body);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("scroll", 예약하기);
      window.removeEventListener("resize", 예약하기);
      크기관찰.disconnect();
    };
  }, [잠금, 폭, 끝몫, 핀이름, 진행쓰기, 글시작]);

  return 판;
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
   스크롤 구간 — 「이 요소가 화면 어디쯤일 때 애니메이션을 돌릴지」를 직접 재서 CSS 에 넘긴다

   [왜 view() 를 안 쓰나]
   CSS 의 view() 타임라인은 요소 자리를 **transform 을 빼고** 잰다. 이 페이지는 1920 무대를
   transform: scale 로 줄여 보여 줘서, 1440 화면이면 실제 자리와 수백 px 어긋난다.
   (실측: 1440 에서 지역선택 사진이 끝까지 1.42배로 커진 채 한 번도 줄어들지 않았다)

   [어떻게]
   요소의 문서 위치를 「무대 윗변 + 무대 안 자리 × 배율」로 직접 계산하고,
   CSS 의 view() 와 같은 뜻의 구간(entry·cover·exit + 비율)을 **스크롤 값(px)** 으로 바꿔
   --구간시작 · --구간끝 에 넣는다. 애니메이션은 scroll(root) 타임라인이 합성 스레드에서 돌린다.
     entry x : 요소 윗변이 화면 아래에서 x × 요소높이 만큼 들어왔을 때
     cover x : 화면 아래 닿음(0) ~ 위로 다 빠짐(1) 사이의 x 지점
     exit  x : 요소 윗변이 화면 위에 닿은 뒤 x × 요소높이 만큼 더 올라갔을 때
   스크롤마다 계산하지 않는다 — 창 크기·페이지 높이가 바뀔 때만 다시 잰다.
   ═══════════════════════════════════════════════════════ */
function 구간값([종류, x], 위, 높이, 창) {
  if (종류 === "entry") return 위 - 창 + x * 높이;
  if (종류 === "exit") return 위 + x * 높이;
  return 위 - 창 + x * (창 + 높이); // cover
}
export function use스크롤구간(칸, { 시작 = ["entry", 0], 끝 = ["exit", 1] } = {}) {
  const 시작글 = 시작.join(" ");
  const 끝글 = 끝.join(" ");
  useLayoutEffect(() => {
    const el = 칸.current;
    if (!el || !CSS로된다("scroll()")) return;
    const 무대속 = el.closest(".무대속");
    let 예약 = 0;
    let 이전 = "";
    const 재기 = () => {
      예약 = 0;
      const 창 = window.innerHeight;
      let 배율 = 1;
      let 위;
      if (무대속) {
        const r = 무대속.getBoundingClientRect();
        배율 = r.width / (무대속.offsetWidth || 1920);
        위 = r.top + window.scrollY + 무대속위치(el, 무대속) * 배율;
      } else {
        위 = el.getBoundingClientRect().top + window.scrollY;
      }
      const 높이 = el.offsetHeight * 배율;
      const a = Math.round(구간값(시작, 위, 높이, 창));
      const b = Math.round(구간값(끝, 위, 높이, 창));
      const 값 = `${a}|${b}`;
      if (값 === 이전) return;
      이전 = 값;
      el.style.setProperty("--구간시작", `${a}px`);
      el.style.setProperty("--구간끝", `${b}px`);
      el.classList.add("구간켜짐"); // 숫자가 들어간 뒤에야 애니메이션을 켠다
    };
    const 예약하기 = () => { if (!예약) 예약 = requestAnimationFrame(재기); };
    재기();
    window.addEventListener("resize", 예약하기);
    const 크기관찰 = new ResizeObserver(예약하기); // 위쪽 구간이 늦게 커져도 다시 잰다
    크기관찰.observe(document.body);
    return () => {
      if (예약) cancelAnimationFrame(예약);
      window.removeEventListener("resize", 예약하기);
      크기관찰.disconnect();
    };
    // 시작·끝은 글자로 바꿔 비교한다(배열은 매번 새로 만들어져 의존성이 늘 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [칸, 시작글, 끝글]);
}

/** 지역선택 사진 — 확대샷으로 시작해서 들어오는 동안 제 크기로 물러난다 (index.css .멀어지며) */
export function use멀어지며() {
  const 칸 = useRef(null);
  use스크롤구간(칸, { 시작: ["entry", 0.1], 끝: ["cover", 0.42] });
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
    /* CSS 가 맡을 수 있으면 여기선 손을 뗀다 (.지나가며 + use스크롤구간) */
    if (CSS로된다("scroll()")) return;

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

  /* 지원하는 브라우저에선 구간만 재서 CSS(scroll 타임라인)에 넘긴다 — 아래에서 들어올 때부터 위로 다 빠질 때까지 */
  use스크롤구간(칸, { 시작: ["entry", 0], 끝: ["exit", 1] });

  return 칸;
}

/* ═══════════════════════════════════════════════════════
   지금 스크롤하는 중인가

   [왜 필요한가]
   뒤에 깔린 입체 공간이 늘 켜져 있으면, 글을 읽는 동안에도 계속 뭔가
   움직인다. 격자와 조각이 글자 뒤를 지나가면 **글이 잘 안 읽힌다.**
   움직이는 동안에만 보이고 멈추면 사라지게 하면, 읽을 때는 조용하고
   넘길 때는 공간이 살아난다.

   멈춤 판정을 너무 짧게 잡으면 스크롤 중간중간 깜빡인다(손가락을 떼는
   찰나마다 꺼진다). 900ms 쯤 기다려야 「이제 읽는구나」로 읽힌다.
   ═══════════════════════════════════════════════════════ */
export function use스크롤중(멈춤 = 900) {
  const [중, set중] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    let 시계 = 0;
    let 지금 = false;
    const 움직임 = () => {
      /* 쪽 이동이 부른 scrollTo(0) 은 사람이 굴린 게 아니다 — 한 번 건너뛴다 */
      if (window.__프로그램스크롤) { window.__프로그램스크롤 = false; return; }
      /* 스크롤 이벤트마다 setState 를 부르지 않는다 — 바뀔 때만 */
      if (!지금) { 지금 = true; set중(true); }
      clearTimeout(시계);
      시계 = window.setTimeout(() => { 지금 = false; set중(false); }, 멈춤);
    };
    window.addEventListener("scroll", 움직임, { passive: true });
    return () => {
      clearTimeout(시계);
      window.removeEventListener("scroll", 움직임);
    };
  }, [멈춤]);

  return 중;
}
