import { addHint, flashHints, type Hint } from "@/game/hintBox";
import { showToast } from "@/game/toast";

// 튜토리얼 뒤 혼자 풀 퍼즐 쪽으로 등을 미는 쪽지 두 장. 풀이는 말하지 않고 따옴표로 눈길만 준다.
//   1) 튜토리얼이 끝나는 순간 — 분리수거 쪽(미르 플레이 시험 11/8: 「첫번째 잠금장치 이후 분리수거로 유도하는 장치가 필요」.
//      예전 첫 쪽지 「캔음료」는 분리수거를 건너뛰고 자판기 앞에서 헤매게 했다, 튜토피드백 검토 01회차)
//   2) 분리수거 → 창문 스위치로 자판기 구역에 불이 들어오는 순간(workLampState fullPower) — 예전 「캔음료」 쪽지
const RECYCLE_LINES: [text: string, tilt: number][] = [
  ["복도가 쓰레기로 엉망이야.", 0.015],
  ['"분리수거"부터', -0.02],
  ["해 두라고!", 0.01],
];
const VENDING_LINES: [text: string, tilt: number][] = [
  ["본부실 사람들은", 0.015],
  ['커피와 "캔음료"를', -0.02],
  ["무척 좋아해!", 0.01],
];
const linesText = (lines: [string, number][]) => lines.map(([text]) => text).join(" ");

const CANVAS_SIZE = 512;
const FONT = "'Nanum Pen Script', 'Gaegu', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

const cachedNoteImageUrls = new Map<string, string>();

/** 찢어진 쪽지를 캔버스에 그려 PNG data URL 로 돌려준다. 쪽지마다 한 번 그린 것을 계속 쓴다. */
function makeNoteImageUrl(key: string, noteLines: [string, number][], seedStart: number) {
  const cached = cachedNoteImageUrls.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const S = CANVAS_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  if (!g) return null;

  // 씨앗을 고정해 다시 열 때마다 같은 모양이 나오게 한다.
  let seed = seedStart;
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
  noteLines.forEach(([text, tilt], i) => {
    // 손글씨 글꼴이 없어 넓은 글꼴로 그려져도 종이 밖으로 안 나가게 줄마다 줄인다
    let size = 44;
    g.font = `600 ${size}px ${FONT}`;
    while (size > 24 && g.measureText(text).width > right - left - 28) {
      size -= 2;
      g.font = `600 ${size}px ${FONT}`;
    }
    g.save();
    g.translate(S / 2, top + 92 + i * 62);
    g.rotate(tilt);
    g.fillText(text, 0, 0);
    g.restore();
  });
  g.restore();

  const url = canvas.toDataURL("image/png");
  cachedNoteImageUrls.set(key, url);
  return url;
}

// 바닥에 떨어진 실물이 없어 힌트함에서 버릴 수 없다. 그림 글씨가 작게 보여도 읽히게 설명에도 문장을 적는다.
// 첫 쪽지 id 는 예전 그대로(이미 받은 저장본과 겹치지 않게 내용만 바뀐다)
const FIRST_HINT: Hint = {
  id: "tutorial:firstNote",
  name: "찢어진 쪽지",
  description: `${linesText(RECYCLE_LINES)}\n\n누군가 급하게 찢어 남긴 쪽지. 복도에 흩어진 쓰레기와 관계가 있을지도 모른다.`,
  isPhysical: false,
};
const VENDING_HINT: Hint = {
  id: "tutorial:vendingNote",
  name: "찢어진 쪽지 2",
  description: `${linesText(VENDING_LINES)}\n\n자판기 쪽에 불이 들어오자 어디선가 나타난 쪽지. 자판기와 관계가 있을지도 모른다.`,
  isPhysical: false,
};
/** 튜토리얼 공간에서 저절로 들어오는 쪽지 — 본부실에 들어서면 힌트함에서 지운다(tutorial/tutorialHints) */
export const TUTORIAL_NOTE_IDS: readonly string[] = [FIRST_HINT.id, VENDING_HINT.id];

/** 튜토리얼이 끝나는 순간 부른다(분리수거 쪽지). 이미 넣었으면 아무 일도 안 한다. */
export function giveFirstHint() {
  const added = addHint({ ...FIRST_HINT, image: makeNoteImageUrl(FIRST_HINT.id, RECYCLE_LINES, 7) });
  if (added) flashHints();
  return added;
}

// 첫 쪽지는 튜토리얼 완료 안내판이 「H 를 눌러 확인해 보자」고 말해 주지만 이 쪽지는 말해 주는 곳이 없었다 —
// 칩이 한 번 깜빡일 뿐이라 불이 켜지는 쪽으로 눈이 간 사이 지나가 「무지성 자판기 앞으로」 갔다(미르 11/9, 09회차).
// 「[H]」 꼴이라 터치에서는 [💡] 로 바뀐다(touchifyText — 「(H)」 꼴은 안 바뀐다)
const VENDING_HINT_TOAST = "힌트함에 새 쪽지가 생겼다 — [H]로 확인해 보자";

/** 자판기 구역에 완전 전원이 들어오는 순간 부른다(캔음료 쪽지). 이미 넣었으면 아무 일도 안 한다. */
export function giveVendingHint() {
  const added = addHint({ ...VENDING_HINT, image: makeNoteImageUrl(VENDING_HINT.id, VENDING_LINES, 11) });
  if (added) {
    flashHints();
    showToast(VENDING_HINT_TOAST, 6000, { emphasis: "hint" });
  }
  return added;
}
