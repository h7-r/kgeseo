/**
 * 첫 입장 동행 자기소개(미르 11/9 「곁의 동행 NPC 가 뭔지 당황스러울 수 있다 — 자기소개 + 어떻게 시작해 보자」).
 *  - 한 번만(저장). 게임이 시작돼 조작이 이어진 지 1.5초 뒤, 다른 사람이 말하지 않고 창 · 연출이 없을 때 대사 상자에 띄운다.
 *  - 정체(소속 · 사람인지 · 정령의 기원)는 말하지 않는다 — 동행 조사관의 존재 자체가 미정이다(04 부록 I, Codex 06회차).
 *    이름표도 아직 「동행」(PM 결정 대기).
 *  - 「물가로 가 보자」는 구렁이 · 아비사와 아직 안 마주쳤을 때만. 의뢰를 듣는 중이면 그것부터 하자고, 다 들었으면 소개를 건너뛴다.
 *  - 말 걸기 안내([Enter])는 여기서 하지 않는다 — 아비사 의뢰 끝 안내 한 곳에서(Codex 06회차).
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";

import { COMPANION_NAME, IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { recall, remember } from "../../save/puzzleMemory";
import { REQUEST_LINES } from "./abisaLines";
import { isTalkTaken } from "./npcSpeech";
import { StoryTalk, isTalkPaused, type StoryLine } from "./storyTalk";

const SAVE_KEY = "companion.introHeard";
/** 조작이 이어진 뒤 이만큼(초) 지나 말한다 */
const START_AFTER = 1.5;

/** 초안(이야기팀 승인 전) */
const LINES = {
  hello: { text: "안녕하세요, 조사관님. 저는 이번 조사에 함께하는 동행이에요. 곁에서 도울게요." },
  place: { text: "여기는 영산강 앙암바위 아래 나루터예요." },
  go: { text: "저기 물가에 누가 있어요. 먼저 가까이 가서 살펴봐요." },
  request: { text: "아비사의 부탁부터 차근차근 풀어 봐요." },
} satisfies Record<string, StoryLine>;

export default function CompanionIntro({ enabled }: { enabled: boolean }) {
  const talk = useMemo(() => new StoryTalk("companion-intro", COMPANION_NAME, false), []);
  const state = useMemo(() => ({ isHeard: recall(SAVE_KEY, false), activeTime: 0 }), []);

  useEffect(() => {
    talk.onDone = () => {
      state.isHeard = true;
      remember(SAVE_KEY, true);
    };
    return () => talk.stop();
  }, [talk, state]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    if (!enabled) {
      talk.stop();
      return;
    }
    if (talk.isActive) {
      talk.tick(dt);
      return;
    }
    if (state.isHeard || !IS_COMPANION_ENABLED) return;
    if (!isTalkPaused()) state.activeTime += dt;
    if (state.activeTime < START_AFTER || isTalkTaken()) return;
    const requestNext = recall<number>("firstScene.requestLine", 0);
    // 아비사 의뢰를 다 들은 뒤라면(진행 중인 저장) 소개를 건너뛴다 — 지금 자리와 안 맞는 말이 나온다
    if (requestNext >= REQUEST_LINES.length) {
      state.isHeard = true;
      remember(SAVE_KEY, true);
      return;
    }
    const isContacted = requestNext > 0 || recall("firstScene.serpentDriven", false);
    talk.start([LINES.hello, LINES.place, isContacted ? LINES.request : LINES.go]);
  });

  return null;
}
