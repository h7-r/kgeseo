// 캐릭터 생성 화면의 색·글꼴·공통 스타일.
// 시작페이지(시작페이지/src/토큰.css, 구간/인증폼.jsx)에서 쓰는 값과 같은 것을 옮겨 적었다.
// 그쪽은 CSS 변수로, 여기는 인라인 스타일로 쓴다 — 이 화면은 다른 앱에 그대로 옮겨 붙일 수 있어야 해서
// 전역 CSS 에 기대지 않는다.

export const 색 = {
  바탕: "#02040a",
  바탕2: "#060d1a",
  판: "rgba(10,20,38,0.72)",
  선: "rgba(96,165,250,0.18)",
  선강조: "rgba(147,197,253,0.6)",
  글: "#eeeeff",
  흐린글: "rgba(181,188,255,0.85)",
  더흐린글: "rgba(200,205,255,0.45)",
  강조: "#60a5fa",
  강조진함: "#2563eb",
  성공: "#5fd0a0",
  경고: "#ffc266",
  오류: "#ff8a8a",
};

export const 글꼴 = {
  본문: '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
  모노: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

export const 강조그라디언트 = "linear-gradient(166deg, rgb(59,130,246) 0%, rgb(99,102,241) 45%, rgb(56,130,255) 100%)";

export const 화면 = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  minHeight: 0,
  boxSizing: "border-box",
  background: `radial-gradient(120% 90% at 50% 0%, ${색.바탕2} 0%, ${색.바탕} 62%)`,
  color: 색.글,
  fontFamily: 글꼴.본문,
  fontSize: 14,
  overflow: "hidden",
};

// 테두리는 축약(border)으로 쓰지 않는다 — 고른 상태에서 borderColor 만 덮어쓰면
// React 가 "축약과 개별 속성을 섞었다" 고 경고하고, 다시 그릴 때 색이 튄다.
export const 단추 = {
  appearance: "none",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: 색.선,
  borderRadius: 8,
  padding: "8px 12px",
  background: "rgba(20,30,50,0.7)",
  color: 색.글,
  font: `500 13px/1.3 ${글꼴.본문}`,
  cursor: "pointer",
};

export const 고른단추 = {
  ...단추,
  borderColor: 색.선강조,
  background: "rgba(59,130,246,0.22)",
  color: "#ffffff",
};

export const 큰단추 = {
  ...단추,
  padding: "12px 22px",
  borderRadius: 100,
  borderColor: "rgba(147,197,253,0.35)",
  backgroundImage: 강조그라디언트,
  boxShadow: "0 4px 18px rgba(59,130,246,0.35)",
  color: "#ffffff",
  font: `700 14px/1 ${글꼴.모노}`,
  letterSpacing: "0.02em",
};

export const 꺼진단추 = {
  ...큰단추,
  backgroundImage: "none",
  background: "rgba(40,52,74,0.7)",
  boxShadow: "none",
  color: "rgba(200,205,255,0.5)",
  cursor: "not-allowed",
};

export const 입력칸 = {
  flex: "1 1 auto",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "11px 14px",
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: 색.선,
  background: "#060d1a",
  color: 색.글,
  font: `400 15px/1.3 ${글꼴.본문}`,
};

export const 작은글 = { font: `400 12px/1.5 ${글꼴.본문}`, color: 색.더흐린글 };
export const 라벨 = { font: `500 13px/1.4 ${글꼴.본문}`, color: 색.흐린글 };
export const 소제목 = {
  font: `600 12px/1.4 ${글꼴.모노}`,
  color: 색.더흐린글,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

// 키보드 포커스가 어디 있는지 늘 보이게 한다(마우스 클릭에는 안 나오게 :focus-visible).
export const 포커스CSS = `
.캐생 *:focus-visible { outline: 2px solid ${색.강조}; outline-offset: 2px; border-radius: 6px; }
.캐생 input[type="range"] { accent-color: ${색.강조}; width: 100%; height: 22px; }
.캐생 ::-webkit-scrollbar { width: 10px; height: 10px; }
.캐생 ::-webkit-scrollbar-thumb { background: rgba(96,165,250,0.25); border-radius: 6px; }
.캐생 ::-webkit-scrollbar-track { background: transparent; }
`;
