/**
 * P01 조개 숨구멍 — 서버로 보내는 답의 모양과 이어 하기 기록. 정답은 들어 있지 않다(서버 server.json 에만).
 * 답: 지금까지 판 구멍 번호(0~6)를 작은 수부터 쉼표로 잇는다. 예: 구멍 4 · 1 을 팠다 → "1,4"
 * 서버는 공백을 지우고 비교한다(backend normalize_answer) — 쉼표 사이 공백은 넣지 않는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
export const CLAM_HOLE_COUNT = 7;

/** 판 구멍 하나에서 나온 것. unknown = 판정은 받았으나 무엇이 나왔는지는 모른다(서버가 구멍별 결과를 주지 않을 때) */
export type HoleFind = "clam" | "crab" | "worm" | "unknown";

/** 구멍 하나를 판 결과 — done 이면 조개 구멍을 다 찾았다(P01 완료) */
export interface DigResult {
  find: HoleFind;
  done: boolean;
}

const isHole = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < CLAM_HOLE_COUNT;

export function clamDugAnswer(dug: readonly number[]): string {
  if (!dug.every(isHole)) throw new Error("clam answer must use hole numbers 0-6");
  if (new Set(dug).size !== dug.length) throw new Error("clam answer must list each hole once");
  return [...dug].sort((a, b) => a - b).join(",");
}

/** 저장본 — puzzleMemory 의 clam.isDug(옛 열쇠 그대로) · clam.found · clam.pinches(새 열쇠, 옛 저장본엔 없다) */
export interface ClamMemory {
  isDug: unknown;
  found: unknown;
  pinches: unknown;
}

export interface ClamProgress {
  isDug: boolean[];
  /** 조개가 나온 구멍 — 판 차례대로. null 이면 옛 저장본이라 판정으로 다시 가려야 한다 */
  found: number[] | null;
  pinches: number;
}

/** 이어 하기 — 모양이 어긋난 값은 버린다. 찾은 구멍은 판 구멍 안에서만 믿는다 */
export function restoreClamProgress(memory: ClamMemory): ClamProgress {
  const saved = Array.isArray(memory.isDug) ? memory.isDug : [];
  const isDug = Array.from({ length: CLAM_HOLE_COUNT }, (_, k) => saved[k] === true);
  const found = Array.isArray(memory.found)
    ? memory.found.filter(
        (hole, index, all): hole is number => isHole(hole) && isDug[hole] && all.indexOf(hole) === index,
      )
    : null;
  const pinches = Number.isInteger(memory.pinches) && (memory.pinches as number) > 0 ? (memory.pinches as number) : 0;
  return { isDug, found, pinches };
}

/** 옛 저장본 — 판 구멍마다 판정을 다시 물어 조개가 나온 구멍만 고른다(캔 수를 0 에서 다시 세지 않게) */
export function deriveFound(isDug: readonly boolean[], isClamHole: (hole: number) => boolean): number[] {
  return isDug.flatMap((dug, hole) => (dug && isClamHole(hole) ? [hole] : []));
}

/** 판 구멍 번호 목록 — 제출 · 판정에 쓴다 */
export const dugHoles = (isDug: readonly boolean[]) => isDug.flatMap((dug, hole) => (dug ? [hole] : []));
