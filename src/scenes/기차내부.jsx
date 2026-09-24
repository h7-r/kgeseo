// ═══════════════════════════════════════════════════════════════
//  기차 내부 — 버려진 객차
// ═══════════════════════════════════════════════════════════════
// [좌표 약속]
//   x = 객차 길이 방향 (앞 ↔ 뒤)   z = 객차 폭 방향 (창가 ↔ 창가)
//   y = 높이. 바닥이 0.   1 유닛 ≈ 0.30m (역 씬과 같은 축척)
//
// [퀄리티를 역(수사본부)에 맞추는 방법]
//   역의 '낡은 느낌'은 색이 아니라 **캔버스로 그린 질감**에서 나온다.
//   벗겨진 페인트 · 물자국 · 아래에서 올라온 때 · 녹.
//   그 도구(makeCanvasTexture · 질감얹기 · 둥근얼룩)를 공용.jsx 로 옮겨 두고
//   여기서 **같은 도구로 기차용 무늬**를 그린다.
//   ※ 역의 콘크리트 블록 무늬를 그대로 쓰지는 않는다 — 기차 벽에 블록이
//     있으면 그게 더 이상하다. 쓰는 것은 '낡히는 방식'이지 무늬가 아니다.

import { useMemo, useRef, useCallback, useEffect } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import 텔레포트장치 from "../소품/텔레포트장치.jsx";
import 홀로그램스크린 from "../소품/홀로그램스크린.jsx";
import { useFrame } from "@react-three/fiber";
import {
  TOON_GRADIENT,
  색밝기,
  makeRandom,
  상자합치기,
  useSavedControls,
  선스키마,
  선뽑기,
  use이동,
  R,
  makeCanvasTexture,
  질감얹기,
  둥근얼룩,
} from "../공용.jsx";

// ── 객차 치수 ──────────────────────────────────────────────
const 길이 = 52; // x — 약 15.6m
const 폭 = 10; // z — 약 3.0m
const 높이 = 10; // y — 약 3.0m

// ★ 창을 키웠다. 예전(3.4~7.0)은 높이 3.6 으로, 눈높이(6.5)에서 보면
//   창이 눈 위에 걸쳐 '벽에 난 띠' 처럼 보였다.
//   2.6~8.0 = 높이 5.4. 허리 아래부터 머리 위까지 트여 통유리처럼 읽힌다.
const 창아래 = 2.6;
const 창위 = 8.0;
// 창유리 — **자판기 투명문(커피배출부)과 같은 유리**다.
//   색·불투명도·양면·깊이쓰기까지 그 코드를 그대로 쓴다. 크기만 창 것.
const 창유리색 = "#e2edf2";

// ── 출입문 ─────────────────────────────────────────────────
// ★ 문을 옆벽(-z)으로 옮겼다.
//   밖에서는 **기차 옆구리 문**으로 들어오는데, 안에서는 객차 끝(±x)으로
//   나가게 되어 있었다. 들어온 곳과 나가는 곳이 달라 방향 감각이 무너진다.
//   이제 들어온 그 자리로 다시 나간다.
const 문x = -길이 / 2 + 13;
const 문폭 = 5.2;
const 문높이 = 7.6;
const 문z = -폭 / 2; // 방을 향한 쪽 벽

// ═══════════════════════════════════════════════════════════════
//  질감 — 역과 같은 도구로, 기차용 무늬를 그린다
// ═══════════════════════════════════════════════════════════════

