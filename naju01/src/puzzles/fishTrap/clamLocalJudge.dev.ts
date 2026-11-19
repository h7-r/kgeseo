/**
 * 개발 빌드 전용 — 서버 판정을 쓸 수 없을 때(대응표 확정 전 · 세션 없음)만 P01 을 로컬로 판정한다.
 * ClamDig 가 `if (import.meta.env.DEV)` 안에서만 동적으로 불러온다 → 배포 빌드에는 이 판정이 들어가지 않는다.
 * 값은 따로 적지 않고 숨구멍 자료(breathHoles)에서 호미 자루 셈법대로 읽는다 — 가장 많이 뿜는 구멍이 조개, 가장 적게 뿜는 구멍이 게.
 */
import type { DigResult } from "./clamAnswer";
import { HOLES } from "./breathHoles";

const counts = HOLES.map((hole) => hole.puffs);
const CLAM = Math.max(...counts);
const CRAB = Math.min(...counts);

export const isLocalClamHole = (hole: number) => HOLES[hole]?.puffs === CLAM;

/** 조개 구멍 전부 */
export const localClamHoles = () => HOLES.flatMap((_, hole) => (isLocalClamHole(hole) ? [hole] : []));

/** 구멍 hole 을 팠다(dug 는 그 구멍까지 포함한 판 구멍 전부) */
export function localDigResult(dug: readonly number[], hole: number): DigResult {
  const puffs = HOLES[hole]?.puffs;
  const find = puffs === CLAM ? "clam" : puffs === CRAB ? "crab" : "worm";
  return { find, done: find === "clam" && localClamHoles().every((clam) => dug.includes(clam)) };
}
