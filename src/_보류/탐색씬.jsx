// 탐색씬.jsx — 1인칭 탐색 공간 (USR-104 · S7-008 · S7-009)
//
// S5 훈련실과 S7 게임 방이 **같은 이 컴포넌트**를 쓴다.
//   PRD USR-114 : 「훈련실은 본편과 똑같은 조작과 UI를 쓴다」
//   조작을 두 벌 만들면 반드시 어긋난다. 설정만 갈아 끼우는 쪽이 맞다.
//
// 지금 들어 있는 것: 이동 · 시점(상하 제한) · 충돌 · 조준점
// 앞으로 여기 얹힐 것: 상호작용(USR-051) · 인벤토리(USR-052) · 수첩(USR-053)
//                     · 퍼즐(USR-106) · 타이머(USR-059) · 힌트(USR-108)

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import 임시방, { 막힘만들기 } from "./임시방.jsx";
import { use1인칭 } from "./use1인칭.js";
import { 게임조작 } from "./조작설정.js";

const 도 = (v) => (v * Math.PI) / 180;

export default function 탐색씬({ 설정 = 게임조작, 시작위치 = [0, 6] }) {
  const [잠김, set잠김] = useState(false); // 마우스가 잠겨 있는가(=조작 중인가)

  return (
    <div className="stage" style={S.무대}>
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 60, near: 0.15, far: 200 }}
      >
        <color attach="background" args={["#1b1f26"]} />
        {/* 안개는 방(26×20)보다 멀리서 시작해야 방 자체가 뿌옇게 죽지 않는다 */}
        <fog attach="fog" args={["#1b1f26", 30, 80]} />

        {/* 조명 — 케이스 미술이 오기 전까지는 형태만 읽히면 된다.
            ★ 천장은 법선이 아래를 향해서 위에서 오는 빛도, 반구광의 하늘색도 못 받는다.
              반구광의 '바닥색'을 너무 어둡게 두면 천장이 새까맣게 죽는다. */}
        <ambientLight intensity={2.0} color="#ccd6e4" />
        <hemisphereLight args={["#a8bcd8", "#4a5260", 0.9]} />
        <directionalLight
          castShadow
          position={[8, 16, 6]}
          intensity={1.4}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0005}
        />

        <Suspense fallback={null}>
          <임시방 />
        </Suspense>

        <조작 설정={설정} 잠김={잠김} 시작위치={시작위치} />
        <개발노출 />

        {/* S7-009 — 마우스 시점. 상하 각도를 케이스 설정으로 제한한다.
            폴라각: 0=똑바로 위, 90=수평, 180=똑바로 아래 */}
        <PointerLockControls
          onLock={() => set잠김(true)}
          onUnlock={() => set잠김(false)}
          minPolarAngle={도(90 - 설정.위각도)}
          maxPolarAngle={도(90 + 설정.아래각도)}
        />
      </Canvas>

      {/* 조준점 — 1인칭은 커서가 없으니 화면 한가운데가 커서다 */}
      {잠김 && <div style={S.조준점} />}

      {!잠김 && (
        <div style={S.안내}>
          클릭해서 시작 · WASD 이동 · Shift 달리기 · Space 점프 · Ctrl 앉기 · ESC
        </div>
      )}
    </div>
  );
}

// 콘솔·자동 테스트에서 씬을 들여다볼 수 있게 전역에 걸어 둔다.
//   렌더에는 영향이 없다(참조만 하나 더 들고 있을 뿐). 로비의 성능계기판과 같은 방식.
function 개발노출() {
  const { scene, camera, gl } = useThree();
  useEffect(() => {
    window.__씬 = scene;
    window.__카메라 = camera;
    window.__gl = gl;
  }, [scene, camera, gl]);
  return null;
}

// 훅은 Canvas 안에서만 쓸 수 있어서 작은 컴포넌트로 감싼다
function 조작({ 설정, 잠김, 시작위치 }) {
  const 막힘 = useMemo(() => 막힘만들기(설정.반지름), [설정.반지름]);
  const 막힘고정 = useCallback((x, z) => 막힘(x, z), [막힘]);
  use1인칭(설정, { 켜기: 잠김, 막힘: 막힘고정, 시작위치 });
  return null;
}

const S = {
  무대: { position: "relative", background: "#1b1f26" },
  조준점: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 5,
    height: 5,
    marginLeft: -2.5,
    marginTop: -2.5,
    borderRadius: "50%",
    background: "rgba(235,242,252,.85)",
    pointerEvents: "none",
  },
  안내: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%,-50%)",
    padding: "10px 20px",
    borderRadius: 8,
    background: "rgba(16,20,27,.82)",
    border: "1px solid #2c3648",
    color: "#cfe3ff",
    font: "14px sans-serif",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
};
