import { useEffect, useRef, useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   머리띠 검색 — 돋보기를 누르면 옆으로 입력 줄이 열린다

   [지킨 것]
   · **돋보기는 사라지지 않는다.** 엔터를 치는 사람도 있고 돋보기를 누르는
     사람도 있다. 열고 나면 돋보기가 곧 「찾기」 단추가 된다.
   · **로그인 알약을 밀지 않는다.** 입력 줄이 자라면서 옆 것을 밀어내면
     머리띠가 통째로 흔들린다. 그래서 입력 줄은 돋보기 **왼쪽**으로 자라고,
     늘어나는 폭은 왼쪽 빈자리에서 가져온다(오른쪽 것들은 제자리에 있다).
   · 열면 바로 글자를 칠 수 있게 초점을 준다.
   · Esc 로 닫는다. 빈 채로 바깥을 누르면 저절로 닫힌다 —
     쓰다 만 글이 있으면 실수로 닫히지 않게 그대로 둔다.

   [왜 입력 줄이 밑줄 하나인가]
   이 화면의 입력칸은 전부 밑줄이다(로그인·문의). 여기만 네모 상자를 쓰면
   따로 논다. 같은 말투를 지킨다.
   ═══════════════════════════════════════════════════════ */

export default function 머리찾기({ 크기 = 22, 보내기 }) {
  const [열림, set열림] = useState(false);
  const [말, set말] = useState("");
  const 칸 = useRef(null);
  const 입력 = useRef(null);

  /* 열리면 곧바로 칠 수 있게 */
  useEffect(() => {
    if (열림) 입력.current?.focus();
  }, [열림]);

  /* 바깥을 누르면 닫는다 — 단, 쓰다 만 글이 있으면 열어 둔다 */
  useEffect(() => {
    if (!열림) return undefined;
    const 밖 = (e) => {
      if (칸.current?.contains(e.target)) return;
      if (입력.current?.value.trim()) return;
      set열림(false);
    };
    document.addEventListener("mousedown", 밖);
    return () => document.removeEventListener("mousedown", 밖);
  }, [열림]);

  const 찾기누름 = () => {
    if (!열림) {
      set열림(true);
      return;
    }
    const 다듬은 = 말.trim();
    if (!다듬은) {
      /* 빈 채로 돋보기를 누르면 닫는다 — 아무 일도 안 하면 고장으로 보인다 */
      set열림(false);
      return;
    }
    보내기?.(다듬은);
  };

  const 열쇠 = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const 다듬은 = 말.trim();
      if (다듬은) 보내기?.(다듬은);
    } else if (e.key === "Escape") {
      set열림(false);
      set말("");
    }
  };

  return (
    /* ★ 돋보기만 자리를 차지하고, 입력 줄은 그 **왼쪽 허공에 띄운다**(absolute).
       flex 안에 나란히 두면 입력 줄이 자랄 때 오른쪽 로그인 알약을 밀어낸다
       (실제로 187px 밀렸다). 띄워 두면 배치에 끼어들지 않아 아무것도 안 움직인다.
       왼쪽은 메뉴 끝(≈1101)과 돋보기(≈1582) 사이가 비어 있어 겹칠 일이 없다. */
    <div ref={칸} style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
      {/* 입력 줄 — 돋보기 왼쪽으로 자란다 */}
      <div
        style={{
          position: "absolute",
          right: "32px",
          top: "50%",
          transform: "translateY(-50%)",
          /* [왜 width 를 안 움직이나]
             0 → 240px 로 폭을 키우면 매 프레임 배치를 다시 잰다. 자리는
             240px 로 **고정해 두고**, 오른쪽(돋보기 쪽)부터 드러나도록
             잘라내는 범위만 움직인다. 보이는 건 똑같이 「밑줄이 왼쪽으로
             자라는」 모습인데, 배치 계산은 한 번도 다시 하지 않는다. */
          width: "240px",
          clipPath: 열림 ? "inset(0 0 0 0)" : "inset(0 0 0 100%)",
          opacity: 열림 ? 1 : 0,
          pointerEvents: 열림 ? "auto" : "none",
          transition: "clip-path .32s cubic-bezier(0.23, 1, 0.32, 1), opacity .24s ease",
        }}
      >
        <input
          ref={입력}
          className="입력칸 머리찾기칸"
          type="search"
          value={말}
          onChange={(e) => set말(e.target.value)}
          onKeyDown={열쇠}
          /* 닫혀 있을 땐 눈에 안 보이니 탭 차례에서도 빠져야 한다 */
          tabIndex={열림 ? 0 : -1}
          placeholder="무엇을 찾으세요?"
          aria-label="사이트 안에서 찾기"
          style={{
            width: "240px",
            fontFamily: 글꼴.모노,
            fontSize: "15px",
            "--안내색": "rgba(200,205,255,0.35)",
          }}
        />
      </div>

      {/* 돋보기 — 닫혀 있으면 「열기」, 열려 있으면 「찾기」 */}
      <button
        type="button"
        onClick={찾기누름}
        aria-label={열림 ? "찾기" : "검색 열기"}
        aria-expanded={열림}
        style={돋보기단추}
      >
        <img src={에셋.imgSearchIcon} alt="" style={{ width: `${크기}px`, height: `${크기}px`, display: "block" }} />
      </button>
    </div>
  );
}

const 돋보기단추 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  flexShrink: 0,
};
