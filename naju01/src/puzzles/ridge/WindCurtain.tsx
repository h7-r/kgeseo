/**
 * 바람 장막 — 증언 능선(Z4)에 들어서면 바람이 미친 듯이 휘몰아쳐 안개가 걷히고, 5 초 뒤 하늘이 소용돌이로 닫히며
 * 장막이 내려와 능선을 위·옆 통째로 덮는다. 엇갈린 두 돌새가 그날 밤부터 붙들고 있던 바람이다.
 *   갇힌 동안: 장막이 바람결대로 천천히 흐르고, 부딪힌 자리에서 물결치며, 돌멩이가 허공에 떠 있다.
 *   장막 안은 바람이 몸을 떠받쳐 달 위처럼 높이 뛴다(movement/gravityField) — 떠오른 수레바퀴를 붙잡는 데 쓴다.
 * 깨어난 새가 장막을 뚫고 나가는 순간, 뚫린 자리부터 양쪽으로 찢어지고 지붕은 가운데부터 열리며 위로 풀려 흩어진다.
 * 장막이 쳐져 있는 동안 밖으로는 못 나간다(movement/stageGates 가 ridge.isConfining 을 본다).
 */
import { gameClearTimeout, gameNow, gameSetTimeout } from "@/engine/input/gameClock";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { gravityField } from "../../movement/gravityField";
import { playerPose } from "../../movement/playerPose";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { focus } from "../../scene/immersion/focusFog";
import { fishTrapPuzzle } from "../fishTrap/fishTrapState";
import { pointScaleFor } from "../glowPoints";
import { teleportPlayer } from "../cave/caveState";
import { showNotice } from "../interaction";
import { inventory } from "../inventory";
import { ritual } from "../ritual/ritualState";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import { DEBRIS, SINK, buildCurtain, setPropWarmer, type Drifter } from "./curtainMesh";
import { CURTAIN, PLATFORM, curtainPoint, isInsideCurtain } from "./ridgeShape";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";

/** 들어선 뒤 바람만 부는 시간 → 지붕이 닫히고 → 벽이 내려온다(초) */
const WIND_ONLY = 5;
const LID_SECONDS = 2.2;
const DROP_START = WIND_ONLY + 1.2;
const DROP_SECONDS = 3.2;
const SEALED_AT = DROP_START + DROP_SECONDS + 0.4;
/** 장막이 찢어져 풀리는 시간(초) */
const RELEASE_SECONDS = 7;
/** 복원한 장막의 풀림이 시작된 지 오래됐다고 치는 초 */
const RESTORED_RELEASE_AGE = 1000;
/** 장막 안 중력 배율 — 점프 힘 1.1 배와 함께 0.55 m → 약 3 m, 떠 있는 시간 약 3.6 초 */
const LOW_GRAVITY = 0.215;
/** 바람이 잦아들면(장승 고리를 맞추면) 중력이 이만큼 더 붙는다 — 그래도 맨땅보다는 높이 뛴다 · 등짐을 지면 무거워 덜 뛴다 */
const CALM_GRAVITY = 0.95;
const LOAD_GRAVITY = 1.2;
/** 가벼운 곳으로 치는 중력 배율의 끝(gravityField.isLight 0.5 아래) — 잦아들고 등짐을 져도 맨땅보다는 높이 뛰게 */
const LIGHTEST_CAP = 0.46;
/** 잦아들면 떠다니는 것이 이만큼 낮아지고 · 느려진다 */
const CALM_LOWER = 0.55;
const CALM_SLOWER = 0.6;
/** 장막 안 걸음 배율(바람을 헤친다) · 등짐 배율 — 물속(0.52)보다는 가볍게 */
const CURTAIN_SPEED = 0.8;
const LOAD_SPEED = { none: 1, jige: 0.9, jigeChest: 0.72 };
/** 떠다니는 것이 몸에서 떨어져 있는 틈(m) · 몸을 막는 크기 아래쪽 한계(이보다 작은 돌은 비켜 가기만) */
const BODY_CLEARANCE = 0.42;
const SOLID_MIN_SIZE = 0.08;
/** 눈에서 발까지 · 눈 위 머리(m) */
const EYE = 1.25;
const HEAD = 0.15;

