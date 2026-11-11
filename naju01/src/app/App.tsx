/**
 * NAJU-01 그레이박스 껍데기. 본편 껍데기와 같은 구성(Leva · Canvas · T 키로 시작)이고,
 * 씬이 하나뿐이라 라우터가 없다.
 * 순서: 동행 세션 열기(CDN 빌드면 최대 2.5초 기다림) → 에셋 받기(로딩 덮개) → 씬 한 번 세우기 → 몇 장 그린 뒤 덮개 걷기.
 * 걷힌 뒤에는 다시 세울 것이 없다.
 */
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Leva } from "leva";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import {
  FovCap,
  FpsBadge,
  isPointerActive,
  MobileGate,
  FrozenRedraw,
  PauseClockGuard,
  SHOW_FPS,
  TouchHud,
  setDesktopPauses,
  useGameFrozen,
  useTouchMode,
} from "@/engine/input";
import { IS_LOW_QUALITY, IS_MOBILE_QUALITY } from "@/engine/quality";
import { useHintBox } from "@/game/hintBox";
import { DEFAULT_SETTINGS, RESOLUTION_DPR, useSettings } from "@/settings/settings";
import LeaveToLobby from "@/game/LeaveToLobby";
import SettingsPanel from "@/settings/SettingsPanel";

import { ASSET_BASE } from "../../../shared/env.ts";
import ChibiCustomizerPanel from "../avatar/ChibiCustomizerPanel";
import { useCompanionChatOpen } from "../companion/chatOpen";
import CompanionHud from "../companion/CompanionHud";
import { startCompanion } from "../companion/companionRuntime";
import { connectCompanionDialogue } from "../dialogue/companionLink";
import { IS_COMPANION_ACTIVE, TALK_BUTTONS } from "../dialogue/talkButton";
import SidekickCustomizerPanel from "../avatar/SidekickCustomizerPanel";
import { readMeshAppearance, type MeshAppearanceConfig } from "../avatar/meshAppearance";
import { readSidekickAppearance } from "../avatar/sidekickOptions";
import { DEFAULT_TOON } from "../avatar/toonMaterial";
import { DEFAULT_OUTLINE } from "../avatar/toonOutline";
import EndingLayer from "../ending/EndingLayer";
import { ending, useEndingPhase } from "../ending/endingState";
import { gut } from "../puzzles/gut/gutState";
import { BASELINE, UNITS_PER_METER, VIEWPOINTS } from "../plan/sitePlan";
import { teleportPlayer } from "../puzzles/cave/caveState";
import { useHintBoxOpen } from "../puzzles/hintBoxView";
import InventoryModal from "../puzzles/InventoryModal";
import {
  beginHold,
  bindPointerHold,
  endHold,
  isOutOfGame as checkOutOfGame,
  requestResume,
} from "../puzzles/pointerHold";
import { IS_REVIEW_REQUESTED, ReviewHud } from "../review/ReviewBridge";
import { najuCaseProgress } from "../progress/caseProgress";
import { readSavedSection } from "@/save/gameSave";
import CaseStartCard from "./CaseStartCard";
import NajuPauseMenu from "./NajuPauseMenu";
import PlayTimeHud from "./PlayTimeHud";
import { playClock } from "../progress/playClock";
import { noteNajuReady, noteNajuStart } from "../beta/najuBeta";
import { CARD_PREVIEW, RATING_PREVIEW, type CaseStartMode } from "./caseStart";
import NajuScene, { type NajuSceneReport, type NajuToonConfig } from "../scene/NajuScene";
import { audio } from "../scene/immersion/audio";
import { DEFAULT_TERRAIN } from "../terrain/terrain";
import { ArrivalCover, FirstFrameSignal } from "../transition/ArrivalFade";
import { applyMusicVolume } from "../transition/loadingVideo";
import { useArrivalFade } from "../transition/useArrivalFade";
import { IS_MANGA_STYLE, MangaEffect } from "../world/mangaStyle";
import LoadingCover, { type LoadingProgress } from "./LoadingCover";
import { canLeaveToLobby, leaveToLobbyAction } from "./leaveToLobby";
import { PuzzleHud, PuzzleWorld } from "./PuzzleLayer";
import { prefetchNajuAssets } from "./prefetch";
import { waitForSessionBeforeAssets } from "./sessionGate";
import {
  ALLOW_VIEW_TOGGLE,
  IS_ARRIVING_FROM_HUB,
  IS_BLOOM_DISABLED,
  IS_DPR_AUTO,
  IS_OUTLINE_DISABLED,
  IS_POSTFX_DISABLED,
  IS_STAGE_16X9,
  TEST_START_AT,
  IS_TONE_MAPPING_ENABLED,
  IS_TOON_DISABLED,
  IS_VIGNETTE_DISABLED,
  IS_WORLD_TOON_DISABLED,
  LEGACY_SIDEKICK_APPEARANCE_KEY,
  MAX_DPR,
  MESH_APPEARANCE_KEY,
  MIN_DPR,
  MSAA_SAMPLES,
  SHOW_CUSTOMIZE_PANEL,
  SHOW_DEV_TOOLS,
  SHOW_SETTINGS_BUTTON,
  SIDEKICK_APPEARANCE_KEY,
  USE_HALF_FLOAT_BUFFER,
  USE_SIDEKICK_AVATAR,
} from "./runtimeFlags";
import { useGameHotkeys } from "./useGameHotkeys";

