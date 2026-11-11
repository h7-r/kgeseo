/**
 * 나주 게임 상태 → 상황 판정에 넘길 한 장(Observation). 게임 모듈을 읽는 곳은 이 파일 하나이고, 읽기만 한다.
 *
 * 퍼즐 쪽에는 「틀렸다」 · 「풀렸다」를 알리는 장치가 따로 없다. 그래서 이미 화면에 뜨는 알림 문장과 안내판의 「n / m」 숫자로 알아챈다
 * (아래 NOTICE_SIGNS). 퍼즐 문장을 고치면 이 표도 같이 고쳐야 한다 — 퍼즐이 직접 알리게 되면 reportMistake · reportSolved 로 바꾼다.
 * 물굴만은 퍼즐 부품이 저장 기록(save/puzzleMemory)에 적어 두는 값이 있어 그것으로 진행을 읽는다(readCave).
 */
import { gameNow } from "@/engine/input/gameClock";
import { isPointerActive } from "@/engine/input/virtualLock";

import { isCameraFocused } from "../scene/cameraFocus";
import { stage as immersionStage } from "../scene/immersion/state";
import { playerPose, walkTerrain } from "../movement/playerPose";
import { getBreath, getUnderwater } from "../puzzles/cave/caveState";
import { clamDig } from "../puzzles/fishTrap/clamState";
import { fishTrapPuzzle } from "../puzzles/fishTrap/fishTrapState";
import { isGaugeActive } from "../puzzles/fishTrap/pullGauge";
import { isHintBoxOpen } from "../puzzles/hintBoxView";
import { SLOT_COUNT, inventory } from "../puzzles/inventory";
import { jarPuzzle } from "../puzzles/jars/jarState";
import { makgeolliBottle } from "../puzzles/makgeolli/makgeolliState";
import { isLetterOpenNow } from "../puzzles/cliff/letters";
import { isPaperOpenNow } from "../puzzles/ridge/oldPaper";
import { ridge, ridgeCarry, ridgeQuest } from "../puzzles/ridge/ridgeState";
import { ritual } from "../puzzles/ritual/ritualState";
import { M } from "../puzzles/units";
import { recall } from "../save/puzzleMemory";
import {
  OBJECTIVES,
  PANEL_OBJECTIVE,
  SENT_BACK_NOTICE,
  caveCompleted,
  countedAsHeld,
  createPanelReader,
  nextCaveObjective,
  type CaveProgress,
  type ObjectiveId,
  type PanelSight,
} from "./objectives.ts";
import type { Observation } from "./situations.ts";

/** 알림 문장의 첫머리 → 무슨 일인가. 문장은 puzzles/* 의 showNotice 원문 */
// 틀린 줄을 당겨 빈 통발이 올라오는 것은 통발이 찬 뒤(줄 고르기 · 당기기 단계)의 일이라 P02-2 에 센다
const NOTICE_SIGNS: { starts: string; objective: ObjectiveId; sign: "mistake" | "solved" }[] = [
  { starts: "갯지렁이만 꿈틀거리며", objective: "P01", sign: "mistake" },
  { starts: "게다! 집게에", objective: "P01", sign: "mistake" },
  { starts: "빈 통발이다", objective: "P02-2", sign: "mistake" },
  { starts: "미역 줄기만 잔뜩", objective: "P02-2", sign: "mistake" },
  { starts: "통발 안에 큰 짚신", objective: "P02-2", sign: "mistake" },
  { starts: "홈에 새긴 눈금 수와", objective: "P05", sign: "mistake" },
  { starts: "차례가 틀렸다", objective: "P08", sign: "mistake" },
  // 서버 판정 오답 — 서버로 보내지는 않지만(SERVER_JUDGED) 「도와 드릴까요」 판정에는 센다
  { starts: "돌바퀴가 꿈쩍도 않는다. 고리가", objective: "P09", sign: "mistake" },
  { starts: "순서가 틀렸다", objective: "P10", sign: "mistake" },
  { starts: "궤가 너무 무거워", objective: "P11", sign: "mistake" },
  { starts: "궤를 진 채로는", objective: "P11", sign: "mistake" },
  { starts: "수레 위에서는", objective: "P11", sign: "mistake" },
  { starts: "걸상이 덜컹 내려앉으며", objective: "P13", sign: "mistake" },
  { starts: "허공에서는 돌새를", objective: "P13-2", sign: "mistake" },
  { starts: "독에 갇혀 있던 공기가", objective: "C_JAR", sign: "solved" },
  { starts: "빛이 큰 진주에 닿자", objective: "P07", sign: "solved" },
  { starts: "마지막 물고기들까지", objective: "P08", sign: "solved" },
  { starts: "틈 셋이 한 줄로", objective: "P09", sign: "solved" },
  { starts: "받침 넷이 다 맞았다", objective: "P10", sign: "solved" },
  { starts: "진주가 홈에 딸깍", objective: "C_SOCKET", sign: "solved" },
];

