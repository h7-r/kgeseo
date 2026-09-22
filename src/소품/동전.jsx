// 동전.jsx — 자판기용 동전(토큰). 게임 톤(툰 + 외곽선 + 세월감)에 맞춘 낡은 주화.
//
// [축] 원통을 눕혀 쓰면 동전이 된다. 눕힘=true 면 바닥에 놓인 자세(면이 위를 봄).
// [구조] 원통(disc). 면3개를 다른 재질로: ⓪옆면(빗살) ①윗면(무늬) ②아랫면(무늬).
//   ★ 무늬는 캔버스 텍스처로 굽는다(게임의 라벨·간판과 같은 방식).
//   ★ 색·무늬는 prop 으로 바꾼다 — 동전 2종을 값만 달리해 찍어낸다.

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { TOON_GRADIENT, 만화선, 색밝기 } from "../공용.jsx";

// 작은 시드 난수 — 세월 얼룩·기스를 매번 같은 모양으로(캐시 친화)
function 씨앗난수(seed) {
  let t = (seed >>> 0) || 1;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// 모서리 둥근 네모 경로(arcTo — roundRect 미지원 환경에서도 안전)
function 둥근네모(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ── 무늬 그리기 ─────────────────────────────────────────────
//   중앙 심볼. 무늬 종류에 따라 캔 / 종이컵 / 별 / 열쇠구멍을 새긴다(음각 느낌).
function 무늬그리기(g, cx, cy, R, 무늬, 진, 밝) {
  g.save();
  g.translate(cx, cy);
  if (무늬 === "캔") {
    // 음료 캔 — 세로 원기둥 실루엣(모서리 둥근 몸통 + 윗뚜껑 + 따개 + 라벨 띠)
    //   ★ 캡 UV 가 ~90° 돌아가서, 캔이 세로로 서 보이게 캔버스에선 미리 −90° 돌린다
    //     (뚜껑이 위로 오도록).
    g.rotate(-Math.PI / 2);
    const w = R * 0.5,
      h = R * 0.98;
    const 뚜껑y = -h / 2;
    // 몸통
    둥근네모(g, -w / 2, 뚜껑y + R * 0.06, w, h - R * 0.06, w * 0.24);
    g.fillStyle = 진;
    g.fill();
    // 윗뚜껑(타원)
    g.beginPath();
    g.ellipse(0, 뚜껑y + R * 0.06, w / 2, R * 0.09, 0, 0, Math.PI * 2);
    g.fill();
    // 따개 구멍(밝게 파냄)
    g.fillStyle = 밝;
    g.beginPath();
    g.ellipse(R * 0.07, 뚜껑y + R * 0.05, w * 0.17, R * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    // 라벨 띠 — 가운데 밝은 가로선 두 줄
    g.strokeStyle = 밝;
    g.lineWidth = R * 0.035;
    for (const dy of [-R * 0.08, R * 0.12]) {
      g.beginPath();
      g.moveTo(-w / 2 + R * 0.03, dy);
      g.lineTo(w / 2 - R * 0.03, dy);
      g.stroke();
    }
  } else if (무늬 === "종이컵") {
    // 종이컵 — 위가 넓고 아래가 좁은 사다리꼴 + 윗 테두리(림) + 김 두 줄
    const tw = R * 0.46,
      bw = R * 0.29,
      h = R * 0.82;
    const top = -h / 2 + R * 0.06,
      bot = h / 2;
    g.beginPath();
    g.moveTo(-tw, top);
    g.lineTo(tw, top);
    g.lineTo(bw, bot);
    g.lineTo(-bw, bot);
    g.closePath();
    g.fillStyle = 진;
    g.fill();
    // 윗 테두리(림) — 밝은 타원
    g.lineWidth = R * 0.05;
    g.strokeStyle = 밝;
    g.beginPath();
    g.ellipse(0, top, tw, R * 0.08, 0, 0, Math.PI * 2);
    g.stroke();
    // 컵 허리 밝은 띠
    g.lineWidth = R * 0.03;
    g.beginPath();
    g.moveTo(-tw * 0.78, top + h * 0.42);
    g.lineTo(tw * 0.78, top + h * 0.42);
    g.stroke();
    // 김(스팀) 두 줄 — 컵 위로 물결
    g.lineWidth = R * 0.03;
    for (const sx of [-R * 0.16, R * 0.16]) {
      g.beginPath();
      g.moveTo(sx, top - R * 0.12);
      g.bezierCurveTo(
        sx + R * 0.12, top - R * 0.28,
        sx - R * 0.12, top - R * 0.4,
        sx + R * 0.02, top - R * 0.56,
      );
      g.stroke();
    }
  } else if (무늬 === "열쇠구멍") {
    // 열쇠구멍 — 비밀 복도에 어울리는 상징(원 + 아래 사다리꼴)
    const r = R * 0.32;
    g.beginPath();
    g.arc(0, -R * 0.12, r, 0, Math.PI * 2);
    g.fillStyle = 진;
    g.fill();
    g.beginPath();
    g.moveTo(-r * 0.62, -R * 0.12);
    g.lineTo(-r * 0.95, R * 0.55);
    g.lineTo(r * 0.95, R * 0.55);
    g.lineTo(r * 0.62, -R * 0.12);
    g.closePath();
    g.fill();
    // 음각 하이라이트(아래쪽 밝은 테)
    g.strokeStyle = 밝;
    g.lineWidth = R * 0.03;
    g.beginPath();
    g.arc(0, -R * 0.12, r, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  } else {
    // 별 — 5각 별
    const 외 = R * 0.5,
      내 = R * 0.21;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? 내 : 외;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * rr,
        y = Math.sin(a) * rr;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = 진;
    g.fill();
    g.strokeStyle = 밝;
    g.lineWidth = R * 0.025;
    g.stroke();
  }
  g.restore();
}

const _동전텍캐시 = new Map();
function 동전텍스처(무늬 = "별", 색 = "#b6923f", 무늬색 = "#6f531f", seed = 3) {
  const 키 = `${무늬}:${색}:${무늬색}:${seed}`;
  if (_동전텍캐시.has(키)) return _동전텍캐시.get(키);
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  const rnd = 씨앗난수(seed * 131 + 9);
  const cx = S / 2,
    cy = S / 2,
    R = S * 0.46;
  const 밝은 = 색밝기(색, 1.22),
    어두운 = 색밝기(색, 0.72),
    진한 = 색밝기(무늬색, 0.85),
    무늬밝 = 색밝기(색, 1.35);

  // 바탕(투명) — 원 밖은 안 그린다(캡 UV는 사각이지만 원만 보이게)
  g.clearRect(0, 0, S, S);

  // ① 금속 바탕 — 가운데가 밝고 가장자리가 어두운 라디얼(볼록한 주화 느낌)
  const mg = g.createRadialGradient(cx, cy - R * 0.15, R * 0.1, cx, cy, R);
  mg.addColorStop(0, 밝은);
  mg.addColorStop(0.7, 색);
  mg.addColorStop(1, 어두운);
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fillStyle = mg;
  g.fill();

  // ② 테두리 — 두 겹(바깥 어두운 테 + 안쪽 얇은 밝은 선)
  g.lineWidth = R * 0.06;
  g.strokeStyle = 어두운;
  g.beginPath();
  g.arc(cx, cy, R * 0.965, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = R * 0.02;
  g.strokeStyle = 무늬밝;
  g.beginPath();
  g.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
  g.stroke();

  // ③ 구슬 테(beaded rim) — 테 안쪽에 작은 점을 빙 둘러
  const 점수 = 40;
  for (let i = 0; i < 점수; i++) {
    const a = (i / 점수) * Math.PI * 2;
    const rr = R * 0.86;
    const x = cx + Math.cos(a) * rr,
      y = cy + Math.sin(a) * rr;
    g.beginPath();
    g.arc(x, y, R * 0.022, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? 진한 : 무늬밝;
    g.fill();
  }

  // ④ 중앙 무늬
  무늬그리기(g, cx, cy, R * 0.9, 무늬, 진한, 무늬밝);

  // ⑤ 세월 — 옅은 얼룩·기스(원 안에서만)
  g.save();
  g.beginPath();
  g.arc(cx, cy, R * 0.96, 0, Math.PI * 2);
  g.clip();
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S,
      y = rnd() * S,
      r = 8 + rnd() * 26;
    const 톤 = rnd() < 0.5 ? "255,255,255" : "20,16,8";
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${톤},${(0.05 + rnd() * 0.08).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${톤},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = `rgba(30,22,10,${(0.08 + rnd() * 0.12).toFixed(3)})`;
    g.lineWidth = 0.6 + rnd() * 1.1;
    const x0 = rnd() * S,
      y0 = rnd() * S;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + (rnd() - 0.5) * 60, y0 + (rnd() - 0.5) * 60);
    g.stroke();
  }
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _동전텍캐시.set(키, t);
  return t;
}

// ── 옆면 빗살(reeded edge) 텍스처 — 동전 옆면의 세로 줄무늬 ──
const _옆캐시 = new Map();
function 옆면텍스처(색 = "#b6923f") {
  if (_옆캐시.has(색)) return _옆캐시.get(색);
  const W = 256,
    H = 16;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = 색밝기(색, 0.82);
  g.fillRect(0, 0, W, H);
  const 줄 = 90;
  for (let i = 0; i < 줄; i++) {
    const x = (i / 줄) * W;
    g.strokeStyle = i % 2 ? 색밝기(색, 1.15) : 색밝기(색, 0.6);
    g.lineWidth = W / 줄 / 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  _옆캐시.set(색, t);
  return t;
}

export function 동전({
  위치 = [0, 0, 0],
  회전 = [0, 0, 0],
  반지름 = 0.42,
  두께 = 0.09,
  색 = "#b6923f", // 놋쇠(brass)
  무늬색 = "#6f531f",
  무늬 = "별", // "별" | "열쇠구멍"
  눕힘 = true, // 바닥에 눕힌 자세(면이 위)
  밝기 = 1,
  선,
  ...rest
}) {
  const 밝 = (v) => 색밝기(색, v * 밝기);
  const geo = useMemo(
    () => new THREE.CylinderGeometry(반지름, 반지름, 두께, 44, 1),
    [반지름, 두께],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const 면텍 = useMemo(() => 동전텍스처(무늬, 색, 무늬색), [무늬, 색, 무늬색]);
  const 옆텍 = useMemo(() => 옆면텍스처(색), [색]);

  // 원통 그룹 순서: [옆면, 윗면, 아랫면]
  const 재질들 = useMemo(
    () => [
      new THREE.MeshToonMaterial({ map: 옆텍, gradientMap: TOON_GRADIENT }),
      new THREE.MeshToonMaterial({
        map: 면텍,
        gradientMap: TOON_GRADIENT,
        transparent: true,
      }),
      new THREE.MeshToonMaterial({
        map: 면텍,
        gradientMap: TOON_GRADIENT,
        transparent: true,
      }),
    ],
    [면텍, 옆텍],
  );
  useEffect(() => () => 재질들.forEach((m) => m.dispose()), [재질들]);

  // 눕힘: 원통 축(y)을 그대로 두면 면이 위를 본다 → 바닥에 놓인 동전.
  //   세울 때(눕힘=false)는 x로 90° 눕혀 면이 정면을 보게 한다.
  const 자세 = 눕힘 ? [0, 0, 0] : [Math.PI / 2, 0, 0];
  return (
    <group position={위치} rotation={회전} {...rest}>
      <group rotation={자세}>
        <mesh geometry={geo} material={재질들} castShadow receiveShadow>
          {/* 외곽선·주름선 = 게임과 같은 선 값 */}
          <만화선 geo={geo} 선={선} />
        </mesh>
      </group>
    </group>
  );
}
