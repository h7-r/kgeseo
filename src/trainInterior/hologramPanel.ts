// 글자가 선명하고 클릭이 되어야 해서 메쉬 대신 캔버스에 그려 평면에 얹는다.
// 클릭은 평면 UV 를 캔버스 좌표로 바꿔 영역 판정한다 — 그리기와 판정이 아래 같은 좌표를 쓴다.

/** 캔버스 해상도(px). 평면 비율도 이걸 따른다. */
export const HOLOGRAM_CANVAS_WIDTH = 1024;
export const HOLOGRAM_CANVAS_HEIGHT = 620;

interface Destination {
  id: string;
  /** 화면 표시 */
  name: string;
  subtitle: string;
  isOpen: boolean;
}

/** 지금은 나주만 열려 있다. */
export const DESTINATIONS: readonly Destination[] = [
  { id: "naju", name: "나주", subtitle: "NAJU-01 · 앙암바위", isOpen: true },
  { id: "lock1", name: "???", subtitle: "LOCKED · 준비 중", isOpen: false },
  { id: "lock2", name: "???", subtitle: "LOCKED · 준비 중", isOpen: false },
];

type LonLat = readonly [number, number];

/** 대한민국 본토 외곽선(간략화) [경도, 위도] — 북서쪽에서 시계방향 */
const KOREA_OUTLINE: readonly LonLat[] = [
  [126.6, 37.75],
  [126.9, 38.3],
  [128.0, 38.35],
  [128.6, 38.55],
  [129.1, 37.6],
  [129.45, 36.9],
  [129.57, 36.05],
  [129.42, 35.6],
  [129.1, 35.1],
  [128.7, 34.95],
  [128.0, 34.75],
  [127.6, 34.6],
  [127.2, 34.5],
  [126.9, 34.55],
  [126.55, 34.3],
  [126.38, 34.75],
  [126.6, 35.15],
  [126.45, 35.7],
  [126.6, 36.0],
  [126.45, 36.45],
  [126.15, 36.75],
  [126.75, 36.95],
  [126.5, 37.35],
  [126.6, 37.75],
];
const JEJU: LonLat = [126.5, 33.4];
const NAJU: LonLat = [126.72, 35.03];
// 제주까지 들어오는 지도 범위
const MIN_LON = 125.9;
const MAX_LON = 129.75;
const MIN_LAT = 33.0;
const MAX_LAT = 38.7;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LIST_X = 560;
const LIST_W = HOLOGRAM_CANVAS_WIDTH - LIST_X - 60;
const ROW_H = 78;
const ROW0_Y = 170;
const ROW_GAP = 14;
export const getDestinationRowRect = (i: number): Rect => ({
  x: LIST_X,
  y: ROW0_Y + i * (ROW_H + ROW_GAP),
  w: LIST_W,
  h: ROW_H,
});
export const SELECT_BUTTON_RECT: Rect = { x: LIST_X, y: HOLOGRAM_CANVAS_HEIGHT - 110, w: LIST_W / 2 - 12, h: 66 };
export const RESET_BUTTON_RECT: Rect = {
  x: LIST_X + LIST_W / 2 + 12,
  y: HOLOGRAM_CANVAS_HEIGHT - 110,
  w: LIST_W / 2 - 12,
  h: 66,
};

export const isPointInRect = (rect: Rect, cx: number, cy: number) =>
  cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;

function traceRoundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

interface HologramPanelState {
  selectedId: string | null;
  isNear: boolean;
}

const FONT = "'Apple SD Gothic Neo', sans-serif";

