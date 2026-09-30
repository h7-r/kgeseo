import { use스윽 } from "../움직임.js";
import { 글꼴, 영상잠금 } from "../공통.js";

/* ═══════════════════════════════════════════════════════
   사건 파일 — 영상 자리(피그마 14:1262 · 1920 × 1047 · y=2711)

   [전엔] 게임 영상이 들어올 빈 틀만 있어서, 스크롤하다 보면 한 화면이 통째로 비었다.
   [지금] 앙암바위 절경(case.webp)이 먼저 깔리고, 앙암바위 구간처럼
          **가운데에서 멈춘 채** 스크롤한 만큼 장면이 열린다.

   [스크롤 흐름] (움직임.js use스윽 — 앙암바위와 같은 훅, 핀이름만 다르다)
     ① 올라오는 동안(--들어옴 0→1) : 화면을 **꽉 채운 채** 절벽에 바짝 당겨져(1.9배) 어둡게 보인다
     ② 멈춘 뒤 앞 42%(--진행 0→0.42) : **힉스필드식 카메라** — 카메라가 뒤로 빠지며(1.9 → 1.0)
        내려다보던 각도·기울었던 수평이 바로 서고, 안개가 걷히듯 밝아진다
     ③ 멈춘 뒤 나머지 : 글이 위에서부터 차례로 왼쪽→오른쪽 스윽 드러난다
     ④ 영상잠금만큼 내리면 풀려서 다음 구간으로 흘러간다
   그림의 확대·기울기·밝기는 CSS 가 --들어옴·--진행 두 숫자로 계산한다(index.css .사건파일).

   [빈 화면이 안 생기게]
   · 그림을 불러오기 전에도 그림의 평균색(#676a6b 계열)을 바탕에 깔아 둔다 — 검은 구멍 대신 안개 낀 회색.
   · loading="lazy" 라도 브라우저는 화면에 닿기 한참 전(수천 px 앞)에 받기 시작한다.
   · decoding="async" — 그림 풀기를 주 스레드 밖에서 해서 스크롤이 안 끊긴다.

   [글] 설화 사실 계약서(01)의 확정 사실만 쓴다 — 결말(반전)은 밝히지 않는다.
   ═══════════════════════════════════════════════════════ */
export default function 영상() {
  /* 잠금: 멈춰 있는 스크롤 거리(무대 px). 이만큼 아래 구간들이 내려가 있다(시작화면.jsx 밀림 상자) */
  /* 글시작 0.42 — 멈춘 뒤 처음 42% 는 카메라(그림)만 움직이고, 그다음에 글이 드러난다 */
  const 판 = use스윽({ 잠금: 영상잠금, 핀이름: "영상핀", 진행쓰기: true, 폭: 0.5, 끝몫: 0.9, 글시작: 0.42 });

  return (
    <section ref={판} className="영상핀 사건파일" style={바깥} data-node-id="14:1262">
      {/* 그림 칸 — CSS 가 스크롤 값으로 확대·기울기·밝기를 바꾼다(늘 화면을 꽉 채운다) */}
      <div className="사건파일창">
        <img className="사건파일그림" src="/case.webp" alt="안개 낀 영산강 위로 솟은 앙암바위 절벽" loading="lazy" decoding="async" width="1920" height="1085" />
      </div>
      {/* 아래·왼쪽을 어둡게 — 글이 그림 위에서도 읽히게 */}
      <div className="사건파일어둠" aria-hidden="true" />

      <div style={글자리}>
        <div className="스윽" style={눈썹}>
          <span style={점} aria-hidden="true" />
          CASE FILE · NAJU-01 · 영산포
        </div>
        <h2 className="스윽" style={제목}>
          영산강 절벽 위,
          <br />
          약속은 돌아오지 않았다.
        </h2>
        <p className="스윽" style={본문}>
          영산포와 앙암바위 일대에서 사람들의 기억과 기록이 서로 어긋나기 시작했다.
          <br />
          합동수사본부는 현장 조사관을 이곳에 투입한다.
        </p>
        <div className="스윽" style={사실줄}>
          {[
            ["장소", "전라남도 나주 · 앙암바위"],
            ["설화", "아랑사와 아비사"],
            ["상태", "왜곡 감지"],
          ].map(([라벨, 값]) => (
            <div key={라벨} style={사실칸}>
              <span style={사실라벨}>{라벨}</span>
              <span style={{ ...사실값, ...(라벨 === "상태" ? { color: "#fca5a5" } : {}) }}>{값}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const 바깥 = {
  position: "absolute",
  left: 0,
  top: "2711px",
  width: "1920px",
  height: "1047px",
  overflow: "hidden",
  background: "#5d6163", // 그림 평균색 — 그림이 오기 전에도 빈 구멍처럼 보이지 않게
  borderTop: "1px solid #1a305f",
  borderBottom: "1px solid #1a305f",
  boxSizing: "border-box",
};

const 글자리 = {
  position: "absolute",
  left: "188px",
  bottom: "140px",
  width: "980px",
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  zIndex: 2,
};
const 눈썹 = { display: "flex", alignItems: "center", gap: "12px", fontFamily: 글꼴.모노, fontSize: "18px", letterSpacing: "2.4px", color: "#c9d2ee" };
const 점 = { width: "8px", height: "8px", borderRadius: "50%", background: "#f87171", boxShadow: "0 0 12px rgba(248,113,113,0.8)" };
const 제목 = { margin: 0, fontFamily: 글꼴.넓게, fontWeight: 700, fontSize: "84px", lineHeight: 1.12, letterSpacing: "-0.5px", color: "#f5f6fb", textShadow: "0 4px 30px rgba(0,0,0,0.45)" };
const 본문 = { margin: 0, fontFamily: 글꼴.본문, fontSize: "24px", lineHeight: 1.7, color: "#d5dbe7", textShadow: "0 2px 16px rgba(0,0,0,0.5)" };
const 사실줄 = { display: "flex", gap: "12px" };
const 사실칸 = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "14px 20px",
  borderRadius: "12px",
  background: "rgba(5,11,26,0.55)",
  border: "1px solid rgba(111,134,191,0.35)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};
const 사실라벨 = { fontFamily: 글꼴.모노, fontSize: "14px", letterSpacing: "1px", color: "#8b9bc4" };
const 사실값 = { fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "20px", color: "#f1f1fc", whiteSpace: "nowrap" };
