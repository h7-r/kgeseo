/**
 * 통발 퍼즐 — 그날 밤 꺼진 화톳불의 불티가 「빛 물고기」가 되어 물살을 따라 흘러 내려온다.
 * 조개를 미끼로 넣은 통발을 [E] 로 물에 굴려 넣는다 → 입구가 물살을 보는 통발에만 불티가 들고, 그 줄만 파르르 떨린다
 * → 떨린 줄을 골라 말뚝에서 [E] 로 당긴다(게이지) → 불씨 든 통발을 화톳불에 쏟으면 불이 붙는다(HearthFire).
 * 틀린 줄을 당기면 미역 줄기나 짚신이 든 빈 통발이 올라왔다 다시 가라앉는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { gameNow } from "@/engine/input/gameClock";

import { recall, remember, track } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";
import { clamDig, useClamStage } from "./clamState";
import { FULL_COUNT, fishTrapPuzzle, useFishTrapStage } from "./fishTrapState";
import { EMBER } from "./lightFish";
import {
  MIN_CATCH,
  POUR_SECONDS,
  createPourState,
  createSparks,
  poseForPour,
  startPour,
  updateCarriedEmbers,
  updateSparks,
} from "./pourEmbers";
import { isGaugeActive, startGauge, stopGauge } from "./pullGauge";
import {
  DEFAULT_LANE_Z,
  FISH_COUNT,
  LANE_OUT,
  buildSchool,
  buildStreaks,
  createFishes,
  updateShoreFish,
  updateStreaks,
} from "./shoreFish";
import {
  CATCHING_TRAP,
  SEAWEED_ROPE,
  SHOE_ROPE,
  STAKES,
  advanceTrap,
  adoptTrap,
  buildSeaweedTangle,
  buildStake,
  buildStrawShoe,
  copyTrapColors,
  findTrapSource,
  stakeTop,
  updateRope,
  updateTrapAnchors,
  type Trap,
} from "./trapRig";
import { createWaterSplash } from "./waterSplash";

/** 배치 무리를 다시 찾아보는 간격(초) — 배치 무리가 늦게 서거나 다시 서면 통발도 다시 읽는다 */
const SCAN_SECONDS = 1;
/** 게이지로 당기는 중 말뚝에서 이만큼(미터) 멀어지면 그만둔다 */
const GAUGE_LEAVE_RADIUS = 4;

const isBusyPlace = (trap: Trap) =>
  trap.place === "baiting" || trap.place === "rolling" || trap.place === "pulling" || trap.place === "returning";

/** 불씨 통발의 자리와 불씨 수를 저장된 단계에서 되돌린다 */
function restoreCatchingTrap(traps: Trap[]) {
  const trap = traps[CATCHING_TRAP];
  if (!trap) return;
  const stage = fishTrapPuzzle.stage();
  const isBaited = clamDig.stage() === "baited";
  if (stage === "pulled" || stage === "lit" || stage === "told") trap.place = "landed";
  else if (stage === "full" || isBaited) trap.place = "water";
  trap.caught = stage === "full" || stage === "pulled" ? FULL_COUNT : recall("fishTrap.caught", 0);
}

/** 맞는 통발이 물에 든 뒤 이만큼(초) 지나도 불씨가 안 들면 하나 넣어 준다 */
const FIRST_EMBER_SECONDS = 12;

