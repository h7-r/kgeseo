/**
 * 직접 청한 도움 — 도움 별(청하지 않으면 ★★★ · 청하면 ★★ · 정답을 열면 ★, 미르 11/11)용 기록.
 * 미르 정의(11/11) 「F 로 동행을 불러 Y 를 눌러서, 무엇을 하면 된다고 동행이 알려 준 것을 받았을 때」를 이렇게 센다:
 *   - [F] 보기 「여기서 뭘 해야 해요?」(보기가 둘이면 Y) — 동행이 대답했을 때 1회(dialogue/director)
 *   - [F] 보기 「힌트를 주세요」 → 정식 힌트를 열지 묻는 데 「네」(Y) → 힌트 글이 실제로 왔을 때 1회(companionBridge onRequestedHint).
 *     「아니요」 · 잔액 없음 · 연결 오류처럼 받은 것이 없으면 세지 않는다. 미리 보기 판은 넛지를 말한 때 1회
 *   - 정식 힌트 2단계(정답)를 받았다 — 「정답 확인」(다시 보기는 아니다). 2단계는 [F] 「힌트를 주세요」로만 열린다(companionBridge)
 * 세지 않는 것: 동행이 먼저 건넨 말 · 서버가 권한 힌트에 「네」(먼저 청한 것이 아니다) · 「괜찮아요」 · 말투 바꾸기.
 * 조사를 끝낸 뒤(playClock 확정)에는 더 세지 않는다. 서버 기록 · 별 표시는 아직 없다(정식 기록은 BE 와 정할 것).
 */
import { createChangeSignal } from "@/lib/changeSignal";
import { scheduleGameSave } from "@/save/gameSave";

import { playClock } from "./playClock";
import { betaSignals } from "../beta/betaSignals";

export interface SavedHelpLog {
  /** 직접 청한 도움 횟수 */
  asked: number;
  /** 정답(정식 힌트 2단계)을 열었다 */
  isAnswerSeen: boolean;
}

const signal = createChangeSignal();
let asked = 0;
let isAnswerSeen = false;

const isClosed = () => playClock.isFinal();

export const helpLog = {
  /** 플레이어가 청해 도움을 받았다 */
  noteAsked() {
    if (isClosed()) return;
    asked += 1;
    betaSignals.help("received", "direct");
    scheduleGameSave();
    signal.notify();
  },
  /** 정답을 열었다 */
  noteAnswerSeen() {
    if (isClosed() || isAnswerSeen) return;
    isAnswerSeen = true;
    betaSignals.help("answer_seen", "hint_answer");
    scheduleGameSave();
    signal.notify();
  },
  asked: () => asked,
  isAnswerSeen: () => isAnswerSeen,
  subscribe: signal.subscribe,
  version: signal.version,
  read: (): SavedHelpLog => ({ asked, isAnswerSeen }),
  restore(saved: unknown) {
    const value = saved as Partial<SavedHelpLog> | null;
    asked = typeof value?.asked === "number" && Number.isFinite(value.asked) && value.asked > 0 ? Math.floor(value.asked) : 0;
    isAnswerSeen = value?.isAnswerSeen === true;
    signal.notify();
  },
};

/** 도움 별 — 정답을 열었으면 ★, 청했으면 ★★, 아니면 ★★★ */
export function helpStars(log: SavedHelpLog): 1 | 2 | 3 {
  if (log.isAnswerSeen) return 1;
  return log.asked > 0 ? 2 : 3;
}
