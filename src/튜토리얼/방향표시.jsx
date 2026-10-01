// ═══════════════════════════════════════════════════════════════
//  방향표시.jsx — 다음 목표가 **어느 쪽인지** 알려 준다
// ═══════════════════════════════════════════════════════════════
// [왜 바닥 동그라미만으로 부족한가]
//   동그라미는 「도착지가 저기」를 보여 주지만, **화면 밖에 있으면 아무것도 안 보인다.**
//   튜토리얼에서 제일 흔한 막힘이 "어디로 가라는 거지?"라서, 방향은 늘 보여야 한다.
//   그래서 둘을 더한다.
//     ① 캐릭터 머리 위에 뜬 큰 화살표 — 목표 쪽으로 돈다(걸으면 따라 돈다)
//     ② 화면 가장자리 화살표 — 목표가 화면 밖일 때만, 깜빡이며 그쪽 테두리에 붙는다
//
// [조명을 하나도 안 쓴다]
//   three 는 보이는 조명 개수를 셰이더 키에 넣어서, 조명이 늘면 재질 셰이더를 전부
//   다시 만든다(복도 첫 노출 2.1초 멈춤의 원인). 전부 MeshBasic + 가산 합성이다.
//   `튜토리얼판.jsx` 의 동그라미와 같은 규칙이다.
//
// [매 프레임 React state 를 건드리지 않는다]
//   3D 는 ref 로 자리만 바꾸고, 가장자리 표시는 DOM 의 `style.transform` 에 직접 쓴다.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { 플레이어시점 } from "../공용.jsx";
import { 단계들, use튜토리얼 } from "./튜토리얼.js";

const 색 = "#8ee8ff"; // 튜토리얼판.jsx 의 동그라미와 같은 색
const 여백 = 52; // 가장자리 화살표를 테두리에서 이만큼 안쪽에 둔다

// 캔버스 안(계산)과 밖(그리기)을 잇는 유일한 통로.
const 칸 = { 가장자리: null };

// ── 납작한 화살표 판 ────────────────────────────────────────
//   원뿔을 썼다가 걷어냈다 — 뒤에서 보면 마름모, 위에서 보면 삼각뿔이라
//   **어느 각도에서도 화살표로 안 읽혔다.** 바닥과 나란히 눕힌 판이면
//   3인칭 카메라(뒤 위쪽)에서 그대로 "→" 로 읽힌다.
function 화살표지오() {
  const 모 = new THREE.Shape();
  모.moveTo(0, 1.0); // 촉 끝
  모.lineTo(-0.62, 0.15);
  모.lineTo(-0.24, 0.15);
  모.lineTo(-0.24, -0.85); // 자루
  모.lineTo(0.24, -0.85);
  모.lineTo(0.24, 0.15);
  모.lineTo(0.62, 0.15);
  모.closePath();
  const g = new THREE.ShapeGeometry(모);
  // Shape 은 XY 평면에 생긴다. 눕혀서 촉이 +z 를 보게 한다.
  //   ★ 부호를 −π/2 로 두면 촉이 **−z** 를 가리킨다(R_x(−90°) 가 +Y 를 −Z 로 보낸다).
  g.rotateX(Math.PI / 2);
  return g;
}

