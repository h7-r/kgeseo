// ═══════════════════════════════════════════════════════════════
//  나루터.js — Z1 의 배 대는 자리
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   Z1 의 이름이 **「나루터 · 시작 테라스」** 인데 물가에 아무것도 없었다.
//   그러면 그냥 강가 자갈밭이고, §5 Scene 01 이 여기를 「시작 지점」으로
//   삼은 이유가 화면에서 읽히지 않는다. 말뚝과 널 몇 장이면 충분하다 —
//   "여기서 배를 탄다"는 것만 전해지면 된다.
//
// [아트 게이트를 넘지 않는다]
//   배는 만들지 않는다. 배는 **실루엣이 곧 뜻인 물건**이라 §7 아트 게이트가
//   열린 뒤 제대로 만들 것이다. 여기서는 자리만 표시한다.
//
// [걷는 판정]
//   물 위라 사람이 갈 수 없는 자리다(`지면` 이 물로 돌려줌 → 낙하 복귀).
//   그래서 충돌을 두지 않는다. 눈으로만 있는 것이다.
//
// [단위] 좌표·크기는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "../../src/공용.jsx";
import { 색입히기 } from "./바닥.js";
import { 미터 } from "./공간도면.js";

export const 나루결 = {
  말뚝: "#6A5947",
  말뚝어둠: "#3A3026",
  널: "#7E6E58",
  널어둠: "#453A2C",
};

const 풀기 = (g) => {
  const n = g.toNonIndexed();
  g.dispose();
  return n;
};

// X = 나루가 놓일 가로 범위 · 물가 = 물이 시작하는 Z · 뻗음 = 물 쪽으로 나가는 길이
export function 나루만들기({ X, 물가, 뻗음 = 3.2, 바닥높이, 시드 = 8801 }) {
  const 난수 = makeRandom(시드);
  const 조각 = [];
  const c = new THREE.Color();
  const 말밝 = new THREE.Color(나루결.말뚝);
  const 말어 = new THREE.Color(나루결.말뚝어둠);
  const 널밝 = new THREE.Color(나루결.널);
  const 널어 = new THREE.Color(나루결.널어둠);

  const 놓기 = (g, 자리, 회전, 색) => {
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(자리[0] * 미터, 자리[1] * 미터, 자리[2] * 미터),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(회전[0], 회전[1], 회전[2]),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    조각.push(색입히기(g, 색));
  };

  const 가운데 = (X[0] + X[1]) / 2;
  const 반폭 = (X[1] - X[0]) / 2;

  // ── 말뚝 ── 물가에서 물 쪽으로 두 줄. 길이·기울기를 흩어야 박은 것으로 보인다.
  const 말뚝자리 = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const z = 물가 - 0.4 + 뻗음 * t;
    for (const 쪽 of [-1, 1]) {
      const x = 가운데 + 쪽 * (반폭 - 0.25 - 난수() * 0.2);
      const 키 = 1.0 + 난수() * 0.75 + t * 0.35; // 물 쪽일수록 길게 박힌다
      const 굵기 = 0.09 + 난수() * 0.05;
      말뚝자리.push({ x, z, 키 });
      놓기(
        풀기(
          new THREE.CylinderGeometry(굵기 * 미터, 굵기 * 1.2 * 미터, 키 * 미터, 6, 1),
        ),
        [x, 바닥높이 - 0.35 + 키 / 2, z],
        [(난수() - 0.5) * 0.13, 난수() * Math.PI, (난수() - 0.5) * 0.13],
        c.copy(말어).lerp(말밝, 0.35 + 난수() * 0.6).clone(),
      );
    }
  }

  // ── 널 ── 말뚝 위에 걸친 판자 몇 장. 사이를 벌려 놔야 널로 보인다.
  const 널수 = 4;
  for (let i = 0; i < 널수; i++) {
    const 폭 = (반폭 * 2 - 0.5) / 널수;
    const x = 가운데 - 반폭 + 0.25 + 폭 * (i + 0.5);
    const 길이 = 뻗음 + 0.9;
    놓기(
      풀기(
        new THREE.BoxGeometry(폭 * 0.82 * 미터, 0.07 * 미터, 길이 * 미터),
      ),
      [x, 바닥높이 + 0.34 + (난수() - 0.5) * 0.03, 물가 - 0.6 + 길이 / 2],
      [(난수() - 0.5) * 0.02, (난수() - 0.5) * 0.02, 0],
      c.copy(널어).lerp(널밝, 0.4 + 난수() * 0.55).clone(),
    );
  }

  // ── 가로대 ── 널을 받치는 나무. 없으면 판자가 떠 있는 것처럼 보인다.
  for (const t of [0.08, 0.62]) {
    놓기(
      풀기(new THREE.BoxGeometry(반폭 * 2 * 미터, 0.12 * 미터, 0.14 * 미터)),
      [가운데, 바닥높이 + 0.25, 물가 - 0.4 + 뻗음 * t],
      [0, 0, 0],
      c.copy(말어).lerp(말밝, 0.5).clone(),
    );
  }

  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}
