import 에셋 from "../에셋.js";
import { use드러내기, 드러남클래스 } from "../움직임.js";
import { 글꼴, 글자그라디언트, 장식빛 } from "../공통.js";
import 심장선 from "../심장선.jsx";
import { 오르는글 } from "../연출.jsx";
import 도는글 from "../도는글.jsx";

/* closing-footer — 피그마 136:1251 (1908 × 995, y=7216)
   마지막으로 미는 구간. 위아래에 레이저 선과 심전도 그래프가 붙는다. */

/* 시작 단추 밑에서 도는 안내 — 「지금 눌러도 되나」에 걸리는 것들 */
const 시작안내 = [
  "브라우저에서 바로 시작합니다. 설치할 것이 없습니다.",
  "한 판은 15~25분. 앉은 자리에서 끝납니다.",
  "혼자 하는 1인칭 추리입니다. 일행을 모으지 않아도 됩니다.",
  "저장은 자동입니다. 중간에 나가도 이어서 할 수 있습니다.",
  "WebGL 을 지원하는 PC 브라우저면 됩니다.",
];

export default function 마무리({ 누름 = () => {} }) {
  const [칸, 보임] = use드러내기();
  /* ── 사락락 순서대로 ── 제목 → 설명 3줄 → 「지금 시작하기」+안내 → 맨 아래 선
     · 신호는 **하나**(글보임) — 제목 칸이 화면에 들어오는 순간 구간에 「켜짐」을 붙인다.
       넷 다 이 한 신호로 움직이고, 늦춤만 0.16초씩 계단처럼 준다(index.css .사락).
       신호가 하나라 스크롤을 빨리 내려도 순서가 뒤집히지 않는다.
     · 움직임은 「흐림 → 또렷」 + 살짝 떠오르기(16px). 뒤집히듯 서던 제목(rotateX)도
       같은 결로 맞춰서, 네 덩이가 한 호흡으로 사르륵 이어진다. */
  const [글칸, 글보임] = use드러내기("0px 0px 30% 0px");

  return (
    <section ref={칸} className={`${드러남클래스(보임)} 사락판${글보임 ? " 켜짐" : ""}`} style={바깥} data-node-id="136:1251">
      {/* 뒤에서 번지는 빛 136:1253 */}
      <div style={{ position: "absolute", left: "555px", top: "-36px", width: "798px", height: "815px", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "-30.67%", bottom: "-30.67%", left: "-31.33%", right: "-31.33%" }}>
          <img loading="lazy" decoding="async" src={에셋.imgAmbientRadialGlowRight} alt="" style={{ ...꽉, ...장식빛 }} />
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
          <span style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#ffffff", letterSpacing: "2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            ARE YOU READY TO ESCAPE?
          </span>
        </div>

        <div ref={글칸} style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", minHeight: "278px", textAlign: "center", width: "100%" }}>
          <오르는글 글="전설이 당신을 기다립니다." 쪼갬={false} style={큰제목} 글자클래스="흐름글" />
          {/* 원본은 앞에 빈 줄이 두 개 있다 — 그만큼 아래로 내려가 있다.
              줄바꿈은 <br /> 로 **직접** 정한다: ① 「…시험해 보세요.」 ② 「3D 입체 공간에서 시작되는 가장 신비로운」
              ③ 「방탈출 어드벤처」. 폭(608px)에 맡기면 글자 크기·글꼴에 따라 엉뚱한 곳에서 끊겼다.
              그래서 폭을 풀고 nowrap 으로 한 줄씩 지킨다. */}
          <div
            className="사락 사락-1"
            style={{ fontFamily: 글꼴.모노, fontWeight: 300, fontSize: "26px", lineHeight: 1.55, color: "#8b93a3", letterSpacing: "0px", wordSpacing: "-0.3em", whiteSpace: "nowrap" }} /* 모노 글꼴이라 띄어쓰기가 한 글자만큼 넓다 — 단어 사이만 좁힌다 */
            data-node-id="136:1264"
          >
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>
              지금 바로 당신의 본능과 지혜를 시험해 보세요.
              <br />
              3D 입체 공간에서 시작되는 가장 신비로운
            </p>
            <p style={{ margin: 0 }}>방탈출 어드벤처</p>
          </div>
        </div>

        {/* 3번째 */}
        <div className="사락 사락-2" style={{ display: "flex", flexDirection: "column", gap: "40px", alignItems: "center" }}>
          <div>
            <div className="단추 흰테단추" style={{ ...큰단추, cursor: "pointer" }} data-node-id="136:1266" onClick={() => 누름("지금 시작하기")}><span className="단추글">지금 시작하기</span></div>
          </div>
          {/* 원본은 「WEBGL · 설치 불필요」 두 줄뿐이었다. 시작 단추 바로 밑은
              마지막으로 망설이는 자리라, 걸리는 것들을 한 줄씩 짚어 준다. */}
          <도는글
            줄들={시작안내}
            사이={3800}
            style={{ width: "460px", textAlign: "center" }}
            글style={{ fontFamily: 글꼴.모노, fontSize: "17px", lineHeight: 1.5, color: "#ffffff", letterSpacing: "0px", wordSpacing: "-0.3em", display: "block" }}
          />
        </div>
      </div>

      {/* 맨 아래 심전도 선 136:1269 */}
      {/* 마지막 */}
      <div className="사락 사락-3" style={{ display: "flex", height: "60px", alignItems: "center", justifyContent: "center", width: "100%", overflow: "hidden", position: "relative" }}>
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
        <img loading="lazy" decoding="async" src={에셋.imgLine1} alt="" style={꽉} />
      </div>
    </div>
  );
}

const 꽉 = { display: "block", width: "100%", height: "100%", maxWidth: "none" };

const 바깥 = {
  position: "absolute",
  /* 폭 1908 을 1920 한가운데에 — 원본 14 는 8px 오른쪽으로 쏠려 있었다 */
  left: "6px",
  top: "7493px",
  width: "1908px",
  height: "995px",
  /* 통짜 검정이면 뒤의 입체 공간이 완전히 가려진다. 글이 읽힐 만큼만
     어둡게 덮고(0.82) 나머지는 비친다. */
  background: "rgba(1,4,10,0.82)",
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
  background: "#050b1a",
  border: "1px solid #1a305f",
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
  textShadow: "0px 0px 30px rgba(46,72,137,0.31)",
  ...글자그라디언트("linear-gradient(90deg, #3b5ea2 0%, #2e4889 50%, #2f3e70 100%)"),
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
  color: "#ffffff",
  letterSpacing: "2px",
  whiteSpace: "nowrap",
  /* 흰 테두리 + 검정 속 — 파란 면보다 페이지 톤(검정·흰색)에 맞는다 */
  background: "#000000",
  border: "1.5px solid #ffffff",
  boxSizing: "border-box",
  boxShadow: "0px 0px 28px 0px rgba(255,255,255,0.10)",
};
