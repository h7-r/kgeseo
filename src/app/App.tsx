import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { PointerLockControls, Preload } from "@react-three/drei";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { Leva } from "leva";
import * as THREE from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { useCrashWatch } from "@/debug/crashLog";
import PerformanceMeter from "@/debug/PerformanceMeter";
import { DEFAULT_FOV } from "@/engine/camera";
import CameraFeel from "@/engine/cameraFeel/CameraFeel";
import { useSavedControls } from "@/engine/leva/savedControls";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import { MangaEffect } from "@/engine/manga/mangaEffect";
import { useMangaStyle } from "@/engine/manga/useMangaStyle";
import {
  FovCap,
  FpsBadge,
  MobileGate,
  PauseClockGuard,
  SHOW_FPS,
  TouchHud,
  TouchLook,
  useGameFrozen,
  useTouchMode,
} from "@/engine/input";
import { IS_LOW_QUALITY, IS_MOBILE_QUALITY, MOBILE_MAX_DPR } from "@/engine/quality";
import { PLAYER_MESHY_APPEARANCE_KEY, PLAYER_SIDEKICK_APPEARANCE_KEY } from "@/engine/storage";
import { SettingsIcon } from "@/game/gameIcons";
import HintHud from "@/game/HintHud";
import HintPanel from "@/game/HintPanel";
import { useDevInventorySeed } from "@/game/inventory";
import InventoryPanel from "@/game/InventoryPanel";
import { OVERLAY_LAYERS } from "@/game/overlayLayer";
import AimTracker from "@/lobby/AimTracker";
import { LobbyChibiPanel, LobbySidekickPanel } from "@/naju";
import MainGameSaveBridge from "@/save/MainGameSaveBridge";
import { savedStationPose } from "@/save/mainGameSave";
import { onEnteredHeadquarters, useIsCutscenePlaying } from "@/props/vendingPushState";
import SettingsPanel from "@/settings/SettingsPanel";
import { RESOLUTION_DPR, useSettings, type Settings } from "@/settings/settings";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import NajuEntryTransition from "@/station/NajuEntryTransition";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";
import StationScene from "@/station/StationScene";
import DestinationWindow from "@/trainInterior/DestinationWindow";
import TrainInteriorScene from "@/trainInterior/TrainInteriorScene";
import DispatchCard from "@/tutorial/DispatchCard";
import TutorialPanel from "@/tutorial/TutorialPanel";

import CrashOverlays from "./overlays/CrashOverlays";
import { ActionHint, Crosshair, FadeCurtain, LockDialPanel, TopBarButton } from "./overlays/Hud";
import MangaScene from "./MangaScene";
import { createPlayerState, usePunch } from "./playerState";
import { useLockControlMode, useOverlayWindows } from "./pointerLock";
import {
  IS_INPUT_ALWAYS_ON,
  IS_MANGA_STYLE,
  IS_POSTFX_DISABLED,
  IS_POSTFX_HIGH_QUALITY,
  SHOW_CUSTOMIZE_PANEL,
  SHOW_DEV_TOOLS,
  SHOW_LEVA,
  USES_CHIBI_RUNTIME,
  useIsMobile,
} from "./runtimeFlags";
import { useGameKeys } from "./useGameKeys";
import { useLobbyAvatar, type LobbyAvatarState } from "./useLobbyAvatar";
import { TRAIN_PATH, useSceneTransition } from "./useSceneTransition";

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
  position: [-25.5, EYE_HEIGHT, -49] as THREE.Vector3Tuple,
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
  if (IS_LOW_QUALITY) return 1;
  // 모바일은 기기 배율이 3 이라 [1, 1.5] 면 늘 1.5 — 픽셀이 배율의 제곱으로 는다
  return IS_MOBILE_QUALITY ? [1, MOBILE_MAX_DPR] : [1, 1.5];
}

// ?dev 일 때만 그리므로 평소엔 받지도 않는다.
const BackendStatus = lazy(() => import("@/server/BackendStatus"));
const GoogleSignIn = lazy(() => import("@/server/GoogleSignIn"));
const PlaySessionStatusPanel = lazy(() => import("@/server/PlaySessionStatusPanel"));

/** ?dev 로만 여는 개발 도구 — Backend·DB 준비 상태, 시연용 Google 로그인, 플레이 세션 상태 */
function DevTools() {
  return (
    <Suspense fallback={null}>
      <BackendStatus />
      <GoogleSignIn />
      <PlaySessionStatusPanel />
    </Suspense>
  );
}

