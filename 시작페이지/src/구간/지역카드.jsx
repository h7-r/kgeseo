import 에셋 from "../에셋.js";
import { 글꼴, 놓기, 막음, 막음안내 } from "../공통.js";
import { use기울임, use드러내기, 다가옴클래스 } from "../움직임.js";
import { use가까움 } from "../근접.js";

/* 지역 카드 3장 + 좌우 화살표 — 피그마 48:1520 · 48:1528 · 48:1536 · 129:1257 · 129:1259
   가운데 카드만 42px 아래로 내려가 있다 (원본 그대로).
   ※ 가로는 원본이 왼쪽 188 / 오른쪽 202 라 어긋나 있었다 — 카드 세 장을
     7px 씩 밀어 양쪽 195 로 맞췄다. 카드 사이 간격(15)은 그대로다. */

const 카드 = [
  { 칸: 놓기(195, 5309, 500, 468), 사진: 에셋.imgBg, 이름: "버려진 연구소", 별: "★★★☆☆",
    설명: "폐쇄된 지하 연구시설. 실험 기록 속 숨겨진 진실을 밝혀라.", id: "48:1520" },
  { 칸: 놓기(710, 5351, 500, 468), 사진: 에셋.imgBg2, 이름: "고대 도서관", 별: "★★★★☆",
    설명: "수백 년 된 비밀 서재. 고서 속 암호가 탈출의 열쇠다.", id: "48:1528" },
  { 칸: 놓기(1225, 5309, 500, 468), 사진: 에셋.imgBg1, 이름: "시계탑의 비밀", 별: "★★★★★",
    설명: "멈춘 시계 속에 감춰진 최후의 방. 시간이 다시 흐르기 전에 탈출하라.", id: "48:1536" },
];

export default function 지역카드() {
  return (
    <>
      {카드.map((ㅋ) => (
        <지역한장 key={ㅋ.id} {...ㅋ} />
      ))}

      {/* 좌우 화살표 — 원본엔 좌우 여백이 없어 글자 폭만큼만 넓다 */}
      <div style={{ ...놓기(115, 5495), ...화살표, ...막음 }} title={막음안내} data-node-id="129:1257">‹</div>
      <div style={{ ...놓기(1750, 5495), ...화살표, ...막음 }} title={막음안내} data-node-id="129:1259">›</div>
    </>
  );
}

/* 카드 한 장 — 마우스를 따라 살짝 기울고, 스크롤로 떠오른다 */
function 지역한장({ 칸, 사진, 이름, 별, 설명, id }) {
  const 기울임 = use기울임(5);
  const [보임칸, 보임] = use드러내기();
  const 가까이 = use가까움(240);

  return (
    <div ref={보임칸} className={`기울임판 ${다가옴클래스(보임)}`} style={{ ...칸, ...놓기틀 }}>
      <div
        ref={(el) => { 기울임.ref.current = el; 가까이.current = el; }}
        onMouseMove={기울임.onMouseMove}
        onMouseLeave={기울임.onMouseLeave}
        className="카드 기울임 깊이판 가까이-안"
        style={{ ...카드틀, width: "100%", height: "100%", position: "relative" }}
        data-node-id={id}
      >
        {/* 사진 + 어둡게 깔아 주는 막 — 한 겹 뒤로 물려 둔다.
            기울일 때 글보다 적게 움직여서 카드에 두께가 생긴다. */}
        <div className="깊이-뒤" style={{ position: "absolute", inset: 0 }}>
          <img src={사진} alt="" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
        </div>

        {/* 아래쪽을 바탕색으로 녹이는 그라디언트 */}
        <div style={녹임} />

        {/* 글 — 칸 아래로 33px 삐져나가 있다 (원본 그대로).
            한 겹 앞으로 띄워 놓으면 기울일 때 사진 위로 떠 보인다. */}
        <div className="깊이-앞" style={글칸}>
          <div style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#1e3a5f", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            REGION
          </div>
          <div style={{ fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "50px", color: "#eeeeff", width: "100%" }}>{이름}</div>
          <div style={메타}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ color: "#9ca3af" }}>난이도</span>
              <span style={{ color: "#eeeeff" }}>{별}</span>
            </div>
            <span style={{ color: "#9ca3af" }}>1인칭 추리</span>
          </div>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", lineHeight: 1.5, color: "#9ca3af", width: "100%" }}>
            {설명}
          </div>
        </div>
      </div>
    </div>
  );
}

/* 바깥 칸은 자리만 잡는다 — 테두리·그림자는 안쪽 카드가 갖는다
   (기울임이 바깥에 걸리면 그림자까지 같이 돌아 어색하다) */
const 놓기틀 = { boxSizing: "border-box" };

const 카드틀 = {
  border: "1px solid #1e3a5f",
  borderRadius: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
  boxShadow: "0px 0px 28px 0px rgba(59,130,246,0.2), 0px 18px 40px 0px rgba(0,0,0,0.4)",
};

const 녹임 = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-1px",
  height: "220px",
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(2,4,10,0.8) 55%, #02040a 100%)",
};

const 글칸 = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-33px",
  height: "252px",
  padding: "18px 20px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  boxSizing: "border-box",
};

const 메타 = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  fontFamily: 글꼴.모노,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const 화살표 = {
  height: "56px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  /* 원본엔 둥근 테두리 상자가 있지만, 화살표 글자만 남긴다 */
  overflow: "hidden",
  fontFamily: 글꼴.본문,
  fontWeight: 700,
  fontSize: "36px",
  color: "#3b82f6",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};
