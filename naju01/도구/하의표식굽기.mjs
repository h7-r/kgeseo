// 하의표식굽기.mjs — Meshy 몸체의 옷 표식(_TINT)을 **상의(2) · 하의(3)** 로 나눠 굽는다.
//
// [왜]  캐릭터 생성 화면에서 상의 · 하의 색을 따로 고르게 했다. 그런데 정점 표식은
//   피부(1) · 옷(2) 둘뿐이라 상·하의가 한 덩어리였다(meshy_mark_tint.py).
//   허리 높이로 자르는 방법은 안 된다 — 티셔츠 밑단이 반바지 허리띠 **위로 내려와 겹친다**
//   (남 0.72 m 까지 · 반바지는 0.85 m 까지). 높이 하나로는 갈라지지 않는다.
//
// [어떻게]  「상의만 입은 몸(meshy-top-*)」과 「하의만 입은 몸(meshy-bottom-*)」이 이미 있다.
//   상·하의를 다 입은 몸(meshy-both-*)의 옷 정점마다 **두 몸 중 어느 옷에 더 가까운가**를 본다.
//     상의 몸의 옷이 더 가까우면 상의(2) · 하의 몸의 옷이 더 가까우면 하의(3).
//   ※ 몸마다 따로 구운 메시라 정점이 같은 자리에 있지 않다(1~6 cm 어긋난다 — 실측).
//     그래서 「같은 자리에 있나」가 아니라 「어느 쪽이 더 가까운가」로 가른다.
//   경계에 점박이가 남지 않게 **이웃 정점끼리 다수결**로 두 번 다듬는다.
//   하의만 입은 몸의 옷은 전부 하의(3)다.
//   툰 셰이더(툰재질.js)는 3 을 하의 색으로, 2 를 상의 색으로 칠한다.
//   ※ 예전 셰이더도 1.5 넘으면 옷으로 보므로 3 이 섞여도 깨지지 않는다(한 색으로 칠할 뿐).
//
// [쓰는 법]  node naju01/도구/하의표식굽기.mjs        (저장소 뿌리에서)
//   여러 번 돌려도 결과가 같다(상의 · 하의 몸은 건드리지 않고, 다 입은 몸은 매번 새로 가른다).
//   모델을 새로 구운 뒤(meshy_mark_tint.py) 다시 돌려야 한다.
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const 폴더 = "public/models";

function 옷정점(prim) {
  const pos = prim.getAttribute("POSITION");
  const t = prim.getAttribute("_TINT");
  const 점 = [];
  const v = [0, 0, 0];
  const tv = [0];
  for (let i = 0; i < pos.getCount(); i++) {
    t.getElement(i, tv);
    if (tv[0] > 1.5) {
      pos.getElement(i, v);
      점.push([v[0], v[1], v[2]]);
    }
  }
  return 점;
}

// 칸 해시 — 15,000 × 10,000 을 다 견주지 않고 이웃 칸만 본다
const 칸크기 = 0.03;
function 칸만들기(점들) {
  const 칸 = new Map();
  for (const p of 점들) {
    const 키 = `${Math.floor(p[0] / 칸크기)},${Math.floor(p[1] / 칸크기)},${Math.floor(p[2] / 칸크기)}`;
    if (!칸.has(키)) 칸.set(키, []);
    칸.get(키).push(p);
  }
  return 칸;
}
// 가장 가까운 거리(제곱) — 가까운 칸부터 넓혀 가며 찾는다
function 최근거리(칸, p) {
  const cx = Math.floor(p[0] / 칸크기), cy = Math.floor(p[1] / 칸크기), cz = Math.floor(p[2] / 칸크기);
  let 최소 = Infinity;
  for (let r = 1; r <= 6; r++) {
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          const 목록 = 칸.get(`${x},${y},${z}`);
          if (!목록) continue;
          for (const q of 목록) {
            const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
            if (d < 최소) 최소 = d;
          }
        }
    // 찾은 거리가 이번 테두리 안쪽이면 더 넓혀도 더 가까운 건 없다
    if (최소 < (r * 칸크기) ** 2) break;
  }
  return 최소;
}

