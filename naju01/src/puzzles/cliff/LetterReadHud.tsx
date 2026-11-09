/**
 * 주머니 열어 보기 — 아랑사의 주머니 속(편지 두 장 · 가락지 한 쌍)을 보고, 편지를 한 장씩 펴 읽는 화면(Canvas 밖 DOM).
 * [E] · [→] 로 다음 장, [←] 로 앞 장. 마지막 장에서 [E] 나 [Esc] 로 접는다. 접으면 편지는 힌트함([H])에 들어가 다시 읽을 수 있다.
 * 열려 있는 동안 [E] 는 여기서 받아 다른 것에 안 닿는다
 */
import { useEffect, useMemo, type CSSProperties } from "react";

import { setKeyInterceptor } from "../interaction";
import { POUCH_PAGES, closeLetters, getPageCanvas, pageTitle, turnLetter, useLetterView } from "./letters";

export default function LetterReadHud() {
  const { isOpen, page } = useLetterView();
  const src = useMemo(() => (isOpen ? getPageCanvas(page).toDataURL("image/png") : ""), [isOpen, page]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setKeyInterceptor(() => {
      turnLetter(1);
      return true;
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") closeLetters();
      else if (event.code === "ArrowRight") turnLetter(1);
      else if (event.code === "ArrowLeft") turnLetter(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      setKeyInterceptor(null);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const isPouch = page === 0;
  const isLast = page === POUCH_PAGES - 1;
  return (
    <div style={backdropStyle}>
      <div style={captionStyle}>
        {isPouch ? "아랑사의 주머니" : "아랑사의 편지"} <span style={{ opacity: 0.5 }}>·</span> {pageTitle(page)}
        <span style={pageStyle}>
          {page + 1} / {POUCH_PAGES}
        </span>
      </div>
      <img
        src={src}
        alt={`아랑사의 주머니 ${pageTitle(page)}`}
        style={isPouch ? pouchStyle : paperStyle}
        draggable={false}
      />
      {isPouch && <div style={noteStyle}>접은 편지 두 장 · 조가비를 갈아 만든 가락지 한 쌍</div>}
      <div style={hintStyle}>
        {page > 0 && (
          <>
            <span style={keyStyle}>←</span> 앞 장 <span style={{ opacity: 0.5 }}>·</span>
          </>
        )}
        <span style={keyStyle}>E</span> {isPouch ? "편지 펴기" : isLast ? "접어 넣기" : "다음 장"}
      </div>
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  background: "radial-gradient(ellipse at center, rgba(6,5,4,.62) 0%, rgba(6,5,4,.86) 70%)",
  pointerEvents: "none",
};

const captionStyle: CSSProperties = {
  color: "rgba(242,238,228,.86)",
  font: `700 15px/1 ${FONT}`,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const pageStyle: CSSProperties = {
  marginLeft: 6,
  color: "rgba(242,238,228,.5)",
  font: "600 12px/1 ui-monospace, Menlo, monospace",
};

const paperStyle: CSSProperties = {
  width: "min(68vw, 980px)",
  maxHeight: "72vh",
  objectFit: "contain",
  transform: "rotate(-0.6deg)",
  // 종이 가장자리가 들쭉날쭉하다 — 그림자도 그 모양을 따른다
  filter: "drop-shadow(0 26px 34px rgba(0,0,0,.62)) brightness(1.04)",
};

/** 주머니 속 그림 — 종이가 아니라 흙바닥이라 기울이지 않는다 */
const pouchStyle: CSSProperties = {
  ...paperStyle,
  transform: "none",
  borderRadius: 10,
  filter: "none",
  boxShadow: "0 30px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(242,238,228,.08)",
};

const noteStyle: CSSProperties = {
  color: "rgba(242,238,228,.9)",
  font: `700 15px/1 ${FONT}`,
};

const hintStyle: CSSProperties = {
  color: "rgba(242,238,228,.78)",
  font: `600 13px/1 ${FONT}`,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const keyStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: 5,
  background: "#F2C89A",
  color: "#2A2018",
  font: "700 11px/1 ui-monospace, Menlo, monospace",
};
