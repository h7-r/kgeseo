// 무대 밖을 꾸밀 때 손으로 얹는 「언덕」과 「길」 조각(편집기 팔레트용).
// 걷는 높이는 안 바뀐다 — 그림일 뿐이다. 판정은 도면에서 나오고 그 대조가 이 프로젝트의 뼈대라,
// 코어 안에 놓으면 뚫고 지나간다. 그래서 원경용이다. 코어 지형을 더하려면 도면을 고쳐야 한다.
// 표본은 1 짜리. 언덕은 밑동 원점 · 키 1 · 바닥 지름 1, 길은 국소 +Z 로 누운 길이 1 조각(울타리 가로대와 같은 규약).
// 꼭짓점 색에는 비율만 굽고 실제 색은 instanceColor 가 준다.

import * as THREE from "three";

import { makeRandom } from "@/engine/random";

export const LAND_PIECE_STYLE = {
  mound: 0x74804f, // 풀 덮인 둔덕
  path: 0x9a8a6e, // 밟혀 다져진 흙
};

/** 언덕 — 매끈한 반구는 공을 반 자른 것으로 보여, 능선이 한쪽으로 흐르게 꼭짓점을 결대로 민다. */
export function moundPrototypes(count = 4, seed = 8101): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = geometry.attributes.position;
    // 방향 셋을 겹쳐야 한쪽으로만 밀린 꼴을 면한다
    const waves = [0, 1, 2].map(() => ({
      a: random() * Math.PI * 2,
      f: 1.4 + random() * 2.6,
      s: 0.06 + random() * 0.13,
    }));
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const up = THREE.MathUtils.clamp(y / 0.5, 0, 1); // 0 = 밑동, 1 = 마루
      let d = 0;
      for (const w of waves) d += Math.sin((x * Math.cos(w.a) + z * Math.sin(w.a)) * w.f * 6 + w.a) * w.s;
      // 밑동은 안 건드린다 — 흔들면 땅과 만나는 자리가 들쭉날쭉해 뜬다
      const strength = Math.pow(up, 0.6);
      p.setXYZ(k, x * (1 + d * 0.5 * strength), y + d * strength, z * (1 + d * 0.5 * strength));
    }
    geometry.computeVertexNormals();
    const colors = new Float32Array(p.count * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    prototypes.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  return prototypes;
}

/**
 * 길 한 조각. 완전한 평면을 땅에 얹으면 z-파이팅으로 깜빡여 얇게라도 띄운다.
 * 가장자리를 조금 낮추면 땅에 파묻힌 것으로 보여 얹은 티가 덜 난다.
 */
export function pathPiecePrototypes(count = 3, seed = 8303): THREE.BufferGeometry[] {
  const random = makeRandom(seed);
  const prototypes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const cells = 8;
    const geometry = new THREE.PlaneGeometry(1, 1, 3, cells);
    geometry.rotateX(-Math.PI / 2); // 길이 = Z
    const p = geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k); // -0.5 ~ 0.5 (폭)
      const z = p.getZ(k);
      const edge = Math.abs(x) / 0.5; // 0 = 한복판, 1 = 가장자리
      const undulation = Math.sin(z * 9 + i * 2.1) * 0.006 + (random() - 0.5) * 0.004;
      p.setY(k, 0.012 - Math.pow(edge, 2.2) * 0.016 + undulation);
      // 가장자리를 안팎으로 흔들어 자로 그은 띠를 면한다
      p.setX(k, x * (1 + (random() - 0.5) * 0.12 * edge));
    }
    geometry.computeVertexNormals();
    const colors = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      // 한복판(다져진 흙)이 밝고 가장자리는 어둡다
      const edge = Math.abs(p.getX(k)) / 0.5;
      const v = 1 - Math.pow(edge, 1.6) * 0.28;
      colors[k * 3] = v;
      colors[k * 3 + 1] = v;
      colors[k * 3 + 2] = v;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    prototypes.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  return prototypes;
}
