// 동작 고르기와 재생 — 상태 상자(AvatarLink)를 보고 클립을 고르고, 믹서로 섞어 튼다.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { AvatarAction, AvatarLink } from "@/engine/avatarLink";

import { QUATERNIUS_PREFIX } from "./chibiClipLibrary";
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
  /** 끊긴 인사 동작(serial) — 멈춘 뒤에 다시 살아나지 않게 */
  canceledEmote?: number;
  /** 이번 프레임 동작의 회차 표시 — 같은 클립이라도 이 값이 바뀌면 처음부터(연달아 맞기 등) */
  restartKey?: string | null;
  /** 인사·맞기 단계가 정한 재생 속도(없으면 null) */
  actionSpeed?: number | null;
  /** 인사·맞기 단계가 정한 몸 들어 올림(세계 유닛) */
  actionLift?: number;
  /** 가만히 서 있기 시작한 시각(clock 초) — 움직이거나 다른 동작이 나오면 비운다 */
  stillSince?: number | null;
  /** 서 있다 트는 「말하며 대기」가 끝나는 시각 */
  fidgetUntil?: number;
}

/**
 * 대기 자세 — 2026-11-07 미르가 동작 보기 화면(motion-gallery.html)에서 고름. 남성은 Quaternius 기본 대기,
 * 여성은 지금처럼 Tripo 「허리에 손」. Tripo 를 안 쓰는 몸(동작 출처 sidekick)은 둘 다 Quaternius 대기가 된다.
 */
const IDLE_MOTION = { masculine: `${QUATERNIUS_PREFIX}Idle_Loop`, feminine: "Idle_Loop" } as const;
/** 이만큼(초) 가만히 서 있으면 「말하며 대기」를 한 번 틀고 돌아온다(미르 11/7) */
export const IDLE_FIDGET_AFTER_SECONDS = 10;
const IDLE_FIDGET_MOTION = "Idle_Talking_Loop";
/** Idle_Talking_Loop 한 바퀴(GLB 2.93초) */
const IDLE_FIDGET_SECONDS = 2.93;

