/**
 * 계정 저장 불러오기 결과 가르기 · 「저장을 불러오지 못했어요」 안내 상태(11/12 베타 전 수정).
 *
 * 불러오기가 실패하면 저장은 지금처럼 멈춘다(빈 진행으로 서버 저장본을 덮지 않게). 다만 조용히 멈추면 플레이어는 진행이 안 남는 줄
 * 모르고 하다가 새로고침 때 잃는다 — 그래서 실패를 「로그인 안 함」과 갈라 안내를 띄운다.
 *   200            불러옴(저장이 없으면 null) — 저장한다
 *   401            로그인 안 함(손님) — 안내 없이 저장 없이 시작한다
 *   그 밖 · 연결 실패 · 모양이 틀림  불러오지 못함 — 저장을 멈추고 안내를 띄운다
 * React · 별칭(@/) · import.meta.env 를 쓰지 않는다(naju01/tests 의 node --test 가 바로 읽는다).
 */

export interface LoadedSave {
  revision: number;
  stage: string;
  state: { sections?: Record<string, unknown> };
}

export type SaveLoadOutcome =
  { kind: "loaded"; save: LoadedSave | null } | { kind: "guest" } | { kind: "failed"; reason: string };

function isLoadedSave(body: unknown): body is LoadedSave {
  if (!body || typeof body !== "object") return false;
  const { revision, state } = body as Partial<LoadedSave>;
  return typeof revision === "number" && !!state && typeof state === "object";
}

/** GET /api/v1/me/game-save 를 한 번 부르고 결과를 가른다. request 가 던지면(연결 실패) 실패다 */
export async function loadGameSave(
  request: () => Promise<{ status: number; body: unknown }>,
): Promise<SaveLoadOutcome> {
  let answer: { status: number; body: unknown };
  try {
    answer = await request();
  } catch {
    return { kind: "failed", reason: "network" };
  }
  if (answer.status === 401) return { kind: "guest" };
  if (answer.status !== 200) return { kind: "failed", reason: String(answer.status) };
  if (answer.body === null) return { kind: "loaded", save: null };
  return isLoadedSave(answer.body) ? { kind: "loaded", save: answer.body } : { kind: "failed", reason: "invalid" };
}

/** 이 결과로 저장을 해도 되는가 — 불러온 때만. 실패 · 손님이면 저장을 멈춘다(지금 동작 그대로) */
export const canSaveAfter = (outcome: SaveLoadOutcome): boolean => outcome.kind === "loaded";

/** 「저장을 불러오지 못했어요」 안내 — 띄움 · 닫음. 닫아도 저장은 멈춘 그대로다(새로고침해야 다시 불러온다) */
export function createSaveLoadNotice() {
  let isFailed = false;
  let isDismissed = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** 지금 안내를 띄우는가 */
    isShown: () => isFailed && !isDismissed,
    /** 불러오기 결과를 넘긴다 — 실패일 때만 안내가 뜬다 */
    report(outcome: SaveLoadOutcome) {
      if (outcome.kind !== "failed" || isFailed) return;
      isFailed = true;
      emit();
    },
    dismiss() {
      if (isDismissed) return;
      isDismissed = true;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SaveLoadNotice = ReturnType<typeof createSaveLoadNotice>;

/** 페이지에 하나 — gameSave 가 알리고 SaveLoadFailedNotice 가 그린다(본편 · 나주 같은 것) */
export const saveLoadNotice = createSaveLoadNotice();

export const SAVE_LOAD_FAILED_TEXT = {
  title: "저장을 불러오지 못했어요. 지금 새로고침해 주세요",
  body: "이대로 하면 진행이 저장되지 않아요.",
  reload: "새로고침",
  close: "닫기",
} as const;
