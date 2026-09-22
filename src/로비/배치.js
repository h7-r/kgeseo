// 배치.js — 물건을 '놓을 수 있는 곳'을 찾고, 겹치는지 검사한다
//
// [실제 게임들이 쓰는 방식]
//   심즈 · 발하임 · 폴아웃4 정착지 · 동물의 숲이 전부 같은 뼈대다.
//     ① 화면 중앙에서 광선을 쏴 **놓을 면**(책상 윗면 · 바닥)을 찾는다
//     ② 그 지점에 물건의 **발자국(footprint)** 을 올려 본다
//     ③ 면 밖으로 나가거나 다른 물건과 **겹치면 빨강**, 괜찮으면 초록으로 미리 보여 준다
//     ④ 초록일 때만 놓을 수 있다
//   물리 엔진이 없어도 이 네 단계만 있으면 "뚫고 겹치는" 일이 원천적으로 안 생긴다.
//   물리 엔진을 쓰는 게임(하프라이프2 중력건 등)도 결국 겹침을 막는 게 목적이라
//   결과는 같고, 이쪽이 훨씬 싸고 결과가 예측 가능하다.
//
// [왜 좌표를 직접 계산하나 (Raycaster 를 안 쓰고)]
//   놓을 면이 전부 **축에 나란한 사각형**이다(책상 회전이 0 또는 ±90°).
//   그래서 광선 ↔ 평면 교차를 식 하나로 정확히 풀 수 있다.
//   메시에 광선을 쏘면 병합된 지오메트리·외곽선 껍데기까지 다 맞아서 오히려 부정확하다.

import { useSyncExternalStore } from "react";

// ── 등록소 ────────────────────────────────────────────────
// 놓을 수 있는 면: 축에 나란한 사각형 + 윗면 높이
export const 표면 = new Map(); // id -> { minX, maxX, minZ, maxZ, top }
// 이미 자리를 차지한 물건: 3D 상자
export const 점유 = new Map(); // id -> { minX, maxX, minZ, maxZ, minY, maxY }
// 물건 크기: 발자국 반폭과 높이
export const 크기 = new Map(); // id -> { halfX, halfZ, height }

// ── 면이 바뀌면 알려 준다 ─────────────────────────────────
// [왜 필요한가]
//   책상은 GLB 라 **다 내려받은 뒤에야** 크기를 잴 수 있다(잰다 가 0.5초 간격으로
//   다시 잰다). 그래서 첫 렌더에는 아직 면이 하나도 없다.
//   "책상 윗면에 맞춰라" 같은 계산을 하려면, 면이 등록된 그 순간 한 번 더
//   그려야 한다. 시작할 때 몇 번뿐이라 값이 거의 안 든다.
let 면판 = 0;
const 면듣는이 = new Set();
const 면알리기 = () => {
  면판++;
  for (const f of 면듣는이) f();
};
export const 면바뀜 = {
  판: () => 면판,
  구독: (f) => {
    면듣는이.add(f);
    return () => 면듣는이.delete(f);
  },
};
/** 면이 바뀔 때만 새 값을 주는 번호. 이걸 useMemo 의존성에 넣어 쓴다. */
export const use면판 = () =>
  useSyncExternalStore(면바뀜.구독, 면바뀜.판, 면바뀜.판);

export const 표면등록 = (id, b) => {
  const 옛 = 표면.get(id);
  표면.set(id, b);
  // 같은 값으로 다시 재는 경우가 많다(0.5초마다 다시 잰다) → 진짜 바뀔 때만 알린다
  if (
    !옛 || 옛.top !== b.top || 옛.minX !== b.minX || 옛.maxX !== b.maxX ||
    옛.minZ !== b.minZ || 옛.maxZ !== b.maxZ
  )
    면알리기();
};
export const 표면해제 = (id) => {
  if (표면.delete(id)) 면알리기();
};

