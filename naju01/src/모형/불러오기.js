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

// ── 가는 것(기둥·가로대) 찾기 ───────────────────────────────
//   [무엇을 푸나]
//     Meshy 모형에는 재질이 없다. 그런데 천막은 **천과 나무**로 되어 있고,
//     둘은 색이 달라야 한다(사용자 지시: 천 회색 · 기둥 나무색).
//     「여기가 나무」라고 적힌 데가 없으니 **모양으로** 갈라야 한다.
//
//   [갈리는 성질]
//     기둥은 **가로로 가늘다.** 어느 높이에서 얇게 썰어 보면 지름 몇 cm 짜리
//     작은 점이다. 천은 넓게 퍼진 면이라 같은 높이에서 사방으로 뻗는다.
//     실측(천막 모형, 길이 1 기준)으로 분포가 **깨끗하게 둘로 갈렸다** —
//       가로 퍼짐 0.02~0.06 : 1,520 점 (17 %)  ← 기둥
//       가로 퍼짐 0.13~0.14 : 7,683 점 (83 %)  ← 천
//     그 사이가 텅 비어 있어서 문턱을 어디에 둬도 같다.
//
//   [가로대는 한 겹 더 봐야 한다]
//     천을 걸친 **가로 막대**도 나무인데, 가로로 길어서 위 시험만으로는
//     천으로 잡힌다. 그래서 이웃의 **주축**을 본다 — 막대는 한 방향으로만
//     길고 다른 방향으로는 가늘다. 작은 축이 얇으면 나무다.
//
//   [빠르기]  높이 슬랩 + 가로 격자로 나눠 이웃을 찾는다. 다 훑으면
//     꼭짓점 5 만 개에 2 억 번이라 시작이 눈에 띄게 느려진다.
export function 가는것찾기(
  면,
  { 슬랩 = 0.03, 반경 = 0.14, 퍼짐문턱 = 0.06, 작은축문턱 = 0.035 } = {},
) {
  const p = 면.attributes.position;
  const n = p.count;

  // ── 먼저 **같은 자리를 하나로 묶는다** ────────────────────
  //   `toNonIndexed()` 를 지난 지오메트리는 면마다 꼭짓점을 따로 갖는다.
  //   같은 자리가 평균 세 벌씩 있는 셈이라, 그대로 재면 **바깥 고리도 세 배
  //   안쪽 고리도 세 배 → 아홉 배** 느리다(실측 1.79 초. 시작할 때 두 번
  //   돌아서 3.6 초를 잡아먹었다).
  //   자리별로 한 번만 재고 나머지는 그 답을 물려받는다.
  const 대표 = new Map();
  const 어느자리 = new Int32Array(n);
  const 자리들 = [];
  for (let i = 0; i < n; i++) {
    const k = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    let r = 대표.get(k);
    if (r === undefined) {
      r = 자리들.length;
      대표.set(k, r);
      자리들.push(i);
    }
    어느자리[i] = r;
  }
  const m = 자리들.length;

  // 높이 슬랩 → 가로 격자
  const 칸 = 반경;
  const 통 = new Map();
  const 열쇠 = (s, gx, gz) => `${s}|${gx}|${gz}`;
  for (let r = 0; r < m; r++) {
    const i = 자리들[r];
    const k = 열쇠(
      Math.floor(p.getY(i) / 슬랩),
      Math.floor(p.getX(i) / 칸),
      Math.floor(p.getZ(i) / 칸),
    );
    let a = 통.get(k);
    if (!a) 통.set(k, (a = []));
    a.push(i);
  }
  const 나무자리 = new Set();
  const 반경2 = 반경 * 반경;
  for (let r = 0; r < m; r++) {
    const i = 자리들[r];
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const s = Math.floor(y / 슬랩);
    const gx = Math.floor(x / 칸);
    const gz = Math.floor(z / 칸);
    let 최대 = 0;
    let sx = 0;
    let sz = 0;
    let 셈 = 0;
    const 이웃 = [];
    for (let ds = -1; ds <= 1; ds++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = 통.get(열쇠(s + ds, gx + dx, gz + dz));
          if (!a) continue;
          for (const j of a) {
            const ex = p.getX(j) - x;
            const ez = p.getZ(j) - z;
            const d2 = ex * ex + ez * ez;
            if (d2 > 반경2) continue;
            최대 = Math.max(최대, d2);
            이웃.push(ex, ez);
            sx += ex;
            sz += ez;
            셈++;
          }
        }
    if (Math.sqrt(최대) < 퍼짐문턱) {
      나무자리.add(r);
      continue;
    }
    if (셈 < 4) continue;
    // 주축 — 2×2 공분산의 작은 고유값이 곧 「가는 쪽」이다
    const mx = sx / 셈;
    const mz = sz / 셈;
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    for (let k = 0; k < 이웃.length; k += 2) {
      const ex = 이웃[k] - mx;
      const ez = 이웃[k + 1] - mz;
      a11 += ex * ex;
      a12 += ex * ez;
      a22 += ez * ez;
    }
    a11 /= 셈;
    a12 /= 셈;
    a22 /= 셈;
    const 합 = a11 + a22;
    const 곱 = a11 * a22 - a12 * a12;
    const 뿌리 = Math.sqrt(Math.max(0, (합 * 합) / 4 - 곱));
    const 작은축 = 2 * Math.sqrt(Math.max(0, 합 / 2 - 뿌리));
    if (작은축 < 작은축문턱) 나무자리.add(r);
  }
  // 자리별 답을 꼭짓점으로 되돌린다
  const 나무 = new Set();
  for (let i = 0; i < n; i++) if (나무자리.has(어느자리[i])) 나무.add(i);
  return 나무;
}

