import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { isPublicAssetsSettled } from "../loaders/publicAssets";
import { guardBreath } from "../puzzles/cave/caveState";

/** 이만큼(프레임) 새 셰이더가 없으면 다 구운 것으로 본다 */
const STABLE_FRAMES = 8;
/** 끝내 안 가라앉아도 이만큼(ms) 뒤에는 알린다 — 덮개가 안 걷히는 것이 제일 나쁘다 */
const MAX_WAIT_MS = 6000;

/**
 * Canvas 안에 둔다. 장면이 「가라앉으면」 한 번 알린다 — 소품을 다 세웠고(publicAssets) 새 셰이더가 더 안 생길 때.
 * 전에는 세 프레임 뒤에 바로 알렸는데, 알리면 시작 카드가 떠 프레임이 멈추므로 프레임에 기대는 준비(소품 세우기 ·
 * 덧댐 · 처음 그리는 재질의 셰이더)가 전부 「조사 시작」을 누른 직후로 밀려 그 프레임이 멈췄다(11/16 실측 0.7초).
 * 로딩 덮개 뒤에서 끝내고 걷는다
 */
interface SceneSettledSignalProps {
  /** 소품을 다 세웠을 때 한 번 — 화면 밖 · 아직 안 그려진 소품의 셰이더를 이때 한 번 더 굽는다 */
  onAssetsSettled?: () => void;
  onSettled: () => void;
}

export function SceneSettledSignal({ onAssetsSettled, onSettled }: SceneSettledSignalProps) {
  const state = useRef({ frames: 0, startedAt: 0, programs: -1, stable: 0, hasAssets: false, isDone: false });
  // 가라앉기를 기다리는 동안에도 프레임은 돈다 — 물굴 안에서 이어 하면 덮개 뒤에서 숨이 줄어든다(Codex 리뷰). 그동안 숨을 지킨다
  const releaseBreath = useRef<(() => void) | null>(null);
  useEffect(() => {
    releaseBreath.current = guardBreath("scene-settling");
    return () => releaseBreath.current?.();
  }, []);
  useFrame(({ gl }) => {
    const s = state.current;
    if (s.isDone) return;
    const now = performance.now();
    if (s.frames++ === 0) s.startedAt = now;
    const programs = gl.info.programs?.length ?? 0;
    if (programs === s.programs) s.stable += 1;
    else {
      s.programs = programs;
      s.stable = 0;
    }
    if (!s.hasAssets && s.frames >= 3 && isPublicAssetsSettled()) {
      s.hasAssets = true;
      s.stable = 0;
      onAssetsSettled?.();
    }
    const isSettled = s.hasAssets && s.stable >= STABLE_FRAMES;
    if (!isSettled && now - s.startedAt < MAX_WAIT_MS) return;
    s.isDone = true;
    releaseBreath.current?.();
    onSettled();
  });
  return null;
}