/**
 * (x, z) 바로 아래에 있는 **면의 윗높이**. 없으면 null.
 *   ★ 이게 있어야 "책상 위에 놓는다"를 숫자 두 개(책상 높이 · 물건 높이)를
 *     손으로 맞추는 대신 **한 곳에서** 정할 수 있다. 손으로 맞추면 한쪽만
 *     건드렸을 때 물건이 공중에 뜬다 — 실제로 서류가 그렇게 떠 있었다.
 *   겹쳐 있으면 제일 높은 면을 고른다(책상 위의 선반 같은 경우).
 *
 * @param 빼기 이 면은 안 본다(id => bool). **자기 자신을 반드시 빼야 한다.**
 *   ★ 물건이 스스로도 '놓을 수 있는 면'인 경우가 있다(서류·노트북 윗면).
 *     자기 면을 빼지 않으면 "내 윗면에 맞춰라 → 올라감 → 윗면도 올라감"이
 *     되어 **끝없이 기어오른다.** 실제로 그렇게 됐다(서류가 등록소에서 사라졌다).
 */
export function 면높이(x, z, 빼기) {
  let 가장위 = null;
  for (const [id, b] of 표면) {
    if (빼기 && 빼기(id)) continue;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (가장위 === null || b.top > 가장위) 가장위 = b.top;
  }
  return 가장위;
}
export const 점유등록 = (id, b) => 점유.set(id, b);
export const 점유해제 = (id) => 점유.delete(id);
export const 크기등록 = (id, s) => 크기.set(id, s);

// ── 걸이(스냅 지점) ───────────────────────────────────────
// 평면이 아닌 '한 점'에 되돌려 놓는 자리. 옷걸이에 모자를 다시 거는 것처럼.
// [왜 따로 두나]
//   놓을 자리는 광선 ↔ 수평면 교차로 찾는다. 옷걸이 가지는 면이 아니라 점이라
//   그 방식으로는 절대 안 잡힌다. 실제 게임들이 쓰는 스냅 지점과 같은 개념이다.
// 기울기 = '걸렸을 때의 자세'. 유령이 같은 자세로 떠야 놓고 나서 딴 물건처럼
//   보이지 않는다. 없으면 0(반듯이).
export const 걸이 = new Map(); // 걸이id -> { 물건id, x, y, z, rot, 기울기, 반경 }
export const 걸이등록 = (id, v) => 걸이.set(id, v);
export const 걸이해제 = (id) => 걸이.delete(id);

// 지금 '원래 자리가 아닌 곳'에 옮겨져 있는 물건들.
// [왜 이걸 아나]
//   제자리로 되돌릴 때 겹침을 따지는데, **처음부터 거기 있던 것**까지 세면
//   되돌리기가 영영 안 된다 — 모자는 옷걸이 상자와 겹치고, 키보드는 모니터
//   상자와 겹친 채로 놓여 있는 게 정상이기 때문이다.
//   처음 배치는 이미 어우러져 있으니 따질 것이 없고, 새로 생긴 위험은
//   **누가 그 자리에 다른 물건을 옮겨다 놓은 경우** 하나뿐이다.
export const 옮겨진것 = new Set();
export const 옮겨진것갱신 = (ids) => {
  옮겨진것.clear();
  for (const id of ids) 옮겨진것.add(id);
};

// 벽·기둥·가구처럼 '통과 못 하는 것' 목록은 App.jsx 가 들고 있다.
// 여기서 그걸 import 하면 서로 물고 물리므로, 반대로 App 이 넣어 준다.
let 월드박스 = () => [];
export const 월드박스공급 = (f) => {
  월드박스 = f;
};

// ── 3D 점 막힘 검사 (손에 든 물건이 벽·가구를 뚫지 않게) ──────
// 기존 hit(x,z) 는 2D 라 책상이 '높이 무한한 벽'이 된다.
// 컵을 책상 위로 들고 지나가는 것까지 막히므로 여기서는 높이를 본다.
export function 막힘3D(x, y, z, 여유 = 0, 제외id = null) {
  // 책상 위 물건들(모니터·스탠드·다른 컵)도 뚫으면 안 된다.
  for (const [id, c] of 점유) {
    if (id === 제외id) continue;
    if (x < c.minX - 여유 || x > c.maxX + 여유) continue;
    if (z < c.minZ - 여유 || z > c.maxZ + 여유) continue;
    if (y >= c.minY - 여유 && y <= c.maxY + 여유) return true;
  }
  for (const c of 월드박스()) {
    if (x < c.minX - 여유 || x > c.maxX + 여유) continue;
    if (z < c.minZ - 여유 || z > c.maxZ + 여유) continue;
    // minY/maxY 가 없는 것(벽·기둥)은 높이 제한이 없다고 본다
    if (c.minY === undefined) return true;
    if (y >= c.minY - 여유 && y <= c.maxY + 여유) return true;
  }
  return false;
}

