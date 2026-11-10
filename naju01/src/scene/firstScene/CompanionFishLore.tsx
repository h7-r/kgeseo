/**
 * 빛 물고기의 정체 — 동행의 한마디(미르 11/10). 설정은 「그날 밤 꺼진 화톳불의 불티가 빛 물고기가 되어 강을 떠돈다」인데
 * 화면에 드러나지 않아, 통발을 건졌을 때 「불씨들이다」가 「물속에서 불똥이 올라왔다」로 읽혔다.
 *
 * 언제: 첫 소개 · 장면 인물 대사 · 알림 · 대화창 · 창 · 연출이 다 끝나고 조작할 수 있는 시간이 QUIET_GAP 초 이어진 뒤,
 *   수면에 비친 빛 물고기가 화면 안에 보이는 첫 순간(통발을 물에 넣으면 끌려가는 물고기가 계속 비치므로 퍼즐을 시작할 때도 잡힌다).
 *   그러니 정확히는 「처음 본 순간」이 아니라 「물고기를 보며 말할 수 있는 첫 순간」이다 — 물고기 길이 아비사 바로 앞이라
 *   첫 목격은 대개 소개 · 구렁이 · 의뢰 중이다(Codex 01회차).
 *   구렁이와 마주한 동안(경계를 봤고 아직 안 쫓아냄)은 기다리고, 말하던 중에 마주치면 그친다.
 *   통발이 뭍으로 오가는 동안은 시작하지 않는다(게이지가 끝나도 착지할 때까지는 단계가 full 이다).
 * 무엇을: 아비사 의뢰에서 「그날」을 들었으면 「그날 밤」까지, 아직이면 그 말을 빼고 — 의뢰를 건너뛴 사람에게도 정체는 알린다.
 * 한 번만: puzzleMemory `companion.fishLoreHeard` = 끝까지 들었거나, 들을 때를 지났다(통발을 이미 건짐 · 옛 저장). 끊기면 저장하지
 *   않고 다음 기회에 처음부터 다시 — CompanionIntro 와 같다. 통발을 건지면 말하던 중이어도 그치고 지난 것으로 적는다(올라온 알림이 밀리지 않게).
 * 어디에: StoryTalk → 대화창에 「동행」 이름 줄. 한 줄이라 자동으로 넘어가고 「다음」 단추는 없다(터치도 같다).
 *   창 · 종이 · 게이지 · 카메라 연출 · 조작 풀림 동안은 StoryTalk 가 멈춘다. 시작 전에도 같은 조건으로 기다린다(차례를 미리 잡지 않게).
 * 운영판에도 실린다 — 빛 물고기의 정체를 알리는 고정 FE 게임 문구다(NPC 콘텐츠 계약 v0.4.16 §9-3: 퍼즐 설명 · 진행 알림은
 *   G3 대사 승인 대상이 아니고 G2 · 게시 검사를 받는다). 넛지 · 상황 대사 · 잡담(draftLines)과는 다르다. 문장은 초안(이야기팀 확인 전).
 * 말투: [존댓말, 반말(나주 말씨)] — 동행 말투 두 벌(lines.ts Tone). 베타는 존댓말 한 벌이다.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { isCompanionChatOpen } from "../../companion/chatOpen";
import { COMPANION_NAME, companionDialog, IS_COMPANION_ENABLED } from "../../companion/companionRuntime";
import { isCompanionIntro } from "../../companion/companionStage";
import { dialogue } from "../../dialogue/dialogueRuntime";
import { getTone } from "../../dialogue/lines";
import { isLightFishInView, isTrapOnTheMove } from "../../puzzles/fishTrap/fishSighting";
import { fishTrapPuzzle } from "../../puzzles/fishTrap/fishTrapState";
import { isNoticePending } from "../../puzzles/interaction";
import { recall, remember } from "../../save/puzzleMemory";
import { REQUEST_LINES } from "./abisaLines";
import { firstScenePoints } from "./firstScenePoints";
import { isTalkTaken } from "./npcSpeech";
import { StoryTalk, isTalkPaused } from "./storyTalk";

const TALK_ID = "companion-fish-lore";
const SAVE_KEY = "companion.fishLoreHeard";
/** 다른 말 · 알림 · 창 · 연출이 끝나고 조작할 수 있는 시간이 이만큼(초) 이어진 뒤에 말한다 */
const QUIET_GAP = 2;
/** 물고기가 보이는지 재는 간격(초) */
const CHECK_SECONDS = 0.25;

