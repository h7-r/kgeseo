// 글자는 폴리곤으로 깎지 않고 캔버스에 그린다 — 비싸기만 하고 안 예쁘다(벽함 라벨과 같은 원칙).
import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture, SIGN_FONT } from "@/engine/textures/canvas";

/** 분기함에 붙은 작은 명판 — 「A-1 / 조명분기」 */
export function junctionLabelTexture(text = "A-1", background = "#aeb6bd", ink = "#131314", wear = 1) {
  return cachedCanvasTexture(
    `workLampJunctionLabel|${text}|${background}|${ink}|${wear}`,
    (g, W, H) => {
      g.fillStyle = background;
      g.fillRect(0, 0, W, H);
      // 툰 테두리를 그림 안에 그린다 — 주변 외곽선과 굵기가 맞아야 한다
      g.strokeStyle = ink;
      g.lineWidth = 9;
      g.strokeRect(4.5, 4.5, W - 9, H - 9);
      g.fillStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `bold 62px ${SIGN_FONT}`;
      g.fillText(text, W / 2, H * 0.38);
      g.font = `26px ${SIGN_FONT}`;
      g.fillText("조명분기", W / 2, H * 0.76);
      // 낡음 — 새 표지판은 이 세계에 없다
      const rnd = makeRandom(text.charCodeAt(0) * 31 + 7);
      g.globalAlpha = 0.25 * wear;
      for (let i = 0; i < 26 * wear; i++) {
        g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
        const x = rnd() * W,
          y = rnd() * H,
          w = 2 + rnd() * 26,
          h = 1 + rnd() * 4;
        g.fillRect(x, y, w, h);
      }
      g.globalAlpha = 1;
    },
    { width: 256, height: 128, willReadFrequently: false, anisotropy: 4 },
  );
}

/** 비상문 해제 버튼 명판. 붉은 버튼만 두면 정체를 모른다 — 실물 개방 버튼도 반드시 명판이 있다. */
export function releaseLabelTexture(background = "#b5443a", ink = "#f4f6f8", wear = 1) {
  return cachedCanvasTexture(
    `workLampReleaseLabel|${background}|${ink}|${wear}`,
    (g, W, H) => {
      g.fillStyle = background;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "#131314";
      g.lineWidth = 7;
      g.strokeRect(3.5, 3.5, W - 7, H - 7);
      g.fillStyle = ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `bold 46px ${SIGN_FONT}`;
      g.fillText("비상문 개방", W / 2, H * 0.44);
      g.font = `22px ${SIGN_FONT}`;
      g.fillText("EMERGENCY DOOR RELEASE", W / 2, H * 0.79);
      const rnd = makeRandom(41);
      g.globalAlpha = 0.22 * wear;
      for (let i = 0; i < 20 * wear; i++) {
        g.fillStyle = rnd() > 0.5 ? "#2b2a25" : "#efe6c8";
        g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 18, 1 + rnd() * 3);
      }
      g.globalAlpha = 1;
    },
    { width: 256, height: 96, willReadFrequently: false, anisotropy: 4 },
  );
}

const CIRCUIT_NAMES = ["조명", "동력", "예비", "본선", "접지", "예비"];

/** 차단기함 속 회로 표찰 — 칸마다 무슨 회로인지 적힌 흰 띠 */
export function circuitStripTexture(wear = 1) {
  return cachedCanvasTexture(
    `workLampCircuitStrip|${wear}`,
    (g, W, H) => {
      g.fillStyle = "#d8dce0";
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "#2a2d31";
      g.lineWidth = 2;
      g.fillStyle = "#1b1d21";
      // 실물 명판 글씨는 띠 높이의 절반쯤이다. 꽉 채우면 표지판이 된다.
      g.font = `bold 20px ${SIGN_FONT}`;
      g.textBaseline = "middle";
      const n = CIRCUIT_NAMES.length;
      for (let i = 0; i < n; i++) {
        const x = (W / n) * i;
        g.strokeRect(x + 1, 1, W / n - 2, H - 2);
        g.textAlign = "center";
        g.fillText(CIRCUIT_NAMES[i], x + W / n / 2, H / 2 + 1);
      }
      const rnd = makeRandom(77);
      g.globalAlpha = 0.2 * wear;
      for (let i = 0; i < 16 * wear; i++) {
        g.fillStyle = "#4a443a";
        g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 14, 1 + rnd() * 2);
      }
      g.globalAlpha = 1;
    },
    { width: 512, height: 44, willReadFrequently: false, anisotropy: 4 },
  );
}

/**
 * 분필 자국 — 글자와 「몇 번째 칸」을 같이 적는다. 읽은 순서대로 넣으면 되는 건 퍼즐이 아니다.
 * 바탕은 투명 — 판을 덧댄 게 아니라 벽에 그려진 것으로 보여야 한다.
 */
