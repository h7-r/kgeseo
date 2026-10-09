import type * as THREE from "three";

import { makeCachedCanvasTexture } from "@/engine/textures/canvas";

const SIZE = 256;
const FONT = "system-ui, 'Malgun Gothic', sans-serif";

let imageDataUrl: string | null = null;

// 정답(VALVE)을 그대로 주지 않고 밸브 그림 + 빈칸으로 유추하게 한다.
function drawHintPaper(g: CanvasRenderingContext2D, size: number) {
  g.fillStyle = "#f3efe2"; // 누런 종이
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#c9c0a8";
  g.lineWidth = 5;
  g.strokeRect(9, 9, size - 18, size - 18);
  // 머리말은 분위기용 — 정답이 아니다
  g.fillStyle = "#7c7460";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${Math.round(size * 0.075)}px ${FONT}`;
  g.fillText("MAINTENANCE NOTE", size / 2, size * 0.16);
  // 밸브 핸들휠(원 테 + 허브 + 스포크 4개)
  const cx = size / 2;
  const cy = size * 0.42;
  const radius = size * 0.17;
  g.strokeStyle = "#3a3d42";
  g.lineWidth = 9;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 7;
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    g.stroke();
  }
  g.fillStyle = "#3a3d42";
  g.beginPath();
  g.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
  g.fill();
  // 밸브에서 내려오는 스템
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(cx, cy + radius);
  g.lineTo(cx, cy + radius * 1.5);
  g.stroke();
  g.fillStyle = "#23262b";
  g.font = `800 ${Math.round(size * 0.17)}px ${FONT}`;
  g.fillText("V _ _ _ E", cx, size * 0.74);
  g.fillStyle = "#8a8270";
  g.font = `600 ${Math.round(size * 0.06)}px ${FONT}`;
  g.fillText("5 LETTERS", cx, size * 0.88);
}

/** 밸브 힌트 쪽지 텍스처. 손에 든 쪽지·바닥 쪽지·힌트함 그림이 한 캔버스를 같이 쓴다. */
export function makeHintPaperTexture(): THREE.CanvasTexture {
  return makeCachedCanvasTexture("hintPaper", (g, width) => drawHintPaper(g, width), {
    width: SIZE,
    willReadFrequently: false,
    onCreate: (_texture, canvas) => {
      try {
        imageDataUrl = canvas.toDataURL("image/png");
      } catch {
        imageDataUrl = null; // 캔버스를 못 읽는 환경 — 그림 없이 글만 뜬다
      }
    },
  });
}

/** 힌트함(모달)에 띄울 PNG. 따로 그리면 손에 든 쪽지와 창 속 쪽지가 다른 그림이 된다. */
export function getHintPaperImageUrl(): string | null {
  makeHintPaperTexture();
  return imageDataUrl;
}
