import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  setDesktopPauses,
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
import { showToast } from "@/game/toast";
import { setThirdPersonView } from "@/game/viewMode";
import { isThirdPersonLocked, THIRD_PERSON_LOCKED_MESSAGE } from "@/game/viewRule";
import ValveHelpWatcher from "@/game/ValveHelpWatcher";
import ValveNudgeWatcher from "@/game/ValveNudgeWatcher";
import { useHintOffering } from "@/game/valveHelp";
import AimTracker from "@/lobby/AimTracker";
import { LobbyChibiPanel, LobbySidekickPanel, najuCaseProgress } from "@/naju";
import MainGameSaveBridge from "@/save/MainGameSaveBridge";
import { getSavedStage, readSavedSection } from "@/save/gameSave";
import { LOBBY_SPOT, clearLobbyReturn, peekLobbyReturn, wantsLobbyEntry, withoutLobbyEntry } from "@/save/lobbyEntry";
import { savedStationPose } from "@/save/mainGameSave";
import { isInsideHeadquarters } from "@/save/resumePolicy";
import {
  hasEnteredHeadquarters,
  markEnteredHeadquarters,
  onEnteredHeadquarters,
  sealHeadquartersDoor,
  useIsCutscenePlaying,
} from "@/props/vendingPushState";
import SettingsPanel from "@/settings/SettingsPanel";
import { RESOLUTION_DPR, useSettings, type Settings } from "@/settings/settings";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import NajuEntryTransition from "@/station/NajuEntryTransition";
import { NAJU_ENTER_EVENT } from "@/station/najuEnter";
import StationScene from "@/station/StationScene";
import DestinationWindow from "@/trainInterior/DestinationWindow";
import TrainInteriorScene from "@/trainInterior/TrainInteriorScene";
import DispatchCard from "@/tutorial/DispatchCard";
import { skipDispatch, useDispatchState } from "@/tutorial/dispatchState";
import { TUTORIAL_STEPS, restoreTutorial, tutorialStore } from "@/tutorial/tutorialState";
import TutorialPanel from "@/tutorial/TutorialPanel";
import TutorialRestartNotice from "@/tutorial/TutorialRestartNotice";

