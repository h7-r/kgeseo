// ═══════════════════════════════════════════════════════════════
//  안내HUD.jsx — 키 안내 · 화면 가장자리 방향 표시 · [E] 조사 (HTML)
// ═══════════════════════════════════════════════════════════════
// [배치 규칙 — 힌트HUD.jsx 를 따른다]
//   왼쪽 위 = 힌트함 · 왼쪽 아래 = 성능 계기판 · 오른쪽 = Leva · 가운데 = 조준점
//   그래서 **키 안내는 화면 아래 가운데**, 조준점보다 아래로 내린다.
//   전부 `pointerEvents: none` — 조준·클릭을 가로채면 안 된다.
//
// [★ 매 프레임 React state 를 건드리지 않는다]
//   화면 좌표는 캔버스 **안**의 작은 컴포넌트가 `useFrame` 에서 project() 로 구하고,
//   그 결과를 DOM 요소의 `style.transform` 에 **직접** 쓴다. state 로 넘기면
//   프레임마다 리렌더가 돌아 안내가 게임을 느리게 만드는 꼴이 된다.
//   그래서 두 쪽이 module 수준의 작은 상자(`칸`) 하나로만 이어져 있다.
//
// [보이고 사라지는 건 CSS 가 한다]
//   JS 타이머로 매 프레임 스타일을 바꾸지 않는다. 클래스만 갈아 끼우고
//   transition 이 0.25 초 페이드인 · 0.4 초 페이드아웃을 맡는다.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { 안내설정 } from "./안내단계.js";
import { 현재, 지금단계, 자리풀기, use안내, 키다시보일때인가, 키다시보이기 } from "./안내상태.js";

// 캔버스 안(계산)과 밖(그리기)을 잇는 유일한 통로. React state 를 안 쓴다.
const 칸 = {
  화살표: null, // 가장자리 방향 표시 DOM
  E라벨: null, // [E] 조사 DOM
};

const 여백 = 48; // 가장자리에서 이만큼 안쪽에 띄운다

