import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내 } from "../공통.js";

/* footer — 피그마 14:1333 (1919.773 × 159.2, y=8663) 페이지 맨 아래 띠 */

const 메뉴 = ["탐험", "지역 맵", "퀘스트", "보상"];

export default function 푸터() {
  return (
    <footer style={바깥} data-바닥="1" data-node-id="14:1333">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "1760px", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "22px", color: "#eeeeff", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ESCAPE THE LEGEND
          </span>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", color: "#4d8ff7", whiteSpace: "nowrap" }}>
            · 지역 탐험 방탈출 2026
          </span>
        </div>

        <div style={{ display: "flex", gap: "32px", alignItems: "center", fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", color: "#1e46c1", whiteSpace: "nowrap" }}>
          {메뉴.map((이름) => (
            <span key={이름} style={막음} title={막음안내}>
              {이름}
            </span>
          ))}
        </div>

        <span style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#5596f8", whiteSpace: "nowrap" }}>
          ™ &amp; © 2026 ESCAPE THE LEGEND. All Rights Reserved.
        </span>
      </div>
    </footer>
  );
}

const 바깥 = {
  position: "absolute",
  left: "-0.02px",
  bottom: 0,
  width: "1919.773px",
  height: "159.2px",
  background: "#060b1c",
  borderTop: "1px solid #40454d",
  padding: "36px 80px 24px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  boxSizing: "border-box",
};
