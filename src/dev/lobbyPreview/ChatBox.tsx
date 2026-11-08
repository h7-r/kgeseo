// 로비 채팅 상자(미리보기 — 3단계에서 그대로 옮긴다). 설계 v0.21 5절 · 검토 14회차.
//   · Enter 로 열고, Enter 로 보내고, Esc 로 닫는다(쓰던 글은 남는다). 한글 조합 중 Enter 는 글자 확정이라 보내지 않는다.
//   · 열 때 마우스 잠금을 푼다 — 이동·시점 회전·클릭 공격이 멈추고 커서로 이름을 누를 수 있다(본편 화면창과 같은 방식).
//     Enter 로 보내고 닫으면 열기 전 잠금 상태로 되돌린다. Esc 로 닫으면 그대로(T 로 다시 잠근다 — 브라우저가 Esc 로는 못 잠근다).
//   · 대화 기록은 왼쪽 아래(내 말은 그 칸의 오른쪽 끝), 닫혀 있으면 최근 8줄이 12초 뒤 사라지고, 열면 50줄까지 스크롤. 이름을 누르면 숨기기·풀기.
//   · 컷신·화면창·자물쇠·출동 경보 중에는 열리지 않고, 열려 있으면 닫힌다. 화면 터치만 되는 기기에서는 숨긴다(PC 먼저).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { isTypingTarget } from "@/game/overlayLayer";
import { CHAT_MAX_CHARS, chatLength, normalizeChatText } from "@/net/chatText";

import { showChatNotice, useChatState } from "./chatState";
import { connection, sendChat, toggleMutePlayer } from "./previewState";

const VISIBLE_LINES = 8;
const FADE_AFTER_MS = 12_000;

const touchOnly = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

const panel: CSSProperties = {
  position: "absolute",
  left: 16,
  bottom: 136,
  width: 380,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  font: "13px/1.4 system-ui, sans-serif",
  color: "#f2f2f2",
  transition: "opacity 0.6s",
};
const lineStyle: CSSProperties = {
  background: "rgba(16, 18, 22, 0.62)",
  padding: "3px 9px",
  borderRadius: 8,
  overflowWrap: "anywhere",
  width: "fit-content",
  maxWidth: "100%",
};
const nameButton: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "700 13px/1.4 system-ui, sans-serif",
  color: "#9ccaff",
  cursor: "pointer",
};
const inputRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(16, 18, 22, 0.9)",
  borderRadius: 10,
  padding: "6px 8px",
  pointerEvents: "auto",
};
const smallButton: CSSProperties = {
  padding: "3px 9px",
  borderRadius: 7,
  border: "1px solid #5b6270",
  background: "#2a2f37",
  color: "#fff",
  cursor: "pointer",
  font: "12px system-ui, sans-serif",
};

/** 가명 ID 의 이름 — 지금 방에 있으면 방 상태, 없으면 기록의 마지막 이름 */
function nameOfPid(pid: string, lines: readonly { pid: string; nickname: string }[]) {
  for (const player of connection.players().values()) if (player.pid === pid) return player.nickname;
  return lines.findLast((line) => line.pid === pid)?.nickname ?? "나간 조사관";
}

