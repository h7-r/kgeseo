/**
 * 동행의 「놓고 온 것」 한마디 — puzzles/leftBehind 의 요청을 차례가 날 때 말로 바꾼다(미르 11/9, 튜토피드백 13회차).
 * 장면 인물 대화(claimTalk) · 동행 대화(응답 기다림 · 자막 · 입력) · 첫 소개와 겹치지 않게 기다렸다가, 말하기 직전에 지금 상태로
 * 다시 확인한다(그사이 주웠으면 말하지 않는다). 말하던 까닭이 풀리면(주웠다) 그친다. 창 · 종이 · 연출 중엔 StoryTalk 가 멈춘다.
 * 바위 아래에 들어서면 「지나갔다」고 적고, 바위틈 어귀에서 물러나면 다음 접근에 또 한 번 말하게 되살린다. 물고기가 어디에도
 * 없는 판은 화톳불 곁에 다시 놓는다.
 */
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { isCompanionChatOpen } from "../../companion/chatOpen";
import { COMPANION_NAME, companionDialog, IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { isCompanionIntro } from "../../companion/companionStage";
import { playerPose } from "../../movement/playerPose";
import { regionAt } from "../../movement/regions";
import {
  DOCK_GATE_MOUTH,
  DOCK_GATE_REARM_METERS,
  isDockGateHeldByFish,
  isOfferingNudgeStale,
  linesForNudge,
  markDockGatePassed,
  offeredSoFar,
  rearmDockNudge,
  restoreLostFish,
  takeNudgeRequest,
  type NudgeKind,
} from "../../puzzles/leftBehind";
import { isTalkTaken } from "./npcSpeech";
import { StoryTalk } from "./storyTalk";

const TALK_ID = "companion-nudge";
/** 요청을 이만큼(ms) 기다려도 말할 차례가 안 나면 버린다 — 한참 뒤 엉뚱한 자리에서 말하지 않게 */
const REQUEST_LIFETIME_MS = 12000;
/** 자리 · 물고기 확인 간격(초) */
const CHECK_SECONDS = 0.5;

export default function CompanionNudge({ enabled }: { enabled: boolean }) {
  const talkRef = useRef<StoryTalk | null>(null);
  const waiting = useRef<{ kind: NudgeKind; at: number } | null>(null);
  const speakingKind = useRef<NudgeKind | null>(null);
  const checkClock = useRef(0);

  useEffect(
    () => () => {
      talkRef.current?.stop();
    },
    [],
  );

  useFrame((_, delta) => {
    talkRef.current ??= new StoryTalk(TALK_ID, COMPANION_NAME, false);
    const talk = talkRef.current;
    if (!enabled) {
      talk.stop();
      return;
    }
    talk.tick(Math.min(delta, 0.1));

    checkClock.current += delta;
    if (checkClock.current >= CHECK_SECONDS) {
      checkClock.current = 0;
      if (regionAt(playerPose.x, playerPose.z) === "바위아래") markDockGatePassed();
      const fromMouth = Math.hypot(playerPose.x - DOCK_GATE_MOUTH.x, playerPose.z - DOCK_GATE_MOUTH.z);
      if (fromMouth > DOCK_GATE_REARM_METERS) rearmDockNudge();
      restoreLostFish(offeredSoFar());
      // 말하던 까닭이 풀렸으면(물고기를 주웠다 · 모자란 제물을 주웠다 · 소반 단계가 끝났다) 그친다
      if (talk.isActive && speakingKind.current === "dockGate" && !isDockGateHeldByFish()) talk.stop();
      if (talk.isActive && speakingKind.current === "offering" && isOfferingNudgeStale(offeredSoFar())) talk.stop();
    }

    const request = takeNudgeRequest();
    // 동행을 끈 판(?npc=off)은 말하지 않는다 — 문의 알림 줄 · 지나감 기록 · 물고기 복구는 위에서 그대로(Codex 리뷰 b8752ba)
    if (!IS_COMPANION_ENABLED) return;
    if (request) waiting.current = request;
    const pending = waiting.current;
    if (!pending || talk.isActive) return;
    if (performance.now() - pending.at > REQUEST_LIFETIME_MS) {
      waiting.current = null;
      return;
    }
    // 다른 사람이 말하는 중 · 동행 대화 중 · 첫 소개 중이면 기다린다(줄을 만들기 전에 — 만들면 「말했다」로 적힌다)
    const dialog = companionDialog.getState();
    if (isTalkTaken(TALK_ID) || dialog.waiting !== null || dialog.line !== null) return;
    if (isCompanionChatOpen() || isCompanionIntro()) return;
    const lines = linesForNudge(pending.kind, offeredSoFar());
    waiting.current = null;
    if (!lines || !talk.start(lines.map((text) => ({ text })))) return;
    speakingKind.current = pending.kind;
  });

  return null;
}
