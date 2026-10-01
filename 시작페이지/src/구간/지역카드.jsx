import { useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 놓기 } from "../공통.js";
import { use기울임, use드러내기, 다가옴클래스 } from "../움직임.js";
import { use가까움 } from "../근접.js";
import { 영상목록 } from "../영상목록.js";
import { use미리보기 } from "../영상창.js";
import { 크게보기딱지 } from "./지역선택.jsx";

/* 시나리오 카드 3장 + 좌우 화살표 — 피그마 48:1520 · 48:1528 · 48:1536 · 129:1257

   [세 장 모두 실제 지역의 시나리오다]
   처음엔 가상의 시나리오(버려진 연구소 · 고대 도서관 · 시계탑)였는데, 지역 영상이 오면서
   목포(갓바위) · 여수(거북선) · 순천(순천만)으로 바꿨다.
   그래서 윗줄 왼쪽은 「SCENARIO」(이 카드가 무엇인지), 오른쪽 딱지는 「지역 ○○」(어디인지)로
   역할을 나눠 적는다. · 129:1259
   가운데 카드만 42px 아래로 내려가 있다 (원본 그대로).
   ※ 가로는 원본이 왼쪽 188 / 오른쪽 202 라 어긋나 있었다 — 카드 세 장을
     7px 씩 밀어 양쪽 195 로 맞췄다. 카드 사이 간격(15)은 그대로다. */

/* ★ 카드 높이 468 → 540.
   [전엔] 글 칸이 카드 아래로 33px 삐져나가 있었는데(피그마 원본), 카드가 overflow: hidden 이라
          설명 둘째 줄이 잘렸다. 딱지(지역 ○○) 줄까지 생겨 더 잘렸다.
   [지금] 카드를 72px 키우고 글 칸을 카드 **안쪽 바닥**에 붙였다(아래 글칸). 그만큼 아래 구간들도
          같이 내려간다(공통.js 구간밀기 — 틈 320 은 그대로). */
const 카드높이 = 540;

const 카드 = [
  /* 첫 장 — 「버려진 연구소」를 실제 지역 목포로 바꿨다(영상: 유달산·옛 골목·갓바위·목포대교).
     글은 설화 정리본 1.13 「나불도와 갓바위전설」의 사실만 쓴다:
     아라한과 부처님이 영산강을 건너다 쉬던 자리에 잊고 간 갓이 굳어 갓바위가 되었다. */
  { 칸: 놓기(195, 5586, 500, 카드높이), 사진: 에셋.imgBg, 영상: 영상목록.목포, 지역: "목포", 이름: "갓바위의 전설", 별: "★★★☆☆",
    설명: "성자가 쉬어 가며 두고 간 갓이 바위로 굳었다. 바닷가 갓바위에 남은 단서를 찾아라.", id: "48:1520" },
  /* 가운데 장 — 「고대 도서관」을 여수로 바꿨다(영상: 돌산대교·해상케이블카·진남관·거북선·오동도).
     주제는 거북선 — 여수는 이순신의 전라좌수영이 있던 곳이다(진남관 = 전라좌수영 객사). */
  { 칸: 놓기(710, 5628, 500, 카드높이), 사진: 에셋.imgBg2, 영상: 영상목록.여수, 지역: "여수", 이름: "거북선의 비밀", 별: "★★★★☆",
    설명: "전라좌수영의 바다를 지키던 거북선. 거북 머리가 가리키는 곳에 봉인된 기록을 찾아라.", id: "48:1528" },
  /* 마지막 장 — 「시계탑의 비밀」을 순천으로 바꿨다(영상: 순천만 S자 물길·국가정원·낙안읍성·선암사 승선교·벽화 골목) */
  { 칸: 놓기(1225, 5586, 500, 카드높이), 사진: 에셋.imgBg1, 영상: 영상목록.순천, 지역: "순천", 이름: "순천만의 비밀", 별: "★★★★★",
    설명: "갈대숲 사이로 굽이치는 S자 물길. 물길이 멈추는 자리에 숨은 마지막 단서를 찾아라.", id: "48:1536" },
];

/* ── 좌우 화살표로 카드 돌리기 ──
   카드 세 장이 세 자리를 돌아가며 앉는다. i 번째 카드의 자리 = (i + 돌림) % 3.
   자리(left·top)가 바뀌면 transition 으로 미끄러져 옮겨 간다 — 가운데 자리는 42px 아래라
   가운데로 오는 카드는 살짝 내려앉고, 빠지는 카드는 떠오른다. */
const 자리들 = 카드.map((ㅋ) => ㅋ.칸);

