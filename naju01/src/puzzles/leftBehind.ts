/**
 * 놓고 온 물건 — 씬 1(나루터)에서 통발을 쏟고 따로 털려 떨어진 「빛 물고기」를 안 주운 채 바위틈을 넘어가면, 기우제 소반에서
 * 제물 셋 중 하나가 모자라는데 이전 씬으로 돌아갈 생각을 못 했다(미르 11/9, 튜토피드백 13회차 · Codex 13).
 *  ① 처음 바위 아래로 넘어갈 때만 막는다 — 물고기가 나루터 땅에 그대로 있으면 문(stageGates)이 열리지 않고 동행이 「뭐 놓친 거 없어요?」.
 *     한 번 지나간 뒤에는 다시 잠그지 않는다(뒤에 나루터에 내려놓은 것은 ②가 맡는다). 옛 저장은 바위 아래 진행 흔적으로 지나간 것으로 본다.
 *  ② 기우제 소반에서 남은 제물을 손 · 소지품에 안 가졌으면 동행이 회상 단서를 준다 — 처음엔 막연하게, 또 막히면 이름과 자리까지.
 *     제물의 정체를 처음부터 다 알리지 않는 소반의 뜻(RitualCircle)을 지킨다.
 * 여기는 판단과 요청만 한다. 실제로 말하는 것은 CompanionNudge(차례 · 연출 · 동행 대화와 안 겹치게). 문 판정 안에서 말을 시작하지 않는다.
 * 좌표: 땅 위 물건 자리는 유닛(× M), 영역 판정은 미터.
 */
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import { regionAt, type Region } from "../movement/regions";
import { REQUEST_STORY_LINES } from "../scene/firstScene/abisaLines";
import { recall, remember } from "../save/puzzleMemory";
import { fishTrapPuzzle } from "./fishTrap/fishTrapState";
import { HEARTH } from "./fishTrap/site";
import { showNotice } from "./interaction";
import { inventory, ITEMS, withObjectParticle, type ItemKind, type WorldItem } from "./inventory";
import { jarPuzzle } from "./jars/jarState";
import { makgeolliBottle } from "./makgeolli/makgeolliState";
import { ritual } from "./ritual/ritualState";
import { ridgeBox } from "./ridge/ridgeState";
import { M, groundY } from "./units";

const PASSED_KEY = "leftBehind.dockGatePassed";
/** 바위틈 어귀(나루터 쪽 끝, 미터) — 여기서 이만큼 물러났다 다시 오면 또 한 번 말한다 */
export const DOCK_GATE_MOUTH = { x: 28, z: 36.5 };
export const DOCK_GATE_REARM_METERS = 6;

const isHolding = (kind: ItemKind) => inventory.has(kind) || inventory.hand()?.kind === kind;
const regionOfItem = (position: THREE.Vector3): Region => regionAt(position.x / M, position.z / M);

/** 처음 바위 아래로 넘어갔나 — 옛 저장은 바위 아래에서 한 일(배 막걸리 · 장독대 · 기우제)로 보완한다 */
export function hasPassedDockGate() {
  return (
    recall<boolean>(PASSED_KEY, false) ||
    makgeolliBottle.isTaken() ||
    jarPuzzle.stage() === "open" ||
    ritual.isAtLeast("drawing")
  );
}

export function markDockGatePassed() {
  if (!recall<boolean>(PASSED_KEY, false)) remember(PASSED_KEY, true);
}

/** 나루터 땅에 남은 빛 물고기 — 손 · 소지품에 한 마리라도 있으면 없는 셈(쏟기 도중 저장으로 두 마리가 된 판을 막지 않게) */
export function leftFishAtDock() {
  if (isHolding("lightFish")) return null;
  return (
    inventory.world().find((item) => item.kind === "lightFish" && regionOfItem(item.position) === "나루터") ?? null
  );
}

/** 바위틈 문이 물고기 때문에 닫혀 있나 — 처음 넘어갈 때만 */
export const isDockGateHeldByFish = () => !hasPassedDockGate() && leftFishAtDock() !== null;

/** 아비사에게 지금 말을 걸 수 있나 — 모형이 안 놓였거나 장면이 꺼져 있으면(편집 · 시험) 문을 잡아 두지 않는다(갇힘 방지) */
let isAbisaReachable: () => boolean = () => false;
export function setAbisaReachable(check: (() => boolean) | null) {
  isAbisaReachable = check ?? (() => false);
}