// ── 상자 겹침 ─────────────────────────────────────────────
// ★ 맞닿는 것은 겹침이 아니다.
//   책상 윗면(=책상 상자의 maxY)에 물건을 올리면 minY 가 정확히 같아진다.
//   틈(틈새)을 빼고 비교해야 '올려놓기'가 겹침으로 잡히지 않는다.
const 틈새 = 0.02;
function 겹치나(a, b) {
  if (a.maxX - 틈새 <= b.minX || a.minX + 틈새 >= b.maxX) return false;
  if (a.maxZ - 틈새 <= b.minZ || a.minZ + 틈새 >= b.maxZ) return false;
  const bMinY = b.minY ?? -1e4;
  const bMaxY = b.maxY ?? 1e4;
  if (a.maxY - 틈새 <= bMinY || a.minY + 틈새 >= bMaxY) return false;
  return true;
}

/**
 * 화면 중앙이 가리키는 '놓을 자리'를 찾는다.
 *
 * @returns { 있나, x, y, z, halfX, halfZ, 됨, 이유 }
 *   있나 = 면을 찾았는가 (미리보기를 그릴지 결정)
 *   됨   = 놓아도 되는가 (초록/빨강)
 */
export function 놓을자리찾기(카메라, 물건id, 최대거리 = 9) {
  const s = 크기.get(물건id);
  if (!s) return { 있나: false };

  const o = 카메라.position;
  const d = _앞(카메라);

  // ⓞ 걸이가 먼저다. 이 물건의 제자리가 시선에 걸리면 거기로 되돌린다.
  for (const [gid, h] of 걸이) {
    if (h.물건id !== 물건id) continue;
    const hx = h.x - o.x,
      hy = h.y - o.y,
      hz = h.z - o.z;
    const 앞거리 = hx * d.x + hy * d.y + hz * d.z;
    if (앞거리 <= 0.3 || 앞거리 > 최대거리) continue;
    const 옆거리제곱 = hx * hx + hy * hy + hz * hz - 앞거리 * 앞거리;
    const 반 = h.반경 ?? 1.0;
    if (옆거리제곱 > 반 * 반) continue;

    // 제자리에 **다른 물건을 옮겨다 놓았으면** 빨강.
    //   원래부터 거기 있던 가구·기기는 따지지 않는다(옮겨진것 주석 참고).
    const 밑 = h.y + (s.오프셋 ?? 0);
    const 제자리상자 = {
      minX: h.x - s.halfX,
      maxX: h.x + s.halfX,
      minZ: h.z - s.halfZ,
      maxZ: h.z + s.halfZ,
      minY: 밑,
      maxY: 밑 + s.height,
    };
    let 막은것 = null;
    for (const [id, b] of 점유) {
      if (id === 물건id || !옮겨진것.has(id)) continue;
      if (겹치나(제자리상자, b)) {
        막은것 = id;
        break;
      }
    }

    return {
      있나: true,
      걸이: gid, // 이 값이 있으면 '제자리로 되돌리기'다
      x: h.x,
      y: h.y,
      z: h.z,
      rot: h.rot ?? 0,
      기울기: h.기울기 ?? 0,
      halfX: s.halfX,
      halfZ: s.halfZ,
      height: s.height,
      됨: !막은것,
      이유: 막은것 ? "겹침" : undefined,
    };
  }

  // ① 광선 ↔ 각 면의 윗평면 교차. 가장 가까운 것 하나.
  let 최근 = null;
  for (const f of 표면.values()) {
    if (Math.abs(d.y) < 1e-4) continue;
    const t = (f.top - o.y) / d.y;
    if (t <= 0.3 || t > 최대거리) continue; // 코앞·너무 먼 곳 제외
    const px = o.x + d.x * t;
    const pz = o.z + d.z * t;
    if (px < f.minX || px > f.maxX || pz < f.minZ || pz > f.maxZ) continue;
    if (!최근 || t < 최근.t) 최근 = { t, px, pz, f };
  }
  if (!최근) return { 있나: false };

  const { px, pz, f } = 최근;
  const y = f.top;
  // 놓을 때 물건이 **사람 쪽을 보게** 돌린다. 노트북 화면이 벽을 보고 놓이면
  // 아무리 위치가 맞아도 어색하다. 모델 앞면(+Z)이 시선 반대쪽을 향하게 한다.
  const rot = Math.atan2(-d.x, -d.z);

  // ② 발자국이 면 밖으로 나가지 않게 안쪽으로 당긴다.
  //    (실제 게임도 '가장자리에 걸치기'를 막는다 — 걸치면 떠 보이기 때문)
  const x = 조이기(px, f.minX + s.halfX, f.maxX - s.halfX);
  const z = 조이기(pz, f.minZ + s.halfZ, f.maxZ - s.halfZ);
  // 면이 물건보다 좁으면 아예 못 올린다
  if (f.maxX - f.minX < s.halfX * 2 || f.maxZ - f.minZ < s.halfZ * 2)
    return { 있나: true, x: px, y, z: pz, rot, ...s, 됨: false, 이유: "면이 좁다" };

  // ③ 겹침 검사 — 다른 물건 + 벽·가구
  const 나 = {
    minX: x - s.halfX,
    maxX: x + s.halfX,
    minZ: z - s.halfZ,
    maxZ: z + s.halfZ,
    minY: y,
    maxY: y + s.height,
  };
  for (const [id, b] of 점유) {
    if (id === 물건id) continue; // 들고 있는 자기 자신은 뺀다
    if (겹치나(나, b))
      return { 있나: true, x, y, z, rot, ...s, 됨: false, 이유: "겹침" };
  }
  for (const c of 월드박스()) {
    if (겹치나(나, c))
      return { 있나: true, x, y, z, rot, ...s, 됨: false, 이유: "겹침" };
  }

  // ★ y 는 '면의 높이'가 아니라 **물건에 넘길 y 값**이다.
  //   물건마다 y prop 이 밑면이 아닐 수 있다(모자처럼 모델 원점이 중간인 것).
  //   실측해 둔 오프셋만큼 빼 줘야 밑면이 면에 정확히 닿는다.
  return { 있나: true, x, y: y - (s.오프셋 ?? 0), z, rot, ...s, 됨: true, 면높이: y };
}

