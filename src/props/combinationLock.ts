/**
 * 번호 자물쇠의 다이얼 상태와 [E] 조작 모드.
 * Leva 「맞춤N」은 화면을 맞출 때 내가 돌리는 값이라, 플레이어가 돌리는 값은 여기 따로 담고
 * Leva 를 만졌을 때만 씨앗을 다시 뿌린다(한 값으로 쓰면 다음 렌더에 Leva 값으로 튕긴다).
 * 조작 단계가 active/leaving 둘인 이유: ESC 순간 끝내면 카메라가 돌아오는 동안 이동이
 * 되살아나 화면이 두 힘에 끌려 떤다. ESC 는 leaving 으로만 바꾸고 카메라가 다 돌아오면 끝낸다.
 */
import { useSyncExternalStore } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

/** 다이얼 문자열을 외부 판정기(서버)에 내고 맞았는지 받는다. */
export type LockSubmitter = (answer: string) => boolean | Promise<boolean>;

export interface LockState {
  /** 줄마다 지금 가리키는 글자 번호 */
  digits: number[];
  /** 줄마다 정답 글자 번호. 비어 있으면 절대 안 풀린다. */
  answer: number[];
  /** 줄마다 새겨진 글자 세트 */
  glyphs: string[];
  unlocked: boolean;
  /** 서버에서 이미 풀린 채로 되살렸다 — 열리는 연출 없이 바로 열린 자세로 둔다. */
  openInstantly: boolean;
  submit?: LockSubmitter;
  submitting: boolean;
  selectedRow: number;
}

export type LockControlPhase = "active" | "leaving";

export interface LockControl {
  id: string;
  phase: LockControlPhase;
}

export interface LockSeed {
  digits?: number[];
  answer?: string | number;
  /** 줄마다 다른 글자 세트. 문자열 하나면 모든 줄이 같이 쓴다. */
  glyphs?: string | string[];
  submit?: LockSubmitter;
}

const locks = new Map<string, LockState>();
/** 자물쇠가 등록되기 전에 들어온 완료 복원 — 등록할 때 풀린 채로 시작한다. */
const pendingRestores = new Set<string>();
let control: LockControl | null = null;
const signal = createChangeSignal();

const wrap = (value: number, count: number) => ((Math.round(value) % count) + count) % count;

const warnedIds = new Set<string>();

/**
 * 자물쇠를 등록한다(이미 있으면 번호·정답만 새로 맞춘다). 렌더 중이 아니라 effect 에서 부른다.
 */
export function seedLock(id: string, { digits, answer, glyphs = "0123456789", submit }: LockSeed) {
  if (!id) return;
  const rowCount = Array.isArray(glyphs) ? glyphs.length : (digits?.length ?? String(answer ?? "").length) || 1;
  const rowGlyphs = Array.from(
    { length: rowCount },
    (_, i) => String((Array.isArray(glyphs) ? glyphs[i] : glyphs) ?? "") || "0123456789",
  );
  const previous = locks.get(id);
  const restored = pendingRestores.delete(id);
  const nextDigits = Array.from({ length: rowCount }, (_, i) => wrap((digits ?? [])[i] ?? 0, rowGlyphs[i].length));
  // 정답 글자가 그 줄에 없으면 절대 못 푸는 자물쇠다. 조용히 0 번으로 바꾸지 말고 비워서 알린다.
  const answerText = String(answer ?? "").toUpperCase();
  let nextAnswer = answerText.split("").map((c, i) => (rowGlyphs[i] ?? "").indexOf(c));
  if (nextAnswer.some((v) => v < 0) || nextAnswer.length !== rowCount) {
    if (answerText && !warnedIds.has(id)) {
      warnedIds.add(id);
      console.error(
        `[번호잠금] "${id}" 정답 "${answerText}" 을 줄에서 못 찾았습니다 — 이 자물쇠는 안 열립니다.`,
        rowGlyphs,
      );
    }
    nextAnswer = [];
  }
  // 처음부터 정답을 가리키면 문이 열린 채 시작한다. 한 칸만 옆으로 민다.
  if (nextAnswer.length && nextAnswer.every((v, i) => v === nextDigits[i]) && rowGlyphs[0].length > 1)
    nextDigits[0] = wrap(nextDigits[0] + 1, rowGlyphs[0].length);
  locks.set(id, {
    digits: nextDigits,
    answer: nextAnswer,
    glyphs: rowGlyphs,
    // 풀린 자물쇠는 다시 잠그지 않는다 — Leva 를 만졌다고 문이 도로 잠기면 황당하다.
    unlocked: previous?.unlocked ?? restored,
    openInstantly: previous?.openInstantly ?? restored,
    submit,
    submitting: previous?.submitting ?? false,
    selectedRow: Math.min(previous?.selectedRow ?? 0, Math.max(0, nextDigits.length - 1)),
  });
  signal.notify();
}

export const lockState = (id: string | null | undefined) => (id ? (locks.get(id) ?? null) : null);

/** 등록돼 있고 아직 안 풀렸으면 잠긴 것이다. */
export const isLocked = (id: string | null | undefined) => {
  const lock = lockState(id);
  return !!lock && !lock.unlocked;
};

export const useLock = (id: string | null | undefined) =>
  useSyncExternalStore(signal.subscribe, () => (id ? (locks.get(id) ?? null) : null));

