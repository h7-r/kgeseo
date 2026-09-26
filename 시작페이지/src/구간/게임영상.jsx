import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내 } from "../공통.js";
import { use기울임, use드러내기, use지나가며, 다가옴클래스 } from "../움직임.js";

/* 게임 영상 — 피그마 14:1664(3장 갤러리) · 121:2293(큰 카드) · 150:222(쪽번호) */

const 영상 = [
  { 그림: 에셋.imgVideoCard1, 제목: "탈출의 시작", 갈래: "GAMEPLAY", 설명: "첫 번째 방에서의 긴장감 넘치는 탈출 시퀀스. 숨겨진 단서를 찾아 퍼즐을 풀어라." },
  { 그림: 에셋.imgVideoCard2, 제목: "암호 해독 챌린지", 갈래: "PUZZLE", 설명: "고대 문자와 현대 암호가 뒤섞인 난이도 최상의 퍼즐. 당신의 두뇌를 시험하라." },
  { 그림: 에셋.imgVideoCard3, 제목: "최후의 대결", 갈래: "CLIMAX", 설명: "모든 단서가 하나로 모이는 클라이막스. 진실을 밝혀낼 수 있는가?" },
];

export default function 게임영상({ 위 = 0, 큰카드위 = 0, 쪽번호위 = 0 }) {
  return (
    <>
      <section style={{ ...갤러리, top: `${위}px` }} data-node-id="14:1664">
        <div style={{ display: "flex", gap: "8px", alignItems: "center", fontFamily: 글꼴.모노, fontSize: "16px", color: "#60a5fa" }}>
          <span>게임 영상</span>
        </div>
        <div style={{ display: "flex", gap: "16px", width: "100%", height: "260px" }}>
          {영상.map((ㅇ, i) => (
            <작은영상 key={ㅇ.제목} {...ㅇ} 순서={i} />
          ))}
        </div>
      </section>

      {/* 큰 카드 121:2293 — 위 갤러리의 두 번째 영상을 크게 보여 준다 */}
      <큰영상 위={큰카드위} />

      {/* 쪽번호 150:222 */}
      <div style={{ position: "absolute", left: "772px", top: `${쪽번호위}px`, display: "flex", gap: "16px", alignItems: "center" }} data-node-id="150:222">
        {/* 2쪽 이후 영상이 피그마에 없다 — 눌러도 아무 일이 없게 둔다 */}
        <div style={{ ...화살표, ...막음 }} title={막음안내}>‹</div>
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} style={{ ...(n === 1 ? 켜진쪽 : 꺼진쪽), ...막음 }} title={막음안내}>
            {n}
          </div>
        ))}
        <div style={{ ...화살표, ...막음 }} title={막음안내}>›</div>
      </div>
    </>
  );
}

/* 작은 영상 카드 — 마우스를 따라 기울고, 차례로 안쪽에서 걸어 나온다 */
function 작은영상({ 순서, ...ㅇ }) {
  const 기울임 = use기울임(5);
  const [보임칸, 보임] = use드러내기();
  return (
    <div
      ref={보임칸}
      className={`기울임판 ${다가옴클래스(보임)}`}
      style={{ flex: "1 0 0", minWidth: 0, height: "335px", transitionDelay: `${순서 * 90}ms` }}
    >
      <div
        ref={기울임.ref}
        onMouseMove={기울임.onMouseMove}
        onMouseLeave={기울임.onMouseLeave}
        className="기울임"
        style={{ width: "100%", height: "100%" }}
      >
        <영상카드 {...ㅇ} 채움 />
      </div>
    </div>
  );
}

/* 큰 영상 카드 — 스크롤에 맞춰 안쪽에서 다가왔다 앞으로 지나간다 */
function 큰영상({ 위 }) {
  const 칸 = use지나가며({ 들어올때: 0.9, 나갈때: 1.05, 깊이: 110 });
  return (
    <div
      ref={칸}
      className="지나가며"
      style={{ position: "absolute", left: "220px", top: `${위}px`, width: "1480px", height: "715px", willChange: "transform" }}
      data-node-id="121:2293"
    >
      <영상카드 {...영상[1]} 큼 />
    </div>
  );
}

function 영상카드({ 그림, 제목, 갈래, 설명, 큼 }) {
  return (
    <div className="카드" style={{ ...카드, width: "100%", height: "100%" }}>
      <img src={그림} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {/* 가운데 재생 단추 */}
      <div style={재생}>
        <img src={에셋.imgPlay2} alt="" style={{ width: "24px", height: "24px", display: "block" }} />
      </div>
      {/* 아래쪽 설명 — 바탕색으로 녹여 내린다 */}
      <div style={설명칸}>
        <div style={{ fontFamily: 글꼴.제목, fontSize: 큼 ? "32px" : "24px", color: "#eeeeff" }}>{제목}</div>
        <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#3b82f6", textTransform: "uppercase" }}>{갈래}</div>
        <div style={{ fontFamily: 글꼴.본문, fontSize: "16px", lineHeight: 1.5, color: "#9ca3af" }}>{설명}</div>
      </div>
    </div>
  );
}

const 갤러리 = {
  position: "absolute",
  /* 폭 1480 덩이는 1920 한가운데(220) — 원본은 210~217 로 제각각이었다 */
  left: "220px",
  width: "1480px",
  height: "517px",
  padding: "24px 32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(59,130,246,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 카드 = {
  position: "relative",
  borderRadius: "12px",
  border: "1px solid #1e3a5f",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 재생 = {
  position: "absolute",
  left: "50%",
  top: "calc(50% + 0.5px)",
  transform: "translate(-50%, -50%)",
  width: "56px",
  height: "56px",
  borderRadius: "28px",
  background: "rgba(255,255,255,0.1)",
  border: "1px solid #3b82f6",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
};

const 설명칸 = {
  position: "absolute",
  left: "-1px",
  right: "-1px",
  bottom: "-1px",
  /* 높이를 96 으로 못 박아 뒀더니 큰 카드에서 설명 줄이 잘렸다.
     글에 맡기고 최소 높이만 준다. */
  minHeight: "96px",
  padding: "22px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(2,4,10,0.85) 45%, #02040a 100%)",
  boxSizing: "border-box",
};

const 화살표 = {
  width: "40px",
  height: "40px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: 글꼴.본문,
  fontSize: "24px",
  color: "#64748b",
};
const 쪽바탕 = { width: "40px", height: "40px", borderRadius: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: 글꼴.모노, fontSize: "16px", boxSizing: "border-box" };
const 켜진쪽 = { ...쪽바탕, background: "#3b82f6", color: "#ffffff", fontWeight: 700 };
const 꺼진쪽 = { ...쪽바탕, background: "rgba(10,15,31,0.8)", border: "1px solid #1e3a5f", color: "#94a3b8" };