/** 지금 틀 단계(시작 시각부터 단계 길이를 차례로 더해 고른다). 끝났거나 아직이면 null */
function activeStep(action: AvatarAction | undefined, wallSeconds: number) {
  if (!action) return null;
  let elapsed = wallSeconds - action.at;
  if (elapsed < 0) elapsed = 0;
  for (let index = 0; index < action.steps.length; index += 1) {
    const step = action.steps[index];
    if (elapsed < step.seconds) return { motion: step.motion, index, step, progress: elapsed / step.seconds };
    elapsed -= step.seconds;
  }
  return null;
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
  timers.restartKey = null;
  timers.actionSpeed = null;
  timers.actionLift = 0;
  let next = config.motion;
  if (!next || next === AUTO_MOTION) {
    if (!state.grounded && timers.airborneSince === null) timers.airborneSince = now;
    if (state.grounded) timers.airborneSince = null;
    const confirmedAir =
      state.jumping || (!state.grounded && timers.airborneSince !== null && now - timers.airborneSince > 0.12);
    // 인사·맞기는 벽시계로 잰다(몸을 안 그리던 동안 지난 것은 건너뛴다). 펀치 > 인사, 맞기 > 모두
    const wall = performance.now() / 1000;
    const hitStep = activeStep(state.hit, wall);
    const emoteStep = state.emote && state.emote.serial !== timers.canceledEmote ? activeStep(state.emote, wall) : null;
    const attacking = now < timers.attackEnd && !!state.attackMotion;
    // 인사는 서서만 — 움직이거나 공중·착지·앉기·맞기면 끊고, 끊긴 것은 다시 살리지 않는다
    const emoteBlocked =
      !!hitStep ||
      state.moving ||
      confirmedAir ||
      state.crouching ||
      (timers.wasAirborne && state.grounded) ||
      now < timers.landingEnd;
    if (emoteStep && emoteBlocked && state.emote) timers.canceledEmote = state.emote.serial;
    const applyStep = (active: NonNullable<typeof hitStep>) => {
      timers.actionSpeed = active.step.speed ?? null;
      timers.actionLift = (active.step.lift ?? 0) * Math.sin(Math.PI * active.progress);
    };
    if (hitStep && state.hit) {
      next = hitStep.motion;
      timers.restartKey = `hit:${state.hit.serial}:${hitStep.index}`;
      applyStep(hitStep);
    } else if (attacking) {
      next = state.attackMotion as string;
      timers.restartKey = `attack:${timers.lastAttack}`;
    } else if (emoteStep && !emoteBlocked && state.emote) {
      next = emoteStep.motion;
      timers.restartKey = `emote:${state.emote.serial}:${emoteStep.index}`;
      applyStep(emoteStep);
    }
    if (hitStep || attacking || (emoteStep && !emoteBlocked)) {
      // 점프·착지 판정은 계속 갱신한다(동작이 끝난 뒤 공중에 있으면 바로 점프 동작으로)
      timers.wasAirborne = confirmedAir;
      // 인사·펀치·맞기도 「움직임」이다 — 서 있던 시간을 새로 센다
      timers.stillSince = null;
      timers.fidgetUntil = 0;
    } else if (confirmedAir) {
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
    } else {
      // 가만히 서 있음 — 성별 대기, 10초가 지나면 「말하며 대기」 한 바퀴 뒤 다시 대기(시계를 새로 센다)
      timers.stillSince ??= now;
      if (now < (timers.fidgetUntil ?? 0)) next = IDLE_FIDGET_MOTION;
      else if (now - timers.stillSince >= IDLE_FIDGET_AFTER_SECONDS) {
        timers.fidgetUntil = now + IDLE_FIDGET_SECONDS;
        timers.stillSince = timers.fidgetUntil;
        next = IDLE_FIDGET_MOTION;
      } else next = IDLE_MOTION[config.gender === "masculine" ? "masculine" : "feminine"];
    }
    // 서 있는 대기가 아니면(이동·공중·착지·앉기) 서 있던 시간을 비우고 말하던 것도 끊는다
    const standingStill =
      next === IDLE_FIDGET_MOTION || next === IDLE_MOTION.masculine || next === IDLE_MOTION.feminine;
    if (!standingStill) {
      timers.stillSince = null;
      timers.fidgetUntil = 0;
    }
    timers.wasAirborne = confirmedAir;
  }
  return next || "Idle_Loop";
}

/**
 * 몸을 그리지 않는 프레임(1인칭 등)에도 인사 취소만은 적는다 — 숨어 있는 동안 움직였던 인사가 3인칭으로 돌아왔을 때
 * 다시 살아나지 않게(Codex 10). 판정은 chooseMotion 의 emoteBlocked 와 같은 기준(움직임·공중·앉기·맞기).
 */
export function noteHiddenActions(state: AvatarLink, timers: MotionTimers) {
  const emote = state.emote;
  if (!emote || emote.serial === timers.canceledEmote) return;
  const wall = performance.now() / 1000;
  if (!activeStep(emote, wall)) return;
  if (state.moving || !state.grounded || state.jumping || state.crouching || activeStep(state.hit, wall)) {
    timers.canceledEmote = emote.serial;
  }
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

  const currentKey = useRef<string | null>(null);
  /** restartKey: 같은 클립이라도 이 값이 바뀌면 처음부터(연달아 맞기). 주지 않으면 예전처럼 이름만 본다 */
  const play = (name: string, restartKey: string | null = null) => {
    if (name === currentMotion.current && (restartKey === null || restartKey === currentKey.current)) return;
    currentKey.current = restartKey;
    if (name === currentMotion.current) {
      // 같은 클립을 처음부터 — 섞을 앞 동작이 자기 자신이라 바로 되감는다
      actions.current.get(name)?.reset().play();
      return;
    }
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