const mistakes: Partial<Record<ObjectiveId, number>> = {};
/** 알림 문장으로 알아챈 풀림 — 물굴 진행은 저장 기록으로 읽고(readCave), 알림은 그것을 거든다 */
const solvedBySign = new Set<ObjectiveId>();
let noticeCount = 0;
/** 숨이 다해 되돌려진 횟수 — 퍼즐 쪽에 따로 알리는 장치가 없어 그 알림으로 센다 */
let sentBackCount = 0;

export function reportMistake(objective: ObjectiveId) {
  mistakes[objective] = (mistakes[objective] ?? 0) + 1;
}

export function reportSolved(objective: ObjectiveId) {
  solvedBySign.add(objective);
}

/** 새 알림이 떴다 — 틀림 · 풀림 · 되돌려짐 신호면 적어 둔다 */
export function noteNotice(text: string) {
  noticeCount += 1;
  if (text.startsWith(SENT_BACK_NOTICE)) sentBackCount += 1;
  const found = NOTICE_SIGNS.find((entry) => text.startsWith(entry.starts));
  if (!found) return;
  if (found.sign === "mistake") reportMistake(found.objective);
  else reportSolved(found.objective);
}

/** 안내판의 수 — 오른 것은 진전, 처음부터 다시 하는 퍼즐의 수가 준 것은 틀림이다(objectives 의 createPanelReader) */
const panelReader = createPanelReader();
export function notePanel(panel: PanelSight | null) {
  const restarted = panelReader.read(panel);
  if (!restarted) return;
  // 알림 문장으로 이미 세는 퍼즐은 두 번 세지 않는다
  const isCountedByNotice = NOTICE_SIGNS.some((entry) => entry.objective === restarted && entry.sign === "mistake");
  if (!isCountedByNotice) reportMistake(restarted);
}

/** 물고기 굴의 판 수 — 안내판 규칙의 「세 판」. 퍼즐(FishBurrows)이 내보내지 않는 값이라 여기 적는다 */
const BURROW_ROUNDS = 3;

/**
 * 물굴 진행. 퍼즐 부품이 값이 바뀌는 순간 저장 기록에 적으므로(useRememberedState) 안내판 밖에 서 있어도 읽힌다.
 * 풀림 알림은 다른 알림에 덮여 놓칠 수 있어 기록을 먼저 보고, 알림은 거든다.
 */
function readCave(): CaveProgress {
  const floats = recall<boolean[]>("door.floats", []);
  return {
    isJarTilted: recall("air.isJarTilted", false) || solvedBySign.has("C_JAR"),
    isLightSolved: recall("air.isLightSolved", false) || solvedBySign.has("P07"),
    isBurrowsSolved: recall("burrows.roundsDone", 0) >= BURROW_ROUNDS || solvedBySign.has("P08"),
    isFloatsSet: floats.length > 0 && floats.every(Boolean),
    isDoorOpen: recall("door.isOpen", false) || solvedBySign.has("P09"),
    isChamberSolved: recall("chamber.isSolved", false) || solvedBySign.has("P10"),
    isPearlSet: recall("chamber.isShone", false) || solvedBySign.has("C_SOCKET"),
  };
}

/** 퍼즐 상태만으로 본 지금 목표. 연출이 도는 사이(불 붙음 · 비 내림)는 null */
function objectiveFromState(x: number, z: number): ObjectiveId | null {
  const trap = fishTrapPuzzle.stage();
  const isPastDock = fishTrapPuzzle.guideAhead() || ritual.isAtLeast("drawing");
  if (!isPastDock) {
    if (trap === "idle") return ["buried", "hoe", "dug"].includes(clamDig.stage()) ? "P01" : "P02";
    if (trap === "full") return "P02-2";
    if (trap === "pulled") return "S1_FIRE";
    return trap === "told" ? "S1_SMOKE" : null;
  }
  switch (ritual.stage()) {
    case "cairns": {
      const isJarOpen = jarPuzzle.stage() === "open";
      const hasBottle = makgeolliBottle.isTaken();
      if (isJarOpen && hasBottle) return "P05";
      if (isJarOpen) return "S2_BOTTLE";
      if (hasBottle) return "P03";
      // 둘 다 남았으면 가까운 쪽 이야기를 한다
      const toJars = Math.hypot(x - OBJECTIVES.P03.anchor!.x, z - OBJECTIVES.P03.anchor!.z);
      const toBoat = Math.hypot(x - OBJECTIVES.S2_BOTTLE.anchor!.x, z - OBJECTIVES.S2_BOTTLE.anchor!.z);
      return toJars <= toBoat ? "P03" : "S2_BOTTLE";
    }
    case "offering":
      return "S2_OFFER";
    case "flooded":
      return "S2_STONES";
    case "parted":
      return "S2_ENTER";
    case "cave":
      return nextCaveObjective(readCave());
    case "cleared":
      break;
    default:
      return null;
  }
  switch (ridge.stage()) {
    case "idle":
      return "S3_GO";
    case "sealed":
      if (!ridgeQuest.chestOnAltar) return "P11";
      if (!ridgeQuest.postsSolved) return "P12";
      if (!ridgeQuest.stairs) return "P13";
      if (!ridgeQuest.birdsFacing) return "P13-2";
      return ridgeQuest.scaleSet ? null : "S3_SCALE";
    case "circling":
    case "leaving":
      return "S3_KEY";
    case "rift":
      return "S3_RIFT";
    default:
      return null;
  }
}

