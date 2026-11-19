/**
 * 그림패 — 횃불대에 걸린 두툼한 나무패. 널을 한 겹 파내고 그 밤부터의 일들을 한 장씩 그렸다.
 * 그림은 새로 그리지 않는다 — 플레이어가 이미 본 두 영상(함의 영상 ridge/shadowPlay · 선바위의 영상 cliff/moonPlay)의
 * 한 장면을 그대로 떠서 널에 얹는다. 본 장면이라 무슨 일인지, 어느 것이 먼저인지 바로 떠올릴 수 있다.
 * 제 횃불에 불이 붙으면 그 장면이 잠깐 움직였다가(영상의 그 대목) 멎는다 — 잊혔던 일이 되살아난다.
 * 좌표는 그림판 px.
 */
import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { createMoonPlay } from "../cliff/moonPlay";
import { FILM, createShadowPlay } from "../ridge/shadowPlay";

const W = 1024;
const H = 640;
/** 패 크기(미터) */
export const TAG_SIZE = { width: 0.78, height: (0.78 * H) / W };
/** 그림이 들어가는 자리 — 둘레에 널 테를 남긴다 */
const INSET = { x: 56, y: 56, width: W - 112, height: H - 112 };
/** 영상에서 잘라 올 높이(위아래 띠를 뺀다) */
const CROP = { top: 0.1, height: 0.8 };
/** 불이 붙은 뒤 장면이 움직이는 시간(초) */
export const TAG_PLAY_SECONDS = 2.8;

/**
 * 그림패마다 — 어느 영상의 어느 대목인가(from~to 초가 움직이고 still 에서 멎는다) · 가로로 어디부터 자르나(0~1).
 * gutShape.TAGS 와 같은 차례. still 은 컷이 넘어가는 순간을 피해 고른다(그 순간은 한 장 어둡다).
 */
const CLIPS: readonly { film: "box" | "moon"; from: number; still: number; left: number }[] = [
  { film: "box", from: 0.3, still: 1.1, left: 0.06 }, // 초롱을 들고 벼랑을 걷는다
  { film: "box", from: 3.98, still: 4.5, left: 0.18 }, // 뒤꿈치가 미끄러진다
  { film: "moon", from: 1.6, still: 3.6, left: 0.06 }, // 물 세 그릇 앞에 무릎을 꿇는다
  { film: "moon", from: 4.8, still: 7.2, left: 0.1 }, // 바위 틈에서 구렁이가 올라온다
  { film: "moon", from: 10.8, still: 12.6, left: 0 }, // 횃불 든 사내들이 올라온다
];

const makeCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return { canvas, g: canvas.getContext("2d")! };
};

