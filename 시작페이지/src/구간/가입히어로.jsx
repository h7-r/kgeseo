import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트 } from "../공통.js";

/* signup-hero-content — 피그마 90:1053 (560 × 623)
   인증 화면 오른쪽에 붙는 소개 글. */

const 혜택 = [
  ["[01]", "나주 앙암바위 첫 번째 사건 즉시 접근"],
  ["[02]", "수사 기록 저장 및 진행 상황 동기화"],
  ["[03]", "실제 지역 방문 보상 미션 해제"],
];

export default function 가입히어로({ 누름 = () => {} }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", width: "100%" }} data-node-id="90:1053">
      <div style={딱지}>
        <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#93c5fd", letterSpacing: "2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          REGIONAL ESCAPE // COHORT 2026
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
        <div style={{ ...큰글자, color: "#eef8ff" }}>ESCAPE</div>
        <div
          style={{
            ...큰글자,
            ...글자그라디언트("linear-gradient(90deg, #60a5fa 0%, #93c5fd 50%, #1d4ed8 100%)"),
            textShadow: "0px 0px 32px rgba(59,130,246,0.31)",
          }}
        >
          {" THE LEGEND"}
        </div>
      </div>

      <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "16px", color: "#64748b", width: "100%" }}>
        <p style={{ margin: 0, lineHeight: "26px" }}>조사관 등록을 완료하고 합동수사본부에 합류하세요.</p>
        <p style={{ margin: 0, lineHeight: "26px" }}>전국 각지에서 사라진 기록을 추적하고,</p>
        <p style={{ margin: 0, lineHeight: "26px" }}>잊혀진 전설의 진실을 밝혀낼 당신을 기다리고 있습니다.</p>
      </div>

      <div style={혜택칸}>
        {혜택.map(([번호, 글]) => (
          <div key={번호} style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
            <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, color: "#60a5fa", whiteSpace: "nowrap" }}>{번호}</span>
            <span style={{ flex: "1 0 0", minWidth: 0, fontFamily: 글꼴.모노, fontWeight: 400, color: "#eef8ff" }}>{글}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "center", width: "100%" }}>
        <div className="단추" style={채운단추} onClick={() => 누름("게임 소개")}>게임 소개</div>
        <div className="단추" style={빈단추} onClick={() => 누름("지역 탐험하기")}>지역 탐험하기</div>
      </div>
    </div>
  );
}

const 딱지 = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "4px",
  border: "1px solid #1e3a5f",
};

const 큰글자 = { fontFamily: 글꼴.제목, fontSize: "110px", lineHeight: "100px", width: "100%" };

const 혜택칸 = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "20px 0",
  width: "100%",
  fontSize: "16px",
  borderTop: "1px solid #1e3a5f",
  borderBottom: "1px solid #1e3a5f",
  boxSizing: "border-box",
};

const 단추바탕 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "100px",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  cursor: "pointer",
};

const 채운단추 = {
  ...단추바탕,
  padding: "16px 36px",
  fontWeight: 700,
  color: "#ffffff",
  backgroundImage: "linear-gradient(136.78deg, rgb(37,99,235) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 24px 0px rgba(96,165,250,0.13), 0px 4px 16px 0px rgba(59,130,246,0.31)",
};

const 빈단추 = {
  ...단추바탕,
  padding: "16px 32px",
  fontWeight: 500,
  color: "#93c5fd",
  background: "rgba(10,18,32,0.75)",
  border: "1px solid rgba(255,255,255,0.2)",
};
