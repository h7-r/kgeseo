/**
 * NAJU-01 그레이박스 껍데기. 본편 껍데기와 같은 구성(Leva · Canvas · T 키로 시작)이고,
 * 씬이 하나뿐이라 라우터가 없고 계기판이 그레이박스 전용이다.
 */
import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Leva } from "leva";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import ChibiTestPanel from "../avatar/ChibiTestPanel";
import SidekickCustomizerPanel from "../avatar/SidekickCustomizerPanel";
import { readMeshAppearance, type MeshAppearanceConfig } from "../avatar/meshAppearance";
import { readSidekickAppearance } from "../avatar/sidekickOptions";
import { DEFAULT_TOON, type ToonConfig } from "../avatar/toonMaterial";
import { DEFAULT_OUTLINE } from "../avatar/toonOutline";
import { BASELINE, UNITS_PER_METER, VIEWPOINTS } from "../plan/sitePlan";
import NajuScene, { type NajuSceneReport } from "../scene/NajuScene";
import { DEFAULT_TERRAIN } from "../terrain/terrain";
import { ArrivalCover, FirstFrameSignal } from "../transition/ArrivalFade";
import { useArrivalFade } from "../transition/useArrivalFade";
import ControlsHelp from "./ControlsHelp";
import Dashboard from "./Dashboard";
import {
  IS_ARRIVING_FROM_HUB,
  IS_BLOOM_DISABLED,
  IS_DPR_AUTO,
  IS_LOW_QUALITY,
  IS_OUTLINE_DISABLED,
  IS_POSTFX_DISABLED,
  IS_STAGE_16X9,
  IS_TONE_MAPPING_ENABLED,
  IS_TOON_DISABLED,
  IS_VIGNETTE_DISABLED,
  IS_WORLD_TOON_DISABLED,
  LEGACY_SIDEKICK_APPEARANCE_KEY,
  MAX_DPR,
  MESH_APPEARANCE_KEY,
  MIN_DPR,
  SHOW_CUSTOMIZE_PANEL,
  SHOW_DEV_TOOLS,
  SHOW_LEVA,
  SIDEKICK_APPEARANCE_KEY,
  USE_HALF_FLOAT_BUFFER,
  USE_SIDEKICK_AVATAR,
} from "./runtimeFlags";

/** 나주 App 만 세계 툰 스위치(world)를 더 들고 다닌다 */
export type NajuToonConfig = ToonConfig & { world?: boolean };

type ViewMode = "1인칭" | "3인칭";

// 시작 카메라 — V1 자리. Leva 저장값이 다르면 첫 프레임에 씬이 다시 앉힌다.
const START = VIEWPOINTS[0];
const START_HEIGHT = (DEFAULT_TERRAIN.groundAt(START.x, START.z).y + BASELINE.eyeHeight) * UNITS_PER_METER;

const toggleViewMode = (mode: ViewMode): ViewMode => (mode === "1인칭" ? "3인칭" : "1인칭");

