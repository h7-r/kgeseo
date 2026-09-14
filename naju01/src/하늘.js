// ═══════════════════════════════════════════════════════════════
//  하늘.js — 하늘을 '한 가지 색'에서 벗어나게 하는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   지금까지 하늘은 `<color attach="background">` 한 장, 즉 **완전한 단색**이었다.
//   단색 하늘은 두 가지를 망친다 —
//   ① 지평선이 어디인지 안 보인다. 야외인데 깊이가 안 생긴다
//   ② §4 가 V1 에서 보라고 한 「건너편 뱃길」이 단색 위에 오려 붙인 종이처럼 뜬다
//
//   그래서 위(천정)에서 아래(지평)로 색이 흐르는 돔을 씌운다.
//   빛도 안 받고 안개도 안 타는 **평면 색**이라 비용이 사실상 없다(240 삼각형).
//
// [카메라를 따라다닌다]
//   돔은 카메라를 중심으로 따라다녀야 한다. 고정해 두면 무대 끝으로 걸어갔을 때
//   돔 바깥으로 나가 하늘이 잘린다.
//
// [단위] 반지름은 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 미터 } from "./공간도면.js";

export const 하늘결 = {
  천정: "#4A6E96",
  중간: "#8FA6B8",
  지평: "#CFCBBE", // 지평선은 늘 흐리고 밝다 — 공기가 두껍게 쌓인 쪽이라
};

// ── 구름 ────────────────────────────────────────────────────
//   하늘이 그라데이션 한 장이면 **색종이**다. 구름이 몇 덩이 떠야 하늘이 된다.
//   ※ 돔과 마찬가지로 **카메라를 따라다닌다.** 고정해 두면 80 m 무대를 걸을 때
//     구름이 휙휙 지나가 하늘이 코앞에 있는 것처럼 보인다.
//     따라다니면 시차가 0 이라 '아주 멀리 있는 것'으로 읽힌다.
//   ※ 반지름을 가깝게 잡으면(150 m) 구름 한 덩이가 하늘의 4분의 1을 덮어
//     **흰 파편**으로 보인다. 멀리 두고 작게 잡아야 구름이 된다.
export function 구름만들기({ 반지름 = 520, 개수 = 30, 시드 = 4242, 팔레트 = 하늘결 } = {}) {
  const 난수 = makeRandom(시드);
  const 조각 = [];
  const 밝 = new THREE.Color("#F2F0E8");
  const 밑 = new THREE.Color(팔레트.지평);
  const c = new THREE.Color();
  const 사원수 = new THREE.Quaternion();
  const 행렬 = new THREE.Matrix4();
  const 자리 = new THREE.Vector3();
  const 배율 = new THREE.Vector3();

  for (let i = 0; i < 개수; i++) {
    // 낮은 고도각에 몰아 둔다 — 머리 위보다 지평 쪽에 있어야 자연스럽다
    const 방위 = 난수() * Math.PI * 2;
    const 고도각 = (5 + Math.pow(난수(), 2.0) * 30) * (Math.PI / 180);
    const R = 반지름 * (0.8 + 난수() * 0.4);
    const cx = Math.cos(방위) * Math.cos(고도각) * R;
    const cy = Math.sin(고도각) * R;
    const cz = Math.sin(방위) * Math.cos(고도각) * R;
    const 폭 = 26 + 난수() * 54;
    // 한 덩이는 여러 뭉치로 — 하나면 그냥 타원이다.
    //   뭉치를 많고 작게 잡아야 각진 파편이 아니라 뭉게구름으로 보인다.
    const 뭉치 = 5 + Math.floor(난수() * 6);
    for (let k = 0; k < 뭉치; k++) {
      const g = new THREE.IcosahedronGeometry(0.5 * 미터, 1);
      const r = 폭 * (0.2 + 난수() * 0.32);
      사원수.setFromEuler(new THREE.Euler(난수(), 난수() * 6.3, 난수()));
      배율.set(r * 미터, r * (0.4 + 난수() * 0.3) * 미터, r * (0.7 + 난수() * 0.4) * 미터);
      자리.set(
        (cx + (난수() - 0.5) * 폭 * 1.3) * 미터,
        (cy + (난수() - 0.5) * 폭 * 0.12) * 미터,
        (cz + (난수() - 0.5) * 폭 * 1.3) * 미터,
      );
      행렬.compose(자리, 사원수, 배율);
      g.applyMatrix4(행렬);
      // 아래는 지평 색, 위는 밝게 — 그것만으로 부피가 생긴다
      c.copy(밑).lerp(밝, 0.45 + 난수() * 0.5);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const 위쪽 = (g.attributes.position.getY(v) - 자리.y) / (r * 미터) + 0.5;
        const cc = 밑.clone().lerp(c, THREE.MathUtils.clamp(위쪽 * 1.4, 0.25, 1));
        arr[v * 3] = cc.r;
        arr[v * 3 + 1] = cc.g;
        arr[v * 3 + 2] = cc.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      조각.push(g);
    }
  }
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

export function 하늘돔만들기({ 반지름 = 185, 팔레트 = 하늘결 } = {}) {
  const g = new THREE.SphereGeometry(반지름 * 미터, 24, 16);
  const p = g.attributes.position;
  const 색 = new Float32Array(p.count * 3);
  const 천 = new THREE.Color(팔레트.천정);
  const 중 = new THREE.Color(팔레트.중간);
  const 지 = new THREE.Color(팔레트.지평);
  const c = new THREE.Color();
  const R = 반지름 * 미터;

  for (let i = 0; i < p.count; i++) {
    const h = THREE.MathUtils.clamp(p.getY(i) / R, -1, 1); // -1(아래) ~ 1(천정)
    if (h >= 0) {
      // 지평 → 천정. 제곱근을 써야 지평 쪽 띠가 얇지 않고 넉넉해 보인다
      const t = Math.sqrt(h);
      c.copy(지).lerp(중, Math.min(1, t * 2));
      if (t > 0.5) c.lerp(천, (t - 0.5) * 2);
    } else {
      // 지평 아래 — 어차피 땅에 가리지만, 먼 물 너머가 비칠 때를 위해 살짝 어둡게
      c.copy(지).lerp(new THREE.Color("#6E6A60"), Math.min(1, -h * 2.2));
    }
    색[i * 3] = c.r;
    색[i * 3 + 1] = c.g;
    색[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(색, 3));
  return g;
}
