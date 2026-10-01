// 첫힌트.js — 튜토리얼을 마치면 힌트함에 넣어 주는 **찢어진 쪽지 한 장**
//
// [무엇] 튜토리얼 뒤 플레이어가 혼자 풀 자판기 퍼즐 쪽으로 슬쩍 등을 미는 한 줄.
//   풀이를 말하지 않고, 「캔음료」 한 단어에만 따옴표를 쳐서 눈길을 준다(사용자 지시 2026-10-01).
//     본부실 사람들은 커피와 "캔음료"를 무척 좋아해!
// [실물이 없다] 자판기 밸브 쪽지와 달리 바닥에 떨어진 종이가 없다. 그래서
//   힌트함에서 [E] 로 버릴 수 없다(실물: false — 힌트UI 가 본다).
// [그림] 힌트함 창은 「그림 한 장 + 한 줄 설명」이다. 캔버스에 찢어진 종이를 그려
//   PNG 로 넣는다. 한 번 그리면 다시 쓰지 않는다.

import { 힌트넣기, 힌트반짝 } from "../게임/힌트함.js";

export const 첫힌트문장 = '본부실 사람들은 커피와 "캔음료"를 무척 좋아해!';

let _그림 = null;
function 쪽지그림() {
  if (_그림) return _그림;
  if (typeof document === "undefined") return null;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");

  // ── 찢어진 종이 — 위·아래 가장자리를 들쭉날쭉하게, 살짝 기울여 ──
  //   씨앗을 고정해 매번 같은 모양이 나오게 한다(다시 열 때마다 바뀌면 이상하다).
  let 씨 = 7;
  const 난수 = () => {
    씨 = (씨 * 16807) % 2147483647;
    return (씨 - 1) / 2147483646;
  };
  const 왼 = 46, 오른 = S - 46, 위 = 120, 아래 = S - 120;
  const 점들 = [];
  for (let x = 왼; x <= 오른; x += 14) 점들.push([x, 위 + (난수() - 0.5) * 22]);
  점들.push([오른 + 4, 위 + 6], [오른 - 2, 아래 - 4]);
  for (let x = 오른; x >= 왼; x -= 14) 점들.push([x, 아래 + (난수() - 0.5) * 26]);
  점들.push([왼 - 3, 아래 - 6], [왼 + 2, 위 + 4]);

  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(-0.045);
  g.translate(-S / 2, -S / 2);
  const 그리기 = () => {
    g.beginPath();
    점들.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  // 그림자
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  g.fillStyle = "#efe6cf";
  그리기();
  g.fill();
  g.restore();
  // 종이 결 — 누렇게 바랜 얼룩 몇 군데
  g.save();
  그리기();
  g.clip();
  for (let i = 0; i < 6; i++) {
    const x = 왼 + 난수() * (오른 - 왼), y = 위 + 난수() * (아래 - 위);
    const r = 40 + 난수() * 70;
    const 결 = g.createRadialGradient(x, y, 0, x, y, r);
    결.addColorStop(0, "rgba(176,150,96,0.16)");
    결.addColorStop(1, "rgba(176,150,96,0)");
    g.fillStyle = 결;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 옅은 줄 노트 선
  g.strokeStyle = "rgba(120,140,170,0.22)";
  g.lineWidth = 2;
  for (let y = 위 + 52; y < 아래 - 10; y += 50) {
    g.beginPath();
    g.moveTo(왼 + 8, y);
    g.lineTo(오른 - 8, y);
    g.stroke();
  }
  g.restore();
  // 찢긴 가장자리 섬유 — 가는 밝은 테
  g.strokeStyle = "rgba(255,252,240,0.85)";
  g.lineWidth = 2;
  그리기();
  g.stroke();

  // ── 글씨 — 손으로 급히 적은 듯 줄마다 살짝 다르게 기운다 ──
  const F = "'Nanum Pen Script', 'Gaegu', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
  g.fillStyle = "#2b2a33";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const 줄들 = [
    ["본부실 사람들은", 0.015],
    ['커피와 "캔음료"를', -0.02],
    ["무척 좋아해!", 0.01],
  ];
  g.font = `600 44px ${F}`;
  줄들.forEach(([글, 기울기], i) => {
    g.save();
    g.translate(S / 2, 위 + 92 + i * 62);
    g.rotate(기울기);
    g.fillText(글, 0, 0);
    g.restore();
  });
  g.restore();

  _그림 = c.toDataURL("image/png");
  return _그림;
}

export const 첫힌트 = {
  id: "튜토리얼:첫쪽지",
  이름: "찢어진 쪽지",
  // 설명에도 문장을 그대로 적는다 — 그림 글씨가 작게 보일 때도 읽히게
  설명: `${첫힌트문장}\n\n누군가 급하게 찢어 남긴 쪽지. 복도 어딘가와 관계가 있을지도 모른다.`,
  실물: false,
};

/** 튜토리얼이 끝나는 순간 부른다. 이미 넣었으면 아무 일도 안 한다. */
export function 첫힌트주기() {
  const 들어감 = 힌트넣기({ ...첫힌트, 그림: 쪽지그림() });
  if (들어감) 힌트반짝(); // 왼쪽 위 힌트 표시가 반짝 — 「저기 들어갔다」
  return 들어감;
}
