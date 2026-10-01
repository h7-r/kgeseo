// main.jsx — NAJU-01 그레이박스의 시작점
//   본편(../../src/main.jsx)과 같은 구조다. 씬이 하나뿐이라 라우터만 뺐다.
// ★ StrictMode 를 **안 씌운다.**
//   [왜]  개발 모드의 StrictMode 는 useMemo 를 두 번 부르고 useEffect 를
//   「붙임 → 뗌 → 붙임」으로 돌린다. 이 씬은 지형·절벽·길·수풀·무리 전부를
//   useMemo 로 세우므로 **첫 진입 CPU 작업이 통째로 두 배**였고, GPU 업로드도
//   두 번, 편집·모형 fetch 도 두 번 나갔다. 발표는 개발 서버로 하니 그 값이
//   그대로 「들어갈 때 끊김」이 됐다. 본편은 그대로 둔다 — 여기만 뺀다.
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
