import { useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 글자그라디언트, 막음, 막음안내 } from "../공통.js";
import { 요금제 as 자료 } from "../데이터/요금제.js";
import 심장선 from "../심장선.jsx";
import 세로선 from "../세로선.jsx";
import { use기울임, use드러내기, 다가옴클래스 } from "../움직임.js";

/* ═══════════════════════════════════════════════════════
   구독 요금제 — 피그마 14:1802 (폭 1699)
   세 덩이: 플랜 비교(756) · 결제 정보 · 혜택 안내(813)

   플랜 카드는 오토레이아웃이 아니라 좌표로 놓여 있다(left 57 / 556 / 1063).
   가운데 PREMIUM 만 10px 크고 테두리가 더 밝다 — 강조된 플랜이다.
   ═══════════════════════════════════════════════════════ */

const 카드배경 = {
  BASIC: "linear-gradient(180deg, #091229 0%, #02040a 100%)",
  PREMIUM: "linear-gradient(180deg, #142e61 0%, #02040a 100%)",
  ULTIMATE:
    "linear-gradient(147.383deg, rgb(20,46,97) 13.139%, rgb(13,31,71) 31.387%, rgb(8,18,41) 53.285%, rgb(4,10,26) 71.533%, rgb(2,4,10) 86.131%)",
};

/* ═══════════════════════════════════════════════════════
   플랜 캐러셀

   피그마는 카드 세 장을 좌표로 못 박아 뒀다(left 57 / 556 / 1063).
   그 **자리 세 개는 그대로 두고**, 어떤 플랜이 어느 자리에 앉을지만 돌린다.
   그래서 화살표를 누르면 카드가 자리 사이를 미끄러진다.

   가운데 자리는 원본부터 조금 크다(475×530 vs 467×520) — 강조된 플랜이다.
   여기에 「둥둥」 을 더해 가운데 것만 위아래로 천천히 떠 있게 했다.
   ═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   카드 세 자리

   [왜 left/top/width/height 를 안 쓰나]
   처음엔 네 값을 모두 애니메이션했는데, width·height·left·top 은 **배치를
   다시 계산하게 만든다**(layout thrash). 카드 안에 글이 수십 줄이라 옮길
   때마다 눈에 띄게 버벅였다.
   그래서 **상자는 한 크기로 고정**하고 자리 이동은 transform: translate3d,
   가운데 카드의 큰 크기는 scale 로 낸다. 둘 다 합성 단계에서만 처리돼
   배치를 건드리지 않는다.

   기준 크기 467×520, 가운데만 475×530 → 배율 475/467 ≈ 1.017.
   ═══════════════════════════════════════════════════════ */
const 기준폭 = 467;
const 기준높이 = 520;
const 가운데배율 = 475 / 기준폭;

const 자리 = [
  { x: 57, y: 60, 배율: 1 },
  /* 가운데 — 조금 크고 위로 올라와 있다. 커진 만큼(양옆 4px·위아래 5px)
     제자리에서 부풀므로 왼쪽/위를 그만큼 당겨 원본 좌표(556,50)에 맞춘다. */
  { x: 556 + (475 - 기준폭) / 2, y: 50 + (530 - 기준높이) / 2, 배율: 가운데배율 },
  { x: 1063, y: 60, 배율: 1 },
];
const 가운데자리 = 1;

