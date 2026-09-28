// 캐릭터 생성 화면의 색·글꼴·간격·모션 토큰.
//
// [무대 하나 위에 도구가 떠 있는 화면]
//   배경은 화면 전체에 이어지는 한 덩이다. 그래서 여기에는 '판을 그리는 색'이 거의 없고,
//   대신 **가장자리 명암**과 **작은 도구 표면**만 있다. 큰 사각형 테두리를 만들지 않는다.
//   시작페이지의 짙은 남청 계열을 이어받되, 캐릭터가 주인공이 되도록 채도를 낮췄다.

export const 색 = {
  // 배경 — 가장자리에서 캐릭터 뒤로 갈수록 밝아진다.
  가장자리: "#080D15",
  중간: "#142432",
  무대: "#2B4755",
  // 글자
  글: "#F2F4F5",
  흐린글: "#AAB8C4",
  더흐린글: "rgba(170,184,196,0.58)",
  // 강조 — 선택·현재 상태에만 쓴다.
  강조: "#9AD8E8",
  강조진함: "#5FB0C8",
  성공: "#7FD6A8",
  경고: "#F0C27A",
  오류: "#F2938F",
  // 떠 있는 도구 표면(작은 것에만)
  표면: "rgba(10,20,30,0.55)",
  표면진함: "rgba(8,14,22,0.82)",
  선: "rgba(154,216,232,0.20)",
  선강조: "rgba(154,216,232,0.65)",
};

export const 글꼴 = {
  본문: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  모노: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

// 4 / 8 / 12 / 16 / 24 / 32 / 48
export const 사이 = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, xxxl: 48 };

export const 글자 = {
  제목: { font: `600 30px/1.25 ${글꼴.본문}`, letterSpacing: "-0.01em", color: 색.글 },
  항목제목: { font: `600 19px/1.35 ${글꼴.본문}`, color: 색.글 },
  라벨: { font: `500 14px/1.4 ${글꼴.본문}`, color: 색.흐린글 },
  본문: { font: `400 14px/1.6 ${글꼴.본문}`, color: 색.흐린글 },
  설명: { font: `400 13px/1.6 ${글꼴.본문}`, color: 색.더흐린글 },
  // 숫자는 폭이 흔들리면 슬라이더를 움직일 때마다 라벨이 덜컹거린다.
  수치: { font: `500 13px/1 ${글꼴.모노}`, fontVariantNumeric: "tabular-nums", color: 색.흐린글 },
  단계: { font: `500 12px/1 ${글꼴.모노}`, letterSpacing: "0.14em", color: 색.더흐린글 },
};

export const 모션 = {
  빠름: "120ms cubic-bezier(.2,.7,.4,1)",
  보통: "200ms cubic-bezier(.2,.7,.4,1)",
  느림: "360ms cubic-bezier(.2,.7,.3,1)",
};

// ── 무대 ────────────────────────────────────────────────────
// 배경은 큰 반경의 빛 세 개를 겹쳐 만든다. 중심은 화면 한가운데가 아니라 **캐릭터 등 뒤**다.
// 캔버스는 투명하게 두고 이 배경이 화면 전체에 그대로 이어진다(헤더·푸터 뒤에도).
export function 배경(중심x = 44) {
  return {
    position: "absolute",
    inset: 0,
    background: [
      `radial-gradient(58% 46% at ${중심x}% 40%, ${색.무대} 0%, rgba(43,71,85,0) 68%)`,
      `radial-gradient(120% 80% at ${중심x}% 22%, ${색.중간} 0%, rgba(20,36,50,0) 70%)`,
      `radial-gradient(90% 60% at ${중심x}% 104%, rgba(24,42,56,0.9) 0%, rgba(24,42,56,0) 62%)`,
      `linear-gradient(180deg, ${색.가장자리} 0%, #0B1420 46%, ${색.가장자리} 100%)`,
    ].join(","),
  };
}

