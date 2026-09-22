import { 글꼴 } from "../공통.js";

/* hero-media(영상) — 피그마 14:1262 (1920 × 1047, y=2711)
   히어로와 같은 틀이지만 바탕이 어둡고, 귀퉁이 꺾쇠가 네 곳 다 있다. */

export default function 영상() {
  return (
    <section style={바깥} data-node-id="14:1262">
      <div style={{ ...세로선, pointerEvents: "none" }} />
      <div style={{ ...가로선, pointerEvents: "none" }} />
      {꺾쇠.map((s, i) => (
        <div key={i} style={{ position: "absolute", background: "#3b82f6", borderRadius: "1px", pointerEvents: "none", ...s }} />
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        {/* 재생 단추 14:1392 */}
        <div style={재생}>▶</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
          <div style={영상글자} data-node-id="14:1269">영상</div>
          <div style={자리표시} data-node-id="14:1270">HERO VIDEO PLACEHOLDER</div>
        </div>
      </div>

      {/* 왼쪽 위 LIVE 딱지 14:1395 */}
      <div style={라이브} data-node-id="14:1396">LIVE</div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  top: "2711px",
  width: "1920px",
  height: "1047px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
  borderRadius: "24px",
  overflow: "hidden",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0px 0px 100px 10px rgba(59,130,246,0.13), 0px 20px 60px 0px rgba(29,78,216,0.25)",
};

const 투명파랑 = "rgba(59,130,246,0)";
const 중간파랑 = "rgba(59,130,246,0.25)";

const 세로선 = {
  position: "absolute",
  left: "50%",
  top: "calc(50% + 20.5px)",
  transform: "translate(-50%, -50%)",
  width: "2px",
  height: "200px",
  borderRadius: "1px",
  background: `linear-gradient(180deg, ${투명파랑} 0%, ${중간파랑} 50%, ${투명파랑} 100%)`,
};

const 가로선 = {
  position: "absolute",
  left: "calc(50% + 20px)",
  top: "calc(50% + 0.5px)",
  transform: "translate(-50%, -50%)",
  width: "200px",
  height: "2px",
  borderRadius: "1px",
  background: `linear-gradient(90deg, ${투명파랑} 0%, ${중간파랑} 50%, ${투명파랑} 100%)`,
};

/* 14:1384~14:1391 — 네 귀퉁이 모두 */
const 꺾쇠 = [
  { left: "23px", top: "23px", width: "32px", height: "2px" },
  { left: "23px", top: "23px", width: "2px", height: "32px" },
  { right: "23px", top: "23px", width: "32px", height: "2px" },
  { right: "23px", top: "23px", width: "2px", height: "32px" },
  { left: "23px", bottom: "23px", width: "32px", height: "2px" },
  { left: "23px", bottom: "23px", width: "2px", height: "32px" },
  { right: "23px", bottom: "23px", width: "32px", height: "2px" },
  { right: "23px", bottom: "23px", width: "2px", height: "32px" },
];

const 재생 = {
  width: "80px",
  height: "80px",
  borderRadius: "40px",
  background: "#0a1628",
  border: "1px solid #1e3a5f",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: 글꼴.모노,
  fontSize: "30px",
  color: "#ffffff",
  filter: "drop-shadow(0px 0px 12px rgba(59,130,246,0.31))",
  boxSizing: "border-box",
};

const 영상글자 = {
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "60px",
  color: "#ffffff",
  whiteSpace: "nowrap",
};

const 자리표시 = {
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  color: "#1e3a5f",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const 라이브 = {
  position: "absolute",
  left: "23px",
  top: "23px",
  padding: "4px 12px",
  borderRadius: "12px",
  background: "rgba(10,22,40,0.75)",
  border: "1px solid #1e3a5f",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  color: "#3b82f6",
  textShadow: "0px 0px 6px rgba(59,130,246,0.8)",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