for (const 성 of ["male", "female"]) {
  // ① 상의만 · 하의만 입은 몸의 옷 정점
  const 윗몸 = (await io.read(`${폴더}/meshy-top-${성}.glb`)).getRoot().listMeshes()[0].listPrimitives()[0];
  const 아랫몸원본 = (await io.read(`${폴더}/meshy-bottom-${성}.glb`)).getRoot().listMeshes()[0].listPrimitives()[0];
  const 상의칸 = 칸만들기(옷정점(윗몸));
  const 하의칸 = 칸만들기(옷정점(아랫몸원본));

  // ② 다 입은 몸 — 옷 정점을 더 가까운 쪽으로 가른다
  const 문서 = await io.read(`${폴더}/meshy-both-${성}.glb`);
  const 몸 = 문서.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = 몸.getAttribute("POSITION");
  const t = 몸.getAttribute("_TINT");
  const v = [0, 0, 0];
  const tv = [0];
  const 갈래 = new Int8Array(pos.getCount()); // 0 = 옷 아님 · 2 = 상의 · 3 = 하의
  for (let i = 0; i < pos.getCount(); i++) {
    t.getElement(i, tv);
    if (tv[0] < 1.5) continue;
    pos.getElement(i, v);
    // ★ 하의 쪽이 **확실히** 더 가까울 때만 하의로 본다(제곱거리 0.45 배 ≈ 거리 0.67 배).
    //   티셔츠 밑단은 반바지 허리띠와 겹쳐 두 몸 모두에 가깝다 — 반반이면 밑단에 하의 색 줄이 생겼다.
    갈래[i] = 최근거리(하의칸, v) < 최근거리(상의칸, v) * 0.45 ? 3 : 2;
  }
  // 이웃 다수결 두 번 — 삼각형으로 이어진 옷 정점끼리
  const 색인 = 몸.getIndices();
  const 이웃 = Array.from({ length: pos.getCount() }, () => []);
  for (let k = 0; k < 색인.getCount(); k += 3) {
    const a = 색인.getScalar(k), b = 색인.getScalar(k + 1), c = 색인.getScalar(k + 2);
    이웃[a].push(b, c); 이웃[b].push(a, c); 이웃[c].push(a, b);
  }
  for (let 번 = 0; 번 < 2; 번++) {
    const 다음 = 갈래.slice();
    for (let i = 0; i < 갈래.length; i++) {
      if (!갈래[i]) continue;
      let 상 = 0, 하 = 0;
      for (const j of 이웃[i]) { if (갈래[j] === 2) 상++; else if (갈래[j] === 3) 하++; }
      if (갈래[i] === 2 && 하 > 상 * 2) 다음[i] = 3;
      else if (갈래[i] === 3 && 상 > 하 * 2) 다음[i] = 2;
    }
    갈래.set(다음);
  }
  let 상 = 0, 하 = 0;
  for (let i = 0; i < 갈래.length; i++) {
    if (!갈래[i]) continue;
    t.setElement(i, [갈래[i]]);
    if (갈래[i] === 2) 상++; else 하++;
  }
  await io.write(`${폴더}/meshy-both-${성}.glb`, 문서);
  console.log(`meshy-both-${성}: 상의 ${상} · 하의 ${하}`);

  // ③ 하의만 입은 몸 — 옷은 전부 하의
  const 아랫문서 = await io.read(`${폴더}/meshy-bottom-${성}.glb`);
  const 아랫몸 = 아랫문서.getRoot().listMeshes()[0].listPrimitives()[0];
  const at = 아랫몸.getAttribute("_TINT");
  let n = 0;
  for (let i = 0; i < at.getCount(); i++) {
    at.getElement(i, tv);
    if (tv[0] > 1.5 && tv[0] < 2.5) { at.setElement(i, [3]); n++; }
  }
  await io.write(`${폴더}/meshy-bottom-${성}.glb`, 아랫문서);
  console.log(`meshy-bottom-${성}: 하의 ${n}`);
}
