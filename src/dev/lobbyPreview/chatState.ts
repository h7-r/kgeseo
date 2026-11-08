// 로비 채팅 화면 상태(미리보기 — 3단계에서 그대로 옮긴다). 설계 v0.21 5절 · 검토 14회차.
//   · 대화 기록: 서버가 확정한 말(이름·가명 ID 포함) 최근 50줄. 숨긴 사람의 줄은 그릴 때 거른다(풀면 다시 보인다).
//   · 숨기기: 가명 ID(pid)를 이 브라우저 저장소에 둔다 — 다시 들어와도 유지. 남에게 알리지 않는다.
//   · 알림: 내 말이 거절된 까닭을 잠깐 보여 준다.
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";
import { chatLength } from "@/net/chatText";
import type { ChatEvent, ChatRejectReason } from "@/net/colyseus";

export const CHAT_LOG_LIMIT = 50;
const MUTE_KEY = "kgeseo.lobby.mutedPids.v1";

/** 말풍선 수명 — 4초 + 글자당 0.08초, 최대 9초(긴 말을 읽을 시간) */
export const chatBubbleMs = (text: string) => Math.min(9000, 4000 + 80 * chatLength(text));

export const CHAT_REJECT_TEXT: Readonly<Record<ChatRejectReason, string>> = {
  rate: "조금 천천히 보내 주세요",
  length: "1~40자로 보내 주세요",
  repeat: "같은 말은 30초 뒤에 다시 보낼 수 있어요",
  contact: "연락처·주소는 보낼 수 없어요",
  word: "보낼 수 없는 말이 있어요",
};

export interface ChatLine extends ChatEvent {
  id: number;
  at: number;
}

interface ChatState {
  lines: readonly ChatLine[];
  muted: ReadonlySet<string>;
  notice: { text: string; tone: "error" | "info" } | null;
  /** 마지막 줄이 들어온 때(흐려지기 계산) */
  lastLineAt: number;
}

function loadMuted(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

let state: ChatState = { lines: [], muted: loadMuted(), notice: null, lastLineAt: 0 };
let nextId = 1;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const signal = createChangeSignal();
const set = (patch: Partial<ChatState>) => {
  // 바뀔 때마다 새 객체 — useSyncExternalStore 가 바뀐 것만 다시 그린다
  state = { ...state, ...patch };
  signal.notify();
};

export const useChatState = () => useSyncExternalStore(signal.subscribe, () => state);
export const isMuted = (pid: string) => state.muted.has(pid);

export function addChatLine(event: ChatEvent) {
  const now = Date.now();
  set({ lines: [...state.lines, { ...event, id: nextId++, at: now }].slice(-CHAT_LOG_LIMIT), lastLineAt: now });
}

/** 숨기기·풀기. 숨기면 true */
export function toggleMute(pid: string): boolean {
  const muted = new Set(state.muted);
  const nowMuted = !muted.delete(pid);
  if (nowMuted) muted.add(pid);
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify([...muted]));
  } catch {
    // 저장이 막혀도 이번 화면에서는 숨긴다
  }
  set({ muted });
  return nowMuted;
}

/** 알림 — 거절은 error(붉게), 숨기기 확인 같은 것은 info */
export function showChatNotice(text: string, tone: "error" | "info" = "error", ms = 2200) {
  if (noticeTimer) clearTimeout(noticeTimer);
  set({ notice: { text, tone } });
  noticeTimer = setTimeout(() => set({ notice: null }), ms);
}
