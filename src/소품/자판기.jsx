// ═══════════════════════════════════════════════════════════════
//  자판기 — 음료(캔) · 커피(핫/아이스, 종이컵)
// ═══════════════════════════════════════════════════════════════
// [왜 GLB 가 아니라 코드인가]
//   ① 자판기는 통째로 직육면체다. 몸통·유리창·상품 칸·버튼·배출구가 전부
//      상자와 판이라, 모델로 뽑으면 폴리곤만 늘고 얻는 게 없다.
//   ② **퍼즐 도구라서 상태가 변해야 한다.** 핫/아이스가 눌리고, 불이 들어오고,
//      종이컵이 떨어지고, 계약(v0.3.1)의 `enabled` 에 따라 잠긴다.
//   ③ 화풍이 처음부터 맞는다(툰 재질·외곽선).
//
// [앞면은 로컬 +z 다]  복도 바깥벽에 붙이려면 회전 = Math.PI/2.
//
// [세로 3구역 구조]  두 자판기가 같은 골격을 쓴다. 위→아래로:
//   ┌ 간판(정체) ────────────
//   │ ① 디스플레이  ← 커피=포스터 그림 / 음료=유리창+캔(3줄×6)
//   │ ② 제어 스트립 ← 상품마다 '이름표 달린 작은 버튼'(커피 8개, 음료 6개)
//   │ ③ 하단 광고판 ← 실물 자판기의 하단 광고(브랜드 대신 오리지널 일러스트)
//   └ ④ 배출구 ─────────────
//
// [치수 감각] 1 유닛 ≈ 0.30m.

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import {
  TOON_GRADIENT,
  색밝기,
  상자합치기,
  만화선,
  단위상자,
  makeRandom,
} from "../공용.jsx";

// 한글이 들어가므로 CJK 폰트를 폰트 스택 앞에 둔다(브라우저에 있으면 사용).
const 폰트스택 = "'Noto Sans CJK KR', 'Malgun Gothic', system-ui, sans-serif";

