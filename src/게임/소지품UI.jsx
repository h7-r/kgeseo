// 소지품UI.jsx — [I] 로 여는 소지품 창 (S7-028 · 029 · 034)
//
// [화면 구성이 이런 이유]
//   · 열쇠와 기록을 **줄을 나눠** 보여준다(S7-028). 섞어 놓으면 "쓸 수 있는 것"과
//     "읽을 것"이 구분이 안 돼서, 막혔을 때 무엇을 봐야 할지 판단이 안 된다.
//   · 칸을 고르면 오른쪽에 이름·설명·확대 그림이 뜬다(S7-029).
//   · 칸 수를 제한하지 않는다(S7-034). 12월 물량이 10종이라 관리가 손해다.
//   · 쓴다고 사라지지 않는다(GRD-01) — 그래서 '버리기' 버튼이 없다.

import { useEffect, useState } from "react";
import { use소지품 } from "./소지품.js";

/**
 * @param {boolean} 열림   지금 이 창이 열려 있나(화면층이 정한다)
 * @param {function} 닫기  닫아 달라고 바깥에 알린다
 */
export default function 소지품UI({ 열림, 닫기 }) {
  const 물건들 = use소지품();
  const [고른것, set고른것] = useState(null);

  // 창을 닫을 때 골라 둔 것도 지운다 — 다음에 열었을 때 엉뚱한 게 펼쳐져 있으면 헷갈린다
  useEffect(() => {
    if (!열림) set고른것(null);
  }, [열림]);

  if (!열림) return null;

  const 열쇠 = 물건들.filter((m) => m.분류 === "열쇠");
  const 기록 = 물건들.filter((m) => m.분류 !== "열쇠");
  const 상세 = 고른것 ? 물건들.find((m) => m.id === 고른것) : null;

  const 칸 = (m) => (
    <button
      key={m.id}
      style={{ ...S.칸, ...(고른것 === m.id ? S.칸선택 : null) }}
      onClick={() => set고른것(m.id)}
      title={m.이름}
    >
      {m.그림 ? (
        <img src={m.그림} alt="" style={S.칸그림} />
      ) : (
        // 그림이 아직 없어도 무엇인지는 읽혀야 한다 → 이름 첫 글자로 대신한다
        <span style={S.칸글자}>{m.이름?.[0] ?? "?"}</span>
      )}
      <span style={S.칸이름}>{m.이름}</span>
    </button>
  );

  const 구역 = (제목, 것들, 빈말) => (
    <div style={S.구역}>
      <div style={S.구역제목}>
        {제목} <span style={S.구역수}>{것들.length}</span>
      </div>
      {것들.length ? (
        <div style={S.격자}>{것들.map(칸)}</div>
      ) : (
        <div style={S.빈줄}>{빈말}</div>
      )}
    </div>
  );

  return (
    <div style={S.배경} onClick={닫기}>
      <div style={S.판} onClick={(e) => e.stopPropagation()}>
        <div style={S.머리}>
          <span style={S.제목}>소지품</span>
          <span style={S.머리끝}>지닌 것 {물건들.length}</span>
        </div>

        <div style={S.본체}>
          <div style={S.왼쪽}>
            {구역("열쇠", 열쇠, "아직 없다")}
            {구역("기록", 기록, "아직 없다")}
          </div>

          <div style={S.오른쪽}>
            {상세 ? (
              <>
                <div style={S.분류}>{상세.분류 ?? "기록"}</div>
                <h3 style={S.상세이름}>{상세.이름}</h3>
                <div style={S.줄} />
                {상세.그림 && (
                  <img src={상세.그림} alt="" style={S.상세그림} />
                )}
                <p style={S.설명}>{상세.설명 ?? "아직 적힌 것이 없다."}</p>
              </>
            ) : (
              <div style={S.안내}>
                {물건들.length
                  ? "왼쪽에서 하나를 고르면 여기에 자세히 나온다."
                  : "아직 아무것도 지니지 않았다."}
              </div>
            )}
          </div>
        </div>

        <div style={S.발}>[I] · [ESC] 로 닫기</div>
      </div>
    </div>
  );
}

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
  왼쪽: { flex: "1 1 58%", overflowY: "auto", paddingRight: 4 },
  오른쪽: {
    flex: "1 1 42%",
    borderLeft: "1px solid #2c343e",
    paddingLeft: 20,
    overflowY: "auto",
  },
  구역: { marginBottom: 18 },
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
  칸그림: { width: 40, height: 40, objectFit: "contain" },
  칸글자: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
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
  빈줄: { color: "#5b6b80", fontSize: 13, padding: "6px 2px" },
  분류: {
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: 금,
  },
  상세이름: { margin: "6px 0 0", font: "600 19px/1.3 sans-serif" },
  줄: { height: 1, background: "#2c343e", margin: "14px 0" },
  상세그림: {
    width: "100%",
    borderRadius: 8,
    background: "#12161c",
    marginBottom: 12,
  },
  설명: { margin: 0, color: "#b7c0cb", fontSize: 14 },
  안내: { color: "#5b6b80", fontSize: 13, paddingTop: 6 },
  발: {
    marginTop: 16,
    textAlign: "right",
    color: "#5b6b80",
    font: "12px ui-monospace,Menlo,monospace",
  },
};
