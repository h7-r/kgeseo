import 에셋 from "../에셋.js";
import { useNavigate } from "react-router-dom";
import { 글꼴 } from "../공통.js";
import { 눌러이동 } from "../이동표.js";

/* footer — 피그마 14:1333 (1919.773 × 159.2, y=8663) 페이지 맨 아래 띠 */

const 메뉴 = ["탐험", "지역 맵", "퀘스트", "보상"];

export default function 푸터() {
  const 누름 = 눌러이동(useNavigate());

  return (
    <footer style={바깥} data-바닥="1" data-node-id="14:1333">
      <div style={{ ...가운뎃줄, width: "1760px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "22px", color: "#eeeeff", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ESCAPE THE LEGEND
          </span>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", color: "#4d8ff7", whiteSpace: "nowrap" }}>
            · 지역 탐험 방탈출 2026
          </span>
        </div>

        <div style={{ display: "flex", gap: "32px", alignItems: "center", justifySelf: "center", fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", color: "#1e46c1", whiteSpace: "nowrap" }}>
          {메뉴.map((이름) => (
            <span key={이름} className="링크" style={{ cursor: "pointer" }} onClick={() => 누름(이름)}>
              {이름}
            </span>
          ))}
        </div>

        <span style={{ justifySelf: "end", fontFamily: 글꼴.모노, fontSize: "18px", color: "#5596f8", whiteSpace: "nowrap" }}>
          ™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.
        </span>
      </div>
    </footer>
  );
}

const 가운뎃줄 = {
  display: "grid",
  /* 가운데 칸을 **화면 한가운데**에 못 박는다.
     space-between 으로 두면 좌우 글 길이가 달라 가운데 링크가 한쪽으로 쏠린다
     (실제로 910 에 있었다 — 960 에서 50px 왼쪽). */
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  overflow: "hidden",
};

const 바깥 = {
  position: "absolute",
  left: "-0.02px",
  bottom: 0,
  width: "1919.773px",
  /* 원본(161)은 글줄 아래로 94px 이 그냥 비어 있었다. 글줄 한 줄만 있는
     띠라 위아래 28px 씩만 두고 줄인다 — 푸터가 끝이라는 게 분명해진다. */
  height: "98px",
  background: "#060b1c",
  borderTop: "1px solid #40454d",
  padding: "32px 80px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};
