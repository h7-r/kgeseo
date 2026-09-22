import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 놓기, 중심놓기, 소개폼중심 } from "../공통.js";

const 칸막이 = "1px solid rgba(30,58,95,0.25)";



/* 두 번째 화면 — 큰 제목 + 설명 + 단추 + 숫자 지표
   피그마 18:1006(hero-content) · 18:1007(배지) · 32:14xx(지표들) */

/* [원본 좌표를 그대로 안 쓴 이유]
   피그마는 숫자(32:1409 등)를 캔버스에 **따로 떠 있는 글자**로 두고,
   소개 덩이 안에는 칸막이만 있는 빈 줄(18:1019)을 남겨 놨다.
   좌표대로 옮기면 숫자와 이름이 280px 떨어지고, 행간을 넓히는 순간
   숫자가 단추 위로 올라탄다(실제로 그랬다).
   그래서 **빈 줄 자리에 숫자를 넣었다** — 칸막이가 원래 거기 있으니
   지표 사이 세로선도 자연스럽게 맞는다.
   ∞ 는 원본 칸이 40px 라 잘렸다 — 줄바꿈을 막았다. */
const 지표 = [
  { 값: "50+", 이름: "전국 방탈출 맵", 칸: { width: "129px", paddingRight: "48px", borderRight: 칸막이 } },
  { 값: "100+", 이름: "역사 설화 퀘스트", 칸: { width: "188px", padding: "0 48px", borderRight: 칸막이 } },
  { 값: "∞", 이름: "숨겨진 보상", 칸: { width: "117px", paddingLeft: "48px" } },
];

export default function 소개({ 누름 = () => {} }) {
  return (
    <>
      {/* 본문 18:1006 — 배지(18:1007)도 여기 안에 넣는다.
          원본은 배지를 (255, 1565) 에 따로 띄워 놨는데, 덩이 높이가 바뀌면
          배지만 제자리에 남아 제목과 겹친다(실제로 겹쳤다). 같이 흐르게 둔다. */}
      <div style={{ ...중심놓기(245, 소개폼중심, 755), ...세로쌓기 }} data-node-id="18:1006">
        <div style={배지} data-node-id="18:1007">
          <span style={배지글자}>2026 · REGIONAL ESCAPE ADVENTURE</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ ...큰제목, width: "595px", color: "#eeeeff" }} data-node-id="18:1011">ESCAPE</div>
          <div
            style={{
              ...큰제목,
              width: "652px",
              ...글자그라디언트("linear-gradient(90deg, #60a5fa 0%, #93c5fd 50%, #3b82f6 100%)"),
              textShadow: "0px 0px 40px rgba(59,130,246,0.5)",
            }}
            data-node-id="18:1012"
          >
            THE LEGEND
          </div>
        </div>

        <div style={설명} data-node-id="18:1013">
          <p style={설명줄}>
            각 지역의 역사와 설화를 바탕으로 만들어진 몰입형 방탈출 게임. 퀘스트를 클리어하고 실제 지역을 방문하면 숨겨진 보상이 열린다.
          </p>
          <p style={설명줄}>
            잊혀진 지역의 이야기를 게임으로 되살리고, 당신의 발걸음으로 그 지역을 다시 빛나게 하세요.
          </p>
        </div>

        <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          <div className="단추" style={{ ...채운단추, cursor: "pointer" }} data-node-id="18:1015" onClick={() => 누름("게임 소개")}>게임 소개</div>
          <div className="단추" style={{ ...빈단추, cursor: "pointer" }} data-node-id="18:1017" onClick={() => 누름("지역 탐험하기")}>지역 탐험하기</div>
        </div>

        {/* 18:1019 — 원본은 칸막이만 있는 빈 줄. 여기에 숫자 지표를 넣는다 */}
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", width: "100%" }}>
          {지표.map(({ 값, 이름, 칸 }) => (
            <div key={이름} style={{ ...칸, display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", textAlign: "center", boxSizing: "content-box" }}>
              <div style={지표숫자}>{값}</div>
              <div style={지표이름}>{이름}</div>
            </div>
          ))}
        </div>
      </div>

    </>
  );
}

const 세로쌓기 = { display: "flex", flexDirection: "column", gap: "30px", alignItems: "flex-start" };

const 배지 = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "12px",
  alignItems: "center",
  padding: "10px 20px",
  borderRadius: "20px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
};

const 배지글자 = {
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  color: "#60a5fa",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

/* 원본 행간은 130px 인데 180px 글자에는 너무 붙는다 — 조금 띄웠다 */
const 큰제목 = { fontFamily: 글꼴.제목, fontSize: "180px", lineHeight: "152px" };

const 설명 = {
  fontFamily: 글꼴.본문,
  fontWeight: 300,
  fontSize: "28px",
  letterSpacing: "0.28px",
  color: "#64748b",
  width: "615px",
};

/* 설명 문단 행간도 32 → 40 (원본보다 여유 있게) */
const 설명줄 = { margin: 0, lineHeight: "40px" };

const 단추바탕 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "100px",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};

const 채운단추 = {
  ...단추바탕,
  padding: "18px 48px",
  fontWeight: 700,
  color: "#ffffff",
  backgroundImage: "linear-gradient(139.712deg, rgb(37,99,235) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 48px 0px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
};

const 빈단추 = {
  ...단추바탕,
  padding: "18px 44px",
  fontWeight: 400,
  color: "#93c5fd",
  background: "rgba(10,18,32,0.75)",
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: "0.3px solid #ffffff",
};


const 지표숫자 = {
  fontFamily: 글꼴.제목,
  fontSize: "84px",
  letterSpacing: "2px",
  lineHeight: 1,
  whiteSpace: "nowrap", // "50+" 가 쪼개지거나 ∞ 가 잘리지 않게

  ...글자그라디언트("linear-gradient(90deg, #93c5fd 0%, #60a5fa 100%)"),
};

const 지표이름 = {
  fontFamily: 글꼴.모노,
  fontWeight: 400,
  fontSize: "18px",
  letterSpacing: "2px",
  color: "#334155",
  textTransform: "uppercase",
  lineHeight: "normal",
  whiteSpace: "nowrap",
};
