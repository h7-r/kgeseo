import 에셋 from "../에셋.js";
import { use드러내기, 드러남클래스 } from "../움직임.js";
import { 글꼴, 글자그라디언트 } from "../공통.js";
import 심장선 from "../심장선.jsx";
import { 오르는글, use자석 } from "../연출.jsx";

/* closing-footer — 피그마 136:1251 (1908 × 995, y=7216)
   마지막으로 미는 구간. 위아래에 레이저 선과 심전도 그래프가 붙는다. */

export default function 마무리({ 누름 = () => {} }) {
  const [칸, 보임] = use드러내기();
  const 자석 = use자석({ 당김: 0.22, 최대: 12 });

  return (
    <section ref={칸} className={드러남클래스(보임)} style={바깥} data-node-id="136:1251">
      {/* 뒤에서 번지는 빛 136:1253 */}
      <div style={{ position: "absolute", left: "555px", top: "-36px", width: "798px", height: "815px", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-30.67%", bottom: "-30.67%", left: "-31.33%", right: "-31.33%" }}>
          <img src={에셋.imgAmbientRadialGlowRight} alt="" style={꽉} />
        </div>
      </div>

      {/* 맨 위 선 136:1254 — 원본 모양 그대로, 빛이 훑고 지나간다 */}
      {/* 높이를 10 으로 두면 맥의 뾰족한 봉우리가 구간 위 테두리에 잘린다.
          줄 높이는 그대로 10 으로 보이게 하고, 담는 칸만 넉넉히 준다. */}
      <div style={{ display: "flex", height: "28px", alignItems: "center", justifyContent: "center", width: "100%", position: "relative" }}>
        <심장선 모양="위맥" 폭="800px" 높이="14px" 주기={3.8} 진하기={0.5} 굵기={2.6} />
      </div>

      <div style={본문}>
        <div style={딱지} data-node-id="136:1259">
          <span style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#60a5fa", letterSpacing: "2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ARE YOU READY TO ESCAPE?
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", minHeight: "278px", textAlign: "center", width: "100%" }}>
          <오르는글 글="전설이 당신을 기다립니다." 쪼갬={false} style={큰제목} />
          {/* 원본은 앞에 빈 줄이 두 개 있다 — 그만큼 아래로 내려가 있다 */}
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "26px", color: "#47628a", letterSpacing: "1px", width: "608px", whiteSpace: "pre-wrap" }} data-node-id="136:1264">
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"지금 바로 당신의 본능과 지혜를 시험해 보세요. 3D 입체 공간에서 시작되는 가장 신비로운 "}</p>
            <p style={{ margin: 0 }}>방탈출 어드벤처</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "40px", alignItems: "center" }}>
          <div ref={자석}>
            <div className="단추" style={{ ...큰단추, cursor: "pointer" }} data-node-id="136:1266" onClick={() => 누름("지금 시작하기")}>지금 시작하기</div>
          </div>
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
          {/* 위 선과 늦춤을 달리 줘서 두 줄이 번갈아 뛴다 */}
          <심장선 모양="큰맥" 폭="346px" 높이="21px" 주기={3.8} 늦춤={1.6} 진하기={0.6} 굵기={1.6}
            style={{ position: "absolute", left: "-29px", top: 0 }} />
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
  /* 폭 1908 을 1920 한가운데에 — 원본 14 는 8px 오른쪽으로 쏠려 있었다 */
  left: "6px",
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
  padding: "102px 120px 50px",
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
  /* 100px 로 못 박아 놨더니 글자 윗부분이 잘렸다(글자 크기보다 작은 행간).
     1.18 이면 원본 줄 간격을 지키면서 윗선이 안 잘린다. */
  lineHeight: 1.18,
  paddingTop: "6px",
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
