/**
 * 지난 글 — 화면에 떴던 대사 · 알림을 최근 것부터 되읽게 모아 둔다(베타 11/13 「글이 사라지고 다시 읽을 수 없다」).
 * 멈춤 메뉴가 보여 준다. 저장하지 않는다(이번 접속 동안만). React · 별칭을 쓰지 않는다(node --test).
 */
export interface LogEntry {
  who: string;
  text: string;
}

const LIMIT = 60;
let entries: LogEntry[] = [];
const listeners = new Set<() => void>();

/** 굵게 표시(**)를 걷어 낸 글 */
const plain = (text: string) => text.replace(/\*\*/g, "").trim();

export const textLog = {
  add(who: string, text: string) {
    const clean = plain(text);
    if (!clean) return;
    const last = entries[entries.length - 1];
    // 같은 글이 이어 뜨면(쪽 넘김 · 다시 띄움) 한 번만 적는다
    if (last && last.who === who && last.text === clean) return;
    entries = [...entries.slice(-(LIMIT - 1)), { who, text: clean }];
    for (const listener of listeners) listener();
  },
  entries: () => entries,
  clear() {
    entries = [];
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
