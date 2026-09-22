import { useState } from "react";
import 에셋 from "../에셋.js";
import { 글꼴, 막음, 막음안내 } from "../공통.js";
import { 요금제 as 자료 } from "../데이터/요금제.js";

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

/* 강조할 플랜 — 기본은 가운데(PREMIUM), 마우스를 올리면 그 카드로 옮겨 간다 */
const 기본강조 = "PREMIUM";

export default function 요금제구간({ 위 = 0 }) {
  const [올린것, set올린것] = useState(null);
  const 강조 = 올린것 ?? 기본강조;
  return (
    <div style={{ position: "absolute", left: "110px", top: `${위}px`, width: "1699px", display: "flex", flexDirection: "column", gap: "100px" }} data-node-id="14:1802">
      {/* ── 플랜 비교 ── */}
      <section style={{ ...덩이, height: "756px", background: "none", border: "none" }} data-node-id="14:1803">
        <머리 제목="구독 플랜 비교" 설명="가장 적합한 플랜을 선택하고, 혜택을 한눈에 비교하세요." />
        <div style={{ position: "relative", width: "1587px", height: "640px" }}>
          {자료.카드.map((ㅋ) => {
            const 켜짐 = ㅋ.이름 === 강조;
            return (
            <div
              key={ㅋ.이름}
              onMouseEnter={() => set올린것(ㅋ.이름)}
              onMouseLeave={() => set올린것(null)}
              style={{
                position: "absolute",
                left: `${ㅋ.칸.left}px`,
                top: `${ㅋ.칸.top}px`,
                width: `${ㅋ.칸.w}px`,
                height: `${ㅋ.칸.h}px`,
                padding: "32px",
                borderRadius: "20px",
                background: 카드배경[ㅋ.이름],
                border: 켜짐
                  ? "1.5px solid rgba(96,165,250,0.85)"
                  : ㅋ.이름 === "BASIC"
                    ? "1.5px solid rgba(59,130,246,0.7)"
                    : "1px solid rgba(59,130,246,0.2)",
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                overflow: "hidden",
                boxSizing: "border-box",
                /* 강조된 것만 제 크기, 나머지는 살짝 작게 — 가운데가 도드라진다 */
                transform: `scale(${켜짐 ? 1 : 0.955})`,
                transformOrigin: "center",
                /* 뒤에서 번지는 빛 */
                boxShadow: 켜짐
                  ? "0 0 72px 10px rgba(59,130,246,0.32), 0 20px 52px 0 rgba(29,78,216,0.45)"
                  : "0 8px 24px 0 rgba(0,0,0,0.35)",
                zIndex: 켜짐 ? 2 : 1,
                transition: "transform .26s ease, box-shadow .26s ease, border-color .26s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <span style={{ fontFamily: 글꼴.제목, fontSize: "32px", color: "#eeeeff" }}>{ㅋ.이름}</span>
                <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "24px", color: "#60a5fa" }}>{ㅋ.값}</span>
              </div>
              <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#94a3b8" }}>{ㅋ.요약}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: "1 0 0" }}>
                {ㅋ.혜택.map((줄) => (
                  <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.6, color: "#94a3b8" }}>
                    {줄}
                  </span>
                ))}
              </div>
              <div style={{ ...구독단추, ...막음 }} title={막음안내}>구독하기</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {ㅋ.덧.map((줄) => (
                  <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "14px", color: "#64748b" }}>
                    {줄}
                  </span>
                ))}
              </div>
            </div>
            );
          })}
        </div>
      </section>

      {/* ── 결제 정보 ── */}
      <section style={덩이} data-node-id="14:1807">
        <머리 제목="결제 정보" 설명="결제 수단을 등록하고, 자동 결제/환불 정책을 확인하세요." />
        <div style={{ display: "flex", gap: "24px", width: "100%" }}>
          {자료.결제상자.map((ㅂ) => (
            <div key={ㅂ.제목} style={작은상자}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={아이콘칸}>
                  <img src={에셋[ㅂ.아이콘]} alt="" style={{ width: "18px", height: "18px", display: "block" }} />
                </div>
                <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "18px", color: "#eeeeff" }}>{ㅂ.제목}</span>
              </div>
              <div style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#60a5fa" }}>{ㅂ.요약}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {ㅂ.줄.map((줄) => (
                  <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "15px", lineHeight: 1.6, color: "#94a3b8" }}>
                    {줄}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 혜택 안내 ── */}
      <section style={{ ...덩이, height: "813px", gap: "40px" }} data-node-id="14:1808">
        <머리 제목="혜택 안내" 설명="구독 혜택을 한눈에 확인하고, 시즌 드롭을 미리 준비하세요." />
        <div style={혜택칸}>
          <div style={{ width: "520px", height: "356px", borderRadius: "16px", overflow: "hidden", flexShrink: 0 }}>
            <img src={에셋.imgBenefitImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ width: "249px", height: "195px", borderRadius: "16px", overflow: "hidden", flexShrink: 0 }}>
            <img src={에셋.imgBenefitImage1} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ width: "403px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ fontFamily: 글꼴.제목, fontSize: "36px", color: "#eeeeff" }}>{자료.혜택제목}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {자료.혜택줄.map((줄) => (
                <span key={줄} style={{ fontFamily: 글꼴.모노, fontSize: "16px", lineHeight: 1.6, color: "#94a3b8" }}>
                  {줄}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {자료.혜택점.map((줄) => (
                <div key={줄} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                              <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#94a3b8" }}>{줄}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function 머리({ 제목, 설명 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontFamily: 글꼴.모노, fontWeight: 700, fontSize: "22px", color: "#eeeeff" }}>{제목}</span>
      </div>
      <span style={{ fontFamily: 글꼴.모노, fontSize: "16px", color: "#64748b" }}>{설명}</span>
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
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "44px",
  padding: "12px 18px",
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
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  padding: "32px",
  borderRadius: "20px",
  background: "#071230",
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
  gap: "100px",
  alignItems: "center",
  height: "420px",
  padding: "32px",
  borderRadius: "20px",
  background: "#071230",
  width: "1587px",
  boxSizing: "border-box",
};
