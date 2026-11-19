/**
 * 소화전 밸브 자물쇠를 풀면 맞은편 배전반도 같이 풀린다 — 그걸 보여 준다(미르 11/9 「사용자도 알게 해줘야」, 튜토피드백 10회차).
 * 새로 푼 때만: 자물쇠 카메라가 다 돌아오면 화면을 맞은편 배전반으로 돌리고, 도는 동안 배전반 문이 열린다.
 * 잠깐 본 뒤 처음 보던 소화전 쪽으로 돌아와 조작을 넘긴다 — 지금 꺼낼 관창은 소화전에 있다(Codex 10).
 * 서버 이어 하기(openInstantly)는 연출 없이 지나간다. 판정을 기다리다 ESC 로 먼저 나갔으면 화면은 안 돌리고 문 · 안내만.
 */
import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vector3Tuple } from "three";

import { gameSetTimeout } from "@/engine/input/gameClock";
import { overlayLayer } from "@/game/overlayLayer";
import { showToast } from "@/game/toast";
import { getLockControl, getLockState } from "@/props/combinationLockState";
import { openHinge } from "@/props/hingeState";
import { requestFlowFocus } from "@/props/shared/flowFocus";

import { startPanelRevealGlow } from "./panelRevealGlow";

const PANEL_TOAST = "맞은편 배전반 문도 함께 열렸다";
/** 고개를 돌려(약 0.8초) 배전반을 보는 시간까지 — 이미 긴 자물쇠 연출 뒤라 짧게(Codex 10: 0.6~0.8 + 0.6~0.8) */
const LOOK_SECONDS = 1.6;
/** 도는 도중 문이 열리기 시작해 다 돌았을 때 열린 문이 보이게 */
const DOOR_DELAY_MS = 300;
/** 이만큼(초) 안에 카메라를 못 넘겨받으면 화면은 안 돌린다 */
const EXPIRE_SECONDS = 3;
/** 배전반이 빛나는 시간 — 고개를 돌려 보고 돌아온 뒤에도 조금 더 */
const GLOW_SECONDS = 4.5;

interface PanelUnlockRevealProps {
  hydrantDoorId: string;
  panelDoorId: string;
  /** 배전반 문 앞면 가운데(월드) */
  panelCenter: Vector3Tuple;
}

export default function PanelUnlockReveal({ hydrantDoorId, panelDoorId, panelCenter }: PanelUnlockRevealProps) {
  const wasUnlocked = useRef<boolean | null>(null);
  /** 새로 풀렸고 자물쇠 카메라가 돌아오길 기다리는 중 — 풀린 순간 자물쇠를 만지고 있었나 */
  const armed = useRef<{ inControl: boolean } | null>(null);
  const centerRef = useRef(panelCenter);
  useLayoutEffect(() => {
    centerRef.current = panelCenter;
  });

  useFrame(() => {
    const lock = getLockState(hydrantDoorId);
    const isUnlocked = !!lock?.unlocked;
    if (wasUnlocked.current === null || !isUnlocked) {
      wasUnlocked.current = isUnlocked;
      return;
    }
    if (!wasUnlocked.current) {
      wasUnlocked.current = true;
      if (lock && !lock.openInstantly) {
        const control = getLockControl();
        armed.current = { inControl: control?.id === hydrantDoorId && control.phase === "active" };
      }
    }
    const arm = armed.current;
    // 자물쇠 카메라가 다 돌아와 조작이 끝날 때까지 기다린다(그 전에 돌리면 두 카메라가 싸운다)
    if (!arm || getLockControl()) return;
    armed.current = null;
    if (!arm.inControl || overlayLayer.get() !== null) {
      openHinge(panelDoorId);
      showToast(PANEL_TOAST, 5500);
      startPanelRevealGlow(GLOW_SECONDS);
      return;
    }
    const now = performance.now() / 1000;
    let isStarted = false;
    // 다른 연출이 카메라를 오래 쥐어 화면을 못 돌렸으면 문 · 안내만은 남긴다
    gameSetTimeout(
      () => {
        if (isStarted) return;
        openHinge(panelDoorId);
        showToast(PANEL_TOAST, 5500);
        startPanelRevealGlow(GLOW_SECONDS);
      },
      (EXPIRE_SECONDS + 0.1) * 1000,
    );
    requestFlowFocus({
      startedAt: now,
      seconds: 0,
      finalTarget: () => centerRef.current,
      holdUntil: () => 0,
      minHoldSeconds: LOOK_SECONDS,
      fovScale: 0.75,
      returnHome: true,
      expiresAt: now + EXPIRE_SECONDS,
      onStart: () => {
        isStarted = true;
        showToast(PANEL_TOAST, 5500);
        // 어두운 복도(완전 전원 전)에서도 보이게 배전반이 빛난다 — 돌아온 뒤에도 잠깐 더
        startPanelRevealGlow(GLOW_SECONDS);
        gameSetTimeout(() => openHinge(panelDoorId), DOOR_DELAY_MS);
      },
    });
  });

  return null;
}
