// main.jsx — NAJU-01 그레이박스의 시작점
//   본편(../../src/main.jsx)과 같은 구조다. 씬이 하나뿐이라 라우터만 뺐다.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
