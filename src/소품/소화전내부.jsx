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
//   가닥마다 길이·굵기·앞뒤 자리를 조금씩 흔들어야 '접어 넣은 천'이 된다.
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
    // ★ 소방호스는 **납작한 천**이다. 넓은 면이 앞을 봐야 사진처럼 빽빽해 보인다.
    //   전에는 앞뒤로 두껍고 좌우로 얇아서, 정면에서 보면 가는 막대 여러 개였다.
    const 리본폭 = 칸 * (0.72 + r() * 0.12); // 좌우(보이는 폭)
    const 리본두께 = 0.022 + r() * 0.012; // 앞뒤
    const 앞뒤 = (r() - 0.5) * 깊이;
    // 한 가닥 = 위에서 아래로 내려오다 끝이 살짝 도로 말린다
    const 마디 = 4;
    for (let k = 0; k < 마디; k++) {
      const t0 = k / 마디;
      const t1 = (k + 1) / 마디;
      const h = 길이 * (t1 - t0);
      const g = new THREE.BoxGeometry(리본두께, h, 리본폭);
      // 아래로 갈수록 살짝 흔들린다(천이라 반듯하지 않다)
      const 흔들 = Math.sin(t0 * 3.1 + i) * 0.018;
      g.translate(앞뒤 + 흔들, -길이 * ((t0 + t1) / 2), z + 흔들 * 0.35);
      것.push(g);
    }
    // 끝단 커플링 — 사진처럼 몇 가닥 끝에 금속 고리가 보인다
    if (i % 4 === 1) {
      const c = new THREE.CylinderGeometry(리본폭 * 0.42, 리본폭 * 0.42, 0.07, 8);
      c.translate(앞뒤, -길이 - 0.03, z);
      것.push(c);
    }
    // 접힌 꼭대기 — 걸이 막대에 걸쳐 넘어간 부분.
    //   ★ 고리 면은 **막대와 직각**이라야 한다. 막대가 z 로 놓였으니 고리는 x-y 평면.
    //     (Torus 기본이 x-y 평면이라 돌리면 안 된다. z 쪽으로 눕히면 고리 폭이
    //      가닥 간격보다 넓어져 위쪽이 통째로 붙어 버린다 — 천이 아니라 판이 된다)
    const 고리 = new THREE.TorusGeometry(0.042, 리본두께 * 0.8, 4, 8, Math.PI);
    고리.translate(앞뒤, 0, z);
    것.push(고리);
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
        폭: 안폭 * 0.72,
        높이: (안높 - 칸경계) * 0.72,
        깊이: 깊이 * 0.4,
        가닥: 13,
      }),
    [안폭, 안높, 칸경계, 깊이],
  );

  useEffect(
    () => () => {
      안?.dispose();
      호스?.dispose();
    },
    [안, 호스],
  );

  // 위 칸 부품 자리
  const 위y = 안높 / 2 - 칸경계 / 2;
  const zf = d * (반깊 - 0.06); // 부품을 놓는 앞쪽 면
  const 걸이y = 안높 / 2 - 칸경계 - 0.12; // 호스가 걸리는 높이

  return (
    <group>
      <mesh geometry={안} receiveShadow>
        {툰(안색, 밝기)}
      </mesh>

      {/* ── 위 칸 — 경종 · 발신기 · 표시등 ───────────────────
             실물은 이 셋이 나란히 붙어 있다. 빨간 원 두 개가 소화전의 얼굴이다. */}
      {/* 경종(종) — 큰 빨간 원판 */}
      <group position={[zf, 위y, -안폭 * 0.26]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[칸경계 * 0.3, 칸경계 * 0.3, 0.05, 16]} />
          {툰(빨강, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[칸경계 * 0.1, 칸경계 * 0.1, 0.03, 10]} />
          {툰("#7d2820", 밝기)}
        </mesh>
      </group>
      {/* 발신기(누름 버튼) — 가운데가 눌리는 빨간 버튼 */}
      <group position={[zf, 위y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[칸경계 * 0.19, 칸경계 * 0.21, 0.06, 14]} />
          {툰(빨강, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[칸경계 * 0.12, 칸경계 * 0.12, 0.03, 12]} />
          {툰("#8e2a22", 밝기)}
        </mesh>
      </group>
      {/* 위치표시등 — 불이 꺼진 상태라도 유리알은 보인다 */}
      <mesh position={[zf, 위y + 칸경계 * 0.22, 안폭 * 0.3]}>
        <sphereGeometry args={[칸경계 * 0.12, 10, 8]} />
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
      {/* 개폐 밸브 — 호스 **왼쪽 바깥**, 걸이 막대보다 아래.
             전에는 걸이 높이에 호스 폭 안쪽으로 있어 호스에 가려 안 보였다.
             앞으로도 조금 빼서 호스보다 앞에 선다. */}
      <group position={[d * 반깊 * 0.34, 걸이y - 0.16, -안폭 * 0.44]}>
        {/* 몸통 — 뒤(급수관)에서 나와 위로 꺾인다 */}
        <mesh position={[-d * 0.09, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.2, 10]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh castShadow>
          <cylinderGeometry args={[0.05, 0.058, 0.2, 10]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 핸들 — 수도꼭지처럼 생긴 빨간 바퀴. 얼굴이 앞을 보게 세운다. */}
        <group position={[0, 0.15, 0]} rotation={[0, Math.PI / 2, 0]}>
          <mesh castShadow>
            <torusGeometry args={[0.105, 0.022, 6, 16]} />
            {툰(빨강, 밝기)}
            <만화선 선={선} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={`spoke${i}`} rotation={[0, 0, (i * Math.PI) / 3]} castShadow>
              <boxGeometry args={[0.21, 0.022, 0.02]} />
              {툰(빨강, 밝기)}
            </mesh>
          ))}
          <mesh>
            <cylinderGeometry args={[0.028, 0.028, 0.05, 8]} />
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
          <cylinderGeometry args={[0.022, 0.022, 안폭 * 0.82, 8]} />
          {툰(금속색, 밝기)}
        </mesh>
      </group>

      {/* 노즐(관창) — **오른쪽 끝**, 호스 바깥.
             물 나오는 끝(헤더)이 함 밖으로 **맨 앞**에 나오게 눕힌다.
             기둥처럼 세워 두면 무엇인지 안 읽힌다 — 앞을 겨눠야 관창이다. */}
      <group
        position={[d * (반깊 * 0.15), 걸이y - 0.06, 안폭 * 0.44]}
        rotation={[0, 0, d > 0 ? -Math.PI / 2 : Math.PI / 2]}
      >
        {/* 뒤쪽 굵은 커플링 — 호스와 이어 붙는 자리 */}
        <mesh position={[0, -0.17, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.09, 12]} />
          {툰("#b9a24a", 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 몸통 — 뒤가 굵고 앞으로 갈수록 가늘어진다 */}
        <mesh position={[0, 0.02, 0]} castShadow>
          <cylinderGeometry args={[0.042, 0.066, 0.3, 12]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        {/* 손잡이 테 */}
        <mesh position={[0, -0.06, 0]} castShadow>
          <cylinderGeometry args={[0.052, 0.052, 0.05, 12]} />
          {툰("#b9a24a", 밝기)}
        </mesh>
        {/* 헤더 — 물 나오는 끝. 여기가 제일 앞이다. */}
        <mesh position={[0, 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.036, 0.08, 12]} />
          {툰(금속색, 밝기)}
          <만화선 선={선} />
        </mesh>
        <mesh position={[0, 0.245, 0]}>
          <cylinderGeometry args={[0.026, 0.026, 0.02, 10]} />
          {툰("#15181c", 밝기)}
        </mesh>
      </group>
    </group>
  );
}