type ViewMode = "1인칭" | "3인칭";

// 시작 카메라 — V1 자리. Leva 저장값이 다르면 첫 프레임에 씬이 다시 앉힌다.
const START_VIEWPOINT = VIEWPOINTS[0];
const START_HEIGHT =
  (DEFAULT_TERRAIN.groundAt(START_VIEWPOINT.x, START_VIEWPOINT.z).y + BASELINE.eyeHeight) * UNITS_PER_METER;

const toggleViewMode = (mode: ViewMode): ViewMode => (mode === "1인칭" ? "3인칭" : "1인칭");

// dpr·시점 단추만 바뀌어도 App 이 다시 그린다. 씬은 수천 줄짜리라 다시 도는 것만으로 무겁고,
// 넘기는 prop 은 ref·state 라 안 바뀌면 같은 참조다.
const MemoNajuScene = memo(NajuScene);
// 덮개가 흐려지는(.4s) 뒤에 DOM 에서 뗀다
const COVER_REMOVE_MS = 450;

export default function App() {
  // 동적 해상도 — dpr 을 못 박으면 가장 나쁜 자리(Z1 마을)에 맞춰야 해서 한가한 곳의 성능을 버린다.
  // 배율이 바뀌면 프레임버퍼를 다시 잡으므로 0.25 눈금으로만 움직인다.
  const [dpr, setDpr] = useState(IS_DPR_AUTO ? 1.25 : MAX_DPR);

  // 본편과 같은 설정(같은 저장 열쇠) — 본편에서 줄인 소리가 여기서도 그대로다
  const settings = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const hintCount = useHintBox().length;
  // 「로비로 나가기」 — 저장 여부 안내는 로그인 상태가 정해진 뒤(앱은 initGameSave 뒤에 그려진다)
  // 나갈 로비가 없는 판(검수 실행 · 나주만 띄운 개발 서버)에는 두지 않는다
  const [leaveAction] = useState(() => (!IS_REVIEW_REQUESTED && canLeaveToLobby() ? leaveToLobbyAction() : undefined));
  // 「자동」이 아니면 고른 배율로 못 박고 동적 해상도를 끈다
  const fixedDpr =
    settings.resolution === "auto" ? null : Math.min(RESOLUTION_DPR[settings.resolution], window.devicePixelRatio || 1);

  const controlsRef = useRef<PointerLockControlsImpl>(null);
  const reportRef = useRef<NajuSceneReport | null>(null); // 씬 → 검수 도구(리렌더 없이)
  const [isLocked, setIsLocked] = useState(false);
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
  // 첫 프레임이 그려지면 검은 덮개가 걷힌다
  const [isArrivalRevealed, revealArrival] = useArrivalFade(IS_ARRIVING_FROM_HUB);

  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({
    done: 0,
    total: 0,
    label: "",
    phase: "fetching",
  });
  const [isSceneReady, setIsSceneReady] = useState(false); // 다 받아서 씬을 붙여도 된다
  const [isSceneDrawn, setIsSceneDrawn] = useState(false);
  const [isCoverMounted, setIsCoverMounted] = useState(true);

  useEffect(() => {
    let isAlive = true;
    let frame = 0;
    // 동행 세션은 앱이 뜰 때 한 번 연다 — 진행 동기화 · NPC · 힌트가 모두 이 Play Session 을 쓴다(전에는 CompanionHud 안에서 열었다, #52).
    // 여러 번 불려도 한 번만 돈다(startCompanion). CDN 에셋이면 세션이 준 판 경로로 받게 받기 전에 잠깐 기다린다
    const session = IS_COMPANION_ACTIVE ? startCompanion() : Promise.resolve();
    waitForSessionBeforeAssets(session, { isCdn: !!ASSET_BASE })
      .then(() =>
        prefetchNajuAssets((done, total, label) => {
          if (isAlive) setLoadingProgress({ done, total, label, phase: "fetching" });
        }),
      )
      .then(() => {
        if (!isAlive) return;
        setLoadingProgress((previous) => ({ ...previous, phase: "building" }));
        // 「세우는 중」이 한 번 그려진 뒤에 붙인다 — 같은 틱이면 수 초짜리 동기 세우기가 먼저 와 「받는 중」에서 얼어 보인다
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (isAlive) setIsSceneReady(true);
          });
        });
      });
    return () => {
      isAlive = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  // 동행 서버의 말 · 힌트 제안 · auto 턴을 대화창 한 벌에 잇는다(dialogue/companionBridge). 대화창은 CompanionHud 가 아니라 DialogueLayer 다
  useEffect(() => (IS_COMPANION_ACTIVE ? connectCompanionDialogue() : undefined), []);

  useEffect(() => {
    if (!isSceneDrawn) return undefined;
    const timer = setTimeout(() => setIsCoverMounted(false), COVER_REMOVE_MS);
    return () => clearTimeout(timer);
  }, [isSceneDrawn]);

  useEffect(() => {
    applyMusicVolume();
    // 효과음은 기본값일 때 원래 크기가 되게 배율로 건다(O 판의 소리 크기에 곱해진다)
    audio.setSfxScale(Math.min(1.5, settings.sfxVolume / DEFAULT_SETTINGS.sfxVolume));
  }, [settings.bgmVolume, settings.sfxVolume]);

  // 잠금 장치는 씬과 함께 붙어 잠글 때마다 다시 맞춘다
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.pointerSpeed = settings.sensitivity;
  }, [settings.sensitivity, isSceneReady, isLocked]);

  const switchViewMode = useCallback(() => setViewMode(toggleViewMode), []);
  // ?at=V2 — 실기기 측정용으로 관측 지점에 바로 선다(첫 프레임이 그려진 뒤 한 번)
  useEffect(() => {
    const code = TEST_START_AT?.toUpperCase();
    if (!isSceneDrawn || !code) return;
    const viewpoint = VIEWPOINTS.find((v) => v.code === code);
    if (viewpoint) teleportPlayer(viewpoint.x, viewpoint.z, viewpoint.heading);
  }, [isSceneDrawn]);
  // 터치 모드 — 멈춤 · 창이면 렌더 루프까지 세운다(11/7 미르 결정 5). 창이 열려 있으면 「멈춤」 덮개 대신 창을 보인다
  const isTouch = useTouchMode();
  const isFrozen = useGameFrozen();
  const isHintBoxOpen = useHintBoxOpen();
  const isChatOpen = useCompanionChatOpen();
  // 엔딩 — 끝 연출(finale)은 세계가 흐르고 HUD 만 걷는다. 전체화면 필름 · 클리어 화면은 창처럼 세계를 세우고 커서를 준다
  const endingPhase = useEndingPhase();
  const isEndingScreen = endingPhase === "film" || endingPhase === "clear";
  const isWindowOpen = isSettingsOpen || isInventoryOpen || isHintBoxOpen || isChatOpen || isEndingScreen;
  // PC 일시정지(미르 11/10) — 창이 열렸거나 게임 밖(ESC 로 나옴)이면 게임 시간 · 렌더 · 소리를 세운다. 터치의 「전부 멈춤」과 같다.
  // 종이 읽기 · 줄 당기기 · 창처럼 페이지가 일부러 잠금을 풀어 둔 것(붙듦)과 다시 잠그기를 기다리는 동안은 게임 안이다.
  // 처음 [T] 전에는 첫 장면을 그려야 덮개가 걷히므로 세우지 않는다
  const [hasLockedOnce, setHasLockedOnce] = useState(false);
  const [isOutOfGame, setIsOutOfGame] = useState(false);
  // 시작 카드 모드 — 저장이 있으면 한 줄 「이어서 조사」(아래 isCardVisible 설명)
  const [caseStart] = useState(() => {
    if (CARD_PREVIEW) return { mode: (CARD_PREVIEW === "full" ? "full" : "resume") as CaseStartMode, isCleared: CARD_PREVIEW === "cleared" };
    const progress = IS_REVIEW_REQUESTED ? null : najuCaseProgress((name) => readSavedSection(name));
    return { mode: (progress ? "resume" : "full") as CaseStartMode, isCleared: !!progress?.isCleared };
  });
  const [cardMode, setCardMode] = useState<CaseStartMode | null>(IS_REVIEW_REQUESTED ? null : caseStart.mode);
  const handleLockChange = useCallback((next: boolean) => {
    setIsLocked(next);
    if (!next) return;
    setHasLockedOnce(true);
    // 잠겼다 — 시작 카드(첫 몸짓 · 다시 보기)를 내린다. 다시 풀려도 카드가 아니라 「게임 밖」 쉼이 맡는다
    setCardMode(null);
    // 조사 시간은 첫 조작부터 센다(얼어 있던 시간은 게임 시계가 뺀다)
    if (!IS_REVIEW_REQUESTED) {
      playClock.start();
      // 베타 기록 — 첫 조작(시작 · 이어 하기). 참여 코드가 없으면 아무 일도 없다
      noteNajuStart(caseStart.mode === "full" ? "full" : "resume", caseStart.isCleared);
    }
  }, [caseStart]);
  useEffect(() => {
    if (isTouch || !hasLockedOnce) return undefined;
    // 붙듦 · 기다림은 알림이 없어 잠금이 바뀔 때와 짧은 간격으로 본다. 창이 떠 있는 동안에도 「닫으면 게임 밖인가」를 잰다
    const check = () => setIsOutOfGame(checkOutOfGame());
    const timer = window.setInterval(check, 300);
    document.addEventListener("pointerlockchange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("pointerlockchange", check);
      setIsOutOfGame(false);
    };
  }, [isTouch, hasLockedOnce]);
  // 시작 카드(PC, 미르 11/11) — 첫 몸짓(조사 시작 · Enter · WASD · T)이 잠금을 건다. 저장이 있으면 한 줄 「이어서 조사」.
  // 첫 장면이 그려지고(기차에서 왔으면 도착 막이 걷힌 뒤) 창이 없을 때 띄우고, 떠 있는 동안은 게임 시간 · 렌더를 세운다(창과 같은 쉼)
  const isCardVisible =
    cardMode !== null && !isTouch && isSceneDrawn && (!IS_ARRIVING_FROM_HUB || isArrivalRevealed) && !isWindowOpen;
  // 베타 기록 — 시작 카드가 처음 떴다 = 나주 로딩이 끝나 조작을 받을 수 있다(로딩 시간)
  useEffect(() => {
    if (isCardVisible) noteNajuReady({ mode: caseStart.mode, from_hub: IS_ARRIVING_FROM_HUB });
  }, [isCardVisible, caseStart.mode]);
  // controls.lock() 과 같은 요청을 직접 — 브라우저가 거절하면(ESC 직후 · 창 밖 초점) 약속이 거절로 끝나니 받아 둔다.
  // 거절은 pointerlockerror 로 카드 · 멈춤 메뉴가 「한 번 더 눌러 주세요」를 보인다
  const requestLock = useCallback(() => {
    const element = controlsRef.current?.domElement as (HTMLElement & { requestPointerLock(): Promise<void> | void }) | undefined;
    const request = element?.requestPointerLock();
    if (request instanceof Promise) request.catch(() => {});
  }, []);
  const startFromCard = useCallback(() => {
    // 다시 보기는 창처럼 잠금을 붙들어 두었다 — 먼저 놓는다(붙든 동안은 잠그지 않는다). 첫 시작 전에 연 다시 보기는 놓아도
    // 다시 잠가 주지 않으므로(조작 중이 아니었다) 아래에서 직접 잠근다. 카드는 잠긴 뒤에(handleLockChange) 내린다 — 03회차 Codex
    if (cardMode === "guide") endHold(CASE_GUIDE_HOLD);
    requestLock();
  }, [cardMode, requestLock]);
  /**
   * 다시 보기를 Esc 로 닫는다 — 놓으면 열기 전 상태로(조작 중이었으면 다시 잠그고, 멈춤 메뉴에서 열었으면 메뉴로).
   * 첫 시작 전(설정에서 연 다시 보기)이면 시작 카드로 돌아간다 — 카드를 내리면 시작할 길이 [T] 뿐이다
   */
  const closeCaseGuide = useCallback(() => {
    endHold(CASE_GUIDE_HOLD);
    setCardMode(hasLockedOnce ? null : caseStart.mode);
  }, [hasLockedOnce, caseStart.mode]);
  // 멈춤 메뉴에서 ESC — 돌아가기를 청하고 바로 다시 잰다(300ms 판정을 기다리면 메뉴가 잠깐 남는다)
  const resumeFromEscape = useCallback(() => {
    requestResume();
    setIsOutOfGame(checkOutOfGame());
  }, []);
  const showCaseGuide = useCallback(() => {
    beginHold(CASE_GUIDE_HOLD, "window");
    setCardMode("guide");
    setIsSettingsOpen(false);
  }, []);
  // 첫 시작 전(카드가 걸려 있는 동안) 연 창도 쉰다 — 카드가 창에 가려 isCardVisible 이 꺼져도 멈춤이 풀리지 않게(03회차 Codex)
  const isBeforeStart = cardMode !== null && isSceneDrawn;
  const isDesktopWindowPause = !isTouch && (((hasLockedOnce || isBeforeStart) && isWindowOpen) || isCardVisible);
  const isDesktopOutPause = !isTouch && isOutOfGame && !isWindowOpen;
  // PC 멈춤 메뉴(미르 11/11) — 조사 중 ESC 로 게임 밖에 나왔을 때. 창 · 시작 카드(다시 보기)가 떠 있으면 그쪽이 화면을 쓴다
  const isPauseMenuShown =
    !isTouch && !IS_REVIEW_REQUESTED && hasLockedOnce && isOutOfGame && !isWindowOpen && cardMode === null;
  // 두 까닭은 함께 알린다 — 하나씩 바꾸면 「창」→「게임 밖」 사이에 잠깐 풀린다(Codex 리뷰)
  useEffect(
    () => setDesktopPauses({ window: isDesktopWindowPause, out: isDesktopOutPause }),
    [isDesktopWindowPause, isDesktopOutPause],
  );
  useEffect(() => () => setDesktopPauses({ window: false, out: false }), []);
  useEffect(() => bindPointerHold(() => controlsRef.current), []);
  // 창이 떠 있는 동안 조작 잠금을 붙든다(pointerHold) — 어느 길로 열어도(단축키 · 단추 · 퍼즐 · 개발 훅) 풀고(터치 단추가 창 위에
  // 남지 않게, 14회차), 어느 길로 닫아도(ESC · 단축키 · 닫기 단추 · 배경 · 꺼내기) 열기 전에 조작 중이었을 때만 다시 잠근다(미르 11/8).
  // 터치에서 닫을 때 다시 잠그는 일은 MobileGate 가 한다
  useWindowHold("settings", isSettingsOpen);
  useWindowHold("ending", isEndingScreen);
  // 굿이 끝난 판(새로 고침 · 옛 저장)인데 엔딩을 아직 안 봤으면 — 조사를 다시 시작하는 첫 순간에 엔딩부터(나주엔딩 01회차 Codex).
  // 굿 복원은 지형이 준비된 뒤라 시작보다 늦을 수 있다 — 굿 단계가 바뀌어도 다시 본다(Codex 리뷰). 굿을 막 끝낸 판은 끝 연출이 맡는다
  const gutStage = useSyncExternalStore(gut.subscribe, gut.stage);
  useEffect(() => {
    if (!hasLockedOnce || IS_REVIEW_REQUESTED) return;
    if (gutStage === "dawn" && !ending.isSeen() && ending.phase() === "off") ending.openFilm();
  }, [hasLockedOnce, gutStage]);
  // (개발 서버) ?ending=film · ?ending=clear — 시작하면 바로 엔딩 필름 · 클리어 화면(화면 확인용, 굿 진행은 그대로)
  useEffect(() => {
    if (!import.meta.env.DEV || !hasLockedOnce) return;
    const preview = new URLSearchParams(window.location.search).get("ending");
    if (preview === "film") ending.openFilm();
    else if (preview === "clear") ending.openClear();
  }, [hasLockedOnce]);
  useWindowHold("inventory", isInventoryOpen);
  useWindowHold("hintBox", isHintBoxOpen);
  // 동행 입력은 제 손으로 풀고(열 때 잠겨 있었으면 ESC 로 닫으며) 다시 잠근다 — 여기서는 다른 길로 열렸을 때만 풀어 둔다
  useEffect(() => {
    if (isChatOpen && isPointerActive()) controlsRef.current?.unlock();
  }, [isChatOpen]);
  useGameHotkeys({
    controlsRef,
    isLocked,
    isSettingsOpen,
    setIsSettingsOpen,
    isInventoryOpen,
    setIsInventoryOpen,
    hintCount,
    toggleViewMode: switchViewMode,
  });

  return (
    <div className={`game-stage${IS_STAGE_16X9 ? " game-stage--16x9" : ""}`} style={{ position: "relative" }}>
      {/* 나주맵은 Leva 를 조절 창으로 쓰지 않는다 — 값은 코드 기본·저장값 그대로 돌고 패널만 숨긴다 */}
      <Leva hidden theme={{ sizes: { numberInputMinWidth: "68px" } }} />
      <Canvas
        frameloop={isFrozen ? "never" : "always"}
        shadows={IS_LOW_QUALITY || IS_MOBILE_QUALITY ? false : "percentage"}
        // [1, 상한] 배열을 주면 three 가 기기 픽셀비로 골라 PerformanceMonitor 가 정한 값이 묻힌다
        dpr={IS_LOW_QUALITY ? 1 : (fixedDpr ?? dpr)}
        // 밝기 100% 면 필터를 아예 안 건다(합성 비용 0)
        style={settings.brightness !== 1 ? { filter: `brightness(${settings.brightness})` } : undefined}
        gl={{
          antialias: !IS_LOW_QUALITY && IS_POSTFX_DISABLED,
          toneMappingExposure: 1.15,
          // 900 m 밖 산줄기까지 그리려고 far 를 키우면 가까운 면의 깊이 정밀도가 무너진다
          logarithmicDepthBuffer: true,
          powerPreference: "high-performance",
        }}
        // 야외라 건너편 뱃길 너머 산줄기까지 이어져야 한다. 900 m ≈ 3000 유닛.
        camera={{
          position: [START_VIEWPOINT.x * UNITS_PER_METER, START_HEIGHT, START_VIEWPOINT.z * UNITS_PER_METER],
          fov: BASELINE.fov,
          near: 0.3,
          far: 4000,
        }}
      >
        {/* 씬과 함께 붙인다 — 빈 캔버스에서 재면 fps 가 높게 나와 배율이 상한부터 올라가고, Preload 는 데울 것이 없다 */}
        {isSceneReady && (
          <>
            {/* factor 0(느림)~1(빠름). bounds 를 벌려 둬야 올림·내림이 번갈아 흔들리지 않고,
                flipflops 세 번이면 그 자리에 머문다(발표 중 화면이 오르내리지 않게). */}
            {IS_DPR_AUTO && fixedDpr === null && (
              <PerformanceMonitor
                bounds={() => [50, 58]}
                flipflops={3}
                onChange={({ factor }) => {
                  const next = Math.round((MIN_DPR + (MAX_DPR - MIN_DPR) * factor) * 4) / 4;
                  setDpr((previous) => (previous === next ? previous : next));
                }}
              />
            )}
            <MemoNajuScene
              active={isLocked}
              controlsRef={controlsRef}
              onLockChange={handleLockChange}
              reportRef={reportRef}
              isThirdPerson={ALLOW_VIEW_TOGGLE && viewMode === "3인칭"}
              sidekickConfig={sidekickConfig}
              meshConfig={meshConfig}
              toonConfig={toonConfig}
              outlineConfig={outlineConfig}
            />
            <PuzzleWorld />
            {/* 씬 뒤에 둔다 — 붙는 순서대로 효과가 돌아 씬의 재질이 다 선 다음에 데운다 */}
            <Preload all />
            <PauseClockGuard />
            {/* 멈춘 동안 캔버스 크기 · 픽셀비가 바뀌면 한 장면 다시 — 안 그리면 메뉴 뒤가 까맣다(미르 11/11 물굴 ESC 암전) */}
            <FrozenRedraw />
            <FovCap />
            {/* 붙자마자 걷으면 셰이더 컴파일·첫 업로드가 걸린 프레임을 그대로 보게 된다 */}
            <FirstFrameSignal frames={3} onFirstFrame={() => setIsSceneDrawn(true)} />
            {IS_ARRIVING_FROM_HUB && <FirstFrameSignal onFirstFrame={revealArrival} />}
          </>
        )}
        {/* frameBufferType 을 꼭 준다 — 기본 HalfFloat 이면 ANGLE Metal 에서 이 씬의 3D 가 통째로 까맣다(?fb=half 로 재현). */}
        {!IS_LOW_QUALITY && !IS_POSTFX_DISABLED && (
          <EffectComposer
            multisampling={MSAA_SAMPLES}
            enableNormalPass={false}
            frameBufferType={USE_HALF_FLOAT_BUFFER ? THREE.HalfFloatType : THREE.UnsignedByteType}
          >
            {/* ?만화 — 만화 v3: 깊이 선 + 색 보정(world/mangaStyle). 다른 효과보다 먼저 */}
            {IS_MANGA_STYLE && <MangaEffect />}
            {/* ACES 는 본편처럼 기본 끔 — 화풍 선택지(?tm=on) */}
            {IS_TONE_MAPPING_ENABLED && <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />}
            {!IS_BLOOM_DISABLED && <Bloom intensity={0.35} luminanceThreshold={0.9} mipmapBlur />}
            {/* 본편과 같은 값 */}
            {!IS_VIGNETTE_DISABLED && <Vignette eskil={false} offset={0.36} darkness={0.28} />}
          </EffectComposer>
        )}
      </Canvas>

      {IS_ARRIVING_FROM_HUB && <ArrivalCover isRevealed={isArrivalRevealed} />}
      {/* 엔딩 동안 HUD 는 숨기기만 한다(대화창 · 알림 줄은 런타임도 맡아 떼면 안 된다, Codex) */}
      <div hidden={endingPhase !== "off"}>
        <PuzzleHud />
        {!IS_REVIEW_REQUESTED && <PlayTimeHud />}
        {/* 동행 세션 상태 표식(?dev) · 자유 입력(베타는 끔) — 동행의 말은 위 PuzzleHud 의 대화창에 뜬다 */}
        {IS_COMPANION_ACTIVE && (
          <CompanionHud controlsRef={controlsRef} isLocked={isLocked} showStatus={SHOW_DEV_TOOLS} />
        )}
      </div>
      <InventoryModal open={isInventoryOpen} onClose={() => setIsInventoryOpen(false)} />
      {IS_REVIEW_REQUESTED && <ReviewHud />}
      {SHOW_DEV_TOOLS && !isLocked && <ControlsHelp />}
      {ALLOW_VIEW_TOGGLE && (
        <button type="button" onClick={() => setViewMode(toggleViewMode)} style={viewButtonStyle}>
          [V] {viewMode}
        </button>
      )}
      {SHOW_CUSTOMIZE_PANEL && meshConfig && (
        <ChibiCustomizerPanel
          config={meshConfig}
          setConfig={setPanelMeshConfig}
          storageKey={MESH_APPEARANCE_KEY}
          toonConfig={toonConfig}
          setToonConfig={setToonConfig}
          outlineConfig={outlineConfig}
          setOutlineConfig={setOutlineConfig}
        />
      )}
      {SHOW_SETTINGS_BUTTON && !isTouch && endingPhase === "off" && (
        <button
          type="button"
          onClick={() => setIsSettingsOpen((open) => !open)}
          style={settingsButtonStyle}
          aria-label="설정 열기"
        >
          ⚙ 설정 [P]
        </button>
      )}
      {/* 게임 중 멈추고 로비로 — 설정 창(P · ⚙) · 터치 멈춤 화면 둘 다(미르 11/10). 검수 실행에는 두지 않는다 */}
      <SettingsPanel
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        leaveToLobby={leaveAction}
        onShowGuide={IS_REVIEW_REQUESTED ? undefined : showCaseGuide}
        guideLabel={guideLabel}
      />
      {isCardVisible && cardMode && (
        <CaseStartCard
          mode={cardMode}
          isCleared={caseStart.isCleared}
          onStart={startFromCard}
          onClose={cardMode === "guide" ? closeCaseGuide : undefined}
        />
      )}
      {isPauseMenuShown && (
        <NajuPauseMenu
          onResume={requestLock}
          onEscape={resumeFromEscape}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onShowGuide={showCaseGuide}
          guideLabel={guideLabel}
          leaveAction={leaveAction}
        />
      )}
      <div hidden={endingPhase !== "off"}>
        <TouchHud extraTopButtons={TALK_BUTTONS} />
      </div>
      <EndingLayer leaveAction={leaveAction} />
      <MobileGate
        controlsRef={controlsRef}
        isWindowOpen={isWindowOpen}
        pausedExtra={leaveAction && <LeaveToLobby action={leaveAction} tone="cover" />}
      />
      {SHOW_FPS && <FpsBadge />}
      {isCoverMounted && <LoadingCover progress={loadingProgress} isFading={isSceneDrawn} />}
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

/** 설정의 「조작 · 평가 다시 보기」가 잠금을 붙드는 이름 */
const CASE_GUIDE_HOLD = "caseGuide";
const guideLabel = RATING_PREVIEW === "off" ? "조작 다시 보기" : "조작 · 평가 다시 보기";

/** 창이 열려 있는 동안 조작 잠금을 붙든다 — 닫히거나(어느 길이든) 내려가면 놓는다 */
function useWindowHold(id: string, isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return undefined;
    beginHold(id, "window");
    return () => endHold(id);
  }, [id, isOpen]);
}

/** (?dev) 조작 안내 — 잠그기 전에만 화면 아래에 뜬다 */
function ControlsHelp() {
  return (
    <div style={helpStyle}>
      <b>[T] 시작</b> · WASD 이동 · Shift 달리기 · Space 점프 · C 앉기 · ESC 나가기 · <b>[E] 상호작용</b> ·{" "}
      <b>[I] 소지품</b>
      <br />
      <span style={mutedStyle}>
        {ALLOW_VIEW_TOGGLE && (
          <>
            3인칭에서 마우스로 캐릭터 앞·뒤를 자유롭게 회전
            <br />
          </>
        )}
        낙하하면 마지막 안전 지점으로 복귀
      </span>
    </div>
  );
}

const mutedStyle: CSSProperties = { color: "#8B94A6" };
const helpStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  zIndex: 20,
  padding: "8px 14px",
  borderRadius: 8,
  background: "rgba(14,18,26,.7)",
  color: "#E6EBF4",
  font: '12.5px/1.6 "Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif',
  textAlign: "center",
  pointerEvents: "none",
};

const viewButtonStyle: CSSProperties = {
  position: "absolute",
  right: 120,
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

const settingsButtonStyle: CSSProperties = { ...viewButtonStyle, right: 14 };