/** 아비사의 이야기(의뢰의 사건 이야기 · 불을 되살린 뒤 인연 이야기)를 다 들었나 */
export const isAbisaStoryHeard = () =>
  recall<number>("firstScene.requestLine", 0) >= REQUEST_STORY_LINES &&
  recall<boolean>("firstScene.backstoryHeard", false);

/**
 * 바위 아래로 넘어가기 전에 아비사에게 마저 들어야 할 이야기가 있나 — 불을 되살린 뒤(인연 이야기를 들을 수 있을 때)부터, 처음 넘어갈 때만.
 * 안 듣고 넘어가면 설화가 안 읽혔다(미르 11/11). 이미 바위 아래에서 무언가 한 옛 저장은 소급하지 않는다(Codex 01)
 */
export function isAbisaStoryOwed() {
  const stage = fishTrapPuzzle.stage();
  return (stage === "lit" || stage === "told") && !hasPassedDockGate() && !isAbisaStoryHeard() && isAbisaReachable();
}

// 동행에게 말해 달라는 요청 — CompanionNudge 가 차례가 나면 지금 상태로 다시 확인하고 말한다(하나만 기다린다)
export type NudgeKind = "dockGate" | "offering" | "abisaStory";
let pendingNudge: { kind: NudgeKind; at: number } | null = null;
/** 바위틈 어귀에서 이미 말했다 — 물러났다 다시 오면 다시(CompanionNudge 가 거리로 되살린다) */
let isDockNudgeSpent = false;
let isAbisaNudgeSpent = false;

/** 문이 물고기 때문에 걸음을 막았다(stageGates) — 말할 차례를 청하기만 한다 */
export function reportDockGateBlocked() {
  if (isDockNudgeSpent || pendingNudge?.kind === "dockGate") return;
  pendingNudge = { kind: "dockGate", at: performance.now() };
}
export function rearmDockNudge() {
  isDockNudgeSpent = false;
  isAbisaNudgeSpent = false;
}

/** 아비사 이야기가 남아 바위틈 문이 걸음을 막았다(stageGates) — 동행이 「아비사에게 다시 말을 걸어 봐요」(물건을 놓친 말과 다르게, Codex 01) */
export function reportAbisaStoryOwed() {
  if (isAbisaNudgeSpent || pendingNudge?.kind === "abisaStory") return;
  pendingNudge = { kind: "abisaStory", at: performance.now() };
}

export function takeNudgeRequest() {
  const request = pendingNudge;
  pendingNudge = null;
  return request;
}

/** 그 요청을 말로 — 지금도 그 까닭이 남아 있으면 줄들, 아니면 null(이미 주웠다 · 다 올렸다) */
export function linesForNudge(kind: NudgeKind, offered: ReadonlySet<ItemKind>): string[] | null {
  if (kind === "abisaStory") {
    if (!isAbisaStoryOwed()) return null;
    isAbisaNudgeSpent = true;
    return ["떠나기 전에 아비사에게 다시 말을 걸어 봐요.", "아직 할 이야기가 남은 것 같아요."];
  }
  if (kind === "dockGate") {
    const fish = leftFishAtDock();
    if (!fish || hasPassedDockGate()) return null;
    isDockNudgeSpent = true;
    return [
      "잠깐만요. 뭐 놓친 거 없어요?",
      fish.isDropped ? "아까 나루터에 내려놓은 게 있었던 것 같은데요." : "화톳불 쪽에서 뭔가 아직 파닥이던데요.",
    ];
  }
  return offeringLines(offered);
}

// 기우제 소반 — 남은 제물을 안 가졌을 때
const OFFERINGS: readonly ItemKind[] = ["lightFish", "rice", "makgeolli"];
/** 막연한 단서를 이미 줬다 — 다음부터는 이름과 자리까지 */
let offeringHintLevel = 0;
/** 이번에 말할 단서 — 요청할 때 정해 둔다(말하기 직전에 다시 확인) */
let offeringNudgeArmed = false;

/** 소지품 · 손에 없어서 올릴 수 없는 남은 제물 */
function missingOfferings(offered: ReadonlySet<ItemKind>) {
  const left = OFFERINGS.filter((kind) => !offered.has(kind));
  if (left.some(isHolding)) return []; // 아직 올릴 것이 있다 — 그것부터(소반 E 가 소지품에서 바로 올린다)
  return left;
}