// 글자가 놓이는 가장자리에만 옅은 명암. 안쪽으로 자연스럽게 사라져 닫힌 사각형을 만들지 않는다.
export const 대비층 = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background: [
    "linear-gradient(90deg, rgba(4,8,14,0.72) 0%, rgba(4,8,14,0.34) 10%, rgba(4,8,14,0) 22%)",
    "linear-gradient(270deg, rgba(4,8,14,0.80) 0%, rgba(4,8,14,0.40) 13%, rgba(4,8,14,0) 28%)",
    "linear-gradient(180deg, rgba(4,8,14,0.60) 0%, rgba(4,8,14,0) 16%)",
    "linear-gradient(0deg, rgba(4,8,14,0.60) 0%, rgba(4,8,14,0) 15%)",
  ].join(","),
};

// ── 컨트롤 ───────────────────────────────────────────────────
// 기본 단추는 **테두리가 없다.** 모든 단추에 같은 선을 두르면 화면이 상자로 가득 찬다.
export const 단추 = {
  appearance: "none",
  border: "none",
  background: "none",
  borderRadius: 10,
  padding: "8px 12px",
  color: 색.흐린글,
  font: `500 13px/1.3 ${글꼴.본문}`,
  cursor: "pointer",
  transition: `color ${모션.빠름}, background ${모션.빠름}`,
};

export const 고른단추 = {
  ...단추,
  color: "#FFFFFF",
  background: "rgba(154,216,232,0.16)",
};

// 떠 있는 작은 도구 표면. backdrop-filter 를 못 쓰는 환경에서도 읽히도록 불투명도를 넉넉히 둔다.
export const 도구표면 = {
  background: 색.표면진함,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderRadius: 14,
};

export const 주단추 = {
  ...단추,
  padding: "14px 26px",
  borderRadius: 999,
  background: "linear-gradient(180deg, #A9E2F0 0%, #6FC0D6 100%)",
  color: "#06222C",
  font: `700 15px/1 ${글꼴.본문}`,
  letterSpacing: "0.01em",
  boxShadow: "0 10px 30px rgba(111,192,214,0.22)",
  transition: `transform ${모션.빠름}, box-shadow ${모션.빠름}`,
};

export const 꺼진주단추 = {
  ...주단추,
  background: "rgba(255,255,255,0.08)",
  color: "rgba(242,244,245,0.42)",
  boxShadow: "none",
  cursor: "not-allowed",
};

export const 입력칸 = {
  flex: "1 1 auto",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "13px 16px",
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: 색.선,
  background: "rgba(6,12,20,0.7)",
  color: 색.글,
  font: `400 16px/1.3 ${글꼴.본문}`,
  transition: `border-color ${모션.빠름}`,
};

// 포커스 링·슬라이더 모양·스크롤바. 전역 CSS 에 기대지 않도록 화면 안에서만 건다.
export const 화면CSS = `
.캐생 { color: ${색.글}; font-family: ${글꼴.본문}; }
.캐생 *:focus-visible { outline: 2px solid ${색.강조}; outline-offset: 3px; border-radius: 8px; }
.캐생 button:hover:not(:disabled) { color: #fff; }
.캐생 .주단추:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(111,192,214,0.3); }
.캐생 .주단추:active:not(:disabled) { transform: translateY(0); }
.캐생 input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: none; cursor: pointer; }
.캐생 input[type="range"]::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.16); }
.캐생 input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -6px; border-radius: 50%; background: ${색.강조}; box-shadow: 0 0 0 4px rgba(154,216,232,0.16); transition: box-shadow ${모션.빠름}; }
.캐생 input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(154,216,232,0.20); }
.캐생 input[type="range"]::-moz-range-track { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.16); }
.캐생 input[type="range"]::-moz-range-thumb { width: 15px; height: 15px; border: none; border-radius: 50%; background: ${색.강조}; }
.캐생 ::-webkit-scrollbar { width: 8px; }
.캐생 ::-webkit-scrollbar-thumb { background: rgba(154,216,232,0.22); border-radius: 4px; }
.캐생 ::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .캐생 *, .캐생 *::before, .캐생 *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}
`;