// ── 간판 글자 판(큰 이름: COFFEE / COLD DRINKS) ───────────
function 글자텍스처(글, { 배경 = "#c8362e", 글자색 = "#fff6e2", 크기 = 96 } = {}) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = 배경;
  g.fillRect(0, 0, c.width, c.height);
  const 명암 = g.createLinearGradient(0, 0, 0, c.height);
  명암.addColorStop(0, "rgba(255,255,255,0.12)");
  명암.addColorStop(1, "rgba(0,0,0,0.24)");
  g.fillStyle = 명암;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 글자색;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const 여백 = 44;
  let 폰트 = 크기;
  do {
    g.font = `800 ${폰트}px ${폰트스택}`;
    if (g.measureText(글).width <= c.width - 여백) break;
    폰트 -= 4;
  } while (폰트 > 24);
  g.fillText(글, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 버튼 이름표(작은 라벨: 밀크커피 / 1 등) ────────────────
//   실물 자판기 버튼처럼 '무슨 상품인지' 글자가 박힌 작은 판.
//   둥근 배경 + 광택 + 자동 축소 글자.
function 버튼라벨텍스처(글, { 배경 = "#b23a2e", 글자색 = "#ffffff" } = {}) {
  const c = document.createElement("canvas");
  c.width = 224;
  c.height = 84;
  const g = c.getContext("2d");
  // 둥근 배경
  g.fillStyle = 배경;
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(2, 2, c.width - 4, c.height - 4, 14);
    g.fill();
  } else g.fillRect(0, 0, c.width, c.height);
  // 위 밝고 아래 어두운 광택 — 버튼이 볼록해 보이게
  const 광택 = g.createLinearGradient(0, 0, 0, c.height);
  광택.addColorStop(0, "rgba(255,255,255,0.28)");
  광택.addColorStop(0.5, "rgba(255,255,255,0)");
  광택.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = 광택;
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(2, 2, c.width - 4, c.height - 4, 14);
    g.fill();
  } else g.fillRect(0, 0, c.width, c.height);
  // 글자(넘치면 줄인다)
  g.fillStyle = 글자색;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let f = 46;
  do {
    g.font = `800 ${f}px ${폰트스택}`;
    if (g.measureText(글).width <= c.width - 26) break;
    f -= 2;
  } while (f > 16);
  g.fillText(글, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 하단 광고판 / 커피 포스터 그림(브랜드 대신 오리지널 일러스트) ──
function 포스터텍스처({ 종류, w = 360, h = 420 }) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");

  const 별 = (x, y, r, 색) => {
    g.fillStyle = 색;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  };

  if (종류 === "커피포스터" || 종류 === "커피광고") {
    const 광고 = 종류 === "커피광고";
    const bg = g.createLinearGradient(0, 0, 0, h);
    if (광고) {
      bg.addColorStop(0, "#e6ad44");
      bg.addColorStop(1, "#bd7a1c");
    } else {
      bg.addColorStop(0, "#4c3019");
      bg.addColorStop(1, "#21120a");
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * (광고 ? 0.42 : 0.46);
    const R = w * 0.2;
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath();
    g.ellipse(cx, cy + R * 1.05, R * 1.7, R * 0.42, 0, 0, 7);
    g.fill();
    g.strokeStyle = 광고 ? "#f0e6d5" : "#e7ddc9";
    g.lineWidth = R * 0.22;
    g.beginPath();
    g.arc(cx + R * 0.95, cy, R * 0.55, -1.1, 1.1);
    g.stroke();
    g.fillStyle = 광고 ? "#f4ecdd" : "#efe7d8";
    g.beginPath();
    g.moveTo(cx - R, cy - R * 0.55);
    g.lineTo(cx + R, cy - R * 0.55);
    g.lineTo(cx + R * 0.78, cy + R * 0.85);
    g.lineTo(cx - R * 0.78, cy + R * 0.85);
    g.closePath();
    g.fill();
    g.fillStyle = "#3a2212";
    g.beginPath();
    g.ellipse(cx, cy - R * 0.55, R * 0.98, R * 0.3, 0, 0, 7);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.beginPath();
    g.ellipse(cx - R * 0.3, cy - R * 0.62, R * 0.35, R * 0.1, 0, 0, 7);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = R * 0.11;
    g.lineCap = "round";
    for (const dx of [-R * 0.35, R * 0.35]) {
      g.beginPath();
      const sx = cx + dx;
      const sy = cy - R * 0.95;
      g.moveTo(sx, sy);
      g.bezierCurveTo(sx - R * 0.4, sy - R * 0.6, sx + R * 0.4, sy - R * 1.0, sx, sy - R * 1.7);
      g.stroke();
    }
    if (광고) {
      g.fillStyle = "#3d2410";
      for (const [bx, by] of [
        [w * 0.2, h * 0.8],
        [w * 0.78, h * 0.78],
      ]) {
        g.beginPath();
        g.ellipse(bx, by, R * 0.34, R * 0.22, 0.5, 0, 7);
        g.fill();
        g.strokeStyle = "#1f1207";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(bx - R * 0.24, by - R * 0.14);
        g.lineTo(bx + R * 0.24, by + R * 0.14);
        g.stroke();
      }
    }
    g.fillStyle = 광고 ? "#3a2412" : "#f0e6d5";
    g.textAlign = "center";
    g.font = `800 ${Math.round(w * 0.11)}px ${폰트스택}`;
    g.fillText(광고 ? "FRESH BREW" : "HOT COFFEE", cx, h * (광고 ? 0.93 : 0.86));
  } else {
    // 가로로 넓은 광고(패널 비율에 맞춤) — 왼쪽 캔 + 오른쪽 큰 'ICE COLD'
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#37b06a");
    bg.addColorStop(1, "#1c7d54");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    별(w * 0.07, h * 0.22, h * 0.09, "rgba(255,255,255,0.5)");
    별(w * 0.95, h * 0.18, h * 0.07, "rgba(255,255,255,0.4)");
    별(w * 0.9, h * 0.82, h * 0.08, "rgba(255,255,255,0.35)");
    // 캔(왼쪽) — 세로로 선 캔
    const ccx = w * 0.19;
    const cw = h * 0.36;
    const ch = h * 0.66;
    const ctop = h * 0.17;
    g.fillStyle = "#e9eef2";
    g.beginPath();
    g.roundRect
      ? g.roundRect(ccx - cw / 2, ctop, cw, ch, 12)
      : g.rect(ccx - cw / 2, ctop, cw, ch);
    g.fill();
    g.fillStyle = "#d64031";
    g.fillRect(ccx - cw / 2, ctop + ch * 0.36, cw, ch * 0.28); // 라벨 띠
    g.fillStyle = "#c7ced4";
    g.beginPath();
    g.ellipse(ccx, ctop, cw / 2, cw * 0.16, 0, 0, 7); // 뚜껑
    g.fill();
    // 물방울
    g.fillStyle = "rgba(255,255,255,0.6)";
    for (const [dx, dy, dr] of [
      [0.32, 0.34, 6],
      [0.34, 0.62, 5],
      [0.29, 0.8, 4],
    ]) {
      g.beginPath();
      g.arc(w * dx, h * dy, dr, 0, 7);
      g.fill();
    }
    // ICE COLD(오른쪽, 크게)
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${Math.round(h * 0.34)}px ${폰트스택}`;
    g.fillText("ICE COLD", w * 0.62, h * 0.52);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 봐도 라벨/글자가 안 뭉개진다
  return t;
}

// ── 바닥 배수구 그레이트 텍스처(동심원 + 방사선 = 물 빠지는 망) ──
function 배수텍스처() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#0e1013";
  g.fillRect(0, 0, 128, 128);
  const cx = 64, cy = 64;
  g.fillStyle = "#2a2e34";
  g.beginPath();
  g.arc(cx, cy, 60, 0, 7);
  g.fill();
  g.fillStyle = "#141619";
  g.beginPath();
  g.arc(cx, cy, 52, 0, 7);
  g.fill();
  g.strokeStyle = "#3c424a";
  g.lineWidth = 3;
  for (let r = 12; r <= 48; r += 9) {
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── 캔 라벨 — 실제 음료 캔처럼 '무늬가 있는' 옆면 텍스처 ────────
//   실제 브랜드(펩시·코카콜라·웰치스 등)는 상표라 못 쓴다. 대신 음료 종류를
//   나타내는 오리지널 디자인(스우시 + 거품 + 일반 명칭)을 직접 그린다.
//   원통 옆면에 감기므로 워드마크를 2번(1/4·3/4) 넣어 어느 방향에서도 보이게.
const 캔종류 = [
  { bg: "#1b4fb0", 글: "SODA", 글색: "#ffffff", 띠: "#eaf1fb", 점: "#9cc0f2" },
  { bg: "#2f9e52", 글: "CIDER", 글색: "#ffffff", 띠: "#eafff0", 점: "#bff0cf" },
  { bg: "#dfe6ec", 글: "MILK", 글색: "#2b6cb0", 띠: "#2b6cb0", 점: "#cfe0f2" },
  { bg: "#e39a24", 글: "ORANGE", 글색: "#ffffff", 띠: "#fff0d6", 점: "#ffd98a" },
  { bg: "#7a3ea0", 글: "GRAPE", 글색: "#ffffff", 띠: "#f0e0ff", 점: "#c79be6" },
  { bg: "#d23b32", 글: "COLA", 글색: "#ffffff", 띠: "#ffe3df", 점: "#f5a39c" },
];

function 캔라벨텍스처({ bg, 글, 글색, 띠, 점 }) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 220;
  const W = c.width;
  const H = c.height;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 대각 밝은 띠(스우시)
  g.globalAlpha = 0.9;
  g.fillStyle = 띠;
  g.beginPath();
  g.moveTo(0, H * 0.64);
  g.lineTo(W, H * 0.32);
  g.lineTo(W, H * 0.5);
  g.lineTo(0, H * 0.82);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  // 상·하 은색 테(캔 위·아래 금속 느낌)
  g.fillStyle = "#c9ccd0";
  g.fillRect(0, 0, W, 16);
  g.fillRect(0, H - 16, W, 16);
  // 거품 방울
  g.fillStyle = 점;
  g.globalAlpha = 0.55;
  for (const [px, py, pr] of [
    [0.12, 0.28, 14],
    [0.4, 0.2, 10],
    [0.62, 0.3, 12],
    [0.88, 0.24, 9],
  ]) {
    g.beginPath();
    g.arc(W * px, H * py, pr, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  // 워드마크 2회(1/4, 3/4) — 감겨도 한쪽은 정면에 보인다
  g.fillStyle = 글색;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const cx of [W * 0.25, W * 0.75]) {
    let f = 60;
    do {
      g.font = `800 ${f}px ${폰트스택}`;
      if (g.measureText(글).width <= W * 0.44) break;
      f -= 2;
    } while (f > 18);
    g.fillText(글, cx, H * 0.54);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 툰 재질 한 줄로 쓰기
const 툰 = (색) => <meshToonMaterial color={색} gradientMap={TOON_GRADIENT} />;

// ═══════════════════════════════════════════════════════════════
//  공통 몸통 — 두 자판기가 같은 껍데기를 쓴다(드로우콜 1)
// ═══════════════════════════════════════════════════════════════
function 몸통지오({ 폭, 높이, 깊이, 테 }) {
  const 반깊 = 깊이 / 2;
  return 상자합치기([
    { 크기: [폭, 높이, 0.18], 위치: [0, 높이 / 2, -반깊 + 0.09] }, // 뒤판
    { 크기: [0.2, 높이, 깊이], 위치: [-폭 / 2 + 0.1, 높이 / 2, 0] }, // 좌
    { 크기: [0.2, 높이, 깊이], 위치: [폭 / 2 - 0.1, 높이 / 2, 0] }, // 우
    { 크기: [폭, 0.22, 깊이], 위치: [0, 높이 - 0.11, 0] }, // 위
    { 크기: [폭, 0.3, 깊이], 위치: [0, 0.15, 0] }, // 아래
    { 크기: [폭, 테, 0.16], 위치: [0, 높이 - 테 / 2, 반깊 - 0.08] },
    { 크기: [테, 높이, 0.16], 위치: [-폭 / 2 + 테 / 2, 높이 / 2, 반깊 - 0.08] },
    { 크기: [테, 높이, 0.16], 위치: [폭 / 2 - 테 / 2, 높이 / 2, 반깊 - 0.08] },
    { 크기: [폭, 테, 0.16], 위치: [0, 테 / 2, 반깊 - 0.08] },
  ]);
}

// 배출구 — 우묵하게 파인 구멍. 안쪽을 어둡게 해야 '뚫린 곳'으로 읽힌다
function 배출구({ y, 폭, 깊이, 높이 = 1.1, 안색 = "#15171b", 덮개색, 선 }) {
  const 반깊 = 깊이 / 2;
  const 안 = useMemo(
    () =>
      상자합치기([
        { 크기: [폭, 0.12, 1.2], 위치: [0, -높이 / 2, 반깊 - 0.7] },
        { 크기: [폭, 높이, 0.12], 위치: [0, 0, 반깊 - 1.25] },
        { 크기: [0.12, 높이, 1.2], 위치: [-폭 / 2, 0, 반깊 - 0.7] },
        { 크기: [0.12, 높이, 1.2], 위치: [폭 / 2, 0, 반깊 - 0.7] },
      ]),
    [폭, 깊이, 높이, 반깊],
  );
  useEffect(() => () => 안?.dispose(), [안]);
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={안}>{툰(안색)}</mesh>
      <mesh position={[0, 0.16, 반깊 - 0.16]} rotation={[-0.28, 0, 0]} castShadow>
        <boxGeometry args={[폭 - 0.1, 높이 * 0.8, 0.1]} />
        {툰(덮개색)}
        <만화선 geo={단위상자} 선={선} />
      </mesh>
    </group>
  );
}

// 결제부 — 지폐 투입구 · 동전 투입구 · 동전 반환구. 높이/z 위치 조절 가능.
//
// [왜 구멍을 '진짜로' 뚫었나]
//   전에는 앞판이 통짜 상자였고, 그 위에 어두운 상자를 얹어 투입구를 흉내 냈다.
//   가까이서 보면 **판에 붙인 검은 스티커**로 보인다 — 깊이가 없으니까.
//   그래서 앞판을 '구멍 자리만 비운 조각들의 합'으로 만들고, 그 뒤에 어두운
//   굴을 넣었다. 구멍 테두리(앞판 두께)와 안쪽 어둠이 같이 보여야 뚫린 것으로
//   읽힌다 — 위 배출구가 쓰는 방식과 같다.
//
// [앞판을 왜 이렇게 얇게(0.035) 두나]
//   굴의 앞면이 **뒤에 있는 판보다 앞**에 있어야 구멍으로 어둠이 보인다.
//   커피 자판기는 제어 스트립 판이 반깊−0.04 에 있어서, 앞판이 그보다 두꺼우면
//   구멍 안에 스트립 색이 그대로 비친다. 그래서 0.035 가 상한이다.
//   대신 반환구는 둘레에 테를 앞으로 세워 깊이를 더 벌었다(아래 반환테).
function 결제부({
  y,
  x,
  // ★ 기본값 0 이 아니라 0.04 다.
  //   굴(어두운 안쪽)의 앞면이 **뒤에 있는 판보다 앞**에 있어야 구멍이 어둡게 보인다.
  //   커피 자판기는 제어 스트립 판이 반깊−0.04 에 있어서, 판을 앞으로 안 빼면
  //   둘 사이가 0.005 밖에 안 뜬다 — 그 정도면 멀리서 볼 때 깊이값이 서로 엎치락뒤치락해
  //   구멍 안에 스트립 색이 깜빡인다(z-fighting). 0.04 만 빼도 넉넉해진다.
  z = 0.04,
  깊이,
  색,
  어두운색,
  안색 = "#0c0e11", // 구멍 안쪽 — 빛이 안 드는 어둠
  높이 = 1.3,
  선,
}) {
  const 반깊 = 깊이 / 2;
  const s = 높이 / 1.3; // 기준 높이(1.3) 대비 축소 비율
  const 판폭 = 0.46;
  const 판깊 = 0.14; // 판 전체 두께 — 예전과 같다(겉모습이 안 바뀐다)
  const 앞두께 = 0.035; // 이만큼이 구멍의 테두리 = 파여 보이는 깊이
  const 굴깊 = 판깊 - 앞두께; // 나머지는 전부 어두운 속 — 두께 합이 예전과 같아진다

  // 구멍 셋. 전부 가로 가운데(x=0)라 판을 **가로 띠로 잘라** 만들 수 있다.
  //   크기는 예전 값 그대로다 — 맞춰 둔 겉모습을 건드리지 않으려고.
  const 구멍들 = useMemo(() => {
    const 한계 = 높이 / 2 - 0.03; // 판 밖으로 나가면 안 된다(높이를 줄일 수 있으므로)
    return [
      { 이름: "반환", y: -0.42 * s, w: 0.28, h: 0.16 },
      { 이름: "동전", y: 0.05 * s, w: 0.07, h: 0.3 * s },
      { 이름: "지폐", y: 0.42 * s, w: 0.32, h: 0.08 },
    ]
      .filter((g) => Math.abs(g.y) + g.h / 2 <= 한계 && g.w < 판폭 - 0.04)
      .sort((a, b) => a.y - b.y);
  }, [s, 높이]);

  // ── 앞판 — 구멍 자리를 비운 조각들의 합 ──
  //   띠 경계: [맨아래, 구멍1아래, 구멍1위, 구멍2아래, …, 맨위]
  //   짝수 칸 = 막힌 띠(가로 전체), 홀수 칸 = 구멍 띠(양옆만 남긴다).
  const 앞판 = useMemo(() => {
    const 경계 = [-높이 / 2];
    for (const g of 구멍들) 경계.push(g.y - g.h / 2, g.y + g.h / 2);
    경계.push(높이 / 2);
    const zc = 반깊 - 앞두께 / 2; // 앞면이 정확히 반깊에 오게
    const 것 = [];
    for (let i = 0; i < 경계.length - 1; i++) {
      const h = 경계[i + 1] - 경계[i];
      if (h <= 1e-4) continue;
      const yc = (경계[i] + 경계[i + 1]) / 2;
      if (i % 2 === 0) {
        것.push({ 크기: [판폭, h, 앞두께], 위치: [0, yc, zc] });
      } else {
        const g = 구멍들[(i - 1) / 2];
        const 옆 = (판폭 - g.w) / 2;
        것.push({ 크기: [옆, h, 앞두께], 위치: [-(판폭 - 옆) / 2, yc, zc] });
        것.push({ 크기: [옆, h, 앞두께], 위치: [(판폭 - 옆) / 2, yc, zc] });
      }
    }
    return 상자합치기(것);
  }, [구멍들, 높이, 반깊]);

  // ── 굴 — 구멍 뒤의 어두운 공간. 뒤에 있는 광고판·스트립을 덮어 가린다 ──
  const 굴 = useMemo(
    () =>
      상자합치기([
        {
          크기: [판폭, 높이, 굴깊],
          위치: [0, 0, 반깊 - 앞두께 - 굴깊 / 2],
        },
      ]),
    [높이, 반깊, 굴깊],
  );

  // ── 반환테 — 반환구 둘레에 앞으로 세운 테 ──
  //   앞판만으로는 0.035 밖에 안 파인다. 테를 앞으로 세우면 그만큼 더 깊어져
  //   '손을 넣어 동전을 집는 자리'로 읽힌다. 아랫변은 트레이 턱 노릇을 한다.
  const 반환 = 구멍들.find((g) => g.이름 === "반환");
  const 반환테 = useMemo(() => {
    if (!반환) return null;
    const 테 = 0.05;
    const 튀 = 0.04;
    const zc = 반깊 + 튀 / 2;
    const W = 반환.w + 테 * 2;
    return 상자합치기([
      { 크기: [W, 테, 튀], 위치: [0, 반환.y + 반환.h / 2 + 테 / 2, zc] },
      { 크기: [W, 테, 튀], 위치: [0, 반환.y - 반환.h / 2 - 테 / 2, zc] },
      { 크기: [테, 반환.h, 튀], 위치: [-반환.w / 2 - 테 / 2, 반환.y, zc] },
      { 크기: [테, 반환.h, 튀], 위치: [반환.w / 2 + 테 / 2, 반환.y, zc] },
    ]);
  }, [반환, 반깊]);

  useEffect(() => {
    return () => {
      앞판?.dispose();
      굴?.dispose();
      반환테?.dispose();
    };
  }, [앞판, 굴, 반환테]);

  // 주름선은 끈다 — 조각들을 이어 붙인 판이라 이음매마다 줄이 그어진다.
  //   외곽선만으로도 구멍 둘레가 그려진다(외곽선은 면을 법선 쪽으로 밀어내는
  //   방식이라, 안쪽을 향한 구멍 벽도 같이 테가 진다).
  const 판선 = 선 ? { ...선, 주름선: false } : 선;

  return (
    <group position={[x, y, z]}>
      <mesh geometry={굴}>{툰(안색)}</mesh>
      <mesh geometry={앞판} castShadow>
        {툰(색)}
        <만화선 geo={앞판} 선={판선} />
      </mesh>
      {반환테 && (
        <mesh geometry={반환테} castShadow>
          {툰(어두운색)}
          <만화선 geo={반환테} 선={판선} />
        </mesh>
      )}
    </group>
  );
}

// ── 커피 종이컵 배출부 — 가운데에 '파인 공간' ──────────────
//   실물 커피 자판기처럼: 위 노즐 → 컵받침틀 → (컵) → 바닥 배수구,
//   그리고 앞을 덮는 투명 칸막이(먼지·벌레 막고 여닫는 문).
//   벽에 실제로 파인 게 아니라, 앞으로 열린 어두운 상자(안)로 '파임'을 만든다.
function 커피배출부({
  y,
  zf,
  폭 = 1.9,
  높이 = 1.2,
  깊이 = 0.9,
  겉폭 = 2.84,
  겉높 = 1.35,
  벽색 = "#14161a",
  프레임색 = "#43301f",
  겉색 = "#5a3e2b",
  유리색 = "#cfe0e6",
  컵색 = "#efe7d8",
  커피색 = "#4a2c17",
  컵있음 = false,
  문열림 = 0, // 0=닫힘, 1=활짝. 당기면 열리고 놓으면 닫히는 문의 열림량.
  선,
}) {
  // 안쪽(파인 공간) — 앞이 뚫린 어두운 상자
  const 안 = useMemo(
    () =>
      상자합치기([
        { 크기: [폭, 높이, 0.1], 위치: [0, 0, -깊이] }, // 뒷벽
        { 크기: [폭, 0.1, 깊이], 위치: [0, 높이 / 2, -깊이 / 2] }, // 위
        { 크기: [폭, 0.1, 깊이], 위치: [0, -높이 / 2, -깊이 / 2] }, // 아래
        { 크기: [0.1, 높이, 깊이], 위치: [-폭 / 2, 0, -깊이 / 2] }, // 좌
        { 크기: [0.1, 높이, 깊이], 위치: [폭 / 2, 0, -깊이 / 2] }, // 우
      ]),
    [폭, 높이, 깊이],
  );
  // 개구부 둘레(몸통면) — 파인 공간 바깥을 몸통색으로 메운다
  const 여상 = (겉높 - 높이) / 2;
  const 여좌 = (겉폭 - 폭) / 2;
  const 겉 = useMemo(
    () =>
      상자합치기([
        { 크기: [겉폭, Math.max(0.02, 여상), 0.09], 위치: [0, 높이 / 2 + 여상 / 2, -0.02] },
        { 크기: [겉폭, Math.max(0.02, 여상), 0.09], 위치: [0, -높이 / 2 - 여상 / 2, -0.02] },
        { 크기: [Math.max(0.02, 여좌), 높이, 0.09], 위치: [-폭 / 2 - 여좌 / 2, 0, -0.02] },
        { 크기: [Math.max(0.02, 여좌), 높이, 0.09], 위치: [폭 / 2 + 여좌 / 2, 0, -0.02] },
      ]),
    [겉폭, 겉높, 폭, 높이, 여상, 여좌],
  );
  const 배수텍 = useMemo(() => 배수텍스처(), []);
  useEffect(
    () => () => {
      안?.dispose();
      겉?.dispose();
      배수텍?.dispose();
    },
    [안, 겉, 배수텍],
  );

  const 컵y = -높이 / 2 + 0.4;
  const zc = -깊이 * 0.5;
  return (
    <group position={[0, y, zf]}>
      <mesh geometry={겉}>{툰(겉색)}</mesh>
      <mesh geometry={안}>{툰(벽색)}</mesh>
      {/* 안쪽 은은한 조명 — 파인 공간은 그늘져 새까매지므로 따뜻하게 살짝 밝힌다.
             (실물 자판기 배출구엔 안쪽 등이 있다) toneMapped=false 라 어둠에서도 죽지 않는다. */}
      <mesh position={[0, 0, -깊이 + 0.06]}>
        <planeGeometry args={[폭 - 0.24, 높이 - 0.24]} />
        <meshBasicMaterial color="#241c14" toneMapped={false} />
      </mesh>

      {/* 노즐(위) — 하우징 + 주둥이. 자체발광 금속이라 어둠에서도 보인다 */}
      <mesh position={[0, 높이 / 2 - 0.16, -깊이 * 0.5]} castShadow>
        <boxGeometry args={[0.44, 0.2, 0.3]} />
        <meshBasicMaterial color="#5f656d" toneMapped={false} />
        <만화선 geo={단위상자} 선={선} />
      </mesh>
      <mesh position={[0, 높이 / 2 - 0.38, -깊이 * 0.5]}>
        <cylinderGeometry args={[0.05, 0.06, 0.24, 10]} />
        <meshBasicMaterial color="#20242a" toneMapped={false} />
      </mesh>

      {/* ── 컵 배출 구조물(검정) — 받침·벽이 하나로 이어진 요람.
             양옆·뒤만 감싸는 원형 벽(앞 +z 는 열려 손이 들어간다) + 밑에 붙은 얇은 배수 받침. */}
      {(() => {
        const R = Math.min(0.32, 폭 / 2 - 0.16); // 컵 요람 반지름(칸 폭에 맞춤)
        const 바닥y = -높이 / 2 + 0.1; // 요람 바닥(칸 밑바닥)
        const 벽h = Math.min(0.66, 높이 - 0.5); // 뒤·옆 벽 높이
        const 검 = "#2a2d34"; // 블랙(툰 셰이딩으로 곡면 입체감이 살아난다)
        return (
          <group position={[0, 바닥y, zc]}>
            {/* 얇은 원형 배수 받침(평평) */}
            <mesh position={[0, 0.03, 0]} castShadow>
              <cylinderGeometry args={[R, R, 0.05, 30]} />
              <meshToonMaterial color={검} gradientMap={TOON_GRADIENT} />
            </mesh>
            {/* 배수 그레이트(윗면 — 평평·깔끔, 안 비스듬). 자체발광이라 무늬가 보인다 */}
            <mesh position={[0, 0.056, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[R - 0.03, 28]} />
              <meshBasicMaterial map={배수텍} toneMapped={false} />
            </mesh>
            {/* 뒤+양옆 원형 벽 — 앞(+z)만 열림. 받침과 한 몸(하나의 구조물). */}
            <mesh position={[0, 0.05 + 벽h / 2, 0]} castShadow>
              <cylinderGeometry args={[R, R, 벽h, 30, 1, true, 1.05, Math.PI * 2 - 2.1]} />
              <meshToonMaterial
                color={검}
                gradientMap={TOON_GRADIENT}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })()}

      {/* 종이컵 — 컵있음일 때 요람 안에. 자체발광 크림색이라 또렷하다 */}
      {컵있음 && (
        <group position={[0, -높이 / 2 + 0.46, zc]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.27, 0.185, 0.54, 18, 1, true]} />
            <meshBasicMaterial color={컵색} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.24, 18]} />
            <meshBasicMaterial color={커피색} toneMapped={false} />
          </mesh>
        </group>
      )}

      {/* 투명 칸막이(플랩) — 빈 칸에 딱 맞는 반투명 문.
             천장에 경첩 → 당기면 아래가 앞으로 열리고, 놓으면 닫힌다(문열림 0=닫힘).
             손잡이는 왼쪽에 작게. */}
      {(() => {
        const fw = 폭 - 0.08; // 개구부에 꽉 맞게
        const fh = 높이 - 0.08;
        const 경첩y = 높이 / 2 - 0.04;
        const 바 = [
          [0, fh / 2, fw + 0.04, 0.05],
          [0, -fh / 2, fw + 0.04, 0.05],
          [-fw / 2, 0, 0.05, fh],
          [fw / 2, 0, 0.05, fh],
        ];
        return (
          <group position={[0, 경첩y, 0.06]} rotation={[-문열림 * 0.55, 0, 0]}>
            <group position={[0, -fh / 2 - 0.02, 0]}>
              {/* 유리 */}
              <mesh>
                <planeGeometry args={[fw, fh]} />
                <meshBasicMaterial
                  color={유리색}
                  transparent
                  opacity={0.12}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
              {/* 금속 테 4변 */}
              {바.map(([bx, by, bw, bh], i) => (
                <mesh key={`fr${i}`} position={[bx, by, 0]} castShadow>
                  <boxGeometry args={[bw, bh, 0.05]} />
                  {툰(프레임색)}
                </mesh>
              ))}
              {/* 손잡이 — 왼쪽에 작게 */}
              <mesh position={[-fw / 2 + 0.1, 0, 0.05]} castShadow>
                <boxGeometry args={[0.11, 0.2, 0.06]} />
                {툰(프레임색)}
                <만화선 geo={단위상자} 선={선} />
              </mesh>
            </group>
          </group>
        );
      })()}
    </group>
  );
}

// ── 이름표 달린 작은 상품 버튼 ─────────────────────────────
//   '상품마다 개별 버튼'을 위해 재사용한다. 얇은 프레임 + 이름표.
//   켜짐=true 면 이름표가 밝아진다(고른 온도/상품에 불이 들어온 것처럼).
function 상품버튼({
  x,
  y,
  z,
  폭 = 0.52,
  높이 = 0.2,
  라벨텍,
  프레임색 = "#3a4652",
  얼굴색 = "#c9d0d8",
  켜짐 = false,
  밝기 = 1,
  선,
}) {
  const 얼굴밝기 = 밝기 * (켜짐 ? 1.55 : 0.9);
  return (
    <group position={[x, y, z]}>
      {/* 프레임(테) */}
      <mesh castShadow>
        <boxGeometry args={[폭 + 0.04, 높이 + 0.04, 0.07]} />
        {툰(색밝기(프레임색, 밝기))}
        <만화선 geo={단위상자} 선={선} />
      </mesh>
      {/* 얼굴 — 이름표가 있으면 라벨, 없으면 단색 */}
      {라벨텍 ? (
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[폭, 높이]} />
          <meshBasicMaterial
            map={라벨텍}
            toneMapped={false}
            color={new THREE.Color(얼굴밝기, 얼굴밝기, 얼굴밝기)}
          />
        </mesh>
      ) : (
        // 라벨 없는 색 버튼(음료 6색) — 자체발광이라 어둠에서도 색이 또렷하다
        <mesh position={[0, 0, 0.05]}>
          <boxGeometry args={[폭, 높이, 0.03]} />
          <meshBasicMaterial
            color={색밝기(얼굴색, 켜짐 ? 1 : Math.min(1, 0.62 + 밝기 * 0.45))}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ① 음료(캔) 자판기 — 3줄 × 6칸 = 18 캔
// ═══════════════════════════════════════════════════════════════
export function 캔자판기({
  위치 = [0, 0, 0],
  회전 = 0,
  폭 = 3.4,
  높이 = 7.4,
  깊이 = 2.4,
  몸통색 = "#2f4a63",
  테색 = "#26384a",
  간판색 = "#c8362e",
  간판글 = "COLD DRINKS",
  간판글자색 = "#fff6e2",
  유리색 = "#8fb6cc",
  선반색 = "#3a4652",
  버튼틀색 = "#454e59",
  패널색 = "#20272e",
  어두운색 = "#15171b",
  밝기 = 1,
  열수 = 6, // ← 한 줄 6칸
  단수 = 3, // ← 3줄
  뽑힌캔 = null, // 배출구에 나온 캔(0~5 = 음료 종류, null = 없음)
  선,
  내부선, // 내부(캔·버튼·배출구) 전용 외곽선 — 없으면 몸통 선을 쓴다
  children,
  ...rest
}) {
  const 밝 = (c) => 색밝기(c, 밝기);
  const 내부 = 내부선 ?? 선; // 내부 부품 외곽선
  const 반깊 = 깊이 / 2;
  const 테 = 0.28;
  const zf = 반깊 - 0.02;

  const 몸통 = useMemo(() => 몸통지오({ 폭, 높이, 깊이, 테 }), [폭, 높이, 깊이]);

  // ── 세로 구역 ── 아래에서 위로: 바닥 → 배출구 → 광고 → 버튼줄 → 유리창 → 간판
  const 천 = 높이 - 테 - 0.78;
  const 바닥 = 테 + 0.15;

  // ★ 아래 묶음(배출구·광고·버튼줄)을 통째로 끌어올렸다.
  //   버튼·광고·결제부가 너무 낮게 깔려 있었고, 그만큼 캔 줄도 아래로 눌려 있었다.
  //   배출구 구역을 키우면 **그 위 세 줄이 한꺼번에** 올라간다 —
  //   실제 자판기도 꺼내는 문이 제일 크고 제일 낮다.
  const 배출높0 = 1.35; // 예전 0.85
  const 광고높0 = 0.9;
  const 제어높0 = 0.55;

  // 창(캔 줄) 몫을 **먼저** 떼어 놓는다.
  //   Leva 로 자판기 높이를 줄이면(최소 4) 아래 묶음이 창을 밀어내 줄이 겹친다.
  //   그래서 창 몫을 먼저 확보하고, 남는 만큼만 아래 묶음이 나눠 갖는다.
  //   ※ 창에 무조건 몰아주지는 않는다. 아주 낮게 줄이면 버튼·광고가 실오라기만
  //     남아 더 이상해진다. 그래서 '속 높이의 35% 는 아래 묶음 몫'을 바닥선으로 두고,
  //     둘 중 큰 쪽을 준다. 기본 높이(7.4)에서는 어차피 여유가 남아 값이 안 바뀐다.
  const 속높 = 천 - 바닥;
  const 창최소 = 단수 * 0.75;
  const 아래여유 = Math.max(0, Math.max(속높 * 0.35, 속높 - 창최소));
  const 줄임 = Math.min(1, 아래여유 / (배출높0 + 광고높0 + 제어높0));
  const 배출높 = 배출높0 * 줄임;
  const 광고높 = 광고높0 * 줄임;
  const 제어높 = 제어높0 * 줄임;

  const 광고하 = 바닥 + 배출높;
  const 광고상 = 광고하 + 광고높;
  const 제어상 = 광고상 + 제어높;
  const 창하 = 제어상; // 유리창(캔) 아래 = 버튼줄 위
  const 창상 = 천;
  const 창높 = Math.max(0.3, 창상 - 창하);
  const 창폭 = 폭 - 테 * 2;
  const 밴드 = 창높 / 단수; // 캔 한 줄이 차지하는 세로 폭

  // ── 한 줄의 속 ── 아래에서 위로: 틈 → 선반 → 캔 → 머리 여유
  //   ★ 캔은 **선반 윗면에 앉는다.** 전에는 캔을 '줄 한가운데'에 놓고 선반은
  //     '줄 아래쪽'에 따로 놓아서, 둘이 무관하게 계산됐다 → 캔이 선반 위로
  //     0.15 만큼 붕 떠 있었다. 이제 선반 윗면 하나에서 둘 다 뽑는다.
  const 아래틈 = 0.1;
  const 선반두께 = 0.08;
  const 머리여유 = 0.08; // 캔 위에 최소한 이만큼은 남긴다
  const 캔높 = Math.max(
    0.14,
    Math.min(0.62, 밴드 - 아래틈 - 선반두께 - 머리여유),
  ); // 슬림 캔 비율(0.62)이 기본, 줄이 좁아지면 캔도 같이 줄어 안 겹친다
  const 캔반지름 = Math.min(0.19, (창폭 / 열수) * 0.36, 캔높 * 0.31);
  const 선반윗면 = 창하 + 아래틈 + 선반두께; // 0번 줄 기준. 줄마다 밴드씩 더한다

  // 캔 라벨 텍스처 6종(오리지널 음료 디자인)
  const 라벨텍들 = useMemo(() => 캔종류.map((t) => 캔라벨텍스처(t)), []);

  // 선반 — 단마다 한 장. 캔이 앉는 '윗면'을 기준으로 잡는다.
  const 선반 = useMemo(() => {
    const 것 = [];
    for (let s = 0; s < 단수; s++) {
      const 윗면 = 선반윗면 + 밴드 * s;
      것.push({
        크기: [창폭 - 0.1, 선반두께, 1.0],
        위치: [0, 윗면 - 선반두께 / 2, -0.15],
      });
    }
    return 상자합치기(것);
  }, [단수, 선반윗면, 선반두께, 밴드, 창폭]);

  // 캔 — 열 × 단. 줄마다 밴드 가운데. 음료 종류는 여기저기 뒤섞는다(일자 나열 X).
  const 캔들 = useMemo(() => {
    const rnd = makeRandom(20260909);
    const 것 = [];
    for (let s = 0; s < 단수; s++) {
      for (let i = 0; i < 열수; i++) {
        const x = -창폭 / 2 + (창폭 / 열수) * (i + 0.5);
        // 선반 윗면 + 캔 반높이 = 캔이 판자에 정확히 닿는 자리
        const y = 선반윗면 + 밴드 * s + 캔높 / 2;
        것.push({ x, y, 타입: Math.floor(rnd() * 캔종류.length) });
      }
    }
    return 것;
  }, [열수, 단수, 창폭, 선반윗면, 밴드, 캔높]);

  // 버튼 x — 캔 열 위치에 맞춰 가로로 고르게
  const 버튼x = (i) => -창폭 / 2 + (창폭 / 열수) * (i + 0.5);
  // 버튼 6색 — 빨강·주황·초록·파랑·보라·흰색
  const 버튼색들 = ["#d23b32", "#e39a24", "#2f9e52", "#1b4fb0", "#7a3ea0", "#e8ecf0"];
  const 캔v = Math.min(1, 0.5 + 밝기 * 0.55);

  const 간판텍 = useMemo(
    () => 글자텍스처(간판글, { 배경: 간판색, 글자색: 간판글자색 }),
    [간판글, 간판색, 간판글자색],
  );
  const 광고텍 = useMemo(
    () => 포스터텍스처({ 종류: "음료광고", w: 760, h: 240 }),
    [],
  );

  useEffect(
    () => () => {
      몸통?.dispose();
      선반?.dispose();
      간판텍?.dispose();
      광고텍?.dispose();
      라벨텍들.forEach((t) => t?.dispose());
    },
    [몸통, 선반, 간판텍, 광고텍, 라벨텍들],
  );
  const 광고v = Math.min(1, 0.45 + 밝기 * 0.55);

  // 배출구 — 구역 한가운데에 문을 내고, 그 안 바닥 높이를 따로 들고 있는다.
  //   뽑힌 캔이 이 바닥에 앉아야 한다(구역을 키웠는데 캔만 그대로면 공중에 뜬다).
  const 배출중 = 바닥 + 배출높 / 2;
  const 배출문높 = 배출높 * 0.82; // 구역보다 클 수 없다 → 광고판을 못 침범한다
  const 배출바닥 = 배출중 - 배출문높 / 2 + 0.06; // 안쪽 바닥판(두께 0.12) 윗면

  return (
    <group name="자판기-캔" position={위치} rotation={[0, 회전, 0]} {...rest}>
      <mesh geometry={몸통} castShadow receiveShadow>
        {툰(밝(몸통색))}
        <만화선 geo={몸통} 선={선} />
      </mesh>

      {/* 상단 간판 */}
      <mesh position={[0, 높이 - 테 - 0.4, zf]}>
        <planeGeometry args={[폭 - 테 * 2, 0.72]} />
        <meshBasicMaterial map={간판텍} toneMapped={false} />
      </mesh>

      {/* ① 유리창 + 캔 3줄×6 */}
      <mesh position={[0, 창하 + 창높 / 2, zf - 0.03]}>
        <planeGeometry args={[창폭, 창높]} />
        <meshBasicMaterial
          color={밝(유리색)}
          transparent
          opacity={0.16}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 창하 + 창높 / 2, -반깊 + 0.2]}>
        <planeGeometry args={[창폭, 창높]} />
        {툰(밝(어두운색))}
      </mesh>
      <mesh geometry={선반} castShadow>
        {툰(밝(선반색))}
      </mesh>
      {캔들.map((c, i) => (
        <mesh key={`can${i}`} position={[c.x, c.y, -0.15]} castShadow>
          <cylinderGeometry args={[캔반지름, 캔반지름, 캔높, 16]} />
          {/* 옆면=음료 라벨, 위=은색 뚜껑, 아래=어두운 바닥 */}
          <meshBasicMaterial
            attach="material-0"
            map={라벨텍들[c.타입]}
            toneMapped={false}
            color={new THREE.Color(캔v, 캔v, 캔v)}
          />
          <meshBasicMaterial
            attach="material-1"
            color={new THREE.Color(0.7 * 캔v, 0.72 * 캔v, 0.75 * 캔v)}
            toneMapped={false}
          />
          <meshBasicMaterial
            attach="material-2"
            color={new THREE.Color(0.22 * 캔v, 0.23 * 캔v, 0.26 * 캔v)}
            toneMapped={false}
          />
          {/* 우리 화풍에 맞는 외곽선 */}
          <만화선 선={내부} />
        </mesh>
      ))}

      {/* ② 버튼 줄 — 캔 열마다 하나, 6색(빨·주·초·파·보·흰). 누르면 그 캔이 나온다. */}
      <mesh position={[0, 광고상 + 제어높 / 2, zf - 0.02]}>
        <planeGeometry args={[창폭, 제어높]} />
        {툰(밝(패널색))}
      </mesh>
      {Array.from({ length: 열수 }, (_, i) => (
        <상품버튼
          key={`btn${i}`}
          x={버튼x(i)}
          y={광고상 + 제어높 * 0.5}
          z={zf}
          폭={(창폭 / 열수) * 0.5}
          높이={0.2}
          프레임색={버튼틀색}
          얼굴색={버튼색들[i % 버튼색들.length]}
          밝기={밝기}
          선={내부}
        />
      ))}

      {/* ③ 하단 광고판 */}
      <mesh position={[0, 광고하 + 광고높 / 2, zf]}>
        <planeGeometry args={[폭 - 테 * 2, 광고높]} />
        <meshBasicMaterial
          map={광고텍}
          toneMapped={false}
          color={new THREE.Color(광고v, 광고v, 광고v)}
        />
      </mesh>
      {/* 결제부 — 광고 라인 오른쪽으로 내렸다(광고 앞으로, 높이도 광고에 맞춤) */}
      <결제부
        y={광고하 + 광고높 * 0.5}
        x={폭 / 2 - 0.5}
        z={0.05}
        깊이={깊이}
        높이={광고높 * 0.9}
        색={밝(테색)}
        어두운색={밝(어두운색)}
        선={내부}
      />

      {/* ④ 배출구 — 구역이 커진 만큼 꺼내는 문도 같이 커진다.
             (구역만 키우고 문을 그대로 두면 아래가 휑한 회색 띠로 남는다) */}
      <배출구
        y={배출중}
        폭={폭 - 테 * 2 - 0.8}
        높이={배출문높}
        깊이={깊이}
        안색={밝(어두운색)}
        덮개색={밝(테색)}
        선={내부}
      />

      {/* ★ 뽑힌 캔 — 버튼을 누르면 그 음료 캔이 배출구로 나온다(같은 라벨).
             배출구 입구에 세워 놓아 보이게 한다. */}
      {뽑힌캔 != null && 뽑힌캔 >= 0 && (
        <mesh position={[0, 배출바닥 + 캔높 / 2, 반깊 - 0.34]} castShadow>
          <cylinderGeometry args={[캔반지름, 캔반지름, 캔높, 16]} />
          <meshBasicMaterial
            attach="material-0"
            map={라벨텍들[뽑힌캔 % 캔종류.length]}
            toneMapped={false}
            color={new THREE.Color(캔v, 캔v, 캔v)}
          />
          <meshBasicMaterial
            attach="material-1"
            color={new THREE.Color(0.7 * 캔v, 0.72 * 캔v, 0.75 * 캔v)}
            toneMapped={false}
          />
          <meshBasicMaterial
            attach="material-2"
            color={new THREE.Color(0.22 * 캔v, 0.23 * 캔v, 0.26 * 캔v)}
            toneMapped={false}
          />
          <만화선 선={내부} />
        </mesh>
      )}

      {children}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ② 커피 자판기 — 8개 이름표 버튼(핫 4 / 아이스 4)
// ═══════════════════════════════════════════════════════════════
export function 커피자판기({
  위치 = [0, 0, 0],
  회전 = 0,
  폭 = 3.4,
  높이 = 7.4,
  깊이 = 2.4,
  몸통색 = "#5a3e2b",
  테색 = "#43301f",
  간판색 = "#8c2f24",
  간판글 = "COFFEE",
  간판글자색 = "#fff6e2",
  버튼틀색 = "#4a3826",
  패널색 = "#241a12",
  어두운색 = "#15171b",
  컵색 = "#efe7d8",
  커피색 = "#4a2c17",
  핫배경 = "#b23a2e",
  아이스배경 = "#2f6bb0",
  배출부벽색 = "#20242a", // 컵 배출부 안쪽 벽
  배출부유리색 = "#e2edf2", // 투명문 유리 색
  밝기 = 1,
  // ── 상태 (퍼즐이 바깥에서 밀어 넣는다) ──
  선택 = null, // null | "핫" | "아이스"  → 그 온도의 버튼들이 밝아진다
  컵있음 = false,
  문열림 = 0, // 배출부 투명문 열림량(0=닫힘)
  // 8개: 위 4개=핫(빨강 라벨), 아래 4개=아이스(파랑 라벨)
  메뉴 = [
    { 이름: "밀크커피", 온도: "핫" },
    { 이름: "블랙커피", 온도: "핫" },
    { 이름: "율무차", 온도: "핫" },
    { 이름: "코코아", 온도: "핫" },
    { 이름: "아이스커피", 온도: "아이스" },
    { 이름: "아이스라떼", 온도: "아이스" },
    { 이름: "아이스초코", 온도: "아이스" },
    { 이름: "사이다", 온도: "아이스" },
  ],
  선,
  내부선, // 내부(버튼·배출부) 전용 외곽선
  children,
  ...rest
}) {
  const 밝 = (c) => 색밝기(c, 밝기);
  const 내부 = 내부선 ?? 선;
  const 반깊 = 깊이 / 2;
  const 테 = 0.28;
  const zf = 반깊 - 0.02;

  const 몸통 = useMemo(() => 몸통지오({ 폭, 높이, 깊이, 테 }), [폭, 높이, 깊이]);

  // ── 세로 3구역 (커피는 제어 스트립이 2줄이라 조금 더 높다) ──
  const 천 = 높이 - 테 - 0.78;
  const 바닥 = 테 + 0.15;
  // 위→아래: 포스터 / 버튼 / [종이컵 배출부(가운데)] / 광고(맨 아래).
  const 광고높 = 1.25; // 광고판 — 맨 아래로 내렸다
  const 배출높 = 1.4; // 종이컵 배출부(가운데 파인 공간)
  const 제어높 = 1.5;
  const 광고하 = 바닥; // ★ 광고를 맨 아래에
  const 광고상 = 광고하 + 광고높;
  const 배출하 = 광고상; // 배출부는 광고 위(예전 광고 자리)
  const 배출상 = 배출하 + 배출높;
  const 제어상 = 배출상 + 제어높;
  const 포하 = 제어상;
  const 포상 = 천;
  const 포폭 = 폭 - 테 * 2;

  // 메뉴 정규화(문자열이 와도 핫으로 취급)
  const 메뉴목록 = useMemo(
    () => 메뉴.map((m) => (typeof m === "string" ? { 이름: m, 온도: "핫" } : m)),
    [메뉴],
  );
  // 이름표 텍스처 — 온도에 따라 빨강/파랑 배경
  const 라벨텍들 = useMemo(
    () =>
      메뉴목록.map((m) =>
        버튼라벨텍스처(m.이름, {
          배경: m.온도 === "아이스" ? 아이스배경 : 핫배경,
        }),
      ),
    [메뉴목록, 핫배경, 아이스배경],
  );

  // 2줄 × 4칸 배치
  const 열 = 4;
  const 그리드폭 = 포폭 * 0.72; // 오른쪽 결제부와 안 겹치게 폭을 줄였다
  const 열간 = 그리드폭 / 열;
  const 버튼시작x = -포폭 / 2 + 0.12 + 열간 / 2;
  const 윗줄y = 제어상 - 0.38;
  const 줄간 = 0.52;

  const 간판텍 = useMemo(
    () => 글자텍스처(간판글, { 배경: 간판색, 글자색: 간판글자색 }),
    [간판글, 간판색, 간판글자색],
  );
  const 포스터텍 = useMemo(() => 포스터텍스처({ 종류: "커피포스터" }), []);
  const 광고텍 = useMemo(() => 포스터텍스처({ 종류: "커피광고" }), []);

  useEffect(
    () => () => {
      몸통?.dispose();
      간판텍?.dispose();
      포스터텍?.dispose();
      광고텍?.dispose();
      라벨텍들.forEach((t) => t?.dispose());
    },
    [몸통, 간판텍, 포스터텍, 광고텍, 라벨텍들],
  );

  const 광고v = Math.min(1, 0.45 + 밝기 * 0.55);

  return (
    <group name="자판기-커피" position={위치} rotation={[0, 회전, 0]} {...rest}>
      <mesh geometry={몸통} castShadow receiveShadow>
        {툰(밝(몸통색))}
        <만화선 geo={몸통} 선={선} />
      </mesh>

      {/* 상단 간판 */}
      <mesh position={[0, 높이 - 테 - 0.4, zf]}>
        <planeGeometry args={[폭 - 테 * 2, 0.72]} />
        <meshBasicMaterial map={간판텍} toneMapped={false} />
      </mesh>

      {/* ① 디스플레이 — 커피 포스터 한 장 */}
      <mesh position={[0, 포하 + (포상 - 포하) / 2, zf - 0.03]}>
        <planeGeometry args={[포폭, 포상 - 포하]} />
        <meshBasicMaterial
          map={포스터텍}
          toneMapped={false}
          color={new THREE.Color(광고v, 광고v, 광고v)}
        />
      </mesh>

      {/* ② 제어 스트립 — 어두운 패널 + 이름표 버튼 8개(핫4/아이스4) + 결제부.
             `선택` 온도와 같은 버튼들만 불이 들어온다(어떤 커피인지 + 핫/아이스). */}
      <mesh position={[0, 배출상 + 제어높 / 2, zf - 0.02]}>
        <planeGeometry args={[포폭, 제어높]} />
        {툰(밝(패널색))}
      </mesh>
      {메뉴목록.map((m, i) => {
        const col = i % 열;
        const row = Math.floor(i / 열);
        return (
          <상품버튼
            key={`m${i}`}
            x={버튼시작x + col * 열간}
            y={윗줄y - row * 줄간}
            z={zf}
            폭={0.44}
            높이={0.19}
            라벨텍={라벨텍들[i]}
            프레임색={버튼틀색}
            켜짐={선택 != null && m.온도 === 선택}
            밝기={밝기}
            선={내부}
          />
        );
      })}
      <결제부
        y={배출상 + 제어높 * 0.5}
        x={폭 / 2 - 0.52}
        깊이={깊이}
        색={밝(테색)}
        어두운색={밝(어두운색)}
        선={내부}
      />

      {/* ③ 하단 광고판 */}
      <mesh position={[0, 광고하 + 광고높 / 2, zf]}>
        <planeGeometry args={[폭 - 테 * 2, 광고높]} />
        <meshBasicMaterial
          map={광고텍}
          toneMapped={false}
          color={new THREE.Color(광고v, 광고v, 광고v)}
        />
      </mesh>

      {/* ④ 종이컵 배출부 — 가운데 파인 공간(노즐·컵받침틀·배수구·투명 칸막이) */}
      <커피배출부
        y={배출하 + 배출높 / 2}
        zf={zf}
        폭={1.24}
        높이={배출높 - 0.14}
        깊이={0.9}
        겉폭={폭 - 테 * 2}
        겉높={배출높}
        벽색={밝(배출부벽색)}
        프레임색={밝(테색)}
        겉색={밝(몸통색)}
        유리색={배출부유리색}
        컵색={밝(컵색)}
        커피색={밝(커피색)}
        컵있음={컵있음}
        문열림={문열림}
        선={내부}
      />

      {children}
    </group>
  );
}
