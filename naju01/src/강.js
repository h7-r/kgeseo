// ═══════════════════════════════════════════════════════════════
//  강.js — 영산강을 '코드로' 만드는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 강이 중요한가]
//   §4 의 C-01 표가 V1(나루터)에서 **「영산강 · 건너편 뱃길 · 절벽 윤곽」** 이
//   보여야 한다고 못박았다. 그리고 §4 아래에 이런 말이 붙어 있다 —
//   「모든 지점에서 강이 보이면 시야 분리 원칙이 무너진다」.
//   즉 강은 **방향 앵커**다. 어디가 남쪽인지, 내가 어느 쪽을 보고 있는지를
//   알려 주는 유일한 지형지물이다. 파란 판 한 장으로는 그 구실을 못 한다.
//
// [무엇을 넣나]
//   ① 물결치는 수면 — 움직여야 물로 읽힌다. 멈춘 물은 파란 바닥일 뿐이다
//   ② 깊이 색 — 물가는 얕아 밝고 바깥은 깊어 어둡다. 이게 '물가'를 만든다
//   ③ 물가 돌 — 뭍과 물이 맞닿는 선이 자로 그은 듯 곧으면 안 된다
//   ④ 건너편 능선 — §4 의 「건너편 뱃길」. Playable Core 밖이라 **원경**이다
//      (§383 이 진부촌을 원경으로 처리한 것과 같은 취급)
//
// [값싸게]
//   수면은 성긴 격자(1 m 당 0.6칸)면 충분하다. 물결은 CPU 로 매 프레임 다시
//   써도 꼭짓점이 몇백 개라 부담이 없다. 나머지는 전부 합쳐 드로우콜 1개씩.
//
// [단위] 좌표·크기는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 돌모양만들기, 색입히기 } from "./바닥.js";
import { 미터 } from "./공간도면.js";

export const 강결 = {
  얕음: "#6E8A86", // 물가 — 바닥이 비쳐 밝고 탁하다
  깊음: "#2E4A5C", // 바깥 — 어둡고 푸르다
  마루: "#93AFAE", // 물결 꼭대기
  물가돌: "#7A756B",
  물가돌어둠: "#403C35",
  건너편: "#59616B", // 원경 — 공기에 씻겨 파랗고 흐리다
  건너편멂: "#79838F",
};

// ── 강 굽이 ─────────────────────────────────────────────────
//   상·하류가 자로 그은 직선이면 강이 아니라 수로다.
//   코어 앞(X 0~80 ± 60 m)에서는 물가를 곧게 둔다 — 걷는 판정(`지면`의 물 경계)이
//   직선이라 그림도 맞춰야 한다. 그 바깥에서만 굽이가 살아난다.
export const 강굽이 = (x) => {
  const 진폭 = THREE.MathUtils.clamp((Math.abs(x - 40) - 60) / 140, 0, 1);
  return 진폭 * (28 * Math.sin(x * 0.011 + 0.8) + 12 * Math.sin(x * 0.027 + 2));
};
// 건너편 물가는 코어 앞에서도 살짝 굽어도 된다(걷는 데와 무관)
export const 건너굽이 = (x) => 18 * Math.sin(x * 0.014 + 1.3) + 강굽이(x);