export default function ChatBox({ canChat }: { canChat: boolean }) {
  const { lines, muted, notice, lastLineAt } = useChatState();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ pid: string; nickname: string } | null>(null);
  const [showMuted, setShowMuted] = useState(false);
  const [locked, setLocked] = useState(() => typeof document !== "undefined" && !!document.pointerLockElement);
  // 마지막 줄 이후 조용해져 흐려진 때의 그 줄 시각 — 새 줄이 오면 값이 달라져 다시 진해진다
  const [quietAt, setQuietAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // 열기 전에 잠겨 있던 요소 — 본편 조작기(PointerLockControls)는 캔버스가 아니라 R3F 의 감싼 요소를 잠근다(Codex 리뷰).
  // 같은 요소를 다시 잠가야 조작기가 「잠김」으로 받는다
  const relockTarget = useRef<Element | null>(null);
  const [hidden] = useState(touchOnly);

  // 열 수 없게 되면(컷신·화면창·자물쇠·출동 경보·연결 끊김) 닫는다 — 렌더 중 이전 값과 비교(effect 안 setState 피함)
  const [couldChat, setCouldChat] = useState(canChat);
  if (canChat !== couldChat) {
    setCouldChat(canChat);
    if (!canChat) {
      setOpen(false);
      setMenu(null);
    }
  }

  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  const openChat = () => {
    relockTarget.current = document.pointerLockElement;
    if (document.pointerLockElement) document.exitPointerLock();
    setOpen(true);
  };

  // Enter 로 열기(입력칸에 쓰는 중·키 반복·조합키는 무시 — 본편 키 처리와 같은 기준)
  useEffect(() => {
    if (hidden) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
      if (open || !canChat || isTypingTarget(event.target) || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      openChat();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, canChat, hidden]);

  // 열리면 입력칸에 커서
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 새 줄이 오면 진하게, 닫혀 있고 12초 조용하면 사라진다(열면 늘 보인다)
  useEffect(() => {
    const timer = setTimeout(() => setQuietAt(lastLineAt), Math.max(0, lastLineAt + FADE_AFTER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [lastLineAt]);
  const faded = !open && quietAt === lastLineAt;

  // 열려 있을 때 기록은 맨 아래로
  useLayoutEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, lines]);

  if (hidden) return null;

  const status = connection.status();
  const mySid = status.kind === "connected" ? status.sessionId : null;
  // 내 말은 연결 ID 가 아니라 가명 ID 로 가린다 — 다시 접속하면 연결 ID 가 바뀌어 옛 줄이 남의 말로 보이고 나를 숨길 수 있었다(Codex 리뷰)
  const myPid = mySid ? (connection.players().get(mySid)?.pid ?? null) : null;
  const shown = lines.filter((line) => !muted.has(line.pid));
  const visible = open ? shown : shown.slice(-VISIBLE_LINES);
  const count = chatLength(normalizeChatText(draft));
  const tooLong = count > CHAT_MAX_CHARS;
  // 커서가 보일 때만 이름을 누를 수 있다(잠금 중엔 커서가 없다). 연결이 없으면 내 가명 ID 를 몰라 누르지 못하게 한다
  const canClickNames = (open || !locked) && myPid !== null;

  const close = (relock: boolean) => {
    setOpen(false);
    setMenu(null);
    inputRef.current?.blur();
    // Enter(사용자 입력)로 닫을 때만 다시 잠근다 — 본편 화면창처럼 열기 전 상태로, 같은 요소를
    const target = relockTarget.current;
    relockTarget.current = null;
    if (relock && target?.isConnected) void Promise.resolve(target.requestPointerLock()).catch(() => undefined);
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중 Enter 는 글자 확정이다 — 보내지 않는다(isComposing·keyCode 229)
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (count === 0) {
      close(true);
      return;
    }
    if (tooLong) {
      showChatNotice(`${CHAT_MAX_CHARS}자까지 보낼 수 있어요`);
      return;
    }
    if (sendChat(draft)) setDraft("");
    close(true);
  };

  return (
    <div style={{ ...panel, pointerEvents: "none" }}>
      <div
        ref={logRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          maxHeight: open ? 300 : undefined,
          overflowY: open ? "auto" : "hidden",
          // 조용하면 기록만 흐려져 사라진다(채팅 단추·입력칸·알림은 그대로)
          opacity: faded ? 0 : 1,
          transition: "opacity 0.6s",
          pointerEvents: canClickNames && !faded ? "auto" : "none",
        }}
      >
        {visible.map((line) => {
          const mine = line.sid === mySid || (myPid !== null && line.pid === myPid);
          return (
            // 내 말은 오른쪽 끝에 붙인다(메신저처럼, 미르 11/7). 감긴 글자는 말풍선 안에서 왼쪽 정렬 그대로
            <div
              key={line.id}
              style={{
                ...lineStyle,
                background: mine ? "rgba(40, 62, 98, 0.72)" : lineStyle.background,
                alignSelf: mine ? "flex-end" : undefined,
              }}
            >
              {mine ? (
                <span style={{ ...nameButton, cursor: "default", color: "#ffd479" }}>{line.nickname}</span>
              ) : (
                <button
                  type="button"
                  style={nameButton}
                  title="숨기기·풀기"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => setMenu({ pid: line.pid, nickname: line.nickname })}
                >
                  {line.nickname}
                </button>
              )}
              <span>: {line.text}</span>
            </div>
          );
        })}
      </div>

      {menu && canClickNames && (
        <div style={{ ...inputRow, gap: 8 }} onMouseDown={(event) => event.stopPropagation()}>
          <span>{menu.nickname}</span>
          <button
            type="button"
            style={smallButton}
            onClick={() => {
              const nowMuted = toggleMutePlayer(menu.pid);
              showChatNotice(nowMuted ? `${menu.nickname}님의 말을 숨겼어요` : `${menu.nickname}님의 말을 다시 보여요`, "info");
              setMenu(null);
            }}
          >
            {muted.has(menu.pid) ? "숨기기 풀기" : "숨기기"}
          </button>
          <button type="button" style={smallButton} onClick={() => setMenu(null)}>
            닫기
          </button>
        </div>
      )}

      {/* 숨긴 사람은 기록에서 안 보여 이름으로 풀 수 없다 — 열려 있을 때 목록에서 푼다 */}
      {open && muted.size > 0 && (
        <div style={{ ...inputRow, flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <button type="button" style={smallButton} onClick={() => setShowMuted((value) => !value)}>
            숨긴 사람 {muted.size}명 {showMuted ? "접기" : "보기"}
          </button>
          {showMuted &&
            [...muted].map((pid) => (
              <div key={pid} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span>{nameOfPid(pid, lines)}</span>
                <button
                  type="button"
                  style={smallButton}
                  onClick={() => {
                    toggleMutePlayer(pid);
                    showChatNotice(`${nameOfPid(pid, lines)}님의 말을 다시 보여요`, "info");
                  }}
                >
                  풀기
                </button>
              </div>
            ))}
        </div>
      )}

      {notice && (
        <div
          style={{
            ...lineStyle,
            background: notice.tone === "error" ? "rgba(120, 40, 40, 0.85)" : "rgba(30, 70, 60, 0.85)",
          }}
        >
          {notice.text}
        </div>
      )}

      {open ? (
        <div style={inputRow} onMouseDown={(event) => event.stopPropagation()}>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="Enter 보내기 · Esc 닫기"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#fff",
              font: "14px system-ui, sans-serif",
            }}
          />
          <span style={{ fontSize: 11, color: tooLong ? "#ff8a8a" : "#9aa3b2" }}>
            {count}/{CHAT_MAX_CHARS}
          </span>
        </div>
      ) : (
        canChat &&
        !locked && (
          <button
            type="button"
            style={{ ...smallButton, width: "fit-content", pointerEvents: "auto" }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openChat();
            }}
          >
            채팅 (Enter)
          </button>
        )
      )}
    </div>
  );
}
