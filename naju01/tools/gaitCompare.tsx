/* eslint-disable react-refresh/only-export-components -- 페이지 엔트리라 내보낼 것이 없다 */
/**
 * 걷기·달리기 비교 무대(개발 전용, gait.html).
 * 왼쪽 = 원본 무료 캐릭터(sidekick-customizer.glb — 몸·스켈레톤·스키닝 원본), 가운데·오른쪽 = 새 몸체(Meshy + 같은 88본 + 자동 웨이트).
 * 같은 클립을 같은 시각으로 고정해 넣어야 「원본은 멀쩡한데 이쪽만 이상한」 항목을 가려낸다.
 * 뼈는 멀쩡한데 살만 찌그러지는지 보려면 스켈레톤 표시를 켠다.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import ChibiGameAvatar from "../src/avatar/ChibiGameAvatar";
import SidekickGameAvatar from "../src/avatar/SidekickGameAvatar";
import type { AvatarLink } from "@/engine/avatarLink";
import { normalizeMeshConfig, type MotionSource } from "../src/avatar/meshAppearance";
import { normalizeSidekickConfig } from "../src/avatar/sidekickOptions";
import { DEFAULT_TOON } from "../src/avatar/toonMaterial";
import { DEFAULT_OUTLINE } from "../src/avatar/toonOutline";

const MOTIONS = [
  ["Idle_Loop", "대기"],
  ["Walk_Loop", "걷기"],
  ["Jog_Fwd_Loop", "조깅"],
  ["Sprint_Loop", "질주"],
] as const;
type ViewId = "side" | "front" | "back" | "quarter";
const VIEWS: readonly (readonly [ViewId, string, number])[] = [
  ["side", "측면", Math.PI / 2],
  ["front", "정면", 0],
  ["back", "후면", Math.PI],
  ["quarter", "45°", Math.PI / 4],
];
const SPACING = 1.1;

function idleState(): AvatarLink {
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

/** 화면을 채우는 직교 카메라 — 세 캐릭터를 같은 크기로 본다 */
function GaitCamera({ view, zoom }: { view: ViewId; zoom: number }) {
  // QA 무대와 같은 방식 — 카메라를 effect 안에서 꺼내 쓴다(반응형 값으로 잡지 않는다)
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  useEffect(() => {
    const camera = get().camera as THREE.OrthographicCamera & { manual?: boolean };
    const height = 2.1 / zoom;
    const width = (height * size.width) / size.height;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.near = -50;
    camera.far = 50;
    camera.position.set(0, 0.85, 6);
    camera.lookAt(0, 0.85, 0);
    camera.manual = true; // R3F 가 종횡비를 덮어쓰지 않게
    camera.updateProjectionMatrix();
  }, [get, size, zoom, view]);
  return null;
}

/** 씬 안의 SkinnedMesh 를 찾아 스켈레톤을 그린다 — 아바타 컴포넌트를 건드리지 않는다 */
function SkeletonOverlay({ enabled }: { enabled: boolean }) {
  const scene = useThree((state) => state.scene);
  const helpers = useRef<THREE.SkeletonHelper[]>([]);
  useFrame(() => {
    if (!enabled) {
      if (helpers.current.length) {
        helpers.current.forEach((helper) => helper.parent?.remove(helper));
        helpers.current = [];
      }
      return;
    }
    if (helpers.current.length) return;
    const roots = new Set<THREE.Object3D>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh) || !object.skeleton?.bones.length) return;
      let bone: THREE.Object3D = object.skeleton.bones[0];
      while (bone.parent instanceof THREE.Bone) bone = bone.parent;
      roots.add(bone);
    });
    roots.forEach((bone) => {
      const helper = new THREE.SkeletonHelper(bone);
      const material = helper.material as THREE.LineBasicMaterial;
      material.depthTest = false;
      material.linewidth = 2;
      helper.renderOrder = 999;
      bone.parent?.add(helper);
      helpers.current.push(helper);
    });
  });
  return null;
}

