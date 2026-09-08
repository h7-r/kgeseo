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
import { useFrame } from "@react-three/fiber";
import {
  TOON_GRADIENT,
  색밝기,
  makeRandom,
  상자합치기,
  useSavedControls,
  선스키마,
  선뽑기,
  만화선,
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
    // 얼룩 · 긁힌 자국
    for (let i = 0; i < 46; i++)
      둥근얼룩(
        g,
        S,
        rnd() * S,
        rnd() * S,
        20 + rnd() * 120,
        rnd() < 0.6 ? "72,66,56" : "255,255,255",
        0.02 + rnd() * 0.05,
      );
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = `rgba(96,90,80,${0.06 + rnd() * 0.12})`;
      g.lineWidth = 0.8 + rnd() * 1.4;
      const x = rnd() * S,
        y = rnd() * S,
        L = 6 + rnd() * 40,
        a = rnd() * 6.2832;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.stroke();
    }
    질감얹기(g, S, S, seed + 90, 1.1);
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

function 형광등({ x, 상태, 세기, 등색, 꺼진색, 밝기 }) {
  const 빛 = useRef(null);
  const 판 = useRef(null);
  const 기본 = useMemo(() => new THREE.Color(등색), [등색]);
  const 꺼짐 = useMemo(() => new THREE.Color(꺼진색), [꺼진색]);

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
      {/* 등판 — toneMapped=false 라 이 색이 화면에 그대로 찍히고 블룸이 번진다 */}
      <mesh ref={판}>
        <boxGeometry args={[6.4, 0.22, 1.7]} />
        <meshBasicMaterial color={등색} toneMapped={false} />
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
    차체색: "#4e5663",
    아랫단색: "#454b57", // 허리 아래 — 역의 '벽 아랫단' 규칙과 같다
    바닥색: "#3b3e44",
    천장색: "#525761",
    // ★ 좌석은 회색 계열로. 갈색 계열은 방(수사본부)의 나무 가구와 겹쳐서
    //   기차 좌석이 '방에서 옮겨 온 의자'처럼 보였다.
    좌석천색: "#6a6e75", // 앉는 면·등받이 천
    좌석천색2: "#5f636a", // 등받이 — 천을 두 톤으로 나눠야 한 덩어리로 안 보인다
    좌석틀색: "#454a52", // 프레임 · 다리 · 받침
    팔걸이색: "#3c4046", // 팔걸이 · 손잡이
    창틀색: "#3e434c",
    선반색: "#464c56",
    문색: "#454b55",
    // ── 밝기 ───────────────────────────────────────────────
    //   역은 「스탠드(공통) → 전체어둡게 0.73」로 전체를 눌러 놓았다.
    //   기차만 밝으면 밖에서 들어왔을 때 눈이 부시고 화풍이 끊긴다.
    밝기: { value: 0.62, min: 0.2, max: 2, step: 0.02 },
    천장등세기: { value: 1.0, min: 0, max: 4, step: 0.05 },
    // 밑빛이 세면 그림자가 지워져 툰 재질의 밝기 단이 안 보이고 종이처럼 납작해진다.
    //   역의 기본광이 0.29 다. 거기 맞춰 낮게 둔다.
    밑빛: { value: 0.34, min: 0, max: 3, step: 0.02 },
    // ── 전등 상태 ──────────────────────────────────────────
    등개수: { value: 6, min: 2, max: 12, step: 1 },
    등색: "#f0e6cd",
    꺼진등색: "#2b2f36",
    죽은등비율: { value: 0.25, min: 0, max: 1, step: 0.05 },
    깜빡등비율: { value: 0.35, min: 0, max: 1, step: 0.05 },
    등시드: { value: 3, min: 1, max: 99, step: 1 },
    // 깜빡임 주기(초). 27이면 1분에 두 번쯤. 등마다 ±20% 흩어진다.
    깜빡주기: { value: 27, min: 6, max: 60, step: 1 },
    // ── 질감 ───────────────────────────────────────────────
    벽시드: { value: 21, min: 1, max: 999, step: 1 },
    벽낡음: { value: 1.1, min: 0, max: 2, step: 0.05 },
    바닥시드: { value: 77, min: 1, max: 999, step: 1 },
    // ── 창 ─────────────────────────────────────────────────
    유리색: "#151a22",
    반사색: "#c2b18b",
    반사세기: { value: 0.45, min: 0, max: 1, step: 0.02 },
    유리얼룩: { value: 1, min: 0, max: 2, step: 0.05 },
    유리밝기: { value: 0.85, min: 0.2, max: 2, step: 0.05 },
    막힌창비율: { value: 0.3, min: 0, max: 1, step: 0.05 },
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
    좌석크기: { value: 1.25, min: 0.7, max: 1.8, step: 0.05 },
    // ── 안개 — 역과 같은 공기 ──────────────────────────────
    안개색: "#aeb8c8",
    안개시작: { value: 20, min: 0, max: 120, step: 1 },
    안개끝: { value: 120, min: 20, max: 400, step: 1 },
    ...선스키마({ 굵기: 3, 색: "#12151a", 주름: true, 각도: 45, 주름색: "#191d25" }),
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

  const 막힌창 = useMemo(() => {
    const rnd = makeRandom(T.창시드 * 977 + 13);
    return 창x목록.map(() => rnd() < T.막힌창비율);
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
  const 유리 = useMemo(
    () =>
      상자합치기(
        창x목록.flatMap((x) =>
          [-1, 1]
            .filter((sz) => !(sz === -1 && 문겹침(x)))
            .map((sz) => ({
              크기: [창폭 - 0.5, 창위 - 창아래 - 0.5, 0.04],
              위치: [x, (창위 + 창아래) / 2, sz * (폭 / 2 + 0.15)],
            })),
        ),
      ),
    [창x목록],
  );

  //   각도를 조금씩 틀어야 '급하게 대충 막았다'가 된다. 반듯하면 창틀로 보인다.
  const 판자 = useMemo(() => {
    const rnd = makeRandom(T.창시드 * 31 + 7);
    const 상자 = [];
    창x목록.forEach((x, i) => {
      if (!막힌창[i]) return;
      for (const sz of [-1, 1]) {
        if (sz === -1 && 문겹침(x)) continue;
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
    const 천 = [],
      틀 = [],
      팔 = [];
    for (const { x, z, 방향 } of 좌석자리) {
      const d = 방향; // +1 = +x 를 본다 → 등받이는 -x 쪽
      // ① 앉는 면 — 두 겹으로 쌓아 앞쪽 모서리를 둥글게 보이게 한다
      천.push({ 크기: [1.7 * K, 0.34 * K, 1.55 * K], 위치: [x, 1.52 * K, z] });
      천.push({
        크기: [1.5 * K, 0.18 * K, 1.4 * K],
        위치: [x + d * 0.1 * K, 1.74 * K, z],
      });
      // ② 등받이 — 뒤로 8° 눕힘. 반듯하면 사무용 의자처럼 보인다
      천.push({
        크기: [0.42 * K, 2.5 * K, 1.55 * K],
        위치: [x - d * 0.78 * K, 2.95 * K, z],
        회전: [0, 0, d * 0.14],
      });
      // ③ 머리 받침 — 등받이보다 좁고 짧다. 이게 있어야 '열차 좌석'이 된다
      천.push({
        크기: [0.4 * K, 0.85 * K, 1.15 * K],
        위치: [x - d * 1.06 * K, 4.32 * K, z],
        회전: [0, 0, d * 0.14],
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
      // ⑤ 다리 — 가운데 기둥 + 바닥 받침판. 네 다리보다 열차 좌석다운 모양이다
      틀.push({ 크기: [0.42 * K, 1.3 * K, 0.42 * K], 위치: [x, 0.72 * K, z] });
      틀.push({ 크기: [1.3 * K, 0.16 * K, 1.15 * K], 위치: [x, 0.1 * K, z] });
      // ⑥ 등받이 뒤 손잡이 — 지나가며 잡는 봉. 작지만 이게 밀도를 만든다
      틀.push({
        크기: [0.14 * K, 0.14 * K, 1.3 * K],
        위치: [x - d * 1.02 * K, 4.82 * K, z],
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

      {등목록.map((L, i) => (
        <형광등
          key={`lamp${i}`}
          x={L.x}
          상태={L.상태}
          세기={T.천장등세기 * 70}
          등색={T.등색}
          꺼진색={T.꺼진등색}
          밝기={T.밝기}
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

      {/* 밤 유리 — 밖이 아니라 실내가 비친다.
          toneMapped=false = 톤 매핑을 건너뛴다. 이건 '빛을 받는 물체'가 아니라
          '비친 상'이라 실내 조명을 올렸다고 같이 밝아지면 안 된다.
          외곽선은 두르지 않는다 — 유리에 테두리가 생기면 판때기로 보인다. */}
      {유리 && (
        <mesh geometry={유리}>
          <meshBasicMaterial
            map={유리맵}
            color={색밝기("#ffffff", T.유리밝기)}
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
          {판(T.좌석천색)}
          {선긋기}
        </mesh>
      )}
      {좌석부품.틀 && (
        <mesh geometry={좌석부품.틀} castShadow receiveShadow>
          {판(T.좌석틀색)}
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