export function chalkMarkTexture(position = 1, glyph = "V", color = "#dfe6ea", seed = 3) {
  return cachedCanvasTexture(
    `workLampChalk|${position}|${glyph}|${color}|${seed}`,
    (g, W, H) => {
      const rnd = makeRandom(seed * 977 + position);
      // 조금씩 어긋나게 여러 번 겹쳐 그어야 손으로 그은 티가 난다(한 번이면 폰트를 찍은 것 같다).
      const overdraw = (draw: () => void, times = 3) => {
        for (let i = 0; i < times; i++) {
          g.save();
          g.translate((rnd() - 0.5) * 3.2, (rnd() - 0.5) * 3.2);
          g.rotate((rnd() - 0.5) * 0.012);
          g.globalAlpha = 0.34 + rnd() * 0.3;
          draw();
          g.restore();
        }
      };

      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineCap = "round";
      g.lineJoin = "round";

      overdraw(() => {
        g.font = `bold 150px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(glyph, W / 2, H * 0.44);
      }, 4);

      overdraw(() => {
        g.lineWidth = 5;
        g.strokeRect(W / 2 - 34, H * 0.7 - 26, 68, 52);
        g.font = `bold 44px ${SIGN_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(position), W / 2, H * 0.7);
      }, 3);

      // 분필 가루 — 이게 있어야 '그은 것'으로 보인다
      g.globalAlpha = 1;
      for (let i = 0; i < 150; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 50 + rnd() * 90;
        g.globalAlpha = 0.05 + rnd() * 0.16;
        g.fillRect(W / 2 + Math.cos(a) * r, H * 0.5 + Math.sin(a) * r, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      g.globalAlpha = 1;
    },
    { width: 256, willReadFrequently: false, anisotropy: 4 },
  );
}

/**
 * 누가 매직으로 휘갈긴 한 단어(나눔손글씨 엉겅퀴). 할 일을 다 적으면 퍼즐이 설명서가 된다.
 * 캔버스는 글꼴이 다 받아진 뒤에 그려야 손글씨가 된다 — 대체 글꼴로 먼저 그리고 받아지면 다시 그린다.
 */
export function handwritingTexture(text: string, color = "#e9e2cf") {
  const draw = (g: CanvasRenderingContext2D, W: number, H: number) => {
    g.clearRect(0, 0, W, H);
    const rnd = makeRandom(text.length * 131 + text.charCodeAt(0));
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.06);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `170px "Eonggeongkwi", ${SIGN_FONT}`;
    // 두 번 겹쳐 쓴다 — 매직이 한 번에 고르게 안 나온 자국
    for (let i = 0; i < 2; i++) {
      g.globalAlpha = i ? 0.45 : 0.9;
      g.fillText(text, (rnd() - 0.5) * 4, (rnd() - 0.5) * 4);
    }
    g.globalAlpha = 0.7;
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-text.length * 60, 78);
    g.quadraticCurveTo(0, 92, text.length * 64, 70);
    g.stroke();
    g.restore();
  };
  return cachedCanvasTexture(`workLampHandwriting|${text}|${color}`, draw, {
    width: 512,
    height: 256,
    willReadFrequently: false,
    anisotropy: 4,
    onCreate: (texture, canvas) => {
      if (typeof document === "undefined" || !document.fonts?.load) return;
      document.fonts
        .load(`170px "Eonggeongkwi"`, text)
        .then(() => {
          const g = canvas.getContext("2d");
          if (!g) return;
          draw(g, canvas.width, canvas.height);
          texture.needsUpdate = true;
        })
        .catch(() => {});
    },
  });
}

/** 액자 아래 놋쇠 명판 */
export function nameplateTexture(title: string, subtitle: string, background = "#b89b52") {
  return cachedCanvasTexture(
    `workLampNameplate|${title}|${subtitle}|${background}`,
    (g, W, H) => {
      const gradient = g.createLinearGradient(0, 0, 0, H);
      gradient.addColorStop(0, background);
      gradient.addColorStop(0.5, "#ffffff22");
      gradient.addColorStop(1, background);
      g.fillStyle = background;
      g.fillRect(0, 0, W, H);
      g.fillStyle = gradient;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = "#2a2418";
      g.lineWidth = 6;
      g.strokeRect(4, 4, W - 8, H - 8);
      g.strokeStyle = "rgba(42,36,24,0.5)";
      g.lineWidth = 2;
      g.strokeRect(14, 14, W - 28, H - 28);
      g.fillStyle = "#1e1a12";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `bold 50px ${SIGN_FONT}`;
      g.fillText(title, W / 2, H * 0.4);
      g.font = `24px ${SIGN_FONT}`;
      g.fillText(subtitle, W / 2, H * 0.76);
    },
    { width: 512, height: 128, willReadFrequently: false, anisotropy: 4 },
  );
}
