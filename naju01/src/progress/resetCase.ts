/**
 * 나주(앙암바위)를 처음부터 다시 — 기차 목적지 창 「처음부터 다시」(미르 11/10). 본편 페이지에서 부르고, 그 뒤 나주로 들어간다.
 *  1. 저장본에서 나주 칸(naju.* — 퍼즐 단계 · 소지품 · 자리 · 동행 소개를 들었는지)을 지운다.
 *  2. 동행 서버 세션 기록에서 Play Session 번호만 버린다 — 다음 입장 때 새 세션이 생겨 서버 쪽 진행(푼 퍼즐 · 힌트 단계)도 처음부터.
 *     익명 세션(주인 쿠키)은 그대로 둔다.
 *  3. 지운 것을 서버 저장에 실제로 쓰고 확인한다 — 못 쓰면 지운 칸을 되돌리고 세션 번호도 그대로 둔 채 false
 *     (나주에 들어가지 않는다. 다음 자동 저장이 진행을 지우거나, 옛 진행이 새 서버 세션과 어긋나지 않게 — Codex 리뷰).
 *     세션 번호는 저장이 끝난 뒤에만 버린다.
 * 칸을 어떻게 읽고 지우는지는 나주가 안다(본편은 src/naju 입구로 부른다).
 */
import {
  detachSaveSections,
  isGameSaveEnabled,
  reattachSaveSections,
  removeSavedSections,
  restoreSavedSections,
  saveBeforeLeaving,
} from "@/save/gameSave";

import { SESSION_STORAGE_KEY } from "../companion/companionSession";

/** 나주 저장 칸 이름 앞머리 */
const NAJU_SECTION_PREFIX = "naju.";

function forgetPlaySession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const record = JSON.parse(raw) as Record<string, unknown>;
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...record, playSessionId: null }));
  } catch {
    // 기록이 깨졌으면 지운다 — 다음 입장 때 새로 만든다
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // 저장소가 막혔으면 그만
    }
  }
}

/** 진행 중인 처음부터 다시 — 목적지 창을 닫았다 다시 열어도 끝나기 전에는 들어가지 못하게(Codex 리뷰) */
let pending: Promise<boolean> | null = null;
export const pendingNajuReset = () => pending;

async function reset(): Promise<boolean> {
  const removed = removeSavedSections((name) => name.startsWith(NAJU_SECTION_PREFIX));
  // 결과가 올 때까지 기다린다 — 시간 넘김을 실패로 보면 늦게 도착한 저장이 서버 진행을 지운 뒤 화면만 되돌린 꼴이 된다(Codex 리뷰)
  if (!(await saveBeforeLeaving(null))) {
    restoreSavedSections(removed);
    return false;
  }
  forgetPlaySession();
  return true;
}

/** 나주 진행을 지우고 저장까지 마쳤으면 true. 이미 하는 중이면 그 결과를 같이 기다린다 */
export function resetNajuCase(): Promise<boolean> {
  pending ??= reset().finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * 나주 페이지 안에서 처음부터 다시 — 멈춤 메뉴 「처음부터 다시」(미르 11/11). 나주 칸은 이 페이지가 쓰고 있어 removeSavedSections 로는
 * 안 지워진다 — 등록째 떼어 내고(detachSaveSections) 저장을 마친 뒤 true. 부른 쪽이 페이지를 새로 연다(새 페이지는 빈 나주 칸으로 시작한다).
 * 떼어 낸 칸은 다시 붙이지 않는다 — 떠나기 전 저장(pagehide)이 옛 진행을 되살리지 않게. 못 쓰면 다시 붙이고 false(이 판 그대로 남는다).
 * 로그인하지 않았으면 서버 저장이 없다 — Play Session 번호만 버리고 true.
 */
export function restartNajuHere(): Promise<boolean> {
  pending ??= (async () => {
    if (!isGameSaveEnabled()) {
      forgetPlaySession();
      return true;
    }
    const detached = detachSaveSections((name) => name.startsWith(NAJU_SECTION_PREFIX));
    if (!(await saveBeforeLeaving(null))) {
      reattachSaveSections(detached);
      return false;
    }
    forgetPlaySession();
    return true;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