export default function App() {
  // 동적 해상도 — dpr 을 못 박으면 가장 나쁜 자리(Z1 마을)에 맞춰야 해서 한가한 곳의 성능을 버린다.
  // 배율이 바뀌면 프레임버퍼를 다시 잡으므로 0.25 눈금으로만 움직인다.
  const [dpr, setDpr] = useState(IS_DPR_AUTO ? 1.25 : MAX_DPR);

  const controlsRef = useRef<PointerLockControlsImpl>(null);
  const reportRef = useRef<NajuSceneReport | null>(null); // 씬 → 계기판(리렌더 없이)
  const [locked, setLocked] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("1인칭");
  const [sidekickConfig, setSidekickConfig] = useState(() =>
    readSidekickAppearance(SIDEKICK_APPEARANCE_KEY, LEGACY_SIDEKICK_APPEARANCE_KEY),
  );
  const [meshConfig, setMeshConfig] = useState<MeshAppearanceConfig | null>(() =>
    USE_SIDEKICK_AVATAR ? null : readMeshAppearance(MESH_APPEARANCE_KEY),
  );
  const [toonConfig, setToonConfig] = useState<NajuToonConfig>(() => ({
    ...DEFAULT_TOON,
    enabled: !IS_TOON_DISABLED,
    world: !IS_WORLD_TOON_DISABLED,
  }));
  const [outlineConfig, setOutlineConfig] = useState(() => ({ ...DEFAULT_OUTLINE, enabled: !IS_OUTLINE_DISABLED }));
  // 패널은 meshConfig 가 있을 때만 뜬다 — null 을 뺀 설정 함수로 넘긴다
  const setPanelMeshConfig: Dispatch<SetStateAction<MeshAppearanceConfig>> = (action) =>
    setMeshConfig((previous) => (typeof action === "function" ? previous && action(previous) : action));
  // 계기판·조작 안내는 화면을 꽤 가려서 그림을 볼 때는 H 로 치운다
  const [isDashboardVisible, setIsDashboardVisible] = useState(SHOW_DEV_TOOLS);
  // 첫 프레임이 그려지면 검은 덮개가 걷힌다
  const [isArrivalRevealed, revealArrival] = useArrivalFade(IS_ARRIVING_FROM_HUB);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyT" && !locked) controlsRef.current?.lock();
      if (SHOW_DEV_TOOLS && event.code === "KeyH" && !event.repeat) setIsDashboardVisible((visible) => !visible);
      // 시점 전환은 카메라 회전을 만지지 않고 캐릭터 표시만 바꾼다.
      // 수식키가 눌린 V 는 편집기의 붙여넣기(⌘V/Ctrl+V)다.
      if (event.code === "KeyV" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
        setViewMode(toggleViewMode);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [locked]);

  return (
    <div className={`stage${IS_STAGE_16X9 ? " stage-16x9" : ""}`} style={{ position: "relative" }}>
      <Leva hidden={!SHOW_LEVA} theme={{ sizes: { numberInputMinWidth: "68px" } }} />
      <Canvas
        shadows={IS_LOW_QUALITY ? false : "percentage"}
        // [1, 상한] 배열을 주면 three 가 기기 픽셀비로 골라 PerformanceMonitor 가 정한 값이 묻힌다
        dpr={IS_LOW_QUALITY ? 1 : dpr}
        gl={{
          antialias: !IS_LOW_QUALITY && IS_POSTFX_DISABLED,
          toneMappingExposure: 1.15,
          // 900 m 밖 산줄기까지 그리려고 far 를 키우면 가까운 면의 깊이 정밀도가 무너진다
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
        }}
        // 야외라 건너편 뱃길 너머 산줄기까지 이어져야 한다. 900 m ≈ 3000 유닛.
        camera={{
          position: [START.x * UNITS_PER_METER, START_HEIGHT, START.z * UNITS_PER_METER],
          fov: BASELINE.fov,
          near: 0.3,
          far: 4000,
        }}
      >
        <Preload all />
        {/* factor 0(느림)~1(빠름). bounds 를 벌려 둬야 올림·내림이 번갈아 흔들리지 않고,
            flipflops 세 번이면 그 자리에 머문다(발표 중 화면이 오르내리지 않게). */}
        {IS_DPR_AUTO && (
          <PerformanceMonitor
            bounds={() => [50, 58]}
            flipflops={3}
            onChange={({ factor }) => {
              const next = Math.round((MIN_DPR + (MAX_DPR - MIN_DPR) * factor) * 4) / 4;
              setDpr((previous) => (previous === next ? previous : next));
            }}
          />
        )}
        {IS_ARRIVING_FROM_HUB && <FirstFrameSignal onFirstFrame={revealArrival} />}
        <NajuScene
          active={locked}
          controlsRef={controlsRef}
          onLockChange={setLocked}
          reportRef={reportRef}
          isThirdPerson={viewMode === "3인칭"}
          sidekickConfig={sidekickConfig}
          meshConfig={meshConfig}
          toonConfig={toonConfig}
          outlineConfig={outlineConfig}
        />
        {/* frameBufferType 을 꼭 준다 — 기본 HalfFloat 이면 이 씬의 3D 가 통째로 까맣다(Apple M5 Max · ANGLE Metal 실측).
            Bloom 탓으로 보였지만 버퍼 탓이었다. ?fb=half 로 재현한다. */}
        {!IS_LOW_QUALITY && !IS_POSTFX_DISABLED && (
          <EffectComposer
            multisampling={4}
            enableNormalPass={false}
            frameBufferType={USE_HALF_FLOAT_BUFFER ? THREE.HalfFloatType : THREE.UnsignedByteType}
          >
            {/* ACES 는 본편처럼 기본 끔. 어두움의 범인이 아니었고 화풍 선택지로만 남긴다(?tm=on). */}
            {IS_TONE_MAPPING_ENABLED && <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />}
            {!IS_BLOOM_DISABLED && <Bloom intensity={0.35} luminanceThreshold={0.9} mipmapBlur />}
            {/* 본편과 같은 값 */}
            {!IS_VIGNETTE_DISABLED && <Vignette eskil={false} offset={0.36} darkness={0.28} />}
          </EffectComposer>
        )}
      </Canvas>

      {IS_ARRIVING_FROM_HUB && <ArrivalCover revealed={isArrivalRevealed} />}
      {isDashboardVisible && <Dashboard reportRef={reportRef} />}
      {SHOW_DEV_TOOLS && !locked && <ControlsHelp />}
      {/* 다 숨겼을 때 되돌리는 법을 잊지 않게 작은 자국만 남긴다 */}
      {SHOW_DEV_TOOLS && !isDashboardVisible && <div style={hiddenHintStyle}>[H] 계기판</div>}
      <button type="button" onClick={() => setViewMode(toggleViewMode)} style={viewButtonStyle}>
        [V] {viewMode}
      </button>
      {SHOW_CUSTOMIZE_PANEL && meshConfig && (
        <ChibiTestPanel
          config={meshConfig}
          setConfig={setPanelMeshConfig}
          storageKey={MESH_APPEARANCE_KEY}
          toonConfig={toonConfig}
          setToonConfig={setToonConfig}
          outlineConfig={outlineConfig}
          setOutlineConfig={setOutlineConfig}
        />
      )}
      {SHOW_CUSTOMIZE_PANEL && !meshConfig && (
        <SidekickCustomizerPanel
          config={sidekickConfig}
          setConfig={setSidekickConfig}
          storageKey={SIDEKICK_APPEARANCE_KEY}
          legacyStorageKey={LEGACY_SIDEKICK_APPEARANCE_KEY}
        />
      )}
    </div>
  );
}

const hiddenHintStyle: CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  zIndex: 20,
  padding: "3px 8px",
  borderRadius: 6,
  background: "rgba(14,18,26,.45)",
  color: "#8B94A6",
  font: "11px/1.4 ui-monospace, Menlo, monospace",
  pointerEvents: "none",
};

const viewButtonStyle: CSSProperties = {
  position: "absolute",
  right: 14,
  top: 14,
  zIndex: 20,
  border: "1px solid rgba(170,190,220,.35)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "rgba(14,18,26,.72)",
  color: "#E8EFFA",
  font: "12px/1.2 ui-monospace, Menlo, monospace",
  cursor: "pointer",
};