export default function FishTrapPuzzle() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const stage = useFishTrapStage();
  const clamStage = useClamStage();
  const root = useMemo(() => new THREE.Group(), []);
  const trapsRef = useRef<Trap[]>([]);
  const sourceRef = useRef<THREE.InstancedMesh | null>(null);
  /** 통발이 다시 읽히거나 자리가 바뀔 때마다 오른다 — 상호작용 대상을 다시 건다 */
  const [trapVersion, setTrapVersion] = useState(0);
  const lightRef = useRef<THREE.PointLight>(null);
  const scanTimerRef = useRef(0);
  const laneZRef = useRef(DEFAULT_LANE_Z);
  /** 쏟기 진행 0~1. 아직이면 −1 */
  const pourRef = useRef(-1);
  /** 게이지로 당기는 중인 말뚝 — 멀어지면 그만둔다 */
  const pullingStakeRef = useRef(-1);
  const nextTugRef = useRef(0);
  /** 맞는 통발이 빈 채로 물에 들어간 때(게임 시계 ms — 멈춘 동안은 안 흐른다). 프레임 dt 는 상한이 있어 저사양에서 늘어난다 */
  const emptySinceRef = useRef<number | null>(null);
  const isShoeDroppedRef = useRef(recall("fishTrap.isShoeDropped", false));

  const pourState = useMemo(() => createPourState(), []);
  const sparks = useMemo(() => createSparks(), []);
  const splash = useMemo(() => createWaterSplash(), []);
  // 틀린 줄 통발에 든 것 — 통발을 따라다닌다
  const seaweed = useMemo(() => buildSeaweedTangle(), []);
  const shoe = useMemo(() => buildStrawShoe(), []);
  useEffect(() => {
    if (isShoeDroppedRef.current) shoe.visible = false;
    return track("fishTrap.caught", () => trapsRef.current[CATCHING_TRAP]?.caught);
  }, [shoe]);
  const stakes = useMemo(() => STAKES.map((_, index) => buildStake(index)), []);
  const stakeTops = useMemo(() => STAKES.map((_, index) => stakeTop(index)), []);
  const ropeMaterials = useMemo(() => STAKES.map((stake) => makeToonMaterial(stake.color)), []);

  const fishTime = useMemo(() => ({ value: 0 }), []);
  const fishes = useMemo(() => createFishes(), []);
  const school = useMemo(() => buildSchool(fishTime), [fishTime]);
  const halos = useMemo(() => makeGlowPoints(FISH_COUNT, { additive: true }), []);
  const streaks = useMemo(() => buildStreaks(), []);
  // 건져 올린 통발 안의 물고기와 불씨 — 잡힌 모습 그대로 보이고, 쏟으면 하나씩 떨어진다
  const caughtFish = useMemo(() => buildSchool(fishTime, FULL_COUNT), [fishTime]);
  const caughtEmbers = useMemo(() => makeGlowPoints(FULL_COUNT, { additive: true }), []);

  useEffect(() => {
    root.add(
      school,
      halos.points,
      streaks.mesh,
      caughtEmbers.points,
      caughtFish,
      sparks.points.points,
      splash.group,
      seaweed,
      shoe,
      ...stakes,
    );
    scene.add(root);
    return () => {
      scene.remove(root);
      if (sourceRef.current) sourceRef.current.visible = true;
    };
  }, [root, scene, school, halos, streaks, caughtEmbers, caughtFish, sparks, splash, stakes, seaweed, shoe]);

  /** 배치 무리에서 통발을 읽어 퍼즐 통발로 바꿔 끼운다 */
  const adoptTraps = (source: THREE.InstancedMesh) => {
    const previous = trapsRef.current;
    for (const trap of previous) root.remove(trap.object, trap.rope);
    source.geometry.computeBoundingBox();
    const traps = Array.from({ length: source.count }, (_, index) =>
      adoptTrap(source, index, previous[index], ropeMaterials),
    );
    for (const trap of traps) root.add(trap.object, trap.rope);
    // 처음 읽을 때만 — 저장본의 단계에 맞는 자리에 통발을 둔다. 지나간 이동 연출은 다시 돌지 않는다.
    if (!previous.length) restoreCatchingTrap(traps);
    source.visible = false;
    sourceRef.current = source;
    copyTrapColors(source, traps);
    if (traps.length)
      laneZRef.current = traps.reduce((sum, trap) => sum + trap.waterPosition.z / M, 0) / traps.length + LANE_OUT;
    trapsRef.current = traps;
    setTrapVersion((version) => version + 1);
  };

  const trapActionRef = useRef<(trap: Trap) => void>(() => {});
  const stakeActionRef = useRef<(stake: number) => void>(() => {});
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFishTrapDev", {
      traps: () => trapsRef.current,
      throwIn: (index: number) => {
        const trap = trapsRef.current[index];
        if (trap) trapActionRef.current(trap);
      },
      pull: (stake: number) => stakeActionRef.current(stake),
      pour: () => {
        const trap = trapsRef.current.find((entry) => entry.place === "landed" && entry.index === CATCHING_TRAP);
        if (trap) trapActionRef.current(trap);
      },
    });
  }, []);

  useEffect(() => {
    if (!trapVersion) return undefined;
    const traps = trapsRef.current;
    const isBusy = () => traps.some(isBusyPlace);
    const canPour = (trap: Trap) =>
      trap.place === "landed" && fishTrapPuzzle.stage() === "pulled" && pourRef.current < 0;

    const handleTrap = (trap: Trap) => {
      if (trap.place === "shore") {
        // 미끼 없이는 넣지 않는다 — 통발 바닥의 조개껍데기가 무엇을 캐야 하는지 알려 준다
        if (clamDig.stage() !== "held") {
          showNotice("통발 바닥에 깨진 조개껍데기가 붙어 있다. 직접 캔 미끼가 필요하다.");
          return;
        }
        clamDig.putInto(trap);
        trap.place = "baiting";
      } else if (canPour(trap)) {
        pourRef.current = 0;
        startPour(pourState, trap);
        audio.play("첨벙");
      }
      setTrapVersion((version) => version + 1);
    };
    const pullStake = (stake: number) => {
      const trap = traps.find((entry) => entry.stake === stake);
      if (!trap || isBusy()) return;
      if (traps.some((entry) => entry.place === "shore" || entry.place === "baiting")) {
        // 줄 색을 말하면 어느 줄이 그 통발 것인지 드러난다(상황조사 B02)
        showNotice("뭍에 있는 통발을 먼저 물에 넣어야 한다.");
        return;
      }
      if (trap.place !== "water" || isGaugeActive()) return;
      // 게이지 — 가운데에서 [E] 세 번이면 올라온다. 맞출 때마다 줄이 당겨지며 물이 튄다
      pullingStakeRef.current = stake;
      startGauge(`${STAKES[stake].rope} 당기기`, {
        onHit: () => {
          trap.tug = 1;
          trap.splashPending = true;
          audio.play("첨벙");
        },
        onDone: () => {
          pullingStakeRef.current = -1;
          // 맞는 통발이면 적어도 넷은 들어 있다
          if (trap.index === CATCHING_TRAP && trap.caught > 0)
            trap.caught = Math.min(FULL_COUNT, Math.max(MIN_CATCH, trap.caught));
          trap.place = "pulling";
          trap.motion = 0;
          trap.tug = 1;
          trap.splashPending = true;
          setTrapVersion((version) => version + 1);
        },
      });
      setTrapVersion((version) => version + 1);
    };
    trapActionRef.current = handleTrap;
    stakeActionRef.current = pullStake;

    const disposers = [
      ...traps.map((trap) =>
        registerInteractable({
          id: `fish-trap-${trap.index}`,
          position: trap.center,
          label:
            trap.place === "landed"
              ? "불씨를 화톳불에 쏟기"
              : clamStage === "held"
                ? "조개를 미끼로 넣고 물에 굴려 넣기"
                : "통발 살펴보기",
          radius: 0.6 * M,
          reach: 3.4 * M,
          enabled: () => trap.place === "shore" || canPour(trap),
          use: () => handleTrap(trap),
        }),
      ),
      ...STAKES.map((stake, index) =>
        registerInteractable({
          id: `fish-trap-stake-${index}`,
          position: stakeTops[index],
          label: `${stake.rope} 당기기`,
          radius: 0.45 * M,
          reach: 3 * M,
          enabled: () => {
            const now = fishTrapPuzzle.stage();
            return (now === "idle" || now === "full") && !isBusy() && !isGaugeActive();
          },
          use: () => pullStake(index),
        }),
      ),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [trapVersion, stage, stakeTops, pourState, clamStage]);

  /** 통발이 뭍에 올라왔다 — 든 것에 따라 알린다. 불씨가 하나라도 들었으면 건진 것이다 */
  const handleLanded = (trap: Trap) => {
    const rope = STAKES[trap.stake].rope;
    if (trap.index === CATCHING_TRAP && trap.caught > 0) {
      fishTrapPuzzle.pull();
      audio.play("단서");
      showNotice("불씨 든 통발이 올라왔다. 그날 밤 꺼진 화톳불의 불티들이다.");
    } else if (rope === SEAWEED_ROPE) {
      audio.play("첨벙");
      showNotice("미역 줄기만 잔뜩 엉켜 올라왔다. 물고기 대신 미역국 거리다.", 3.5);
    } else if (rope === SHOE_ROPE && !isShoeDroppedRef.current) {
      // 짚신을 털어 통발 앞 뭍에 떨군다 — 주워 두면 단서(안 주워도 풀린다)
      isShoeDroppedRef.current = true;
      remember("fishTrap.isShoeDropped", true);
      shoe.visible = false;
      const drop = trap.landPosition.clone().add(new THREE.Vector3(-0.5 * M, 0, -0.45 * M));
      drop.y = groundY(drop.x / M, drop.z / M) * M;
      inventory.spawn("strawShoe", drop);
      audio.play("단서");
      showNotice("통발 안에 큰 짚신 한 짝이 걸려 있었다. 어부의 신이다 — 신코에 물고기 하나가 새겨져 있다.", 5);
    } else {
      showNotice("빈 통발이다. 물만 줄줄 흐른다.");
    }
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    fishTime.value = time;

    scanTimerRef.current -= dt;
    if (scanTimerRef.current <= 0) {
      scanTimerRef.current = SCAN_SECONDS;
      const source = findTrapSource(scene);
      if (source && source !== sourceRef.current) adoptTraps(source);
      else if (source) {
        source.visible = false;
        copyTrapColors(source, trapsRef.current);
      }
    }
    const traps = trapsRef.current;
    if (!traps.length) return;
    if (pullingStakeRef.current >= 0) {
      if (!isGaugeActive()) pullingStakeRef.current = -1;
      else if (state.camera.position.distanceTo(stakeTops[pullingStakeRef.current]) > GAUGE_LEAVE_RADIUS * M) {
        stopGauge();
        pullingStakeRef.current = -1;
      }
    }
    const currentStage = fishTrapPuzzle.stage();
    const isHearthLit = currentStage === "lit" || currentStage === "told";
    const isPouring = (trap: Trap) => trap.index === CATCHING_TRAP && pourRef.current >= 0;

    // 통발 — 자리마다 움직이고, 틀린 줄 통발 속 것과 줄이 따라간다
    let changed = false;
    for (const trap of traps) {
      changed =
        advanceTrap(trap, dt, {
          isBaitIn: () => clamDig.stage() === "baited",
          isPouring,
          staysAshore: (entry) => entry.index === CATCHING_TRAP && currentStage !== "idle" && currentStage !== "full",
          onLanded: handleLanded,
        }) || changed;
      if (trap.place === "landed" && isPouring(trap))
        poseForPour(trap, Math.min(1, pourRef.current), pourState.startQuaternion);
      updateTrapAnchors(trap);

      const rope = STAKES[trap.stake].rope;
      if (rope === SEAWEED_ROPE) {
        seaweed.position.copy(trap.center);
        seaweed.quaternion.copy(trap.object.quaternion);
      } else if (rope === SHOE_ROPE && !isShoeDroppedRef.current) {
        shoe.position.copy(trap.center);
        shoe.position.y -= 0.08 * M;
        shoe.quaternion.copy(trap.object.quaternion);
      }
      trap.tug = Math.max(0, trap.tug - dt * 1.6);
      const surface = updateRope(trap, stakeTops[trap.stake], time);
      if (trap.splashPending && surface) {
        splash.trigger(surface, trap.tug);
        trap.splashPending = false;
      }
    }
    if (changed) setTrapVersion((version) => version + 1);

    // 찬 뒤에도 불티가 부딪혀 그 줄만 이따금 떨린다 — 어느 줄을 당길지의 단서
    const catching = traps[CATCHING_TRAP] ?? null;
    // 첫 불씨 대기 상한 — 물고기가 물살을 타고 드는 데 운에 따라 30초 넘게 걸리기도 했다(박람회판 정리 · 미르 11/8).
    // 이만큼 지나도 안 들면 줄이 떨리며 「찼다」로 넘어간다
    if (catching && catching.place === "water" && catching.caught === 0) {
      emptySinceRef.current ??= gameNow();
      if (gameNow() - emptySinceRef.current > FIRST_EMBER_SECONDS * 1000) {
        catching.caught = 1;
        catching.tug = 1;
        catching.splashPending = true;
        audio.play("똑");
        fishTrapPuzzle.fill();
      }
    } else emptySinceRef.current = null;
    if (catching && catching.place === "water" && catching.caught > 0) {
      nextTugRef.current -= dt;
      if (nextTugRef.current <= 0) {
        nextTugRef.current = 1.4 + ((time * 7.3) % 1.6);
        catching.tug = 1;
        catching.splashPending = true;
      }
    }

    updateShoreFish(fishes, school, halos, catching, laneZRef.current, time, dt);
    updateStreaks(streaks, laneZRef.current, dt);

    // 건져 올린 통발 안 불씨 — 맞는 통발이 끌려 올라오는 순간부터 함께 딸려 온다
    const carrier =
      catching &&
      catching.caught > 0 &&
      (catching.place === "pulling" || catching.place === "landed" || catching.place === "returning")
        ? catching
        : null;
    if (pourRef.current >= 0 && pourRef.current < 1) {
      pourRef.current = Math.min(1, pourRef.current + dt / POUR_SECONDS);
      if (pourRef.current >= 1) fishTrapPuzzle.light();
    }
    const remaining = updateCarriedEmbers({
      carrier,
      pour: pourRef.current,
      isHearthLit,
      pourState,
      sparks,
      caughtFish,
      caughtEmbers,
      time,
    });
    updateSparks(sparks, dt);

    const pointScale = pointScaleFor(gl, state.camera);
    halos.material.uniforms.uPointScale.value = pointScale;
    caughtEmbers.material.uniforms.uPointScale.value = pointScale;
    sparks.points.material.uniforms.uPointScale.value = pointScale;
    splash.update(dt, time, pointScale);

    // 건져 올린 통발이 둘레를 밝힌다
    const light = lightRef.current;
    if (light) {
      if (carrier) light.position.copy(carrier.center);
      const want = carrier && !isHearthLit ? 2 * (remaining / FULL_COUNT) : 0;
      light.intensity += (want - light.intensity) * Math.min(1, dt * 3);
    }
  });

  // 빛은 처음부터 붙여 두고 세기만 바꾼다 — 나중에 붙이면 모든 재질의 셰이더가 다시 컴파일돼 한 번 멈춘다
  return <pointLight ref={lightRef} color={EMBER} intensity={0} distance={5 * M} decay={1.4} />;
}
