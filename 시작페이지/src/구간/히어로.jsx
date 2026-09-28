import { 글꼴, 글자그라디언트 } from "../공통.js";
import { use마우스시차, use스크롤확대 } from "../움직임.js";

/* hero-media — 피그마 56:1627 (1920 × 1149, y=173)
   푸른 판 위에 ESCAPE THE LEGEND 가 놓인 첫 화면. */

export default function 히어로({ 누름 = () => {}, 위 = 173 }) {
  /* 마우스를 따라 층이 조금씩 어긋난다 — 조준선·꺾쇠가 가장 많이, 제목은
     아주 조금만 움직인다. 글자가 많이 흔들리면 읽기 힘들다. */
  const 무대 = use마우스시차(16);
  /* 내려갈수록 이 화면이 살짝 커지며 옅어진다 — 그 안으로 들어가는 느낌 */
  /* 바깥 칸에 이미 translateX(-50%) 가 걸려 있어서 그대로 물려 준다 */
  const 확대 = use스크롤확대({ 길이: 820, 최대배율: 1.09, 최소투명: 0.2, 바탕변형: "translateX(-50%)" });

  return (
    <section
      ref={(el) => { 무대.current = el; 확대.current = el; }}
      style={{ ...바깥, top: `${위}px`, transformOrigin: "center 38%", willChange: "transform, opacity" }}
      data-node-id="56:1627"
    >
      {/* [여기에 입체 유물을 넣었다가 뺐다]
          이 자리는 **게임 영상**이 들어갈 곳이다. 영상이 깔리면 뒤에서 도는
          도형은 가려지거나 서로 싸운다. 장면 코드(입체/유물.jsx)는 남겨 뒀으니
          영상 자리가 확정되면 다른 구간에서 다시 쓸 수 있다. */}

      {/* 한가운데 조준선 56:1628 / 56:1629 — 양끝이 투명해지는 얇은 선 */}
      <div className="시차층" data-깊이="1" style={{ ...세로선, pointerEvents: "none", zIndex: 1 }} />
      <div className="시차층" data-깊이="1" style={{ ...가로선, pointerEvents: "none", zIndex: 1 }} />

      {/* 네 귀퉁이 꺾쇠 — 원본엔 왼쪽 위만 없다(3곳) */}
      {꺾쇠.map((s, i) => (
        <div key={i} className="시차층" data-깊이="0.75" style={{ position: "absolute", background: "#3b82f6", borderRadius: "1px", pointerEvents: "none", zIndex: 1, ...s }} />
      ))}

      {/* 56:1638 — 내용이 없는 빈 칸. 지우면 아래 제목이 위로 밀린다 */}
      <div style={{ width: "74px", height: "48px", flexShrink: 0, position: "relative", zIndex: 1 }} />

      {/* 61:1657 — ESCAPE 와 THE LEGEND 가 한 칸에 겹쳐 놓여 있다 */}
      <div className="시차층" data-깊이="0.22" style={{ position: "relative", zIndex: 1, width: "470px", height: "233.3px", flexShrink: 0 }}>
        <div style={{ ...제목바탕, left: "86px", top: 0, width: "298px", color: "#eeeeff" }} data-node-id="61:1654">
          ESCAPE
        </div>
        <div
          style={{
            ...제목바탕,
            left: 0,
            top: "116.3px",
            width: "470px",
            ...글자그라디언트("linear-gradient(90deg, #60a5fa 0%, #93c5fd 50%, #3b82f6 100%)"),
            textShadow: "0px 0px 40px rgba(59,130,246,0.5)",
          }}
          data-node-id="61:1655"
        >
          THE LEGEND
        </div>
      </div>

      <div className="시차층" data-깊이="0.12" style={{ ...설명, position: "relative", zIndex: 1 }} data-node-id="61:1658">
        이스케이프 더 레전드는 지역의 전설 속으로 떠나는 몰입형 방탈출 어드벤처 게임입니다.
      </div>

      {/* 원본에서 이 글자는 **검정**이다 (푸른 판 위라 낮게 깔린다) */}
      <div className="단추" style={{ ...플레이, cursor: "pointer", position: "relative", zIndex: 1 }} data-node-id="61:1660" onClick={() => 누름("플레이하기")}>
        플레이하기
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
  background: "#3f5783",
  border: "1px solid #1e3a5f",
  overflow: "hidden",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0px 0px 100px 10px rgba(59,130,246,0.13), 0px 20px 60px 0px rgba(29,78,216,0.25)",
};

const 투명파랑 = "rgba(59,130,246,0)";
const 중간파랑 = "rgba(59,130,246,0.25)";

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

/* 56:1632~56:1637 — 오른쪽 위 · 왼쪽 아래 · 오른쪽 아래 */
const 꺾쇠 = [
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
  color: "#fffefe",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const 플레이 = {
  fontFamily: 글꼴.제목,
  fontWeight: 400,
  fontSize: "44px",
  lineHeight: "150px",
  letterSpacing: "2.2px",
  color: "#000000",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
