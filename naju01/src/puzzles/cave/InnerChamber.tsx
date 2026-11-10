/**
 * 석실 — 고리문 너머 한 단 높은 방. 들어서면 들머리 등이 켜진다. 받침 넷의 그림(달·배·구렁이·바위)을 아치 위 벽화의
 * 이야기 순서대로 누르면 켜지고 돌 상자 면에 그 장면이 그려진다. 틀리면 다 꺼지고, 물살이 거세져 숨이 깎이며 받침이 잠시 가라앉는다(막 누르지 못하게). 넷을 맞힌 뒤 큰 진주를 바위 홈에 끼우면
 * 빛줄기가 상자로 흘러들어 비늘이 떠오르고, 비늘을 챙긴 뒤 뒷벽 물길에 몸을 맡기면 강가로 올라간다.
 * 치수는 chamberLayout, 그림 · 재질은 chamberArt, 연출 조각은 chamberMotion, 돌 소품은 chamberParts.
 */
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { cameraFocusId, focusCamera } from "../../scene/cameraFocus";
import { useRememberedState } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { registerInteractable, showNotice } from "../interaction";
import { inventory, useHandItem, useHeldItems } from "../inventory";
import { setPuzzlePanel } from "../puzzlePanel";
import { ritual } from "../ritual/ritualState";
import { M, groundY } from "../units";
import {
  INNER,
  INNER_FLOOR,
  SURFACE_Y,
  hurtBreath,
  registerCaveObstacles,
  setInsideDark,
  setUnderwater,
  stirSand,
  teleportPlayer,
  useCaveShown,
  cave,
  clearBreathAfterLeaving,
  guardBreathFor,
  holdBreathWhileLeaving,
} from "./caveState";
import { createChamberAssets, disposeChamberAssets } from "./chamberArt";
import {
  BACK_DARK_Z,
  BACK_REVEAL_SECONDS,
  BEAM_TRAVEL,
  BOX,
  BOX_LIGHT_UP,
  BOX_PANELS,
  BOX_TOP,
  CHAMBER_SPOTS,
  CRACK,
  GLYPHS,
  LAMPS,
  LAMP_OFF,
  LAMP_ON,
  LIGHT_UP_SECONDS,
  MEANING,
  MURAL,
  ORB_Y,
  ORDER,
  PAINT_SECONDS,
  PANEL_RANGE,
  PEDESTAL_HEIGHT,
  PEDESTAL_VENT,
  PEDESTAL_VENT_EAST,
  PEDESTAL_X,
  PEDESTAL_Z,
  PRESS_DEPTH,
  SCALE_DELAY,
  SCALE_RISE_SECONDS,
  SCALE_SHOWN,
  SHORE,
  SOCKET,
  STATUE_X,
  STATUE_Z,
} from "./chamberLayout";

/** 벽화 돌아보기 — 방 안쪽으로 이만큼(z) 들어서면 · 화면 고정 이름 · 바라볼 자리(유닛, 벽화 가운데) */
const MURAL_GLANCE_Z = INNER.z[0] + 2.2;
const MURAL_FOCUS_ID = "chamber-mural";
const muralTarget = new THREE.Vector3(45 * M, (MURAL.bottom + MURAL.height / 2) * M, MURAL.z * M);

/** 틀리면 깎이는 숨(초) · 받침이 가라앉아 못 누르는 시간(초) */
const WRONG_PRESS_BREATH = 8;
const LOCKOUT_SECONDS = 3;
/** 가라앉은 받침은 이만큼 더 내려가 있다(미터) */
const SUNK_DEPTH = 0.12;
import { lampLevel, placePearlBeam, pullIntoExit, scaleHeight, updateCurrent } from "./chamberMotion";
import { ChamberVents, EntryStatues, ExitRocks, OrbLamps, PearlSocket, Pedestals, StoneBox } from "./chamberParts";

// 게임 시계 — 「전부 멈춤」(창 · 게임 밖 · PC 일시정지) 동안은 흐르지 않는다. 실제 시계면 오래 멈췄다 돌아올 때 차례 시범이 건너뛰어졌다(Codex 리뷰)
const now = () => gameNow() / 1000;