function completedObjectives(): Set<ObjectiveId> {
  const done = new Set<ObjectiveId>([...solvedBySign, ...caveCompleted(readCave())]);
  const add = (id: ObjectiveId, isDone: boolean) => {
    if (isDone) done.add(id);
  };
  const trap = fishTrapPuzzle.stage();
  const trapAt = ["idle", "full", "pulled", "lit", "told"].indexOf(trap);
  add("P01", !["buried", "hoe", "dug"].includes(clamDig.stage()));
  // 통발을 넣는 것만으로는 고른 게 없다 — 맞는 줄을 당겨 올렸을 때 둘이 함께 끝난다
  add("P02", trapAt >= 2);
  add("P02-2", trapAt >= 2);
  add("S1_FIRE", trapAt >= 3);
  add("S1_SMOKE", fishTrapPuzzle.guideAhead());
  add("P03", jarPuzzle.stage() === "open");
  add("S2_BOTTLE", makgeolliBottle.isTaken());
  add("P05", ritual.isAtLeast("drawing"));
  add("S2_OFFER", ritual.isAtLeast("rising"));
  add("S2_STONES", ritual.isAtLeast("parted"));
  add("S2_ENTER", ritual.isAtLeast("cave"));
  if (ritual.isAtLeast("cleared"))
    for (const id of ["C_JAR", "P07", "P08", "P09", "P10", "C_SOCKET"] as const) done.add(id);
  add("S3_GO", ridge.isAtLeast("sealing"));
  add("P11", ridgeQuest.chestOnAltar);
  add("P12", ridgeQuest.postsSolved);
  add("P13", ridgeQuest.stairs);
  add("P13-2", ridgeQuest.birdsFacing);
  add("S3_SCALE", ridgeQuest.scaleSet);
  add("S3_RIFT", ridge.isAtLeast("done"));
  return done;
}

/**
 * 지금 목표 — 퍼즐 앞에 서 있으면(안내판) 그 퍼즐, 아니면 진행 상태로 본 다음 할 일.
 * 푼 뒤에도 안내판이 남는 퍼즐이 있다(엎어진 독 · 진주 빛 잇기) — 끝낸 퍼즐은 그 앞에 서 있어도 목표로 삼지 않는다.
 */
export function currentObjective(panel: PanelSight | null, completed = completedObjectives()): ObjectiveId | null {
  const byPanel = panel ? PANEL_OBJECTIVE[panel.title] : undefined;
  if (byPanel && !completed.has(byPanel)) return byPanel;
  return objectiveFromState(playerPose.x, playerPose.z);
}

/**
 * 지금 플레이어가 해 놓은 데에 맞는 도움말 — 그 목표의 어느 대사 묶음 몇 번째인지(dialogue/lines).
 * 밖에서 읽을 수 있는 상태가 있는 목표만 가린다. 못 가리면 null(도움말 사다리를 처음부터).
 */
export function hintPhase(objective: ObjectiveId): { kind: "arrive" | "help" | "stuck"; index: number } | null {
  // 호미를 아직 못 찾았다 → 첫 설명. 숨구멍의 첫 설명은 안내판 글이 맡는다(lines 에 따로 없다 — director 가 안내판으로 답한다)
  if (objective === "P01") return clamDig.stage() === "buried" ? { kind: "arrive", index: 0 } : null;
  if (objective === "P02") {
    const clam = clamDig.stage();
    // 조개를 들고만 있다 → 미끼로 넣는 법 · 넣고 기다리는 중 → 줄을 보라
    if (clam === "held") return { kind: "stuck", index: 0 };
    return clam === "baiting" || clam === "baited" ? { kind: "help", index: 2 } : null;
  }
  if (objective === "P11") {
    // 빈 몸 → 지게부터 · 뭔가 졌다 → 남은 차례(다음에 할 일은 그때그때 게임 알림이 말한다)
    return ridgeCarry.load === "none" ? { kind: "help", index: 0 } : { kind: "stuck", index: 0 };
  }
  return null;
}