// ── 수면 ────────────────────────────────────────────────────
//   `갱신(시각)` 을 매 프레임 부르면 물결이 움직인다.
export function 강면만들기({ X, Z시작, Z끝, 칸당 = 0.6, 물결높이 = 0.09 }) {
  const w = X[1] - X[0];
  const d = Z끝 - Z시작;
  const nx = Math.max(2, Math.round(w * 칸당));
  const nz = Math.max(2, Math.round(d * 칸당));
  const geo = new THREE.PlaneGeometry(w * 미터, d * 미터, nx, nz);
  geo.rotateX(-Math.PI / 2);

  const p = geo.attributes.position;
  const 개수 = p.count;
  // 월드 좌표(미터)를 따로 들고 있는다 — 매 프레임 다시 계산하지 않으려고
  const gx = new Float32Array(개수);
  const gz = new Float32Array(개수);
  const 색 = new Float32Array(개수 * 3);
  const cx = (X[0] + X[1]) / 2;
  const cz = (Z시작 + Z끝) / 2;
  const 얕 = new THREE.Color(강결.얕음);
  const 깊 = new THREE.Color(강결.깊음);
  const c = new THREE.Color();
  // 넓은 얼룩 — 물은 어디는 잔잔하고 어디는 잘다. 한 톤이면 '파란 판'이 된다.
  const 얼 = (x, z) =>
    Math.sin(x * 0.035 + 1.7) * Math.sin(z * 0.028 + 0.4) * 0.5 +
    Math.sin(x * 0.011 - z * 0.017) * 0.5;

  for (let i = 0; i < 개수; i++) {
    gx[i] = p.getX(i) / 미터 + cx;
    gz[i] = p.getZ(i) / 미터 + cz;
    // 굽이 — 이쪽 물가는 강굽이, 저쪽 물가는 건너굽이. 사이는 섞는다.
    {
      const t = THREE.MathUtils.clamp((gz[i] - Z시작) / Math.max(0.01, d), 0, 1);
      gz[i] += 강굽이(gx[i]) * (1 - t) + 건너굽이(gx[i]) * t;
      p.setZ(i, (gz[i] - cz) * 미터);
    }
    // 물가에서 멀어질수록 깊어진다 — 이 색 하나가 '물가'를 만든다
    const 깊이 = THREE.MathUtils.clamp(
      (gz[i] - Z시작 - 강굽이(gx[i])) / Math.max(0.01, d),
      0,
      1,
    );
    c.copy(얕).lerp(깊, Math.pow(깊이, 0.6));
    c.offsetHSL(0, 0, 얼(gx[i], gz[i]) * 0.045);
    색[i * 3] = c.r;
    색[i * 3 + 1] = c.g;
    색[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(색, 3));
  geo.translate(cx * 미터, 0, cz * 미터);

  const 마루 = new THREE.Color(강결.마루);
  const 기본색 = 색.slice(); // 물결 마루를 덧칠하기 전 원래 색
  const 임시 = new THREE.Color();
  const 법선 = new Float32Array(개수 * 3);
  geo.setAttribute("normal", new THREE.BufferAttribute(법선, 3));

  // 물결 — 서로 다른 방향·주기의 잔물결 셋을 겹친다.
  //   하나만 쓰면 규칙적인 빨래판이 된다.
  //   ※ 법선은 `computeVertexNormals` 대신 **미분으로 직접** 구한다.
  //     매 프레임 삼각형을 전부 훑는 것보다 훨씬 싸다(꼭짓점 수만큼만 돈다).
  const A = [0.5, 0.32, 0.18];
  const 갱신 = (시각) => {
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const nor = geo.attributes.normal;
    for (let i = 0; i < 개수; i++) {
      const x = gx[i];
      const z = gz[i];
      const p1 = x * 0.55 + 시각 * 0.9;
      const p2 = z * 0.9 - 시각 * 1.35 + x * 0.15;
      const p3 = (x + z) * 1.7 + 시각 * 2.1;
      // 너울 — 주기가 아주 긴 큰 물결. 잔물결만 있으면 '떨리는 판'으로 보인다.
      const p0 = z * 0.06 - 시각 * 0.28 + x * 0.02;
      const h =
        Math.sin(p0) * 1.15 +
        A[0] * Math.sin(p1) +
        A[1] * Math.sin(p2) +
        A[2] * Math.sin(p3);
      pos.setY(i, h * 물결높이 * 미터);

      // 기울기(미분) → 법선. 얕은 물결이라 조금 과장해야 빛이 읽는다.
      const dx =
        (1.15 * 0.02 * Math.cos(p0) +
          A[0] * 0.55 * Math.cos(p1) +
          A[1] * 0.15 * Math.cos(p2) +
          A[2] * 1.7 * Math.cos(p3)) *
        물결높이 *
        3.5;
      const dz =
        (1.15 * 0.06 * Math.cos(p0) +
          A[1] * 0.9 * Math.cos(p2) +
          A[2] * 1.7 * Math.cos(p3)) *
        물결높이 *
        3.5;
      const 길이 = Math.hypot(dx, 1, dz) || 1;
      nor.setXYZ(i, -dx / 길이, 1 / 길이, -dz / 길이);

      // 마루는 하늘빛을 받아 밝다 — 이것만으로 물이 움직여 보인다
      const t = THREE.MathUtils.clamp(h * 0.32 + 0.5, 0, 1);
      임시.setRGB(기본색[i * 3], 기본색[i * 3 + 1], 기본색[i * 3 + 2]);
      임시.lerp(마루, Math.pow(t, 2.5) * 0.55);
      col.setXYZ(i, 임시.r, 임시.g, 임시.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    nor.needsUpdate = true;
  };

  갱신(0);
  return { 지오: geo, 갱신 };
}

// ── 물가 돌 ─────────────────────────────────────────────────
//   뭍과 물이 만나는 선이 자로 그은 듯 곧으면 "판을 잘라 붙였다"로 보인다.
//   물가에 돌을 걸쳐 놓아 선을 흐트러뜨린다.
export function 물가만들기({ X, Z시작, 폭 = 2.2, 개수, 시드, 놓을수있나 }) {
  const 난수 = makeRandom(시드);
  const 모양 = [];
  for (let i = 0; i < 4; i++) 모양.push(돌모양만들기(난수));
  const 조각 = [];
  const 밝음 = new THREE.Color(강결.물가돌);
  const 어둠 = new THREE.Color(강결.물가돌어둠);
  const 색 = new THREE.Color();
  const 사원수 = new THREE.Quaternion();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  for (let i = 0; i < 개수; i++) {
    const x = X[0] + 난수() * (X[1] - X[0]);
    // 물가 선을 중심으로 앞뒤로 흩는다 — 절반은 물에 잠긴다
    const z = Z시작 + (난수() - 0.45) * 폭;
    const 크기 = 0.15 + Math.pow(난수(), 2.6) * 0.9;
    const 납작 = 0.45 + 난수() * 0.35;
    const 회전 = [(난수() - 0.5) * 0.8, 난수() * Math.PI * 2, (난수() - 0.5) * 0.8];
    const 색흔들 = 난수();
    if (놓을수있나 && !놓을수있나(x, z)) continue;

    const g = 모양[Math.floor(난수() * 모양.length)].clone();
    사원수.setFromEuler(new THREE.Euler(회전[0], 회전[1], 회전[2]));
    배율.set(크기 * 미터, 크기 * 납작 * 미터, 크기 * (0.7 + 난수() * 0.6) * 미터);
    // 물 쪽으로 갈수록 더 깊이 잠긴다
    const 잠김 = THREE.MathUtils.clamp((z - Z시작) / 폭, -0.5, 1);
    자리.set(x * 미터, (크기 * 납작 * (0.25 - 잠김 * 0.5)) * 미터, z * 미터);
    행렬.compose(자리, 사원수, 배율);
    g.applyMatrix4(행렬);
    색.copy(어둠).lerp(밝음, 0.35 + 색흔들 * 0.6);
    조각.push(색입히기(g, 색));
  }

  모양.forEach((g) => g.dispose());
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

// ── 건너편 능선 (원경) ──────────────────────────────────────
//   §4 의 「건너편 뱃길」. Playable Core 밖이라 갈 수 없는 **원경**이다.
//   멀수록 공기에 씻겨 밝고 푸르게 — 겹을 여러 장 두면 그것만으로 깊이가 생긴다.
export function 건너편만들기({ X, Z, 겹수 = 4, 소음, 지평색 = "#CFCBBE" }) {
  const 조각 = [];
  const 가까움 = new THREE.Color(강결.건너편);
  const 하늘가 = new THREE.Color(지평색);
  const c = new THREE.Color();

  for (let 겹 = 0; 겹 < 겹수; 겹++) {
    const t = 겹 / Math.max(1, 겹수 - 1); // 0(가까움) ~ 1(멂)
    const z = Z + 겹 * 30;
    const 폭 = X[1] - X[0] + 겹 * 110;
    const x0 = X[0] - 겹 * 55;
    const 밑 = -3;
    const n = 150; // 촘촘해야 나무 실루엣이 나무로 보인다
    const 위치 = [];
    const 색깔 = [];
    // 멀수록 공기에 씻겨 지평선 색에 가까워진다 — 이것만으로 깊이가 생긴다
    c.copy(가까움).lerp(하늘가, 0.25 + t * 0.62);

    // 가장 가까운 겹은 **건너편 물가**다 — 낮은 둔덕 위에 나무 줄이 선다.
    //   §4 의 「건너편 뱃길」이 여기다. 나무가 있어야 사람 사는 물가로 읽힌다.
    const 나무겹 = 겹 === 0;
    const 나무 = [];
    if (나무겹) {
      // 나무 봉우리는 **가늘고 촘촘**해야 나무 줄로 보인다.
      //   폭이 크면 그냥 둥근 둔덕이 늘어선 것처럼 뭉툭해진다.
      let x = x0;
      while (x < x0 + 폭) {
        const r = 소음(x * 0.9, 9.1) * 0.5 + 0.5;
        const r2 = 소음(x * 0.21 + 40, 3.3) * 0.5 + 0.5;
        나무.push({ x, 폭: 0.7 + r * 1.5, 키: 2.6 + r * 3.2 + r2 * 4.5 });
        x += 0.9 + r * 1.9;
      }
    }

    const 높이 = (x) => {
      // 둔덕·능선
      let h =
        (소음(x * 0.018 + 겹 * 7, 겹 * 3) * 0.5 + 0.5) * (6 + 겹 * 9) +
        2 +
        겹 * 3;
      if (나무겹) {
        h = 2.5 + (소음(x * 0.05, 4) * 0.5 + 0.5) * 2.5;
        // 나무 봉우리를 더한다 — 겹치는 둥근 혹으로 나무 줄을 만든다
        for (const 나 of 나무) {
          const d = Math.abs(x - 나.x) / 나.폭;
          if (d < 1) h = Math.max(h, 2.5 + 나.키 * Math.sqrt(1 - d * d));
        }
      }
      return h;
    };

    for (let i = 0; i < n; i++) {
      const xa = x0 + (폭 * i) / n;
      const xb = x0 + (폭 * (i + 1)) / n;
      const ha = 높이(xa);
      const hb = 높이(xb);
      const za = z + 건너굽이(xa);
      const zb = z + 건너굽이(xb);
      // 감는 방향 — 보는 사람은 강 이쪽(−Z)에 있으므로 법선이 −Z 를 봐야 한다
      const 점 = [
        [xa, 밑, za], [xb, hb, zb], [xb, 밑, zb],
        [xa, 밑, za], [xa, ha, za], [xb, hb, zb],
      ];
      for (const [px, py, pz] of 점) {
        위치.push(px * 미터, py * 미터, pz * 미터);
        색깔.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(위치, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(색깔, 3));
    g.computeVertexNormals();
    조각.push(g);
  }
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}
