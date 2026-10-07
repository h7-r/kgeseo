/**
 * 캔 라벨과 커피 음료 색. 복도 바닥 잡동사니도 같은 목록·같은 그림을 쓴다 —
 * 자판기에서 뽑아 마신 캔이 바닥에 굴러다녀야 한 세계로 읽힌다.
 */

// 한글이 들어가므로 CJK 폰트를 앞에 둔다(브라우저에 있으면 쓴다).
export const VENDING_FONT_STACK = "'Noto Sans CJK KR', 'Malgun Gothic', system-ui, sans-serif";

export interface CanFlavor {
  background: string;
  label: string;
  labelColor: string;
  /** 대각 밝은 띠(스우시) */
  swoosh: string;
  /** 거품 방울 */
  bubble: string;
}

// 실제 브랜드는 상표라 못 쓴다. 음료 종류를 나타내는 오리지널 디자인이다.
export const CAN_FLAVORS: readonly CanFlavor[] = [
  { background: "#1b4fb0", label: "SODA", labelColor: "#ffffff", swoosh: "#eaf1fb", bubble: "#9cc0f2" },
  { background: "#2f9e52", label: "CIDER", labelColor: "#ffffff", swoosh: "#eafff0", bubble: "#bff0cf" },
  { background: "#dfe6ec", label: "MILK", labelColor: "#2b6cb0", swoosh: "#2b6cb0", bubble: "#cfe0f2" },
  { background: "#e39a24", label: "ORANGE", labelColor: "#ffffff", swoosh: "#fff0d6", bubble: "#ffd98a" },
  { background: "#7a3ea0", label: "GRAPE", labelColor: "#ffffff", swoosh: "#f0e0ff", bubble: "#c79be6" },
  { background: "#d23b32", label: "COLA", labelColor: "#ffffff", swoosh: "#ffe3df", bubble: "#f5a39c" },
];

/** 커피 메뉴(버튼에 보이는 이름)별로 컵에 채워지는 음료 색. 목록에 없으면 기본 커피색을 쓴다. */
export const COFFEE_LIQUID_COLORS: Readonly<Record<string, string>> = {
  블랙커피: "#2a1a10",
  밀크커피: "#a87d54",
  율무차: "#cdb488",
  코코아: "#5a3620",
  아이스커피: "#3a2416",
  아이스라떼: "#c6a37e",
  아이스밀크: "#efe6d2",
  아이스초코: "#432a1c",
};

/**
 * 캔 라벨을 주어진 칸에 그린다. 텍스처 한 장을 통째로 쓰지 않고 칸을 받는 이유 —
 * 바닥 잡동사니가 6종을 아틀라스 한 장에 모아 굴러다니는 캔 전부를 메시 하나로 그린다.
 */
export function drawCanLabel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  { background, label, labelColor, swoosh, bubble }: CanFlavor,
) {
  g.save();
  g.translate(x, y);
  g.fillStyle = background;
  g.fillRect(0, 0, width, height);

  g.globalAlpha = 0.9;
  g.fillStyle = swoosh;
  g.beginPath();
  g.moveTo(0, height * 0.64);
  g.lineTo(width, height * 0.32);
  g.lineTo(width, height * 0.5);
  g.lineTo(0, height * 0.82);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;

  // 위·아래 은색 테 — 캔 금속 느낌
  g.fillStyle = "#c9ccd0";
  g.fillRect(0, 0, width, 16);
  g.fillRect(0, height - 16, width, 16);

  g.fillStyle = bubble;
  g.globalAlpha = 0.55;
  for (const [px, py, pr] of [
    [0.12, 0.28, 14],
    [0.4, 0.2, 10],
    [0.62, 0.3, 12],
    [0.88, 0.24, 9],
  ]) {
    g.beginPath();
    g.arc(width * px, height * py, pr, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;

  // 원통에 감기므로 워드마크를 1/4·3/4 두 번 — 어느 쪽에서 봐도 하나는 정면이다.
  g.fillStyle = labelColor;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const cx of [width * 0.25, width * 0.75]) {
    let fontSize = 60;
    do {
      g.font = `800 ${fontSize}px ${VENDING_FONT_STACK}`;
      if (g.measureText(label).width <= width * 0.44) break;
      fontSize -= 2;
    } while (fontSize > 18);
    g.fillText(label, cx, height * 0.54);
  }
  g.restore();
}
