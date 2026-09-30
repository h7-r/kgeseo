import { useEffect, useRef, useState } from "react";
import { use드러내기 } from "./움직임.js";

/* ═══════════════════════════════════════════════════════
   도는 글 — 한 자리에서 문구가 차례로 바뀐다

   [왜 쓰나]
   할 말은 여럿인데 자리는 하나일 때 쓴다. 여섯 줄을 한꺼번에 늘어놓으면
   눈이 어디를 봐야 할지 모르고 그냥 넘긴다. 한 줄씩 바뀌면 **지금 이 한 줄**을
   읽게 된다.

   [지키는 것]
   · 화면 밖이면 멈춘다. 안 보이는 걸 계속 바꾸면 전기만 쓴다.
   · 동작 줄이기를 켠 사람에겐 **첫 줄만** 보여 주고 바꾸지 않는다.
   · 글자가 바뀔 때 칸 높이가 들썩이면 아래 내용이 밀린다. 그래서 가장 긴
     문구만큼 자리를 미리 잡아 두고(숨긴 글), 바뀌는 글은 그 위에 얹는다.
   · 읽는 사람이 멈춰 세울 수 있어야 한다 — 마우스를 올리면 멈춘다.
     (자동으로 바뀌는 것은 읽는 속도가 느린 사람에게 불친절하다)
   ═══════════════════════════════════════════════════════ */

export default function 도는글({ 줄들, 사이 = 3600, style, 글style }) {
  const [칸, 보임] = use드러내기("0px 0px -10% 0px");
  const [몇번째, set몇번째] = useState(0);
  const [멈춤, set멈춤] = useState(false);
  const 줄임 = useRef(false);

  useEffect(() => {
    줄임.current = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!보임 || 멈춤 || 줄임.current || 줄들.length < 2) return undefined;
    const 시계 = window.setInterval(() => set몇번째((n) => (n + 1) % 줄들.length), 사이);
    return () => clearInterval(시계);
  }, [보임, 멈춤, 사이, 줄들.length]);

  const 지금 = 줄들[몇번째] ?? 줄들[0];

  return (
    <div
      ref={칸}
      style={{ position: "relative", ...style }}
      onMouseEnter={() => set멈춤(true)}
      onMouseLeave={() => set멈춤(false)}
      /* 바뀌는 내용이라는 걸 보조기기에도 알린다. polite 라 읽던 걸 끊지 않는다 */
      aria-live="polite"
    >
      {/* 자리만 잡는 숨은 글 — 가장 긴 문구 기준으로 칸 높이를 고정한다 */}
      <span aria-hidden="true" style={{ ...글style, visibility: "hidden", display: "block" }}>
        {줄들.reduce((ㄱ, ㄴ) => (String(ㄴ).length > String(ㄱ).length ? ㄴ : ㄱ), "")}
      </span>

      <span
        key={몇번째}
        className="도는글줄"
        style={{ ...글style, position: "absolute", left: 0, top: 0, right: 0 }}
      >
        {지금}
      </span>
    </div>
  );
}
