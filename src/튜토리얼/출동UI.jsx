// 출동UI.jsx — 캔버스 밖: 상황실 **긴급 호출 카드** + 남는 **임무 목표** 표시
//
// [카드] 본부실에 들어선 지 5초 뒤 한 번 뜬다(출동.js). [E]·Enter·클릭으로 닫거나,
//   읽을 시간을 주고 16초 뒤 저절로 접힌다. 접히면 위쪽에 짧은 임무 목표만 남는다.
// [소리] 무전 수신음을 WebAudio 로 짧게 만든다(파일 없음). 브라우저가 소리를 막으면 조용히 넘어간다.
// [끝] 기차에 오르면(기차안) 탑승으로 넘어가 둘 다 사라진다.

import { useEffect, useRef } from "react";
import { 출동확인, 출동틱, use출동 } from "./출동.js";

function 수신음() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const 지금 = ac.currentTime;
    const 삑 = (언제, 높이, 길이, 크기) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "square";
      o.frequency.value = 높이;
      g.gain.setValueAtTime(0, 지금 + 언제);
      g.gain.linearRampToValueAtTime(크기, 지금 + 언제 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, 지금 + 언제 + 길이);
      o.connect(g).connect(ac.destination);
      o.start(지금 + 언제);
      o.stop(지금 + 언제 + 길이 + 0.02);
    };
    삑(0, 880, 0.12, 0.05);
    삑(0.18, 880, 0.12, 0.05);
    삑(0.36, 1320, 0.22, 0.05);
    setTimeout(() => ac.close(), 1200);
  } catch {
    /* 소리는 덤이다 — 실패해도 안내는 그대로 */
  }
}

export default function 출동UI({ 가림 = false, 기차안 = false }) {
  const { 단계, 문거리 } = use출동();
  const 울림 = useRef(false);

  // 기차에 올랐으면 끝 — 기차 씬에서는 본부실 캔버스가 안 돌 수 있어 여기서도 알린다
  useEffect(() => {
    if (기차안) 출동틱({ 본부실안: false, 기차안: true });
  }, [기차안]);

  useEffect(() => {
    if (단계 !== "알림") return undefined;
    if (!울림.current) {
      울림.current = true;
      수신음();
    }
    const 키 = (e) => {
      if (e.code === "KeyE" || e.code === "Enter") 출동확인();
    };
    window.addEventListener("keydown", 키);
    const t = setTimeout(출동확인, 16000);
    return () => {
      window.removeEventListener("keydown", 키);
      clearTimeout(t);
    };
  }, [단계]);

  if (가림 || 기차안) return null;

  if (단계 === "알림")
    return (
      <div style={S.덮개} onClick={출동확인} role="alertdialog" aria-labelledby="출동제목">
        <div style={S.카드}>
          <div style={S.머리}>
            <span style={S.점} />
            긴급 호출 · 수사본부 상황실
          </div>
          <h2 id="출동제목" style={S.제목}>
            나주 앙암바위, 왜곡 발생
          </h2>
          <div style={S.글}>
            <p style={S.줄}>영산강 앙암바위 일대의 시공간이 비틀리기 시작했다.</p>
            <p style={S.줄}>
              강물 위로 지워졌던 옛 장면이 겹쳐 떠오르고, 왜곡은 지금도 번지는 중이다.
            </p>
            <p style={{ ...S.줄, ...S.명령 }}>더 퍼지기 전에 막아야 한다. 즉시 기차에 올라 나주로 출동하라.</p>
          </div>
          <div style={S.발}>
            <span>— 상황실</span>
            <span>
              <kbd style={S.칩}>E</kbd> 출동
            </span>
          </div>
        </div>
      </div>
    );

  if (단계 === "안내")
    return (
      <div style={S.목표} role="status">
        <div style={S.목표머리}>
          <span style={S.작은점} />
          임무 · 나주 앙암바위 왜곡 저지
        </div>
        <div style={S.목표글}>
          바닥의 주황 화살표를 따라 기차 오른쪽 문으로 오르세요
          {문거리 != null && (
            <span style={S.거리}>{문거리 <= 1 ? " · 기차 문 바로 앞" : ` · 기차 문까지 ${문거리}m`}</span>
          )}
        </div>
      </div>
    );

  return null;
}

const 주황 = "#ffb25c";
const S = {
  덮개: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 16,
    background: "radial-gradient(ellipse at center, rgba(40,10,0,.35), rgba(0,0,0,.6))",
    zIndex: 40,
    animation: "출동들어옴 .45s ease-out",
  },
  카드: {
    width: "min(520px, 100%)",
    padding: "20px 24px 16px",
    borderRadius: 12,
    background: "rgba(14, 12, 12, 0.92)",
    border: `1px solid ${주황}66`,
    boxShadow: `0 0 0 1px rgba(0,0,0,.4), 0 0 40px ${주황}22, 0 18px 40px rgba(0,0,0,.5)`,
    color: "#f1ece6",
    lineHeight: 1.6,
  },
  머리: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    letterSpacing: "0.12em",
    color: 주황,
    marginBottom: 10,
  },
  점: {
    width: 8,
    height: 8,
    borderRadius: 99,
    background: "#ff4d3d",
    boxShadow: "0 0 10px #ff4d3d",
    animation: "출동깜빡 1s steps(2, start) infinite",
  },
  제목: { margin: "0 0 12px", fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em" },
  글: { fontSize: 15, color: "#d8d0c8" },
  줄: { margin: "0 0 6px" },
  명령: { color: "#fff", fontWeight: 700, marginTop: 10 },
  발: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    fontSize: 12,
    color: "#a0968c",
  },
  칩: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 24,
    height: 24,
    marginRight: 6,
    borderRadius: 5,
    background: "linear-gradient(#f4f6f8, #cfd6dd)",
    color: "#1b2229",
    fontWeight: 700,
    fontSize: 12,
    boxShadow: "0 2px 0 #7f8a95",
  },
  목표: {
    position: "fixed",
    top: "max(18px, env(safe-area-inset-top, 0px))",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(460px, calc(100vw - 32px))",
    padding: "10px 16px",
    borderRadius: 10,
    background: "rgba(14, 12, 12, 0.8)",
    borderLeft: `3px solid ${주황}`,
    color: "#f1ece6",
    pointerEvents: "none",
    zIndex: 20,
  },
  목표머리: { display: "flex", alignItems: "center", gap: 7, fontSize: 11, letterSpacing: "0.1em", color: 주황 },
  작은점: { width: 6, height: 6, borderRadius: 99, background: 주황 },
  목표글: { fontSize: 14, marginTop: 3 },
  거리: { color: "#a0968c" },
};

// 애니메이션 키프레임 — 인라인 스타일로는 못 적어서 한 번만 문서에 붙인다
if (typeof document !== "undefined" && !document.getElementById("출동키프레임")) {
  const st = document.createElement("style");
  st.id = "출동키프레임";
  st.textContent = `
@keyframes 출동들어옴 { from { opacity: 0; } to { opacity: 1; } }
@keyframes 출동깜빡 { to { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { [role="alertdialog"] { animation: none !important; } }`;
  document.head.appendChild(st);
}