/** 바람 세기(소리 · 흔들림 배율) — 장막이 내려올 때 가장 세고, 잦아들면(calm) 절반 가까이로 */
function windFor(stage: string, sinceStage: number, calm: number) {
  if (stage === "sealing") return sinceStage < SEALED_AT ? (sinceStage < WIND_ONLY ? 4.3 : 6) : 3.4;
  if (stage === "sealed" || stage === "awakening" || stage === "circling") return 2.6 - 1.75 * calm;
  return null;
}

/** 떠다니는 큰 돌 · 소품은 몸을 막는다(위에 서지는 못한다) — 뚫고 지나가지 않게 */
const createBlocker = (): DynamicSolid => ({
  x: 0,
  z: 0,
  yaw: 0,
  halfX: 0.1,
  halfZ: 0.1,
  bottom: 0,
  top: 0,
  enabled: false,
  walkable: false,
});

const scratch = {
  matrix: new THREE.Matrix4(),
  quaternion: new THREE.Quaternion(),
  euler: new THREE.Euler(),
  position: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  point: { x: 0, z: 0, nx: 0, nz: 0 },
  clear: { x: 0, z: 0 },
};

/** 매 프레임 떠다니는 것들이 같이 보는 값 */
interface Breeze {
  /** 바람 시계(잦아들면 느리게 간다) · 잦아들어 낮아진 배율 · 장막이 내려온 정도 · 돌이 떠오른 정도 */
  windTime: number;
  lower: number;
  drop: number;
  floatIn: number;
  released: number;
  isReleasing: boolean;
  dt: number;
}

