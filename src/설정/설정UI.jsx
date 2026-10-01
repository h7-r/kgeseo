// 설정UI.jsx — 게임 안 설정 창 ([P] 또는 오른쪽 위 ⚙)
//
// 배경음악 · 효과음 · 밝기 · 해상도 · 마우스 감도. 바꾸는 즉시 적용되고 저장된다(설정.js).
// 창 규칙은 다른 창과 같다 — 한 번에 하나(화면층), ESC·[P]·닫기 단추로 닫는다.

import { useEffect } from "react";
import { 기본설정, 설정기본으로, 설정바꾸기, use설정 } from "./설정.js";

const 해상도들 = ["자동", "낮음", "보통", "높음", "최고"];

function 막대({ 이름, 설명, 값, 최소, 최대, 단계, 표시, 바꾸기 }) {
  const id = `설정-${이름}`;
  return (
    <div style={S.줄}>
      <label htmlFor={id} style={S.이름}>
        {이름}
        {설명 && <span style={S.설명}>{설명}</span>}
      </label>
      <input
        id={id}
        type="range"
        min={최소}
        max={최대}
        step={단계}
        value={값}
        onChange={(e) => 바꾸기(Number(e.target.value))}
        style={S.막대}
      />
      <span style={S.값}>{표시(값)}</span>
    </div>
  );
}

const 퍼센트 = (v) => `${Math.round(v * 100)}%`;

export default function 설정UI({ 열림, 닫기 }) {
  const v = use설정();
  // 막대(range)를 만진 뒤에는 포커스가 그 <input> 에 남는다. App 의 키 처리는
  //   「글씨 입력 중」이면 키를 무시하므로 [P]·ESC 가 안 먹었다 → 여기서 받는다.
  //   막대 위일 때만 받는다(단추 위라면 App 이 이미 닫는다 — 두 번 닫지 않게).
  useEffect(() => {
    if (!열림) return undefined;
    const 키 = (e) => {
      if (e.target?.type !== "range") return;
      if (e.code === "KeyP" || e.code === "Escape") {
        e.preventDefault();
        e.target.blur();
        닫기();
      }
    };
    window.addEventListener("keydown", 키);
    return () => window.removeEventListener("keydown", 키);
  }, [열림, 닫기]);
  if (!열림) return null;
  return (
    <div style={S.덮개} onClick={닫기}>
      <div
        style={S.창}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="설정제목"
      >
        <div style={S.머리}>
          <h2 id="설정제목" style={S.제목}>
            설정
          </h2>
          <button type="button" onClick={닫기} style={S.닫기} aria-label="설정 닫기">
            ✕
          </button>
        </div>

        <div style={S.묶음이름}>소리</div>
        <막대
          이름="배경음악"
          값={v.배경음악}
          최소={0}
          최대={1}
          단계={0.05}
          표시={퍼센트}
          바꾸기={(x) => 설정바꾸기({ 배경음악: x })}
        />
        <막대
          이름="효과음"
          값={v.효과음}
          최소={0}
          최대={1}
          단계={0.05}
          표시={퍼센트}
          바꾸기={(x) => 설정바꾸기({ 효과음: x })}
        />

        <div style={S.묶음이름}>화면</div>
        <막대
          이름="밝기"
          값={v.밝기}
          최소={0.6}
          최대={1.4}
          단계={0.05}
          표시={퍼센트}
          바꾸기={(x) => 설정바꾸기({ 밝기: x })}
        />
        <div style={S.줄}>
          <span style={S.이름}>
            해상도
            <span style={S.설명}>낮추면 부드럽게 돈다</span>
          </span>
          <div style={S.고르기} role="radiogroup" aria-label="해상도">
            {해상도들.map((이름) => (
              <button
                key={이름}
                type="button"
                role="radio"
                aria-checked={v.해상도 === 이름}
                onClick={() => 설정바꾸기({ 해상도: 이름 })}
                style={v.해상도 === 이름 ? S.고름켬 : S.고름}
              >
                {이름}
              </button>
            ))}
          </div>
        </div>

        <div style={S.묶음이름}>조작</div>
        <막대
          이름="마우스 감도"
          값={v.감도}
          최소={0.4}
          최대={2}
          단계={0.05}
          표시={(x) => `${x.toFixed(2)}×`}
          바꾸기={(x) => 설정바꾸기({ 감도: x })}
        />

        <div style={S.발}>
          <button
            type="button"
            onClick={설정기본으로}
            style={S.기본}
            disabled={Object.keys(기본설정).every((k) => v[k] === 기본설정[k])}
          >
            기본값으로
          </button>
          <span style={S.안내}>[P] · [ESC] 로 닫기 · 바꾸면 바로 저장됩니다</span>
        </div>
      </div>
    </div>
  );
}

const 금 = "#ffd36b";
const S = {
  덮개: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 16,
    background: "rgba(4, 8, 14, 0.55)",
    zIndex: 45,
  },
  창: {
    width: "min(480px, 100%)",
    maxHeight: "calc(100vh - 32px)",
    overflowY: "auto",
    padding: "18px 22px 16px",
    borderRadius: 12,
    background: "#161b22",
    border: "1px solid #2c343e",
    boxShadow: "0 18px 48px rgba(0,0,0,.5)",
    color: "#e6ebf1",
    fontSize: 14,
  },
  머리: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  제목: { margin: 0, fontSize: 20, fontWeight: 700 },
  닫기: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid #2c343e",
    background: "transparent",
    color: "#b7c0cb",
    cursor: "pointer",
    fontSize: 14,
  },
  묶음이름: {
    marginTop: 16,
    marginBottom: 4,
    font: "12px ui-monospace,Menlo,monospace",
    letterSpacing: 1,
    color: 금,
  },
  줄: {
    display: "grid",
    gridTemplateColumns: "minmax(90px, 1fr) 2fr 52px",
    alignItems: "center",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #222a33",
  },
  이름: { display: "flex", flexDirection: "column", gap: 2 },
  설명: { fontSize: 11, color: "#7d8b97" },
  막대: { width: "100%", accentColor: 금, cursor: "pointer" },
  값: { textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b7c0cb" },
  고르기: { gridColumn: "2 / 4", display: "flex", flexWrap: "wrap", gap: 6 },
  고름: {
    padding: "5px 10px",
    borderRadius: 99,
    border: "1px solid #2c343e",
    background: "transparent",
    color: "#b7c0cb",
    cursor: "pointer",
    fontSize: 13,
  },
  고름켬: {
    padding: "5px 10px",
    borderRadius: 99,
    border: `1px solid ${금}`,
    background: "rgba(255, 211, 107, 0.12)",
    color: 금,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  발: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 16,
  },
  기본: {
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #2c343e",
    background: "#1d2430",
    color: "#e6ebf1",
    cursor: "pointer",
  },
  안내: { fontSize: 12, color: "#5b6b80" },
};
