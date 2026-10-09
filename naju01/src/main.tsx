// NAJU-01 그레이박스의 시작점. 본편 main 과 같은 구조에서 라우터만 뺐다.
import { createRoot } from "react-dom/client";

import App from "./app/App";
// 본편 기차에서 텔레포트로 넘어오면 본편이 틀던 로딩 영상을 같은 장면부터 이어 틀고, 이 맵이 다 뜨면 걷는다
import LoadingVideoOverlay from "./transition/LoadingVideoOverlay";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root 가 없다");

// StrictMode 를 씌우지 않는다 — 개발 모드에서 useMemo 를 두 번 돌리고 effect 를 붙였다 떼었다 다시 붙여,
// 지형·무리를 전부 memo 로 세우는 이 씬은 첫 진입 CPU·GPU 업로드·fetch 가 통째로 두 배가 된다. 본편은 그대로 둔다.
createRoot(container).render(
  <>
    <App />
    <LoadingVideoOverlay />
  </>,
);
