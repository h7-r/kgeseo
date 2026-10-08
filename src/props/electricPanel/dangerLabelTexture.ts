import { cachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";

export const DANGER_LABEL_WIDTH = 384;
export const DANGER_LABEL_HEIGHT = 88;

/**
 * 주차단기의 「전기위험」 딱지. 화면에서 8cm 남짓이라 빗금은 좌우 끝으로 보내고 세로를 통째로 글자에 준다.
 * 문을 열면 늘 비스듬히 보므로 anisotropy 를 높여 밉맵이 글자를 뭉개지 않게 한다.
 */
export function dangerLabelTexture(background = "#e8c53a", text = "#c0281f") {
  return cachedCanvasTexture(
    `dangerLabel|${background}|${text}`,
    (g, w, h) => {
      const stripe = 46; // 좌우 빗금 폭
      g.fillStyle = "#1b1b1c";
      g.fillRect(0, 0, w, h);
      g.fillStyle = background;
      g.fillRect(4, 4, w - 8, h - 8);
      g.save();
      g.beginPath();
      g.rect(4, 4, stripe, h - 8);
      g.rect(w - 4 - stripe, 4, stripe, h - 8);
      g.clip();
      g.fillStyle = "#1b1b1c";
      for (let i = -h; i < w; i += 22) {
        g.beginPath();
        g.moveTo(i, 4);
        g.lineTo(i + 11, 4);
        g.lineTo(i + 11 + h, h - 4);
        g.lineTo(i + h, h - 4);
        g.closePath();
        g.fill();
      }
      g.restore();
      g.fillStyle = text;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `800 56px ${SIGN_FONT}`;
      g.fillText("전기위험", w / 2, h / 2 + 3);
    },
    { width: DANGER_LABEL_WIDTH, height: DANGER_LABEL_HEIGHT, anisotropy: 16 },
  );
}
