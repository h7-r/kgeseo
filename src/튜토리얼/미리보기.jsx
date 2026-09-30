// ═══════════════════════════════════════════════════════════════
//  미리보기.jsx — 튜토리얼 안내만 떼어 보는 개발용 화면
// ═══════════════════════════════════════════════════════════════
// [왜 따로 있나]
//   본편 `src/App.jsx` 는 지금 다른 사람이 계속 고치고 있어서 붙일 수가 없다.
//   그래도 **눈으로 봐야** 화살표 굵기·링 크기·키캡 배치를 정할 수 있다.
//   그래서 복도 크기만 같게 맞춘 빈 방에 안내만 올려 둔다.
//   ※ 이 파일은 본편에 안 들어간다. 붙일 때는 4단계에서 App.jsx 에 태그만 더한다.
//
// 복도 크기는 본편 Leva 저장값(`비밀 복도`)의 **지금 값**과 같게 뒀다.
//   x −31 ~ −20 · z −60 ~ +25.5 · 문z +4 — 지시서에 적혀 있던 z −12~10 이 아니다.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import TG바닥안내 from "./바닥안내.jsx";
import TG안내HUD, { TG안내좌표 } from "./안내HUD.jsx";
import { 안내단계 } from "./안내단계.js";
import {
  복도설정,
  대상위치제공하기,
  신호제공,
  켜기정하기,
  판정하기,
  입력기록,
  현재,
  지금단계,
  다음단계,
} from "./안내상태.js";

const 복도 = { x0: -31, x1: -20, z0: -60, z1: 25.5, 바닥y: 0.01, 높이: 8 };
const 눈높이 = 1.6;

// 본편 `<상호대상 id="동전줍기:캔">` 을 흉내 낸다 — 자리만 있으면 안내는 똑같이 돈다.
const 가짜대상 = {
  "동전줍기:캔": [-20.4, 0.05, -1.6],
  "동전줍기:종이컵": [-20.4, 0.05, -4.8],
};

function 복도모형() {
  const { x0, x1, z0, z1, 높이 } = 복도;
  const 폭 = x1 - x0;
  const 길이 = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[폭, 길이]} />
        <meshBasicMaterial color="#2d2f31" />
      </mesh>
      {[x0, x1].map((x) => (
        <mesh key={x} position={[x, 높이 / 2, cz]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[길이, 높이]} />
          <meshBasicMaterial color="#525b69" side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 10 유닛마다 눈금 — 거리를 눈으로 가늠하려고 둔다 */}
      {Array.from({ length: Math.floor(길이 / 10) + 1 }, (_, i) => z0 + i * 10).map((z) => (
        <mesh key={z} position={[cx, 0.011, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[폭, 0.06]} />
          <meshBasicMaterial color="#454a52" />
        </mesh>
      ))}
    </group>
  );
}

// 아주 작은 1인칭 — 본편 `use이동` 을 끌어오지 않는다(그 파일은 지금 남이 고치는 중이다).
function 걷기({ 참조 }) {
  const { camera } = useThree();
  const 키 = useRef({ f: 0, b: 0, l: 0, r: 0, run: 0 });
  useEffect(() => {
    const set = (c, v) => {
      const k = 키.current;
      if (c === "KeyW") k.f = v;
      else if (c === "KeyS") k.b = v;
      else if (c === "KeyA") k.l = v;
      else if (c === "KeyD") k.r = v;
      else if (c === "ShiftLeft") k.run = v;
      if (v && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(c)) 입력기록("WASD");
      if (v && c === "Space") 입력기록("Space");
    };
    const down = (e) => set(e.code, 1);
    const up = (e) => set(e.code, 0);
    const 움직임 = () => 입력기록("마우스");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousemove", 움직임);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousemove", 움직임);
    };
  }, []);

  // ★ R3F 의 기본 카메라는 **원점을 바라본다.** 복도는 x −31~−20 에 있어서
  //   그대로 두면 카메라가 방 쪽 벽(x −20)을 코앞에서 마주 본다 — 안내가 다 시야
  //   밖으로 나가 "아무것도 안 보인다"가 된다(실제로 그렇게 나왔다).
  //   복도가 뻗은 −z 쪽을 보게 한 번만 돌려 둔다. 그 뒤로는 PointerLockControls 가 몬다.
  const 처음 = useRef(true);
  const 앞 = useMemo(() => new THREE.Vector3(), []);
  const 옆 = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (처음.current) {
      처음.current = false;
      camera.rotation.set(0, 0, 0);
    }
    const k = 키.current;
    const 속도 = (k.run ? 9 : 4.5) * Math.min(0.05, dt);
    camera.getWorldDirection(앞);
    앞.y = 0;
    앞.normalize();
    옆.crossVectors(앞, camera.up).normalize();
    camera.position.addScaledVector(앞, (k.f - k.b) * 속도);
    camera.position.addScaledVector(옆, (k.r - k.l) * 속도);
    camera.position.x = Math.min(복도.x1 - 0.6, Math.max(복도.x0 + 0.6, camera.position.x));
    camera.position.z = Math.min(복도.z1 - 0.6, Math.max(복도.z0 + 0.6, camera.position.z));
    camera.position.y = 눈높이;

    참조.current = [camera.position.x, camera.position.y, camera.position.z];
    // 판정은 값만 읽는다 — 단계가 넘어갈 때만 상자가 바뀐다.
    판정하기({ 위치: 참조.current, 시선각: camera.rotation.y });
  });
  return null;
}