/**
 * 지금 선 땅의 구역 코드(지형 zone) — 구역 진입 auto 턴(companionBridge)이 쓴다. 전에 CompanionNpc 가 재던 것과 같은 지형 구역이다.
 * 물굴 · 연결로처럼 구역 밖이면 null(진입으로 치지 않는다)
 */
export const currentZoneCode = () => walkTerrain.current?.groundAt(playerPose.x, playerPose.z).zone ?? null;

/** 연출 · 읽는 창이 떠 있어 말을 걸면 안 되는 동안 */
export const isDialogueBlocked = () =>
  isCameraFocused() || immersionStage.cut !== null || isPaperOpenNow() || isLetterOpenNow() || isHintBoxOpen();

/**
 * 손이 바쁘거나 눈을 뗄 수 없는 동안 — 동행이 먼저 말을 걸지 않는다(알림은 그대로 말한다).
 * 줄 당기기 게이지, 마법진이 그려지고 비가 쏟아지는 연출, 연기가 글을 쓰는 동안, 능선에 갇히고 돌새가 깨어나는 연출.
 */
export const isQuietTime = () =>
  isGaugeActive() ||
  ["drawing", "rising"].includes(ritual.stage()) ||
  fishTrapPuzzle.stage() === "lit" ||
  ["sealing", "awakening"].includes(ridge.stage());

export function observeGame(panel: PanelSight | null): Observation {
  const held = inventory.held();
  const hand = inventory.hand();
  // 가진 물건 종류 — 손에 들었다 넣었다 하는 것은 진전이 아니라서 한데 모아 정렬한다
  const heldKinds = [...held.map((item) => item.kind), ...(hand ? [hand.kind] : [])].sort();
  const cave = readCave();
  const completed = completedObjectives();
  const progressKey = [
    clamDig.stage(),
    fishTrapPuzzle.stage(),
    fishTrapPuzzle.guideAhead(),
    jarPuzzle.stage(),
    makgeolliBottle.isTaken(),
    ritual.stage(),
    ridge.stage(),
    ridgeQuest.chestOnAltar,
    ridgeQuest.postsSolved,
    ridgeQuest.stairs,
    ridgeQuest.birdsFacing,
    ridgeQuest.scaleSet,
    heldKinds.join(","),
    // 물굴 진행은 안내판 밖에서 바뀌는 것(독을 기울임 · 문이 열림)도 진전이다
    Object.values(cave).join(","),
    // 안내판은 수가 오른 것만 진전이다 — 오르내리는 줄 값, 상태 표시(손에 든 것), 안내판을 드나드는 것은 넣지 않는다
    panelReader.gain(),
  ].join("|");
  // 물굴을 나와 능선 장막에 들어서기 전 — 내려놓은 물건은 장막에 들어설 때 저절로 따라온다(WindCurtain 의 bringAlong).
  // 이때 「두고 간다」 · 「없다」고 하면 헛말이 된다
  const isBeforeCurtain = ritual.isAtLeast("cleared") && ridge.stage() === "idle";
  return {
    // 게임 시계(초) — 멈춘 동안은 「진전 없음 · 가만히 있음」이 쌓이지 않는다(미르 11/11)
    now: gameNow() / 1000,
    objective: currentObjective(panel, completed),
    completed,
    progressKey,
    // 안내판 줄 값이 바뀐 것은 손을 대고 있다는 흔적이다 — 진전은 아니어도 가만히 있는 것은 아니다
    activityKey: [noticeCount, hand?.kind ?? "", ...(panel?.rows ?? []).map((row) => row.value)].join("|"),
    mistakes,
    x: playerPose.x,
    z: playerPose.z,
    // 터치는 가상 잠금이라 pointerLockElement 가 없다 — 조작 중인지는 virtualLock 으로 본다
    isPlaying: isPointerActive(),
    isBusy: isDialogueBlocked() || isQuietTime(),
    worldItems: inventory
      .world()
      .filter((item) => !(isBeforeCurtain && item.isDropped))
      .map((item) => ({
        uid: item.uid,
        kind: item.kind,
        x: item.position.x / M,
        z: item.position.z / M,
        isDropped: !!item.isDropped,
      })),
    breath: getUnderwater() ? getBreath() : null,
    sentBackCount,
    heldKinds: [
      ...heldKinds,
      ...countedAsHeld({
        offered: recall<string[]>("ritual.offered", []),
        cave,
        // 내려놓은 함은 「놓인 함」으로 바뀌어 땅 물건 목록에 없다. 소지품이나 손에 빈자리가 있어야 따라온다(BoxOpening)
        isBoxFollowing: isBeforeCurtain && (held.length < SLOT_COUNT || !hand),
      }),
    ],
  };
}
