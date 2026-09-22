import 에셋 from "../에셋.js";
import { 글꼴 } from "../공통.js";
import { 탭목록, 탭내용 } from "../데이터/게임소개탭.js";

/* ═══════════════════════════════════════════════════════
   게임 소개 — 피그마 86:1319~86:1323 (1920 × 630, 탭 5개)

   ★ 이 구간만 **흰 바탕**이다. 나머지 화면은 전부 어두운 바탕인데
     여기는 라이트 테마다. 원본이 그렇다 — 실수가 아니다.

   탭마다 달라지는 것: 제목 · 정보 줄 · 사진 설명.
   「게임 소개」 탭에만 아래쪽 긴 설명 문단이 붙는다(다른 탭엔 없다).
   ═══════════════════════════════════════════════════════ */

export default function 게임소개({ 탭 = "게임 소개", 위 = 0, 탭누르기 = () => {} }) {
  const ㄴ = 탭내용[탭];

  return (
    <section style={{ ...바깥, top: `${위}px` }} data-node-id="86:1319">
      <div style={{ display: "flex", gap: "20px", width: "100%" }}>
        {탭목록.map((이름) => (
          <div
            key={이름}
            className={`탭 ${이름 === 탭 ? "켜짐" : ""}`}
            style={이름 === 탭 ? 켜진탭 : 꺼진탭}
            onClick={() => 탭누르기(이름)}
          >
            {이름}
          </div>
        ))}
      </div>

      <div style={{ height: "1px", width: "100%", background: "#ebedf2" }} />

      <div style={{ display: "flex", gap: "40px", width: "100%" }}>
        <div style={{ flex: "1 0 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "40px", color: "#1a1a1f", whiteSpace: "nowrap" }}>
            {탭}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", fontSize: "18px" }}>
            {ㄴ.줄.map(([라벨, 값], i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
                <span style={{ fontFamily: 글꼴.모노, fontWeight: 600, color: "#60a5fa", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {라벨}
                </span>
                <span style={{ flex: "1 0 0", minWidth: 0, fontFamily: 글꼴.모노, fontWeight: 400, lineHeight: "22px", color: "#4d5461" }}>
                  {값}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: "1px", width: "100%", background: "#ebedf2" }} />

          {/* 설명은 탭마다 문단 수가 다르다 (1~4개) */}
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", letterSpacing: "0.18px", color: "#8c94a1", width: "100%" }}>
            {ㄴ.설명.map((문단, i) => (
              <p key={i} style={{ margin: 0, lineHeight: "22px" }}>
                {문단}
              </p>
            ))}
          </div>
        </div>

        <div style={사진칸}>
          <div style={사진속}>
            <img src={에셋.imgMonitor} alt="" style={{ width: "28px", height: "28px", display: "block" }} />
            <span style={{ fontFamily: 글꼴.모노, fontWeight: 600, fontSize: "18px", color: "#60a5fa", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {ㄴ.사진제목}
            </span>
            <span style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", lineHeight: "20px", color: "#8c94a1", textAlign: "center", width: "100%" }}>
              {ㄴ.사진설명}
            </span>
          </div>
        </div>
      </div>

      {/* 쪽 번호 152:222 — 칸 안에 절대좌표로 박혀 있다.
           쪽 1~5 는 탭 다섯 개와 짝이다. 원본엔 6번도 그려져 있지만
           **여섯 번째 탭이 없어서** 눌러도 갈 곳이 없다 — 흐리게 둔다. */}
      <div style={쪽번호}>
        <div className="쪽화살표" style={화살표} onClick={() => 탭누르기(탭목록[Math.max(0, ㄴ.쪽 - 2)])}>
          ‹
        </div>
        {탭목록.map((_, i) => i + 1).map((n) => {
          const 갈수있음 = true;
          return (
            <div
              key={n}
              className={`쪽번호칸 ${n === ㄴ.쪽 ? "켜짐" : ""}`}
              style={{ ...(n === ㄴ.쪽 ? 켜진쪽 : 꺼진쪽), cursor: "pointer" }}
              onClick={() => 탭누르기(탭목록[n - 1])}
            >
              {n}
            </div>
          );
        })}
        <div className="쪽화살표" style={화살표} onClick={() => 탭누르기(탭목록[Math.min(탭목록.length - 1, ㄴ.쪽)])}>
          ›
        </div>
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  width: "1920px",
  height: "630px",
  background: "#ffffff",
  padding: "40px 120px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "flex-start",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 탭바탕 = {
  display: "flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: "999px",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};

const 켜진탭 = {
  ...탭바탕,
  background: "#3b82f6",
  color: "#1a1a1f",
  filter: "drop-shadow(0px 8px 9px rgba(59,130,246,0.25))",
};

const 꺼진탭 = {
  ...탭바탕,
  background: "#f2f5f7",
  border: "1px solid #d9dee5",
  color: "#8c94a1",
};

const 사진칸 = {
  width: "520px",
  height: "360px",
  borderRadius: "16px",
  background: "#f2f5f7",
  border: "1px solid #d9dee5",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  boxSizing: "border-box",
  flexShrink: 0,
};

const 사진속 = {
  flex: "1 0 0",
  width: "100%",
  borderRadius: "12px",
  background: "#f2f5f7",
  border: "1px solid #d9dee5",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 쪽번호 = {
  position: "absolute",
  left: "770px",
  top: "534px",
  padding: "20px 0",
  display: "flex",
  gap: "12px",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const 화살표 = {
  width: "40px",
  height: "40px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: 글꼴.본문,
  fontWeight: 400,
  fontSize: "28px",
  color: "#666e80",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const 쪽바탕 = {
  width: "36px",
  height: "36px",
  borderRadius: "18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  boxSizing: "border-box",
};

const 켜진쪽 = { ...쪽바탕, background: "#3b82f6", color: "#ffffff", fontWeight: 700 };
const 꺼진쪽 = { ...쪽바탕, border: "1px solid #d1d6e0", color: "#737a8c", fontWeight: 400 };
