// 걷기·달리기 비교 GAIT무대 (개발 전용, gait.html).
//
// 왼쪽 = 원본 무료 캐릭터(sidekick-customizer.glb — 몸·스켈레톤·스키닝이 원본 그대로)
// 오른쪽 = 새 몸체 캐릭터(Meshy 모델 + 같은 88본 스켈레톤 + 자동 웨이트)
// 두 캐릭터에 **같은 클립을 같은 시각으로 고정**해 넣는다. 재생 위치가 정확히
// 같아야 '원본은 멀쩡한데 이쪽만 이상한' 항목을 가려낼 수 있다.
//
// 뼈는 멀쩡한데 살만 찌그러지는지 보려면 스켈레톤 표시를 켠다.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import SidekickGameAvatar from "../src/사이드킥게임아바타.jsx";
import ChibiGameAvatar from "../src/치비게임아바타.jsx";
import { 외형설정보정 } from "../src/사이드킥옵션.js";
import { 메시설정보정 } from "../src/메시외형옵션.js";
import { 기본툰 } from "../src/툰재질.js";
import { 기본외곽선 } from "../src/툰외곽선.js";

const 동작목록 = [
  ["Idle_Loop", "대기"],
  ["Walk_Loop", "걷기"],
  ["Jog_Fwd_Loop", "조깅"],
  ["Sprint_Loop", "질주"],
];
const 시점목록 = [
  ["side", "측면", Math.PI / 2],
  ["front", "정면", 0],
  ["back", "후면", Math.PI],
  ["quarter", "45°", Math.PI / 4],
];
const 간격 = 1.1;

function 정지상태() {
  return {
    position: new THREE.Vector3(),
    footY: 0,
    groundY: 0,
    facing: 0,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    speed: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  };
}

// 화면을 채우는 직교 카메라 — 두 캐릭터를 같은 크기로 본다.
function GAIT카메라({ 시점, 줌 }) {
  // QA 무대와 같은 방식 — 카메라를 효과 안에서 꺼내 쓴다(반응형 값으로 잡지 않는다).
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  useEffect(() => {
    const { camera } = get();
    const 높이 = 2.0 / 줌;
    const 폭 = (높이 * size.width) / size.height;
    camera.left = -폭 / 2;
    camera.right = 폭 / 2;
    camera.top = 높이 / 2;
    camera.bottom = -높이 / 2;
    camera.near = -50;
    camera.far = 50;
    camera.position.set(0, 0.85, 6);
    camera.lookAt(0, 0.85, 0);
    camera.manual = true; // R3F 가 종횡비를 덮어쓰지 않게
    camera.updateProjectionMatrix();
  }, [get, size, 줌, 시점]);
  return null;
}

// 씬 안의 SkinnedMesh 를 찾아 스켈레톤을 그린다. 아바타 컴포넌트를 건드리지 않는다.
function GAIT뼈대표시({ 켬 }) {
  const scene = useThree((s) => s.scene);
  const 도우미 = useRef([]);
  useFrame(() => {
    if (!켬) {
      if (도우미.current.length) {
        도우미.current.forEach((h) => h.parent?.remove(h));
        도우미.current = [];
      }
      return;
    }
    if (도우미.current.length) return;
    const 뿌리 = new Set();
    scene.traverse((o) => {
      if (!o.isSkinnedMesh || !o.skeleton?.bones.length) return;
      let bone = o.skeleton.bones[0];
      while (bone.parent?.isBone) bone = bone.parent;
      뿌리.add(bone);
    });
    뿌리.forEach((bone) => {
      const helper = new THREE.SkeletonHelper(bone);
      helper.material.depthTest = false;
      helper.material.linewidth = 2;
      helper.renderOrder = 999;
      bone.parent?.add(helper);
      도우미.current.push(helper);
    });
  });
  return null;
}

// 개발용 GAIT손잡이 — 콘솔·헤드리스에서 씬을 직접 재려고 연다.
function GAIT손잡이() {
  const three = useThree();
  useEffect(() => {
    window.__보행 = { scene: three.scene, three, THREE };
  }, [three]);
  return null;
}

