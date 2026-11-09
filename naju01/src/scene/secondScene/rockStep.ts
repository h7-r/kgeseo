/** 바위 아래 진행 단계 읽기 — 어부 길잡이 한 줄을 고른다(SecondSceneActors) */
import { fishTrapPuzzle } from "../../puzzles/fishTrap/fishTrapState";
import { inventory, type ItemKind } from "../../puzzles/inventory";
import { jarPuzzle } from "../../puzzles/jars/jarState";
import { makgeolliBottle } from "../../puzzles/makgeolli/makgeolliState";
import { ritual } from "../../puzzles/ritual/ritualState";
import { recall } from "../../save/puzzleMemory";
import type { RockStep } from "./fisherLines";

const holds = (kind: ItemKind) => inventory.has(kind) || inventory.hand()?.kind === kind;

/** 바위 아래 지금 단계 — 길잡이 한 줄을 고른다(떨어진 쌀처럼 급한 것 먼저) */
export function currentRockStep(): RockStep {
  if (ritual.isAtLeast("cave")) return "done";
  if (ritual.isAtLeast("parted")) return "parted";
  if (ritual.isAtLeast("rising")) return "floats";
  if (ritual.isAtLeast("drawing")) return "offering";
  const trap = fishTrapPuzzle.stage();
  if (trap !== "lit" && trap !== "told") return "fire";
  const isRiceDone = holds("rice") || recall<string[]>("ritual.offered", []).includes("rice");
  if (jarPuzzle.stage() === "open" && !isRiceDone) return "rice";
  if (!makgeolliBottle.isTaken()) return "bottle";
  if (jarPuzzle.stage() !== "open") return "jars";
  return "cairns";
}
