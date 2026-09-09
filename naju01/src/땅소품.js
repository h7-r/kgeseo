// ═══════════════════════════════════════════════════════════════
//  땅소품.js — 손으로 놓는 「언덕」과 「길」
// ═══════════════════════════════════════════════════════════════
// [무엇인가]
//   지금까지 언덕과 길은 **도면이 정하고 생성기가 만드는 것**이었다.
//   그런데 무대 밖을 꾸미다 보면 「여기 둔덕 하나」, 「저기로 오솔길」처럼
//   손으로 얹고 싶은 데가 생긴다. 그걸 위한 조각이다.
//
// [★ 걷는 높이는 안 바뀐다 — 반드시 알고 써야 한다]
//   이건 **그림일 뿐**이다. `지형.js` 의 `지면`·`막힘` 은 도면에서 나오고,
//   그 대조(±0.5 m)와 실측 하네스가 이 프로젝트의 뼈대다. 여기서 놓은 언덕을
//   판정에 넣으면 그 뼈대가 무너진다.
//     · 코어 **안**에 놓으면 → 언덕 위를 걸어 오르지 못하고 **뚫고 지나간다**
//     · 코어 **밖**(원경)에 놓으면 → 어차피 못 가는 데라 아무 문제 없다
//   그래서 이건 **원경용**이다. 코어 안에 지형을 더하려면 도면(`공간도면.js`)을
//   고쳐야 하고, 그건 팀이 정할 일이다(§7 0단계).
//
// [단위]  표본은 **1 짜리**로 만든다. m 변환은 `무리만들기` 가 `키 × 미터` 로 한다.
//   언덕은 밑동이 원점, 키 1, 바닥 지름 1 — 팔레트에서 `기본키` 로 크기를 준다.
//   길은 **국소 +Z 로 누운** 길이 1 짜리 조각이다(울타리 가로대와 같은 규약).

import * as THREE from "three";
import { makeRandom } from "../../src/공용.jsx";

// 언덕·길 색 — 화풍 값이라 여기 둔다.
//   ※ 꼭짓점 색에는 **비율**만 굽는다. 실제 색은 `instanceColor` 가 준다
//     (원경.js 의 표본 주석과 같은 규칙이다).
export const 땅소품결 = {
  언덕: 0x74804f, // 풀 덮인 둔덕
  길: 0x9a8a6e, // 밟혀 다져진 흙
};

// ── 언덕 ────────────────────────────────────────────────────
//   밑동이 원점, 키 1, 바닥 지름 1(가로세로는 `폭비`·`깊이비` 로 늘린다).
//   [왜 반구가 아닌가]
//     매끈한 반구는 「공을 반 자른 것」으로 보인다. 언덕은 능선이 한쪽으로
//     흐르고 옆구리가 파여야 언덕으로 읽힌다. 그래서 꼭짓점을 결대로 민다.
export function 언덕표본들(수 = 4, 시드 = 8101) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    // 반구를 세로로 눌러 밑동을 넓힌다
    const g = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    // 결 — 방향 셋을 겹쳐야 한쪽으로만 밀린 꼴을 면한다
    const 결 = [0, 1, 2].map(() => ({
      a: 난수() * Math.PI * 2,
      f: 1.4 + 난수() * 2.6,
      s: 0.06 + 난수() * 0.13,
    }));
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const 위 = THREE.MathUtils.clamp(y / 0.5, 0, 1); // 0 = 밑동, 1 = 마루
      let d = 0;
      for (const r of 결)
        d += Math.sin((x * Math.cos(r.a) + z * Math.sin(r.a)) * r.f * 6 + r.a) * r.s;
      // 밑동은 안 건드린다 — 흔들면 땅과 만나는 자리가 들쭉날쭉해 뜬다
      const 세기 = Math.pow(위, 0.6);
      p.setXYZ(k, x * (1 + d * 0.5 * 세기), y + d * 세기, z * (1 + d * 0.5 * 세기));
    }
    g.scale(1, 1, 1);
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3).fill(1);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    표본.push(g.toNonIndexed());
    g.dispose();
  }
  return 표본;
}

// ── 길 한 조각 ──────────────────────────────────────────────
//   **국소 +Z 로 누운** 길이 1 짜리 널. 폭은 `폭비` 로 준다.
//   [왜 두께가 있나]
//     완전한 평면을 땅에 얹으면 두 면이 같은 높이에서 다투어 **얼룩덜룩
//     깜빡인다**(z-파이팅). 얇게라도 띄워야 한다.
//   [왜 가장자리가 처지나]
//     길은 밟혀서 가운데가 다져지고 가장자리가 풀에 먹힌다. 가장자리를
//     조금 낮추면 땅에 **파묻힌** 것으로 보여 얹은 티가 덜 난다.
export function 길표본들(수 = 3, 시드 = 8303) {
  const 난수 = makeRandom(시드);
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const 칸 = 8;
    const g = new THREE.PlaneGeometry(1, 1, 3, 칸);
    g.rotateX(-Math.PI / 2); // XZ 평면에 눕힌다(길이 = Z)
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k); // -0.5 ~ 0.5 (폭)
      const z = p.getZ(k);
      const 가 = Math.abs(x) / 0.5; // 0 = 한복판, 1 = 가장자리
      // 가장자리는 내려앉고, 길이를 따라 살짝 굼실거린다
      const 굼실 = Math.sin(z * 9 + i * 2.1) * 0.006 + (난수() - 0.5) * 0.004;
      p.setY(k, 0.012 - Math.pow(가, 2.2) * 0.016 + 굼실);
      // 가장자리를 안팎으로 흔들어 자로 그은 띠를 면한다
      p.setX(k, x * (1 + (난수() - 0.5) * 0.12 * 가));
    }
    g.computeVertexNormals();
    const n = p.count;
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      // 한복판이 밝다(다져진 흙) — 가장자리는 어둡다
      const 가 = Math.abs(g.attributes.position.getX(k)) / 0.5;
      const v = 1 - Math.pow(가, 1.6) * 0.28;
      c[k * 3] = v;
      c[k * 3 + 1] = v;
      c[k * 3 + 2] = v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    표본.push(g.toNonIndexed());
    g.dispose();
  }
  return 표본;
}