export default function InnerChamber() {
  const isShown = useCaveShown();
  const { camera } = useThree();
  /** 맞춘 수 — ORDER 의 앞에서부터 */
  const [progress, setProgress] = useRememberedState("chamber.progress", 0);
  const [isSolved, setIsSolved] = useRememberedState("chamber.isSolved", false);
  const [isScaleTaken, setIsScaleTaken] = useRememberedState("chamber.isScaleTaken", false);
  /** 큰 진주로 홈을 밝혔나 — 그때부터 비늘이 떠오른다 */
  const [isShone, setIsShone] = useRememberedState("chamber.isShone", false);
  // 석실에 처음 들어서 아치 위 벽화를 한 번 돌아봤나 — 다 본 뒤에 적는다(다른 연출에 밀려 못 봤으면 다음에 다시)
  const [isMuralGlanced, setIsMuralGlanced] = useRememberedState("chamber.muralGlanced", false);
  const muralGlance = useRef<"idle" | "focusing" | "done">(isMuralGlanced ? "done" : "idle");
  // 이어 하기: 이미 끝난 연출은 페이지 시작 때 끝난 것으로 친다(0 이면 충분히 지났다).
  const shoneAt = useRef(isShone ? 0 : -1);
  const progressRef = useRef(progress);
  const hand = useHandItem();
  // 손에 꺼내 들어도 가진 것이다
  const hasScale = useHeldItems().some((item) => item.kind === "scale") || hand?.kind === "scale";
  const isHoldingPearl = hand?.kind === "bigPearl";
  const pearlLight = useRef<THREE.PointLight>(null);
  const pearlBeam = useRef<THREE.Mesh>(null);
  /** 벽화에 드러난 장면 수(소수부 = 지금 번지는 중) */
  const muralScenes = useRef(1);
  const current = useRef<THREE.Points>(null);
  const caps = useRef<(THREE.Group | null)[]>([]);
  const faces = useRef<(THREE.Mesh | null)[]>([]);
  const orbGlows = useRef<(THREE.Sprite | null)[]>([]);
  const orbLights = useRef<(THREE.PointLight | null)[]>([]);
  const scaleGroup = useRef<THREE.Group>(null);
  const scaleGlow = useRef<THREE.Sprite>(null);
  const scaleLight = useRef<THREE.PointLight>(null);
  const boxLight = useRef<THREE.PointLight>(null);
  const socketRock = useRef<THREE.Group>(null);
  const socketPearl = useRef<THREE.Group>(null);
  const socketLight = useRef<THREE.PointLight>(null);
  const veil = useRef<THREE.Mesh>(null);
  const pressedAt = useRef<number[]>(PEDESTAL_X.map(() => -1));
  const solvedAt = useRef(isSolved ? 0 : -1);
  const flashAt = useRef(-1);
  /** 틀려서 받침이 가라앉아 있는 동안 — 이때까지 못 누른다 */
  const lockedUntil = useRef(-1);
  const enteredAt = useRef(-1);
  const leavingAt = useRef(-1);
  const leaveFrom = useRef({ x: 0, z: 0 });
  const whiteout = useRef<THREE.Mesh>(null);
  /** 석상의 초롱 · 노 날 빛 — 들머리 등과 같이 켜진다 */
  const abisaGlow = useRef(0);
  const arangsaGlow = useRef(0);
  const backVeil = useRef<THREE.Mesh>(null);
  const blackout = useRef<THREE.Mesh>(null);
  const insideDark = useRef(0);
  /** 상자 면마다 그려지기 시작한 때(없으면 −1, 바래는 중이면 −시작 시각) */
  const paintedAt = useRef<number[]>(BOX_PANELS.map(() => -1));

  const assets = useMemo(() => createChamberAssets(), []);
  useEffect(() => () => disposeChamberAssets(assets), [assets]);

  /** 넷을 순서대로 — 상자 옆 등이 켜진다 */
  const solve = () => {
    setIsSolved(true);
    solvedAt.current = now();
    // 상자 옆 등이 켜지는 것을 보는 동안은 숨이 줄지 않는다(미르 11/10)
    guardBreathFor("chamber-solve", 2.5);
    audio.play("징");
    showNotice(
      "받침 넷이 다 맞았다. 상자 옆 등에 불이 들었지만 상자 면은 아직 맨 돌이다 — 오른쪽 바위에 둥근 홈이 보인다.",
      5.5,
    );
  };

  /** 큰 진주를 바위 홈에 끼운다 — 빛줄기가 상자 벽화로 흘러들고, 상자가 환해진 뒤 비늘이 떠오른다 */
  const shine = () => {
    if (solvedAt.current < 0 || shoneAt.current >= 0) return;
    shoneAt.current = now();
    setIsShone(true);
    // 빛줄기가 상자로 흘러들고 비늘이 떠오르는 동안 — 숨이 줄지 않는다(미르 11/10)
    guardBreathFor("chamber-shine", SCALE_DELAY + SCALE_RISE_SECONDS);
    audio.play("징");
    showNotice("진주가 홈에 딸깍 들어맞았다. 빛줄기가 상자 벽화로 흘러든다 — 구멍 깊은 곳에서 푸른 것이 떠오른다.", 5);
  };

  const takeScale = () => {
    if (shoneAt.current < 0 || now() - shoneAt.current < SCALE_DELAY + SCALE_RISE_SECONDS * 0.8) return;
    if (!inventory.add("scale")) {
      showNotice("소지품이 가득 찼다.", 3.2, { urgent: true, fleeting: true });
      return;
    }
    setIsScaleTaken(true);
    audio.play("단서");
    showNotice("푸른 눈물을 챙겼다. 얼음처럼 차고, 손안에서 희미하게 빛난다 — 아랑사가 남긴 것이다.", 5);
  };

  const press = (k: number) => {
    if (isSolved) return;
    if (now() < lockedUntil.current) {
      showNotice("받침이 가라앉아 꿈쩍 않는다 — 물살이 잦아들 때까지 기다리자.", 2.5, { urgent: true, fleeting: true });
      return;
    }
    pressedAt.current[k] = now();
    const expected = ORDER[progressRef.current];
    if (GLYPHS[k] === expected) {
      // 그 장면이 상자 한 면에 그려진다
      const panel = BOX_PANELS.findIndex((candidate) => candidate.scene === expected);
      if (panel >= 0) paintedAt.current[panel] = now();
      progressRef.current += 1;
      setProgress(progressRef.current);
      audio.play(progressRef.current === ORDER.length ? "단서" : "똑");
      // 켜지는 것을 보여 준다 — 첫 받침에 벽화의 둘째 장면이 번지는 것과 초롱, 셋째 받침에 노 날. 짧게, 그 뒤로는 따로 없다
      const count = progressRef.current;
      if (count === ORDER.length) solve();
      // 화면은 돌리지 않는다(11/4) — 석상 불·벽화는 안내문과 빛으로만 알린다
      else if (count === 1)
        showNotice("받침이 맞물리자 벽화에 다음 장면이 번지고, 아비사 석상이 든 초롱에 불이 든다.", 3.5);
      else if (count === 3) showNotice("아랑사 석상의 노 끝, 바닥에 닿은 날에서 빛이 번진다.", 3.5);
      else showNotice("아치 위 벽화에 다음 장면이 번져 나온다.", 3);
      return;
    }
    // 이미 켜진 것을 다시 눌러도 틀린 것으로 — 순서가 핵심이다
    progressRef.current = 0;
    setProgress(0);
    flashAt.current = now();
    // 그려졌던 벽화가 바래 지워진다
    paintedAt.current = paintedAt.current.map((at) => (at >= 0 ? -now() : -1));
    // 막 눌러 보지 못하게 — 물살이 거세져 숨이 깎이고, replace: true, 받침이 잠시 가라앉는다
    lockedUntil.current = now() + LOCKOUT_SECONDS;
    hurtBreath(WRONG_PRESS_BREATH, "spike");
    stirSand(0.9);
    director.cue({ 카메라: "흔들림", 세기: 0.5 });
    audio.play("우르릉");
    showNotice(
      `순서가 틀렸다 — 받침의 빛이 모두 꺼지고 물살이 거세져 숨이 밀려 나간다(숨 −${WRONG_PRESS_BREATH}초). 받침이 가라앉는다. 아치 위 벽화의 이야기를 다시 보자.`,
      4.5,
      { urgent: true },
    );
  };

  /** 물길에 몸을 맡긴다 — 끌려 들어가는 연출(매 프레임) 뒤에 finishLeave */
  const leave = () => {
    if (leavingAt.current >= 0) return;
    leavingAt.current = now();
    holdBreathWhileLeaving();
    leaveFrom.current = { x: camera.position.x / M, z: camera.position.z / M };
    audio.play("우르릉");
    director.cue({ 카메라: "흔들림", 세기: 0.7 });
  };

  const finishLeave = () => {
    ritual.clear();
    setUnderwater(false);
    clearBreathAfterLeaving();
    teleportPlayer(SHORE.x, SHORE.z, "-Z");
    audio.play("전환");
    // 물살에 떠밀려 나오며 챙긴 것 — 아랑사가 아비사에게 쓴 편지가 든 나무 함(청동 자물통으로 잠겼다).
    // 손에 쥐여 주지 않고 소지품에 — 손에 들면 E 를 누를 때마다 땅에 떨어져 「내려서 뭘 해야 하나」 헷갈렸다(박람회판 정리 · 미르 11/8).
    // 능선의 불탄 평상을 겨누고 E 면 꺼내 올린다
    const isStored = inventory.add("letterBox");
    if (!isStored)
      inventory.spawn("letterBox", new THREE.Vector3(SHORE.x * M, groundY(SHORE.x, SHORE.z) * M, SHORE.z * M));
    // 칸이 차 있으면 add 가 손에 쥐여 준다 — 실제로 간 곳대로 알린다(Codex 04)
    const boxWhere = !isStored
      ? "청동 자물통이 채워진 나무 함이 발치에 떠밀려 와 있다"
      : inventory.hand()?.kind === "letterBox"
        ? "소지품이 가득 차 청동 자물통이 채워진 나무 함을 손에 쥐고 나왔다"
        : "청동 자물통이 채워진 나무 함을 소지품에 챙겼다";
    // 물굴은 다시 못 들어온다 — 바닥에 두고 온 물건도 물살에 함께 떠밀려 나온다
    inventory.bringAlong(SHORE.x, SHORE.z);
    // 안 주운 채 남은 물굴 물건은 함께 사라진다 — 두면 물이 닫힌 뒤 강물 위로 떠오른다
    for (const item of inventory.world())
      if (cave.contains(item.position.x / M, item.position.z / M)) inventory.removeFromWorld(item.uid);
    showNotice(
      `물살이 몸을 밀어 올렸다. 강가로 돌아왔다 — ${boxWhere}. 안에서 무언가 달그락거린다. 여는 법은 능선에서 찾자.`,
      6,
    );
  };

  // 상호작용 · 개발 훅은 늘 최신 풀이 함수를 부른다
  const actions = { press, shine, takeScale, leave, solve };
  const actionsRef = useRef(actions);
  useLayoutEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!isShown) return undefined;
    const disposers = [
      ...PEDESTAL_X.map((_, k) =>
        registerInteractable({
          id: `cave-pedestal-${k}`,
          position: CHAMBER_SPOTS.pedestals[k],
          label: `받침 누르기 — ${GLYPHS[k]} (${MEANING[GLYPHS[k]]})`,
          radius: 0.4 * M,
          reach: 2.8 * M,
          enabled: () => !isSolved,
          use: () => actionsRef.current.press(k),
          highlight: () => caps.current[k],
        }),
      ),
      registerInteractable({
        id: "cave-altar",
        position: CHAMBER_SPOTS.box,
        label: isSolved ? "구멍 들여다보기" : "돌 상자 살펴보기",
        radius: 0.6 * M,
        reach: 3 * M,
        enabled: () => !isShone,
        use: () =>
          showNotice(
            isSolved
              ? "벽화는 다 그려졌는데 빛이 들지 않아 어둑하다. 오른쪽 바위의 둥근 홈이 무언가를 기다린다."
              : "네 면에 흐릿한 밑그림만 남은 돌 상자. 윗면 가운데 둥근 구멍은 깊고 캄캄하다 — 손이 닿지 않는다.",
            5,
          ),
      }),
      registerInteractable({
        id: "cave-socket",
        position: CHAMBER_SPOTS.socket,
        label: "바위 홈 살펴보기",
        radius: 0.3 * M,
        reach: 3 * M,
        enabled: () => !isShone,
        use: () =>
          showNotice(
            isSolved
              ? "주먹만 한 둥근 홈이 상자 쪽을 보고 파여 있다. 빛나는 것을 끼우면 상자에 빛이 닿을 것 같다."
              : "바위에 주먹만 한 둥근 홈이 상자 쪽을 보고 파여 있다. 속은 깊고 매끈하다.",
            5,
          ),
        handLabel: (kind) => (kind === "bigPearl" && isSolved ? "큰 진주 끼우기" : null),
        receive: () => actionsRef.current.shine(),
        highlight: () => socketRock.current,
      }),
      registerInteractable({
        id: "cave-scale",
        position: CHAMBER_SPOTS.scale,
        label: "푸른 눈물 챙기기",
        radius: 0.35 * M,
        reach: 3 * M,
        enabled: () => isShone && !isScaleTaken,
        use: () => actionsRef.current.takeScale(),
        highlight: () => scaleGroup.current,
      }),
      registerInteractable({
        id: "cave-exit",
        position: CHAMBER_SPOTS.exit,
        label: "물길에 몸 맡기기",
        radius: 0.9 * M,
        reach: 3 * M,
        enabled: () => hasScale && leavingAt.current < 0,
        use: () => actionsRef.current.leave(),
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, isSolved, isShone, isScaleTaken, hasScale]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuChamberDev", {
      press: (k: number) => actionsRef.current.press(k),
      progress: () => progressRef.current,
      order: () => ORDER.map((symbol) => GLYPHS.indexOf(symbol)),
      solve: () => {
        progressRef.current = ORDER.length;
        setProgress(ORDER.length);
        actionsRef.current.solve();
      },
      takeScale: () => actionsRef.current.takeScale(),
      // 손이나 소지품의 큰 진주를 빼서 홈에 끼운다
      shine: () => {
        if (inventory.hand()?.kind === "bigPearl") inventory.releaseHand();
        else inventory.consume("bigPearl");
        actionsRef.current.shine();
      },
      lit: () => enteredAt.current >= 0,
      leave: () => actionsRef.current.leave(),
    });
  }, []);

  useEffect(() => () => setPuzzlePanel("cave-chamber", null), []);

  // 몸이 뚫고 지나가지 않게 — 석상 · 받침 · 등 · 돌 상자 · 진주 홈 바위 · 바위 틈 숨구멍
  useEffect(() => {
    if (!isShown) return undefined;
    const sx = Math.sin(SOCKET.yaw);
    const sz = Math.cos(SOCKET.yaw);
    return registerCaveObstacles([
      ...STATUE_X.map((x) => ({ x, z: STATUE_Z, radius: 0.55, top: INNER_FLOOR + 2.1, name: "석상" })),
      ...PEDESTAL_X.map((x) => ({
        x,
        z: PEDESTAL_Z,
        radius: 0.4,
        top: INNER_FLOOR + PEDESTAL_HEIGHT + 0.12,
        name: "받침",
      })),
      ...LAMPS.map(({ x, z }) => ({ x, z, radius: 0.28, top: INNER_FLOOR + ORB_Y + 0.15, name: "등" })),
      { x: BOX.x, z: BOX.z, radius: 0.78, top: INNER_FLOOR + BOX_TOP, name: "돌 상자" },
      { x: SOCKET.x - sx * 0.45, z: SOCKET.z - sz * 0.45, radius: 0.55, top: INNER_FLOOR + 1.6, name: "바위" },
      { x: CRACK.x, z: CRACK.z, radius: 0.5, top: INNER_FLOOR + 0.85, name: "바위" },
      { x: PEDESTAL_VENT.x, z: PEDESTAL_VENT.z, radius: 0.3, top: INNER_FLOOR + 0.55, name: "바위" },
      // 동쪽 숨구멍도 같은 바위 틈 — 충돌이 빠져 있어 몸이 바위를 지나갔다
      { x: PEDESTAL_VENT_EAST.x, z: PEDESTAL_VENT_EAST.z, radius: 0.3, top: INNER_FLOOR + 0.55, name: "바위" },
    ]);
  }, [isShown]);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = now();
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    // 물길에 빨려 든다
    if (leavingAt.current >= 0) {
      const isDone = pullIntoExit(
        time - leavingAt.current,
        leaveFrom.current,
        assets.blackMaterial,
        assets.whiteMaterial,
        time,
        dt,
      );
      if (isDone) {
        leavingAt.current = -1;
        finishLeave();
      }
    } else {
      if (assets.whiteMaterial.opacity > 0)
        assets.whiteMaterial.opacity = Math.max(0, assets.whiteMaterial.opacity - dt * 0.8);
      assets.blackMaterial.opacity = 0;
    }
    if (whiteout.current) {
      whiteout.current.visible = assets.whiteMaterial.opacity > 0.001;
      whiteout.current.position.copy(camera.position);
    }
    // 받침 너머 어둠 속으로 걸어 들어가면 — 다 풀기 전엔 눈앞도 캄캄하다
    const isInDark = solvedAt.current < 0 && pz > BACK_DARK_Z - 0.15 && px > INNER.x[0] - 0.5 && px < INNER.x[1] + 0.5;
    insideDark.current += ((isInDark ? 1 : 0) - insideDark.current) * Math.min(1, dt * (isInDark ? 10 : 3));
    setInsideDark(insideDark.current);
    if (blackout.current) {
      blackout.current.visible = assets.blackMaterial.opacity > 0.001;
      blackout.current.position.copy(camera.position);
    }
    const isSucking = leavingAt.current >= 0;

    // 들어서면 등이 켜진다 — 그 전엔 칠흑
    if (enteredAt.current < 0 && pz > INNER.z[0] - 0.3 && px > INNER.x[0] && px < INNER.x[1]) {
      enteredAt.current = time;
      audio.play("단서");
    }
    // 처음 들어서 방 안쪽으로 2 m 쯤 오면 — 들어온 아치 위 벽화(받침 순서의 단서)를 한 번 돌아보고 원래 보던 쪽으로(미르 11/10).
    // 입구에서 바로 돌면 벽화가 너무 가까워 잘린다(Codex 01). 이미 받침을 누르기 시작한 저장본은 건너뛴다
    if (muralGlance.current === "idle" && enteredAt.current >= 0 && !isSucking) {
      if (progressRef.current > 0 || solvedAt.current >= 0) {
        muralGlance.current = "done";
        setIsMuralGlanced(true);
      } else if (
        pz > MURAL_GLANCE_Z &&
        px > INNER.x[0] &&
        px < INNER.x[1] &&
        time - enteredAt.current > LIGHT_UP_SECONDS
      ) {
        const isFocused = focusCamera({
          id: MURAL_FOCUS_ID,
          target: muralTarget,
          hold: 2.4,
          turnIn: 0.8,
          turnOut: 0.7,
          zoom: 1.08,
          returnHome: true,
        });
        if (isFocused) {
          muralGlance.current = "focusing";
          showNotice("…저 벽화는 뭐지? 들어온 아치 위에 그림이 이어져 있다.", 4, { urgent: true });
        }
      }
    } else if (muralGlance.current === "focusing" && cameraFocusId() !== MURAL_FOCUS_ID) {
      muralGlance.current = "done";
      setIsMuralGlanced(true);
    }
    const light =
      enteredAt.current < 0 ? 0 : THREE.MathUtils.smootherstep((time - enteredAt.current) / LIGHT_UP_SECONDS, 0, 1);
    const solved = solvedAt.current >= 0;
    const follow = Math.min(1, dt * 2.2);
    // 석상 빛 — 받침 하나를 맞히면 아비사의 초롱, 셋째까지 맞히면 아랑사의 노 날(석상 이름을 기획대로: 노 젓는 어부 = 아랑사 ·
    // 초롱 든 처녀 = 아비사 — 뒤바뀌어 있던 것을 바로잡았다, 박람회 출품판 23회차). 틀려 처음으로 돌아가면 꺼진다
    abisaGlow.current += ((solved || progressRef.current >= 1 ? light : 0) - abisaGlow.current) * follow;
    arangsaGlow.current += ((solved || progressRef.current >= 3 ? light : 0) - arangsaGlow.current) * follow;
    // 받침 너머 어둠 — 다 맞히면 걷히며 안쪽(돌 상자 · 진주 홈)이 드러난다
    if (backVeil.current) {
      const reveal =
        solvedAt.current < 0
          ? 0
          : THREE.MathUtils.smootherstep((time - solvedAt.current - 0.3) / BACK_REVEAL_SECONDS, 0, 1);
      assets.backVeilMaterial.opacity = 1 - reveal;
      backVeil.current.visible = reveal < 0.999;
    }
    if (veil.current) {
      assets.veilMaterial.opacity = 1 - light;
      veil.current.visible = light < 0.999;
    }
    LAMPS.forEach((_, i) => {
      // 심지에 불이 붙듯 깜빡이다가 자리 잡는다
      const own = lampLevel(i, enteredAt.current, solvedAt.current, time);
      const flicker = own > 0 && own < 1 ? 0.75 + 0.25 * Math.sin(time * 37 + i * 3) : 1;
      assets.orbCores[i].color.copy(LAMP_OFF).lerp(LAMP_ON, own * flicker);
      assets.glows[i].opacity = own * 0.8 * flicker;
      const sprite = orbGlows.current[i];
      if (sprite) sprite.scale.setScalar(3.4 + 0.15 * Math.sin(time * 1.7 + i * 2));
      const lamp = orbLights.current[i];
      if (lamp) lamp.intensity = own * 0.9 * flicker;
    });

    // 벽화 — 들머리 등이 켜지면 보인다
    const mural = assets.mural.uniforms;
    mural.uLightOn.value = light;
    // 손에 든 큰 진주 — 둘레를 은은히 비춘다
    if (pearlLight.current) {
      pearlLight.current.position.copy(camera.position).divideScalar(M);
      pearlLight.current.intensity = isHoldingPearl && light > 0 ? 0.6 : 0;
    }
    // 벽화 장면 — 맞힌 수 + 1 장면까지 번지며 나타난다(다 맞히면 넷 다). 틀리면 첫 장면만 남는다
    const sceneTarget = Math.min(4, progress + 1);
    muralScenes.current =
      muralScenes.current < sceneTarget ? Math.min(sceneTarget, muralScenes.current + dt * 0.7) : sceneTarget;
    mural.uScenes.value = muralScenes.current;

    // 받침 — 누르면 머리판이 내려갔다 올라온다. 켜진 것은 그림이 희게 빛난다. 틀리면 그림이 한 번 붉게 번쩍이고 꺼진다
    const flash = flashAt.current >= 0 ? Math.max(0, 1 - (time - flashAt.current) / 0.5) : 0;
    PEDESTAL_X.forEach((_, k) => {
      const isLit = ORDER.indexOf(GLYPHS[k]) < progress;
      const face = faces.current[k];
      if (face) face.material = isLit ? assets.faceMaterials[k].on : assets.faceMaterials[k].off;
      assets.faceMaterials[k].off.color.setRGB(1, 1 - flash * 0.6, 1 - flash * 0.65);
      const cap = caps.current[k];
      if (cap) {
        const since = pressedAt.current[k] >= 0 ? time - pressedAt.current[k] : 99;
        // 0.12초에 걸쳐 내려갔다가 0.35초에 걸쳐 올라온다
        const pressed = since < 0.12 ? since / 0.12 : since < 0.47 ? 1 - (since - 0.12) / 0.35 : 0;
        // 틀린 뒤에는 머리판이 푹 가라앉았다가 물살이 잦아들며 올라온다
        const lockLeft = lockedUntil.current - time;
        const sunk = lockLeft > 0 ? Math.min(1, lockLeft / 0.6, (LOCKOUT_SECONDS - lockLeft) / 0.25 + 0.05) : 0;
        cap.position.y = PEDESTAL_HEIGHT + 0.06 - PRESS_DEPTH * pressed - SUNK_DEPTH * sunk;
      }
    });

    // 상자 벽화 — 맞힌 장면이 붓질처럼 그려진다. 틀리면 바래 지워진다. 다 그려져도 어둑하다가, 홈의 진주 빛이 닿으면 환해진다
    const sinceShone = shoneAt.current < 0 ? -1 : time - shoneAt.current;
    const lightIn = sinceShone < 0 ? 0 : THREE.MathUtils.smootherstep((sinceShone - BEAM_TRAVEL) / BOX_LIGHT_UP, 0, 1);
    // 빛이 닿는 순간 한 번 확 번졌다가 숨 쉬듯 자리 잡는다
    const surge = sinceShone < 0 ? 0 : Math.max(0, 1 - Math.abs(sinceShone - BEAM_TRAVEL - 0.35) / 0.45) * 0.5;
    const boxGlow = lightIn * (0.85 + 0.15 * Math.sin(time * 2.4)) + surge;
    assets.painted.forEach((panel, i) => {
      const at = paintedAt.current[i];
      if (at >= 0) panel.uniforms.uReveal.value = Math.min(1, (time - at) / PAINT_SECONDS);
      else if (at < -1) panel.uniforms.uReveal.value = Math.max(0, 1 - (time + at) / 0.6);
      else panel.uniforms.uReveal.value = 0;
      panel.uniforms.uGlow.value = boxGlow;
    });
    if (boxLight.current) boxLight.current.intensity = boxGlow * 6.5;
    // 진주 홈 — 끼우면 진주가 빛나고 빛줄기가 상자 오른쪽 벽화로 뻗는다
    if (socketPearl.current) {
      socketPearl.current.visible = sinceShone >= 0;
      if (sinceShone >= 0) socketPearl.current.scale.setScalar(Math.min(1, sinceShone / 0.25));
    }
    if (socketLight.current)
      socketLight.current.intensity =
        sinceShone < 0 ? 0 : Math.min(1, sinceShone / 0.4) * (1.1 + 0.15 * Math.sin(time * 3.1));
    if (pearlBeam.current) {
      pearlBeam.current.visible = sinceShone >= 0;
      if (sinceShone >= 0) placePearlBeam(pearlBeam.current, assets.beamMaterial, sinceShone, surge, time);
    }

    // 비늘 — 상자가 빛난 뒤 구멍 속에서 빛나며 떠올라 천천히 돈다
    const scaleStart = shoneAt.current < 0 ? -1 : shoneAt.current + SCALE_DELAY;
    const isScaleOut = scaleStart >= 0 && time >= scaleStart && !isScaleTaken;
    if (scaleGroup.current) scaleGroup.current.visible = isScaleOut;
    if (scaleGlow.current) scaleGlow.current.visible = isScaleOut;
    if (isScaleOut) {
      const { t, y } = scaleHeight(time - scaleStart, time);
      scaleGroup.current?.position.set(BOX.x, y, BOX.z);
      if (scaleGroup.current) scaleGroup.current.rotation.y = time * 0.6;
      assets.scaleGlowMaterial.opacity = 0.75 * t;
      scaleGlow.current?.position.set(BOX.x, y + 0.12, BOX.z);
      scaleGlow.current?.scale.setScalar(1.3 + 0.12 * Math.sin(time * 2.2));
      if (scaleLight.current) {
        scaleLight.current.position.set(BOX.x, y + 0.12, BOX.z);
        scaleLight.current.intensity = 1.2 * t;
      }
    } else if (scaleLight.current) scaleLight.current.intensity = 0;

    // 물살 — 구멍으로 빨려 든다. 비늘을 들면 빠르고 짙게, 빨려 드는 동안은 거세진다
    if (current.current) {
      const speed = isSucking ? 2.2 : hasScale ? 0.9 : 0.32;
      updateCurrent(assets.flow, assets.currentMaterial, speed, (hasScale ? 0.8 : 0.4) * light, time, dt);
    }

    // 안내판
    const distance = Math.hypot(px - BOX.x, pz - PEDESTAL_Z - 1);
    if (distance > PANEL_RANGE || isShone || light < 0.5) setPuzzlePanel("cave-chamber", null);
    else if (isSolved)
      setPuzzlePanel("cave-chamber", {
        distance,
        title: "바위 홈",
        rule: "상자 오른쪽 바위에 주먹만 한 둥근 홈이 파여 있다.\n빛나는 것을 손에 들고(숫자키) 홈을 겨눠 [E] 로 끼운다.",
        rows: [
          { label: "손에 든 것", value: isHoldingPearl ? "큰 진주" : hand ? "다른 것" : "빈손", ok: isHoldingPearl },
        ],
      });
    else
      setPuzzlePanel("cave-chamber", {
        distance,
        title: "석실 받침",
        rule: `들어온 아치 위 벽화에 있는 장면의 받침을 [E] 로 누른다.\n맞히면 벽화에 다음 장면이 나타난다. 틀리면 첫 장면만 남고, 물살에 숨이 ${WRONG_PRESS_BREATH}초 깎이며 받침이 ${LOCKOUT_SECONDS}초 가라앉는다.`,
        rows: [
          ...GLYPHS.map((symbol, k) => ({
            label: `받침 ${k + 1} — ${symbol}`,
            value: ORDER.indexOf(symbol) < progress ? "● 켜짐" : "○",
            ok: ORDER.indexOf(symbol) < progress,
          })),
          { label: "맞춘 수", value: `${progress} / ${ORDER.length}`, ok: progress === ORDER.length },
        ],
      });
  });

  if (!isShown) return null;
  const { currentMaterial, flow } = assets;
  return (
    <>
      <group scale={M}>
        {/* 칠흑 — 들어서기 전엔 방이 캄캄하다. 들어서면 등이 켜지며 걷힌다 */}
        <mesh
          ref={veil}
          material={assets.veilMaterial}
          position={[
            (INNER.x[0] + INNER.x[1]) / 2,
            (INNER_FLOOR + SURFACE_Y) / 2,
            (INNER.z[0] + INNER.z[1]) / 2 + 0.36,
          ]}
          renderOrder={10}
        >
          <boxGeometry
            args={[INNER.x[1] - INNER.x[0] + 1.4, SURFACE_Y - INNER_FLOOR + 0.4, INNER.z[1] - INNER.z[0] + 0.6]}
          />
        </mesh>
        {/* 받침 너머 어둠 — 넷을 다 맞히면 걷힌다 */}
        <mesh
          ref={backVeil}
          material={assets.backVeilMaterial}
          position={[
            (INNER.x[0] + INNER.x[1]) / 2,
            (INNER_FLOOR + SURFACE_Y) / 2,
            (BACK_DARK_Z + INNER.z[1] + 1.2) / 2,
          ]}
          renderOrder={9}
        >
          <boxGeometry
            args={[INNER.x[1] - INNER.x[0] + 1.6, SURFACE_Y - INNER_FLOOR + 0.6, INNER.z[1] + 1.2 - BACK_DARK_Z]}
          />
        </mesh>
        {/* 아치 위 벽화 — 어둠에 묻혀 있다가 등이 켜지면 드러난다 */}
        <mesh material={assets.mural.material} position={[45, MURAL.bottom + MURAL.height / 2, MURAL.z]}>
          <planeGeometry args={[MURAL.width, MURAL.height]} />
        </mesh>
        <pointLight ref={pearlLight} color="#EAF2F6" intensity={0} distance={6 * M} decay={1.5} />
        <Pedestals
          assets={assets}
          onCap={(k, group) => {
            caps.current[k] = group;
          }}
          onFace={(k, mesh) => {
            faces.current[k] = mesh;
          }}
        />
        <StoneBox assets={assets} lightRef={boxLight} />
        {/* 푸른 비늘 — 풀리면 구멍에서 떠오른다 */}
        <group ref={scaleGroup} visible={false}>
          <mesh
            geometry={assets.scaleGeometry}
            material={assets.scaleMaterial}
            scale={SCALE_SHOWN}
            position={[0, -0.03, 0]}
          />
        </group>
        <sprite ref={scaleGlow} material={assets.scaleGlowMaterial} visible={false} />
        <pointLight ref={scaleLight} color="#BFE6F5" intensity={0} distance={4 * M} decay={1.6} />
        <OrbLamps
          assets={assets}
          onGlow={(i, sprite) => {
            orbGlows.current[i] = sprite;
          }}
          onLight={(i, light) => {
            orbLights.current[i] = light;
          }}
        />
        <EntryStatues assets={assets} abisaGlow={abisaGlow} arangsaGlow={arangsaGlow} />
        <PearlSocket assets={assets} rockRef={socketRock} pearlRef={socketPearl} lightRef={socketLight} />
        <ExitRocks assets={assets} />
        <points ref={current} geometry={flow.geometry} material={currentMaterial} frustumCulled={false} />
      </group>
      <mesh ref={whiteout} material={assets.whiteMaterial} renderOrder={1000} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.5 * M, 12, 8]} />
      </mesh>
      <mesh ref={blackout} material={assets.blackMaterial} renderOrder={1001} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.45 * M, 12, 8]} />
      </mesh>
      <mesh
        ref={pearlBeam}
        geometry={assets.beamGeometry}
        material={assets.beamMaterial}
        visible={false}
        frustumCulled={false}
      />
      <ChamberVents />
    </>
  );
}