// ── 객차 벽 — 세로 리브 패널 + 세월 ──────────────────────────
//   실제 객차 내벽은 얇은 금속판을 세로로 이어 붙이고 리벳으로 고정한 것이다.
//   그 '세로 이음매'가 있어야 콘크리트 벽이 아니라 차량 내부로 읽힌다.
const 벽텍캐시 = new Map();
function 기차벽텍스처(seed, 낡음 = 1) {
  const 키 = `${seed}|${낡음}`;
  if (벽텍캐시.has(키)) return 벽텍캐시.get(키);
  const t = makeCanvasTexture(1024, (g, S) => {
    const rnd = makeRandom(seed * 331 + 17);
    // 바탕 — 흰 쪽으로 밝게 깔아 둔다. 실제 색은 재질의 color 가 곱해서 정한다.
    g.fillStyle = "rgb(238,238,238)";
    g.fillRect(0, 0, S, S);

    // ① 세로 패널 이음매 — 8칸. 이음매 양옆으로 옅은 음영을 넣어 판이 떠 보이게
    const 칸 = S / 8;
    for (let i = 0; i <= 8; i++) {
      const x = i * 칸;
      g.fillStyle = "rgba(120,118,114,0.45)";
      g.fillRect(x - 1.5, 0, 3, S);
      g.fillStyle = "rgba(255,255,255,0.30)";
      g.fillRect(x + 1.5, 0, 3, S);
      g.fillStyle = "rgba(150,148,144,0.10)";
      g.fillRect(x - 10, 0, 8, S);
    }

    // ② 리벳 — 이음매를 따라 일정 간격. 작아도 있는 것과 없는 것 차이가 크다
    for (let i = 0; i <= 8; i++) {
      const x = i * 칸;
      for (let y = 14; y < S; y += 46) {
        g.fillStyle = "rgba(120,118,114,0.5)";
        g.beginPath();
        g.arc(x, y, 2.6, 0, 6.2832);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.beginPath();
        g.arc(x - 0.8, y - 0.8, 1.4, 0, 6.2832);
        g.fill();
      }
    }

    // ③ 페인트가 벗겨져 밑칠이 드러난 자리 — 낡음의 핵심.
    //    균일하게 어둡게 칠하는 것과 이것의 차이가 '세월'과 '더러움'의 차이다.
    const n = Math.round(18 * 낡음);
    for (let i = 0; i < n; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        w = 8 + rnd() * 54,
        h = 6 + rnd() * 30;
      g.save();
      g.translate(x, y);
      g.rotate((rnd() - 0.5) * 1.2);
      g.fillStyle = `rgba(126,116,102,${0.10 + rnd() * 0.16})`;
      g.beginPath();
      // 찢긴 모양 — 타원이면 스티커처럼 보인다. 꼭짓점을 흔들어 준다
      const 점 = 7;
      for (let k = 0; k <= 점; k++) {
        const a = (k / 점) * 6.2832;
        const r = 1 + (rnd() - 0.5) * 0.5;
        const px = (Math.cos(a) * w * r) / 2;
        const py = (Math.sin(a) * h * r) / 2;
        k === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.restore();
    }

    // ④ 물이 흘러내린 자국 — 위에서 아래로. 창 밑에서 시작하는 것이 자연스럽다
    const m = Math.round(9 * 낡음);
    for (let i = 0; i < m; i++) {
      const x = rnd() * S;
      const y0 = rnd() * S * 0.4;
      const 길 = S * (0.25 + rnd() * 0.5);
      const w = 3 + rnd() * 9;
      const grd = g.createLinearGradient(0, y0, 0, y0 + 길);
      grd.addColorStop(0, `rgba(108,96,78,${0.16 * 낡음})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(x, y0, w, 길);
    }

    // ⑤ 아래쪽에 쌓인 때 — 발끝이 닿는 높이가 제일 더럽다
    const 때 = g.createLinearGradient(0, S * 0.62, 0, S);
    때.addColorStop(0, "rgba(0,0,0,0)");
    때.addColorStop(1, `rgba(58,50,40,${0.3 * 낡음})`);
    g.fillStyle = 때;
    g.fillRect(0, S * 0.62, S, S * 0.38);

    // ⑥ 공용 질감 — 손때·물자국·종이 결. 역의 벽과 같은 마무리다
    // ⑦ 깨진 벽 — 페인트가 갈라지고 밑칠이 드러난 균열.
    //   나뭇가지처럼 뻗는 금선 + 갈라진 단면 하이라이트로 입체감을 준다.
    //   밝은 벽이라 이 균열이 또렷하게 보인다.
    const 금긋기 = (x, y, ang, len, depth) => {
      if (depth <= 0 || len < 5) return;
      const nx = x + Math.cos(ang) * len,
        ny = y + Math.sin(ang) * len;
      const mx = (x + nx) / 2 + (rnd() - 0.5) * len * 0.35,
        my = (y + ny) / 2 + (rnd() - 0.5) * len * 0.35;
      g.strokeStyle = `rgba(70,66,58,${(0.28 + depth * 0.06) * 낡음})`;
      g.lineWidth = 0.8 + depth * 0.4;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(mx, my, nx, ny);
      g.stroke();
      // 갈라진 단면 — 살짝 옆으로 밀어 밝게(빛 받는 면)
      g.strokeStyle = `rgba(255,255,255,${0.3 * 낡음})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x + 0.9, y + 0.9);
      g.quadraticCurveTo(mx + 0.9, my + 0.9, nx + 0.9, ny + 0.9);
      g.stroke();
      금긋기(nx, ny, ang + (rnd() - 0.5) * 1.0, len * 0.7, depth - 1);
      if (rnd() < 0.5) 금긋기(nx, ny, ang + (rnd() - 0.5) * 2.1, len * 0.5, depth - 1);
    };
    const 금n = Math.round(4 * 낡음);
    for (let i = 0; i < 금n; i++)
      금긋기(rnd() * S, rnd() * S, rnd() * 6.2832, 60 + rnd() * 90, 3 + ((rnd() * 2) | 0));

    // ⑧ 페인트 조각이 통째로 떨어져 밑칠이 드러난 자리 — 각진 불규칙 조각
    const 조각n = Math.round(6 * 낡음);
    for (let i = 0; i < 조각n; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        r0 = 6 + rnd() * 22;
      g.fillStyle = `rgba(120,112,100,${(0.12 + rnd() * 0.12) * 낡음})`;
      g.beginPath();
      const pts = 5 + ((rnd() * 3) | 0);
      for (let k = 0; k <= pts; k++) {
        const a = (k / pts) * 6.2832;
        const rr = r0 * (0.5 + rnd() * 0.7);
        const px = x + Math.cos(a) * rr,
          py = y + Math.sin(a) * rr;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
      // 조각 위쪽 테두리 밝게 — 벗겨진 단차
      g.strokeStyle = `rgba(255,255,255,${0.2 * 낡음})`;
      g.lineWidth = 0.8;
      g.stroke();
    }

    질감얹기(g, S, S, seed, 낡음);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  벽텍캐시.set(키, t);
  return t;
}

// ── 바닥 — 리놀륨. 통로만 닳아 있다 ─────────────────────────
const 바닥텍캐시 = new Map();
function 기차바닥텍스처(seed) {
  if (바닥텍캐시.has(seed)) return 바닥텍캐시.get(seed);
  const t = makeCanvasTexture(1024, (g, S) => {
    const rnd = makeRandom(seed * 577 + 41);
    g.fillStyle = "rgb(236,236,236)";
    g.fillRect(0, 0, S, S);

    // 미끄럼 방지 홈 — 세로로 촘촘한 줄. 객차 바닥의 상징 같은 무늬다
    for (let x = 0; x < S; x += 13) {
      g.fillStyle = "rgba(120,118,114,0.22)";
      g.fillRect(x, 0, 4, S);
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.fillRect(x + 4, 0, 2, S);
    }
    // ① 크고 넓은 때 얼룩 — 오래 안 닦은 바닥. 진하게 여러 겹
    for (let i = 0; i < 60; i++)
      둥근얼룩(
        g,
        S,
        rnd() * S,
        rnd() * S,
        30 + rnd() * 160,
        rnd() < 0.7 ? "58,50,38" : "255,255,255",
        0.03 + rnd() * 0.07,
      );

    // ② 발자국 — 어두운 신발 자국. 지나다닌 흔적이라 바닥이 훨씬 더러워 보인다
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        ang = rnd() * 6.2832,
        sc = 0.7 + rnd() * 0.8;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.fillStyle = `rgba(46,40,32,${0.1 + rnd() * 0.12})`;
      // 발바닥(타원) + 뒤꿈치(작은 타원)
      g.beginPath();
      g.ellipse(0, 0, 8 * sc, 16 * sc, 0, 0, 6.2832);
      g.fill();
      g.beginPath();
      g.ellipse(0, 22 * sc, 6 * sc, 8 * sc, 0, 0, 6.2832);
      g.fill();
      g.restore();
    }

    // ③ 흘린 얼룩 몇 개 — 좌석과 같은 방식(번지고 흘러내리는)
    for (let i = 0; i < 5; i++) {
      const 종류 = rnd();
      const rgb = 종류 < 0.5 ? "70,48,28" : 종류 < 0.8 ? "58,64,72" : "90,74,40";
      흘린얼룩(g, rnd() * S, rnd() * S * 0.9, 25 + rnd() * 45, rgb, rnd);
    }

    // ④ 긁힌 자국 — 끌린 자국. 길고 얕게
    for (let i = 0; i < 140; i++) {
      g.strokeStyle = `rgba(90,84,74,${0.06 + rnd() * 0.14})`;
      g.lineWidth = 0.7 + rnd() * 1.6;
      const x = rnd() * S,
        y = rnd() * S,
        L = 8 + rnd() * 70,
        a = rnd() * 6.2832;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.stroke();
    }

    // ⑤ 깨진 유리 조각 — 형광등에서 떨어진 파편. 작은 각진 조각 + 밝은 반짝임
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        sz = 1.5 + rnd() * 6;
      // 각진 유리 조각(삼각형~사각형)
      g.fillStyle = `rgba(214,222,230,${0.14 + rnd() * 0.2})`;
      g.beginPath();
      const pts = 3 + ((rnd() * 2) | 0);
      for (let k = 0; k <= pts; k++) {
        const a = (k / pts) * 6.2832 + rnd() * 0.6;
        const rr = sz * (0.5 + rnd() * 0.8);
        const px = x + Math.cos(a) * rr,
          py = y + Math.sin(a) * rr;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fill();
      // 조각 한 모서리에 밝은 반짝임(빛 반사)
      if (rnd() < 0.6) {
        g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.4})`;
        g.beginPath();
        g.arc(x + (rnd() - 0.5) * sz, y + (rnd() - 0.5) * sz, 0.6 + rnd() * 0.9, 0, 6.2832);
        g.fill();
      }
      // 조각 옆 옅은 그림자 — 바닥에서 살짝 떠 보이게
      g.fillStyle = "rgba(40,36,30,0.12)";
      g.beginPath();
      g.ellipse(x + sz * 0.5, y + sz * 0.6, sz * 0.9, sz * 0.5, 0, 0, 6.2832);
      g.fill();
    }

    질감얹기(g, S, S, seed + 90, 1.3);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  바닥텍캐시.set(seed, t);
  return t;
}

// ── 밤 유리 ────────────────────────────────────────────────
// [왜 밖을 안 그리나]
//   창밖에 진짜 수사본부를 비추려면 방을 한 번 더 그려야 하는데(드로우콜 +1824),
//   그보다 큰 문제는 **안과 밖의 크기가 안 맞는다**는 것이다.
//     바깥 기차 한 칸 = 2.064 × 크기 10.3 ≈ 21유닛 / 안쪽 객차 = 52유닛
//   내부가 2.5배 길어서 걸어가면 밖이 안 따라오는 게 바로 드러난다.
//   → 밤에 불 켜고 기차를 타면 실제로 **창은 밖이 아니라 실내를 비춘다.**
//     그 사실을 그대로 쓰면 거짓말을 안 하면서 분위기도 산다.
// ── 흘린 얼룩 하나 — 커피·음료가 번지듯 ──────────────────────
// [둥근 원이 인위적인 이유]
//   실제로 음료를 흘리면 ① 불규칙하게 번지고 ② 마르면서 색소가 가장자리로
//   몰려 테두리가 진해지고(커피링 현상) ③ 중력으로 아래로 흘러내리고
//   ④ 주변에 방울이 튄다. 이 네 가지가 있어야 '흘린 자국'으로 읽힌다.
//   canvas 의 blur 필터로 경계를 부드럽게 풀어 물감처럼 번지게 한다.
function 흘린얼룩(g, cx, cy, size, rgb, rnd) {
  const N = 14;
  // 불규칙 외곽 반지름 — 한 번 정해 몸통·링이 같은 모양을 쓰게 한다(아메바 형태)
  const R = [];
  for (let k = 0; k < N; k++) R.push(size * (0.5 + rnd() * 0.6));
  const 경로 = (scale, 늘어짐) => {
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * 6.2832;
      const rr = R[k % N] * scale;
      const py = Math.sin(a) * rr * (Math.sin(a) > 0 ? 늘어짐 : 1); // 아래로 처짐
      const x = cx + Math.cos(a) * rr,
        y = cy + py;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  g.save();
  g.filter = "blur(2.5px)"; // 경계를 풀어 번진 느낌
  경로(1.18, 1.28);
  g.fillStyle = `rgba(${rgb},0.045)`;
  g.fill(); // ① 바깥 후광
  경로(1.0, 1.18);
  g.fillStyle = `rgba(${rgb},0.085)`;
  g.fill(); // ② 번진 몸통
  경로(0.62, 1.12);
  g.fillStyle = `rgba(${rgb},0.11)`;
  g.fill(); // ③ 덜 번진 중심
  g.filter = "none";
  // ④ 커피링 — 마른 가장자리가 제일 진하다
  경로(1.0, 1.18);
  g.strokeStyle = `rgba(${rgb},0.3)`;
  g.lineWidth = 1.3 + rnd() * 1.2;
  g.stroke();
  g.restore();

  // ⑤ 흘러내린 줄기 — 대부분 0~1가닥. 흘림이 많으면 지저분해진다
  const 흐n = rnd() < 0.5 ? 1 : 0;
  for (let i = 0; i < 흐n; i++) {
    const sx = cx + (rnd() - 0.5) * size * 0.9;
    const sy = cy + size * 0.55;
    const len = size * (0.5 + rnd() * 1.3);
    const w = 1.5 + rnd() * 3;
    const grd = g.createLinearGradient(0, sy, 0, sy + len);
    grd.addColorStop(0, `rgba(${rgb},0.16)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(sx - w, sy);
    g.quadraticCurveTo(sx - w * 0.2, sy + len * 0.5, sx - w * 0.15, sy + len);
    g.lineTo(sx + w * 0.15, sy + len);
    g.quadraticCurveTo(sx + w * 0.2, sy + len * 0.5, sx + w, sy);
    g.closePath();
    g.fill();
    // 줄기 끝 방울
    g.fillStyle = `rgba(${rgb},0.14)`;
    g.beginPath();
    g.arc(sx, sy + len, w * 0.8, 0, 6.2832);
    g.fill();
  }

  // ⑥ 튄 방울 — 절반은 아예 없다. 있어도 2~3개만, 얼룩 가까이에.
  //   방울이 사방으로 많이 튀면 '흘린 자국'이 아니라 '점 노이즈'로 보인다.
  if (rnd() < 0.5) {
    const 방n = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < 방n; i++) {
      const a = rnd() * 6.2832,
        d = size * (0.6 + rnd() * 0.6); // 멀리 안 튀게
      const bx = cx + Math.cos(a) * d,
        by = cy + Math.sin(a) * d * 0.85;
      g.fillStyle = `rgba(${rgb},${0.1 + rnd() * 0.14})`;
      g.beginPath();
      g.arc(bx, by, 0.6 + rnd() * 1.6, 0, 6.2832);
      g.fill();
    }
  }
}

// ── 좌석 받침대 — 금 간 플라스틱 ────────────────────────────
// [왜 금을 넣나]
//   좌석 밑 받침대(틀·다리)는 매끈한 단색이라 시트만 낡고 받침은 새것처럼
//   보였다. 오래된 플라스틱은 실금이 가고 모서리 도장이 벗겨진다.
//   금은 '나뭇가지처럼 갈라지는 선'이라, 재귀로 뻗어 나가게 그린다.
//   어두운 금 옆에 밝은 선을 하나 더 그어 '갈라진 단면'의 입체감을 준다.
function 균열텍스처(N = 4) {
  const 칸 = 256;
  const S = N * 칸;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);

  for (let r = 0; r < N; r++)
    for (let col = 0; col < N; col++) {
      const ox = col * 칸,
        oy = r * 칸;
      const rnd = makeRandom((r * N + col) * 431 + 53);
      g.save();
      g.beginPath();
      g.rect(ox, oy, 칸, 칸);
      g.clip();
      g.translate(ox, oy);

      // 도장면 결 — 아주 옅은 얼룩. 없으면 플라스틱이 너무 매끈하다
      for (let i = 0; i < 60; i++)
        둥근얼룩(
          g,
          칸,
          rnd() * 칸,
          rnd() * 칸,
          10 + rnd() * 40,
          "80,76,70",
          0.015 + rnd() * 0.02,
        );

      // 금 — 나뭇가지처럼 갈라진다(재귀)
      const 금긋기 = (x, y, ang, len, depth) => {
        if (depth <= 0 || len < 4) return;
        const nx = x + Math.cos(ang) * len,
          ny = y + Math.sin(ang) * len;
        // 어두운 금선 (약간 꺾이게 중간점 흔들기)
        const mx = (x + nx) / 2 + (rnd() - 0.5) * len * 0.3,
          my = (y + ny) / 2 + (rnd() - 0.5) * len * 0.3;
        g.strokeStyle = `rgba(24,20,16,${0.5 + depth * 0.08})`;
        g.lineWidth = 0.9 + depth * 0.35;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(mx, my, nx, ny);
        g.stroke();
        // 갈라진 단면 하이라이트 — 살짝 옆으로 밀어 밝게
        g.strokeStyle = "rgba(255,255,255,0.3)";
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x + 0.8, y + 0.8);
        g.quadraticCurveTo(mx + 0.8, my + 0.8, nx + 0.8, ny + 0.8);
        g.stroke();
        // 가지 — 주 줄기에서 갈라진다
        금긋기(nx, ny, ang + (rnd() - 0.5) * 1.1, len * 0.68, depth - 1);
        if (rnd() < 0.55)
          금긋기(nx, ny, ang + (rnd() - 0.5) * 2.2, len * 0.5, depth - 1);
      };

      // 칸마다 금 1~3줄기. 모서리에서 시작하는 게 자연스럽다
      const 금n = 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < 금n; i++) {
        const 가장자리 = (rnd() * 4) | 0;
        let x, y;
        if (가장자리 === 0) { x = rnd() * 칸; y = 0; }
        else if (가장자리 === 1) { x = 칸; y = rnd() * 칸; }
        else if (가장자리 === 2) { x = rnd() * 칸; y = 칸; }
        else { x = 0; y = rnd() * 칸; }
        금긋기(x, y, rnd() * 6.2832, 30 + rnd() * 40, 3 + ((rnd() * 2) | 0));
      }

      // 모서리 도장 벗겨짐 — 칸 테두리 근처에 작은 벗겨진 자국 몇 개
      const 벗n = (rnd() * 4) | 0;
      for (let i = 0; i < 벗n; i++) {
        const 모서리 = rnd() < 0.5;
        const x = 모서리 ? (rnd() < 0.5 ? rnd() * 30 : 칸 - rnd() * 30) : rnd() * 칸;
        const y = 모서리 ? rnd() * 칸 : rnd() < 0.5 ? rnd() * 30 : 칸 - rnd() * 30;
        g.fillStyle = `rgba(60,54,46,${0.15 + rnd() * 0.15})`;
        g.beginPath();
        g.ellipse(x, y, 3 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, 6.2832);
        g.fill();
      }
      g.restore();
    }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  좌석 천 — 얼룩과 뜯어진 시트
// ═══════════════════════════════════════════════════════════════
// [왜 아틀라스 한 장인가]
//   좌석이 12개인데 각자 다른 얼룩이어야 한다. 좌석마다 텍스처를 따로 만들면
//   메모리가 12배가 되고, 하나로 합치면 다 똑같은 얼룩이 된다.
//   → 한 장을 N×N 격자로 나눠 칸마다 다른 얼룩을 그리고, 좌석마다 다른 칸을
//     쓰게 한다(상자합치기의 uv칸 옵션). 한 장·한 드로우콜로 12개가 다 다르다.
//
// [색은 재질이 정한다]
//   이 텍스처는 재질 color 에 곱해진다. 그래서 바탕은 흰색으로 두고
//   얼룩·때는 어둡게(곱하면 어두워짐), 뜯어진 폼만 밝은 베이지로 그린다.
//   좌석 색 자체는 Leva 「좌석천색」 이 정한다.
function 좌석천텍스처(N = 4) {
  const 칸 = 256;
  const S = N * 칸;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);

  for (let r = 0; r < N; r++)
    for (let col = 0; col < N; col++) {
      const ox = col * 칸,
        oy = r * 칸;
      const rnd = makeRandom((r * N + col) * 761 + 17);
      g.save();
      // 칸 밖으로 얼룩·찢김이 새지 않게 잘라 둔다
      g.beginPath();
      g.rect(ox, oy, 칸, 칸);
      g.clip();
      g.translate(ox, oy);

      // ① 세로 골 — 열차 좌석에 흔한 코듀로이 결. 천이라는 걸 알려 준다
      for (let x = 0; x < 칸; x += 7) {
        g.fillStyle = "rgba(96,90,82,0.07)";
        g.fillRect(x, 0, 2.5, 칸);
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.fillRect(x + 2.5, 0, 1, 칸);
      }
      // ② 천 결 — 미세한 점 노이즈. 없으면 플라스틱처럼 매끈해 보인다
      for (let i = 0; i < 520; i++) {
        g.fillStyle = `rgba(110,104,96,${0.02 + rnd() * 0.03})`;
        g.fillRect(rnd() * 칸, rnd() * 칸, 1, 1 + rnd() * 1.4);
      }
      // ③ 엉덩이·등이 닿아 색이 바랜 자리 — 가운데가 살짝 반들거린다
      const 반들 = g.createRadialGradient(칸 / 2, 칸 * 0.55, 0, 칸 / 2, 칸 * 0.55, 칸 * 0.5);
      반들.addColorStop(0, "rgba(255,255,255,0.10)");
      반들.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = 반들;
      g.fillRect(0, 0, 칸, 칸);

      // ④ 흘린 얼룩 — 좌석마다 0~2개. 절반 가까이는 얼룩 없이 깨끗하게 둔다.
      //   전부 얼룩투성이면 오히려 가짜로 보인다. 몇 자리만 더러운 게 자연스럽다.
      //   색은 여러 음료를 섞어 좌석마다 다른 느낌이 나게 한다.
      const 얼룩색 = [
        "88,60,36",   // 커피
        "116,74,42",  // 믹스커피·홍차
        "58,40,28",   // 진하게 마른 커피
        "120,54,44",  // 콜라·간장
        "134,72,58",  // 주스(붉은)
        "150,120,60", // 오렌지·기름때(누런)
        "78,84,92",   // 물때(회)
        "92,74,96",   // 포도·와인(자줏빛)
      ];
      // 대부분 좌석에 얼룩이 하나는 있게 한다. 완전히 깨끗한 자리는 드물게.
      const 얼n = rnd() < 0.15 ? 0 : rnd() < 0.7 ? 1 : 2;
      for (let i = 0; i < 얼n; i++) {
        const x = 34 + rnd() * (칸 - 68),
          y = 28 + rnd() * (칸 - 78), // 아래로 흘러내릴 여백
          size = 16 + rnd() * 26;
        const rgb = 얼룩색[(rnd() * 얼룩색.length) | 0];
        흘린얼룩(g, x, y, size, rgb, rnd);
      }

      // ⑤ 뜯어진 시트 0~2개 — 찢긴 구멍 + 드러난 폼 + 삐져나온 실밥
      const 찢n = rnd() < 0.72 ? 1 + ((rnd() * 2) | 0) : 0;
      for (let i = 0; i < 찢n; i++) {
        const x = 40 + rnd() * (칸 - 80),
          y = 40 + rnd() * (칸 - 80),
          len = 22 + rnd() * 44,
          ang = rnd() * 6.2832;
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        // 찢긴 구멍 — 어두운 불규칙 다각형(가로로 길쭉하게 벌어진 모양)
        g.fillStyle = "rgba(22,18,14,0.88)";
        g.beginPath();
        const pts = 9;
        for (let k = 0; k <= pts; k++) {
          const a = (k / pts) * 6.2832;
          const rr = (k % 2 ? len * 0.14 : len * 0.5) * (0.55 + rnd() * 0.55);
          const px = Math.cos(a) * rr * 1.7,
            py = Math.sin(a) * rr * 0.45;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
        // 드러난 폼(스펀지) — 밝은 베이지. 구멍보다 작게 안쪽에
        g.fillStyle = "rgba(214,198,156,0.92)";
        g.beginPath();
        for (let k = 0; k <= 7; k++) {
          const a = (k / 7) * 6.2832;
          const rr = len * 0.3 * (0.5 + rnd() * 0.5);
          const px = Math.cos(a) * rr * 1.5,
            py = Math.sin(a) * rr * 0.4;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
        // 폼에 진 그늘 — 입체감
        g.fillStyle = "rgba(120,104,70,0.4)";
        g.beginPath();
        g.ellipse(0, len * 0.08, len * 0.3, len * 0.1, 0, 0, 6.2832);
        g.fill();
        // 삐져나온 실밥
        g.strokeStyle = "rgba(38,32,26,0.6)";
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const a = (rnd() - 0.5) * 3.2;
          g.beginPath();
          g.moveTo((rnd() - 0.5) * len, 0);
          g.lineTo(Math.cos(a) * len * 0.7, Math.sin(a) * len * 0.3 - rnd() * 7);
          g.stroke();
        }
        g.restore();
      }

      // ⑥ 아래쪽에 쌓인 때 — 앉는 면 앞쪽이 제일 더럽다
      const 때 = g.createLinearGradient(0, 칸 * 0.62, 0, 칸);
      때.addColorStop(0, "rgba(0,0,0,0)");
      때.addColorStop(1, "rgba(48,42,34,0.2)");
      g.fillStyle = 때;
      g.fillRect(0, 칸 * 0.62, 칸, 칸 * 0.38);

      g.restore();
    }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function 밤유리텍스처({ 유리색, 반사색, 반사세기, 얼룩 }) {
  // [무엇을 그리나]
  //   예전에는 '빛 번짐'만 그려서 이것도 저것도 아닌 얼룩이 됐다.
  //   창에 비치는 것은 정해져 있다 — **천장등 줄 + 좌석 등받이 실루엣.**
  //   그 두 가지를 실제로 그려 넣어야 '반사'로 읽힌다.
  //   멀리 있는 것일수록 작고 흐리게 그려 안쪽으로 이어지는 깊이를 만든다.
  const W = 512,
    H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  const rnd = makeRandom(4211);

  g.fillStyle = 유리색;
  g.fillRect(0, 0, W, H);

  // ── ① 비친 천장등 — 위쪽에 가로로 길쭉한 밝은 띠 세 개.
  //    안쪽(오른쪽)으로 갈수록 작아지고 흐려진다 = 멀어진다.
  const 등 = [
    { x: 0.2, y: 0.2, w: 0.34, a: 1.0 },
    { x: 0.58, y: 0.26, w: 0.2, a: 0.6 },
    { x: 0.82, y: 0.3, w: 0.11, a: 0.32 },
  ];
  for (const L of 등) {
    g.save();
    g.translate(W * L.x, H * L.y);
    g.scale(1, 0.16); // 세로로 눌러야 '형광등'이지 둥글면 달처럼 보인다
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, W * L.w);
    grd.addColorStop(0, 반사색);
    grd.addColorStop(0.45, 반사색);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 반사세기 * L.a;
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, W * L.w, 0, 6.2832);
    g.fill();
    g.restore();
  }
  g.globalAlpha = 1;

  // ── ② 비친 좌석 등받이 — 아래쪽에 어두운 덩어리들.
  //    유리에 비친 물체는 **윤곽만 남고 속은 뭉개진다.** 그래서 면만 칠하고
  //    위 모서리에만 옅은 하이라이트를 준다. 그게 '비친 것'의 문법이다.
  const 좌 = [
    { x: 0.12, w: 0.2, h: 0.34, a: 0.5 },
    { x: 0.42, w: 0.15, h: 0.27, a: 0.36 },
    { x: 0.64, w: 0.11, h: 0.21, a: 0.26 },
    { x: 0.8, w: 0.08, h: 0.16, a: 0.18 },
  ];
  for (const S2 of 좌) {
    const x = W * S2.x,
      w = W * S2.w,
      h = H * S2.h;
    const y = H * 0.99 - h;
    g.globalAlpha = S2.a;
    g.fillStyle = "rgba(150,160,175,0.5)";
    g.fillRect(x, y, w, h);
    // 등받이 윗면에 닿은 빛
    g.fillStyle = 반사색;
    g.globalAlpha = S2.a * 반사세기 * 0.9;
    g.fillRect(x, y, w, 3);
    g.globalAlpha = 1;
  }

  // ── ③ 창틀이 비친 세로 선 — 반사에는 창 자신도 비친다 ──
  g.globalAlpha = 반사세기 * 0.25;
  g.fillStyle = 반사색;
  for (const x of [0.33, 0.71]) g.fillRect(W * x, 0, 2, H);
  g.globalAlpha = 1;

  // ── ④ 오래 안 닦은 유리 — 빗물 자국과 먼지 ──
  for (let i = 0; i < Math.round(30 * 얼룩); i++) {
    const x = rnd() * W,
      y0 = rnd() * H * 0.55,
      L = H * (0.1 + rnd() * 0.45),
      w = 1 + rnd() * 4;
    const grd = g.createLinearGradient(0, y0, 0, y0 + L);
    grd.addColorStop(0, `rgba(190,196,205,${0.045 + rnd() * 0.06})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x, y0, w, L);
  }
  for (let i = 0; i < Math.round(16 * 얼룩); i++)
    둥근얼룩(
      g,
      W,
      rnd() * W,
      rnd() * H,
      20 + rnd() * 100,
      "165,174,188",
      0.018 + rnd() * 0.028,
    );

  // ── ⑤ 네 귀퉁이를 눌러 준다 — 반사는 가운데가 제일 또렷하다 ──
  const 귀 = g.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.72);
  귀.addColorStop(0, "rgba(0,0,0,0)");
  귀.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = 귀;
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ═══════════════════════════════════════════════════════════════
//  형광등 — 몇 개는 죽었고 몇 개는 깜빡인다
// ═══════════════════════════════════════════════════════════════
// [왜 깜빡이게 하나]
//   전등이 전부 고르게 켜져 있으면 '관리되는 공간'이다. 버려진 열차는
//   전기가 불안정해야 한다. 깜빡임 하나로 공간의 성격이 통째로 바뀐다.
//
// [왜 React state 를 안 쓰나]
//   깜빡임은 매 프레임 바뀐다. state 로 두면 초당 60번 리렌더가 난다.
//   ref 로 three 객체(빛 세기 · 등판 색)를 직접 건드린다.
// [어떤 리듬인가]
//   1분에 두세 번. 대부분은 그냥 켜져 있다가, 가끔 한 번 발작하듯 깜빡인다.
//   그 발작 안에서 **처음엔 느리게, 뒤로 갈수록 빠르게** 끊긴다 —
//   실제로 안정기(ballast)가 나간 형광등이 그렇게 죽어 간다.
//   쉬지 않고 규칙적으로 깜빡이면 '고장'이 아니라 '장식'으로 보인다.
//
// 발작 구간의 시각표(초). [꺼짐 시작, 꺼짐 끝] 을 늘어놓은 것이다.
//   간격이 0.50 → 0.27 → 0.19 → 0.14 → 0.10 으로 점점 좁아진다.
const 발작 = [
  [0.0, 0.09],
  [0.59, 0.66],
  [0.93, 0.985],
  [1.175, 1.22],
  [1.36, 1.395],
  [1.495, 1.52],
];
const 발작길이 = 1.75; // 초

function 깜빡값(t, 위상, 주기) {
  // u = 이번 주기에서 얼마나 지났나(초)
  const u = (t + 위상) % 주기;
  const 발작시작 = 주기 - 발작길이;
  if (u < 발작시작) return 1; // 대부분의 시간 — 그냥 켜져 있다
  const k = u - 발작시작; // 발작 시작 후 경과 초
  for (const [a, b] of 발작) {
    if (k >= a && k < b) return 0.05; // 꺼진 순간
    // 꺼졌다 켜지는 직후엔 잠깐 덜 밝다 — 형광등이 다시 붙는 느낌
    if (k >= b && k < b + 0.05) return 0.45;
  }
  return 1;
}

// ── 깨진 형광등 커버 ─────────────────────────────────────────
// [무엇을 그리나]
//   오래된 형광등 커버는 충격을 받아 ① 한 점에서 방사형으로 금이 가고
//   ② 그 금을 잇는 동심원 균열이 생기고 ③ 조각이 아예 떨어져 나가 어두운
//   구멍이 남고 ④ 벌레·그을음이 껴 누렇게 뜬다. 이 네 가지를 칸마다 다르게 그려
//   등마다 깨진 모양이 다르게 한다(아틀라스).
//   흰 바탕에 곱해지므로, 살아 있는 등이든 죽은 등이든 금·구멍이 어둡게 보인다.
const 깨진등맵캐시 = {};
function 깨진등텍스처(N = 4) {
  if (깨진등맵캐시[N]) return 깨진등맵캐시[N];
  const 칸 = 256;
  const S = N * 칸;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);

  for (let r = 0; r < N; r++)
    for (let col = 0; col < N; col++) {
      const ox = col * 칸,
        oy = r * 칸;
      const rnd = makeRandom((r * N + col) * 271 + 89);
      g.save();
      g.beginPath();
      g.rect(ox, oy, 칸, 칸);
      g.clip();
      g.translate(ox, oy);

      // 형광등 결 — 세로로 옅은 줄(관 여러 개)
      for (let x = 0; x < 칸; x += 칸 / 4) {
        g.fillStyle = "rgba(180,180,175,0.06)";
        g.fillRect(x, 0, 칸 / 4 - 2, 칸);
        g.fillStyle = "rgba(0,0,0,0.03)";
        g.fillRect(x - 1, 0, 2, 칸);
      }

      // 누렇게 뜬 그을음·벌레 자국
      const 그n = 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < 그n; i++)
        둥근얼룩(
          g,
          칸,
          rnd() * 칸,
          rnd() * 칸,
          20 + rnd() * 50,
          rnd() < 0.5 ? "150,130,70" : "60,54,44",
          0.06 + rnd() * 0.08,
        );

      // ① 충격점 — 여기서 유리가 큰 조각으로 쪼개진다(거미줄이 아니라 파편)
      const cx = 칸 * (0.32 + rnd() * 0.36),
        cy = 칸 * (0.32 + rnd() * 0.36);
      // 방사 균열 5~7개. 이 사이사이가 '유리 조각' 하나가 된다
      const 방사 = 5 + ((rnd() * 3) | 0);
      const 각도들 = [];
      for (let i = 0; i < 방사; i++)
        각도들.push((i / 방사) * 6.2832 + (rnd() - 0.5) * 0.7);
      각도들.sort((a, b) => a - b);
      const 대각 = 칸 * 1.5; // 조각을 칸 밖까지 채우고 clip 으로 자른다

      // ② 조각 채우기 — 인접한 두 균열 사이를 부채꼴 조각으로.
      //    조각마다 밝기를 미세하게 달리해 '다른 각도로 튀어나온 유리'로 보이게.
      //    일부 조각은 아예 떨어져 나가 어두운 구멍이 된다.
      for (let i = 0; i < 각도들.length; i++) {
        const a1 = 각도들[i],
          a2 = 각도들[(i + 1) % 각도들.length] + (i + 1 >= 각도들.length ? 6.2832 : 0);
        const 빠짐 = rnd() < 0.22; // 조각이 떨어져 나감
        g.beginPath();
        g.moveTo(cx, cy);
        // 부채꼴을 몇 단계로 나눠 바깥 경계를 살짝 울퉁불퉁하게
        const seg = 3;
        for (let k = 0; k <= seg; k++) {
          const a = a1 + ((a2 - a1) * k) / seg;
          const rr = 대각 * (0.85 + rnd() * 0.3);
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.closePath();
        if (빠짐) {
          g.fillStyle = "rgba(16,14,12,0.82)"; // 유리 빠진 어두운 구멍
        } else {
          const 틴트 = (rnd() - 0.55) * 0.14; // -0.08 ~ +0.06
          const v = Math.round(255 * (1 + 틴트));
          g.fillStyle = `rgba(${v},${v},${Math.round(v * 0.99)},0.9)`;
        }
        g.fill();
      }

      // ③ 균열 선 — 조각 경계. 어두운 금 + 옆에 밝은 단면
      for (const a of 각도들) {
        const rr = 대각;
        const ex = cx + Math.cos(a) * rr,
          ey = cy + Math.sin(a) * rr;
        const mx = cx + Math.cos(a) * rr * 0.5 + (rnd() - 0.5) * 12,
          my = cy + Math.sin(a) * rr * 0.5 + (rnd() - 0.5) * 12;
        g.strokeStyle = "rgba(32,30,26,0.65)";
        g.lineWidth = 1 + rnd() * 1.2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.quadraticCurveTo(mx, my, ex, ey);
        g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.4)";
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(cx + 0.9, cy + 0.9);
        g.quadraticCurveTo(mx + 0.9, my + 0.9, ex + 0.9, ey + 0.9);
        g.stroke();
      }

      // ④ 충격점 — 완전히 부서진 중심. 작은 어두운 구멍 + 방사 실금
      g.fillStyle = "rgba(14,12,10,0.7)";
      g.beginPath();
      g.arc(cx, cy, 3 + rnd() * 4, 0, 6.2832);
      g.fill();

      g.restore();
    }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  깨진등맵캐시[N] = t;
  return t;
}

function 형광등({ x, 상태, 세기, 등색, 꺼진색, 밝기, 깨짐맵, uv칸 }) {
  const 빛 = useRef(null);
  const 판 = useRef(null);
  const 기본 = useMemo(() => new THREE.Color(등색), [등색]);
  const 꺼짐 = useMemo(() => new THREE.Color(꺼진색), [꺼진색]);
  // 등판 지오메트리 — UV 를 아틀라스의 내 칸으로 옮겨 등마다 다른 깨짐을 쓴다
  const 판geo = useMemo(() => {
    const gg = new THREE.BoxGeometry(6.4, 0.22, 1.7);
    if (uv칸) {
      const [cc, rr] = uv칸,
        N = 4;
      const uv = gg.attributes.uv;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, uv.getX(i) / N + cc / N, uv.getY(i) / N + rr / N);
      uv.needsUpdate = true;
    }
    return gg;
  }, [uv칸]);
  useEffect(() => () => 판geo.dispose(), [판geo]);

  useFrame(({ clock }) => {
    if (!빛.current || !판.current) return;
    let v;
    if (상태.종류 === "죽음") v = 0;
    else if (상태.종류 === "깜빡")
      v = 깜빡값(clock.elapsedTime, 상태.위상, 상태.주기);
    else v = 1;
    빛.current.intensity = 세기 * v;
    // 등판 자체도 같이 어두워져야 한다 — 빛만 꺼지고 판이 밝으면 가짜로 보인다
    판.current.material.color.copy(꺼짐).lerp(기본, v);
  });

  return (
    <group position={[x, 높이 - 0.5, 0]}>
      {/* 등판 — toneMapped=false 라 이 색이 화면에 그대로 찍히고 블룸이 번진다.
          깨진 커버 텍스처가 곱해져 금·구멍이 어둡게 드러난다. */}
      <mesh ref={판} geometry={판geo}>
        <meshBasicMaterial map={깨짐맵} color={등색} toneMapped={false} />
      </mesh>
      {/* 등갓 — 등판을 감싸는 얕은 상자. 있어야 '설치된 조명'으로 보인다 */}
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[6.9, 0.26, 2.1]} />
        <meshToonMaterial color={색밝기("#3c4149", 밝기)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 빛은 등판보다 한참 아래에 둔다.
          등판 바로 밑에 두면 천장이 정면으로 맞아 툰 재질의 밝기 단이
          동그란 얼룩으로 찍힌다. 내려두면 천장엔 거의 안 닿고 바닥만 밝아진다. */}
      <pointLight
        ref={빛}
        position={[0, -1.8, 0]}
        intensity={세기}
        distance={34}
        decay={2}
        color={등색}
      />
    </group>
  );
}

export default function 기차내부({ active, onNear }) {
  const T = useSavedControls("기차 내부", {
    // ── 색 — 역(수사본부)과 같은 계열 ──────────────────────
    //   역: 벽 #525b69 · 아랫단 #4e5462 · 바닥 #424448 · 천장 #5a5f69
    // ★ 밝은 아이보리 차체. 어두운 폐열차가 아니라 '오래됐지만 밝은 실내'.
    //   밝은 바탕이라 벽의 얼룩·균열이 또렷하게 읽힌다.
    차체색: "#525252",
    아랫단색: "#5c5c5c", // 허리 아래 — 한 톤만 낮춰 공간이 바닥에 붙어 보이게
    바닥색: "#939393",
    천장색: "#6c6c6c",
    // ★ 좌석은 회색 계열로. 갈색 계열은 방(수사본부)의 나무 가구와 겹쳐서
    //   기차 좌석이 '방에서 옮겨 온 의자'처럼 보였다.
    좌석천색: "#575758", // 앉는 면·등받이 천
    좌석천색2: "#1d1d1d", // 등받이 — 천을 두 톤으로 나눠야 한 덩어리로 안 보인다
    좌석틀색: "#383b3e", // 프레임 · 다리 · 받침
    팔걸이색: "#3c4046", // 팔걸이 · 손잡이
    창틀색: "#626161",
    선반색: "#9d9d9d",
    문색: "#454b55",
    // ── 밝기 ───────────────────────────────────────────────
    //   역은 「스탠드(공통) → 전체어둡게 0.73」로 전체를 눌러 놓았다.
    //   기차만 밝으면 밖에서 들어왔을 때 눈이 부시고 화풍이 끊긴다.
    밝기: { value: 0.64, min: 0.2, max: 2, step: 0.02 },
    천장등세기: { value: 1.0, min: 0, max: 4, step: 0.05 },
    // 밑빛이 세면 그림자가 지워져 툰 재질의 밝기 단이 안 보이고 종이처럼 납작해진다.
    //   역의 기본광이 0.29 다. 거기 맞춰 낮게 둔다.
    밑빛: { value: 1.4, min: 0, max: 3, step: 0.02 },
    // ── 전등 상태 ──────────────────────────────────────────
    등개수: { value: 6, min: 2, max: 12, step: 1 },
    등색: "#ffffff",
    꺼진등색: "#2c2d2e",
    죽은등비율: { value: 0.55, min: 0, max: 1, step: 0.05 },
    깜빡등비율: { value: 0.35, min: 0, max: 1, step: 0.05 },
    등시드: { value: 3, min: 1, max: 99, step: 1 },
    // 깜빡임 주기(초). 27이면 1분에 두 번쯤. 등마다 ±20% 흩어진다.
    깜빡주기: { value: 20, min: 6, max: 60, step: 1 },
    // ── 질감 ───────────────────────────────────────────────
    벽시드: { value: 558, min: 1, max: 999, step: 1 },
    벽낡음: { value: 1.0, min: 0, max: 2, step: 0.05 },
    바닥시드: { value: 514, min: 1, max: 999, step: 1 },
    // ── 창 ─────────────────────────────────────────────────
    유리색: "#161c25",
    반사색: "#ffffff",
    반사세기: { value: 0.12, min: 0, max: 1, step: 0.02 },
    유리얼룩: { value: 0.1, min: 0, max: 2, step: 0.05 },
    유리밝기: { value: 0.25, min: 0.2, max: 2, step: 0.05 },
    막힌창비율: { value: 0.25, min: 0, max: 1, step: 0.05 },
    // 창밖 배경(수사본부 캡처) — 안에서 밖이 보이는 느낌
    창밖보이기: true,
    창밖밝기: { value: 0.9, min: 0, max: 2, step: 0.05 },
    막투명도: { value: 0.3, min: 0, max: 1, step: 0.02 }, // 유리(막) 불투명도
    창밖뒤집기: false, // 창밖 이미지 좌우 방향(첫 창↔안쪽 순서) 뒤집기
    창시드: { value: 5, min: 1, max: 99, step: 1 },
    판자색: "#584634",
    판자수: { value: 3, min: 1, max: 5, step: 1 },
    판자두께: { value: 0.3, min: 0.1, max: 0.8, step: 0.02 },
    // ── 좌석 ───────────────────────────────────────────────
    // 1인용 좌석을 **네 개가 마주 보는 한 묶음**으로 놓는다.
    //   (통로 양옆에 하나씩 × 마주 보는 두 줄 = 4석)
    좌석묶음수: { value: 3, min: 1, max: 6, step: 1 },
    묶음간격: { value: 13, min: 8, max: 24, step: 0.5 }, // 묶음과 묶음 사이
    마주간격: { value: 5.0, min: 3, max: 9, step: 0.1 }, // 마주 보는 두 줄 사이 (무릎 공간)
    좌석시작: { value: 20, min: 8, max: 40, step: 0.5 }, // 문에서 얼마나 떨어져 시작하나
    좌석벽간격: { value: 2.3, min: 1, max: 4, step: 0.05 }, // 창가 쪽 벽에서 떨어진 거리
    // 좌석 전체 크기 배율. 1.0 = 폭 1.7 · 깊이 1.55 · 등받이 위 4.4 유닛.
    //   1.25 면 폭 2.1(≈0.64m) — 실제 무궁화호 좌석에 가깝다.
    좌석크기: { value: 1.3, min: 0.7, max: 1.8, step: 0.05 },
    // ── 안개 — 역과 같은 공기 ──────────────────────────────
    안개색: "#383838",
    안개시작: { value: 20, min: 0, max: 120, step: 1 },
    안개끝: { value: 120, min: 20, max: 400, step: 1 },
    ...선스키마({ 굵기: 2.5, 색: "#12151a", 주름: true, 각도: 45, 주름색: "#191d25" }),
  });

  const 선 = 선뽑기(T);
  const 선긋기 = 선.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;
  const 밝 = (c) => 색밝기(c, T.밝기);

  // ── 질감 ────────────────────────────────────────────────
  const 벽텍 = 기차벽텍스처(T.벽시드, T.벽낡음);
  const 바닥텍 = 기차바닥텍스처(T.바닥시드);
  const 유리맵 = useMemo(
    () =>
      밤유리텍스처({
        유리색: T.유리색,
        반사색: T.반사색,
        반사세기: T.반사세기,
        얼룩: T.유리얼룩,
      }),
    [T.유리색, T.반사색, T.반사세기, T.유리얼룩],
  );
  useEffect(() => () => 유리맵.dispose(), [유리맵]);
  // 창밖 배경 — 수사본부 캡처를 이어붙인 파노라마(흐릿하게 후처리됨)
  const 창밖맵 = useMemo(() => {
    const t = new THREE.TextureLoader().load("/textures/창밖_수사본부.jpg");
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.RepeatWrapping; // 좌우 뒤집기(repeat.x=-1) 가능하게
    return t;
  }, []);
  useEffect(() => () => 창밖맵.dispose(), [창밖맵]);
  // 창밖 이미지 방향 — 뒤집기 스위치. repeat.x=-1 이면 좌우가 반대로 흐른다.
  useEffect(() => {
    창밖맵.repeat.x = T.창밖뒤집기 ? -1 : 1;
    창밖맵.offset.x = T.창밖뒤집기 ? 1 : 0;
    창밖맵.needsUpdate = true;
  }, [창밖맵, T.창밖뒤집기]);
  // 반대편(입구 반대) 창밖 — 이미지 없이 거의 블랙 + 아주 희미한 조명만.
  const 창밖어둠맵 = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#070910";
    g.fillRect(0, 0, 256, 256);
    for (const [x, y, r, a] of [
      [70, 95, 140, 0.16],
      [185, 150, 100, 0.1],
    ]) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(120,132,152,${a})`);
      gr.addColorStop(1, "rgba(120,132,152,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 256, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => 창밖어둠맵.dispose(), [창밖어둠맵]);

  // 좌석 얼룩·찢김 텍스처 — 한 장에 16칸, 좌석마다 다른 칸을 쓴다
  const 좌석천맵 = useMemo(() => 좌석천텍스처(4), []);
  useEffect(() => () => 좌석천맵.dispose(), [좌석천맵]);

  // 받침대 금(균열) 텍스처 — 좌석천과 같은 아틀라스 규칙(칸마다 다른 금)
  const 균열맵 = useMemo(() => 균열텍스처(4), []);
  useEffect(() => () => 균열맵.dispose(), [균열맵]);

  // 깨진 형광등 커버 텍스처 — 등마다 다른 칸을 쓴다
  const 깨진등맵 = useMemo(() => 깨진등텍스처(4), []);
  useEffect(() => () => 깨진등맵.dispose(), [깨진등맵]);

  // 텍스처는 몇 유닛마다 되풀이된다. 반복 횟수를 벽 크기에 맞춰 잡아야
  //   무늬가 늘어나거나 뭉개지지 않는다. (한 장이 약 8유닛을 덮게)
  const 벽반복 = useMemo(() => {
    const t = 벽텍.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(길이 / 8, 높이 / 8);
    t.needsUpdate = true;
    return t;
  }, [벽텍]);
  const 바닥반복 = useMemo(() => {
    const t = 바닥텍.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(길이 / 6, 폭 / 6);
    t.needsUpdate = true;
    return t;
  }, [바닥텍]);
  useEffect(
    () => () => {
      벽반복.dispose();
      바닥반복.dispose();
    },
    [벽반복, 바닥반복],
  );

  // ── 전등 상태 — 씨앗 고정 ────────────────────────────────
  //   새로고침해도 같은 등이 죽어 있어야 '이 열차는 원래 저랬다'가 된다.
  const 등목록 = useMemo(() => {
    const rnd = makeRandom(T.등시드 * 613 + 29);
    return Array.from({ length: T.등개수 }, (_, i) => {
      const x = -길이 / 2 + 6 + (i * (길이 - 12)) / Math.max(1, T.등개수 - 1);
      const r = rnd();
      let 상태;
      if (r < T.죽은등비율) 상태 = { 종류: "죽음" };
      else if (r < T.죽은등비율 + T.깜빡등비율)
        // 주기 20~34초 = 1분에 두세 번. 등마다 위상을 흩어 놓아야
        //   여러 개가 동시에 깜빡이지 않는다(그러면 '조명 연출'로 보인다).
        상태 = {
          종류: "깜빡",
          위상: rnd() * 60,
          주기: T.깜빡주기 * (0.8 + rnd() * 0.6),
        };
      else 상태 = { 종류: "정상" };
      return { x, 상태 };
    });
  }, [T.등개수, T.등시드, T.죽은등비율, T.깜빡등비율]);

  // ── 창 자리 ─────────────────────────────────────────────
  //   창을 키운 만큼 개수는 줄인다(6.5 → 9유닛 간격). 큰 창 5~6개가
  //   작은 창 8개보다 훨씬 시원하고, 그리는 양도 준다.
  const 창수 = Math.max(2, Math.round(길이 / 9));
  const 창x목록 = useMemo(
    () =>
      Array.from(
        { length: 창수 },
        (_, i) => -길이 / 2 + 5 + (i * (길이 - 10)) / (창수 - 1),
      ),
    [창수],
  );
  const 창폭 = 6.6;
  // 출입문이 있는 자리에는 창을 두지 않는다(문과 창이 겹치면 벽이 뚫려 보인다)
  const 문겹침 = (x) => Math.abs(x - 문x) < (창폭 + 문폭) / 2;

  // ★ 창의 왼쪽(-z)·오른쪽(+z)을 따로 판정한다.
  //   예전엔 창 위치마다 하나의 값이라 양쪽이 늘 같이 막히거나 같이 뚫렸다.
  //   이제 [왼, 오] 두 값을 따로 뽑아, 한쪽만 막힌 창이 자연스럽게 나온다.
  const 막힌창 = useMemo(() => {
    const rnd = makeRandom(T.창시드 * 977 + 13);
    return 창x목록.map(() => [rnd() < T.막힌창비율, rnd() < T.막힌창비율]);
  }, [창x목록, T.창시드, T.막힌창비율]);

  // ── 창틀 — 창 하나를 네 변으로 감싼다 ────────────────────
  const 창틀 = useMemo(() => {
    const 상자 = [];
    const 가운데 = (창위 + 창아래) / 2;
    const 높 = 창위 - 창아래;
    for (const x of 창x목록)
      for (const sz of [-1, 1]) {
        if (sz === -1 && 문겹침(x)) continue;
        const z = sz * (폭 / 2 - 0.12);
        상자.push({ 크기: [창폭, 0.3, 0.24], 위치: [x, 창위 - 0.15, z] });
        상자.push({ 크기: [창폭, 0.3, 0.24], 위치: [x, 창아래 + 0.15, z] });
        상자.push({ 크기: [0.3, 높, 0.24], 위치: [x - 창폭 / 2 + 0.15, 가운데, z] });
        상자.push({ 크기: [0.3, 높, 0.24], 위치: [x + 창폭 / 2 + -0.15, 가운데, z] });
        // 창 아래 선반(턱) — 이게 있어야 창이 '벽에 뚫린 구멍'이 아니라 창문이 된다
        상자.push({ 크기: [창폭 + 0.4, 0.22, 0.7], 위치: [x, 창아래 - 0.1, z + sz * -0.3] });
      }
    return 상자합치기(상자);
  }, [창x목록]);

  // ── 창과 창 사이 벽기둥 ─────────────────────────────────
  //   창밖(어두운 유리)은 창 자리에만 있어야 한다. 그 사이를 차체색으로 막아야
  //   '검은 띠'가 아니라 '창 다섯 개'로 읽힌다.
  const 기둥 = useMemo(() => {
    const 상자 = [];
    const 반폭 = 창폭 / 2;
    for (const sz of [-1, 1]) {
      const 자리 = 창x목록.filter((x) => !(sz === -1 && 문겹침(x)));
      const 구간 = [];
      let 이전 = -길이 / 2;
      for (const x of 자리) {
        구간.push([이전, x - 반폭]);
        이전 = x + 반폭;
      }
      구간.push([이전, 길이 / 2]);
      for (const [a, b] of 구간) {
        const w = b - a;
        if (w <= 0.02) continue;
        상자.push({
          크기: [w, 창위 - 창아래, 0.2],
          위치: [(a + b) / 2, (창위 + 창아래) / 2, sz * (폭 / 2 + 0.1)],
        });
      }
    }
    return 상자합치기(상자);
  }, [창x목록]);

  // ── 유리 · 판자 ─────────────────────────────────────────
  //   얇은 상자로 만든다. 판(plane)이 아니라 상자여야 상자합치기로 합쳐지고,
  //   상자는 면마다 UV 가 0~1 이라 창 하나가 그림 한 장을 통째로 받는다.
  // ★ 유리를 좌우로 나눈다. 입구쪽(-z)만 '밤유리 반사'를 얹고, 반대쪽(+z)은
  //   반사 무늬(사각형처럼 보이던 것) 없이 아주 옅은 막만 둔다.
  const 유리조각 = (부호) =>
    상자합치기(
      창x목록
        .filter((x) => !(부호 === -1 && 문겹침(x)))
        .map((x) => ({
          크기: [창폭 - 0.5, 창위 - 창아래 - 0.5, 0.04],
          위치: [x, (창위 + 창아래) / 2, 부호 * (폭 / 2 + 0.15)],
        })),
    );
  const 유리입구 = useMemo(() => 유리조각(-1), [창x목록]); // eslint-disable-line
  const 유리반대 = useMemo(() => 유리조각(1), [창x목록]); // eslint-disable-line

  //   각도를 조금씩 틀어야 '급하게 대충 막았다'가 된다. 반듯하면 창틀로 보인다.
  const 판자 = useMemo(() => {
    const rnd = makeRandom(T.창시드 * 31 + 7);
    const 상자 = [];
    창x목록.forEach((x, i) => {
      for (const sz of [-1, 1]) {
        if (sz === -1 && 문겹침(x)) continue;
        if (!막힌창[i][sz === -1 ? 0 : 1]) continue; // 그쪽 면이 안 막혔으면 건너뛴다
        for (let k = 0; k < T.판자수; k++) {
          const 칸 = (창위 - 창아래) / (T.판자수 + 1);
          const y = 창아래 + 칸 * (k + 1) + (rnd() - 0.5) * 0.4;
          상자.push({
            크기: [창폭 + 0.5 + rnd() * 0.8, T.판자두께, 0.14],
            위치: [x + (rnd() - 0.5) * 0.6, y, sz * (폭 / 2 + 0.02)],
            회전: [0, 0, (rnd() - 0.5) * 0.13],
          });
        }
      }
    });
    return 상자합치기(상자);
  }, [창x목록, 막힌창, T.판자수, T.판자두께, T.창시드]);

  // ── 짐 선반 ─────────────────────────────────────────────
  const 선반 = useMemo(
    () =>
      상자합치기(
        [-1, 1].flatMap((sz) => [
          { 크기: [길이 - 5, 0.18, 1.7], 위치: [0, 창위 + 0.7, sz * (폭 / 2 - 1.0)] },
          // 선반을 받치는 팔 — 없으면 판이 공중에 떠 보인다
          ...Array.from({ length: 7 }, (_, i) => ({
            크기: [0.16, 0.9, 1.5],
            위치: [
              -길이 / 2 + 5 + (i * (길이 - 10)) / 6,
              창위 + 1.15,
              sz * (폭 / 2 - 1.0),
            ],
          })),
        ]),
      ),
    [],
  );

  // ── 좌석 ────────────────────────────────────────────────
  // [1인용으로 바꾼 이유]
  //   예전 좌석은 폭 2.9유닛(≈0.87m)짜리 2인 벤치였다. 통로가 좁아 보이고
  //   덩어리가 커서 '상자를 놓은 것'처럼 읽혔다. 1인용으로 줄이면 사이가 트여
  //   객차가 넓어 보이고, 좌석 하나하나의 모양도 눈에 들어온다.
  //
  // [마주 보게 놓는 이유]
  //   전부 같은 방향이면 통근 열차다. 네 자리가 마주 보면 **누군가 여기 앉아
  //   이야기를 나눴다**는 자리가 되고, 그 사이 빈 공간이 곧 무대가 된다.
  //   방탈출에서 단서를 놓기에도 마주 보는 자리가 훨씬 쓸모 있다.
  //
  // [치수 근거]  1유닛 ≈ 0.30m
  //   폭 1.55 ≈ 0.47m · 깊이 1.7 ≈ 0.51m · 앉는 높이 1.5 ≈ 0.45m
  //   등받이 위 4.4 ≈ 1.32m (앉은 사람 어깨 위)
  const 좌석자리 = useMemo(() => {
    const 목록 = [];
    for (let g = 0; g < T.좌석묶음수; g++) {
      const 기준 = -길이 / 2 + T.좌석시작 + g * T.묶음간격;
      // 한 묶음 = 마주 보는 두 줄. 앞줄은 +x, 뒷줄은 -x 를 본다.
      for (const [줄, 방향] of [
        [0, 1],
        [1, -1],
      ]) {
        const x = 기준 + 줄 * T.마주간격;
        if (x > 길이 / 2 - 4) continue;
        for (const sz of [-1, 1]) {
          목록.push({ x, z: sz * (폭 / 2 - T.좌석벽간격), 방향 });
        }
      }
    }
    return 목록;
  }, [T.좌석묶음수, T.묶음간격, T.마주간격, T.좌석시작, T.좌석벽간격]);

  // 좌석 하나를 만드는 함수. 재질별로 나눠 담는다(천 / 틀 / 팔걸이).
  //   ★ 등받이를 8° 뒤로 눕힌다. 반듯하면 사무용 의자처럼 보인다.
  const 좌석부품 = useMemo(() => {
    const K = T.좌석크기; // 크기 배율 — 모든 치수에 곱한다
    const N = 4; // 얼룩 아틀라스 격자 (4×4 = 16칸)
    const 천 = [],
      틀 = [],
      팔 = [];
    // ★ 좌석마다 다른 칸을 쓴다 → 얼룩·찢김이 다 다르게 보인다.
    //   한 좌석의 앉는 면·등받이·머리받침은 같은 칸(같은 좌석은 같은 천)이다.
    let 좌석i = 0;
    for (const { x, z, 방향 } of 좌석자리) {
      const d = 방향; // +1 = +x 를 본다 → 등받이는 -x 쪽
      const 칸 = { uv칸: [좌석i % N, (좌석i / N | 0) % N], uv칸수: N };
      좌석i++;
      // ① 앉는 면 — 두 겹으로 쌓아 앞쪽 모서리를 둥글게 보이게 한다
      천.push({ 크기: [1.7 * K, 0.34 * K, 1.55 * K], 위치: [x, 1.52 * K, z], ...칸 });
      천.push({
        크기: [1.5 * K, 0.18 * K, 1.4 * K],
        위치: [x + d * 0.1 * K, 1.74 * K, z],
        ...칸,
      });
      // ② 등받이 — 뒤로 8° 눕힘. 반듯하면 사무용 의자처럼 보인다
      천.push({
        크기: [0.42 * K, 2.5 * K, 1.55 * K],
        위치: [x - d * 0.78 * K, 2.95 * K, z],
        회전: [0, 0, d * 0.14],
        ...칸,
      });
      // ③ 머리 받침 — 등받이보다 좁고 짧다. 이게 있어야 '열차 좌석'이 된다
      천.push({
        크기: [0.4 * K, 0.85 * K, 1.15 * K],
        위치: [x - d * 1.06 * K, 4.32 * K, z],
        회전: [0, 0, d * 0.14],
        ...칸,
      });
      // ④ 팔걸이 — 양옆. 가로 + 세로 두 토막이라야 널빤지로 안 보인다
      for (const s2 of [-1, 1]) {
        팔.push({
          크기: [1.5 * K, 0.16 * K, 0.15 * K],
          위치: [x + d * 0.05 * K, 2.42 * K, z + s2 * 0.82 * K],
        });
        팔.push({
          크기: [0.16 * K, 0.62 * K, 0.15 * K],
          위치: [x - d * 0.62 * K, 2.1 * K, z + s2 * 0.82 * K],
        });
      }
      // ⑤ 다리 — 가운데 기둥 + 바닥 받침판. 금 간 플라스틱 텍스처가 여기 입혀진다
      틀.push({ 크기: [0.42 * K, 1.3 * K, 0.42 * K], 위치: [x, 0.72 * K, z], ...칸 });
      틀.push({ 크기: [1.3 * K, 0.16 * K, 1.15 * K], 위치: [x, 0.1 * K, z], ...칸 });
      // ⑥ 등받이 뒤 손잡이 — 지나가며 잡는 봉. 작지만 이게 밀도를 만든다
      틀.push({
        크기: [0.14 * K, 0.14 * K, 1.3 * K],
        위치: [x - d * 1.02 * K, 4.82 * K, z],
        ...칸,
      });
    }
    return { 천: 상자합치기(천), 틀: 상자합치기(틀), 팔: 상자합치기(팔) };
  }, [좌석자리, T.좌석크기]);

  // ── 이동 규칙 ───────────────────────────────────────────
  const 경계 = useCallback(
    () => ({
      xmin: -길이 / 2 + R + 0.4,
      xmax: 길이 / 2 - R - 0.4,
      zmin: -폭 / 2 + R + 0.4,
      zmax: 폭 / 2 - R - 0.4,
    }),
    [],
  );
  // 좌석 충돌 — 지오메트리와 **같은 자리 목록**에서 만든다.
  //   따로 계산하면 좌석 값을 바꿀 때마다 눈에 보이는 것과 못 지나가는 곳이 어긋난다.
  const 좌석박스 = useMemo(
    () =>
      좌석자리.map(({ x, z, 방향 }) => {
        const K = T.좌석크기;
        return {
          minX: x - (방향 > 0 ? 1.3 : 1.0) * K,
          maxX: x + (방향 > 0 ? 1.0 : 1.3) * K,
          minZ: z - 0.95 * K,
          maxZ: z + 0.95 * K,
        };
      }),
    [좌석자리, T.좌석크기],
  );
  const 막힘 = useCallback(
    (x, z) =>
      좌석박스.some(
        (c) => x > c.minX - R && x < c.maxX + R && z > c.minZ - R && z < c.maxZ + R,
      ),
    [좌석박스],
  );

  // 들어온 그 문 앞에 오면 '내리기' 안내를 띄운다
  const onNearRef = useRef(onNear);
  onNearRef.current = onNear;
  const 근처 = useCallback((p) => {
    const d = Math.hypot(p.x - 문x, p.z - 문z);
    const n = d < 4.5 ? "기차나가기" : "";
    onNearRef.current(n);
    return n;
  }, []);

  use이동(active, {
    경계,
    막힘,
    근처,
    // 문 안쪽 한 걸음 자리에 선다
    시작: [문x, undefined, 문z + 2.6],
    // ★ 객차가 x 축으로 길다. 카메라 기본 시선(-z)을 그대로 두면 옆벽을
    //   코앞에서 마주보게 된다 → 객차가 뻗은 쪽(+x)을 보게 돌린다.
    바라봄: -Math.PI / 2,
  });

  const 판 = (색) => (
    <meshToonMaterial color={밝(색)} gradientMap={TOON_GRADIENT} />
  );

  return (
    <>
      <color attach="background" args={["#0e1116"]} />
      {/* 역과 같은 안개 — 씬이 바뀌어도 공기가 같아야 한 세계로 읽힌다 */}
      <fog attach="fog" args={[T.안개색, T.안개시작, T.안개끝]} />
      <ambientLight intensity={T.밑빛 * T.밝기} color="#b9c4d4" />
      {/* 위아래로 살짝 갈라 주는 빛 — 천장·바닥이 같은 톤이면 공간이 납작해 보인다 */}
      <hemisphereLight args={["#aab6c6", "#2f343b", 0.35 * T.밝기]} />

      {/* 텔레포트 장치 — 기차 안 소품(위치·크기·회전·발광 전부 Leva 「텔레포트 장치」에서 조절) */}
      <텔레포트장치 선={선} />
      {/* 텔레포트 장치가 쏘는 목적지 홀로그램(나주 · 클릭 가능) */}
      <홀로그램스크린 />

      {등목록.map((L, i) => (
        <형광등
          key={`lamp${i}`}
          x={L.x}
          상태={L.상태}
          세기={T.천장등세기 * 70}
          등색={T.등색}
          꺼진색={T.꺼진등색}
          밝기={T.밝기}
          깨짐맵={깨진등맵}
          uv칸={[i % 4, (i / 4 | 0) % 4]}
        />
      ))}

      {/* 바닥 */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[길이, 0.2, 폭]} />
        <meshToonMaterial
          map={바닥반복}
          color={밝(T.바닥색)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>

      {/* 천장 */}
      <mesh position={[0, 높이 + 0.1, 0]}>
        <boxGeometry args={[길이, 0.2, 폭]} />
        <meshToonMaterial
          map={벽반복}
          color={밝(T.천장색)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>

      {/* 양옆 벽 — 창 띠(창아래~창위)만 비우고 위·아래는 막는다 */}
      {[-1, 1].map((sz) => (
        <group key={`wall${sz}`}>
          {/* 창 아래 — 역의 '벽 아랫단'과 같은 규칙으로 한 톤 어둡게.
              허리 아래가 조금 어두우면 공간이 바닥에 붙어 보여 안정된다. */}
          <mesh position={[0, 창아래 / 2, sz * (폭 / 2 + 0.1)]} receiveShadow>
            <boxGeometry args={[길이, 창아래, 0.2]} />
            <meshToonMaterial
              map={벽반복}
              color={밝(T.아랫단색)}
              gradientMap={TOON_GRADIENT}
            />
          </mesh>
          {/* 창 위 */}
          <mesh position={[0, (창위 + 높이) / 2, sz * (폭 / 2 + 0.1)]} receiveShadow>
            <boxGeometry args={[길이, 높이 - 창위, 0.2]} />
            <meshToonMaterial
              map={벽반복}
              color={밝(T.차체색)}
              gradientMap={TOON_GRADIENT}
            />
          </mesh>
        </group>
      ))}

      {/* 창과 창 사이 */}
      <mesh geometry={기둥} receiveShadow>
        <meshToonMaterial
          map={벽반복}
          color={밝(T.차체색)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>

      {/* 창밖 배경판 — 창문 뒤에 수사본부 파노라마를 둬서 '안에서 밖이 보이게'.
          meshBasic + toneMapped=false = 조명과 무관하게 늘 같은 밝기(바깥에서 든 빛처럼).
          기둥(창 사이 벽)이 가려 주므로 창 자리에서만 보인다. */}
      {T.창밖보이기 &&
        [-1, 1].map((sz) => {
          // 입구(문)는 -z 벽(sz=-1). 그쪽만 수사본부 이미지, 반대편은 어둠+희미한 빛.
          const 입구쪽 = sz === -1;
          return (
            <mesh
              key={`창밖${sz}`}
              position={[0, (창위 + 창아래) / 2, sz * (폭 / 2 + 1.6)]}
              rotation={[0, sz === 1 ? Math.PI : 0, 0]}
            >
              <planeGeometry args={[길이 + 6, 창위 - 창아래 + 2.4]} />
              <meshBasicMaterial
                map={입구쪽 ? 창밖맵 : 창밖어둠맵}
                color={색밝기("#ffffff", 입구쪽 ? T.창밖밝기 : 1)}
                toneMapped={false}
              />
            </mesh>
          );
        })}

      {/* 유리 — 자판기 투명문에 쓴 그 재질 그대로.
          그림(밤 반사 텍스처)을 얹어 반투명하게 만들던 것을 걷어냈다. 그림이
          비쳐 보이는 대신 어른거리는 판때기처럼 읽혔다. 이제는 자판기 문처럼
          **아무것도 안 그린 맑은 유리막**이라, 뒤의 창밖 배경이 그대로 보인다.
          외곽선은 두르지 않는다 — 유리에 테두리가 생기면 판때기로 보인다. */}
      {유리입구 && (
        <mesh geometry={유리입구}>
          <meshBasicMaterial
            color={창유리색}
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      {/* 반대쪽 유리 — 같은 유리다. 양쪽을 다르게 둘 이유가 없다. */}
      {유리반대 && (
        <mesh geometry={유리반대}>
          <meshBasicMaterial
            color={창유리색}
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* 판자로 막은 창 — 틈으로 유리(비친 빛)가 새어 보인다 */}
      {판자 && (
        <mesh geometry={판자} castShadow receiveShadow>
          {판(T.판자색)}
          {선긋기}
        </mesh>
      )}

      {/* 양 끝 벽 — 그냥 막힌 벽이다.
          ★ 예전엔 여기에 '연결통로 문'을 그렸는데, 그게 **진짜 출입문처럼 보여서**
            나가는 곳을 헷갈리게 했다. 출입문은 옆벽(창문 쪽)에 하나뿐이다.
            벽에도 같은 질감을 입혀 '여긴 그냥 벽'으로 읽히게 한다. */}
      {[-1, 1].map((sx) => (
        <mesh
          key={`end${sx}`}
          position={[sx * (길이 / 2 + 0.1), 높이 / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[0.2, 높이, 폭]} />
          <meshToonMaterial
            map={벽반복}
            color={밝(T.차체색)}
            gradientMap={TOON_GRADIENT}
          />
        </mesh>
      ))}

      {/* ═══ 출입문 — 들어온 그 자리. 옆벽(-z) ═══
          ★ 문틀·문짝을 걷어냈다.
            기차 문은 **바깥에서 옆으로 열린다.** 안쪽에 굵은 문틀이 서 있고
            그 옆에 문짝이 붙어 있으면 '실내에 설치한 문'처럼 보인다.
            실제 객차는 벽이 그대로 이어지다가 그 구간만 뚫려 있고,
            테두리에 얇은 마감선 하나가 있을 뿐이다. 그렇게 다시 만들었다. */}
      <group position={[문x, 0, 문z]}>
        {/* 얇은 마감 테두리 — 벽 두께(0.2)보다 아주 조금만 튀어나온다.
            굵게 만들면 그게 곧 '문틀'이 되어 버린다. */}
        {[-1, 1].map((s2) => (
          <mesh
            key={`edge${s2}`}
            position={[s2 * (문폭 / 2 + 0.07), 문높이 / 2, 0.06]}
            castShadow
          >
            <boxGeometry args={[0.14, 문높이, 0.34]} />
            {판(T.차체색)}
            {선긋기}
          </mesh>
        ))}
        <mesh position={[0, 문높이 + 0.07, 0.06]} castShadow>
          <boxGeometry args={[문폭 + 0.28, 0.14, 0.34]} />
          {판(T.차체색)}
          {선긋기}
        </mesh>

        {/* 문턱 — 바닥과 승강장 사이 낮은 턱. 여기가 '나가는 곳'을 알려 준다 */}
        <mesh position={[0, 0.09, -0.05]} receiveShadow>
          <boxGeometry args={[문폭, 0.18, 0.9]} />
          {판(T.문색)}
          {선긋기}
        </mesh>

        {/* 문 밖 — 캄캄하게 막는다. toneMapped=false 라 실내 조명과 무관하게 늘 어둡다.
            여기를 뚫어 두면 객차 바깥의 아무것도 없는 공간이 그대로 보인다. */}
        <mesh position={[0, 문높이 / 2, -0.55]}>
          <boxGeometry args={[문폭 - 0.1, 문높이 - 0.1, 0.2]} />
          <meshBasicMaterial color="#0a0d12" toneMapped={false} />
        </mesh>
      </group>

      {/* 창틀 · 짐 선반 · 좌석 */}
      <mesh geometry={창틀} castShadow receiveShadow>
        {판(T.창틀색)}
        {선긋기}
      </mesh>
      <mesh geometry={선반} castShadow>
        {판(T.선반색)}
        {선긋기}
      </mesh>
      {/* 좌석 — 재질별로 세 덩어리. 색이 나뉘어야 한 상자로 안 보인다 */}
      {좌석부품.천 && (
        <mesh geometry={좌석부품.천} castShadow receiveShadow>
          <meshToonMaterial
            map={좌석천맵}
            color={밝(T.좌석천색)}
            gradientMap={TOON_GRADIENT}
          />
          {선긋기}
        </mesh>
      )}
      {좌석부품.틀 && (
        <mesh geometry={좌석부품.틀} castShadow receiveShadow>
          <meshToonMaterial
            map={균열맵}
            color={밝(T.좌석틀색)}
            gradientMap={TOON_GRADIENT}
          />
          {선긋기}
        </mesh>
      )}
      {좌석부품.팔 && (
        <mesh geometry={좌석부품.팔} castShadow receiveShadow>
          {판(T.팔걸이색)}
          {선긋기}
        </mesh>
      )}

      {/* ═══════════════════════════════════════════════════
          ★ 여기에 3D 를 넣는다 (좌석 모델 · 텔레포트 장치 등)
          ═══════════════════════════════════════════════════
          [쓰는 법]
            import { useGLTF } from "@react-three/drei";
            useGLTF.preload("/models/train_seat.glb");
            const { scene } = useGLTF("/models/train_seat.glb");
            <primitive object={scene.clone(true)} />
            ※ 같은 모델을 여러 개 놓을 거면 반드시 clone(true) 로 복제한다.
              원본을 그대로 여러 번 쓰면 하나를 고칠 때 전부 같이 바뀐다. */}
    </>
  );
}