export default function 요금제구간({ 위 = 0 }) {
  /* 돌린 칸 수. 0 이면 원래 순서(BASIC·PREMIUM·ULTIMATE) */
  const [돌림, set돌림] = useState(0);
  const 장수 = 자료.카드.length;
  const 돌리기 = (걸음) => set돌림((v) => (v + 걸음 + 장수) % 장수);

  return (
    <div style={{ position: "absolute", left: "110px", top: `${위}px`, width: "1699px", display: "flex", flexDirection: "column", gap: "100px" }} data-node-id="14:1802">
      {/* ── 플랜 비교 ── */}
      <section style={{ ...덩이, height: "756px", background: "none", border: "none" }} data-node-id="14:1803">
        <머리 꼬리표="Plans" 제목="구독 플랜 비교" 설명="가장 적합한 플랜을 선택하고, 혜택을 한눈에 비교하세요." />

        <div style={{ position: "relative", width: "1587px", height: "640px" }}>
          {자료.카드.map((ㅋ, i) => {
            /* i 번째 카드가 지금 앉아 있는 자리 */
            const 자리번호 = (i + 돌림) % 장수;
            const ㅈ = 자리[자리번호];
            const 켜짐 = 자리번호 === 가운데자리;
            return (
              <div
                key={ㅋ.이름}
                onClick={() => !켜짐 && 돌리기(가운데자리 - 자리번호)}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${기준폭}px`,
                  height: `${기준높이}px`,
                  /* 자리 이동도 크기 변화도 전부 transform 하나로 — 배치를 안 건드린다 */
                  transform: `translate3d(${ㅈ.x}px, ${ㅈ.y}px, 0) scale(${ㅈ.배율})`,
                  transition: "transform .5s var(--부드럽게)",
                  willChange: "transform",
                  zIndex: 켜짐 ? 2 : 1,
                  cursor: 켜짐 ? "default" : "pointer",
                }}
              >
                <div
                  className={켜짐 ? "둥둥" : undefined}
                  style={{
                    width: "100%",
                    height: "100%",
                    padding: "32px",
                    borderRadius: "20px",
                    background: 카드배경[ㅋ.이름],
                    border: 켜짐 ? "1.5px solid rgba(96,165,250,0.85)" : "1px solid rgba(59,130,246,0.2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px",
                    overflow: "hidden",
                    boxSizing: "border-box",
                    /* 뒤에서 번지는 빛 — 가운데 것만 */
                    boxShadow: 켜짐
                      ? "0 0 72px 10px rgba(59,130,246,0.32), 0 20px 52px 0 rgba(29,78,216,0.45)"
                      : "0 8px 24px 0 rgba(0,0,0,0.35)",
                    /* 옆 카드는 한 겹 뒤로 물러난 느낌 — 글은 읽히되 가운데가 먼저 눈에 든다 */
                    transition: "border-color .45s ease, box-shadow .45s ease, opacity .45s ease, filter .45s ease",
                    opacity: 켜짐 ? 1 : 0.7,
                    filter: 켜짐 ? "none" : "saturate(0.75) brightness(0.88)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <span style={{ fontFamily: 글꼴.제목, fontSize: "32px", color: "#eeeeff" }}>{ㅋ.이름}</span>
                    <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "24px", color: "#60a5fa" }}>{ㅋ.값}</span>
                  </div>
                  <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#94a3b8" }}>{ㅋ.요약}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: "1 0 auto" }}>
                    {ㅋ.혜택.map((줄) => (
                      <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.6, color: "#94a3b8" }}>
                        {줄}
                      </span>
                    ))}
                  </div>
                  {/* 원본 차례: 덧붙임 글 → 파형 → 오른쪽 아래 「구독하기」 알약 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {ㅋ.덧.map((줄) => (
                      <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#64748b" }}>
                        {줄}
                      </span>
                    ))}
                  </div>

                  {/* 강조된 카드에만 깔리는 파형 188:3633 · 188:3634 —
                      334 짜리 위에 270 짜리를 겹쳐서 가운데가 진해 보인다 */}
                  {켜짐 && (
                    <div style={파형칸} aria-hidden="true" data-node-id="188:3633">
                      <심장선 모양="카드맥" 폭="334px" 높이="16px" 굵기={1.1} 진하기={0.5} 주기={2.6} style={파형} />
                      <심장선 모양="카드맥작" 폭="270px" 높이="16px" 굵기={1.1} 진하기={0.65} 주기={2.6} 늦춤={0.35} style={파형} />
                    </div>
                  )}

                  <div style={{ ...구독단추, ...막음 }} title={막음안내}>구독하기</div>
                </div>
              </div>
            );
          })}

          {/* 좌우 화살표 — 카드 바깥 여백(57px)에 들어간다 */}
          <button className="플랜화살표" style={{ ...화살표, left: "-3px" }} onClick={() => 돌리기(1)} aria-label="이전 플랜">
            ‹
          </button>
          <button className="플랜화살표" style={{ ...화살표, right: "-3px" }} onClick={() => 돌리기(-1)} aria-label="다음 플랜">
            ›
          </button>
        </div>
      </section>

      {/* ── 결제 정보 ── */}
      <section style={덩이} data-node-id="14:1807">
        <머리 꼬리표="Payment" 제목="결제 정보" 설명="결제 수단을 등록하고, 자동 결제/환불 정책을 확인하세요." />
        <div style={{ display: "flex", gap: "24px", width: "100%" }}>
          {자료.결제상자.map((ㅂ) => (
            <결제상자 key={ㅂ.제목} {...ㅂ} />
          ))}
        </div>
      </section>

      {/* ── 혜택 안내 ── */}
      <section style={{ ...덩이, height: "760px", gap: "84px" }} data-node-id="14:1808">
        <머리 꼬리표="Benefits" 제목="혜택 안내" 설명="구독 혜택을 한눈에 확인하고, 시즌 드롭을 미리 준비하세요." />
        <div style={혜택칸}>
          <div style={{ width: "520px", height: "356px", borderRadius: "16px", overflow: "hidden", flexShrink: 0 }}>
            <img src={에셋.imgBenefitImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ width: "249px", height: "195px", marginLeft: "48px", alignSelf: "flex-end", marginBottom: "7px", borderRadius: "16px", overflow: "hidden", flexShrink: 0 }}>
            <img src={에셋.imgBenefitImage1} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          {/* 그림과 글 사이 호 188:3650 — 로그인 화면과 같은 호를 쓴다.
              칸(420) 보다 조금 짧게(360) 잡아 위아래가 상자 테두리에 닿지 않게 했다. */}
          <세로선 가운데={호가운데} 위={30} 높이={360} />
          <div style={{ width: "403px", marginLeft: "335px", display: "flex", flexDirection: "column", gap: "22px" }}>
            <div style={{ fontFamily: 글꼴.제목, fontSize: "36px", lineHeight: 1.2, ...글자그라디언트("linear-gradient(90deg, #dbeafe 0%, #60a5fa 55%, #3b82f6 100%)") }}>
              {자료.혜택제목}
            </div>

            <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.75, color: "#94a3b8" }}>
              {자료.혜택소개}
            </div>

            <div style={{ height: "1px", background: "linear-gradient(90deg, rgba(59,130,246,0.4) 0%, rgba(59,130,246,0) 100%)" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {자료.혜택점.map(({ 글, 덧 }) => (
                <div key={글} style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
                  <span style={{ ...점표, alignSelf: "center" }} />
                  <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "16px", color: "#e2e8f0", whiteSpace: "nowrap" }}>{글}</span>
                  <span style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#64748b" }}>{덧}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* 덩이 머리 — 작은 이름표 · (있으면) 큰 제목 · 설명 순서로 **왼쪽에 쌓인다.**
   피그마(14:1804 / 14:1842 / 14:1843)가 그렇다. 전에는 설명을 오른쪽 끝에
   붙여 뒀는데 원본은 제목 바로 아랫줄이다.
   큰제목은 「결제 정보」 덩이에만 있다(14:1842). */
/* 결제 정보 한 상자 — 제목 / 한 줄 요약 / 항목 목록.
   항목 앞의 「•」 는 데이터에 글자로 들어 있어서, 점을 떼고 따로 그린다.
   그래야 줄이 넘어갈 때 둘째 줄이 점 아래로 파고들지 않는다. */
function 결제상자({ 제목, 요약, 줄, 아이콘 }) {
  const 기울임 = use기울임(3);
  const [칸, 보임] = use드러내기();

  return (
    <div ref={칸} className={`기울임판 ${다가옴클래스(보임)}`} style={{ flex: "1 0 0", minWidth: 0 }}>
      <div
        ref={기울임.ref}
        onMouseMove={기울임.onMouseMove}
        onMouseLeave={기울임.onMouseLeave}
        className="카드 기울임"
        style={{ ...작은상자, width: "100%", height: "100%" }}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={아이콘칸}>
            <img src={에셋[아이콘]} alt="" style={{ width: "18px", height: "18px", display: "block" }} />
          </div>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "19px", color: "#eeeeff", letterSpacing: "0.2px" }}>{제목}</span>
        </div>

        <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.5, color: "#60a5fa" }}>{요약}</div>

        <div style={{ height: "1px", background: "linear-gradient(90deg, rgba(59,130,246,0.35) 0%, rgba(59,130,246,0) 100%)" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
          {줄.map((ㅈ) => (
            <div key={ㅈ} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ ...점표, marginTop: "9px" }} />
              <span style={{ fontFamily: 글꼴.모노, fontSize: "15px", lineHeight: 1.65, color: "#a8b5c6", flex: "1 0 0" }}>
                {ㅈ.replace(/^[•·]\s*/, "")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   덩이 머리 — 영문 꼬리표 · 큰 제목 · 설명

   [원본과 다른 점]
   피그마는 작은 이름표(14:1804)와 큰 제목(14:1842)에 **같은 말**을 넣어 뒀다
   (「결제 정보」가 위아래로 두 번). 그대로 두면 같은 말이 두 번 읽힌다.
   그래서 위쪽은 영문 꼬리표로 바꿔 구간을 알리고, 아래 한글 큰 제목을
   진짜 제목으로 삼았다. 세 덩이 모두 같은 층으로 맞췄다.
   ═══════════════════════════════════════════════════════ */
function 머리({ 꼬리표, 제목, 설명 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
      <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "15px", color: "#3b82f6", letterSpacing: "2.5px", textTransform: "uppercase" }}>
        {꼬리표}
      </span>
      <span style={{ fontFamily: 글꼴.제목, fontSize: "42px", lineHeight: 1.18, color: "#eeeeff" }}>{제목}</span>
      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.6, color: "#64748b" }}>{설명}</span>
    </div>
  );
}

const 덩이 = {
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  padding: "56px",
  borderRadius: "24px",
  background: "#060d1a",
  border: "1px solid #1e3a5f",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  filter: "drop-shadow(0px 8px 16px rgba(29,78,216,0.13))",
  width: "100%",
  boxSizing: "border-box",
};

const 구독단추 = {
  alignSelf: "flex-end", /* 원본은 카드 오른쪽 아래에 붙는 작은 알약이다 */
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "40px",
  padding: "10px 22px",
  borderRadius: "100px",
  background: "rgba(10,18,32,0.75)",
  border: "1px solid rgba(96,165,250,0.35)",
  fontFamily: 글꼴.모노,
  fontWeight: 700,
  fontSize: "16px",
  color: "#93c5fd",
  cursor: "pointer",
  boxSizing: "border-box",
};

const 작은상자 = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "32px",
  borderRadius: "20px",
  /* 평평한 한 색보다 위에서 아래로 옅어지는 쪽이 덜 납작해 보인다 */
  background: "linear-gradient(180deg, #0a1a3d 0%, #071230 62%, #050d24 100%)",
  border: "1px solid #1e3a5f",
  boxSizing: "border-box",
};

const 아이콘칸 = {
  width: "36px",
  height: "36px",
  borderRadius: "12px",
  background: "rgba(10,18,32,0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const 혜택칸 = {
  display: "flex",
  gap: "0px",
  alignItems: "center",
  position: "relative",
  height: "420px",
  padding: "32px",
  borderRadius: "20px",
  background: "#071230",
  width: "1587px",
  boxSizing: "border-box",
};


/* 작은 그림이 끝나는 자리(849)와 글이 시작하는 자리(1184)의 한가운데.
   혜택칸은 position: relative 라 이 값이 그 안쪽 기준이 된다. */
const 호가운데 = Math.round((849 + 1184) / 2);

/* 파형 두 장을 겹쳐 놓는 칸 */
const 파형칸 = {
  position: "relative",
  height: "16px",
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const 파형 = {
  position: "absolute",
  height: "16px",
  maxWidth: "none",
  display: "block",
};

/* 혜택 목록 앞 점 126:1246 — 6px 파란 원 */
const 점표 = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "#3b82f6",
  flexShrink: 0,
};

const 화살표 = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "46px",
  height: "46px",
  borderRadius: "999px",
  background: "rgba(6,13,26,0.75)",
  border: "1px solid rgba(96,165,250,0.35)",
  color: "#93c5fd",
  fontFamily: 글꼴.본문,
  fontSize: "26px",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  zIndex: 3,
};
