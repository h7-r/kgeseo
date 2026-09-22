import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트 } from "../공통.js";

/* closing-footer — 피그마 136:1251 (1908 × 995, y=7216)
   마지막으로 미는 구간. 위아래에 레이저 선과 심전도 그래프가 붙는다. */

export default function 마무리({ 누름 = () => {} }) {
  return (
    <section style={바깥} data-node-id="136:1251">
      {/* 뒤에서 번지는 빛 136:1253 */}
      <div style={{ position: "absolute", left: "555px", top: "-36px", width: "798px", height: "815px", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-30.67%", bottom: "-30.67%", left: "-31.33%", right: "-31.33%" }}>
          <img src={에셋.imgAmbientRadialGlowRight} alt="" style={꽉} />
        </div>
      </div>

      {/* 맨 위 레이저 선 136:1254 */}
      <div style={{ display: "flex", height: "10px", justifyContent: "center", width: "100%", position: "relative" }}>
        <img src={에셋.imgVariant6} alt="" style={{ width: "800px", height: "10px", display: "block" }} />
      </div>

      <div style={본문}>
        <div style={딱지} data-node-id="136:1259">
          <span style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#60a5fa", letterSpacing: "2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ARE YOU READY TO ESCAPE?
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", height: "278px", textAlign: "center", width: "100%" }}>
          <div style={큰제목} data-node-id="136:1263">전설이 당신을 기다립니다</div>
          {/* 원본은 앞에 빈 줄이 두 개 있다 — 그만큼 아래로 내려가 있다 */}
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "26px", color: "#47628a", letterSpacing: "1px", width: "608px", whiteSpace: "pre-wrap" }} data-node-id="136:1264">
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"지금 바로 당신의 본능과 지혜를 시험해 보세요. 3D 입체 공간에서 시작되는 가장 신비로운 "}</p>
            <p style={{ margin: 0 }}>방탈출 어드벤처</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "40px", alignItems: "center" }}>
          <div className="단추" style={{ ...큰단추, cursor: "pointer" }} data-node-id="136:1266" onClick={() => 누름("지금 시작하기")}>지금 시작하기</div>
          <div style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#334155", letterSpacing: "1px", width: "368px", whiteSpace: "pre-wrap" }} data-node-id="136:1268">
            <p style={{ margin: 0 }}>{"    AVAILABLE ON WEBGL · NO        "}</p>
            <p style={{ margin: 0 }}>{"     INSTALLATION REQUIRED"}</p>
          </div>
        </div>
      </div>

      {/* 맨 아래 심전도 선 136:1269 */}
      <div style={{ display: "flex", height: "60px", alignItems: "center", justifyContent: "center", width: "100%", overflow: "hidden", position: "relative" }}>
        <가는줄 />
        <div style={{ position: "relative", width: "288px", height: "20px" }}>
          <div style={{ position: "absolute", top: 0, bottom: "-2.39%", left: "-9.72%", right: "-10.24%" }}>
            <img src={에셋.imgEcgComponentWrap} alt="" style={꽉} />
          </div>
        </div>
        <가는줄 />
      </div>
    </section>
  );
}

function 가는줄() {
  return (
    <div style={{ position: "relative", width: "400px", height: 0 }}>
      <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
        <img src={에셋.imgLine1} alt="" style={꽉} />
      </div>
    </div>
  );
}

const 꽉 = { display: "block", width: "100%", height: "100%", maxWidth: "none" };

const 바깥 = {
  position: "absolute",
  left: "14px",
  top: "7216px",
  width: "1908px",
  height: "995px",
  background: "#02040a",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const 본문 = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: "60px",
  alignItems: "center",
  justifyContent: "center",
  padding: "120px 120px 50px",
  width: "100%",
  boxSizing: "border-box",
};

const 딱지 = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "8px 16px",
  borderRadius: "20px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
};

const 큰제목 = {
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "112px",
  lineHeight: "100px",
  letterSpacing: "4px",
  whiteSpace: "nowrap",
  textShadow: "0px 0px 30px rgba(59,130,246,0.31)",
  ...글자그라디언트("linear-gradient(90deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)"),
};

const 큰단추 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px 56px",
  borderRadius: "100px",
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "36px",
  color: "#eeeeff",
  letterSpacing: "2px",
  whiteSpace: "nowrap",
  backgroundImage: "linear-gradient(147.760deg, rgb(59,130,246) 0%, rgb(29,78,216) 50%, rgb(30,64,175) 100%)",
  boxShadow: "0px 0px 48px 0px rgba(96,165,250,0.25), 0px 4px 20px 0px rgba(59,130,246,0.45)",
};