// 자원은 화면에 하나뿐이라 모듈에 둔다.
//   훅으로 담으면 린트가 「렌더 뒤에 훅 반환값을 고친다 / 렌더 중 ref 접근」으로 막는다
//   — 이 연출의 본체가 매 프레임 opacity 를 고치는 것이라 피해 갈 수 없다.
let _자원 = null;
function 자원() {
  if (_자원) return _자원;
  _자원 = {
    지오: 화살표지오(),
    재질: new THREE.MeshBasicMaterial({
      color: 색,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false, // 벽 뒤에 있어도 방향은 보여야 한다
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  };
  return _자원;
}

/** 캔버스 **안** — 머리 위 화살표 + 가장자리 좌표 계산 */
export function TG방향표시3D({ 켬 = true }) {
  // 숨김(사용자가 안내를 접음)·끝냄은 해랑 쪽 상태를 그대로 따른다 —
  //   동그라미가 사라졌는데 화살표만 남으면 안내가 어긋난다.
  const { 단계, 숨김, 끝냄 } = use튜토리얼();
  const 지금 = 숨김 || 끝냄 ? null : 단계들[단계];
  const get = useThree((s) => s.get);
  const 묶음 = useRef(null);
  const _v = useRef(new THREE.Vector3());
  const { 지오, 재질 } = 자원();

  useFrame((_, dt) => {
    const R = 자원();
    const { camera, size } = get();
    const 자리 = 켬 ? 지금?.자리 : null;
    const 눈 = 플레이어시점.쓸수있나 ? 플레이어시점.눈 : camera.position;
    // 복도 바닥은 y = 0 이다(튜토리얼판.jsx 가 동그라미를 0.03 에 깐다).
    //   `플레이어시점` 에는 발 자리가 없고, 눈 높이는 앉기·시점 설정에 따라
    //   오르내려서 머리에 안 붙는다. 바닥에서 재는 쪽이 흔들리지 않는다.
    const 바닥 = 0;

    // ── ① 머리 위 화살표 ──
    const 묶 = 묶음.current;
    if (묶) {
      if (!자리) {
        R.재질.opacity += (0 - R.재질.opacity) * Math.min(1, dt * 8);
      } else {
        const dx = 자리[0] - 눈.x;
        const dz = 자리[1] - 눈.z;
        const 거리 = Math.hypot(dx, dz);
        // 높이는 **발**에서 잰다. 눈 높이는 시점 설정에 따라 오르내려서 머리에 안 붙는다.
        const 둥실 = Math.sin(performance.now() / 420) * 0.12;
        묶.position.set(눈.x, 바닥 + 5.0 + 둥실, 눈.z);
        // 바로 위에 서면 방향이 튄다 — 그때는 마지막 각을 그대로 둔다.
        if (거리 > 0.4) 묶.rotation.y = Math.atan2(dx, dz);
        // 다 왔으면 흐려진다. 코앞에서 계속 가리키면 시야만 가린다.
        const 세기 = THREE.MathUtils.clamp((거리 - 1.6) / 2.5, 0, 1);
        const 맥 = 0.72 + 0.28 * Math.sin(performance.now() / 300);
        R.재질.opacity += (0.42 * 세기 * 맥 - R.재질.opacity) * Math.min(1, dt * 10);
      }
    }

    // ── ② 화면 가장자리 화살표 ──
    const el = 칸.가장자리;
    if (el) {
      if (!자리) {
        el.style.opacity = "0";
      } else {
        _v.current.set(자리[0], 바닥 + 0.8, 자리[1]).project(camera);
        const 뒤 = _v.current.z > 1;
        // 카메라 뒤면 부호를 뒤집어야 방향이 맞는다. 그대로 쓰면 반대를 가리킨다.
        const x = 뒤 ? -_v.current.x : _v.current.x;
        const y = 뒤 ? -_v.current.y : _v.current.y;
        if (!뒤 && Math.abs(x) <= 1 && Math.abs(y) <= 1) {
          el.style.opacity = "0"; // 목표가 화면에 들어오면 즉시 숨긴다
        } else {
          const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
          const nx = x / m;
          const ny = y / m;
          const cx = Math.min(size.width - 여백, Math.max(여백, (nx * 0.5 + 0.5) * size.width));
          const cy = Math.min(size.height - 여백, Math.max(여백, (-ny * 0.5 + 0.5) * size.height));
          el.style.opacity = "1";
          el.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${-Math.atan2(-ny, nx)}rad)`;
        }
      }
    }
  });

  return (
    <group ref={묶음} name="튜토리얼-머리위화살표">
      <mesh
        geometry={지오}
        material={재질}
        rotation={[-0.32, 0, 0]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
        renderOrder={6}
      />
    </group>
  );
}

/** 캔버스 **밖** — 가장자리 화살표를 그린다(자리는 위에서 직접 써 넣는다) */
export default function TG방향표시HUD() {
  const 붙이기 = (el) => {
    // ★ useEffect(…, []) 로 담으면 안 된다 — 안내가 꺼진 첫 렌더에서는 요소가 없고,
    //   그 상태로 효과가 한 번 돌아 버려 영영 비어 있는다(실제로 그렇게 안 떴다).
    칸.가장자리 = el;
  };
  useEffect(() => () => {
    칸.가장자리 = null;
  }, []);

  return (
    <>
      <style>{"@keyframes 튜토방향깜빡{0%,100%{filter:brightness(1)}50%{filter:brightness(2.2)}}"}</style>
      <div
        ref={붙이기}
        data-튜토="가장자리"
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: 44,
          width: 38,
          height: 38,
          opacity: 0,
          transition: "opacity 200ms ease",
          pointerEvents: "none",
          willChange: "transform",
          animation: "튜토방향깜빡 1s ease-in-out infinite",
        }}
      >
        <svg width="38" height="38" viewBox="0 0 34 34">
          <path
            d="M6 17 L24 17 M17 8 L26 17 L17 26"
            fill="none"
            stroke={색}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  );
}
