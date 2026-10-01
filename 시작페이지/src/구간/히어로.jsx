import { 글꼴, 글자그라디언트 } from "../공통.js";
import { use마우스시차 } from "../움직임.js";
import { Suspense, lazy } from "react";
import { 히어로영상자리 } from "./히어로영상자리.jsx";
/* ★ 성능: three.js 를 첫 번들에서 뺀다 — 받는 동안은 같은 포스터가 보인다 */
const 히어로영상 = lazy(() => import("./히어로영상.jsx"));

/* hero-media — 피그마 56:1627 (1920 × 1149, y=173)
   푸른 판 위에 ESCAPE THE LEGEND 가 놓인 첫 화면. */

export default function 히어로({ 누름 = () => {}, 위 = 173 }) {
  /* 마우스를 따라 층이 조금씩 어긋난다 — 조준선·꺾쇠가 가장 많이, 제목은
     아주 조금만 움직인다. 글자가 많이 흔들리면 읽기 힘들다. */
  const 무대 = use마우스시차(16);
  /* "그 안으로 들어가는 느낌"은 영상 스크럽 줌(히어로영상.jsx)이 맡는다 */

  return (
    <section
      ref={무대}
      style={{ ...바깥, top: `${위}px`, transformOrigin: "center 38%", willChange: "transform, opacity" }}
      data-node-id="56:1627"
    >
      {/* ── 게임 영상 배경 (WebGL 왜곡 인트로) ──
          제목·조준선(zIndex 1) 뒤(zIndex 0)에 깔린다.
          연출: 확 빨려드는 줌 + 초반 흔들림(곧 잦아듦) + 왜곡·색수차. 상세는 히어로영상.jsx */}
      <Suspense fallback={<히어로영상자리 />}><히어로영상 /></Suspense>

      {/* 한가운데 조준선 56:1628 / 56:1629 — 양끝이 투명해지는 얇은 선 */}
      <div className="시차층" data-깊이="1" style={{ ...세로선, pointerEvents: "none", zIndex: 1 }} />
      <div className="시차층" data-깊이="1" style={{ ...가로선, pointerEvents: "none", zIndex: 1 }} />

      {/* 네 귀퉁이 꺾쇠 — 왼쪽 위까지 채워 4곳 다 표시 */}
      {꺾쇠.map((s, i) => (
        <div key={i} className="시차층" data-깊이="0.75" style={{ position: "absolute", background: "#000000", borderRadius: "1px", pointerEvents: "none", zIndex: 1, ...s }} />
      ))}

      {/* 56:1638 — 내용이 없는 빈 칸. 지우면 아래 제목이 위로 밀린다 */}
      <div style={{ width: "74px", height: "48px", flexShrink: 0, position: "relative", zIndex: 1 }} />

      {/* 61:1657 — ESCAPE 와 THE LEGEND 가 한 칸에 겹쳐 놓여 있다 */}
      <div className="시차층" data-깊이="0.22" style={{ position: "relative", zIndex: 1, width: "470px", height: "233.3px", flexShrink: 0 }}>
        <div className="줄무늬글" style={{ ...제목바탕, left: "86px", top: 0, width: "298px", color: "#f1f1fc" }} data-node-id="61:1654">
          ESCAPE
        </div>
        <div
          style={{
            ...제목바탕,
            left: 0,
            top: "116.3px",
            width: "470px",
            ...글자그라디언트("linear-gradient(90deg, #325296 0%, #3b5ea2 50%, #2e4889 100%)"),
            textShadow: "0px 0px 40px rgba(46,72,137,0.5)",
          }}
          className="흐름글 남색띠"
          data-node-id="61:1655"
        >
          THE LEGEND
        </div>
      </div>

      <div className="시차층" data-깊이="0.12" style={{ ...설명, position: "relative", zIndex: 1 }} data-node-id="61:1658">
        {/* 바닥 그림자 — 글자가 바닥에 **서 있고**, 그 그림자가 뒤쪽 바닥으로 눕는다(index.css .바닥그림자).
            그림자 글은 data-글 에서 똑같이 복사해 그린다(::before 의 content: attr(data-글)).
            글을 바꿀 땐 아래 두 곳을 같이 바꿀 것. */}
        <span className="바닥그림자" data-글="이스케이프 더 레전드는 지역의 전설 속으로 떠나는 몰입형 방탈출 어드벤처 게임입니다.">
          이스케이프 더 레전드는 지역의 전설 속으로 떠나는 몰입형 방탈출 어드벤처 게임입니다.
        </span>
      </div>

      {/* 원본에서 이 글자는 **검정**이다 (푸른 판 위라 낮게 깔린다) */}
      <div className="단추 글빛단추" style={{ ...플레이, cursor: "pointer", position: "relative", zIndex: 1 }} data-node-id="61:1660" onClick={() => 누름("플레이하기")}>
        <span className="단추글 플레이글">플레이하기</span>
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  width: "1920px",
  height: "1149px",
  background: "#43587f",
  overflow: "hidden",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};

const 투명파랑 = "rgba(46,72,137,0)";
const 중간파랑 = "rgba(46,72,137,0.25)";

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

/* 네 귀퉁이 — 왼쪽 위 · 오른쪽 위 · 왼쪽 아래 · 오른쪽 아래 */
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

const 제목바탕 = {
  position: "absolute",
  fontFamily: 글꼴.제목,
  fontSize: "130px",
  lineHeight: "130px",
  height: "117px",
  whiteSpace: "nowrap",
};

const 설명 = {
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "38px",
  lineHeight: "150px",
  color: "#000000", /* 밝은 영상 위라 검정으로 — 요청대로 빛 번짐 없이 */
  /* 입체감은 글자 뒤 바닥에 눕는 그림자(.바닥그림자)가 준다 */
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const 플레이 = {
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "44px",
  lineHeight: "150px",
  letterSpacing: "9px",
  /* 파란 면 위에 검정이라 2.9:1 이었다 — 글자가 면에 묻혔다. 흰색이면 5.6:1 */
  color: "#ffffff",
  whiteSpace: "nowrap",
  flexShrink: 0,
  /* 호버 때 글자가 7% 커지는데, 단추(.단추)는 overflow: hidden 이라 칸이 글자에 딱 붙어 있으면
     커진 글자의 양 끝이 잘렸다. 좌우에 여유를 둬서 커져도 칸 안에 들어오게 한다. */
  padding: "0 32px",
};
