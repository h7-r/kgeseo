/**
 * 함 놓을 자리 안내 — 새가 떨어뜨린 열쇠를 주운 뒤 함을 어디에 내려놔야 할지 도저히 알 수 없었다(미르 11/10 「헤맬 필요가 없는 지점」).
 *   1. 열쇠와 함을 다 가졌고(소지품 · 손) 아직 함을 안 놓았으면 불탄 평상 위에 따뜻한 빛 — 「여기에 무언가 올려놓을 자리」.
 *   2. 동행이 한 번 말한다: 「그 열쇠라면 함을 열 수 있겠어요. 저 불탄 평상 위에 올려 볼까요?」(말투 두 벌, 끝까지 들으면 저장).
 *   3. 조작할 수 있는 시간이 REMIND_SECONDS 지나도 안 놓으면 알림 한 번 더(저장 안 함 — 다시 들어오면 또).
 *   4. 함을 놓으면 평상 빛은 걷히고, 열쇠가 있으면 자물통 열쇠 구멍에 작은 금빛 — 다음에 할 곳으로 빛을 옮긴다(Codex 01).
 * 바닥에 떨어진 함도 그 자리에서 열 수 있다(BoxOpening) — 이미 놓았으면 평상으로 보내지 않는다.
 * 동행 말은 CompanionFishLore 와 같은 틀(StoryTalk · 「동행」 이름 줄)이고, 다른 말 · 알림 · 창 · 연출이 끝난 뒤에만 시작한다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { isCompanionChatOpen } from "../../companion/chatOpen";
import { COMPANION_NAME, companionDialog, IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { dialogue } from "../../dialogue/dialogueRuntime";
import { getTone } from "../../dialogue/lines";
import { recall, remember } from "../../save/puzzleMemory";
import { isCameraFocused } from "../../scene/cameraFocus";
import { isTalkTaken } from "../../scene/firstScene/npcSpeech";
import { StoryTalk, isTalkPaused } from "../../scene/firstScene/storyTalk";
import { makeGlowTexture } from "../glowTexture";
import { isNoticePending, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { M, groundY } from "../units";
import { getBoxLock, getBoxPhase } from "./boxPhase";
import { ridge } from "./ridgeState";
import { PLATFORM } from "./ridgeShape";

const TALK_ID = "companion-box-place";
const SAVE_KEY = "companion.boxPlaceHeard";
/** 다른 말 · 알림 · 연출이 끝나고 조작할 수 있는 시간이 이만큼(초) 이어진 뒤에 말한다 */
const QUIET_GAP = 1.5;
/** 빛이 켜진 뒤 조작할 수 있는 시간이 이만큼(초) 지나도 안 놓으면 한 번 더 알린다 */
const REMIND_SECONDS = 14;
export const BOX_PLACE_REMINDER = "불탄 평상을 겨누고 [E] — 아랑사의 함을 올려놓자. 그다음 자물통에 열쇠를 꽂는다.";

/** [존댓말, 반말(나주 말씨)] — 동행 말투 두 벌(lines.ts Tone) */
const LINE = [
  "그 열쇠라면 함을 열 수 있겠어요. 저 불탄 평상 위에 올려 볼까요?",
  "그 열쇠면 함이 열리겄다. 저 불탄 평상 위에 한번 올려 보자잉.",
] as const;

/** 평상 빛 — 지름(미터) · 평상 위 높이 · 숨 쉬는 빠르기 · 옅을 때와 짙을 때 */
const PLATFORM_GLOW = { size: 2.4, lift: 0.45, speed: 1.6, opacity: [0.45, 0.95] as const, color: "#FFC56B" };
/** 자물통 빛 */
const LOCK_GLOW = { size: 0.42, speed: 2.2, opacity: [0.35, 0.85] as const, color: "#FFD58A" };

const has = (kind: "letterBox" | "bronzeKey") => inventory.has(kind) || inventory.hand()?.kind === kind;

