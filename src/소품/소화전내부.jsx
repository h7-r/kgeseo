// 소화전내부.jsx — 문을 열면 보이는 옥내소화전함 속
//
// [무엇을 담는가] 실물 옥내소화전함 그대로다.
//   위 칸  : 경종(종) · 발신기(누름 버튼) · 위치표시등 · 스피커 구멍
//   아래 칸: 개폐 밸브(빨간 핸들) · 접어 넣은 소방호스 · 노즐(관창)
//
// [호스를 왜 따로 빼 두나]
//   나중에 반대편 고압 밸브에 이 호스를 이어 붙일 계획이다. 그때 호스만
//   꺼내 쓸 수 있어야 하므로 지오메트리를 만드는 함수를 따로 내보낸다.
//   함 안에 그리는 부분과 밖으로 끌어내는 부분이 **같은 모양**이라야
//   "그 호스가 그대로 나왔다"로 읽힌다.
//
// [축]
//   함은 z 가 가로, y 가 세로, x 가 깊이다. 앞면은 d(방향) 쪽.
//   여기 좌표는 전부 '함 한가운데'를 0 으로 잡은 로컬 좌표다.

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TOON_GRADIENT, 만화선, 색밝기, makeRandom } from "../공용.jsx";

const 툰 = (색, 밝 = 1) => (
  <meshToonMaterial color={색밝기(색, 밝)} gradientMap={TOON_GRADIENT} />
);

// ── 접어 넣은 소방호스 ──────────────────────────────────────
// 실물은 납작한 천 호스를 지그재그로 접어 걸어 둔다. 그래서 **아래로 늘어진
// 여러 가닥**으로 보인다. 굵은 관 하나를 그리면 호스가 아니라 배관이 된다.
//
// [왜 상자를 쌓지 않고 띠를 뽑나]
//   전에는 한 가닥을 상자 네 개로 쪼개 조금씩 어긋나게 쌓았다. 그러면
//   마디마다 **계단처럼 턱이 진다** — 이어진 천이 아니라 토막을 붙인 것으로 보인다.
//   그래서 가운데 선(중심선)을 먼저 그리고, 그 선을 따라 납작한 단면을
//   **끊김 없이 훑어** 한 덩어리로 만든다. 마디도 턱도 없다.

