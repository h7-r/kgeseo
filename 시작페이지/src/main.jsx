import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./토큰.css";
import "./index.css";
import 앱 from "./앱.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <앱 />
    </BrowserRouter>
  </StrictMode>,
);
