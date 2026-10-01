import { 글꼴 } from "../공통.js";
import { 약관탭목록, 약관내용, 약관높이 } from "../데이터/약관탭.js";

/* 약관·법적 고지 — 피그마 94:1132~94:1135 · 168:366 (폭 1760, 높이는 탭마다 다름) */

export default function 약관({ 탭 = "이용약관", 위 = 0, 왼쪽 = 80, 폭 = 1760, 탭누르기 = () => {} }) {
  return (
    <section style={{ ...바깥, top: `${위}px`, left: `${왼쪽}px`, width: `${폭}px`, minHeight: `${약관높이[탭]}px` }} data-node-id="94:1132">
      <div style={{ display: "flex", gap: "20px", padding: "20px 40px", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
        {약관탭목록.map((이름) => (
          <div key={이름} className={`탭 ${이름 === 탭 ? "켜짐" : ""}`} style={이름 === 탭 ? 켜진탭 : 꺼진탭} onClick={() => 탭누르기(이름)}>
            {이름}
          </div>
        ))}
      </div>

      <div style={{ height: "1px", width: "100%", background: "rgba(30,58,95,0.5)" }} />

      {/* 조문 사이는 넓게, 한 조문 안의 줄은 촘촘하게 — 그래야 조 단위로 읽힌다 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", padding: "36px 48px 44px", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
        {약관내용[탭].map((덩이, i) => {
          if (덩이.꼴 === "제목") return <p key={i} style={제목}>{덩이.글}</p>;
          if (덩이.꼴 === "조") return <p key={i} style={조제목}>{덩이.글}</p>;
          return (
            <div key={i} style={문단칸}>
              {덩이.글.map((줄, j) => (
                <p key={j} style={{ ...본문줄, marginBottom: j === 덩이.글.length - 1 ? 0 : "10px" }}>
                  {줄}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  background: "rgba(6,13,26,0.3)",
  border: "1px solid rgba(30,58,95,0.6)",
  borderRadius: "16px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  boxSizing: "border-box",
};

const 탭바탕 = {
  display: "flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: "999px",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};
const 켜진탭 = { ...탭바탕, background: "#3b82f6", color: "#ffffff" };
const 꺼진탭 = { ...탭바탕, background: "#0a1220", border: "1px solid #1e3a5f", color: "#94a3b8" };

const 제목 = {
  margin: 0,
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "22px",
  lineHeight: 1.4,
  color: "#eeeeff",
  width: "100%",
};

/* 조문 제목 — 본문보다 밝고 굵게, 위로 한 칸 더 띄운다 */
const 조제목 = {
  margin: 0,
  marginTop: "14px",
  fontFamily: 글꼴.읽기,
  fontWeight: 700,
  fontSize: "17px",
  lineHeight: 1.6,
  color: "#93c5fd",
  letterSpacing: "0.3px",
  width: "100%",
};

const 문단칸 = {
  /* 조문 본문은 여러 줄을 내리읽는 글이라 모노가 아니라 읽기 글꼴을 쓴다 */
  fontFamily: 글꼴.읽기,
  letterSpacing: "-0.1px",
  fontWeight: 400,
  fontSize: "16px",
  color: "#94a3b8",
  width: "100%",
  whiteSpace: "pre-wrap",
  maxWidth: "1500px", /* 한 줄이 너무 길면 눈이 다음 줄을 못 찾는다 */
};

const 본문줄 = {
  margin: 0,
  lineHeight: 1.9,
};
