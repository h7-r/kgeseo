// 조사UI.jsx — 화면 위에 뜨는 조사 관련 표시 (USR-051)
//
//   ① 겨냥 힌트  — 「[E] 조사 · 증거물 상자」 (S7-002)
//   ② 조사창    — 설명과 단서 (S7-017)
//   ③ 닫기      — ESC 또는 [E] (S7-020)
//
// 조사창이 열려 있는 동안은 이동 입력을 막아야 한다(S7-018).
//   그 판단은 App 쪽에서 `active` 로 하고, 여기서는 열림 여부만 알려 준다.

import { useEffect } from "react";
import {
  use겨냥,
  use열림,
  대상찾기,
  조사열기,
  조사닫기,
} from "./조사시스템.js";

/**
 * @param {boolean} 활성  1인칭 조작 중인가(마우스 잠김). 아니면 힌트를 숨긴다
 * @param {function} onOpenChange  조사창이 열리고 닫힐 때 알려 준다(이동 차단용)
 */
export default function 조사UI({ 활성, onOpenChange }) {
  const 겨냥 = use겨냥();
  const 열림 = use열림();
  const 겨냥항목 = 겨냥 ? 대상찾기(겨냥) : null;
  const 열림항목 = 열림 ? 대상찾기(열림) : null;

  // 조사창 열림 여부를 바깥에 알린다(이동 입력 차단 — S7-018)
  useEffect(() => {
    onOpenChange?.(!!열림);
  }, [열림, onOpenChange]);

  // E — 겨냥 중이면 조사창을 연다 (S7-010)
  //   대상이 없으면 아무 일도 일어나지 않는다.
  useEffect(() => {
    const 눌림 = (e) => {
      if (e.code !== "KeyE" || e.repeat) return;
      const 지금겨냥 = 겨냥;
      if (!열림 && 활성 && 지금겨냥) 조사열기(지금겨냥);
    };
    window.addEventListener("keydown", 눌림);
    return () => window.removeEventListener("keydown", 눌림);
  }, [겨냥, 열림, 활성]);

  // 조사창 닫기 — ESC / E / Space (S7-020)
  useEffect(() => {
    if (!열림) return;
    const 닫기 = (e) => {
      if (["Escape", "KeyE", "Space"].includes(e.code)) {
        e.preventDefault();
        조사닫기();
      }
    };
    window.addEventListener("keydown", 닫기);
    return () => window.removeEventListener("keydown", 닫기);
  }, [열림]);

  return (
    <>
      {활성 && !열림 && 겨냥항목 && (
        <div style={S.힌트}>
          <b style={S.키}>E</b> 조사 · {겨냥항목.이름}
        </div>
      )}

      {열림항목 && (
        <div style={S.배경} onClick={조사닫기}>
          <div style={S.판} onClick={(e) => e.stopPropagation()}>
            <div style={S.분류}>{열림항목.분류}</div>
            <h2 style={S.제목}>{열림항목.이름}</h2>
            <div style={S.줄} />
            <p style={S.본문}>{열림항목.설명}</p>
            {열림항목.단서 && (
              <div style={S.단서}>
                <span style={S.단서표}>발견</span>
                {열림항목.단서}
              </div>
            )}
            <div style={S.닫기}>[E] · [ESC] 로 닫기</div>
          </div>
        </div>
      )}
    </>
  );
}

const S = {
  힌트: {
    position: "absolute",
    left: "50%",
    bottom: 68,
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: 20,
    background: "rgba(16,20,27,.86)",
    border: "1px solid #3a465c",
    color: "#e9f1fb",
    font: "14px sans-serif",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  키: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 20,
    height: 20,
    padding: "0 5px",
    borderRadius: 4,
    background: "#e0a94e",
    color: "#1b1f26",
    font: "700 12px ui-monospace,Menlo,monospace",
  },
  배경: {
    position: "absolute",
    inset: 0,
    zIndex: 50,
    background: "rgba(10,13,18,.72)",
    display: "grid",
    placeItems: "center",
  },
  판: {
    width: 460,
    maxWidth: "82%",
    padding: "26px 28px",
    borderRadius: 12,
    background: "#191d25",
    border: "1px solid #2c3648",
    color: "#cfe3ff",
    font: "15px/1.75 sans-serif",
  },
  분류: {
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: "#e0a94e",
  },
  제목: { margin: "8px 0 0", font: "600 24px/1.3 sans-serif" },
  줄: { height: 1, background: "#2c343e", margin: "16px 0 18px" },
  본문: { margin: 0, color: "#b7c0cb" },
  단서: {
    marginTop: 18,
    padding: "12px 14px",
    borderRadius: 8,
    background: "#12161c",
    border: "1px solid #2c343e",
    color: "#d8e4f2",
    fontSize: 14,
  },
  단서표: {
    display: "inline-block",
    marginRight: 8,
    padding: "1px 7px",
    borderRadius: 4,
    background: "#e0a94e",
    color: "#1b1f26",
    font: "700 11px sans-serif",
  },
  닫기: {
    marginTop: 20,
    textAlign: "right",
    color: "#5b6b80",
    font: "12px ui-monospace,Menlo,monospace",
  },
};
