// ═══════════════════════════════════════════════════════════════
//  수목.js — 수목대(나무 줄)를 '코드로' 만드는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 이게 중요한가]
//   §4 의 C-01 표가 수목대를 **「V3 의 주 차단 장치」** 라고 못박았다.
//   Z4(진부촌 방향 증언 능선)에 선 사람이 Z3(사건 현장)를 못 보게 막는 장치다.
//   그런데 지금까지 회색 상자여서, 보는 사람은 "저게 왜 시야를 막는지"를
//   납득할 수가 없었다. 나무 줄로 보여야 §4 검증이 검증이 된다.
//
// [값싸게 만드는 법]
//   나무 한 그루 = 기둥(테이퍼 원기둥) + 잎덩이 두셋(흔든 정이십면체).
//   ≈ 80 삼각형. 수십 그루를 **전부 하나로 합쳐 드로우콜 1개**로 낸다.
//   (기차 좌석 · 통로 흙더미 · 자갈과 같은 방식)
//
// [자리]
//   시드 고정 난수라 매번·누구 화면에서든 같은 자리에 같은 나무가 선다.
//   차단물 사각형 **안쪽**에만 심는다 — 기둥이 밖으로 나가면 `막힘` 이 쓰는
//   사각형과 어긋나서, 보이는 나무를 그냥 통과하게 된다.
//
// [단위] 좌표·크기는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 색입히기 } from "./바닥.js";
import { 미터 } from "./공간도면.js";

export const 수목결 = {
  기둥: "#5B4A3A",
  기둥어둠: "#33281F",
  잎: "#6B8052",
  // ※ 너무 어두우면 잎덩이의 **밑면**이 새까매진다. 밑면은 법선이 아래를 봐서
  //   해를 하나도 못 받으므로, 바탕색이 어두우면 그대로 검은 덩어리가 된다.
  //   (광선을 쏴서 확인했다 — 법선 y = −0.74, 색 0.09/0.13/0.05)
  잎어둠: "#46543A",
  잎밝음: "#8AA05F",
};

// 잎덩이 하나 — 정이십면체 꼭짓점을 흔들어 뭉게뭉게하게.
//   인덱스가 없어 면마다 각진 노멀이 서고, 그게 툰 셰이딩과 잘 맞는다.
function 잎덩이(난수) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  const 흔들 = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const 키 = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = 흔들.get(키);
    if (f === undefined) {
      f = 0.68 + 난수() * 0.5;
      흔들.set(키, f);
    }
    p.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

// ── 수목대 ──────────────────────────────────────────────────
//   X, Z   심을 사각형(미터)
//   바닥   나무가 서는 고도(m). (x, z) → 높이 함수여도 된다(비탈에 심을 때)
//   높이   차단물로 정해진 높이(m) — 나무 키의 기준이 된다
//   개수   심을 그루 수
//   안쪽   가장자리에서 이만큼 들여 심는다(m)
export function 수목대만들기({
  X, Z, 바닥, 높이, 개수, 시드, 안쪽 = 0.5, 지면요철,
}) {
  const 딛는곳 = typeof 바닥 === "function" ? 바닥 : () => 바닥;
  const 뽑기 = makeRandom(시드 + 1);
  const x0 = X[0] + 안쪽;
  const x1 = X[1] - 안쪽;
  const z0 = Z[0] + 안쪽;
  const z1 = Z[1] - 안쪽;
  const 자리들 = [];
  for (let i = 0; i < 개수; i++) {
    const x = x0 + 뽑기() * (x1 - x0);
    const z = z0 + 뽑기() * (z1 - z0);
    자리들.push({
      x,
      z,
      y: 딛는곳(x, z) + (지면요철 ? 지면요철(x, z) : 0),
      // 키는 기준 높이를 흔든다. 다 똑같으면 울타리처럼 보인다.
      키: 높이 * (0.85 + 뽑기() * 0.6),
    });
  }
  return 나무들만들기({ 자리들, 시드 });
}

