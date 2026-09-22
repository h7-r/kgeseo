import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   게임영상·캐릭터 페이지의 첫 화면 — 피그마 14:1627 (1920 × 963)

   [주의] 같은 프레임 안에 **다른 히어로 변형**도 들어 있다 —
   14:1521(왼쪽 글, x=119)과 14:1533(오른쪽 「수사 현장」 영상, x=778)이
   짝을 이루는 좌우 배치판이다. 하지만 14:1627 자체를 렌더하면
   **가운데 정렬에 영상 패널이 없다.** 이 페이지는 14:1627 을 따른다.
   좌우 배치판이 필요하면 그 두 노드로 따로 만들어야 한다.
   ═══════════════════════════════════════════════════════ */

export default function 영상히어로({ 위 = 129, 누름 = () => {} }) {
  return (
    <section style={{ ...바깥, top: `${위}px` }} data-node-id="14:1627">
      {꺾쇠.map((s, i) => (
        <div key={i} style={{ position: "absolute", background: "#3b82f6", borderRadius: "1px", pointerEvents: "none", ...s }} />
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center", width: "560px" }} data-node-id="14:1628">
        <div style={눈썹}>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#60a5fa", whiteSpace: "nowrap" }}>
            GAME &amp; CHARACTERS · PULSE 2026
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", width: "100%" }}>
          <div style={제목}>게임영상 및 캐릭터</div>
          <div style={설명}>게임 플레이 영상과 캐릭터 소개를 확인해보세요.</div>
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div className="단추" style={채운단추} onClick={() => 누름("트레일러 보기")}>트레일러 보기</div>
          <div className="단추" style={빈단추} onClick={() => 누름("캐릭터 갤러리 →")}>캐릭터 갤러리 →</div>
        </div>
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: "-7px",
  width: "1920px",
  height: "963px",
  background: "#060d1a",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/* 네 귀퉁이 꺾쇠 */
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

const 눈썹 = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  padding: "6px 16px",
  borderRadius: "20px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
};

const 제목 = {
  fontFamily: 글꼴.제목,
  fontSize: "76px",
  lineHeight: "72px",
  width: "100%",
  textAlign: "center",
  ...글자그라디언트("linear-gradient(90deg, #ffffff 0%, #93c5fd 100%)"),
};

const 설명 = {
  fontFamily: 글꼴.모노,
  fontWeight: 300,
  fontSize: "18px",
  lineHeight: "28px",
  color: "#64748b",
  textAlign: "center",
  width: "547px",
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
  cursor: "pointer",
  boxSizing: "border-box",
};
const 채운단추 = {
  ...단추바탕,
  padding: "14px 36px",
  fontWeight: 700,
  color: "#ffffff",
  backgroundImage: "linear-gradient(140deg, rgb(37,99,235) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 24px 0px rgba(96,165,250,0.13), 0px 4px 16px 0px rgba(59,130,246,0.31)",
};
const 빈단추 = {
  ...단추바탕,
  padding: "14px 32px",
  fontWeight: 400,
  color: "#93c5fd",
  background: "rgba(10,18,32,0.75)",
  border: "1px solid rgba(255,255,255,0.2)",
};