const 조이기 = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));

// 카메라 앞 방향 — 매번 새 벡터를 만들지 않도록 하나를 돌려 쓴다
const _v = { x: 0, y: 0, z: 0 };
function _앞(카메라) {
  const e = 카메라.matrixWorld.elements;
  // three 카메라의 시선은 -Z. 월드행렬 3열의 반대 방향이다.
  _v.x = -e[8];
  _v.y = -e[9];
  _v.z = -e[10];
  const L = Math.hypot(_v.x, _v.y, _v.z) || 1;
  _v.x /= L;
  _v.y /= L;
  _v.z /= L;
  return _v;
}

/**
 * 손에 든 물건이 벽·가구를 뚫지 않게 카메라 쪽으로 당긴다.
 * 3인칭 카메라의 '스프링 암'과 같은 방식이다 — 원하는 자리가 막혔으면
 * 막히지 않는 가장 먼 지점까지만 나간다.
 *
 * @param 시작 [x,y,z] 카메라 위치
 * @param 목표 [x,y,z] 원래 들고 싶은 자리
 * @param 반경 물건 반지름(이만큼 여유를 두고 검사)
 * @returns [x,y,z] 실제로 둘 자리
 */
export function 스프링암(시작, 목표, 반경 = 0.35, 제외id = null, 단계 = 8) {
  let 마지막 = 시작;
  for (let i = 1; i <= 단계; i++) {
    const k = i / 단계;
    const x = 시작[0] + (목표[0] - 시작[0]) * k;
    const y = 시작[1] + (목표[1] - 시작[1]) * k;
    const z = 시작[2] + (목표[2] - 시작[2]) * k;
    if (막힘3D(x, y, z, 반경, 제외id)) return 마지막;
    마지막 = [x, y, z];
  }
  return 마지막;
}


// ═══════════════════════════════════════════════════════════════
//  놓기 상태 — 화면 아래 안내문용
// ═══════════════════════════════════════════════════════════════
// 자리는 고개를 돌릴 때마다 매 프레임 바뀐다. 그대로 구독하면 초당 60번 다시 그린다.
// 그래서 **바뀐 순간에만** 알린다(있나/됨 두 개의 참거짓이 달라질 때).

