import { useEffect, useRef } from "react";
import { use드러내기 } from "./움직임.js";

/* ═══════════════════════════════════════════════════════
   연출 부품 모음 — 3D 웹사이트에서 흔히 쓰는 장치들

   여기 있는 건 전부 **transform 과 opacity 만** 건드린다. 배치를 다시
   재게 만드는 속성(width·top·margin)은 쓰지 않아서, 애니메이션이 아무리
   많아도 스크롤이 끊기지 않는다.

   담긴 것
   · 오르는글  — 제목이 바닥에서 **누워 있다가 일어선다**(rotateX)
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
/* 글자클래스 — **글자를 담은 칸**에 붙는다. 바깥 className 은 자리를 잡는
   칸에 붙으므로, background-clip: text 처럼 글자에 걸려야 하는 것은 여기로
   줘야 한다(바깥에 주면 배경이 글자 모양으로 안 잘린다). */
export function 오르는글({ 글, 간격 = 35, 쪼갬 = true, 태그: 태그 = "div", style, className, 글자클래스 }) {
  const [칸, 보임] = use드러내기("0px 0px 30% 0px");
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
          className={`오르는낱말${보임 ? " 섬" : ""}${글자클래스 ? ` ${글자클래스}` : ""}`}
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