/** 홀로그램 UI 한 장을 그린다. */
export function drawHologramPanel(g: CanvasRenderingContext2D, { selectedId, isNear }: HologramPanelState) {
  const W = HOLOGRAM_CANVAS_WIDTH,
    H = HOLOGRAM_CANVAS_HEIGHT;
  const cyan = "#8fe6ff",
    brightCyan = "#d6f4ff",
    dim = "rgba(120,210,245,0.45)";
  g.clearRect(0, 0, W, H);

  traceRoundedRect(g, 10, 10, W - 20, H - 20, 22);
  g.fillStyle = "rgba(12,34,50,0.52)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = cyan;
  g.stroke();

  // 모서리 브래킷
  g.strokeStyle = brightCyan;
  g.lineWidth = 5;
  const b = 46;
  for (const [cx, cy, sx, sy] of [
    [26, 26, 1, 1],
    [W - 26, 26, -1, 1],
    [26, H - 26, 1, -1],
    [W - 26, H - 26, -1, -1],
  ]) {
    g.beginPath();
    g.moveTo(cx + sx * b, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + sy * b);
    g.stroke();
  }

  g.textBaseline = "top";
  g.fillStyle = brightCyan;
  g.font = `bold 44px ${FONT}`;
  g.fillText("DESTINATIONS", 56, 40);
  g.fillStyle = dim;
  g.font = `22px ${FONT}`;
  g.fillText("목 적 지  선 택", 58, 96);

  g.strokeStyle = "rgba(120,210,245,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(LIST_X - 30, 60);
  g.lineTo(LIST_X - 30, H - 60);
  g.stroke();

  // 왼쪽: 대한민국 지도 + 나주 위치
  const bx = 150,
    by = 132,
    bw = 240,
    bh = 424;
  const project = (lon: number, lat: number): [number, number] => [
    bx + ((lon - MIN_LON) / (MAX_LON - MIN_LON)) * bw,
    by + (1 - (lat - MIN_LAT) / (MAX_LAT - MIN_LAT)) * bh, // 북쪽이 위
  ];
  g.beginPath();
  KOREA_OUTLINE.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, lat);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fillStyle = "rgba(90,200,240,0.14)";
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = "rgba(150,230,255,0.8)";
  g.stroke();
  {
    const [jx, jy] = project(JEJU[0], JEJU[1]);
    g.beginPath();
    g.ellipse(jx, jy, 19, 10, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(90,200,240,0.14)";
    g.fill();
    g.stroke();
  }
  // 나주 표식 — 링 + 빛나는 점 + 지시선 + 라벨
  const [nx, ny] = project(NAJU[0], NAJU[1]);
  g.strokeStyle = "rgba(190,245,255,0.85)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(nx, ny, 15, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#eafcff";
  g.shadowColor = "#9be9ff";
  g.shadowBlur = 16;
  g.beginPath();
  g.arc(nx, ny, 7, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(190,245,255,0.6)";
  g.beginPath();
  g.moveTo(nx, ny);
  g.lineTo(nx + 44, ny + 30);
  g.stroke();
  g.textBaseline = "top";
  g.font = `bold 26px ${FONT}`;
  g.fillStyle = brightCyan;
  g.fillText("나주", nx + 50, ny + 20);
  g.font = `15px ${FONT}`;
  g.fillStyle = dim;
  g.fillText("NAJU-01", nx + 50, ny + 48);

  // 오른쪽: 목적지 목록
  DESTINATIONS.forEach((destination, i) => {
    const r = getDestinationRowRect(i);
    const isOpen = destination.isOpen;
    const isSelected = selectedId === destination.id;
    traceRoundedRect(g, r.x, r.y, r.w, r.h, 12);
    g.fillStyle = isSelected ? "rgba(120,225,255,0.22)" : "rgba(90,170,210,0.10)";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = isOpen ? (isSelected ? brightCyan : cyan) : "rgba(120,170,195,0.35)";
    g.stroke();
    g.textBaseline = "middle";
    g.fillStyle = isOpen ? brightCyan : "rgba(150,185,205,0.5)";
    g.font = `bold 30px ${FONT}`;
    g.fillText(destination.name, r.x + 26, r.y + r.h * 0.38);
    g.fillStyle = isOpen ? dim : "rgba(150,185,205,0.4)";
    g.font = `18px ${FONT}`;
    g.fillText(destination.subtitle, r.x + 26, r.y + r.h * 0.72);
    const boxX = r.x + r.w - 54,
      boxY = r.y + r.h / 2 - 16;
    traceRoundedRect(g, boxX, boxY, 32, 32, 7);
    g.lineWidth = 2.5;
    g.strokeStyle = isOpen ? cyan : "rgba(120,170,195,0.4)";
    g.stroke();
    if (isSelected) {
      g.strokeStyle = brightCyan;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(boxX + 7, boxY + 17);
      g.lineTo(boxX + 14, boxY + 24);
      g.lineTo(boxX + 26, boxY + 8);
      g.stroke();
    }
    g.textBaseline = "top";
  });

  const buttons: [Rect, string, boolean][] = [
    [SELECT_BUTTON_RECT, "SELECT", !!selectedId],
    [RESET_BUTTON_RECT, "RESET", false],
  ];
  for (const [rect, text, isHighlighted] of buttons) {
    traceRoundedRect(g, rect.x, rect.y, rect.w, rect.h, 12);
    g.fillStyle = isHighlighted ? "rgba(120,225,255,0.28)" : "rgba(90,170,210,0.10)";
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = isHighlighted ? brightCyan : cyan;
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillStyle = isHighlighted ? brightCyan : dim;
    g.font = `bold 28px ${FONT}`;
    g.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2);
    g.textAlign = "left";
    g.textBaseline = "top";
  }

  if (isNear) {
    const hy = SELECT_BUTTON_RECT.y - 58;
    traceRoundedRect(g, LIST_X, hy, LIST_W, 44, 11);
    g.fillStyle = "rgba(120,225,255,0.18)";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = brightCyan;
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillStyle = brightCyan;
    g.font = `bold 24px ${FONT}`;
    g.fillText("[ E ]  나주로 이동", LIST_X + LIST_W / 2, hy + 23);
    g.textAlign = "left";
    g.textBaseline = "top";
  }

  // 스캔라인
  g.globalAlpha = 0.06;
  g.fillStyle = "#bfefff";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
}
