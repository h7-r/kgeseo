import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { PointerLockControls, Preload } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Leva } from "leva";
import * as THREE from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import {
  IS_INPUT_ALWAYS_ON,
  IS_POSTFX_DISABLED,
  IS_POSTFX_HIGH_QUALITY,
  SHOW_CUSTOMIZE_PANEL,
  SHOW_DEV_TOOLS,
  SHOW_LEVA,
  USES_CHIBI_RUNTIME,
  useIsMobile,
} from "@/app/runtimeFlags";
import PerformanceMeter from "@/debug/PerformanceMeter";
import { DEFAULT_FOV } from "@/engine/camera";
import { useSavedControls } from "@/engine/leva/savedControls";
import { EYE } from "@/engine/movement/constants";
import { IS_LOW_QUALITY } from "@/engine/quality";
import HintHud from "@/game/HintHud";
import HintPanel from "@/game/HintPanel";
import InventoryPanel from "@/game/InventoryPanel";
import { LAYERS } from "@/game/overlayLayer";
import AimTracker from "@/lobby/AimTracker";
import { useCutscene } from "@/props/vendingPush";
import SettingsPanel from "@/settings/SettingsPanel";
import { RESOLUTION_DPR, useSettings, type Settings } from "@/settings/settings";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import NajuEntryTransition from "@/station/NajuEntryTransition";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";
import StationScene from "@/station/StationScene";
import TrainInteriorScene from "@/trainInterior/TrainInteriorScene";
import DispatchCard from "@/tutorial/DispatchCard";
import TutorialPanel from "@/tutorial/TutorialPanel";
import TutorialDirectionHud from "@/tutorial/TutorialDirection";

import { useDevInventorySeed } from "./devInventorySeed";
import ActionHint from "./overlays/ActionHint";
import CrashOverlays from "./overlays/CrashOverlays";
import Crosshair from "./overlays/Crosshair";
import CustomizePanels from "./overlays/CustomizePanels";
import DevTools from "./overlays/DevTools";
import FadeCurtain from "./overlays/FadeCurtain";
import LockDialPanel from "./overlays/LockDialPanel";
import TopBarButton from "./overlays/TopBarButton";
import { createPlayerState } from "./playerState";
import { TRAIN_PATH } from "./routes";
import { useCrashWatch } from "./useCrashWatch";
import { useGameKeys } from "./useGameKeys";
import { useLobbyAvatar } from "./useLobbyAvatar";
import { useLockControlMode } from "./useLockControlMode";
import { useOverlayWindows } from "./useOverlayWindows";
import { usePunch } from "./usePunch";
import { useSceneTransition } from "./useSceneTransition";

// 기본값(38px)이면 '−12.3' 같은 값의 뒷자리가 잘려 캡처로 값을 옮길 때 소수점을 못 읽는다.
const LEVA_THEME = { sizes: { numberInputMinWidth: "68px" } };

const GL_OPTIONS = {
  // 후처리를 쓰면 그림은 컴포저 렌더타깃에 그려져 캔버스 MSAA 는 메모리(≈58MB)만 먹는다. 후처리를 끈 때만 켠다.
  antialias: !IS_LOW_QUALITY && IS_POSTFX_DISABLED,
  toneMappingExposure: 1.15,
  powerPreference: "high-performance",
} as const;

// 실제 시작 자리는 여기다(playerRef.position 은 이동이 매 프레임 덮어쓴다).
// 비밀 복도 끝 비상계단 철문 앞, 복도 안쪽(+z)을 본다. 철문(z −60)에서 11 떨어져야 3인칭 붐(9.33)이 다 펴진다.
// near/far 는 1:1600 — 제일 먼 판이 약 200 유닛이고 플레이어 반경 0.6 이라 0.25 로도 벽에서 안 잘린다.
const CAMERA = {
  position: [-25.5, EYE, -49] as THREE.Vector3Tuple,
  rotation: [0, Math.PI, 0] as THREE.Vector3Tuple,
  // 이동의 1인칭 시야각과 같은 상수 — 따로 적으면 1인칭으로 돌아갈 때마다 시야가 밀린다.
  fov: DEFAULT_FOV,
  near: 0.25,
  far: 400,
};