function GAIT무대() {
  const [동작, set동작] = useState("Walk_Loop");
  const [배속, set배속] = useState(1);
  const [뼈보기, set뼈보기] = useState(false);
  const [시점, set시점] = useState("side");
  const [줌, set줌] = useState(1);
  const [멈춤, set멈춤] = useState(false);
  const [시각, set시각] = useState(0);
  const 사이드킥상태 = useRef(정지상태());
  const 메시상태 = useRef(정지상태());
  const 사이드킥설정 = useMemo(() => ({ ...외형설정보정(null), motion: 동작 }), [동작]);
  const 메시설정 = useMemo(() => ({ ...메시설정보정(null), motion: 동작 }), [동작]);
  const 회전 = 시점목록.find(([key]) => key === 시점)[2];

  useEffect(() => {
    사이드킥상태.current.facing = 회전;
    메시상태.current.facing = 회전;
    사이드킥상태.current.position.set(-간격 / 2, 0, 0);
    메시상태.current.position.set(간격 / 2, 0, 0);
  }, [회전]);

  return (
    <>
      <div style={판}>
        <div style={줄}>
          {동작목록.map(([value, label]) => (
            <button key={value} type="button" style={동작 === value ? 선택 : 버튼} onClick={() => set동작(value)}>
              {label}
            </button>
          ))}
        </div>
        <div style={줄}>
          {시점목록.map(([key, label]) => (
            <button key={key} type="button" style={시점 === key ? 선택 : 버튼} onClick={() => set시점(key)}>
              {label}
            </button>
          ))}
        </div>
        <div style={줄}>
          <button type="button" style={뼈보기 ? 선택 : 버튼} onClick={() => set뼈보기((v) => !v)}>스켈레톤</button>
          <button type="button" style={멈춤 ? 선택 : 버튼} onClick={() => set멈춤((v) => !v)}>{멈춤 ? "정지" : "재생"}</button>
          {[0.25, 0.5, 1].map((v) => (
            <button key={v} type="button" style={배속 === v ? 선택 : 버튼} onClick={() => set배속(v)}>{v}x</button>
          ))}
        </div>
        <label style={슬라이더줄}>
          <span>구간</span>
          <input type="range" min={0} max={1} step={0.001} value={시각 % 1}
                 onChange={(e) => { set멈춤(true); set시각(Number(e.target.value)); }} style={{ width: "100%" }} />
          <output style={값}>{(시각 % 1).toFixed(3)}</output>
        </label>
        <label style={슬라이더줄}>
          <span>확대</span>
          <input type="range" min={0.6} max={3} step={0.05} value={줌}
                 onChange={(e) => set줌(Number(e.target.value))} style={{ width: "100%" }} />
          <output style={값}>{줌.toFixed(2)}</output>
        </label>
        <div style={설명}>왼쪽 = 원본 캐릭터 · 오른쪽 = 새 몸체 캐릭터 · 같은 클립을 같은 시각으로 고정</div>
      </div>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        orthographic
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        style={{ position: "absolute", inset: 0, background: "#8d95a1" }}
      >
        <GAIT손잡이 />
        <GAIT카메라 시점={시점} 줌={줌} />
        <GAIT시계 멈춤={멈춤} 배속={배속} set시각={set시각} />
        <GAIT뼈대표시 켬={뼈보기} />
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
        <directionalLight position={[3, 6, 4]} intensity={1.15} />
        <Suspense fallback={null}>
          <SidekickGameAvatar 보이기 플레이어참조={사이드킥상태} 설정={사이드킥설정} 크기={1} 검증시각={시각} />
          <ChibiGameAvatar
            보이기
            플레이어참조={메시상태}
            설정={메시설정}
            크기={1}
            검증시각={시각}
            몸체="meshy"
            툰={{ ...기본툰, 켬: false }}
            외곽선={{ ...기본외곽선, 켬: false }}
          />
        </Suspense>
      </Canvas>
    </>
  );
}

// 두 아바타가 같은 시각을 받도록 한 곳에서만 시간을 굴린다.
function GAIT시계({ 멈춤, 배속, set시각 }) {
  const 누적 = useRef(0);
  useFrame((_, delta) => {
    if (멈춤) return;
    누적.current += delta * 배속;
    set시각(누적.current);
  });
  return null;
}

const 글꼴 = '12px/1.4 ui-monospace, Menlo, "Malgun Gothic", monospace';
const 판 = { position: "absolute", left: 14, top: 14, zIndex: 10, display: "grid", gap: 5, width: 340, padding: 10, borderRadius: 8, background: "rgba(14,18,26,.86)", border: "1px solid rgba(170,190,220,.25)", color: "#DDE7F6", font: 글꼴 };
const 버튼 = { border: "1px solid rgba(170,190,220,.25)", borderRadius: 5, padding: "4px 8px", background: "rgba(20,26,36,.8)", color: "#DDE7F6", font: 글꼴, cursor: "pointer" };
const 선택 = { ...버튼, background: "rgba(92,140,196,.5)", borderColor: "rgba(170,210,255,.7)", color: "#fff" };
const 줄 = { display: "flex", gap: 4, flexWrap: "wrap" };
const 슬라이더줄 = { display: "grid", gridTemplateColumns: "34px 1fr 44px", alignItems: "center", gap: 6 };
const 값 = { textAlign: "right", color: "#AFC0D8", fontSize: 11 };
const 설명 = { color: "#AFC0D8", fontSize: 11 };

createRoot(document.getElementById("root")).render(<GAIT무대 />);
