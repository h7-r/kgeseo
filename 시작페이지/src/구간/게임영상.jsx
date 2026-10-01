import { useEffect, useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴 } from "../공통.js";
import { use기울임, use드러내기, use지나가며, 다가옴클래스 } from "../움직임.js";

/* 게임 영상 — 피그마 14:1664(3장 갤러리) · 121:2293(큰 카드) · 150:222(쪽번호) */

/* ═══════════════════════════════════════════════════════
   챌린지 다섯 — 원본은 셋뿐이었는데 아래 쪽번호가 다섯 칸이었다.
   숫자만 다섯이고 볼 것은 셋이라 두 칸이 빈 채로 막혀 있었다.
   있는 그림으로 둘을 더 채워 숫자와 내용을 맞춘다.
   ═══════════════════════════════════════════════════════ */
const 영상 = [
  { 그림: 에셋.imgVideoCard1, 제목: "탈출의 시작", 갈래: "GAMEPLAY", 설명: "첫 번째 방에서의 긴장감 넘치는 탈출 시퀀스. 숨겨진 단서를 찾아 퍼즐을 풀어라." },
  { 그림: 에셋.imgVideoCard2, 제목: "암호 해독 챌린지", 갈래: "PUZZLE", 설명: "고대 문자와 현대 암호가 뒤섞인 난이도 최상의 퍼즐. 당신의 두뇌를 시험하라." },
  { 그림: 에셋.imgVideoCard3, 제목: "최후의 대결", 갈래: "CLIMAX", 설명: "모든 단서가 하나로 모이는 클라이막스. 진실을 밝혀낼 수 있는가?" },
  { 그림: 에셋.imgBg, 제목: "지워진 기록 복원", 갈래: "RESTORE", 설명: "누군가 지운 실험 일지. 남은 자국만으로 사라진 문장을 되살려라." },
  { 그림: 에셋.imgBg1, 제목: "멈춘 시계 탈출", 갈래: "TIME ATTACK", 설명: "시계가 다시 움직이기 전까지. 초침이 도는 순간 문은 닫힌다." },
];

/* 혼자 넘어가는 간격. 읽고 그림을 볼 시간이 필요해서 넉넉히 잡는다. */
const 자동넘김 = 5200;


export default function 게임영상({ 위 = 0, 큰카드위 = 0, 쪽번호위 = 0 }) {
  /* 지금 크게 보고 있는 챌린지 */
  const [고른, set고른] = useState(0);
  /* 사람이 직접 고르면 자동 넘김을 멈춘다 — 보고 있는 걸 뺏으면 안 된다 */
  const [손댐, set손댐] = useState(false);

  useEffect(() => {
    if (손댐) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const 시계 = window.setInterval(() => set고른((n) => (n + 1) % 영상.length), 자동넘김);
    return () => clearInterval(시계);
  }, [손댐]);

  const 고르기 = (n) => {
    set손댐(true);
    set고른(((n % 영상.length) + 영상.length) % 영상.length);
  };

  return (
    <>
      <section style={{ ...갤러리, top: `${위}px` }} data-node-id="14:1664">
        <div style={{ display: "flex", gap: "8px", alignItems: "center", fontFamily: 글꼴.모노, fontSize: "16px", color: "#6f86bf" }}>
          <span>게임 영상</span>
        </div>
        <div style={{ display: "flex", gap: "16px", width: "100%", height: "260px" }}>
          {영상.slice(0, 3).map((ㅇ, i) => (
            <작은영상 key={ㅇ.제목} {...ㅇ} 순서={i} 켜짐={고른 === i} 누르기={() => 고르기(i)} />
          ))}
        </div>
      </section>

      {/* 큰 카드 121:2293 — 위 갤러리에서 **고른 영상**을 크게 보여 주는 자리다.
          원본이 두 번째 영상을 그대로 쓰고 있어서 목록과 같은 제목이 두 번
          보였다. 「지금 보는 영상」이라고 밝혀 같은 것을 크게 튼 화면임을
          알 수 있게 했다. */}
      <큰영상 위={큰카드위} 챌린지={영상[고른]} />

      {/* 쪽번호 150:222 */}
      <div style={{ position: "absolute", left: "772px", top: `${쪽번호위}px`, display: "flex", gap: "16px", alignItems: "center" }} data-node-id="150:222">
        {/* 다섯 칸이 챌린지 다섯과 짝이다. 눌러서 고를 수도 있고,
            가만히 두면 혼자 넘어간다. */}
        <button type="button" className="쪽화살표" style={화살표} onClick={() => 고르기(고른 - 1)} aria-label="이전 챌린지">‹</button>
        {영상.map((ㅇ, i) => (
          <button
            key={ㅇ.제목}
            type="button"
            className={`쪽번호칸 ${고른 === i ? "켜짐" : ""}`}
            style={{ ...(고른 === i ? 켜진쪽 : 꺼진쪽), border: "none", cursor: "pointer" }}
            onClick={() => 고르기(i)}
            aria-label={`${i + 1}번째 챌린지 · ${ㅇ.제목}`}
            aria-current={고른 === i}
          >
            {i + 1}
          </button>
        ))}
        <button type="button" className="쪽화살표" style={화살표} onClick={() => 고르기(고른 + 1)} aria-label="다음 챌린지">›</button>
      </div>
    </>
  );
}

