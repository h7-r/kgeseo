import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 장식빛 } from "../공통.js";
import { use기울임, use드러내기, 다가옴클래스 } from "../움직임.js";
import { use가까움 } from "../근접.js";
import 심장선 from "../심장선.jsx";
import { 오르는글 } from "../연출.jsx";

/* ═══════════════════════════════════════════════════════
   몰입감 넘치는 게임 경험 — 피그마 121:2583 (Group 30)

   이 구간은 **세 겹**이다. 처음에 하나로 합쳐 버렸다가 모양이 어긋났다:

     121:2291  밝은 바탕   1920 × 946 · #fff9f9 · **라운드 없음** · 화면 끝까지
     140:1253  내용 칸     1480 폭 · left 217 · rounded-24 · 바탕 없음(투명)
     121:2565  아래 물결   800 × 7.9 · left 557

   바탕과 내용 칸은 크기도 라운드도 다르다. 합치면 밝은 면이 1480 으로 줄고
   모서리가 둥글어진다 — 원본은 화면 끝까지 각진 면이다.

   지표 사이의 **세로 막대**는 64px 짜리 선을 90° 돌린 것이다(140:1303).
   항목 아래에 가로로 깔면 안 된다.
   ═══════════════════════════════════════════════════════ */

const 기능 = [
  { 번호: "01", 그림: 에셋.imgNavigation, 제목: "실시간 3D 탐험", 설명: "완전한 자유도의 1인칭 시점으로 미스터리한 공간을 직접 탐험하세요." },
  { 번호: "02", 그림: 에셋.imgKey, 제목: "정교한 퍼즐", 설명: "논리적 추론과 창의적 사고가 필요한 다층 구조의 퍼즐 시스템." },
  { 번호: "03", 그림: 에셋.imgBookOpen, 제목: "스토리 몰입", 설명: "각 지역의 전설과 역사를 기반으로 한 깊이 있는 내러티브." },
  { 번호: "04", 그림: 에셋.imgUsers, 제목: "멀티플레이", 설명: "최대 4인 협동 플레이로 함께 단서를 찾고 탈출하세요." },
];

const 지표 = [
  ["50+", "탈출 맵"],
  ["100K+", "플레이어"],
  ["4.9", "평균 평점"],
  ["24/7", "실시간 서버"],
];

export default function 몰입경험({ 위 = 0 }) {
  return (
    <>
      {/* ── 밝은 바탕 121:2291 — 화면 끝까지, 각진 면 ── */}
      <div
        style={{ position: "absolute", left: "-1px", top: `${위}px`, width: "1920px", height: "946px", background: "#f7f9fc" }} /* 분홍 기운(#fff9f9) → 다른 흰 면과 같은 색 */
        data-node-id="121:2291"
      />

      {/* ── 아래쪽 물결 121:2565 ── */}
      <div
        style={{ position: "absolute", left: "557px", top: `${위 + 893}px`, width: "800px", height: "7.895px", pointerEvents: "none" }}
        data-node-id="121:2565"
      >
        <div style={{ position: "absolute", top: "-6.06%", bottom: "-6.06%", left: 0, right: 0 }}>
          {/* 밝은 바탕 위라 선·빛을 조금 진하게 잡는다 */}
          <심장선 모양="넓은맥" 폭="100%" 높이="100%" 색="#2f3e70" 빛="#2f427b" 굵기={1.1} 진하기={0.45} 주기={4.2} />
        </div>
      </div>

      {/* ── 내용 칸 140:1253 ── */}
      <section style={{ ...내용칸, top: `${위}px` }} data-node-id="140:1253">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", width: "100%", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#3a5794" /* 흰 면 위라 #6f86bf(3.6:1)는 흐렸다 → 푸터와 같은 남색(6.9:1) */, textTransform: "uppercase" }}>
            <span>CORE FEATURES</span>
          </div>
          <오르는글 글="몰입감 넘치는 게임 경험" 쪼갬={false} style={큰제목} />
        </div>

        <div style={{ position: "relative", display: "flex", gap: "20px", alignItems: "flex-start", justifyContent: "center", width: "100%" }}>
          {/* 카드 뒤로 번지는 큰 원 121:2567 */}
          <div style={{ position: "absolute", left: "345px", top: "-210px", width: "624px", height: "1152px", pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: "-26.04%", bottom: "-26.04%", left: "-48.08%", right: "-48.08%" }}>
              <img loading="lazy" decoding="async" src={에셋.imgEllipse13} alt="" style={{ display: "block", width: "100%", height: "100%", maxWidth: "none", ...장식빛, opacity: 0.35 /* 흰 면 위 회보라 얼룩 → 옅게 */ }} />
            </div>
          </div>

          {기능.map((ㄱ, i) => (
            <기능한장 key={ㄱ.번호} {...ㄱ} 순서={i} />
          ))}
        </div>

        {/* 가로 실선 140:1298 — 양끝이 투명해진다 */}
        <div style={{ height: "1px", width: "100%", background: "linear-gradient(90deg, rgba(26,48,95,0) 0%, #1a305f 50%, rgba(26,48,95,0) 100%)" }} />

        {/* 지표 줄 140:1299 — 사이사이에 세로 막대 */}
        <div style={{ display: "flex", gap: "40px", alignItems: "center", justifyContent: "center", padding: "16px 0", width: "100%" }}>
          {지표.map(([값, 이름], i) => (
            <지표칸 key={이름} 값={값} 이름={이름} 막대={i < 지표.length - 1} />
          ))}
        </div>
      </section>
    </>
  );
}