/** 다른 누가 말하거나 · 말할 참이거나 · 플레이어가 다른 데 묶여 있다 */
function isBusy() {
  const dialog = companionDialog.getState();
  return (
    isTalkPaused() ||
    isTalkTaken(TALK_ID) ||
    dialogue.getState() !== null ||
    dialogue.queueLength() > 0 ||
    dialog.waiting !== null ||
    dialog.line !== null ||
    isNoticePending() ||
    isCompanionChatOpen() ||
    isCameraFocused()
  );
}

function makeGlow(color: string) {
  return new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

export default function BoxPlaceGuide({ enabled }: { enabled: boolean }) {
  const platformGlow = useRef<THREE.Sprite>(null);
  const lockGlow = useRef<THREE.Sprite>(null);
  const materials = useMemo(() => ({ platform: makeGlow(PLATFORM_GLOW.color), lock: makeGlow(LOCK_GLOW.color) }), []);
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) {
        material.map?.dispose();
        material.dispose();
      }
    },
    [materials],
  );
  const platformAt = useMemo(
    () => new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + PLATFORM_GLOW.lift) * M, PLATFORM.z * M),
    [],
  );
  const talkRef = useRef<StoryTalk | null>(null);
  const quietFor = useRef(0);
  const waitedFor = useRef(0);
  const isReminded = useRef(false);

  useEffect(
    () => () => {
      talkRef.current?.stop();
    },
    [],
  );

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    const phase = getBoxPhase();
    const hasKey = has("bronzeKey");
    const showPlatform = enabled && phase === "none" && has("letterBox") && hasKey && ridge.isAtLeast("circling");
    const lock = phase === "placed" && hasKey ? getBoxLock() : null;
    const t = clock.elapsedTime;

    const platform = platformGlow.current;
    if (platform) {
      platform.visible = showPlatform;
      const breath = 0.5 + 0.5 * Math.sin(t * PLATFORM_GLOW.speed);
      materials.platform.opacity =
        PLATFORM_GLOW.opacity[0] + (PLATFORM_GLOW.opacity[1] - PLATFORM_GLOW.opacity[0]) * breath;
    }
    const lockSprite = lockGlow.current;
    if (lockSprite) {
      lockSprite.visible = enabled && lock !== null;
      if (lock) lockSprite.position.set(lock.x, lock.y, lock.z);
      const breath = 0.5 + 0.5 * Math.sin(t * LOCK_GLOW.speed);
      materials.lock.opacity = LOCK_GLOW.opacity[0] + (LOCK_GLOW.opacity[1] - LOCK_GLOW.opacity[0]) * breath;
    }

    if (!talkRef.current) {
      const talk = new StoryTalk(TALK_ID, COMPANION_NAME, false);
      talk.onDone = () => remember(SAVE_KEY, true);
      talkRef.current = talk;
    }
    const talk = talkRef.current;
    talk.tick(dt);
    if (!showPlatform) {
      // 함을 놓았다 — 말하던 중이면 그친다(놓은 뒤에 「올려 볼까요」는 늦다). 다 들은 것으로 적어 다시 말하지 않는다
      if (talk.isActive) {
        talk.stop();
        remember(SAVE_KEY, true);
      }
      quietFor.current = 0;
      return;
    }
    const busy = isBusy();
    // 조작할 수 있는 시간만 센다 — 다시 알림
    if (!busy && !talk.isActive) waitedFor.current += dt;
    if (!isReminded.current && waitedFor.current >= REMIND_SECONDS) {
      isReminded.current = true;
      showNotice(BOX_PLACE_REMINDER, 5);
    }
    if (recall(SAVE_KEY, false) || talk.isActive || !IS_COMPANION_ENABLED) return;
    quietFor.current = busy ? 0 : quietFor.current + dt;
    if (quietFor.current < QUIET_GAP) return;
    if (talk.start([{ text: LINE[getTone() === "polite" ? 0 : 1] }])) quietFor.current = 0;
  });

  return (
    <>
      <sprite
        ref={platformGlow}
        material={materials.platform}
        position={platformAt}
        scale={PLATFORM_GLOW.size * M}
        renderOrder={2}
        visible={false}
      />
      <sprite ref={lockGlow} material={materials.lock} scale={LOCK_GLOW.size * M} renderOrder={3} visible={false} />
    </>
  );
}