export default function WindCurtain() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const curtain = useMemo(() => buildCurtain(), []);
  const stage = useRidgeStage();
  // 이어 하기: 이미 찢어진 장막은 풀린 채로 시작한다. 아니면 다시 닫히는 동안 플레이어를 안으로 끌어당긴다.
  const [restoredFrom] = useState(ridge.releaseFrom);
  const releaseRef = useRef<{ startedAt: number; fromT: number } | null>(
    restoredFrom === null ? null : { startedAt: -RESTORED_RELEASE_AGE, fromT: restoredFrom },
  );
  const windCueAtRef = useRef(-99);
  const windClockRef = useRef(0);
  /** 몸을 막는 떠다니는 돌 · 소품 — 매 장면 자리를 옮긴다 */
  const solidsRef = useRef<{ floaters: (DynamicSolid | null)[]; props: DynamicSolid[] }>({ floaters: [], props: [] });
  const lastCalmRef = useRef(0);
  const toldTearRef = useRef(restoredFrom !== null);

  useEffect(() => {
    const objects = [
      curtain.wall,
      curtain.lid,
      curtain.debris.points,
      curtain.floaters,
      curtain.leaves,
      curtain.twigs,
      curtain.props,
    ];
    scene.add(...objects);
    // 장막 · 떠다니는 것은 능선에 들어서야 처음 보인다 — 그 순간 셰이더를 굽느라 멈추지 않게 미리 굽는다
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, objects), 3000);
    const warmProp = (holder: THREE.Object3D) => prewarmShaders(gl, scene, camera, [holder]);
    setPropWarmer(warmProp);
    for (const holder of curtain.props.children) if (holder.userData.ready) warmProp(holder);
    solidsRef.current = {
      floaters: curtain.floaterSeeds.map((seed) => (seed.size > SOLID_MIN_SIZE ? createBlocker() : null)),
      props: curtain.propSeeds.map(() => createBlocker()),
    };
    const removeSolids = [...solidsRef.current.floaters, ...solidsRef.current.props]
      .filter((solid): solid is DynamicSolid => !!solid)
      .map(addDynamicSolid);
    // 장막 안은 몸이 가볍고, 바람을 헤치느라 걸음은 느리다. 등짐을 지면 더 느리다
    const isIn = (x: number, z: number) => ridge.isConfining() && isInsideCurtain(x, z);
    gravityField.scaleAt = (x, z) =>
      isIn(x, z)
        ? Math.min(
            LIGHTEST_CAP,
            LOW_GRAVITY * (1 + CALM_GRAVITY * ridgeQuest.calm) * (ridgeCarry.load === "none" ? 1 : LOAD_GRAVITY),
          )
        : 1;
    gravityField.speedScaleAt = (x, z) => (isIn(x, z) ? CURTAIN_SPEED : 1) * LOAD_SPEED[ridgeCarry.load];
    return () => {
      window.clearTimeout(warm);
      setPropWarmer(null);
      scene.remove(...objects);
      removeSolids.forEach((remove) => remove());
      gravityField.scaleAt = null;
      gravityField.speedScaleAt = null;
      focus.lift = 0;
    };
  }, [scene, curtain, gl, camera]);

  // 단계가 바뀌는 순간의 소리·안내
  useEffect(() => {
    if (stage === "sealing") {
      audio.play("우르릉");
      showNotice("바람이 미친 듯이 휘몰아친다 — 능선을 덮던 안개가 한꺼번에 걷힌다.", 4);
      const timers = [
        gameSetTimeout(() => showNotice("하늘이 낮게 내려앉는다. 바람이 능선 위로 모여 소용돌이친다…", 3.5), 2600),
        gameSetTimeout(() => {
          audio.play("징");
          director.cue({ 카메라: "흔들림", 세기: 0.3 });
        }, WIND_ONLY * 1000),
        gameSetTimeout(
          () => {
            audio.play("우르릉");
            director.cue({ 카메라: "흔들림", 세기: 0.45 });
            showNotice("바람이 장막이 되어 능선을 위아래 통째로 덮었다 — 갇혔다.", 5);
          },
          (DROP_START + DROP_SECONDS * 0.7) * 1000,
        ),
      ];
      return () => timers.forEach(gameClearTimeout);
    }
    if (stage === "sealed") {
      showNotice("몸이 이상하게 가볍다. 장막 안에선 바람이 몸을 떠받친다 — 힘껏 뛰면 높이 뜬다.", 5);
      const timer = gameSetTimeout(
        () =>
          showNotice("엇갈린 두 돌새가 그날 밤의 바람을 붙들고 있다. 둘의 눈이 한곳에 맞아야 장막이 걷힐 것 같다.", 6),
        6000,
      );
      return () => gameClearTimeout(timer);
    }
    return undefined;
  }, [stage]);

  /** 몸과 겹치면 바깥으로 비켜 선 자리(미터) — 떠다니는 것은 사람을 뚫고 지나가지 않는다 */
  const keepClear = (x: number, y: number, z: number, radius: number) => {
    const { clear } = scratch;
    const eye = camera.position.y / M;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;
    clear.x = x;
    clear.z = z;
    if (y + radius < eye - EYE || y - radius > eye + HEAD) return clear;
    const dx = x - px;
    const dz = z - pz;
    const distance = Math.hypot(dx, dz);
    const need = radius + BODY_CLEARANCE;
    if (distance >= need) return clear;
    const nx = distance > 1e-4 ? dx / distance : 1;
    const nz = distance > 1e-4 ? dz / distance : 0;
    clear.x = px + nx * need;
    clear.z = pz + nz * need;
    return clear;
  };

  const placeBlocker = (solid: DynamicSolid | null | undefined, x: number, y: number, z: number, half: number) => {
    if (!solid) return;
    Object.assign(solid, { x, z, halfX: half, halfZ: half, bottom: y - half, top: y + half, enabled: true });
  };

  /** 먼지·잎 — 둘레를 따라 휘돈다. 풀릴 때는 위로 날려 흩어진다 */
  const updateDebris = (breeze: Breeze) => {
    const { debris, debrisSeeds } = curtain;
    debris.points.visible = curtain.wall.visible;
    if (!debris.points.visible) return;
    const { point } = scratch;
    const { windTime, drop, lower, released, dt } = breeze;
    for (let k = 0; k < DEBRIS; k++) {
      const seed = debrisSeeds[k];
      seed.t =
        (seed.t + seed.speed * dt * (1 - CALM_SLOWER * ridgeQuest.calm) * (1 + 0.5 * Math.sin(windTime * 0.7 + k))) % 1;
      curtainPoint(seed.t, point);
      const ground = groundY(point.x, point.z);
      const lift = released * released * 25 * (0.5 + seed.height);
      const y =
        ground + 0.3 + seed.height * CURTAIN.height * 0.6 * drop * lower + Math.sin(windTime * 2 + k) * 0.3 + lift;
      const out = seed.out;
      debris.position.setXYZ(k, (point.x + point.nx * out) * M, y * M, (point.z + point.nz * out) * M);
      debris.size.setX(k, seed.size * M);
      debris.alpha.setX(k, 0.55 * drop * (1 - released));
      if (seed.isLeaf) debris.color.setXYZ(k, 0.42, 0.45, 0.25);
      else debris.color.setXYZ(k, 0.62, 0.58, 0.5);
    }
    debris.commit();
    debris.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  };

  /** 허공에 뜬 돌멩이 — 장막이 다 내려오면 땅에서 떠올라 맴돌고, 풀리면 떨어진다 */
  const updateFloaters = (breeze: Breeze) => {
    const { matrix, quaternion, euler, position, scale } = scratch;
    const { windTime, lower, floatIn, isReleasing, dt } = breeze;
    curtain.floaters.visible = ridge.isAtLeast("sealing");
    if (!curtain.floaters.visible) {
      for (const solid of [...solidsRef.current.floaters, ...solidsRef.current.props]) if (solid) solid.enabled = false;
      return;
    }
    curtain.floaterSeeds.forEach((stone, k) => {
      let y: number;
      if (!isReleasing) {
        y =
          stone.ground + stone.size + (stone.height * lower + Math.sin(windTime * 0.6 + stone.phase) * 0.35) * floatIn;
        stone.fallY = y;
        stone.fallV = 0;
      } else {
        stone.fallV -= 9.8 * dt;
        stone.fallY = Math.max(stone.ground + stone.size * 0.6, stone.fallY + stone.fallV * dt);
        y = stone.fallY;
      }
      euler.set(stone.spin.x * windTime, stone.spin.y * windTime, stone.spin.z * windTime);
      quaternion.setFromEuler(euler);
      const at = keepClear(stone.x, y, stone.z, stone.size);
      position.set(at.x * M, y * M, at.z * M);
      placeBlocker(solidsRef.current.floaters[k], at.x, y, at.z, stone.size * 0.8);
      matrix.compose(
        position,
        quaternion,
        scale.set(stone.size, stone.size * stone.flat, stone.size).multiplyScalar(M),
      );
      curtain.floaters.setMatrixAt(k, matrix);
    });
    curtain.floaters.instanceMatrix.needsUpdate = true;
  };

  /** 나뭇잎·나뭇가지·소품 — 바람을 타고 천천히 맴돌며 뒤집힌다. 풀리면 떨어진다 */
  const updateDrifters = (breeze: Breeze) => {
    const { matrix, quaternion, euler, position, scale } = scratch;
    const { windTime, lower, floatIn, isReleasing, dt } = breeze;
    const isDrifting = ridge.isAtLeast("sealing");
    curtain.leaves.visible = isDrifting;
    curtain.twigs.visible = isDrifting;
    curtain.props.visible = isDrifting;
    if (!isDrifting) return;
    /** 자리와 자세를 scratch 에 적는다 */
    const place = (drifter: Drifter, swirl: number) => {
      const wander = windTime * 0.25 * drifter.drift + drifter.phase;
      const x = drifter.x + Math.sin(wander) * swirl;
      const z = drifter.z + Math.cos(wander * 0.8) * swirl;
      if (!isReleasing) {
        drifter.fallY =
          drifter.ground + 0.05 + (drifter.height * lower + Math.sin(windTime * 0.7 + drifter.phase) * 0.4) * floatIn;
        drifter.fallV = 0;
      } else {
        drifter.fallV -= 6 * dt;
        drifter.fallY = Math.max(groundY(x, z) + 0.03, drifter.fallY + drifter.fallV * dt);
      }
      const at = keepClear(x, drifter.fallY, z, drifter.size * 0.5);
      position.set(at.x * M, drifter.fallY * M, at.z * M);
      const tumble = isReleasing ? 0 : 1;
      euler.set(drifter.spin.x * windTime * tumble, drifter.spin.y * windTime, drifter.spin.z * windTime * tumble);
      quaternion.setFromEuler(euler);
    };
    curtain.leafSeeds.forEach((leaf, k) => {
      place(leaf, 1.4);
      matrix.compose(position, quaternion, scale.set(leaf.size, leaf.size, leaf.size * 1.6).multiplyScalar(M));
      curtain.leaves.setMatrixAt(k, matrix);
    });
    curtain.leaves.instanceMatrix.needsUpdate = true;
    curtain.twigSeeds.forEach((twig, k) => {
      place(twig, 0.9);
      matrix.compose(position, quaternion, scale.set(twig.size, 0.018, 0.018).multiplyScalar(M));
      curtain.twigs.setMatrixAt(k, matrix);
    });
    curtain.twigs.instanceMatrix.needsUpdate = true;
    curtain.props.children.forEach((holder, k) => {
      if (!holder.userData.ready) return;
      holder.visible = true;
      place(curtain.propSeeds[k], 1.1);
      holder.position.copy(position);
      placeBlocker(
        solidsRef.current.props[k],
        position.x / M,
        position.y / M,
        position.z / M,
        curtain.propSeeds[k].size * 0.4,
      );
      holder.quaternion.copy(quaternion);
    });
  };

  /** 장막 — 지붕이 닫히고 · 벽이 내려오고 · 부딪힌 자리에서 물결치고 · 찢어져 풀린다. 풀린 정도를 돌려준다 */
  const updateCurtain = (now: string, since: number, time: number) => {
    const { shared, wallMaterial, lidMaterial } = curtain;
    shared.uTime.value = time;
    const iris = now === "sealing" ? THREE.MathUtils.smootherstep(since - WIND_ONLY, 0, LID_SECONDS) : 1;
    const drop = now === "sealing" ? THREE.MathUtils.smootherstep(since - DROP_START, 0, DROP_SECONDS) : 1;
    lidMaterial.uniforms.uIris.value = iris;
    wallMaterial.uniforms.uDrop.value = drop;
    // 부딪힌 자리 물결 — 시각을 장면 시계로 옮겨 넣는다
    const touch = ridge.lastTouch();
    const hitHeight = camera.position.y / M - (groundY(camera.position.x / M, camera.position.z / M) - SINK);
    wallMaterial.uniforms.uHit.value.set(touch.t, hitHeight, time - (gameNow() / 1000 - touch.at));

    const from = ridge.releaseFrom();
    if (from !== null && !releaseRef.current) {
      releaseRef.current = { startedAt: time, fromT: from };
      audio.play("우르릉");
      director.cue({ 바람: 1, 초: 0.5 });
    }
    let released = 0;
    if (releaseRef.current) {
      released = THREE.MathUtils.clamp((time - releaseRef.current.startedAt) / RELEASE_SECONDS, 0, 1);
      wallMaterial.uniforms.uReleaseT.value = releaseRef.current.fromT;
      if (released > 0.35 && !toldTearRef.current) {
        toldTearRef.current = true;
        showNotice("새가 지나간 자리부터 장막이 찢어진다 — 지붕의 소용돌이도 풀려 하늘이 열린다.", 5);
      }
    }
    shared.uRelease.value = released;
    ridge.setCurtainClosed(drop * (1 - THREE.MathUtils.smoothstep(released, 0, 0.25)));
    curtain.wall.visible = drop > 0.001 && released < 0.999;
    curtain.lid.visible = iris > 0.001 && released < 0.999;
    return { drop, released };
  };

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    const now = ridge.stage();
    const since = ridge.elapsed();

    // 들어서면 시작 — 강변 비탈에서 능선 안쪽으로 2 m 넘게 들어섰을 때. 앞 스테이지(통발)를 건너뛴 시험은 받지 않는다
    if (now === "idle") {
      const x = camera.position.x / M;
      const z = camera.position.z / M;
      if (
        isInsideCurtain(x, z, 2) &&
        camera.position.y / M > 7 &&
        fishTrapPuzzle.stage() === "told" &&
        ritual.isAtLeast("cleared")
      ) {
        // 갇히기 전에 두고 온 물건을 챙긴다 — 푸른 눈물이 없으면 장막이 풀리지 않는다
        inventory.bringAlong(x, z);
        ridge.advance("sealing");
      }
      return;
    }
    if (now === "sealing" && since > SEALED_AT) ridge.advance("sealed");
    // 장막이 닫힐 때 밖에 있으면 어느 쪽으로도 못 움직인다 — 안으로 데려온다
    if (ridge.isConfining() && !isInsideCurtain(playerPose.x, playerPose.z, 0.6)) {
      teleportPlayer(PLATFORM.x - 2, PLATFORM.z + 2);
      // 밖에 내려놓은 물건도 함께 — 장막 밖은 다시 못 나간다
      inventory.bringAlong(PLATFORM.x - 2, PLATFORM.z + 2);
      showNotice("바람이 몸을 능선 안으로 밀어 넣었다.", 3.5);
    }

    // 바람·안개 — 장막이 있는 동안 안개를 걷어 바깥의 새 떼까지 보이게 한다.
    // 잦아듦은 장승 고리를 맞추면 몇 초에 걸쳐. 떠다니는 것은 바람 시계로 움직여 느려져도 튀지 않는다
    ridgeQuest.calm += ((ridgeQuest.postsSolved ? 1 : 0) - ridgeQuest.calm) * (1 - Math.exp(-dt * 0.5));
    windClockRef.current += dt * (1 - CALM_SLOWER * ridgeQuest.calm);
    const wind = windFor(now, since, ridgeQuest.calm);
    // 잦아드는 동안은 바로바로 세기를 새로 건다
    const hasCalmMoved = Math.abs(ridgeQuest.calm - lastCalmRef.current) > 0.05;
    if (wind !== null && (time - windCueAtRef.current > 3 || hasCalmMoved)) {
      lastCalmRef.current = ridgeQuest.calm;
      windCueAtRef.current = time;
      director.cue({ 바람: wind, 초: 4 });
    }
    const liftTarget = now === "done" ? 0 : 1;
    focus.lift += (liftTarget - focus.lift) * (1 - Math.exp(-dt * (liftTarget > focus.lift ? 1.6 : 0.35)));

    const { drop, released } = updateCurtain(now, since, time);
    const breeze: Breeze = {
      windTime: windClockRef.current,
      lower: 1 - CALM_LOWER * ridgeQuest.calm,
      drop,
      floatIn: now === "sealing" ? THREE.MathUtils.smoothstep(since, DROP_START, SEALED_AT + 1) : 1,
      released,
      isReleasing: releaseRef.current !== null,
      dt,
    };
    updateDebris(breeze);
    updateFloaters(breeze);
    updateDrifters(breeze);
  });

  return null;
}
