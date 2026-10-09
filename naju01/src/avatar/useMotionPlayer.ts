// 동작 고르기와 재생 — 상태 상자(AvatarLink)를 보고 클립을 고르고, 믹서로 섞어 튼다.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { AvatarLink } from "@/engine/avatarLink";

import type { ChibiAvatarConfig, PreparedBody } from "./preparedBody";
import { AUTO_MOTION } from "./sidekickOptions";

/** 자동 동작 고르기가 프레임을 넘어 들고 있는 시각들(초, clock 기준) */
export interface MotionTimers {
  airborneSince: number | null;
  wasAirborne: boolean;
  jumpStartEnd: number;
  landingEnd: number;
  lastAttack: number;
  attackEnd: number;
}

/**
 * 이번 프레임에 틀 클립 이름. config.motion 이 AUTO 가 아니면 그것을 그대로 쓴다.
 * 걷기는 언제나 걷기 클립. 달릴 때만 실제 속도에 보폭이 가장 가까운 클립을 고른다(남는 차이는 재생 속도로).
 */
export function chooseMotion(
  prepared: PreparedBody,
  state: AvatarLink,
  config: ChibiAvatarConfig,
  timers: MotionTimers,
  now: number,
  avatarScale: number,
): string {
  const pickByStride = (groundSpeed: number, candidates: string[]) => {
    let best = candidates[0];
    let bestError = Infinity;
    candidates.forEach((name) => {
      const own = prepared.strideFor(name) * avatarScale;
      if (own <= 1e-4) return;
      const error = Math.abs(Math.log(Math.max(1e-4, groundSpeed) / own));
      if (error < bestError) {
        bestError = error;
        best = name;
      }
    });
    return best;
  };

  if ((state.attackSerial ?? 0) !== timers.lastAttack) {
    timers.lastAttack = state.attackSerial ?? 0;
    const attackClip = state.attackMotion ? prepared.clipFor(state.attackMotion) : null;
    timers.attackEnd = now + THREE.MathUtils.clamp((attackClip?.duration ?? 0.62) / 1.2, 0.45, 0.82);
  }
  let next = config.motion;
  if (!next || next === AUTO_MOTION) {
    if (!state.grounded && timers.airborneSince === null) timers.airborneSince = now;
    if (state.grounded) timers.airborneSince = null;
    const confirmedAir =
      state.jumping || (!state.grounded && timers.airborneSince !== null && now - timers.airborneSince > 0.12);
    if (now < timers.attackEnd && state.attackMotion) next = state.attackMotion;
    else if (confirmedAir) {
      if (!timers.wasAirborne) timers.jumpStartEnd = now + 0.22;
      next = now < timers.jumpStartEnd ? "Jump_Start" : "Jump_Loop";
    } else if (timers.wasAirborne && state.grounded) {
      timers.landingEnd = now + 0.28;
      next = "Jump_Land";
    } else if (now < timers.landingEnd) next = "Jump_Land";
    else if (state.crouching) next = state.moving ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
    else if (state.moving) {
      next = state.running
        ? pickByStride(state.speed ?? 0, [config.runMotion || "Jog_Fwd_Loop", "Sprint_Loop"])
        : config.walkMotion || "Walk_Loop";
    } else next = "Idle_Loop";
    timers.wasAirborne = confirmedAir;
  }
  return next;
}

/** 몸(prepared)마다 믹서 하나. 몸이 바뀌면 하던 동작과 시각을 새 몸에 넘겨 이어 튼다. */
export function useMotionPlayer(prepared: PreparedBody) {
  const mixer = useMemo(() => new THREE.AnimationMixer(prepared.targetSkin), [prepared.targetSkin]);
  const actions = useRef(new Map<string, THREE.AnimationAction>());
  const currentMotion = useRef<string | null>(null);
  // 몸이 새로 만들어질 때(옷·성별) 하던 동작과 그 시각을 넘겨 주는 쪽지.
  const resumePose = useRef<{ motion: string | null; time: number; writtenAt: number } | null>(null);

  useEffect(
    () => () => {
      // 떠나기 전에 무엇을 몇 초째 돌고 있었는지 적어 둔다. 새 몸이 붙기까지(0.2초쯤) 더 돌려 놓는다.
      const current = currentMotion.current;
      const action = current ? actions.current.get(current) : undefined;
      resumePose.current = action ? { motion: current, time: action.time, writtenAt: performance.now() } : null;
      mixer.stopAllAction();
      actions.current.clear();
      // StrictMode 재실행 뒤에도 T포즈에 멈추지 않게 이름까지 비운다.
      currentMotion.current = null;
      mixer.uncacheRoot(prepared.targetSkin);
    },
    [mixer, prepared.targetSkin],
  );

  const play = (name: string) => {
    if (name === currentMotion.current) return;
    let action = actions.current.get(name);
    if (!action) {
      const clip = prepared.clipFor(name);
      if (!clip) return;
      action = mixer.clipAction(clip, prepared.targetSkin);
      actions.current.set(name, action);
    }
    const previous = currentMotion.current ? actions.current.get(currentMotion.current) : undefined;
    previous?.fadeOut(0.16);
    action.reset().setEffectiveTimeScale(name.startsWith("Punch_") ? 1.2 : 1);
    // 앞 동작이 없으면 섞지 않고 바로 100% — fadeIn 은 바인드 포즈와 섞여 갈아입을 때마다 움찔한다.
    if (previous) action.fadeIn(0.16);
    else action.setEffectiveWeight(1);
    // 옷만 갈아입었으면 하던 동작을 이어서 — 새 믹서는 0초부터라 걸음이 되감겨 보인다.
    const resume = resumePose.current;
    resumePose.current = null;
    if (resume && resume.motion === name) {
      const duration = action.getClip().duration;
      const elapsed = Math.max(0, (performance.now() - resume.writtenAt) / 1000);
      // 오래 떠나 있었으면(씬 전환·탭 멈춤) 이어 붙일 의미가 없다.
      if (duration > 0 && elapsed < 2) action.time = (resume.time + elapsed) % duration;
    }
    const loop = name.endsWith("_Loop") || name === "A_TPose" || name === "Sword_Idle";
    action.clampWhenFinished = !loop;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1).play();
    currentMotion.current = name;
  };

  return { mixer, actions, currentMotion, play };
}