// 중심선을 따라 납작한 띠 한 가닥을 만든다.
//   단면은 축에 나란한 사각형으로 둔다 — 호스가 거의 수직이라 이걸로 충분하고,
//   비틀림(트위스트)이 안 생겨 천처럼 가만히 늘어진다.
function 띠지오(중심선, 폭, 두께) {
  const n = 중심선.length;
  const p = [];
  const 귀 = (c, sx, sz) => [c[0] + (sx * 두께) / 2, c[1], c[2] + (sz * 폭) / 2];
  // 네 면. 각 쌍은 '그 면의 시작 귀 → 끝 귀' 이고, 바깥을 보도록 감는 순서를 맞췄다.
  const 면들 = [
    [[1, -1], [1, 1]], // +x
    [[-1, 1], [-1, -1]], // −x
    [[1, 1], [-1, 1]], // +z
    [[-1, -1], [1, -1]], // −z
  ];
  for (const [a, b] of 면들) {
    for (let i = 0; i < n - 1; i++) {
      const A = 귀(중심선[i], a[0], a[1]);
      const B = 귀(중심선[i], b[0], b[1]);
      const C = 귀(중심선[i + 1], b[0], b[1]);
      const D = 귀(중심선[i + 1], a[0], a[1]);
      p.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
  }
  // 위·아래 마개
  const 마개 = (c, 위) => {
    const q = [
      귀(c, -1, -1),
      귀(c, 1, -1),
      귀(c, 1, 1),
      귀(c, -1, 1),
    ];
    const 순 = 위 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of 순) p.push(...q[i]);
  };
  마개(중심선[0], true);
  마개(중심선[n - 1], false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

export function 호스지오({
  폭 = 1.0, // 걸린 가로 폭
  높이 = 0.9, // 늘어진 길이
  깊이 = 0.16, // 앞뒤로 겹쳐 걸린 두께
  가닥 = 16,
  seed = 7,
} = {}) {
  const r = makeRandom(seed);
  const 것 = [];
  const 칸 = 폭 / Math.max(1, 가닥 - 1);
  for (let i = 0; i < 가닥; i++) {
    const u = 가닥 === 1 ? 0.5 : i / (가닥 - 1);
    const z = (u - 0.5) * 폭;
    // 가운데가 길고 양끝이 짧다 — 접어 걸면 자연히 그렇게 된다
    const 길이 = 높이 * (0.62 + 0.38 * Math.sin(u * Math.PI)) * (0.88 + r() * 0.24);
    // ★ 소방호스는 납작한 천이다. 넓은 면이 앞을 봐야 사진처럼 빽빽해 보인다.
    const 리본폭 = 칸 * (0.72 + r() * 0.12);
    const 리본두께 = 0.022 + r() * 0.012;
    const 앞뒤 = (r() - 0.5) * 깊이;
    const 위상 = r() * Math.PI * 2;
    const 흔들세기 = 0.012 + r() * 0.016;

    // 중심선 — 위에서 아래로, 아주 느리게 좌우·앞뒤로 흔들린다
    const 마디 = 14;
    const 선 = [];
    for (let k = 0; k <= 마디; k++) {
      const s = k / 마디;
      const 흔 = Math.sin(s * 2.4 * Math.PI + 위상) * 흔들세기 * s;
      선.push([앞뒤 + 흔, -길이 * s, z + 흔 * 0.5]);
    }
    것.push(띠지오(선, 리본폭, 리본두께));

    // 끝단 커플링 — 사진처럼 몇 가닥 끝에 금속 고리가 보인다
    //   ★ UV 를 떼고 넣는다. 띠(직접 만든 지오)에는 UV 가 없는데 원통에는 있어서,
    //     그대로 섞으면 mergeGeometries 가 null 을 돌려준다 → **호스가 통째로 안 보인다.**
    if (i % 4 === 1) {
      const c = new THREE.CylinderGeometry(리본폭 * 0.42, 리본폭 * 0.42, 0.07, 8);
      c.translate(선[마디][0], -길이 - 0.03, 선[마디][2]);
      const cn = c.toNonIndexed();
      cn.deleteAttribute("uv");
      것.push(cn);
      c.dispose();
    }
    // 접힌 꼭대기 — 걸이 막대에 걸쳐 넘어간 부분.
    //   ★ 고리 면은 **막대와 직각**이라야 한다(막대가 z 로 놓였으니 x-y 평면).
    const 고리 = new THREE.TorusGeometry(0.042, 리본두께 * 0.8, 4, 8, Math.PI);
    고리.translate(앞뒤, 0, z);
    const 고리n = 고리.toNonIndexed();
    고리n.deleteAttribute("uv");
    것.push(고리n);
    고리.dispose();
  }
  const 합 = mergeGeometries(것, false);
  것.forEach((g) => g.dispose());
  return 합;
}

export function 소화전내부({
  폭 = 1.4,
  높이 = 2.25,
  깊이 = 0.38,
  d = 1, // 앞면이 향하는 x 방향(+1 / −1)
  안색 = "#2b2f36",
  금속색 = "#9aa1a8",
  호스색 = "#d9d3c2",
  빨강 = "#c0392b",
  밝기 = 1,
  선,
}) {
  const 반깊 = 깊이 / 2;
  // ★ 함체 껍데기의 앞 테두리(0.08)보다 **조금 더** 안으로 들어간다.
  //   딱 맞추면 두 면이 같은 자리라 멀리서 깜빡인다(z-fighting).
  const 안폭 = 폭 - 0.24;
  const 안높 = 높이 - 0.24;
  // 위 칸(경종·발신기) 과 아래 칸(호스)을 가르는 선반 높이
  const 칸경계 = 안높 * 0.29;

  // ★ 부품 자리들을 **useMemo 보다 먼저** 잡는다.
  //   useMemo 는 그리는 도중 바로 돌아간다. 아래에 선언한 값을 그 안에서 쓰면
  //   'Cannot access before initialization' 으로 화면이 통째로 죽는다.
  const 위y = 안높 / 2 - 칸경계 / 2;
  const zf = d * (반깊 - 0.06); // 부품을 놓는 앞쪽 면
  const 걸이y = 안높 / 2 - 칸경계 - 0.12; // 호스가 걸리는 높이

  // 안쪽 상자 — 앞이 열린 어두운 통. 이게 있어야 '속이 빈 함'으로 보인다.
  const 안 = useMemo(() => {
    const 뒤 = -d * (반깊 - 0.03);
    const 것 = [
      // 뒷판
      { 크기: [0.06, 안높, 안폭], 위치: [뒤, 0, 0] },
      // 위·아래
      { 크기: [깊이 * 0.9, 0.06, 안폭], 위치: [0, 안높 / 2, 0] },
      { 크기: [깊이 * 0.9, 0.06, 안폭], 위치: [0, -안높 / 2, 0] },
      // 좌·우
      { 크기: [깊이 * 0.9, 안높, 0.06], 위치: [0, 0, -안폭 / 2] },
      { 크기: [깊이 * 0.9, 안높, 0.06], 위치: [0, 0, 안폭 / 2] },
      // 칸막이 선반
      { 크기: [깊이 * 0.85, 0.05, 안폭], 위치: [0, 안높 / 2 - 칸경계, 0] },
    ];
    const 조각 = 것.map((b) => {
      const g = new THREE.BoxGeometry(...b.크기);
      g.translate(...b.위치);
      return g;
    });
    const 합 = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    return 합;
  }, [깊이, 안폭, 안높, 반깊, d, 칸경계]);

  const 호스 = useMemo(
    () =>
      호스지오({
        // 0.72 → 0.62. 양옆에 밸브·노즐이 설 자리를 낸다.
        //   (밸브가 호스에 가리지도, 함 옆벽을 뚫지도 않으려면 이만큼이 필요하다)
        폭: 안폭 * 0.62,
        높이: (안높 - 칸경계) * 0.72,
        깊이: 깊이 * 0.4,
        가닥: 13,
      }),
    [안폭, 안높, 칸경계, 깊이],
  );

  // 노즐 — 옆선을 돌려 이어진 한 덩어리로. 아래가 물 나오는 끝이다.
  const 노즐지오 = useMemo(() => {
    // ★ 반지름을 줄이는 걸 잊어 **항아리**가 됐었다.
    //   관창은 길고 가늘다 — 지름이 길이의 1/5 쯤이라야 관창으로 읽힌다.
    //   (지름 0.12 · 길이 0.56)
    const 옆선 = [
      [0.0, -0.3],
      [0.032, -0.3], // 물 나오는 끝(가장 가늘다)
      [0.042, -0.25],
      [0.038, -0.14], // 잘록한 목
      [0.055, 0.0],
      [0.06, 0.12], // 몸통
      [0.056, 0.2],
      [0.052, 0.25],
      [0.0, 0.26],
    ];
    const g = new THREE.LatheGeometry(
      옆선.map(([a2, b2]) => new THREE.Vector2(a2, b2)),
      14,
    );
    const n = g.toNonIndexed();
    g.dispose();
    return n;
  }, []);

  useEffect(
    () => () => {
      안?.dispose();
      호스?.dispose();
      노즐지오?.dispose();
    },
    [안, 호스, 노즐지오],
  );

  // 위 칸 부품 자리

  return (
    <group>
      <mesh geometry={안} receiveShadow>
        {툰(안색, 밝기)}
      </mesh>

      {/* ── 위 칸 — 경종 · 발신기 · 표시등 ───────────────────
             실물은 이 셋이 나란히 붙어 있다. 빨간 원 두 개가 소화전의 얼굴이다. */}
      {/* 경종(종) — 큰 빨간 원판 */}
      {/* ★ 두 원을 벌리고 줄였다. 전에는 둘 사이가 0.003 이라 붙어 보였고,
             경종이 커서 옆벽에 물렸다. */}
      <group position={[zf, 위y, -안폭 * 0.24]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[칸경계 * 0.24, 칸경계 * 0.24, 0.05, 16]} />
          {툰(빨강, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[칸경계 * 0.08, 칸경계 * 0.08, 0.03, 10]} />
          {툰("#7d2820", 밝기)}
        </mesh>
      </group>
      {/* 발신기(누름 버튼) — 가운데가 눌리는 빨간 버튼 */}
      <group position={[zf, 위y, 안폭 * 0.04]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[칸경계 * 0.15, 칸경계 * 0.17, 0.06, 14]} />
          {툰(빨강, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[칸경계 * 0.09, 칸경계 * 0.09, 0.03, 12]} />
          {툰("#8e2a22", 밝기)}
        </mesh>
      </group>
      {/* 위치표시등 — 불이 꺼진 상태라도 유리알은 보인다 */}
      <mesh position={[zf, 위y + 칸경계 * 0.18, 안폭 * 0.32]}>
        <sphereGeometry args={[칸경계 * 0.1, 10, 8]} />
        <meshBasicMaterial color={색밝기("#b4524a", 밝기)} toneMapped={false} />
      </mesh>
      {/* 왼쪽 끝 작은 창 — 사진에 있는 은색 표시창. 점(스피커 구멍)은 뺐다:
             그 크기에서는 구멍이 아니라 그냥 검은 점 네 개로 보인다. */}
      <mesh position={[zf, 위y, -안폭 * 0.44]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.03, 칸경계 * 0.42, 칸경계 * 0.16]} />
        {툰(금속색, 밝기)}
        <만화선 선={선} />
      </mesh>

      {/* ── 아래 칸 — 밸브 · 호스 · 노즐 ────────────────────── */}
      {/* 개폐 밸브 — 함 **아래쪽 왼편**. 출구가 **위**를 본다.
             [왜 아래인가]
               호스는 위에서 아래로 늘어진다. 그 끝이 닿는 자리에 밸브가 있어야
               "내려온 호스를 여기 물린다"가 한눈에 읽힌다. 위에 있으면 호스가
               밸브를 지나쳐 내려가 버려서 둘이 남남으로 보인다.
             [자리 — 두 번 틀렸던 곳이라 적어 둔다]
               · 옆벽은 안폭/2 가 아니라 **안폭/2 − 0.03**(벽판 두께의 안쪽 면)이다.
                 이걸 0.58 로 잡아서 바퀴가 벽에 물렸다.
               · 호스 폭 **바깥**에 두면 호스와 이어져 보이지 않는다.
                 호스가 내려오는 자리 **바로 밑**(안폭×0.30)에 둬야 물린다.
               · 앞뒤(x)도 호스와 같은 자리에 맞춘다. */}
      <group position={[d * 반깊 * 0.1, -안높 * 0.25, -안폭 * 0.3]}>
        {/* 뒤(급수관)에서 나오는 가로 관 */}
        <mesh position={[-d * 0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.22, 10]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 몸통(엘보) */}
        <mesh castShadow>
          <cylinderGeometry args={[0.052, 0.058, 0.15, 10]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* ★ 위로 올라가는 출구 + 커플링 — 내려온 호스를 여기에 문다 */}
        <mesh position={[0, 0.14, 0]} castShadow>
          <cylinderGeometry args={[0.042, 0.042, 0.14, 10]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.225, 0]} castShadow>
          <cylinderGeometry args={[0.058, 0.058, 0.07, 10]} />
          {툰("#b9a24a", 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 핸들 — 얼굴이 앞을 보게 세운다(옆으로 누우면 납작한 타원으로 보인다) */}
        <group position={[0, -0.02, -0.11]} rotation={[0, Math.PI / 2, 0]}>
          <mesh castShadow>
            <torusGeometry args={[0.07, 0.016, 6, 14]} />
            {툰(빨강, 밝기)}
            <만화선 선={선} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={`spoke${i}`} rotation={[0, 0, (i * Math.PI) / 3]} castShadow>
              <boxGeometry args={[0.14, 0.016, 0.015]} />
              {툰(빨강, 밝기)}
            </mesh>
          ))}
          <mesh>
            <cylinderGeometry args={[0.024, 0.024, 0.045, 8]} />
            {툰(빨강, 밝기)}
          </mesh>
        </group>
      </group>

      {/* 호스 — 접어 걸어 둔 천 호스. 함 속을 채우는 주인공이다. */}
      <group position={[d * 반깊 * 0.1, 걸이y, 0]}>
        <mesh geometry={호스} castShadow receiveShadow>
          {툰(호스색, 밝기 * 0.95)}
          <만화선 선={선} />
        </mesh>
        {/* 호스를 거는 가로 막대 */}
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          {/* 걸이 막대 — 호스 폭에만 걸친다. 길면 밸브·노즐과 부딪힌다. */}
          <cylinderGeometry args={[0.022, 0.022, 안폭 * 0.66, 8]} />
          {툰(금속색, 밝기)}
        </mesh>
      </group>

      {/* 노즐(관창) — 오른쪽 끝에 세로로. 물 나오는 끝이 아래다.
             ★ 지름이 다른 원통을 쌓으면 마디마다 턱이 져 엉성해 보인다.
               옆선(프로파일)을 한 번 돌려 **이어진 한 덩어리**로 뽑는다. */}
      <group position={[d * 반깊 * 0.24, 걸이y - 0.35, 안폭 * 0.4]}>
        <mesh geometry={노즐지오} castShadow>
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 손잡이 — 미끄럼 막는 고무 테 */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.068, 0.068, 0.08, 12]} />
          {툰("#2a2c30", 밝기)}
        </mesh>
        {/* 호스와 물리는 황동 커플링 */}
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.062, 0.06, 12]} />
          {툰("#b9a24a", 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 물 나오는 구멍 */}
        <mesh position={[0, -0.29, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.02, 10]} />
          {툰("#15181c", 밝기)}
        </mesh>
      </group>
    </group>
  );
}
