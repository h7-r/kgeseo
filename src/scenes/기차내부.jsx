// ═══════════════════════════════════════════════════════════════
//  기차 내부 — 그레이박스
// ═══════════════════════════════════════════════════════════════
// [지금 단계]
//   로비를 만들 때와 같은 순서다. 먼저 '상자와 크기'로 공간을 세우고,
//   걸어 다니면서 넓이·높이·동선이 맞는지 확인한 다음에 꾸민다.
//   지금 예쁘게 만들면, 크기가 틀렸을 때 꾸민 걸 전부 다시 해야 한다.
//
// [좌표 약속]
//   x = 객차 길이 방향 (앞 ↔ 뒤)
//   z = 객차 폭 방향 (창가 ↔ 창가)
//   y = 높이. 바닥이 0.

import { useMemo, useRef, useCallback, useEffect } from "react";
import * as THREE from "three";
import { PointerLockControls, Outlines } from "@react-three/drei";
import {
  TOON_GRADIENT,
  색밝기,
  상자합치기,
  useSavedControls,
  선스키마,
  선뽑기,
  use이동,
  R,
} from "../공용.jsx";

// ── 객차 치수 (유닛) ───────────────────────────────────────
//   1 유닛 ≈ 0.30m. 실제 무궁화호 객차가 폭 3.0m · 높이 2.4m 정도다.
const 길이 = 52; // x — 약 15.6m
const 폭 = 10; // z — 약 3.0m
const 높이 = 7.4; // y — 약 2.2m (천장까지)