/**
 * 풀렸나만 구독한다. useLock 은 다이얼 한 칸마다 새 값이라 복도가 구독하면
 * 키를 누를 때마다 복도 전체가 다시 그려진다.
 */
export const useLockUnlocked = (id: string | null | undefined) =>
  useSyncExternalStore(signal.subscribe, () => !!(id && locks.get(id)?.unlocked));

/** 자물쇠가 실제로 서 있나. */
export const useLockExists = (id: string | null | undefined) =>
  useSyncExternalStore(signal.subscribe, () => !!(id && locks.has(id)));

// ── 조작 모드 ──
export const lockControl = () => control;
export const useLockControl = () => useSyncExternalStore(signal.subscribe, () => control);
/** 지금 이 자물쇠를 만지는 중인가(매 프레임 물어봐도 되게 가볍다). */
export const isHandlingLock = (id: string) => !!control && control.id === id && control.phase === "active";

export function startLockControl(id: string) {
  if (!id || !locks.has(id)) return false;
  if (control && control.id === id) return false;
  control = { id, phase: "active" };
  signal.notify();
  return true;
}

/** ESC — 나가는 중으로만 바꾼다. 카메라가 다 돌아오면 endLockControl() 이 불린다. */
export function leaveLockControl() {
  if (!control || control.phase === "leaving") return;
  control = { id: control.id, phase: "leaving" };
  signal.notify();
}

export function endLockControl() {
  if (!control) return;
  control = null;
  signal.notify();
}

// ── 다이얼 돌리기 ──
function update(id: string, change: (lock: LockState) => Partial<LockState>) {
  const lock = locks.get(id);
  if (!lock) return;
  locks.set(id, { ...lock, ...change(lock) });
  signal.notify();
}

/** 칸 고르기 — 끝에서 더 가면 반대쪽으로 돈다(막히면 답답하다). */
export function selectLockRow(id: string, direction: number) {
  update(id, (lock) => {
    const n = lock.digits.length;
    if (n === 0) return {};
    return { selectedRow: (((lock.selectedRow + direction) % n) + n) % n };
  });
  playSound("lockDial", { volume: 0.9 });
}

export function setLockRow(id: string, row: number) {
  update(id, (lock) => ({
    selectedRow: Math.max(0, Math.min(lock.digits.length - 1, Math.round(row))),
  }));
}

/** 고른 칸의 글자를 한 칸 돌린다. 줄마다 글자 수가 다를 수 있어 그 줄의 수로 돈다. */
export function turnLockDigit(id: string, direction: number) {
  update(id, (lock) => {
    const count = (lock.glyphs[lock.selectedRow] ?? "").length || 10;
    const digits = lock.digits.slice();
    digits[lock.selectedRow] = wrap((digits[lock.selectedRow] ?? 0) + direction, count);
    return { digits };
  });
  playSound("lockDial", { volume: 0.9 });
}

/** 지금 맞춰 놓은 번호가 정답인가. 맞으면 풀린 채로 남는다. */
export function tryLockAnswer(id: string) {
  const lock = locks.get(id);
  if (!lock) return false;
  // 정답이 없으면 아무 번호나 통과시키지 않는다 — 문이 그냥 열려 버린다.
  if (lock.answer.length === 0) return false;
  const correct = lock.answer.length === lock.digits.length && lock.answer.every((v, i) => v === lock.digits[i]);
  if (correct && !lock.unlocked) {
    locks.set(id, { ...lock, unlocked: true, openInstantly: false });
    playSound("lockOpen", { volume: 0.9 });
    signal.notify();
  }
  return correct;
}

/** 현재 다이얼 문자열을 외부 판정기에 낸다. 판정기가 없으면 로컬 판정을 쓴다. */
export async function submitLockAnswer(id: string): Promise<boolean | null> {
  const lock = locks.get(id);
  if (!lock || lock.submitting) return null;
  if (lock.unlocked) return true;
  if (!lock.submit) return tryLockAnswer(id);

  const answer = lock.digits.map((v, i) => lock.glyphs[i]?.[v] ?? "").join("");
  update(id, () => ({ submitting: true }));
  try {
    const correct = await lock.submit(answer);
    if (correct) {
      update(id, () => ({ unlocked: true, openInstantly: false }));
      playSound("lockOpen", { volume: 0.9 });
    }
    return correct;
  } finally {
    update(id, () => ({ submitting: false }));
  }
}

export function unlockLock(id: string) {
  update(id, () => ({ unlocked: true, openInstantly: false }));
}

/** 서버에서 이미 완료된 상태를 성공 연출 없이 월드에 되살린다. */
export function restoreUnlocked(id: string | null | undefined) {
  if (!id) return;
  if (!locks.has(id)) {
    pendingRestores.add(id);
    return;
  }
  update(id, () => ({ unlocked: true, openInstantly: true }));
}

export function relockLock(id: string) {
  pendingRestores.delete(id);
  update(id, () => ({ unlocked: false, openInstantly: false }));
}

// 콘솔에서 손으로 풀어 보며 퍼즐이 진짜 풀리는지 확인한다.
exposeDevHook("combinationLock", {
  lockState,
  unlockLock,
  relockLock,
  lockControl,
  setLockRow,
  turnLockDigit,
  tryLockAnswer,
  submitLockAnswer,
  version: signal.version,
});
