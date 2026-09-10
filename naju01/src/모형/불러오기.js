// ═══════════════════════════════════════════════════════════════
//  모형/불러오기.js — 구운 모형을 표본(BufferGeometry)으로 푼다
// ═══════════════════════════════════════════════════════════════
// [왜 따로 두나]
//   `도구/모형굽기.mjs` 가 구워 놓은 모듈은 base64 두 줄이 전부다. 그걸
//   three 지오메트리로 돌리는 일은 어느 모형이든 똑같다 — 구렁이에 한 번,
//   통발에 한 번 적어 두면 다음 모형에서 또 적게 된다. 한 군데로 모은다.
//
// [반드시 지키는 두 가지]
//   ① `toNonIndexed()` 를 **먼저** 한다.
//      인덱스를 살린 채 `computeVertexNormals` 하면 꼭짓점을 공유해
//      **매끈해진다.** 이 그레이박스는 면마다 각진 저폴리 화풍이라, 혼자만
//      미끈거리면 다른 물건과 같은 세계로 안 보인다.
//   ② 꼭짓점 색을 **반드시** 깐다.
//      재질이 `vertexColors: true` 인데 `color` 속성이 없으면 three 가 없는
//      값을 **(0, 0, 0)** 으로 읽어 통째로 검게 나온다. 이 프로젝트에서
//      네 번 겪은 함정이다(바위 · 팔레트 썸네일 · 표본 전반 · 모형).
//      ★ 굽는 것은 **비율**이다. 실제 색은 `instanceColor` 가 곱한다.

import * as THREE from "three";

const 풀기 = (글, 형) => {
  const 이진 = atob(글);
  const 바이트 = new Uint8Array(이진.length);
  for (let i = 0; i < 이진.length; i++) 바이트[i] = 이진.charCodeAt(i);
  return new 형(바이트.buffer);
};

// ── 모형 → 지오메트리 ───────────────────────────────────────
//   `칠하기(면, 모형, 색)` 을 주면 색 배열을 직접 채우게 한다.
//     ※ 꼭짓점 하나씩이 아니라 **지오메트리 통째로** 넘긴다. 눈이나 무늬처럼
//       「머리가 어디인가」를 먼저 찾아야 하는 칠은 한 꼭짓점만 봐서는 못 한다.
//   안 주면 **위아래 명암**만 넣는다 — 아래가 밝고 위가 어둡다.
//   [왜 기본이 명암인가]  단색 덩어리는 실루엣만 보이고 부피가 안 읽힌다.
//   저폴리에서는 면 각도만으로 부족해서, 높이로 한 겹 더 깔아 준다.
export function 모형지오(모형, { 칠하기 = null, 아래 = 1.2, 위 = 0.68 } = {}) {
  const g = new THREE.BufferGeometry();
  g.setIndex(new THREE.BufferAttribute(풀기(모형.인덱스, Uint16Array), 1));
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(풀기(모형.위치, Float32Array), 3),
  );
  const 면 = g.toNonIndexed(); // ★ ① — 반드시 먼저
  g.dispose();
  면.computeVertexNormals();

  const 자리 = 면.attributes.position;
  const 색 = new Float32Array(자리.count * 3);
  const 높이 = 모형.폭?.y || 1;
  if (칠하기) 칠하기(면, 모형, 색);
  else
    for (let i = 0; i < 자리.count; i++) {
      const t = THREE.MathUtils.clamp(자리.getY(i) / 높이, 0, 1);
      const v = 아래 + (위 - 아래) * Math.pow(t, 0.8);
      색[i * 3] = v;
      색[i * 3 + 1] = v;
      색[i * 3 + 2] = v;
    }
  면.setAttribute("color", new THREE.BufferAttribute(색, 3)); // ★ ②
  return 면;
}