let 최근자리 = null; // 전체 결과 — E 를 눌렀을 때 쓴다(알림 없음)
export const 최근자리설정 = (v) => {
  최근자리 = v;
};
export const 최근자리값 = () => 최근자리;

let 놓기상태 = { 있나: false, 됨: false };
const 놓기듣는이 = new Set();
export function 놓기상태갱신(r) {
  const 새 = { 있나: !!r?.있나, 됨: !!r?.됨 };
  if (새.있나 === 놓기상태.있나 && 새.됨 === 놓기상태.됨) return;
  놓기상태 = 새;
  for (const f of 놓기듣는이) f();
}
export const 놓기상태보기 = {
  값: () => 놓기상태,
  구독: (f) => {
    놓기듣는이.add(f);
    return () => 놓기듣는이.delete(f);
  },
};
export const use놓기상태 = () =>
  useSyncExternalStore(놓기상태보기.구독, 놓기상태보기.값);


/**
 * 이 물건 **윗면에 얹혀 있는** 다른 물건을 찾는다. 없으면 null.
 *
 * [왜 필요한가]
 *   물건 위에 물건을 올릴 수 있게 하면, 받침을 들어 올렸을 때 위엣것이 공중에 뜬다.
 *   실제 게임들도 이걸 두 가지 중 하나로 막는다 —
 *     ① 위엣것을 같이 들어 올리거나  ② 받침을 못 들게 하거나.
 *   ②가 규칙이 단순하고 "왜 안 되는지"를 그 자리에서 말해 줄 수 있어 이쪽을 골랐다.
 */
export function 위에얹힌것(물건id) {
  const 나 = 점유.get(물건id);
  if (!나) return null;
  const 내넓이 = (나.maxX - 나.minX) * (나.maxZ - 나.minZ);
  for (const [id, b] of 점유) {
    if (id === 물건id) continue;

    // ① 내 윗면에 **앉아** 있어야 한다.
    //   전에는 높이 차 0.15 안이면 위아래를 안 가리고 '얹혔다'고 봤다.
    //   그래서 **키보드가 영영 안 집혔다** — 모니터 모델은 원점이 한가운데라
    //   상자 밑면이 책상 아래(2.10)까지 내려오는데, 납작한 키보드 윗면이
    //   2.14 라 우연히 0.04 차이가 났다. 둘 다 책상에 놓인 물건인데
    //   "모니터가 키보드 위에 올라가 있다"가 된 것이다.
    //   내 몸에 파묻힌 것은 얹힌 게 아니다 → 밑면이 내 윗면보다 아래면 뺀다.
    if (b.minY < 나.maxY - 0.03) continue;
    if (b.minY > 나.maxY + 0.15) continue;

    // ② 겹친 넓이가 그 물건 발자국의 절반쯤은 돼야 '내 위에 있다'고 본다.
    //   상자는 축에 나란해서 비스듬히 놓인 물건일수록 실제보다 크게 잡힌다.
    //   모서리만 스친 것까지 세면 옆 물건 때문에 못 드는 일이 생긴다.
    const 겹폭 = Math.min(b.maxX, 나.maxX) - Math.max(b.minX, 나.minX);
    const 겹깊 = Math.min(b.maxZ, 나.maxZ) - Math.max(b.minZ, 나.minZ);
    if (겹폭 <= 틈새 || 겹깊 <= 틈새) continue;
    const 그넓이 = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    const 작은넓이 = Math.min(그넓이, 내넓이);
    if (작은넓이 <= 0 || (겹폭 * 겹깊) / 작은넓이 < 0.4) continue;

    return id;
  }
  return null;
}

// 개발용 창구 — 콘솔에서 "지금 무엇이 어디에 얼마나 크게 서 있나"를 바로 본다.
//   (블랙박스·콜라이더·여닫이도 같은 방식으로 열어 뒀다)
//   ★ 여기 값은 **코드에 적은 숫자가 아니라 화면에 그려진 실물을 잰 것**이라,
//     "책상 위에 떠 있다" 같은 건 이걸로만 확인할 수 있다.
if (typeof window !== "undefined") window.__배치 = { 표면, 점유, 크기, 걸이 };
