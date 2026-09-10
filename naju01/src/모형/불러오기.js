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

// ── 혀 찾기 ─────────────────────────────────────────────────
//   [왜 어렵나]  이 모형에는 재질도 UV 도 없다. 「여기가 혀」라고 적힌 데가
//   없으니 **모양만 보고** 알아내야 한다.
//   [안 되던 것 셋]
//     · 「가장 먼 점」    → 한 점뿐이라 못 쓴다
//     · 「이웃이 적은 점」→ 메시 밀도가 들쭉날쭉해 안 갈렸다(실측: 두개골
//       근처 이웃 중앙 62, 혀 근처 42 — 겹친다)
//     · 「얇은 판인 점」  → 줄인 메시에는 얇은 조각이 여기저기 있어서
//       **머리와 목까지 빨개졌다**(확대 스크린샷으로 잡았다)
//   [되는 것]  혀는 **혀끝에서 이어진 한 덩어리**다. 가장 먼 점에서
//     시작해 이웃을 타고 번져 나가되, **혀끝에서 일정 거리까지만** 간다.
//     입에 붙어 있으니 더 가면 머리로 새는데, 거리로 끊으면 딱 혀만 남는다.
export function 혀찾기(면, { 시작점, 이음 = 0.018, 길이 = 0.085 } = {}) {
  const p = 면.attributes.position;
  const q = new THREE.Vector3();

  // 혀끝 = 주어진 자리에서 가장 가까운 꼭짓점
  let 씨 = 0;
  let 최소 = Infinity;
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i), p.getY(i), p.getZ(i));
    const d = q.distanceToSquared(시작점);
    if (d < 최소) {
      최소 = d;
      씨 = i;
    }
  }
  const 끝 = new THREE.Vector3(p.getX(씨), p.getY(씨), p.getZ(씨));

  // 혀끝 둘레만 추려 놓고 번진다 — 전체를 돌면 O(n²) 이 감당이 안 된다
  const 둘레 = [];
  for (let i = 0; i < p.count; i++) {
    q.set(p.getX(i), p.getY(i), p.getZ(i));
    if (q.distanceTo(끝) < 길이) 둘레.push(i);
  }
  const 자리 = 둘레.map(
    (i) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)),
  );
  const 든것 = new Set([씨]);
  const 줄 = [끝.clone()];
  const 이음2 = 이음 * 이음;
  while (줄.length) {
    const 현 = 줄.pop();
    for (let k = 0; k < 둘레.length; k++) {
      const i = 둘레[k];
      if (든것.has(i)) continue;
      if (자리[k].distanceToSquared(현) > 이음2) continue;
      든것.add(i);
      줄.push(자리[k]);
    }
  }
  return 든것;
}

// ── 눈알 붙이기 ─────────────────────────────────────────────
//   [왜 칠하지 않고 붙이나]
//     꼭짓점 색으로 눈을 그렸더니 **들쭉날쭉한 노란 얼룩**이 됐다. 머리
//     표면의 꼭짓점이 성겨서(눈 자리 반지름 안에 몇 개 없다) 동그라미가
//     안 나오고, 가장자리가 톱니처럼 튀었다. 「눈이 파인 자국 같다」는
//     지적이 그거였다.
//     ★ 눈알은 **원래 튀어나온 것**이다. 작은 공을 실제로 붙이면 동그라미가
//       저절로 나오고, 살짝 도드라져 빛도 제대로 받는다.
//   ※ `uv` 를 **반드시 지운다.** `mergeGeometries` 는 속성 구성이 다르면
//     조용히 `null` 을 돌려주고, 그게 나중에 `morphAttributes` 오류로
//     터진다. 구(球)에는 uv 가 있고 모형에는 없다.
export function 눈알만들기({ 자리, 반지름, 바깥, 홍채, 동공, 동공비 = 0.42 }) {
  const g = new THREE.SphereGeometry(반지름, 12, 9);
  delete g.attributes.uv;
  delete g.attributes.uv1;
  const n = g.toNonIndexed();
  g.dispose();
  n.computeVertexNormals();
  const p = n.attributes.position;
  const 색 = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    // 바깥쪽을 정면으로 보는 데가 동공이다
    const 앞 = v.dot(바깥);
    const c = 앞 > 1 - 동공비 ? 동공 : 홍채;
    색[i * 3] = c[0];
    색[i * 3 + 1] = c[1];
    색[i * 3 + 2] = c[2];
  }
  n.setAttribute("color", new THREE.BufferAttribute(색, 3));
  n.translate(자리.x, 자리.y, 자리.z);
  return n;
}