// ── 캔버스 **안** — 좌표만 구해서 DOM 에 직접 쓴다 ───────────
export function TG안내좌표({ 겨냥위치 = null }) {
  const get = useThree((s) => s.get);
  const v = useRef(new THREE.Vector3());

  useFrame(() => {
    const { camera, size } = get();
    const 상자 = 현재();
    const 단계 = 지금단계();

    // ① 화면 가장자리 방향 표시
    const el = 칸.화살표;
    if (el) {
      const 지연 = 단계?.가장자리표시지연;
      const 목표 = 상자.켜짐 ? 자리풀기(단계?.목표) : null;
      // 단계에 들어온 지 `지연` 초가 지나도 못 찾았을 때만 — 먼저 둘러보게 둔다.
      const 지났나 = 지연 != null && performance.now() / 1000 - 상자.단계시작시각 >= 지연;
      if (!목표 || !지났나) {
        el.style.opacity = "0";
      } else {
        v.current.set(목표[0], 0.8, 목표[1]).project(camera);
        const 뒤 = v.current.z > 1;
        let x = v.current.x;
        let y = v.current.y;
        if (뒤) {
          // 카메라 뒤면 부호를 뒤집어야 방향이 맞는다. 그대로 쓰면 반대를 가리킨다.
          x = -x;
          y = -y;
        }
        const 화면안 = !뒤 && Math.abs(x) <= 1 && Math.abs(y) <= 1;
        if (화면안) {
          el.style.opacity = "0"; // 목표가 보이면 즉시 숨긴다
        } else {
          // 가장자리에 붙인다 — 긴 축을 1 로 맞춰 사각 테두리에 닿게 한다.
          const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
          const nx = x / m;
          const ny = y / m;
          const px = (nx * 0.5 + 0.5) * size.width;
          const py = (-ny * 0.5 + 0.5) * size.height;
          const cx = Math.min(size.width - 여백, Math.max(여백, px));
          const cy = Math.min(size.height - 여백, Math.max(여백, py));
          const 각 = Math.atan2(-ny, nx);
          el.style.opacity = "1";
          el.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${-각}rad)`;
        }
      }
    }

    // ② [E] 조사 — 겨냥된 물건 위에. 판정은 기존 겨냥판정 결과를 그대로 받는다.
    const E = 칸.E라벨;
    if (E) {
      const p = 겨냥위치?.();
      if (!p) E.style.opacity = "0";
      else {
        v.current.set(p[0], p[1] + 0.35, p[2]).project(camera);
        if (v.current.z > 1) E.style.opacity = "0";
        else {
          E.style.opacity = "1";
          E.style.transform = `translate(${(v.current.x * 0.5 + 0.5) * size.width}px, ${(-v.current.y * 0.5 + 0.5) * size.height}px) translate(-50%, -100%)`;
        }
      }
    }
  });

  return null;
}

// ── 키캡 하나 ───────────────────────────────────────────────
function TG키캡({ 글, 넓게 = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 넓게 ? 92 : 30,
        height: 30,
        padding: "0 8px",
        borderRadius: 7,
        border: `1.5px solid ${안내설정.색}`,
        boxShadow: `0 0 10px ${안내설정.색}40, inset 0 0 8px ${안내설정.색}22`,
        color: "#eaf9ff",
        background: "rgba(8,16,22,.55)",
        font: '600 12px/1 ui-monospace, Menlo, monospace',
        letterSpacing: "0.04em",
      }}
    >
      {글}
    </span>
  );
}

// WASD 는 역T자로 놓는다 — 줄글보다 손 모양이 먼저 읽힌다.
function TG키묶음({ 키들 }) {
  const has = (k) => 키들.includes(k);
  if (has("W") && has("A")) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <TG키캡 글="W" />
        <div style={{ display: "flex", gap: 4 }}>
          <TG키캡 글="A" />
          <TG키캡 글="S" />
          <TG키캡 글="D" />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {키들.map((k) =>
        k === "마우스" ? (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="20" height="28" viewBox="0 0 20 28" aria-hidden>
              <rect x="1.5" y="1.5" width="17" height="25" rx="8.5" fill="rgba(8,16,22,.55)" stroke={안내설정.색} strokeWidth="1.5" />
              <line x1="10" y1="2" x2="10" y2="11" stroke={안내설정.색} strokeWidth="1.5" />
            </svg>
          </span>
        ) : (
          <TG키캡 key={k} 글={k === "Space" ? "SPACE" : k} 넓게={k === "Space"} />
        ),
      )}
    </div>
  );
}

// ── 캔버스 **밖** — 그리기만 한다 ───────────────────────────
export default function TG안내HUD() {
  const 상자 = use안내();
  const 단계 = 지금단계();
  // ★ 요소를 **콜백 ref 로** 받는다. useEffect(…, []) 로 담으면 안 된다 —
  //   안내가 꺼진 첫 렌더에서는 이 컴포넌트가 null 을 돌려주므로 요소가 없고,
  //   그 상태로 효과가 한 번 돌아 버린다. 나중에 안내가 켜져도 효과는 다시 안 돌아서
  //   `칸` 이 영원히 비어 있다(실제로 가장자리 화살표가 통째로 안 떴다).
  const 화살표ref = (el) => {
    칸.화살표 = el;
  };
  const E라벨ref = (el) => {
    칸.E라벨 = el;
  };

  // 방치하면 키 안내를 한 번 더 — 1 초에 한 번만 확인한다(매 프레임 아님).
  useEffect(() => {
    if (!상자.켜짐) return undefined;
    const t = setInterval(() => {
      if (키다시보일때인가()) 키다시보이기();
    }, 1000);
    return () => clearInterval(t);
  }, [상자.켜짐]);

  if (!상자.켜짐) return null;

  const 키들 = 단계?.키 ?? [];
  const 키보임 = 상자.키보임 && 키들.length > 0;

  return (
    <>
      <style>{"@keyframes 튜토깜빡{0%,100%{filter:brightness(1)}50%{filter:brightness(2.2)}}"}</style>
      {/* 키 안내 — 화면 아래 가운데. 조준점(가운데)과 겹치지 않게 아래로 내린다. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 72,
          transform: "translateX(-50%)",
          zIndex: 45,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderRadius: 12,
          background: "rgba(6,12,18,.42)",
          backdropFilter: "blur(2px)",
          pointerEvents: "none",
          opacity: 키보임 ? 1 : 0,
          // 뜰 때 0.25초, 사라질 때 0.4초 — 요구한 값 그대로
          transition: `opacity ${키보임 ? 250 : 400}ms ease`,
        }}
      >
        <TG키묶음 키들={키들} />
        {/* 동사 하나. 한 줄을 넘기지 않는다. */}
        <span style={{ color: "#dff4ff", font: '600 13px/1 ui-monospace, Menlo, monospace', whiteSpace: "nowrap" }}>
          {단계?.문구 ?? ""}
        </span>
      </div>

      {/* 화면 가장자리 방향 표시 — 좌표는 캔버스 안(TG안내좌표)이 직접 써 넣는다 */}
      <div
        ref={화살표ref}
        data-안내="가장자리"
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: 44,
          width: 34,
          height: 34,
          opacity: 0,
          transition: "opacity 200ms ease",
          pointerEvents: "none",
          willChange: "transform",
          // ★ 깜빡이게 둔다. 가만히 있는 화살표는 배경에 묻힌다 — 튜토리얼에서는
          //   "저기로 가라"가 한눈에 읽혀야 한다(사용자 지적).
          //   애니메이션은 CSS 가 돌린다. JS 로 매 프레임 스타일을 바꾸지 않는다.
          animation: "튜토깜빡 1s ease-in-out infinite",
        }}
      >
        <svg width="34" height="34" viewBox="0 0 34 34">
          <path d="M6 17 L24 17 M17 8 L26 17 L17 26" fill="none" stroke={안내설정.색} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* [E] 조사 — 겨냥된 물건 위 */}
      <div
        ref={E라벨ref}
        data-안내="E라벨"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: 44,
          opacity: 0,
          transition: "opacity 150ms ease",
          pointerEvents: "none",
          willChange: "transform",
          padding: "3px 8px",
          borderRadius: 7,
          border: `1.5px solid ${안내설정.색}`,
          background: "rgba(8,16,22,.6)",
          color: "#eaf9ff",
          font: '600 11px/1.3 ui-monospace, Menlo, monospace',
          whiteSpace: "nowrap",
        }}
      >
        [E] 조사
      </div>
    </>
  );
}