// ── 자리 목록으로 나무 심기 ────────────────────────────────
//   `수목대만들기` 가 사각형 안에 뿌리는 것이라면, 이쪽은 **어디에 심을지를
//   밖에서 정해 주는** 형태다. 언덕 전체 수풀(수풀뿌리기)이 이걸 쓴다.
//   자리 = { x, z, y, 키 }
export function 나무들만들기({ 자리들, 시드 }) {
  if (!자리들 || !자리들.length) return null;
  const 난수 = makeRandom(시드);
  const 잎모양 = [];
  for (let i = 0; i < 5; i++) 잎모양.push(잎덩이(난수));

  const 조각 = [];
  const 기둥색 = new THREE.Color();
  const 잎색 = new THREE.Color();
  const 기둥밝 = new THREE.Color(수목결.기둥);
  const 기둥어 = new THREE.Color(수목결.기둥어둠);
  const 잎밝 = new THREE.Color(수목결.잎밝음);
  const 잎보통 = new THREE.Color(수목결.잎);
  const 잎어 = new THREE.Color(수목결.잎어둠);

  const 사원수 = new THREE.Quaternion();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  for (const a of 자리들) {
    const { x, z, y } = a;
    const 키 = a.키;
    const 기둥높이 = 키 * (0.38 + 난수() * 0.14);
    const 굵기 = 키 * (0.035 + 난수() * 0.02);
    const 기울기 = (난수() - 0.5) * 0.16;
    const 방향 = 난수() * Math.PI * 2;

    // 기둥 — 위가 가는 원기둥. 5각이면 충분하다(멀리서 본다).
    //   ※ CylinderGeometry 는 **인덱스가 있고** 잎덩이(정이십면체)는 없다.
    //     섞으면 mergeGeometries 가 거부하므로 인덱스를 푼다.
    const 기둥원본 = new THREE.CylinderGeometry(
      굵기 * 0.6 * 미터,
      굵기 * 미터,
      기둥높이 * 미터,
      5,
      1,
    );
    const 기둥 = 기둥원본.toNonIndexed();
    기둥원본.dispose();
    사원수.setFromEuler(new THREE.Euler(기울기, 방향, 기울기 * 0.7));
    자리.set(x * 미터, (y + 기둥높이 / 2) * 미터, z * 미터);
    행렬.compose(자리, 사원수, new THREE.Vector3(1, 1, 1));
    기둥.applyMatrix4(행렬);
    기둥색.copy(기둥어).lerp(기둥밝, 0.4 + 난수() * 0.55);
    조각.push(색입히기(기둥, 기둥색));

    // 잎덩이 두셋 — 위로 갈수록 작게 겹쳐 쌓는다
    const 덩이수 = 2 + Math.floor(난수() * 2);
    for (let k = 0; k < 덩이수; k++) {
      const t = k / Math.max(1, 덩이수 - 1); // 0(아래) ~ 1(위)
      const 반지름 = 키 * (0.3 - t * 0.13) * (0.85 + 난수() * 0.35);
      const 높 = y + 기둥높이 + (키 - 기둥높이) * (0.15 + t * 0.7);
      const g = 잎모양[Math.floor(난수() * 잎모양.length)].clone();
      사원수.setFromEuler(
        new THREE.Euler(난수() * 0.6, 난수() * Math.PI * 2, 난수() * 0.6),
      );
      배율.set(
        반지름 * 2 * 미터,
        반지름 * 2 * (0.7 + 난수() * 0.5) * 미터,
        반지름 * 2 * 미터,
      );
      자리.set(
        (x + (난수() - 0.5) * 반지름 * 0.5) * 미터,
        높 * 미터,
        (z + (난수() - 0.5) * 반지름 * 0.5) * 미터,
      );
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      // 위쪽 덩이일수록 볕을 받아 밝게 — 이것만으로 부피가 읽힌다
      잎색.copy(잎어).lerp(잎보통, 0.35 + 난수() * 0.5);
      잎색.lerp(잎밝, t * 0.45);
      조각.push(색입히기(g, 잎색));
    }
  }

  잎모양.forEach((g) => g.dispose());
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

// ── 풀 ──────────────────────────────────────────────────────
//   Z4(능선)는 이름이 능선인데 지금까지 맨 흙바닥이었다. 풀이 한 겹 깔려야
//   "여긴 사람이 다니는 흙길이 아니라 산등성이"라는 게 읽힌다.
//   포기 하나 = 가는 원뿔 서넛 ≈ 15 삼각형. 수백 포기를 합쳐 드로우콜 1개.
//   ※ 밟고 지나갈 수 있어야 하므로 **충돌은 없다.** 키를 낮게(≤ 0.45 m) 두어
//     "통과했는데 안 밀린다"는 어색함이 눈에 안 띄게 한다.
export function 풀만들기({
  X, Z, 고도, 밀도 = 1.4, 시드, 키 = [0.18, 0.45], 뭉침소음, 지면요철, 놓을수있나,
}) {
  const 난수 = makeRandom(시드);
  const 조각 = [];
  const 밝 = new THREE.Color("#93A86A");
  const 보통 = new THREE.Color("#6B7C4C");
  const 어둠 = new THREE.Color("#3D4A2E");
  const 색 = new THREE.Color();
  const 행렬 = new THREE.Matrix4();
  const 사원수 = new THREE.Quaternion();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  const w = X[1] - X[0];
  const d = Z[1] - Z[0];
  const 후보 = Math.round(w * d * 밀도 * 1.8); // 뭉침으로 걸러지니 넉넉히
  for (let i = 0; i < 후보; i++) {
    const x = X[0] + 난수() * w;
    const z = Z[0] + 난수() * d;
    const 뽑기 = 난수();
    const h = 키[0] + 난수() * (키[1] - 키[0]);
    const 잎수 = 3 + Math.floor(난수() * 2);
    const 색흔들 = 난수();
    // 풀은 고르게 나지 않는다 — 뭉치고 비게
    const 확률 = THREE.MathUtils.clamp(
      0.5 + (뭉침소음 ? 뭉침소음(x * 0.3, z * 0.3) : 0) * 0.85,
      0,
      1,
    );
    if (뽑기 > 확률) continue;
    if (놓을수있나 && !놓을수있나(x, z)) continue;

    const y = 고도 + (지면요철 ? 지면요철(x, z) : 0);
    for (let k = 0; k < 잎수; k++) {
      const 원본 = new THREE.CylinderGeometry(
        0.004 * 미터,
        h * 0.09 * 미터,
        h * (0.7 + 난수() * 0.5) * 미터,
        3,
        1,
      );
      const g = 원본.toNonIndexed();
      원본.dispose();
      const 눕 = 0.15 + 난수() * 0.5;
      사원수.setFromEuler(
        new THREE.Euler(눕 * Math.cos(k * 2.1), 난수() * Math.PI * 2, 눕 * Math.sin(k * 2.1)),
      );
      배율.set(1, 1, 1);
      자리.set(
        (x + (난수() - 0.5) * h * 0.35) * 미터,
        (y + h * 0.38) * 미터,
        (z + (난수() - 0.5) * h * 0.35) * 미터,
      );
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      // 끝이 볕을 받아 밝다
      색.copy(어둠).lerp(보통, 0.4 + 색흔들 * 0.5);
      색.lerp(밝, 난수() * 0.35);
      조각.push(색입히기(g, 색));
    }
  }
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

// ── 덤불 / 비탈 나무 ────────────────────────────────────────
//   자리를 통로.js 가 정해 주면 그 자리에 한 그루씩 세운다.
//   비탈에 나무가 몇 그루 서 있으면 흙비탈과 옆의 암반 절벽이 서로 물려
//   "잘라 붙인 두 재질"로 안 보인다.
export function 덤불만들기({ 자리들, 시드 }) {
  if (!자리들.length) return null;
  const 난수 = makeRandom(시드);
  const 잎모양 = [];
  for (let i = 0; i < 4; i++) 잎모양.push(잎덩이(난수));
  const 조각 = [];
  const 기둥색 = new THREE.Color();
  const 잎색 = new THREE.Color();
  const 기둥밝 = new THREE.Color(수목결.기둥);
  const 기둥어 = new THREE.Color(수목결.기둥어둠);
  const 잎밝 = new THREE.Color(수목결.잎밝음);
  const 잎보통 = new THREE.Color(수목결.잎);
  const 잎어 = new THREE.Color(수목결.잎어둠);
  const 사원수 = new THREE.Quaternion();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  for (const a of 자리들) {
    const 키 = a.키;
    const 기둥높이 = 키 * (0.3 + 난수() * 0.16);
    const 굵기 = 키 * (0.04 + 난수() * 0.025);
    if (기둥높이 > 0.25) {
      const 원본 = new THREE.CylinderGeometry(
        굵기 * 0.6 * 미터, 굵기 * 미터, 기둥높이 * 미터, 5, 1,
      );
      const g = 원본.toNonIndexed();
      원본.dispose();
      사원수.setFromEuler(
        new THREE.Euler((난수() - 0.5) * 0.3, 난수() * Math.PI * 2, (난수() - 0.5) * 0.3),
      );
      자리.set(a.x * 미터, (a.y + 기둥높이 / 2) * 미터, a.z * 미터);
      행렬.compose(자리, 사원수, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(행렬);
      기둥색.copy(기둥어).lerp(기둥밝, 0.4 + 난수() * 0.5);
      조각.push(색입히기(g, 기둥색));
    }
    const 덩이수 = 2 + Math.floor(난수() * 2);
    for (let k = 0; k < 덩이수; k++) {
      const t = k / Math.max(1, 덩이수 - 1);
      const 반지름 = 키 * (0.34 - t * 0.12) * (0.8 + 난수() * 0.4);
      const g = 잎모양[Math.floor(난수() * 잎모양.length)].clone();
      사원수.setFromEuler(
        new THREE.Euler(난수() * 0.7, 난수() * Math.PI * 2, 난수() * 0.7),
      );
      배율.set(
        반지름 * 2 * 미터,
        반지름 * 2 * (0.6 + 난수() * 0.5) * 미터,
        반지름 * 2 * 미터,
      );
      자리.set(
        (a.x + (난수() - 0.5) * 반지름) * 미터,
        (a.y + 기둥높이 + (키 - 기둥높이) * (0.12 + t * 0.6)) * 미터,
        (a.z + (난수() - 0.5) * 반지름) * 미터,
      );
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      잎색.copy(잎어).lerp(잎보통, 0.35 + 난수() * 0.5);
      잎색.lerp(잎밝, t * 0.4);
      조각.push(색입히기(g, 잎색));
    }
  }
  잎모양.forEach((g) => g.dispose());
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}


// ── 언덕 전체 수풀 뿌리기 ──────────────────────────────────
// [왜]
//   모티브 사진에서 초록이 덮이지 않은 데는 **깎아지른 암벽뿐**이다.
//   나머지는 전부 나무와 덤불이다. 우리 맵은 절벽에만 수풀을 붙여 놔서,
//   새로 채운 산허리가 맨 흙 언덕으로 남아 있었다.
//
// [어디에 심고 어디에 안 심나 — 규칙을 숫자로]
//   ① 걷는 무대는 비운다 — Z1~Z4 구역과 통로(갓길 포함)에는 나무를 안 심는다.
//      이 나무들에는 **막힘 판정이 없다**(그냥 통과된다). 걷는 자리에 두면
//      「밀리지 않는 나무」가 되고, §4 의 시야 규칙도 무너진다.
//      절벽 어깨 나무를 Z3 안쪽에 심었다가 V2 시점이 파묻힌 적이 있다.
//   ② 경사로 가른다 — 45° 를 넘으면 흙이 안 붙는다. 나무는 완만한 데,
//      덤불은 조금 더 급한 데까지. 아주 급한 데는 맨 암반으로 둔다.
//   ③ 물가는 비운다 — 젖은 자갈밭에 숲이 서면 어색하다.
//   ④ 뭉친다 — 고르게 흩으면 「점을 찍어 놓은 것」이 된다(절벽에서 겪었다).
//      소음으로 밀도를 흔들어 숲 덩어리와 빈터가 갈리게 한다.
export function 수풀뿌리기({
  지형, 지표, 코어, 나무수 = 420, 덤불수 = 900, 시드 = 640811, 소음,
}) {
  const 난수 = makeRandom(시드);
  const 나무자리 = [];
  const 덤불자리 = [];
  const w = 코어.X[1] - 코어.X[0];
  const d = 코어.Z[1] - 코어.Z[0];

  const 후보 = (개수, 받기) => {
    // 넉넉히 뽑아서 규칙으로 걸러 낸다(걸러지는 게 대부분이다)
    let 남음 = 개수 * 14;
    while (남음-- > 0 && 받기.length < 개수) {
      const x = 코어.X[0] + 난수() * w;
      const z = 코어.Z[0] + 난수() * d;
      const g = 지형.지면(x, z);
      if (g.물 || g.낙하) continue; // ③ 물·벼랑면
      if (g.통로 || g.구역) continue; // ① 걷는 무대
      // 물가 젖은 띠도 비운다
      if (z > 41) continue;
      const 급 = 지표.급함(x, z);
      받기.push({ x, z, y: 지표.높이(x, z), 급 });
    }
    return 받기;
  };

  // 나무 — 완만한 데에. 뭉치게.
  for (const p of 후보(나무수, [])) {
    if (p.급 > 0.55) continue; // ② 급사면에는 큰 나무가 안 선다
    const 뭉침 = 소음(p.x * 0.09 + 5, p.z * 0.09) * 0.5 + 0.5;
    if (난수() > 0.15 + 뭉침 * 뭉침 * 1.2) continue;
    나무자리.push({
      x: p.x,
      z: p.z,
      y: p.y,
      키: 3.2 + 난수() * 4.6, // 3~8 m — 크기가 갈려야 숲으로 읽힌다
    });
  }
  // 덤불 — 나무보다 급한 데까지 간다. 나무 사이 빈 데를 메운다.
  for (const p of 후보(덤불수, [])) {
    if (p.급 > 0.9) continue;
    const 뭉침 = 소음(p.x * 0.16 + 31, p.z * 0.16) * 0.5 + 0.5;
    if (난수() > 0.25 + 뭉침 * 1.0) continue;
    덤불자리.push({
      x: p.x,
      z: p.z,
      y: p.y,
      키: 0.6 + 난수() * 1.7,
    });
  }
  return { 나무자리, 덤불자리 };
}


// ── 잎더미 (기둥 없는 잎만) ────────────────────────────────
// [왜 기둥이 없나]
//   절벽·비탈 **면에 붙는** 초록은 나무가 아니라 「바위틈에서 자란 덤불」이다.
//   기둥을 세우면 암벽에서 막대가 튀어나온 꼴이 되고, 면에 박힌 기둥 밑동은
//   어차피 바위 속으로 들어가 안 보인다. 잎덩이만 겹쳐 쌓는 게 맞다.
//   (사용자 지시: 「암석에 들어가는 나무 기둥은 안 보이는 잎더미들만」)
//
// 자리 = { x, y, z, 키 }  ·  키 = 더미 전체의 대략 지름(m)
export function 잎더미만들기({ 자리들, 시드, 덩이 = [3, 6] }) {
  if (!자리들 || !자리들.length) return null;
  const 난수 = makeRandom(시드);
  const 잎모양 = [];
  for (let i = 0; i < 5; i++) 잎모양.push(잎덩이(난수));
  const 조각 = [];
  const 잎색 = new THREE.Color();
  const 잎밝 = new THREE.Color(수목결.잎밝음);
  const 잎보통 = new THREE.Color(수목결.잎);
  const 잎어 = new THREE.Color(수목결.잎어둠);
  const 사원수 = new THREE.Quaternion();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  for (const a of 자리들) {
    const 키 = a.키;
    const 수 = 덩이[0] + Math.floor(난수() * (덩이[1] - 덩이[0] + 1));
    for (let k = 0; k < 수; k++) {
      const t = k / Math.max(1, 수 - 1); // 0(아래) ~ 1(위)
      const 반 = 키 * (0.5 - t * 0.18) * (0.6 + 난수() * 0.7);
      const g = 잎모양[Math.floor(난수() * 잎모양.length)].clone();
      사원수.setFromEuler(
        new THREE.Euler(난수() * 0.8, 난수() * Math.PI * 2, 난수() * 0.8),
      );
      배율.set(
        반 * 2 * 미터,
        반 * 2 * (0.6 + 난수() * 0.6) * 미터,
        반 * 2 * 미터,
      );
      자리.set(
        (a.x + (난수() - 0.5) * 키 * 0.8) * 미터,
        (a.y + 키 * (0.15 + t * 0.5) + (난수() - 0.5) * 키 * 0.2) * 미터,
        (a.z + (난수() - 0.5) * 키 * 0.8) * 미터,
      );
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      // 위쪽 덩이가 볕을 받아 밝다 — 이것만으로 부피가 읽힌다
      잎색.copy(잎어).lerp(잎보통, 0.3 + 난수() * 0.5);
      잎색.lerp(잎밝, t * 0.5);
      조각.push(색입히기(g, 잎색));
    }
  }
  잎모양.forEach((g) => g.dispose());
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

// ── 길 양옆 수풀 ───────────────────────────────────────────
// [왜 따로 두나]
//   `수풀뿌리기` 는 통로 밴드를 통째로 비운다(걷는 자리라서). 그래서 길 옆이
//   **휑하게** 남는다. 실제 산길은 양옆이 가장 빽빽하다 — 사람이 지나느라
//   가운데만 트여 있는 것이다.
//   여기서는 밴드 **바로 바깥**에 띠를 만들어 심는다.
//     · 완만한 자리 → 나무 + 덤불(기둥 있음)
//     · 급한 자리(비탈 옆면) → **잎더미**(기둥 없음)
export function 길가수풀자리({
  통로실측, 지표, 지형, 갓끝 = 0.54, 여백 = 0.9, 띠 = 3.2, 간격 = 1.1, 시드 = 415207,
}) {
  const 난수 = makeRandom(시드);
  const 나무 = [];
  const 덤불 = [];
  const 잎더미 = [];
  for (const t of 통로실측) {
    const 반폭 = t.폭 / 2;
    const 선 = t.선 ?? [];
    for (let i = 0; i < 선.length; i++) {
      const p = 선[i];
      for (const 쪽 of [-1, 1]) {
        // 밴드 바깥으로 `여백` 만큼 띄우고 거기서부터 `띠` 만큼.
        //   여백을 0.25 로 뒀더니 나무가 어깨를 스칠 만큼 붙어서, 길을 걷는
        //   시야가 답답했다. 줄지어 서되 **길에 닿지는 않게** 띄운다.
        const 거 = 반폭 + 갓끝 + 여백 + 난수() * 띠;
        const x = p.x + p.nx * 거 * 쪽;
        const z = p.z + p.nz * 거 * 쪽;
        const g = 지형.지면(x, z);
        if (g.물 || g.낙하 || g.통로) continue; // 길 위·물·벼랑면은 비운다
        if (난수() > 간격 / 2) continue; // 성기게
        const y = 지표.높이(x, z);
        const 급 = 지표.급함(x, z);
        if (급 > 0.45) {
          // 비탈 옆면 — 기둥 없는 잎더미만
          잎더미.push({ x, y, z, 키: 0.8 + 난수() * 1.6 });
        } else if (난수() < 0.34) {
          나무.push({ x, y, z, 키: 2.6 + 난수() * 3.4 });
        } else {
          덤불.push({ x, y, z, 키: 0.6 + 난수() * 1.3 });
        }
      }
    }
  }
  return { 나무, 덤불, 잎더미 };
}

// ── 인스턴스용 '한 그루/한 포기' 모양 만들기 ────────────────
// [왜 따로 만드나]
//   `나무들만들기` 같은 함수는 자리마다 지오메트리를 만들어 **통째로 병합**한다.
//   드로우콜은 1 개로 싸지만, 그러면 「세 번째 나무」라는 물건이 없어서
//   하나만 지우거나 옮길 수가 없다(배치.js 머리말 참고).
//
//   InstancedMesh 는 지오메트리 **하나**를 쓰므로, 여기서 「지름 1 · 밑동이
//   원점」 짜리 표본을 몇 벌 만들어 둔다. 자리·크기·회전·색은 인스턴스가 갖는다.
//   변형을 4~6 벌 두는 이유: 전부 같은 모양이면 복제 티가 난다.
//
// [지름 1 규약]
//   높이 1 · 밑동 y = 0 으로 맞춘다. 그래야 `배치.js` 가 `키`(m)를 그대로
//   배율로 쓸 수 있고, 자리의 y 가 곧 **땅에 닿는 점**이 된다.
function 밑동원점으로(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const 높 = b.max.y - b.min.y || 1;
  g.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2);
  g.scale(1 / 높, 1 / 높, 1 / 높);
  return g;
}

// 나무 표본 — 기둥 + 잎덩이 2~3
export function 나무표본들(수 = 5, 시드 = 9001) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let n = 0; n < 수; n++) {
    const 조각 = [];
    const 기둥밝 = new THREE.Color(수목결.기둥);
    const 기둥어 = new THREE.Color(수목결.기둥어둠);
    const 잎밝 = new THREE.Color(수목결.잎밝음);
    const 잎보통 = new THREE.Color(수목결.잎);
    const 잎어 = new THREE.Color(수목결.잎어둠);
    const 색 = new THREE.Color();
    const 기둥높이 = 0.38 + 난수() * 0.14;
    const 굵기 = 0.035 + 난수() * 0.02;
    const 기 = new THREE.CylinderGeometry(굵기 * 0.6, 굵기, 기둥높이, 5, 1).toNonIndexed();
    기.translate(0, 기둥높이 / 2, 0);
    색.copy(기둥어).lerp(기둥밝, 0.4 + 난수() * 0.55);
    조각.push(색입히기(기, 색));
    const 덩이수 = 2 + Math.floor(난수() * 2);
    for (let k = 0; k < 덩이수; k++) {
      const t = k / Math.max(1, 덩이수 - 1);
      const 반 = (0.3 - t * 0.13) * (0.85 + 난수() * 0.35);
      const g = 잎덩이(난수);
      g.scale(반 * 2, 반 * 2 * (0.7 + 난수() * 0.5), 반 * 2);
      g.translate(
        (난수() - 0.5) * 반 * 0.5,
        기둥높이 + (1 - 기둥높이) * (0.15 + t * 0.7),
        (난수() - 0.5) * 반 * 0.5,
      );
      색.copy(잎어).lerp(잎보통, 0.35 + 난수() * 0.5);
      색.lerp(잎밝, t * 0.45);
      조각.push(색입히기(g, 색));
    }
    표본.push(밑동원점으로(mergeGeometries(조각, false)));
    조각.forEach((g) => g.dispose());
  }
  return 표본;
}

// 잎더미 표본 — 기둥 없이 잎덩이만
export function 잎더미표본들(수 = 5, 시드 = 9002, 덩이 = [3, 6]) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  const 잎밝 = new THREE.Color(수목결.잎밝음);
  const 잎보통 = new THREE.Color(수목결.잎);
  const 잎어 = new THREE.Color(수목결.잎어둠);
  const 색 = new THREE.Color();
  for (let n = 0; n < 수; n++) {
    const 조각 = [];
    const 개 = 덩이[0] + Math.floor(난수() * (덩이[1] - 덩이[0] + 1));
    for (let k = 0; k < 개; k++) {
      const t = k / Math.max(1, 개 - 1);
      const 반 = (0.5 - t * 0.18) * (0.6 + 난수() * 0.7);
      const g = 잎덩이(난수);
      g.scale(반 * 2, 반 * 2 * (0.6 + 난수() * 0.6), 반 * 2);
      g.translate(
        (난수() - 0.5) * 0.8,
        0.15 + t * 0.5 + (난수() - 0.5) * 0.2,
        (난수() - 0.5) * 0.8,
      );
      색.copy(잎어).lerp(잎보통, 0.3 + 난수() * 0.5);
      색.lerp(잎밝, t * 0.5);
      조각.push(색입히기(g, 색));
    }
    표본.push(밑동원점으로(mergeGeometries(조각, false)));
    조각.forEach((g) => g.dispose());
  }
  return 표본;
}