// ── 나무 줄기 찾기 ──────────────────────────────────────────
//   [안 되던 것들 — 다 재 보고 버렸다]
//     · `가는것찾기`(가로로 가는가)  → 줄기 굵기(0.1)가 찾는 반경(0.14)과
//       비슷해 **전부 0.14 로 포화**됐다. 밑동과 잎이 안 갈렸다.
//     · 연결 성분                    → 잎이 줄기에 **붙어 있다**(한 덩어리
//       99 %). 나뭇잎이 낱장으로 떨어져 있을 줄 알았는데 아니었다.
//     · 얇은 판(법선 마주보기)        → 잎도 **속이 찬 덩어리**다(얇은 점 1 %).
//   [되는 것 — 나무는 아래가 줄기다]
//     높이별 꼭짓점 수를 세면 **잎이 시작되는 층에서 갑자기 뛴다**(실측:
//     나무1 은 0.2 층 18 개 → 0.3 층 267 개). 그 아래가 줄기다.
//     그 위로도 줄기가 이어지지만 잎에 가려 거의 안 보인다. 다만 **줄기
//     축에서 가까운 점**은 위에서도 줄기로 친다 — 잎 사이로 보이는 부분이다.
//   [★ 위로 얼마나 올라갈지는 **짜게** 잡는다]
//     줄기에 바짝 붙은 잎 뭉치가 있어서, 넉넉히 잡으면 **잎이 갈색이 된다**
//     (사용자 지적). 덜 칠해 줄기 윗부분이 초록으로 남는 건 잎에 가려
//     거의 안 보이지만, 잎이 갈색인 건 바로 눈에 띈다. 그래서 짜게.
export function 줄기찾기(면, { 잎시작몫 = 12, 줄기여유 = 0.7, 위로 = 0.32 } = {}) {
  const p = 면.attributes.position;
  const n = p.count;
  let 최고 = 0;
  for (let i = 0; i < n; i++) 최고 = Math.max(최고, p.getY(i));
  const 층수 = 10;
  const 칸 = 최고 / 층수;
  const 셈 = new Array(층수).fill(0);
  for (let i = 0; i < n; i++)
    셈[Math.min(층수 - 1, Math.floor(p.getY(i) / 칸))]++;
  // 잎이 시작되는 층 — 전체의 1/잎시작몫 을 처음 넘는 층
  const 문턱 = n / 잎시작몫;
  let 잎층 = 층수;
  for (let k = 0; k < 층수; k++) if (셈[k] > 문턱) { 잎층 = k; break; }
  const 줄기끝 = 잎층 * 칸;

  // 줄기 축과 굵기 — **뿌리 위, 잎 아래** 띠에서만 잰다.
  //   ★ 밑동 전체로 재면 안 된다. 뿌리가 사방으로 뻗어 있어서 굵기가
  //     실제 줄기의 두세 배로 나오고, 그 반지름으로 위쪽을 훑으면
  //     **잎까지 갈색으로 칠해진다**(사용자 지적).
  const 뿌리위 = 줄기끝 * 0.45;
  let cx = 0, cz = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y >= 뿌리위 && y < 줄기끝) { cx += p.getX(i); cz += p.getZ(i); m++; }
  }
  if (m) { cx /= m; cz /= m; }
  let 굵기 = 0;
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y >= 뿌리위 && y < 줄기끝)
      굵기 = Math.max(굵기, Math.hypot(p.getX(i) - cx, p.getZ(i) - cz));
  }
  굵기 = (굵기 || 0.06) * 줄기여유;

  // ★ 반지름 조건을 **높이 전 구간에** 건다.
  //   예전에는 「줄기끝 아래는 무조건 줄기」였는데, 낮게 매달린 잎 뭉치가
  //   그 띠 안에 있어서 **갈색으로 칠해졌다**(사용자 지적: 잎사귀도 갈색).
  //   뿌리는 사방으로 뻗으므로 뿌리 띠에서만 넉넉히 봐준다.
  const 줄기 = new Set();
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    if (y > 최고 * 위로) continue; // 위쪽은 잎이다
    const r = Math.hypot(p.getX(i) - cx, p.getZ(i) - cz);
    const 봐줌 = y < 뿌리위 ? 굵기 * 2.2 : 굵기; // 뿌리는 넓게 뻗는다
    if (r < 봐줌) 줄기.add(i);
  }
  return { 줄기, 줄기끝, 굵기, 축: [cx, cz] };
}
