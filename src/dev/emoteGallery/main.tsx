import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import EmoteGallery from "./EmoteGallery";

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다");
createRoot(root).render(
  <StrictMode>
    <EmoteGallery />
  </StrictMode>,
);