/** 나뭇결 — 가로로 길게 흐르는 결과 옹이 */
function drawGrain(g: CanvasRenderingContext2D, seed: number, strength: number) {
  const random = createRandom(seed);
  for (let i = 0; i < 150; i++) {
    const y = random() * H;
    g.strokeStyle = `rgba(${random() > 0.5 ? "128,96,66" : "10,7,5"},${(0.12 + random() * 0.2) * strength})`;
    g.lineWidth = 0.8 + random() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(
      W * 0.3,
      y + (random() - 0.5) * 22,
      W * 0.7,
      y + (random() - 0.5) * 22,
      W,
      y + (random() - 0.5) * 14,
    );
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = random() * W;
    const y = random() * H;
    for (let ring = 1; ring <= 5; ring++) {
      g.strokeStyle = `rgba(12,8,5,${0.2 * strength})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(x, y, ring * 7, ring * 3.4, 0.1, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** 널 — 그림 자리를 한 겹 파낸 두툼한 판자. 위쪽 모는 빛을 받고 아래쪽 모는 그늘진다 */
function drawBoard(g: CanvasRenderingContext2D, seed: number) {
  const wood = g.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, "#4E3A29");
  wood.addColorStop(0.5, "#3F2E20");
  wood.addColorStop(1, "#2C2016");
  g.fillStyle = wood;
  g.fillRect(0, 0, W, H);
  drawGrain(g, seed, 1);
  // 테 — 바깥 모를 둥글려 깎았다(위는 밝고 아래는 어둡다). 안쪽에는 홈을 한 줄 돌렸다
  const bevel = g.createLinearGradient(0, 0, 0, H);
  bevel.addColorStop(0, "rgba(255,224,176,0.3)");
  bevel.addColorStop(0.05, "rgba(255,224,176,0)");
  bevel.addColorStop(0.95, "rgba(0,0,0,0)");
  bevel.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = bevel;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(10,6,4,0.7)";
  g.lineWidth = 4;
  g.strokeRect(26, 26, W - 52, H - 52);
  g.strokeStyle = "rgba(214,176,128,0.28)";
  g.lineWidth = 2;
  g.strokeRect(30, 30, W - 60, H - 60);
  // 그림 자리 — 파인 바닥
  g.fillStyle = "#07050A";
  g.beginPath();
  g.roundRect(INSET.x - 6, INSET.y - 6, INSET.width + 12, INSET.height + 12, 8);
  g.fill();
  g.strokeStyle = "rgba(214,176,128,0.4)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(INSET.x - 4, INSET.y + INSET.height + 6);
  g.lineTo(INSET.x + INSET.width + 4, INSET.y + INSET.height + 6);
  g.stroke();
}

/** 그림 위에 얹는 것 — 옅게 비치는 결, 닳아 어두운 가장자리, 파인 턱의 그늘 */
function drawOverlay(g: CanvasRenderingContext2D, seed: number) {
  g.save();
  g.beginPath();
  g.roundRect(INSET.x, INSET.y, INSET.width, INSET.height, 6);
  g.clip();
  drawGrain(g, seed + 7, 0.28);
  const centerY = INSET.y + INSET.height / 2;
  const worn = g.createRadialGradient(W / 2, centerY, INSET.height * 0.42, W / 2, centerY, INSET.width * 0.62);
  worn.addColorStop(0, "rgba(20,12,8,0)");
  worn.addColorStop(1, "rgba(20,12,8,0.55)");
  g.fillStyle = worn;
  g.fillRect(INSET.x, INSET.y, INSET.width, INSET.height);
  const lip = g.createLinearGradient(0, INSET.y, 0, INSET.y + 26);
  lip.addColorStop(0, "rgba(0,0,0,0.6)");
  lip.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = lip;
  g.fillRect(INSET.x, INSET.y, INSET.width, 26);
  g.restore();
}

/**
 * 그림패 다섯 장(gutShape.TAGS 의 차례). 두 영상을 그 자리에서 그려 장면을 뜬다 — 배경 판을 굽느라 잠깐 걸리니,
 * 화면이 어두운 때(틈을 건너는 동안)에 부른다. play 로 그 패의 장면을 움직인다(불이 붙은 뒤 흐른 초).
 */
export function makeTagBoards() {
  const films = { box: createShadowPlay(), moon: createMoonPlay() };
  const sourceHeight = FILM.height * CROP.height;
  const sourceWidth = (sourceHeight * INSET.width) / INSET.height;
  const boards = CLIPS.map((clip, index) => {
    const face = makeCanvas();
    const board = makeCanvas();
    const overlay = makeCanvas();
    drawBoard(board.g, 900 + index * 13);
    drawOverlay(overlay.g, 900 + index * 13);
    const texture = new THREE.CanvasTexture(face.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    /** 영상의 at 초 장면으로 패를 다시 그린다 */
    const paint = (at: number) => {
      const film = films[clip.film];
      film.draw(at);
      const g = face.g;
      g.drawImage(board.canvas, 0, 0);
      g.save();
      g.beginPath();
      g.roundRect(INSET.x, INSET.y, INSET.width, INSET.height, 6);
      g.clip();
      g.imageSmoothingQuality = "high";
      g.filter = "brightness(1.2) saturate(1.12) contrast(1.05)";
      g.drawImage(
        film.canvas,
        Math.min(clip.left * FILM.width, FILM.width - sourceWidth),
        FILM.height * CROP.top,
        sourceWidth,
        sourceHeight,
        INSET.x,
        INSET.y,
        INSET.width,
        INSET.height,
      );
      g.restore();
      g.drawImage(overlay.canvas, 0, 0);
      texture.needsUpdate = true;
    };
    paint(clip.still);
    return { texture, paint, clip, shown: clip.still };
  });
  return {
    textures: boards.map((board) => board.texture),
    /** 불이 붙은 뒤 seconds 초의 장면 — 그 대목의 처음부터 움직여 still 에서 멎는다 */
    play(tag: number, seconds: number) {
      const board = boards[tag];
      const u = THREE.MathUtils.clamp(seconds / TAG_PLAY_SECONDS, 0, 1);
      const at = THREE.MathUtils.lerp(board.clip.from, board.clip.still, u);
      if (Math.abs(at - board.shown) < 1 / 40) return;
      board.shown = at;
      board.paint(at);
    },
  };
}

export type TagBoards = ReturnType<typeof makeTagBoards>;
