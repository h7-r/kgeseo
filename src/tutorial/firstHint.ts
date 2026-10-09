import { addHint, flashHints, type Hint } from "@/game/hintBox";

// 튜토리얼 뒤 혼자 풀 자판기 퍼즐 쪽으로 등을 미는 한 줄. 풀이는 말하지 않고 「캔음료」에만 따옴표로 눈길을 준다.
const FIRST_HINT_TEXT = '본부실 사람들은 커피와 "캔음료"를 무척 좋아해!';

const CANVAS_SIZE = 512;
const FONT = "'Nanum Pen Script', 'Gaegu', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
const NOTE_LINES: [text: string, tilt: number][] = [
  ["본부실 사람들은", 0.015],
  ['커피와 "캔음료"를', -0.02],
  ["무척 좋아해!", 0.01],
];

let cachedNoteImageUrl: string | null = null;

/** 찢어진 쪽지를 캔버스에 그려 PNG data URL 로 돌려준다. 한 번 그린 것을 계속 쓴다. */
function makeNoteImageUrl() {
  if (cachedNoteImageUrl) return cachedNoteImageUrl;
  if (typeof document === "undefined") return null;
  const S = CANVAS_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  if (!g) return null;

  // 씨앗을 고정해 다시 열 때마다 같은 모양이 나오게 한다.
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const left = 46;
  const right = S - 46;
  const top = 120;
  const bottom = S - 120;
  const points: [number, number][] = [];
  for (let x = left; x <= right; x += 14) points.push([x, top + (random() - 0.5) * 22]);
  points.push([right + 4, top + 6], [right - 2, bottom - 4]);
  for (let x = right; x >= left; x -= 14) points.push([x, bottom + (random() - 0.5) * 26]);
  points.push([left - 3, bottom - 6], [left + 2, top + 4]);

  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(-0.045);
  g.translate(-S / 2, -S / 2);
  const tracePaper = () => {
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };

  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  g.fillStyle = "#efe6cf";
  tracePaper();
  g.fill();
  g.restore();

  // 누렇게 바랜 얼룩과 옅은 줄 노트 선
  g.save();
  tracePaper();
  g.clip();
  for (let i = 0; i < 6; i++) {
    const x = left + random() * (right - left);
    const y = top + random() * (bottom - top);
    const r = 40 + random() * 70;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, "rgba(176,150,96,0.16)");
    stain.addColorStop(1, "rgba(176,150,96,0)");
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = "rgba(120,140,170,0.22)";
  g.lineWidth = 2;
  for (let y = top + 52; y < bottom - 10; y += 50) {
    g.beginPath();
    g.moveTo(left + 8, y);
    g.lineTo(right - 8, y);
    g.stroke();
  }
  g.restore();

  // 찢긴 가장자리 섬유
  g.strokeStyle = "rgba(255,252,240,0.85)";
  g.lineWidth = 2;
  tracePaper();
  g.stroke();

  // 급히 적은 손글씨처럼 줄마다 조금씩 다르게 기운다.
  g.fillStyle = "#2b2a33";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `600 44px ${FONT}`;
  NOTE_LINES.forEach(([text, tilt], i) => {
    g.save();
    g.translate(S / 2, top + 92 + i * 62);
    g.rotate(tilt);
    g.fillText(text, 0, 0);
    g.restore();
  });
  g.restore();

  cachedNoteImageUrl = canvas.toDataURL("image/png");
  return cachedNoteImageUrl;
}

// 바닥에 떨어진 실물이 없어 힌트함에서 버릴 수 없다.
const FIRST_HINT: Hint = {
  id: "tutorial:firstNote",
  name: "찢어진 쪽지",
  // 그림 글씨가 작게 보여도 읽히게 설명에도 문장을 적는다.
  description: `${FIRST_HINT_TEXT}\n\n누군가 급하게 찢어 남긴 쪽지. 복도 어딘가와 관계가 있을지도 모른다.`,
  isPhysical: false,
};

/** 튜토리얼이 끝나는 순간 부른다. 이미 넣었으면 아무 일도 안 한다. */
export function giveFirstHint() {
  const added = addHint({ ...FIRST_HINT, image: makeNoteImageUrl() });
  if (added) flashHints();
  return added;
}