// dpr 2 면 그릴 픽셀이 4배다 — 내장 GPU 가 검게 죽는 원인 1순위.
// 「자동」은 저사양 1 · 아니면 1~1.5. 기기 픽셀보다 높게는 안 쓴다.
function canvasDpr({ resolution }: Settings): number | [number, number] {
  if (resolution !== "auto" && RESOLUTION_DPR[resolution]) {
    return Math.min(RESOLUTION_DPR[resolution], window.devicePixelRatio || 1);
  }
  return IS_LOW_QUALITY ? 1 : [1, 1.5];
}

/** 게임 껍데기 — Canvas 하나에 역·기차 씬을 함께 두고 주소로 보임만 바꾼다. 그 위에 화면 창과 안내를 얹는다. */
export default function App() {
  const controlsRef = useRef<PointerLockControlsImpl>(null);
  const isTrain = useLocation().pathname === TRAIN_PATH;

  // 기차 씬은 처음 탈 때 만들고 그 뒤로 버리지 않는다(첫 로딩 3초 · CMN-026).
  // useLayoutEffect 로 바꾸면 안 된다 — 같은 커밋에서 역의 배경·안개가 떨어지며 방금 붙은 기차 안개를 지운다.
  const [isTrainMounted, setIsTrainMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 커밋을 나눠야 위 안개 문제가 없다
    if (isTrain) setIsTrainMounted(true);
  }, [isTrain]);

  const [isPointerLocked, setIsPointerLocked] = useState(false);
  // 나주 진입 연출 중엔 렌더를 멈춘다. 암전에 가려 안 보이고, 메인 스레드가 연출에 집중해 매끄럽다.
  const [isEnteringNaju, setIsEnteringNaju] = useState(false);
  useEffect(() => {
    const handleEnter = () => setIsEnteringNaju(true);
    window.addEventListener(NAJU_ENTER_EVENT, handleEnter);
    return () => window.removeEventListener(NAJU_ENTER_EVENT, handleEnter);
  }, []);

  const [isThirdPerson, setIsThirdPerson] = useState(true);
  const toggleThirdPerson = useCallback(() => setIsThirdPerson((value) => !value), []);
  const avatar = useLobbyAvatar();
  const isMobile = useIsMobile();
  const playerRef = useRef(createPlayerState());

  // 계기판은 개발용이라 기본 꺼짐. Scene 안 Leva 값은 껍데기에서 못 읽어 여기서 따로 만든다.
  const { showMeter } = useSavedControls("성능(공통)", {
    showMeter: { value: false, label: "계기판" },
  });

  const [near, setNear] = useState<NearTarget>(NEAR_TARGET.none);
  const { isGpuLost, isSceneEmptied, handleCanvasCreated } = useCrashWatch();
  const { fade, boardTrain, leaveTrain } = useSceneTransition(isTrain, near);
  const { openLayer, openWindow, closeWindow } = useOverlayWindows(controlsRef);
  const settings = useSettings();
  const lockControl = useLockControlMode(controlsRef);
  useDevInventorySeed();

  useGameKeys({
    controlsRef,
    near,
    isPointerLocked,
    isTrain,
    openLayer,
    openWindow,
    closeWindow,
    lockControl,
    boardTrain,
    leaveTrain,
    toggleThirdPerson,
  });
  usePunch({
    playerRef,
    isPointerLocked,
    isThirdPerson,
    isTrain,
    isWindowOpen: openLayer !== null,
  });

  // 창·자물쇠·자판기 컷신 동안은 이동·조준을 멈춘다. 컷신이 카메라를 모는데 입력까지 들어오면 화면이 떤다.
  const isCutscenePlaying = useCutscene();
  const active = (isPointerLocked || IS_INPUT_ALWAYS_ON) && !openLayer && !lockControl && !isCutscenePlaying;

  const toggleSettings = () => (openLayer === LAYERS.settings ? closeWindow() : openWindow(LAYERS.settings));

  return (
    <div className="stage" style={{ position: "relative" }}>
      <Leva hidden={!SHOW_LEVA || isMobile} theme={LEVA_THEME} />
      <Canvas
        frameloop={isEnteringNaju ? "never" : "always"}
        // 그림자는 씬을 광원 시점에서 한 번 더 그린다. 끄면 드로우콜이 거의 절반 — 저사양에서 가장 큰 절약.
        shadows={IS_LOW_QUALITY ? false : "percentage"}
        dpr={canvasDpr(settings)}
        // 밝기 100% 면 필터를 아예 안 건다(합성 비용 0)
        style={settings.brightness !== 1 ? { filter: `brightness(${settings.brightness})` } : undefined}
        gl={GL_OPTIONS}
        onCreated={handleCanvasCreated}
        camera={CAMERA}
      >
        {/* 계기판·셰이더 미리 컴파일은 씬이 바뀌어도 살아 있어야 해 껍데기 쪽에 둔다 */}
        <Preload all />
        <PerformanceMeter visible={showMeter} />

        {/* 두 씬을 계속 마운트해 두고 보임만 바꾼다. 역(지오 1100여 개)을 다시 지으면 메인 스레드가 수백 ms 멈춘다. */}
        {isTrainMounted && <TrainInteriorScene active={active && isTrain} enabled={isTrain} onNear={setNear} />}
        <StationScene
          enabled={!isTrain}
          active={active && !isTrain}
          onNear={setNear}
          isThirdPerson={isThirdPerson}
          playerRef={playerRef}
          sidekickConfig={USES_CHIBI_RUNTIME ? undefined : avatar.sidekickConfig}
          chibiConfig={USES_CHIBI_RUNTIME ? avatar.chibiConfig : undefined}
          toonConfig={avatar.toonConfig}
          outlineConfig={avatar.outlineConfig}
        />
        <AimTracker enabled={active && !isTrain} />

        {/* 블룸·비네트는 두 씬에 똑같이 걸려야 같은 게임으로 보인다. MSAA 2 · 8비트 — 기본값이면 렌더타깃이 460MB 를 넘어 내장 GPU 가 죽는다. */}
        {!IS_POSTFX_DISABLED && (
          <EffectComposer
            autoClear={false}
            multisampling={IS_LOW_QUALITY ? 0 : IS_POSTFX_HIGH_QUALITY ? 8 : 2}
            // 반정밀도(HalfFloat) 버퍼에서는 야외 씬이 통째로 까맣게 나온다(ANGLE Metal 실측). 바이트로 못 박는다.
            frameBufferType={THREE.UnsignedByteType}
          >
            <Bloom intensity={0.45} luminanceThreshold={0.85} mipmapBlur />
            <Vignette offset={0.36} darkness={0.28} />
          </EffectComposer>
        )}

        {/* 껍데기에 있어야 씬이 바뀌어도 잠금이 안 풀린다. 없는 selector — 클릭으로는 안 잠기고 T 로만 잠근다. */}
        <PointerLockControls
          ref={controlsRef}
          pointerSpeed={settings.sensitivity}
          selector="#__never__"
          onLock={() => setIsPointerLocked(true)}
          onUnlock={() => setIsPointerLocked(false)}
        />
      </Canvas>

      <FadeCurtain opacity={fade} />
      <NajuEntryTransition />
      {active && <Crosshair />}
      <TopBarButton right={384} onClick={toggleSettings} ariaLabel="설정 열기">
        ⚙ 설정 [P]
      </TopBarButton>
      <SettingsPanel open={openLayer === LAYERS.settings} onClose={closeWindow} />
      {!isTrain && (
        <TopBarButton right={300} onClick={toggleThirdPerson}>
          [V] {isThirdPerson ? "1인칭" : "3인칭"}
        </TopBarButton>
      )}
      {SHOW_CUSTOMIZE_PANEL && !isTrain && <CustomizePanels avatar={avatar} />}
      {active && <ActionHint near={near} />}
      <LockDialPanel />
      {/* 화면층이 지금 열린 창을 하나로 정하므로 두 창이 겹칠 수 없다 */}
      <InventoryPanel open={openLayer === LAYERS.inventory} onClose={closeWindow} />
      <HintPanel open={openLayer === LAYERS.hint} onClose={closeWindow} />
      {/* 창이 떠도 숨기지 않는다 — 반짝임을 봐야 한다 */}
      <HintHud isPanelOpen={openLayer !== null} />
      <TutorialPanel covered={openLayer !== null || isTrain} />
      {!openLayer && !isTrain && <TutorialDirectionHud />}
      <DispatchCard covered={openLayer !== null} isInTrain={isTrain} />
      {SHOW_DEV_TOOLS && <DevTools />}
      <CrashOverlays isGpuLost={isGpuLost} isSceneEmptied={isSceneEmptied} />
    </div>
  );
}