import CrashOverlays from "./overlays/CrashOverlays";
import {
  ActionHint,
  Crosshair,
  FadeCurtain,
  HintOfferCard,
  LockDialPanel,
  ReturnPrompt,
  Toast,
  TopBarButton,
} from "./overlays/Hud";
import { bindPointerResume, usePointerResumeState } from "./pointerResume";
import { useIsTypingFocused } from "./useIsTypingFocused";
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
  // 모바일은 기기 배율이 3 이라 상한값이 곧 배율이다 — 픽셀이 배율의 제곱으로 는다. PC 상한(1.5)은 넘지 않는다
  return IS_MOBILE_QUALITY ? [1, Math.min(MOBILE_MAX_DPR, 1.5)] : [1, 1.5];
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
  const navigate = useNavigate();

  // 기차 씬은 처음 탈 때 만들고 그 뒤로 버리지 않는다(첫 로딩 3초 · CMN-026).
  // useLayoutEffect 로 바꾸면 안 된다 — 같은 커밋에서 역의 배경·안개가 떨어지며 방금 붙은 기차 안개를 지운다.
  const [isTrainMounted, setIsTrainMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 커밋을 나눠야 위 안개 문제가 없다
    if (isTrain) setIsTrainMounted(true);
  }, [isTrain]);

  // 다시 접속 · 나주에서 「로비로 나가기」면 로비(본부실) 자리에서, 아니면 나갔던 자리에서 시작한다. Canvas 는 처음 한 번만 읽는다.
  // 로비 표시(?entry=lobby)는 저장 단계가 본부실 뒤일 때만 받는다 — 튜토리얼 중인 사람에게 주소만으로 본부실을 열지 않게
  // 로그인하지 않은 사람은 저장 단계가 없다 — 나주에서 방금 나온 탭이면(peekLobbyReturn) 받는다
  const [isLobbyEntry] = useState(
    () => !isTrain && wantsLobbyEntry(window.location.search, getSavedStage(), peekLobbyReturn()),
  );
  // 튜토리얼 중(본부실 전)에는 저장 자리를 쓰지 않는다 — 처음부터 다시(save/resumeStart 가 그 칸을 넣지 않는다)
  // 본부실에 들어선 뒤인데 저장 자리가 본부실 밖(잠긴 비밀 복도)이거나 없으면 로비 자리에서
  const [initialCamera] = useState(() => {
    const pose = savedStationPose();
    if (isLobbyEntry || (hasEnteredHeadquarters() && !isInsideHeadquarters(pose)))
      return {
        ...CAMERA,
        position: [LOBBY_SPOT.x, EYE_HEIGHT, LOBBY_SPOT.z] as THREE.Vector3Tuple,
        rotation: [0, LOBBY_SPOT.yaw, 0] as THREE.Vector3Tuple,
      };
    return pose ? { ...CAMERA, position: pose.position } : CAMERA;
  });
  // 로비로 들어왔다 — 본부실 진입은 저장되지 않고 문 연출 안에서만 다시 적혀(밸브 · 회로가 준비돼야) 새 페이지에서는 단계가
  // 튜토리얼로 돌아갈 수 있다. 여기서 바로 적고, 주소의 표시는 지운다(새로고침하면 그때 저장된 자리로 잇는다)
  // 나주를 시작한 적이 있으면 본부실의 「긴급 호출 · 즉시 출동」 카드는 다시 띄우지 않는다(이미 출동했다)
  useEffect(() => {
    if (najuCaseProgress((name) => readSavedSection(name))) skipDispatch();
  }, []);
  useLayoutEffect(() => {
    if (!isLobbyEntry) return;
    // 나주에서 방금 나왔다(로그인하지 않아 진행 저장이 없어도) — 이미 출동했으니 「긴급 호출」을 다시 띄우지 않는다
    if (peekLobbyReturn()) skipDispatch();
    clearLobbyReturn();
    // 로그인하지 않은 사람은 튜토리얼 저장이 없다 — 나주까지 다녀왔으면 마친 것이다(본부실에서 튜토리얼이 처음부터 뜨지 않게)
    if (!tutorialStore.get().isFinished) restoreTutorial({ step: TUTORIAL_STEPS.length - 1, isFinished: true });
    markEnteredHeadquarters();
    sealHeadquartersDoor();
    navigate(withoutLobbyEntry(window.location.href), { replace: true });
  }, [isLobbyEntry, navigate]);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  /** 한 번이라도 [T] 로 들어왔나 — 처음엔 튜토리얼 첫 단계가 「T 조작 시작」을 알려 주므로 게임 밖 안내를 띄우지 않는다 */
  const [hasLockedOnce, setHasLockedOnce] = useState(false);
  // 나주 진입 연출 중엔 렌더를 멈춘다. 암전에 가려 안 보이고, 메인 스레드가 연출에 집중해 매끄럽다.
  const [isEnteringNaju, setIsEnteringNaju] = useState(false);
  useEffect(() => {
    const handleEnter = () => setIsEnteringNaju(true);
    window.addEventListener(NAJU_ENTER_EVENT, handleEnter);
    return () => window.removeEventListener(NAJU_ENTER_EVENT, handleEnter);
  }, []);

  const [isThirdPerson, setIsThirdPerson] = useState(true);
  // V · 위 단추 · 터치 「시점」이 모두 이 한 곳을 지난다. 비밀 복도에서 튜토 「시점 바꾸기」를 지났으면 3인칭으로는 못 간다(viewRule)
  const toggleThirdPerson = useCallback(() => {
    if (!isThirdPerson && isThirdPersonLocked()) {
      showToast(THIRD_PERSON_LOCKED_MESSAGE);
      return;
    }
    setIsThirdPerson(!isThirdPerson);
  }, [isThirdPerson]);
  useEffect(() => setThirdPersonView(isThirdPerson), [isThirdPerson]);
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
  // 자물쇠 · 창을 ESC 로 닫고 게임으로 돌아가는 중(크롬이 잠시 잠금을 거절하는 동안)도 조작 중이다 — 화면은 이미 게임이고
  // 키로 걷는다. 마우스 시점만 잠긴 뒤부터(pointerResume, 12회차)
  const resumeState = usePointerResumeState();
  const isResuming = resumeState !== "idle";
  useEffect(() => bindPointerResume(() => controlsRef.current), []);
  const active =
    (isPointerLocked || isResuming || IS_INPUT_ALWAYS_ON) && !openLayer && !lockControl && !isCutscenePlaying;
  // 역 씬에는 값 대신 읽는 함수를 넘긴다 — 켜고 끌 때마다 역 전체가 다시 그려지지 않게(StationScene 은 memo, 10회차).
  // 이동은 useFrame 에서만 이 값을 본다. 겨냥(AimTracker) · HUD 는 그대로 값으로 받는다.
  const isStationActive = active && !isTrain;
  const stationActiveRef = useRef(isStationActive);
  useLayoutEffect(() => {
    stationActiveRef.current = isStationActive;
  }, [isStationActive]);
  const readStationActive = useCallback(() => stationActiveRef.current, []);
  // 게임 밖(잠금 풀림)이면 [T] 안내 — ESC 두 번 · 다시 잠그기 거절 뒤(12회차). 창 · 자물쇠 · 연출 · 입력칸 · 긴급 호출 카드 · 장면 전환
  // · 나주 진입 중에는 그쪽이 화면을 쓰고 잠금이 일부러 풀려 있으니 띄우지 않는다. 터치는 가상 잠금이라 해당 없음
  const isTyping = useIsTypingFocused();
  const isDispatchAlert = useDispatchState().phase === "alert";
  const canShowReturnPrompt =
    !isTouch &&
    !IS_INPUT_ALWAYS_ON &&
    hasLockedOnce &&
    !isPointerLocked &&
    !openLayer &&
    !lockControl &&
    !isCutscenePlaying &&
    !isTyping &&
    !isDispatchAlert &&
    !isEnteringNaju &&
    fade === 0;
  // 밖이면 「[T] 로 돌아간다」, 돌아가려는데 브라우저가 저절로는 못 잠그면 「클릭하거나 아무 키나」. 잠시 기다리는 동안(pending)은 아무것도
  const returnPromptMode = !canShowReturnPrompt
    ? null
    : resumeState === "idle"
      ? "out"
      : resumeState === "waiting"
        ? "waiting"
        : null;
  // PC 일시정지 — 쉬는 창(설정 · 소지품 · 힌트함 · 수첩)이 열렸거나 게임 밖([T] 안내)이면 게임 시간 · 렌더 · 소리를 세운다
  // (미르 11/10, 터치의 「전부 멈춤」과 같다). 자물쇠 · 돌아가기 기다림(키로는 걷는다) · 컷신은 게임 안이라 세우지 않는다.
  // 기차의 목적지 창과 기차 안의 「게임 밖」은 세우지 않는다 — 기차는 마우스를 풀어 홀로그램을 겨눠 누르고(겨냥은 매 프레임 판정),
  // 목적지 창은 고르는 소리 · 영상이 있는 길 고르기 화면이다(Codex 리뷰). 처음 [T] 전에는 장면을 그려 둬야 해 세우지 않는다
  // 연출(전기 흐름 · 자판기 밀림) 중에는 창 · ESC 로 세우지 않는다 — 번개 · 카메라 · 자판기가 실제 시계(performance.now)로 맞물려 돌아
  // 멈췄다 풀면 연출이 건너뛰어졌다(Codex 리뷰). 연출 중엔 조작이 꺼져 있어 안 세워도 놓치는 것이 없다
  const isDesktopWindowPause =
    !isTouch && hasLockedOnce && openLayer !== null && openLayer !== "destination" && !isCutscenePlaying;
  const isDesktopOutPause = returnPromptMode === "out" && !isTrain && !isCutscenePlaying;
  // 두 까닭은 함께 알린다 — 하나씩 바꾸면 「창」→「게임 밖」 사이에 잠깐 풀린다(Codex 리뷰)
  useEffect(
    () => setDesktopPauses({ window: isDesktopWindowPause, out: isDesktopOutPause }),
    [isDesktopWindowPause, isDesktopOutPause],
  );
  useEffect(() => () => setDesktopPauses({ window: false, out: false }), []);
  // 커서 숨기기 — 게임으로 돌아가는 중 · 자물쇠를 만지는 동안(페이지가 잠금을 풀어 두었다). 추가 힌트 묻기 · 창이 뜨면 보인다
  const isOffering = useHintOffering();
  const isCursorHidden =
    !isTouch && !isPointerLocked && !openLayer && (isResuming || (lockControl?.phase === "active" && !isOffering));
  useEffect(() => {
    document.documentElement.classList.toggle("game-cursor-hidden", isCursorHidden);
    return () => document.documentElement.classList.remove("game-cursor-hidden");
  }, [isCursorHidden]);
  // 3인칭인 채로 비밀 복도(튜토 공간)에 있으면 1인칭으로 돌린다 — 본부실에서 복도로 걸어 들어온 때도. 기차 · 컷신 중엔 건드리지 않는다
  useEffect(() => {
    if (isTrain || !isThirdPerson || isCutscenePlaying) return;
    const id = window.setInterval(() => {
      if (isThirdPersonLocked()) setIsThirdPerson(false);
    }, 300);
    return () => window.clearInterval(id);
  }, [isTrain, isThirdPerson, isCutscenePlaying]);

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
          active={readStationActive}
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
          onLock={() => {
            setIsPointerLocked(true);
            setHasLockedOnce(true);
          }}
          onUnlock={() => setIsPointerLocked(false)}
        />
      </Canvas>

      <FadeCurtain opacity={fade} />
      <NajuEntryTransition />
      {(isPointerLocked || isResuming || IS_INPUT_ALWAYS_ON) && !openLayer && <Crosshair />}
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
      <Toast raised={lockControl !== null} />
      <TutorialRestartNotice />
      <LockDialPanel covered={openLayer !== null} />
      <HintOfferCard covered={openLayer !== null} roamVisible={isStationActive} />
      <ValveHelpWatcher covered={openLayer !== null} roamActive={isStationActive} />
      {/* 밸브에 전기가 닿은 뒤 30초 헤매면 「밸브로 돌아가자」(미르 11/10) */}
      <ValveNudgeWatcher roamActive={isStationActive} />
      {returnPromptMode && <ReturnPrompt mode={returnPromptMode} />}
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