// ── 머리 찾기 ───────────────────────────────────────────────
//   쳐든 머리를 가진 모형(구렁이)에서 **두개골 · 주둥이 방향 · 옆방향**을 잰다.
//
// [왜 좌표를 코드에 안 박나]
//   모형을 다시 구우면(줄이는 비율만 바꿔도) 꼭짓점이 통째로 달라진다.
//   박아 두면 그때마다 눈이 엉뚱한 데 찍힌다. 그래서 **그때그때 잰다.**
//
// [★ 「가장 높은 점」을 머리로 삼으면 안 된다 — 한 번 틀렸다]
//   처음엔 최고점을 머리끝으로 잡았다. 그런데 이 모형은 **혀를 내밀고
//   있어서**, 최고점이 두개골이 아니라 **혓바닥 끝**이었다. 눈이 허공에
//   찍혔다(실측 스크린샷에서 눈이 아예 안 보였다).
//   그래서 「높은 곳」이 아니라 **「두꺼운 곳」**을 찾는다 —
//   두개골은 살이 붙어 두껍고, 혀와 주둥이는 가늘다.
//     · 머리대   = 꼭대기에서 `머리깊이` 만큼 내려온 띠
//     · 두개골   = 그 안에서 **이웃이 가장 많은** 점 (= 가장 두꺼운 자리)
//     · 주둥이   = 두개골 → 머리대에서 가장 먼 점 (혀·코끝 쪽)
//     · 옆       = 위 × 주둥이 (눈이 붙는 축)
//     · 머리폭   = 두개골 둘레의 가로 반지름 (눈을 얼마나 벌릴지)
export function 머리재기(면, { 머리깊이 = 0.11, 이웃 = 0.05 } = {}) {
  const p = 면.attributes.position;
  let 최고 = -Infinity;
  for (let i = 0; i < p.count; i++) 최고 = Math.max(최고, p.getY(i));

  // 머리대만 추린다 — 전체를 다 보면 O(n²) 이 감당이 안 된다
  const 대 = [];
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) > 최고 - 머리깊이)
      대.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));

  // 가장 두꺼운 자리 = 이웃이 가장 많은 점
  const r2 = 이웃 * 이웃;
  let 두개골 = 대[0] ?? new THREE.Vector3();
  let 최다 = -1;
  for (let a = 0; a < 대.length; a++) {
    let n = 0;
    for (let b = 0; b < 대.length; b++)
      if (대[a].distanceToSquared(대[b]) < r2) n++;
    if (n > 최다) {
      최다 = n;
      두개골 = 대[a];
    }
  }

  // 주둥이 = 두개골에서 가장 먼 머리대 점
  let 코 = 두개골;
  let 멀리 = -1;
  for (const q of 대) {
    const d = q.distanceToSquared(두개골);
    if (d > 멀리) {
      멀리 = d;
      코 = q;
    }
  }
  const 주둥이 = 코.clone().sub(두개골).normalize();
  const 옆 = new THREE.Vector3(0, 1, 0).cross(주둥이).normalize();

  // 머리폭 = 두개골 **바로 둘레**에서 옆축으로 가장 벌어진 거리
  //   ★ 처음엔 「앞뒤 얇은 띠」로 쟀다가 두 배 넘게 나왔다(0.085 — 실제 반폭은
  //     0.037 이다). 옆축이 X 축과 나란하지 않아서, 머리 **길이 방향**으로
  //     퍼진 점까지 옆으로 투영되어 섞인 것이다. 그 값으로 눈을 그렸더니
  //     눈이 머리를 통째로 덮는 노란 덩어리가 됐다.
  //     두개골에서 반경 안에 든 점만 본다.
  let 폭 = 0;
  const 임 = new THREE.Vector3();
  const 반경 = 이웃 * 0.8;
  for (const q of 대) {
    임.copy(q).sub(두개골);
    if (임.length() < 반경) 폭 = Math.max(폭, Math.abs(임.dot(옆)));
  }
  return {
    두개골,
    주둥이,
    옆,
    머리폭: 폭 || 이웃 * 0.5,
    머리길이: Math.sqrt(멀리),
    코,
  };
}
