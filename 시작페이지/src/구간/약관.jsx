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

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "36px 40px", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
        {약관내용[탭].map((덩이, i) =>
          덩이.꼴 === "제목" ? (
            <p key={i} style={제목}>
              {덩이.글}
            </p>
          ) : (
            <div key={i} style={문단칸}>
              {덩이.글.map((줄, j) => (
                // 마지막 줄만 아래 여백이 없다 (원본 그대로)
                <p key={j} style={{ margin: 0, marginBottom: j === 덩이.글.length - 1 ? 0 : "20px", lineHeight: 2 }}>
                  {줄}
                </p>
              ))}
            </div>
          ),
        )}
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

const 문단칸 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "16px",
  color: "#64748b",
  width: "100%",
  whiteSpace: "pre-wrap",
};