/** 콘솔·헤드리스에서 씬을 직접 재려고 연다 */
function GaitDevHook() {
  const three = useThree();
  useEffect(() => {
    exposeDevHook("gait", { scene: three.scene, three, THREE });
  }, [three]);
  return null;
}

/** 세 아바타가 같은 시각을 받도록 한 곳에서만 시간을 굴린다 */
function GaitClock({ isPaused, speed, setTime }: { isPaused: boolean; speed: number; setTime: (time: number) => void }) {
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (isPaused) return;
    elapsed.current += delta * speed;
    setTime(elapsed.current);
  });
  return null;
}

function GaitStage() {
  const [motion, setMotion] = useState<string>("Walk_Loop");
  const [speed, setSpeed] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [view, setView] = useState<ViewId>("side");
  const [zoom, setZoom] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isCorrectionOn, setIsCorrectionOn] = useState(true);
  const [isFootContactOn, setIsFootContactOn] = useState(true);
  const [useTripo, setUseTripo] = useState(true);
  // 덧값만 넘긴다 — 기본값과 성별별 값은 아바타 안에서 합쳐진다
  const correction = useMemo(
    () => ({ enabled: isCorrectionOn, footContactEnabled: isFootContactOn }),
    [isCorrectionOn, isFootContactOn],
  );
  const [time, setTime] = useState(0);
  const sidekickState = useRef<AvatarLink>(idleState());
  const meshState = useRef<AvatarLink>(idleState());
  const feminineState = useRef<AvatarLink>(idleState());
  // ?skinColor=%23ff0000&clothColor=%230000ff&shoes=-1 처럼 외형 값을 주소로 넘긴다.
  // ?toon=1 이면 툰 재질을 켠다(피부·의상 표식 색칠은 툰 재질에서만 된다).
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(window.location.search)), []);
  const isToonOn = query.toon === "1";
  const isOutlineOn = query.outline === "1";
  const sidekickConfig = useMemo(() => ({ ...normalizeSidekickConfig(null), motion }), [motion]);
  const motionSource: MotionSource = useTripo ? "tripo" : "sidekick";
  const meshConfig = useMemo(
    () => ({ ...normalizeMeshConfig(query), motion, motionSource }),
    [motion, query, motionSource],
  );
  const feminineConfig = useMemo(
    () => ({ ...normalizeMeshConfig({ ...query, gender: "feminine" }), motion, motionSource }),
    [motion, query, motionSource],
  );
  const rotation = VIEWS.find(([id]) => id === view)?.[2] ?? 0;

  useEffect(() => {
    [sidekickState, meshState, feminineState].forEach((ref) => {
      ref.current.facing = rotation;
    });
    sidekickState.current.position.set(-SPACING, 0, 0);
    meshState.current.position.set(0, 0, 0);
    feminineState.current.position.set(SPACING, 0, 0);
  }, [rotation]);

  const toon = { ...DEFAULT_TOON, enabled: isToonOn };
  const outline = { ...DEFAULT_OUTLINE, enabled: isOutlineOn };

  return (
    <>
      <div style={panelStyle}>
        <div style={rowStyle}>
          {MOTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              style={motion === value ? selectedStyle : buttonStyle}
              onClick={() => setMotion(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={rowStyle}>
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" style={view === id ? selectedStyle : buttonStyle} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <div style={rowStyle}>
          <button
            type="button"
            style={showSkeleton ? selectedStyle : buttonStyle}
            onClick={() => setShowSkeleton((v) => !v)}
          >
            스켈레톤
          </button>
          <button
            type="button"
            style={isCorrectionOn ? selectedStyle : buttonStyle}
            onClick={() => setIsCorrectionOn((v) => !v)}
          >
            {isCorrectionOn ? "보정 켬" : "원본 클립"}
          </button>
          <button
            type="button"
            style={isFootContactOn ? selectedStyle : buttonStyle}
            onClick={() => setIsFootContactOn((v) => !v)}
          >
            {isFootContactOn ? "접지 IK 켬" : "접지 IK 끔"}
          </button>
          <button type="button" style={useTripo ? selectedStyle : buttonStyle} onClick={() => setUseTripo((v) => !v)}>
            {useTripo ? "Tripo 동작" : "Sidekick 동작"}
          </button>
          <button type="button" style={isPaused ? selectedStyle : buttonStyle} onClick={() => setIsPaused((v) => !v)}>
            {isPaused ? "정지" : "재생"}
          </button>
          {[0.25, 0.5, 1].map((value) => (
            <button
              key={value}
              type="button"
              style={speed === value ? selectedStyle : buttonStyle}
              onClick={() => setSpeed(value)}
            >
              {value}x
            </button>
          ))}
        </div>
        <label style={sliderRowStyle}>
          <span>구간</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={time % 1}
            onChange={(event) => {
              setIsPaused(true);
              setTime(Number(event.target.value));
            }}
            style={{ width: "100%" }}
          />
          <output style={valueStyle}>{(time % 1).toFixed(3)}</output>
        </label>
        <label style={sliderRowStyle}>
          <span>확대</span>
          <input
            type="range"
            min={0.6}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            style={{ width: "100%" }}
          />
          <output style={valueStyle}>{zoom.toFixed(2)}</output>
        </label>
        <div style={noteStyle}>
          왼쪽 = 원본 캐릭터 · 가운데 = 새 몸체(남) · 오른쪽 = 새 몸체(여) · 같은 클립을 같은 시각으로 고정
        </div>
      </div>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        orthographic
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        style={{ position: "absolute", inset: 0, background: "#8d95a1" }}
      >
        <GaitDevHook />
        <GaitCamera view={view} zoom={zoom} />
        <GaitClock isPaused={isPaused} speed={speed} setTime={setTime} />
        <SkeletonOverlay enabled={showSkeleton} />
        <ambientLight intensity={0.85} />
        <hemisphereLight args={["#eef3ff", "#6d6a63", 0.55]} />
        <directionalLight position={[3, 6, 4]} intensity={1.15} />
        <Suspense fallback={null}>
          <SidekickGameAvatar visible playerRef={sidekickState} config={sidekickConfig} scale={1} fixedTime={time} />
          <ChibiGameAvatar
            visible
            playerRef={meshState}
            config={meshConfig}
            scale={1}
            fixedTime={time}
            body="meshy"
            toon={toon}
            outline={outline}
            correction={correction}
          />
          <ChibiGameAvatar
            visible
            playerRef={feminineState}
            config={feminineConfig}
            scale={1}
            fixedTime={time}
            body="meshy"
            toon={toon}
            outline={outline}
            correction={correction}
          />
        </Suspense>
      </Canvas>
    </>
  );
}

const FONT = '12px/1.4 ui-monospace, Menlo, "Malgun Gothic", monospace';
const panelStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  top: 14,
  zIndex: 10,
  display: "grid",
  gap: 5,
  width: 340,
  padding: 10,
  borderRadius: 8,
  background: "rgba(14,18,26,.86)",
  border: "1px solid rgba(170,190,220,.25)",
  color: "#DDE7F6",
  font: FONT,
};
const buttonStyle: CSSProperties = {
  border: "1px solid rgba(170,190,220,.25)",
  borderRadius: 5,
  padding: "4px 8px",
  background: "rgba(20,26,36,.8)",
  color: "#DDE7F6",
  font: FONT,
  cursor: "pointer",
};
const selectedStyle: CSSProperties = {
  ...buttonStyle,
  background: "rgba(92,140,196,.5)",
  borderColor: "rgba(170,210,255,.7)",
  color: "#fff",
};
const rowStyle: CSSProperties = { display: "flex", gap: 4, flexWrap: "wrap" };
const sliderRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px 1fr 44px",
  alignItems: "center",
  gap: 6,
};
const valueStyle: CSSProperties = { textAlign: "right", color: "#AFC0D8", fontSize: 11 };
const noteStyle: CSSProperties = { color: "#AFC0D8", fontSize: 11 };

const container = document.getElementById("root");
if (container) createRoot(container).render(<GaitStage />);
