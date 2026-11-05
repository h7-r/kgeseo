// 객차 벽의 안내판 바탕. 글자가 선명해야 해서 메쉬 대신 캔버스에 그려 평면에 얹는다.
// 오른쪽에서 움직이는 외곽선은 OutlineMorph 가 판 위에 따로 그린다. 고르는 일은 화면 창(DestinationWindow)에서 한다.

export const HOLOGRAM_CANVAS_WIDTH = 1280;
export const HOLOGRAM_CANVAS_HEIGHT = 720;
/** 스캔 띠와 빔이 판과 같은 색을 쓴다. */
export const HOLOGRAM_ACCENT_COLOR = "#6f86bf";

const FONT = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', sans-serif";
const MONO_FONT = "'IBM Plex Mono', monospace";
const CORNER = 28;
const PROMPT_LINES = ["전설 속으로 들어가실", "준비가 되셨습니까?"];
const PROMPT_X = 84;
const PROMPT_CENTER_Y = 340;
const PROMPT_LINE_HEIGHT = 74;

/** 판 한 장을 그린다. 겨눌 때만 테두리가 밝아지고 키 표시가 뜬다. */
export function drawHologramPanel(g: CanvasRenderingContext2D, isAimed: boolean) {
  const W = HOLOGRAM_CANVAS_WIDTH,
    H = HOLOGRAM_CANVAS_HEIGHT;
  g.clearRect(0, 0, W, H);

  // 일반 혼합이 선형 공간에서 일어나 알파가 낮으면 뒤 기둥이 그대로 비친다.
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, CORNER);
  const background = g.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, "rgba(8,18,40,0.985)");
  background.addColorStop(1, "rgba(1,4,10,0.985)");
  g.fillStyle = background;
  g.fill();
  g.lineWidth = isAimed ? 5 : 3;
  g.strokeStyle = isAimed ? "#cdd8f6" : "#4f6cb0";
  g.stroke();

  g.textBaseline = "middle";
  g.textAlign = "left";
  g.letterSpacing = "-1px";
  g.fillStyle = "#f1f1fc";
  g.font = `500 50px ${FONT}`;
  const firstY = PROMPT_CENTER_Y - ((PROMPT_LINES.length - 1) * PROMPT_LINE_HEIGHT) / 2;
  PROMPT_LINES.forEach((line, i) => g.fillText(line, PROMPT_X, firstY + i * PROMPT_LINE_HEIGHT));
  g.letterSpacing = "0px";

  if (isAimed) {
    g.beginPath();
    g.roundRect(PROMPT_X, 460, 72, 72, 14);
    g.fillStyle = "#f1f1fc";
    g.fill();
    g.fillStyle = "#0b1a3a";
    g.textAlign = "center";
    g.font = `700 44px ${MONO_FONT}`;
    g.fillText("E", PROMPT_X + 36, 498);
  }
}
