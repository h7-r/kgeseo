import type { CSSProperties } from "react";

import { usePinnedWipe } from "@/hooks/motion";
import { FONT } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR } from "@/styles/tokens";

import { CASE_FILE_PIN_LENGTH } from "./homeLayout";

const FACTS = [
  ["장소", "전라남도 나주 · 앙암바위"],
  ["설화", "아랑사와 아비사"],
  ["상태", "왜곡 감지"],
] as const;

/**
 * 사건 파일. 앙암바위 절경이 가운데에 멈춘 채 스크롤한 만큼 열린다.
 * 멈춘 뒤 앞 42% 는 카메라가 뒤로 빠지며 밝아지고, 나머지 동안 글이 차례로 드러난다.
 * 그림의 확대·기울기·밝기는 CSS(.case-file)가 --enter·--progress 로 계산한다.
 */
export default function CaseFile() {
  const panelRef = usePinnedWipe<HTMLElement>({
    pinLength: CASE_FILE_PIN_LENGTH,
    pinClass: "case-file-pin",
    writeProgress: true,
    span: 0.5,
    revealEnd: 0.9,
    textStart: 0.42,
  });

  return (
    <section ref={panelRef} className="case-file-pin case-file" style={sectionStyle} {...sectionAnchor("case-file")}>
      {/* decoding="async" — 그림 풀기를 주 스레드 밖에서 해 스크롤이 안 끊긴다. */}
      <div className="case-file__window">
        <img
          className="case-file__image"
          src="/case.webp"
          alt="안개 낀 영산강 위로 솟은 앙암바위 절벽"
          loading="lazy"
          decoding="async"
          width="1920"
          height="1085"
        />
      </div>
      {/* 아래·왼쪽을 어둡게 해 그림 위에서도 글이 읽히게 한다. */}
      <div className="case-file__shade" aria-hidden="true" />

      <div style={textBlockStyle}>
        <div className="wipe" style={eyebrowStyle}>
          <span style={dotStyle} aria-hidden="true" />
          CASE FILE · NAJU-01 · 영산포
        </div>
        <h2 className="wipe" style={titleStyle}>
          영산강 절벽 위,
          <br />
          약속은 돌아오지 않았다.
        </h2>
        <p className="wipe" style={bodyStyle}>
          영산포와 앙암바위 일대에서 사람들의 기억과 기록이 서로 어긋나기 시작했다.
          <br />
          합동수사본부는 현장 조사관을 이곳에 투입한다.
        </p>
        <div className="wipe" style={factRowStyle}>
          {FACTS.map(([label, value]) => (
            <div key={label} style={factCellStyle}>
              <span style={factLabelStyle}>{label}</span>
              <span style={label === "상태" ? alertValueStyle : factValueStyle}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const sectionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: "2711px",
  width: "1920px",
  height: "1047px",
  overflow: "hidden",
  // 그림 평균색. 그림이 오기 전에도 검은 구멍 대신 안개 낀 회색으로 보인다.
  background: "#5d6163",
  borderTop: `1px solid ${COLOR.border}`,
  borderBottom: `1px solid ${COLOR.border}`,
  boxSizing: "border-box",
};

const textBlockStyle: CSSProperties = {
  position: "absolute",
  left: "188px",
  bottom: "140px",
  width: "980px",
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  zIndex: 2,
};

const eyebrowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontFamily: FONT.mono,
  fontSize: "18px",
  letterSpacing: "2.4px",
  color: "#c9d2ee",
};

const dotStyle: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: COLOR.danger,
  boxShadow: "0 0 12px rgba(248,113,113,0.8)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: "84px",
  lineHeight: 1.12,
  letterSpacing: "-0.5px",
  color: "#f5f6fb",
  textShadow: "0 4px 30px rgba(0,0,0,0.45)",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "24px",
  lineHeight: 1.7,
  color: "#d5dbe7",
  textShadow: "0 2px 16px rgba(0,0,0,0.5)",
};

const factRowStyle: CSSProperties = { display: "flex", gap: "12px" };

const factCellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "14px 20px",
  borderRadius: "12px",
  background: "rgba(5,11,26,0.55)",
  border: "1px solid rgba(111,134,191,0.35)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const factLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "14px",
  letterSpacing: "1px",
  color: "#8b9bc4",
};

const factValueStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "20px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};

const alertValueStyle: CSSProperties = { ...factValueStyle, color: "#fca5a5" };