export default function 기차내부({
  active,
  controlsRef,
  onLockChange,
  onNear,
}) {
  const T = useSavedControls("기차 내부", {
    차체색: "#3f454e",
    바닥색: "#2b2f36",
    천장색: "#454b54",
    좌석색: "#4a4038",
    등받이색: "#564a40",
    창밖색: "#0d1014", // 밖은 캄캄한 밤 — 지금은 판 하나로 막는다
    창틀색: "#2f343b",
    선반색: "#3a4048",
    밝기: { value: 1, min: 0.2, max: 2, step: 0.05 },
    천장등세기: { value: 1.1, min: 0, max: 4, step: 0.05 },
    좌석열수: { value: 7, min: 2, max: 14, step: 1 },
    좌석간격: { value: 6.2, min: 3, max: 10, step: 0.1 },
    ...선스키마({ 굵기: 3, 색: "#12151a", 주름: false }),
  });
  const 선 = 선뽑기(T);
  const 선긋기 = 선.외곽선 ? (
    <Outlines thickness={선.외곽선굵기} color={선.외곽선색} />
  ) : null;

  const 밝 = (c) => 색밝기(c, T.밝기);

  // ── 좌석 — 양쪽 벽을 따라 2+2 배치. 전부 한 덩어리로 합친다 ──
  const 좌석 = useMemo(() => {
    const 상자 = [];
    const 시작 = -길이 / 2 + 7;
    for (let i = 0; i < T.좌석열수; i++) {
      const x = 시작 + i * T.좌석간격;
      if (x > 길이 / 2 - 5) break;
      for (const sz of [-1, 1]) {
        const z = sz * (폭 / 2 - 2.1);
        // 앉는 면
        상자.push({ 크기: [2.6, 0.35, 3.2], 위치: [x, 1.5, z] });
        // 등받이 — 통로 반대쪽(창가 쪽)에 세운다
        상자.push({ 크기: [0.4, 2.4, 3.2], 위치: [x - 1.5, 2.7, z] });
        // 다리
        상자.push({ 크기: [0.3, 1.5, 0.3], 위치: [x, 0.75, z] });
      }
    }
    return 상자합치기(상자);
  }, [T.좌석열수, T.좌석간격]);

  // 좌석 충돌 — 지오메트리와 같은 규칙으로 만들어 서로 어긋나지 않게 한다
  const 좌석박스 = useMemo(() => {
    const 목록 = [];
    const 시작 = -길이 / 2 + 7;
    for (let i = 0; i < T.좌석열수; i++) {
      const x = 시작 + i * T.좌석간격;
      if (x > 길이 / 2 - 5) break;
      for (const sz of [-1, 1]) {
        const z = sz * (폭 / 2 - 2.1);
        목록.push({ minX: x - 1.8, maxX: x + 1.4, minZ: z - 1.7, maxZ: z + 1.7 });
      }
    }
    return 목록;
  }, [T.좌석열수, T.좌석간격]);

  // ── 창문 + 짐 선반 — 양쪽 벽. 재질이 같은 것끼리 합친다 ──
  const 창틀 = useMemo(() => {
    const 상자 = [];
    const 창수 = Math.max(2, Math.round(길이 / 6.5));
    for (let i = 0; i < 창수; i++) {
      const x = -길이 / 2 + 4 + (i * (길이 - 8)) / (창수 - 1);
      for (const sz of [-1, 1]) {
        const z = sz * (폭 / 2 - 0.12);
        // 창 테두리 4변
        상자.push({ 크기: [4.6, 0.22, 0.18], 위치: [x, 4.9, z] });
        상자.push({ 크기: [4.6, 0.22, 0.18], 위치: [x, 2.9, z] });
        상자.push({ 크기: [0.22, 2.2, 0.18], 위치: [x - 2.2, 3.9, z] });
        상자.push({ 크기: [0.22, 2.2, 0.18], 위치: [x + 2.2, 3.9, z] });
      }
    }
    return 상자합치기(상자);
  }, []);

  const 선반 = useMemo(
    () =>
      상자합치기(
        [-1, 1].map((sz) => ({
          크기: [길이 - 4, 0.16, 1.5],
          위치: [0, 5.9, sz * (폭 / 2 - 0.9)],
        })),
      ),
    [],
  );

  useEffect(
    () => () => {
      [좌석, 창틀, 선반].forEach((g) => g && g.dispose());
    },
    [좌석, 창틀, 선반],
  );

  // ── 이동 규칙 ────────────────────────────────────────────
  //   객차 안이라 경계는 그냥 사각 상자 하나다.
  const 경계 = useCallback(
    () => ({
      xmin: -길이 / 2 + R + 0.4,
      xmax: 길이 / 2 - R - 0.4,
      zmin: -폭 / 2 + R + 0.4,
      zmax: 폭 / 2 - R - 0.4,
    }),
    [],
  );
  const 막힘 = useCallback(
    (x, z) =>
      좌석박스.some(
        (c) => x > c.minX - R && x < c.maxX + R && z > c.minZ - R && z < c.maxZ + R,
      ),
    [좌석박스],
  );
  // 객차 앞쪽 끝(문) 근처에 오면 '나가기' 안내를 띄운다
  const onNearRef = useRef(onNear);
  onNearRef.current = onNear;
  const 근처 = useCallback((p) => {
    const n = p.x < -길이 / 2 + 6 ? "기차나가기" : "";
    onNearRef.current(n);
    return n;
  }, []);

  use이동(active, {
    경계,
    막힘,
    근처,
    // 들어오면 객차 뒤쪽에서 앞(문 쪽)을 향해 선다
    시작: [길이 / 2 - 6, undefined, 0],
  });

  const 판 = (색) => (
    <meshToonMaterial color={밝(색)} gradientMap={TOON_GRADIENT} />
  );

  return (
    <>
      <color attach="background" args={["#0a0d11"]} />
      <ambientLight intensity={0.5 * T.밝기} />

      {/* 천장 형광등 — 일정 간격. 실제 빛도 여기서 나온다 */}
      {Array.from({ length: 5 }, (_, i) => {
        const x = -길이 / 2 + 6 + (i * (길이 - 12)) / 4;
        return (
          <group key={`lamp${i}`} position={[x, 높이 - 0.35, 0]}>
            <mesh>
              <boxGeometry args={[5.2, 0.28, 1.5]} />
              <meshBasicMaterial color="#e8e2cf" toneMapped={false} />
            </mesh>
            <pointLight
              position={[0, -0.6, 0]}
              intensity={T.천장등세기 * 12}
              distance={22}
              decay={2}
              color="#f2e9d4"
            />
          </group>
        );
      })}

      {/* 바닥 */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[길이, 0.2, 폭]} />
        {판(T.바닥색)}
      </mesh>

      {/* 천장 */}
      <mesh position={[0, 높이 + 0.1, 0]}>
        <boxGeometry args={[길이, 0.2, 폭]} />
        {판(T.천장색)}
      </mesh>

      {/* 양옆 벽 — 창문 자리는 '밖(캄캄한 판)'이 보이게 두 조각으로 나눈다 */}
      {[-1, 1].map((sz) => (
        <group key={`wall${sz}`}>
          {/* 창 아래 */}
          <mesh position={[0, 1.45, sz * (폭 / 2 + 0.1)]} receiveShadow>
            <boxGeometry args={[길이, 2.9, 0.2]} />
            {판(T.차체색)}
          </mesh>
          {/* 창 위 */}
          <mesh position={[0, (높이 + 5.0) / 2 + 0.5, sz * (폭 / 2 + 0.1)]}>
            <boxGeometry args={[길이, 높이 - 5.0, 0.2]} />
            {판(T.차체색)}
          </mesh>
          {/* 창 바깥 — 지금은 캄캄한 판 하나. 나중에 흐르는 풍경으로 바꾼다 */}
          <mesh position={[0, 3.95, sz * (폭 / 2 + 0.3)]}>
            <planeGeometry args={[길이, 2.1]} />
            <meshBasicMaterial
              color={T.창밖색}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* 양 끝 벽 — 앞쪽(-x)은 나가는 문, 뒤쪽(+x)은 막힌 벽 */}
      <mesh position={[-길이 / 2 - 0.1, 높이 / 2, 0]} receiveShadow>
        <boxGeometry args={[0.2, 높이, 폭]} />
        {판(T.차체색)}
      </mesh>
      <mesh position={[길이 / 2 + 0.1, 높이 / 2, 0]} receiveShadow>
        <boxGeometry args={[0.2, 높이, 폭]} />
        {판(T.차체색)}
      </mesh>

      {/* 나가는 문 — 앞쪽 끝 벽에 밝게 표시(그레이박스 단계의 '여기가 출구') */}
      <mesh position={[-길이 / 2 + 0.15, 3.2, 0]} castShadow>
        <boxGeometry args={[0.25, 6, 3.4]} />
        <meshToonMaterial color={밝("#6b7078")} gradientMap={TOON_GRADIENT} />
        {선긋기}
      </mesh>

      {/* 창틀 · 짐 선반 · 좌석 — 각각 한 덩어리로 합쳐서 그린다 */}
      <mesh geometry={창틀} castShadow>
        {판(T.창틀색)}
        {선긋기}
      </mesh>
      <mesh geometry={선반} castShadow>
        {판(T.선반색)}
        {선긋기}
      </mesh>
      <mesh geometry={좌석} castShadow receiveShadow>
        {판(T.좌석색)}
        {선긋기}
      </mesh>

      <PointerLockControls
        ref={controlsRef}
        selector="#없는요소"
        onLock={() => onLockChange(true)}
        onUnlock={() => onLockChange(false)}
      />
    </>
  );
}