/** 소반을 맨손으로 살폈다(올릴 것이 없을 때만 불린다) */
export function noteOfferingExamined(offered: ReadonlySet<ItemKind>) {
  if (missingOfferings(offered).length === 0) return;
  requestOfferingNudge();
}

/** 하나 올렸다 — 마지막 하나가 남았는데 그것을 안 가졌으면 그때만(첫 제물 직후 나머지 정답을 말하지 않게) */
export function noteOfferingPlaced(offered: ReadonlySet<ItemKind>) {
  if (offered.size !== OFFERINGS.length - 1 || missingOfferings(offered).length === 0) return;
  requestOfferingNudge();
}

function requestOfferingNudge() {
  offeringNudgeArmed = true;
  pendingNudge = { kind: "offering", at: performance.now() };
}

/** 제물 단서를 말하는 도중 그 까닭이 풀렸나 — 모자란 것을 주웠거나 소반 단계가 끝났다(Codex 리뷰 b8752ba) */
export const isOfferingNudgeStale = (offered: ReadonlySet<ItemKind>) =>
  ritual.stage() !== "offering" || missingOfferings(offered).length === 0;

function offeringLines(offered: ReadonlySet<ItemKind>): string[] | null {
  if (!offeringNudgeArmed || ritual.stage() !== "offering") return null;
  const missing = missingOfferings(offered);
  if (missing.length === 0) return null;
  offeringNudgeArmed = false;
  if (offeringHintLevel === 0) {
    offeringHintLevel = 1;
    return ["지나온 곳에 두고 온 게 있을까요?"];
  }
  return [whereIs(missing[0])];
}

const REGION_PHRASE: Record<Region, string> = {
  나루터: "나루터",
  바위아래: "이 근처 어딘가",
  능선: "지나온 길 어딘가",
  바위위: "지나온 길 어딘가",
};
const ORIGIN_PHRASE: Partial<Record<ItemKind, string>> = {
  lightFish: "빛 물고기요… 나루터 화톳불 곁에 한 마리 떨어져 있지 않았어요?",
  rice: "쌀이요… 장독대 항아리에서 나온 걸 아직 안 챙긴 것 같아요.",
  makgeolli: "막걸리는 물가 배에 있었죠?",
};

/** 그 제물이 지금 어디 있는지 — 처음 놓인 자리면 그 자리를 회상시키고, 플레이어가 내려놓았으면 놓인 영역으로 */
function whereIs(kind: ItemKind): string {
  const item = inventory.world().find((entry) => entry.kind === kind);
  const name = ITEMS[kind].name;
  if (!item) return ORIGIN_PHRASE[kind] ?? "제물이 아직 다 모이지 않았어요. 지나온 곳을 다시 둘러봐요.";
  if (!item.isDropped && ORIGIN_PHRASE[kind]) return ORIGIN_PHRASE[kind];
  return `${withObjectParticle(name)} ${REGION_PHRASE[regionOfItem(item.position)]}에 내려놓고 온 것 같아요.`;
}

/** 물고기가 이만큼(ms) 계속 어디에도 없어야 다시 놓는다 */
const LOST_FISH_GRACE_MS = 2000;
let fishLostSince: number | null = null;

/**
 * 빛 물고기가 어디에도 없는 판(손 · 소지품 · 땅 · 소반 어디에도) — 통발을 쏟아 불을 붙였는데 물고기가 사라졌다(쏟기 도중 저장 등).
 * 화톳불 곁에 다시 놓는다 — 「돌아가 찾아보자」만 되풀이해서는 풀리지 않는다(Codex 13). 놓았으면 true
 */
export function restoreLostFish(offered: ReadonlySet<ItemKind>) {
  const isLost =
    (fishTrapPuzzle.stage() === "told" || ritual.isAtLeast("drawing")) &&
    !offered.has("lightFish") &&
    !ritual.isAtLeast("rising") &&
    !isHolding("lightFish") &&
    !inventory.world().some((item) => item.kind === "lightFish");
  // 잠깐 비는 틈(저장을 나눠 되살리는 순간 등)에 한 마리를 더 만들지 않게 — 이만큼 계속 없을 때만
  const now = performance.now();
  if (!isLost) {
    fishLostSince = null;
    return false;
  }
  fishLostSince ??= now;
  if (now - fishLostSince < LOST_FISH_GRACE_MS) return false;
  fishLostSince = null;
  const x = HEARTH.x;
  const z = HEARTH.z - 1.3;
  inventory.spawn("lightFish", new THREE.Vector3(x * M, groundY(x, z) * M, z * M));
  return true;
}