/** 캐릭터 꾸미기 패널(왼쪽). 런타임에 맞는 하나만 띄운다. */
function CustomizePanels({ avatar }: { avatar: LobbyAvatarState }) {
  return (
    <Suspense fallback={null}>
      {USES_CHIBI_RUNTIME ? (
        <LobbyChibiPanel
          config={avatar.chibiConfig}
          setConfig={avatar.setChibiConfig}
          storageKey={PLAYER_MESHY_APPEARANCE_KEY}
          toonConfig={avatar.toonConfig}
          setToonConfig={avatar.setToonConfig}
          outlineConfig={avatar.outlineConfig}
          setOutlineConfig={avatar.setOutlineConfig}
        />
      ) : (
        <LobbySidekickPanel
          config={avatar.sidekickConfig}
          setConfig={avatar.setSidekickConfig}
          storageKey={PLAYER_SIDEKICK_APPEARANCE_KEY}
          side="left"
          topOffset={14}
        />
      )}
    </Suspense>
  );
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

  // 이어 하기면 나갔던 자리에서 시작한다. Canvas 는 처음 한 번만 읽는다.
  const [initialCamera] = useState(() => {
    const pose = savedStationPose();
    return pose ? { ...CAMERA, position: pose.position } : CAMERA;
  });
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
  // 본부실에 처음 들어서는 순간만 3인칭으로 맞춘다. 그 뒤로는 사용자가 고른 시점을 건드리지 않는다
  useEffect(() => onEnteredHeadquarters(() => setIsThirdPerson(true)), []);
  const avatar = useLobbyAvatar();
  const isMobile = useIsMobile();
  const isTouch = useTouchMode();
  // 터치 모드에서 멈춤 · 창이면 렌더 루프까지 세운다(11/7 미르 결정 5 「전부 멈춤」)
  const isFrozen = useGameFrozen();
  const playerRef = useRef(createPlayerState());

  // 계기판은 개발용이라 기본 꺼짐. Scene 안 Leva 값은 껍데기에서 못 읽어 여기서 따로 만든다.
  const { showMeter } = useSavedControls("성능(공통)", {
    showMeter: { value: false, label: "계기판" },
  });
  const manga = useMangaStyle(IS_MANGA_STYLE);

  const [near, setNear] = useState<NearTarget>(NEAR_TARGET.none);
  const { isGpuLost, isSceneEmptied, handleCanvasCreated } = useCrashWatch();
  const { fade, boardTrain, leaveTrain } = useSceneTransition(isTrain, near);
  const { openLayer, openWindow, closeWindow } = useOverlayWindows(controlsRef);
  const settings = useSettings();
  const lockControl = useLockControlMode();
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
  const isCutscenePlaying = useIsCutscenePlaying();
  const active = (isPointerLocked || IS_INPUT_ALWAYS_ON) && !openLayer && !lockControl && !isCutscenePlaying;

  const toggleSettings = () =>
    openLayer === OVERLAY_LAYERS.settings ? closeWindow() : openWindow(OVERLAY_LAYERS.settings);

  return (
    <div className="game-stage" style={{ position: "relative" }}>
      <Leva hidden={!SHOW_LEVA || isMobile} theme={LEVA_THEME} />
      <Canvas
        frameloop={isEnteringNaju || isFrozen ? "never" : "always"}
        // 그림자는 씬을 광원 시점에서 한 번 더 그린다. 끄면 드로우콜이 거의 절반 — 저사양에서 가장 큰 절약.
        shadows={IS_LOW_QUALITY || IS_MOBILE_QUALITY ? false : "percentage"}
        dpr={canvasDpr(settings)}
        // 밝기 100% 면 필터를 아예 안 건다(합성 비용 0)
        style={settings.brightness !== 1 ? { filter: `brightness(${settings.brightness})` } : undefined}
        gl={GL_OPTIONS}
        onCreated={handleCanvasCreated}
        camera={initialCamera}
      >
        {/* 계기판·셰이더 미리 컴파일은 씬이 바뀌어도 살아 있어야 해 껍데기 쪽에 둔다 */}
        <Preload all />
        <PerformanceMeter visible={showMeter} />
        <PauseClockGuard />
        <TouchLook controlsRef={controlsRef} />
        <FovCap />

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
        <MainGameSaveBridge isTrain={isTrain} playerRef={playerRef} />
        {/* 만화 화풍 — 칠한 툰 재질·펜선 하나로(재질), 걸음 출렁임·충격 흔들림(그리는 순간에만 비튼다, 기차 안은 늘 1인칭) */}
        {manga && <MangaScene manga={manga} />}
        {manga && <CameraFeel firstPerson={isTrain || !isThirdPerson} />}

        {/* 블룸·비네트는 두 씬에 똑같이 걸려야 같은 게임으로 보인다. MSAA 2 · 8비트 — 기본값이면 렌더타깃이 460MB 를 넘어 내장 GPU 가 죽는다. */}
        {!IS_POSTFX_DISABLED && (
          <EffectComposer
            autoClear={false}
            multisampling={IS_LOW_QUALITY || IS_MOBILE_QUALITY ? 0 : IS_POSTFX_HIGH_QUALITY ? 8 : 2}
            // 반정밀도(HalfFloat) 버퍼에서는 야외 씬이 통째로 까맣게 나온다(ANGLE Metal). 바이트로 못 박는다.
            frameBufferType={THREE.UnsignedByteType}
          >
            {/* 만화 v3 — 깊이 선·색 보정. 블룸이 선까지 번지지 않게 먼저 둔다 */}
            {manga && <MangaEffect {...manga.effect} />}
            {!IS_MOBILE_QUALITY && <Bloom intensity={0.45} luminanceThreshold={0.85} mipmapBlur />}
            <Vignette offset={0.36} darkness={0.28} />
            {/* 깊이로 그은 펜선과 실루엣은 MSAA 2 로는 계단이 남는다 — 마지막에 SMAA 로 편다 */}
            <SMAA />
          </EffectComposer>
        )}

        {/* 껍데기에 있어야 씬이 바뀌어도 잠금이 안 풀린다. 없는 selector — 클릭으로는 안 잠기고 T 로만 잠근다. */}
        <PointerLockControls
          ref={controlsRef}
          // 자물쇠·컷신 동안은 잠금을 유지한 채 고개만 멈춘다. 커서가 튀어나오지 않는다.
          pointerSpeed={lockControl || isCutscenePlaying ? 0 : settings.sensitivity}
          selector="#__never__"
          onLock={() => setIsPointerLocked(true)}
          onUnlock={() => setIsPointerLocked(false)}
        />
      </Canvas>

      <FadeCurtain opacity={fade} />
      <NajuEntryTransition />
      {(isPointerLocked || IS_INPUT_ALWAYS_ON) && !openLayer && <Crosshair />}
      {/* 터치 모드에서는 조작 화면(TouchHud)의 단추가 대신한다 */}
      {!isTouch && (
        <TopBarButton right={112} onClick={toggleSettings} ariaLabel="설정 열기">
          <SettingsIcon /> 설정 [P]
        </TopBarButton>
      )}
      <SettingsPanel open={openLayer === OVERLAY_LAYERS.settings} onClose={closeWindow} />
      {!isTrain && !isTouch && (
        <TopBarButton right={16} onClick={toggleThirdPerson}>
          [V] {isThirdPerson ? "1인칭" : "3인칭"}
        </TopBarButton>
      )}
      {SHOW_CUSTOMIZE_PANEL && !isTrain && <CustomizePanels avatar={avatar} />}
      {active && <ActionHint near={near} />}
      <LockDialPanel covered={openLayer !== null} />
      {/* 화면층이 지금 열린 창을 하나로 정하므로 두 창이 겹칠 수 없다 */}
      <InventoryPanel open={openLayer === OVERLAY_LAYERS.inventory} onClose={closeWindow} />
      <HintPanel open={openLayer === OVERLAY_LAYERS.hint} onClose={closeWindow} />
      <DestinationWindow open={openLayer === OVERLAY_LAYERS.destination} onClose={closeWindow} />
      {/* 창이 떠도 숨기지 않는다 — 반짝임을 봐야 한다 */}
      <HintHud isPanelOpen={openLayer !== null} />
      <TutorialPanel covered={openLayer !== null || isTrain} />
      <DispatchCard covered={openLayer !== null} isInTrain={isTrain} />
      {SHOW_DEV_TOOLS && <DevTools />}
      <TouchHud
        // 자물쇠 중에는 그 자리를 다이얼이 쓴다(앉기 · 점프 · ✋ 는 자물쇠에서 하는 일이 없다)
        hideActions={lockControl !== null}
        extraTopButtons={
          isTrain ? [] : [{ code: "KeyV", label: "시점", ariaLabel: isThirdPerson ? "1인칭으로" : "3인칭으로" }]
        }
      />
      <MobileGate controlsRef={controlsRef} isWindowOpen={openLayer !== null} />
      {SHOW_FPS && <FpsBadge />}
      <CrashOverlays isGpuLost={isGpuLost} isSceneEmptied={isSceneEmptied} />
    </div>
  );
}