export default function TG미리보기() {
  const 자리 = useRef([-25.5, 눈높이, 0]);
  const [단계글, 단계글설정] = useState("");

  useEffect(() => {
    복도설정(복도);
    대상위치제공하기((id) => 가짜대상[id] ?? null);
    신호제공({
      // 미리보기에는 퍼즐이 없다 — 단추로 넘긴다. 자물쇠는 본편에서 주입된다.
      "자물쇠.풀림": () => false,
    });
    켜기정하기({ 튜토리얼완료: false });
    const t = setInterval(() => {
      const s = 현재();
      const d = 지금단계();
      단계글설정(`${s.단계번호 + 1}/${안내단계.length}  ${d?.id ?? "-"}  ·  ${d?.완료?.종류 ?? "-"}`);
    }, 200);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#0b0e12" }}>
      <Canvas camera={{ position: [-25.5, 눈높이, 0], fov: 70, near: 0.1, far: 300 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b0e12"]} />
        <복도모형 />
        <TG바닥안내 바닥y={복도.바닥y} />
        <TG안내좌표 겨냥위치={() => null} />
        <PointerLockControls />
        <걷기 참조={자리} />
      </Canvas>

      <TG안내HUD />

      {/* 조준점 — 본편과 같은 자리(가운데) */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 4, height: 4, marginLeft: -2, marginTop: -2, borderRadius: 2, background: "#cfe8f5", opacity: 0.8, pointerEvents: "none" }} />

      <div style={패널}>
        <b style={{ color: "#9ef0c0" }}>{단계글}</b>
        <div style={{ marginTop: 6, opacity: 0.8 }}>화면을 클릭하면 마우스가 잡힌다 · WASD 이동 · Shift 달리기 · ESC 로 빠져나옴</div>
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={단추} onClick={() => 다음단계()}>다음 단계 →</button>
          {안내단계.map((d, i) => (
            <button key={d.id} type="button" style={단추} onClick={() => window.__안내?.단계로(i)}>
              {d.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const 패널 = {
  position: "absolute",
  left: 12,
  top: 12,
  zIndex: 50,
  maxWidth: 520,
  padding: "9px 12px",
  borderRadius: 9,
  background: "rgba(10,14,20,.78)",
  color: "#dbe6f2",
  font: '12px/1.5 ui-monospace, Menlo, monospace',
};
const 단추 = {
  border: "1px solid rgba(150,190,220,.4)",
  borderRadius: 6,
  padding: "3px 8px",
  background: "rgba(20,28,38,.9)",
  color: "#cfe0f0",
  font: '11px/1.2 ui-monospace, Menlo, monospace',
  cursor: "pointer",
};