/* 작은 영상 카드 — 마우스를 따라 기울고, 차례로 안쪽에서 걸어 나온다 */
function 작은영상({ 순서, 켜짐, 누르기, ...ㅇ }) {
  const 기울임 = use기울임(5);
  const [보임칸, 보임] = use드러내기();
  return (
    <div
      ref={보임칸}
      role="button"
      tabIndex={0}
      onClick={누르기}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); 누르기?.(); } }}
      className={`기울임판 ${다가옴클래스(보임)}`}
      style={{ flex: "1 0 0", minWidth: 0, height: "335px", cursor: "pointer", transitionDelay: `${순서 * 30}ms`, outline: 켜짐 ? "2px solid rgba(50,82,150,0.85)" : "none", outlineOffset: "2px", borderRadius: "12px" }}
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
function 큰영상({ 위, 챌린지 }) {
  const 칸 = use지나가며({ 들어올때: 0.9, 나갈때: 1.05, 깊이: 110 });
  return (
    <div
      ref={칸}
      className="지나가며"
      style={{ position: "absolute", left: "220px", top: `${위}px`, width: "1480px", height: "715px", willChange: "transform" }}
      data-node-id="121:2293"
    >
      {/* key 를 바꿔야 바뀌는 순간 카메라 전환이 다시 돈다 */}
      <div key={챌린지.제목} className="카메라줌" style={{ width: "100%", height: "100%" }}>
        <영상카드 {...챌린지} 큼 />
      </div>
    </div>
  );
}

function 영상카드({ 그림, 제목, 갈래, 설명, 큼 }) {
  return (
    <div className="카드" style={{ ...카드, width: "100%", height: "100%" }}>
      <img loading="lazy" decoding="async" src={그림} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {/* 가운데 재생 단추 */}
      <div style={재생}>
        <img loading="lazy" decoding="async" src={에셋.imgPlay2} alt="" style={{ width: "24px", height: "24px", display: "block" }} />
      </div>
      {/* 아래쪽 설명 — 바탕색으로 녹여 내린다 */}
      <div style={설명칸}>
        <div style={{ fontFamily: 글꼴.제목, fontSize: 큼 ? "32px" : "24px", color: "#f1f1fc" }}>{제목}</div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#6f86bf", textTransform: "uppercase" }}>{갈래}</span>
          {큼 && <span style={지금보는중}>NOW PLAYING</span>}
        </div>
        <div style={{ fontFamily: 글꼴.본문, fontSize: "16px", lineHeight: 1.5, color: "#8b93a3" }}>{설명}</div>
      </div>
    </div>
  );
}

/* 큰 카드에만 붙는 표시 — 위 목록과 같은 제목이 두 번 보이는 걸 설명해 준다 */
const 지금보는중 = {
  fontFamily: "inherit",
  fontSize: "15px",
  fontWeight: 700,
  letterSpacing: "1px",
  color: "#6f86bf",
  padding: "3px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(50,82,150,0.45)",
  background: "rgba(46,72,137,0.12)",
  whiteSpace: "nowrap",
};

const 갤러리 = {
  position: "absolute",
  /* 폭 1480 덩이는 1920 한가운데(220) — 원본은 210~217 로 제각각이었다 */
  left: "220px",
  width: "1480px",
  height: "517px",
  padding: "24px 32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(46,72,137,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 카드 = {
  position: "relative",
  borderRadius: "12px",
  border: "1px solid #1a305f",
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
  border: "1px solid #2e4889",
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
  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(1,4,10,0.85) 45%, #01040a 100%)",
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
  color: "#8b93a3", /* 어두운 면 위 화살표 — 회색 */
  background: "transparent", /* <button> 기본 흰 바탕이 사각형으로 떴다 */
  border: "none",
  cursor: "pointer",
};
const 쪽바탕 = { width: "40px", height: "40px", borderRadius: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: 글꼴.모노, fontSize: "16px", boxSizing: "border-box" };
/* 흰 글자에 #3b82f6 은 3.7:1 이라 본문 기준에 못 미쳤다. 한 단계 진한 파랑이면 6.3:1 */
const 켜진쪽 = { ...쪽바탕, background: "#2f3e70", color: "#ffffff", fontWeight: 700 };
const 꺼진쪽 = { ...쪽바탕, background: "rgba(9,14,31,0.8)", border: "1px solid #1a305f", color: "#96a3b6" };