/** 아비사 의뢰를 이만큼(다 들은 줄 수) 들었으면 「그날」을 안다 — 「…만나기로 한 그날, 그이가 오지 않았어요」 줄까지 */
const HEARD_THAT_DAY = (() => {
  const index = REQUEST_LINES.findIndex((line) => line.text.includes("그날"));
  return index < 0 ? REQUEST_LINES.length : index + 1;
})();

/** [존댓말, 반말] */
const LINES = {
  afterRequest: [
    "저 빛 물고기들… 그날 밤 꺼진 화톳불에서 튄 불씨가 물에 떨어져 변한 거래요.",
    "저 빛 물고기들… 그날 밤 꺼진 화톳불에서 튄 불씨가 물에 떨어져서 변한 거라든디.",
  ],
  beforeRequest: [
    "저 빛 물고기들… 꺼진 화톳불에서 튄 불씨가 물에 떨어져 변한 거래요.",
    "저 빛 물고기들… 꺼진 화톳불에서 튄 불씨가 물에 떨어져서 변한 거라든디.",
  ],
} as const satisfies Record<string, readonly [string, string]>;

/** 통발을 아직 안 건졌다 — 이때만 말한다 */
const isBeforeLanding = () => {
  const stage = fishTrapPuzzle.stage();
  return stage === "idle" || stage === "full";
};

/**
 * 구렁이와 마주한 동안 — 아직 쫓아내지 않았고, 경계 알림을 봤거나 지금 경계 거리 안이다.
 * 거리도 보는 까닭: 경계 알림은 다른 사람(이 한마디 포함)이 말하는 동안 미뤄져 isSerpentNoticed 가 안 켜진다(Codex 리뷰)
 */
const isFacingSerpent = () =>
  !recall("firstScene.serpentDriven", false) && (firstScenePoints.isSerpentNoticed || firstScenePoints.isSerpentClose);

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
    isCompanionIntro() ||
    !recall("companion.introHeard", false) ||
    isFacingSerpent() ||
    isTrapOnTheMove()
  );
}

export default function CompanionFishLore({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  const talkRef = useRef<StoryTalk | null>(null);
  const quietFor = useRef(0);
  const checkClock = useRef(0);

  useEffect(
    () => () => {
      talkRef.current?.stop();
    },
    [],
  );

  useFrame((_, delta) => {
    if (!talkRef.current) {
      const talk = new StoryTalk(TALK_ID, COMPANION_NAME, false);
      talk.onDone = () => remember(SAVE_KEY, true);
      talkRef.current = talk;
    }
    const talk = talkRef.current;
    // 편집 · 검수 · 동행을 끈 판(?npc=off · 샌드박스)은 말하지 않는다 — 그친 말은 저장하지 않는다
    if (!enabled || !IS_COMPANION_ENABLED) {
      talk.stop();
      quietFor.current = 0;
      return;
    }
    const dt = Math.min(delta, 0.1);
    talk.tick(dt);
    if (recall(SAVE_KEY, false)) return;

    // 통발을 건졌으면 들을 때를 지났다 — 말하던 중이어도 그치고 한 번만 적는다
    if (!isBeforeLanding()) {
      talk.stop();
      remember(SAVE_KEY, true);
      return;
    }
    if (talk.isActive) {
      // 말하던 중에 구렁이와 마주쳤다 — 그친다(저장하지 않으니 쫓아낸 뒤 다시)
      if (isFacingSerpent()) talk.stop();
      return;
    }

    // 조작할 수 있는 빈 시간을 센다(창 · 연출 · 다른 말이 끼면 처음부터)
    quietFor.current = isBusy() ? 0 : quietFor.current + dt;
    if (quietFor.current < QUIET_GAP) return;
    checkClock.current += dt;
    if (checkClock.current < CHECK_SECONDS) return;
    checkClock.current = 0;
    if (!isLightFishInView(camera)) return;

    const lines =
      recall<number>("firstScene.requestLine", 0) >= HEARD_THAT_DAY ? LINES.afterRequest : LINES.beforeRequest;
    if (talk.start([{ text: lines[getTone() === "polite" ? 0 : 1] }])) quietFor.current = 0;
  });

  return null;
}
