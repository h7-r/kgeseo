import { useEffect, useRef } from "react";
import { use드러내기 } from "./움직임.js";

/* ═══════════════════════════════════════════════════════
   연출 부품 모음 — 3D 웹사이트에서 흔히 쓰는 장치들

   여기 있는 건 전부 **transform 과 opacity 만** 건드린다. 배치를 다시
   재게 만드는 속성(width·top·margin)은 쓰지 않아서, 애니메이션이 아무리
   많아도 스크롤이 끊기지 않는다.

   담긴 것
   · 오르는글  — 제목이 바닥에서 **누워 있다가 일어선다**(rotateX)
   · 자석단추  — 커서가 가까이 오면 단추가 끌려온다

   [커서를 따라다니는 장식은 뺐다]
   넓은 빛 → 유리 물방울 순으로 두 번 넣어 봤는데 둘 다 나빴다.
   이 페이지 바탕이 거의 검정(#02040a)이라 **뒤에 비칠 것이 없다.**
   빛을 깔면 검정이 회색으로 떠서 얼룩처럼 보이고, backdrop-filter 로
   밝혀도 마찬가지다. 글이나 그림 위에 있을 때만 말이 되는 효과인데,
   이 화면은 대부분이 빈 바탕이라 얼룩이 되는 시간이 더 길다.
   커서 연출이 필요하면 **채우는 방식 말고 선으로** 가야 한다(얇은 고리).
   ═══════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────
   오르는 글

   한 덩이로 페이드시키면 「나타났다」로 끝난다. 낱말을 하나씩 세우면
   시선이 왼쪽에서 오른쪽으로 끌려가서 문장을 **읽게** 만든다.

   [왜 낱말 단위인가]
   글자 단위로 쪼개면 한글은 조합형이라 자모가 따로 놀고, 스크린리더가
   한 글자씩 읽어 버린다. 낱말이 읽기와 접근성 사이의 타협점이다.
   원문은 aria-label 로 통째로 남겨 둔다.
   ─────────────────────────────────────────────────────── */
export function 오르는글({ 글, 간격 = 55, 쪼갬 = true, 태그: 태그 = "div", style, className }) {
  const [칸, 보임] = use드러내기("0px 0px -18% 0px");
  const 낱말 = String(글).split(" ");
  const 태그이름 = 태그;

  /* ★ 그라디언트 글자는 쪼개면 안 된다.
     background-clip: text 는 **그 요소의 배경**을 제 글자 모양으로 자른다.
     낱말마다 transform 을 걸면 낱말이 각자 따로 합성돼서, 부모의 잘린 배경을
     낱말별로 나눠 가질 수가 없다 — 글자가 통째로 사라진다.
     그래서 그라디언트 제목은 줄 전체를 한 덩이로 세운다. */
  if (!쪼갬) {
    return (
      <태그이름 className={className} style={{ perspective: "900px", perspectiveOrigin: "50% 100%" }}>
        <span
          ref={칸}
          className={`오르는낱말${보임 ? " 섬" : ""}`}
          style={{ ...style, display: "inline-block" }}
        >
          {글}
        </span>
      </태그이름>
    );
  }

  return (
    <태그이름
      ref={칸}
      className={className}
      aria-label={글}
      style={{ ...style, perspective: "900px", perspectiveOrigin: "50% 100%" }}
    >
      {낱말.map((ㄴ, i) => (
        <span
          key={`${ㄴ}-${i}`}
          aria-hidden="true"
          className={`오르는낱말${보임 ? " 섬" : ""}`}
          style={{ transitionDelay: `${i * 간격}ms` }}
        >
          {ㄴ}
          {i < 낱말.length - 1 ? " " : ""}
        </span>
      ))}
    </태그이름>
  );
}

/* ───────────────────────────────────────────────────────
   자석 단추

   커서가 단추 위를 지나면 단추가 그쪽으로 조금 끌려간다. 「누를 수 있다」를
   말이 아니라 **움직임으로** 알려 주는 장치라, 중요한 단추 하나둘에만 쓴다.
   모든 단추에 걸면 화면이 산만해진다.

   [왜 transition 을 안 쓰나]
   따라올 땐 매 프레임 자리가 바뀌므로 transition 이 끼면 늘 뒤처진다.
   따라올 때는 즉시 쓰고, **손이 떠날 때만** 되돌아가는 전환을 켠다.
   ─────────────────────────────────────────────────────── */
export function use자석({ 당김 = 0.28, 최대 = 14 } = {}) {
  const 칸 = useRef(null);

  const 움직임 = (e) => {
    const el = 칸.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const x = Math.max(-최대, Math.min(최대, dx * 당김));
    const y = Math.max(-최대, Math.min(최대, dy * 당김));
    el.style.transition = "none";
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  };

  const 나감 = () => {
    const el = 칸.current;
    if (!el) return;
    /* 되돌아갈 때만 부드럽게 — 살짝 지나쳤다 제자리로 오는 느낌 */
    el.style.transition = "transform .45s cubic-bezier(0.23, 1, 0.32, 1)";
    el.style.transform = "translate3d(0, 0, 0)";
  };

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const el = 칸.current;
    if (!el) return undefined;
    el.addEventListener("mousemove", 움직임);
    el.addEventListener("mouseleave", 나감);
    return () => {
      el.removeEventListener("mousemove", 움직임);
      el.removeEventListener("mouseleave", 나감);
    };
  }, []);

  return 칸;
}
