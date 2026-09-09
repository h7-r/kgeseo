// ═══════════════════════════════════════════════════════════════
//  인물.js — '사람'을 코드로 세우는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 상자가 아니라 사람 모양이어야 하나]
//   문서 §3 이 이 그레이박스에 건 숙제가 바로 이것이다 —
//   「Z3 가장자리에서 **Z2 의 사람이 사람으로 보이는** 높이」를 찾아라.
//   그런데 아래에 서 있는 게 회색 상자면, 그게 사람으로 보이는지 아닌지를
//   판정할 수가 없다. 상자는 어떤 높이에서도 그냥 상자다.
//   **사람 실루엣이라야 「저게 사람으로 보이나?」를 물을 수 있다.**
//
//   NPC 아비사(§163)도 같은 이유로 사람 모양이어야 한다. 다만 여기서 만드는 건
//   캐릭터가 아니라 **자(尺)** 다 — 얼굴도 옷도 없다. §7 아트 게이트가 열리면
//   그때 진짜 모델로 갈아 끼운다.
//
// [값싸게] 다리 둘 + 허리 + 몸통 + 머리 + 팔 둘 ≈ 130 삼각형. 여럿을 합쳐 드로우콜 1개.
// [단위] 키는 미터. 지오메트리만 유닛(× 미터).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { 색입히기 } from "./바닥.js";
import { 미터 } from "./공간도면.js";
import { makeRandom } from "../../src/공용.jsx";
import { 밑동원점으로 } from "./배치.js";

// 인덱스를 풀어 둔다 — 다른 조각(정이십면체)과 합치려면 형식이 같아야 한다
const 풀기 = (g) => {
  const n = g.toNonIndexed();
  g.dispose();
  return n;
};

// ── 사람 하나 ───────────────────────────────────────────────
//   키    m (기본 1.7 — §3 이 말하는 '사람 자')
//   방향  rad (바라보는 쪽)
export function 사람만들기({
  키 = 1.7, x = 0, y = 0, z = 0, 방향 = 0,
  옷 = "#8C8E96", 살 = "#C9B49A",
}) {
  const 조각 = [];
  const 옷색 = new THREE.Color(옷);
  const 옷어둠 = 옷색.clone().multiplyScalar(0.62);
  const 살색 = new THREE.Color(살);

  const 놓기 = (g, [px, py, pz], 색, 기울기 = 0) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px * 미터, py * 미터, pz * 미터),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(기울기, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    조각.push(색입히기(g, 색));
  };

  // 다리 둘 — ※ 예전에는 아래를 원뿔대 하나로 뭉갰다. 그러면 멀리서
  //   **바위 기둥**처럼 보여서, §3 의 「사람으로 보이나」 판정이 안 됐다.
  //   다리 사이가 갈려야 사람 실루엣이 된다.
  for (const 쪽 of [-1, 1]) {
    놓기(
      풀기(
        new THREE.CylinderGeometry(
          키 * 0.045 * 미터, 키 * 0.055 * 미터, 키 * 0.47 * 미터, 6, 1,
        ),
      ),
      [쪽 * 키 * 0.055, 키 * 0.235, 0],
      옷어둠,
    );
  }
  // 허리 — 다리와 몸통을 잇는다
  놓기(
    풀기(
      new THREE.CylinderGeometry(
        키 * 0.1 * 미터, 키 * 0.115 * 미터, 키 * 0.12 * 미터, 7, 1,
      ),
    ),
    [0, 키 * 0.52, 0],
    옷어둠,
  );
  // 몸통 — 어깨로 갈수록 살짝 넓어진다
  놓기(
    풀기(
      new THREE.CylinderGeometry(
        키 * 0.12 * 미터, 키 * 0.095 * 미터, 키 * 0.28 * 미터, 7, 1,
      ),
    ),
    [0, 키 * 0.71, 0],
    옷색,
  );
  // 머리 — 이게 있어야 '위가 사람'으로 읽힌다
  놓기(
    new THREE.IcosahedronGeometry(키 * 0.075 * 미터, 0),
    [0, 키 * 0.92, 0],
    살색,
  );
  // 팔 둘 — 실루엣의 폭을 만들어 준다
  for (const 쪽 of [-1, 1]) {
    놓기(
      풀기(
        new THREE.CylinderGeometry(
          키 * 0.028 * 미터, 키 * 0.032 * 미터, 키 * 0.32 * 미터, 5, 1,
        ),
      ),
      [쪽 * 키 * 0.125, 키 * 0.68, 0],
      옷색,
    );
  }

  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  // 자리·방향으로 옮긴다
  합본.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x * 미터, y * 미터, z * 미터),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 방향, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return 합본;
}

// 여러 명을 한 덩어리로
export function 사람들만들기(목록) {
  const 조각 = 목록.map((v) => 사람만들기(v));
  if (!조각.length) return null;
  const 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합본;
}

// ── 인스턴스용 사람 표본 ───────────────────────────────────
//   `사람만들기` 는 자리·방향을 안에서 적용한다. 인스턴스로 심으려면
//   **높이 1 · 밑동 원점**짜리 표본이 필요하다(배치.js 규약).
//   옷·살 색을 조금씩 달리해 몇 벌 만들어 둔다 — 다 같으면 복제 티가 난다.
export function 사람표본들(수 = 4, 시드 = 9101) {
  const 난수 = makeRandom(시드);
  const 옷표 = ["#8C8E96", "#7A8290", "#94897C", "#6F7A72"];
  const 표본 = [];
  for (let i = 0; i < 수; i++) {
    const g = 사람만들기({
      키: 1.7,
      옷: 옷표[Math.floor(난수() * 옷표.length)],
      살: "#C9B49A",
    });
    표본.push(밑동원점으로(g));
  }
  return 표본;
}