/* 기능 카드 한 장 — 차례로 떠오르고 마우스를 따라 기운다 */
function 기능한장({ 번호, 그림, 제목, 설명, 순서 }) {
  const 기울임 = use기울임(4);
  const [보임칸, 보임] = use드러내기();
  const 가까이 = use가까움(240);

  return (
    <div ref={보임칸} className={`기울임판 ${다가옴클래스(보임)}`} style={{ flex: "1 0 0", minWidth: 0, transitionDelay: `${순서 * 30}ms` }}>
      <div
        ref={(el) => { 기울임.ref.current = el; 가까이.current = el; }}
        onMouseMove={기울임.onMouseMove}
        onMouseLeave={기울임.onMouseLeave}
        className="기울임 가까이-안"
        style={{ ...카드, flex: "none", width: "100%" }}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={아이콘칸}>
            <img loading="lazy" decoding="async" src={그림} alt="" style={{ width: "18px", height: "18px", display: "block" }} />
          </div>
          <div style={번호딱지}>{번호}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
          <div style={{ fontFamily: 글꼴.본문, fontWeight: 700, fontSize: "26px", lineHeight: 1.35, color: "#eef2f6", width: "100%" }}>{제목}</div>
          <div style={{ fontFamily: 글꼴.모노, fontWeight: 400, fontSize: "18px", lineHeight: 1.65, color: "#8b93a3", width: "100%" }}>
            {설명}
          </div>
        </div>
      </div>
    </div>
  );
}

function 지표칸({ 값, 이름, 막대 }) {
  return (
    <>
      <div style={{ flex: "1 0 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", textAlign: "center", whiteSpace: "nowrap" }}>
        <span style={지표숫자}>{값}</span>
        {/* 이 글자는 검정(#000)이었다 — 어두운 바탕이라 1.0:1, 통째로 안 보였다 */}
        <span style={{ fontFamily: 글꼴.모노, fontWeight: 500, fontSize: "16px", color: "#5f6878", textTransform: "uppercase" }}>{이름}</span>
      </div>
      {막대 && (
        /* 64px 선을 90° 돌려 세운다 (140:1303) */
        <div style={{ display: "flex", height: "64px", width: 0, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ flex: "none", transform: "rotate(90deg)" }}>
            <div style={{ position: "relative", width: "64px", height: 0 }}>
              <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
                <img loading="lazy" decoding="async" src={에셋.imgLine2} alt="" style={{ display: "block", width: "100%", height: "100%", maxWidth: "none" }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const 내용칸 = {
  position: "absolute",
  /* 폭 1480 덩이는 1920 한가운데(220) — 원본은 210~217 로 제각각이었다 */
  left: "220px",
  width: "1480px",
  padding: "80px 60px",
  borderRadius: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "64px",
  alignItems: "flex-start",
  overflow: "hidden",
  boxSizing: "border-box",
};

const 큰제목 = {
  fontFamily: 글꼴.본문,
  fontWeight: 900,
  fontSize: "52px",
  textAlign: "center",
  ...글자그라디언트("linear-gradient(90deg, #1b2855 24.519%, #556e98 65.433%, #3b5ea2 100%)"),
};

const 카드 = {
  position: "relative",
  flex: "1 0 0",
  minWidth: 0,
  minHeight: "280px",
  padding: "32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(46,72,137,0.6)",
  background: "linear-gradient(180deg, #081228 0%, #01040a 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  justifyContent: "space-between",
  overflow: "hidden",
  boxShadow: "0px 0px 24px 0px rgba(46,72,137,0.18)",
  boxSizing: "border-box",
};

const 아이콘칸 = {
  width: "40px",
  height: "40px",
  borderRadius: "20px",
  background: "rgba(46,72,137,0.12)",
  border: "1px solid #2e4889",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const 번호딱지 = {
  padding: "4px 8px",
  borderRadius: "100px",
  background: "rgba(255,255,255,0.03)",
  fontFamily: 글꼴.모노,
  fontSize: "16px",
  color: "#96a3b6",
};

const 지표숫자 = {
  fontFamily: 글꼴.제목,
  fontSize: "60px",
  ...글자그라디언트("linear-gradient(180deg, #536c95 39.904%, #111b34 100%)"),
};