export default function 지역카드() {
  const [돌림, set돌림] = useState(0);
  const 돌리기 = (걸음) => set돌림((v) => (v + 걸음 + 카드.length) % 카드.length);

  return (
    <>
      {카드.map((ㅋ, i) => (
        <지역한장 key={ㅋ.id} {...ㅋ} 칸={자리들[(i + 돌림) % 카드.length]} />
      ))}

      {/* 좌우 화살표 — 원본엔 좌우 여백이 없어 글자 폭만큼만 넓다. 진짜 <button> 이라 키보드로도 된다 */}
      <button type="button" className="카드화살표" style={{ ...놓기(115, 5808), ...화살표 }} onClick={() => 돌리기(1)} aria-label="이전 시나리오" data-node-id="129:1257">‹</button>
      <button type="button" className="카드화살표" style={{ ...놓기(1750, 5808), ...화살표 }} onClick={() => 돌리기(-1)} aria-label="다음 시나리오" data-node-id="129:1259">›</button>
    </>
  );
}

/* 카드 한 장 — 마우스를 따라 살짝 기울고, 스크롤로 떠오른다
   영상(영상목록.js)이 있으면 사진 대신 영상 — 호버하면 흐르고, 누르면 크게(영상모달) */
function 지역한장({ 칸, 사진, 영상, 지역, 이름, 별, 설명, id }) {
  const 기울임 = use기울임(5);
  const [보임칸, 보임] = use드러내기();
  const 가까이 = use가까움(240);
  const 미리 = use미리보기(영상, "12px"); // 카드 모서리(16px × 화면 배율쯤)에서 커지기 시작

  return (
    <div ref={보임칸} className={`기울임판 ${다가옴클래스(보임)}`} style={{ ...칸, ...놓기틀, transition: "left .6s var(--부드럽게), top .6s var(--부드럽게)" }}>
      <div
        ref={(el) => { 기울임.ref.current = el; 가까이.current = el; }}
        {...미리.판속성}
        onMouseMove={기울임.onMouseMove}
        /* 떠날 때 두 가지 — 기울기 되돌리기 + 영상 멈추기 */
        onMouseLeave={(e) => { 기울임.onMouseLeave(e); 미리.판속성.onMouseLeave?.(e); }}
        className={`카드 기울임 깊이판 가까이-안${미리.있음 ? " 미리판" : ""}`}
        style={{ ...카드틀, width: "100%", height: "100%", position: "relative" }}
        data-node-id={id}
      >
        {/* 사진 + 어둡게 깔아 주는 막 — 한 겹 뒤로 물려 둔다.
            기울일 때 글보다 적게 움직여서 카드에 두께가 생긴다. */}
        <div className="깊이-뒤" style={{ position: "absolute", inset: 0 }}>
          {미리.있음 ? (
            <video {...미리.비디오속성} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" }} />
          ) : (
            <img loading="lazy" decoding="async" src={사진} alt="" style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" }} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
        </div>

        {/* 아래쪽을 바탕색으로 녹이는 그라디언트 */}
        <div style={녹임} />
        {미리.있음 && <크게보기딱지 카드 />}

        {/* 글 — 카드 안쪽 바닥에 붙는다(예전엔 33px 삐져나가 잘렸다).
            한 겹 앞으로 띄워 놓으면 기울일 때 사진 위로 떠 보인다. */}
        <div className="깊이-앞" style={글칸}>
          {/* 윗줄 — 왼쪽 SCENARIO, 오른쪽 끝에 실제 지역(있는 카드만) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div style={{ fontFamily: 글꼴.모노, fontSize: "18px", color: "#6f86bf", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              SCENARIO
            </div>
            {지역 && (
              <span style={지역딱지}>
                <span style={{ color: "#8b93a3" }}>지역</span>
                <span style={{ color: "#f1f1fc" }}>{지역}</span>
              </span>
            )}
          </div>
          <div style={{ fontFamily: 글꼴.제목, fontWeight: 400, fontSize: "50px", color: "#f1f1fc", width: "100%" }}>{이름}</div>
          <div style={메타}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ color: "#8b93a3" }}>난이도</span>
              <span style={{ color: "#f1f1fc" }}>{별}</span>
            </div>
            <span style={{ color: "#8b93a3" }}>1인칭 추리</span>
          </div>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 400, fontSize: "18px", lineHeight: 1.5, color: "#8b93a3", width: "100%" }}>
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
  border: "1px solid #1a305f",
  borderRadius: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
  boxShadow: "0px 0px 28px 0px rgba(46,72,137,0.2), 0px 18px 40px 0px rgba(0,0,0,0.4)",
};

const 녹임 = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-1px",
  height: "300px", // 글 칸이 카드 안으로 들어온 만큼 어둡게 누르는 폭도 넓혔다
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(1,4,10,0.8) 55%, #01040a 100%)",
};

const 글칸 = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: 0, // 높이는 글만큼(auto) — 몇 줄이 돼도 카드 안에서 끝난다
  padding: "18px 20px 22px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  boxSizing: "border-box",
};

/* 지역 딱지 — 카드 오른쪽 위에 「지역 목포」. 메타 줄과 같은 모노 글꼴·색 결 */
const 지역딱지 = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "4px 12px",
  borderRadius: "999px",
  background: "rgba(5,11,26,0.72)",
  border: "1px solid rgba(111,134,191,0.45)",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  whiteSpace: "nowrap",
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
  color: "#6f86bf",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};