/** 소반에 오른 제물(저장된 것) — 소반이 없을 때(나루터) 읽는다 */
export const offeredSoFar = (): ReadonlySet<ItemKind> =>
  new Set<ItemKind>(ritual.isAtLeast("rising") ? OFFERINGS : recall<ItemKind[]>("ritual.offered", []));

const isDroppedAtDock = (item: WorldItem) => item.isDropped === true && regionOfItem(item.position) === "나루터";

/**
 * 나루터가 닫힌 뒤(바위 아래에 넘어와 있음 — 부르는 쪽이 본다) 나루터 땅에 내려놓은 물건은 바위 아래로 가져온다. 문이 나루터로 못 돌아가게
 * 막아, 옛 저장에서 나루터에 두고 온 필수품(큰 진주 · 뜬 돌 등)을 못 찾아 막히는 일이 없게(나주지역막기 02회차 Codex). 경계 너머로
 * 내려놓은 것도 같다. 소지품에 자리가 있으면 소지품으로, 없으면 발치에. 가져온 것이 있으면 알린다
 */
export function collectDockLeftovers(x: number, z: number) {
  if (!inventory.world().some(isDroppedAtDock)) return;
  const brought = inventory.bringAlong(x, z, isDroppedAtDock);
  if (brought.length === 0) return;
  const names = [...new Set(brought)].map((kind) => ITEMS[kind].name).join(" · ");
  showNotice(`나루터에 두고 온 ${names}도 챙겼다.`, 3.5);
}

/**
 * 아직 소반에 안 올린 제물이 나루터 땅에 있나 — 있으면 바위 아래에서 나루터로 돌아가는 길을 열어 둔다(stageGates, 미르 11/11
 * 「2지역에 정상 진입한 뒤 1지역으로 못 돌아가게」의 안전판). 경계 가까이 내려놓았거나 · 옛 저장 · 사라진 물고기를 화톳불 곁에
 * 되살린 판(restoreLostFish)이 갇히지 않게(나주지역막기 01회차 Codex)
 */
export function hasUnofferedOfferingAtDock() {
  if (ritual.isAtLeast("rising")) return false;
  const offered = offeredSoFar();
  return inventory
    .world()
    .some(
      (item) => OFFERINGS.includes(item.kind) && !offered.has(item.kind) && regionOfItem(item.position) === "나루터",
    );
}

/**
 * 아직 구렁이상을 꺼내지 않은 아랑사의 함이 나루터 땅에 놓여 있나(옛 저장) — 함은 소지품 물건이 아니라 따로 저장돼(ridge.box)
 * collectDockLeftovers 가 못 가져온다. 그런 판은 나루터 길을 열어 둔다(나주지역막기 03회차 Codex)
 */
export function hasUnemptiedBoxAtDock() {
  if (ridgeBox.isEmptied) return false;
  const box = recall<{ phase?: string; restAt?: [number, number, number] } | null>("ridge.box", null);
  if (!box?.restAt || !box.phase || box.phase === "none") return false;
  return regionAt(box.restAt[0] / M, box.restAt[2] / M) === "나루터";
}

/** 나루터에 아직 할 일(가져올 것)이 남았나 — 있으면 바위 아래에서 나루터로 돌아가는 길을 막지 않는다(stageGates) */
export const isDockStillNeeded = () => hasUnofferedOfferingAtDock() || hasUnemptiedBoxAtDock();

exposeDevHook("najuLeftBehind", {
  state: () => ({
    pending: pendingNudge?.kind ?? null,
    isDockNudgeSpent,
    offeringHintLevel,
    offeringNudgeArmed,
    passed: hasPassedDockGate(),
    abisaOwed: isAbisaStoryOwed(),
    abisaHeard: isAbisaStoryHeard(),
  }),
  noteOfferingExamined,
  leftFishAtDock,
});