// 덤불 표본 — 짧은 줄기 + 잎덩이
export function 덤불표본들(수 = 5, 시드 = 9003) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  const 기둥밝 = new THREE.Color(수목결.기둥);
  const 기둥어 = new THREE.Color(수목결.기둥어둠);
  const 잎밝 = new THREE.Color(수목결.잎밝음);
  const 잎보통 = new THREE.Color(수목결.잎);
  const 잎어 = new THREE.Color(수목결.잎어둠);
  const 색 = new THREE.Color();
  for (let n = 0; n < 수; n++) {
    const 조각 = [];
    const 줄기 = 0.18 + 난수() * 0.12;
    const g0 = new THREE.CylinderGeometry(0.03, 0.045, 줄기, 5, 1).toNonIndexed();
    g0.translate(0, 줄기 / 2, 0);
    색.copy(기둥어).lerp(기둥밝, 0.4 + 난수() * 0.5);
    조각.push(색입히기(g0, 색));
    const 개 = 2 + Math.floor(난수() * 3);
    for (let k = 0; k < 개; k++) {
      const t = k / Math.max(1, 개 - 1);
      const 반 = (0.42 - t * 0.12) * (0.7 + 난수() * 0.6);
      const g = 잎덩이(난수);
      g.scale(반 * 2, 반 * 2 * (0.65 + 난수() * 0.5), 반 * 2);
      g.translate((난수() - 0.5) * 0.5, 줄기 + (1 - 줄기) * (0.2 + t * 0.6), (난수() - 0.5) * 0.5);
      색.copy(잎어).lerp(잎보통, 0.35 + 난수() * 0.5);
      색.lerp(잎밝, t * 0.45);
      조각.push(색입히기(g, 색));
    }
    표본.push(밑동원점으로(mergeGeometries(조각, false)));
    조각.forEach((g) => g.dispose());
  }
  return 표본;
}
