// 튜토리얼UI.jsx — 캔버스 밖: 지금 단계의 **안내판** (키 칩 + 한두 줄 설명)
//
// [어디에 뜨나] 화면 위 가운데. 가운데 점(조준)·왼쪽 위 힌트 표시·오른쪽 위 [V]
//   버튼과 겹치지 않는 자리다. 창(힌트함·자물쇠 조작 등)이 열리면 숨는다.
// [넘어갈 때] 방금 끝낸 단계를 「✓」로 잠깐 보여 준 뒤 새 안내로 바뀐다 —
//   눌러 봤더니 됐다는 걸 몸으로 알게.
// [F1] 안내판 숨기기/보이기.

import { useEffect, useState } from "react";
import { 단계들, use튜토리얼, 튜토리얼숨김토글 } from "./튜토리얼.js";

const 퍼즐수 = 단계들.filter((d) => d.퍼즐).length;
const 조작단계수 = 단계들.findIndex((d) => d.퍼즐);

export default function 튜토리얼UI({ 가림 = false }) {
  const { 단계, 방금, 끝냄, 숨김 } = use튜토리얼();
  const 지금 = 단계들[단계];
  const [번쩍, set번쩍] = useState(null);
  const [끝숨김, set끝숨김] = useState(false);

  // 단계가 넘어가면 1.1초 동안 「✓ 방금 한 것」
  useEffect(() => {
    if (!방금) return undefined;
    const 이름 = 단계들.find((d) => d.id === 방금)?.제목 ?? "";
    set번쩍(이름);
    const t = setTimeout(() => set번쩍(null), 1100);
    return () => clearTimeout(t);
  }, [단계, 방금]);

  // 다 끝나면 9초 뒤 알아서 접는다
  useEffect(() => {
    if (!끝냄) return undefined;
    const t = setTimeout(() => set끝숨김(true), 9000);
    return () => clearTimeout(t);
  }, [끝냄]);

  useEffect(() => {
    const 키 = (e) => {
      if (e.code === "F1") {
        e.preventDefault();
        튜토리얼숨김토글();
      }
    };
    window.addEventListener("keydown", 키);
    return () => window.removeEventListener("keydown", 키);
  }, []);

  if (!지금 || 가림 || (끝냄 && 끝숨김)) return null;
  if (숨김) return <div style={S.접힘}>[F1] 안내 보기</div>;

  const 머리 = 지금.퍼즐
    ? `퍼즐 ${지금.퍼즐} / ${퍼즐수}`
    : 단계 < 조작단계수
      ? `조작 익히기 ${단계 + 1} / ${조작단계수}`
      : null;

  return (
    <div style={S.판} role="status" aria-live="polite">
      {번쩍 && <div style={S.번쩍}>✓ {번쩍}</div>}
      <div style={S.머리줄}>
        {머리 && <span style={지금.퍼즐 ? S.퍼즐표 : S.단계표}>{머리}</span>}
        <span style={S.제목}>{지금.제목}</span>
      </div>
      <div style={S.글}>
        {지금.글.split("\n").map((줄, i) => (
          <div key={i}>{줄}</div>
        ))}
      </div>
      {지금.키.length > 0 && (
        <div style={S.키들}>
          {지금.키.map(([키들, 설명], i) => (
            <div key={i} style={S.키줄}>
              <span style={S.칩묶음}>
                {키들.map((k) => (
                  <kbd key={k} style={k.length > 2 ? S.넓은칩 : S.칩}>
                    {k}
                  </kbd>
                ))}
              </span>
              <span style={S.설명}>{설명}</span>
            </div>
          ))}
        </div>
      )}
      <div style={S.발}>[F1] 안내 숨기기</div>
    </div>
  );
}

const 칩 = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 28,
  height: 28,
  padding: "0 7px",
  borderRadius: 6,
  background: "linear-gradient(#f4f6f8, #cfd6dd)",
  color: "#1b2229",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  boxShadow: "0 2px 0 #7f8a95, 0 3px 6px rgba(0,0,0,.35)",
};

const S = {
  판: {
    position: "fixed",
    top: "max(18px, env(safe-area-inset-top, 0px))",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(560px, calc(100vw - 32px))",
    padding: "14px 18px 10px",
    borderRadius: 12,
    background: "rgba(12, 18, 26, 0.82)",
    border: "1px solid rgba(142, 232, 255, 0.35)",
    boxShadow: "0 0 24px rgba(142, 232, 255, 0.12), 0 8px 24px rgba(0,0,0,.4)",
    color: "#e8eef3",
    fontSize: 14,
    lineHeight: 1.55,
    pointerEvents: "none",
    zIndex: 20,
    backdropFilter: "blur(4px)",
  },
  머리줄: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" },
  단계표: {
    fontSize: 11,
    letterSpacing: "0.08em",
    color: "#8ee8ff",
    border: "1px solid rgba(142,232,255,.45)",
    borderRadius: 99,
    padding: "1px 8px",
  },
  퍼즐표: {
    fontSize: 11,
    letterSpacing: "0.08em",
    color: "#1b1405",
    background: "#ffd36b",
    borderRadius: 99,
    padding: "1px 8px",
    fontWeight: 700,
  },
  제목: { fontSize: 17, fontWeight: 700 },
  글: { color: "#c9d4dd" },
  키들: { display: "flex", flexDirection: "column", gap: 7, marginTop: 10 },
  키줄: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  칩묶음: { display: "inline-flex", gap: 5 },
  칩,
  넓은칩: { ...칩, padding: "0 10px" },
  설명: { color: "#e8eef3" },
  발: { marginTop: 8, fontSize: 11, color: "#7d8b97", textAlign: "right" },
  번쩍: {
    position: "absolute",
    bottom: -32,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "3px 12px",
    borderRadius: 99,
    background: "rgba(90, 210, 140, 0.92)",
    color: "#06210f",
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  접힘: {
    position: "fixed",
    top: "max(18px, env(safe-area-inset-top, 0px))",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "4px 12px",
    borderRadius: 99,
    background: "rgba(12, 18, 26, 0.7)",
    color: "#8ee8ff",
    fontSize: 12,
    pointerEvents: "none",
    zIndex: 20,
  },
};
