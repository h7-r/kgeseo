// 힌트UI.jsx — [H] 로 여는 힌트함
//
// [소지품UI 와 같은 옷을 입힌 이유]
//   창이 둘인데 생김새가 다르면 사용자는 **다른 게임의 화면**으로 받아들인다.
//   판·머리·구역제목·칸 — 치수와 색을 그대로 맞췄다. 다른 것은 안에 담기는 것뿐이다.
//
// [왼쪽이 목록, 오른쪽이 본문인 이유]
//   힌트는 '그림 한 장 + 한 줄 설명'이다. 격자에 그림만 늘어놓으면 뭐가 뭔지
//   기억으로 찾아야 한다. 왼쪽에서 고르면 오른쪽에 크게 펴 주는 편이,
//   막혀서 되돌아온 사람이 제일 빨리 읽는다.

import { useEffect, useState } from "react";
import { use힌트함, 힌트빼기 } from "./힌트함.js";
import { 종이도로놓기 } from "../소품/힌트종이.js";

export default function 힌트UI({ 열림, 닫기 }) {
  const 힌트들 = use힌트함();
  const [고른것, set고른것] = useState(null);

  // 닫을 때 골라 둔 것도 지운다 — 다음에 열었을 때 엉뚱한 게 펼쳐져 있으면 헷갈린다
  useEffect(() => {
    if (!열림) set고른것(null);
  }, [열림]);
  // 처음 열면 **맨 마지막에 넣은 것**을 펴 준다. 방금 주운 걸 보려고 여는 일이 많다.
  useEffect(() => {
    if (열림 && !고른것 && 힌트들.length)
      set고른것(힌트들[힌트들.length - 1].id);
  }, [열림, 고른것, 힌트들]);

  // ── [E] — 골라 둔 힌트를 버린다 ──────────────────────────
  // [왜 App 이 아니라 여기서 듣나]
  //   App 의 E 는 `!locked` 면 곧바로 돌아간다. 창이 열리면 마우스 잠금이
  //   풀리므로 거기까지 가지도 않는다. 창이 제 키를 스스로 듣는 게 맞다.
  // [왜 지우지 않고 '도로 내놓나']
  //   영영 지우면 잘못 누른 사람이 되돌릴 길이 없다. 실물 쪽지가 바닥에
  //   다시 떨어지므로 걸어가 주우면 그만이다(동전·관창과 같은 규칙).
  useEffect(() => {
    if (!열림 || !고른것) return;
    const onKey = (e) => {
      if (e.code !== "KeyE") return;
      const t = e.target;
      // 글씨를 치는 중이면 게임 키로 먹지 않는다(App 과 같은 규칙)
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
        return;
      e.preventDefault();
      const 남은 = 힌트들.filter((h) => h.id !== 고른것);
      if (힌트빼기(고른것)) 종이도로놓기();
      // 버린 자리를 비워 두지 않는다 — 옆 것을 이어서 펴 준다
      set고른것(남은.length ? 남은[남은.length - 1].id : null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [열림, 고른것, 힌트들]);

  if (!열림) return null;
  const 상세 = 고른것 ? 힌트들.find((h) => h.id === 고른것) : null;

  return (
    <div style={S.배경} onClick={닫기}>
      <div style={S.판} onClick={(e) => e.stopPropagation()}>
        <div style={S.머리}>
          <span style={S.제목}>힌트함</span>
          <span style={S.머리끝}>모은 것 {힌트들.length}</span>
        </div>

        <div style={S.본체}>
          <div style={S.왼쪽}>
            <div style={S.구역제목}>
              모은 힌트 <span style={S.구역수}>{힌트들.length}</span>
            </div>
            {힌트들.length ? (
              <div style={S.격자}>
                {힌트들.map((h) => (
                  <button
                    key={h.id}
                    style={{ ...S.칸, ...(고른것 === h.id ? S.칸선택 : null) }}
                    onClick={() => set고른것(h.id)}
                    title={h.이름}
                  >
                    {h.그림 ? (
                      <img src={h.그림} alt="" style={S.칸그림} />
                    ) : (
                      <span style={S.칸글자}>{h.이름?.[0] ?? "?"}</span>
                    )}
                    <span style={S.칸이름}>{h.이름}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={S.빈줄}>
                아직 모은 힌트가 없다.
                <br />
                쪽지를 집어 든 채 [H] 를 누르면 여기 적힌다.
              </div>
            )}
          </div>

          <div style={S.오른쪽}>
            {상세 ? (
              <>
                <div style={S.분류}>힌트</div>
                <h3 style={S.상세이름}>{상세.이름}</h3>
                <div style={S.줄} />
                {상세.그림 && <img src={상세.그림} alt="" style={S.상세그림} />}
                <p style={S.설명}>{상세.설명 ?? "아직 적힌 것이 없다."}</p>
                <div style={S.버리기}>
                  <kbd style={S.키}>E</kbd> 버리기 — 쪽지가 바닥에 떨어진다
                </div>
              </>
            ) : (
              <div style={S.안내}>
                {힌트들.length
                  ? "왼쪽에서 하나를 고르면 여기에 펼쳐진다."
                  : "막히는 자리마다 쪽지가 하나씩 있다."}
              </div>
            )}
          </div>
        </div>

        <div style={S.발}>[H] · [ESC] 로 닫기</div>
      </div>
    </div>
  );
}

// ── 치수·색은 소지품UI 와 같은 값이다. 두 창이 한 게임으로 읽혀야 한다 ──
const 금 = "#e0a94e";
const S = {
  배경: {
    position: "absolute",
    inset: 0,
    zIndex: 50,
    background: "rgba(10,13,18,.72)",
    display: "grid",
    placeItems: "center",
  },
  판: {
    width: 720,
    maxWidth: "90%",
    maxHeight: "82%",
    display: "flex",
    flexDirection: "column",
    padding: "22px 24px",
    borderRadius: 12,
    background: "#191d25",
    border: "1px solid #2c3648",
    color: "#cfe3ff",
    font: "15px/1.7 sans-serif",
  },
  머리: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  제목: { font: "600 22px/1.3 sans-serif" },
  머리끝: { font: "12px ui-monospace,Menlo,monospace", color: "#5b6b80" },
  본체: { display: "flex", gap: 20, minHeight: 0, flex: 1 },
  왼쪽: { flex: "1 1 48%", overflowY: "auto", paddingRight: 4 },
  오른쪽: {
    flex: "1 1 52%",
    borderLeft: "1px solid #2c343e",
    paddingLeft: 20,
    overflowY: "auto",
  },
  구역제목: {
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: 금,
    marginBottom: 8,
  },
  구역수: { color: "#5b6b80", marginLeft: 4 },
  격자: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
    gap: 8,
  },
  칸: {
    display: "grid",
    justifyItems: "center",
    gap: 4,
    padding: "10px 6px",
    borderRadius: 8,
    background: "#12161c",
    border: "1px solid #2c343e",
    color: "#cfe3ff",
    font: "12px sans-serif",
    cursor: "pointer",
  },
  칸선택: { borderColor: 금, background: "#1d2430" },
  // 쪽지는 정사각 그림이라 소지품 칸(40px)보다 크게 — 글자가 읽혀야 한다
  칸그림: {
    width: 56,
    height: 56,
    objectFit: "contain",
    borderRadius: 4,
    imageRendering: "auto",
  },
  칸글자: {
    display: "grid",
    placeItems: "center",
    width: 56,
    height: 56,
    borderRadius: 6,
    background: "#232a35",
    font: "600 18px sans-serif",
    color: "#8ea3bd",
  },
  칸이름: {
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  빈줄: { color: "#5b6b80", fontSize: 13, padding: "6px 2px", lineHeight: 1.6 },
  분류: {
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: 금,
  },
  상세이름: { margin: "6px 0 0", font: "600 19px/1.3 sans-serif" },
  줄: { height: 1, background: "#2c343e", margin: "14px 0" },
  상세그림: {
    width: "100%",
    maxWidth: 260,
    display: "block",
    margin: "0 auto 12px",
    borderRadius: 8,
    background: "#12161c",
  },
  설명: { margin: 0, color: "#b7c0cb", fontSize: 14 },
  안내: { color: "#5b6b80", fontSize: 13, paddingTop: 6 },
  버리기: {
    marginTop: 14,
    paddingTop: 12,
    borderTop: "1px solid #2c343e",
    color: "#7d8a9c",
    fontSize: 13,
  },
  키: {
    display: "inline-block",
    minWidth: 18,
    padding: "1px 5px",
    marginRight: 6,
    borderRadius: 4,
    border: "1px solid #3c4658",
    background: "#12161c",
    color: "#cfe3ff",
    font: "600 11px ui-monospace,Menlo,monospace",
  },
  발: {
    marginTop: 16,
    textAlign: "right",
    color: "#5b6b80",
    font: "12px ui-monospace,Menlo,monospace",
  },
};
