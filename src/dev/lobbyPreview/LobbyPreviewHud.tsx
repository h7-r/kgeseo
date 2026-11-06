// 로비 실제 화면 미리보기 — Canvas 밖(DOM). 「혼자 둘러보는 중」, 인사창, 개발용 조작.
// 인사창: 포인터 잠금 중 G → 숫자 1~6 / 커서가 보일 때 💬 단추 → 클릭. Esc·G 로 닫는다(설계 5절).
// 모양은 동작 확인용이다 — 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
import { useEffect, useState, type CSSProperties } from "react";

import { connection, devLogin, greet, GREETINGS, usePreviewState } from "./previewState";

const REASON_TEXT: Record<string, string> = {
  LOGIN_REQUIRED: "로그인 안 됨",
  NOT_ALLOWED: "명단에 없음",
  RATE_LIMITED: "발급 한도",
  UNAVAILABLE: "로비 접속 실패",
  TIMEOUT: "시간 초과",
  DISCONNECTED: "연결 끊김",
  LOBBY_STOPPED: "로비 운영 중단",
  LOBBY_FULL: "방 상한",
  REJECTED: "로비 인증 거절",
  RETRYABLE_REJECT: "티켓 재시도",
};

const panel: CSSProperties = {
  background: "rgba(16, 18, 22, 0.82)",
  color: "#e8e8e8",
  borderRadius: 10,
  font: "13px system-ui, sans-serif",
  pointerEvents: "auto",
};
const button: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid #5b6270",
  background: "#2a2f37",
  color: "#fff",
  cursor: "pointer",
  font: "13px system-ui, sans-serif",
};

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

export default function LobbyPreviewHud() {
  const { status, me, loggedIn } = usePreviewState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const connected = status.kind === "connected";
  // 같은 방 사람 수는 상태 변화가 아니라 방 상태에서 읽는다 — 0.5초마다 다시 센다
  const [roomSize, setRoomSize] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setRoomSize(connection.players().size), 500);
    return () => clearInterval(timer);
  }, []);

  // 포인터 잠금 여부(커서가 보일 때만 💬 단추)
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // G 로 열고 닫기, 열려 있을 때만 숫자 1~6 이 인사, Esc 로 닫기. 입력칸에 쓰는 중이면 무시
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (event.code === "KeyG" && connected) {
        setPickerOpen((open) => !open);
        return;
      }
      if (event.code === "Escape") {
        setPickerOpen(false);
        return;
      }
      const digit = /^Digit([1-6])$/.exec(event.code);
      if (digit && pickerOpen) {
        greet(Number(digit[1]));
        setPickerOpen(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [connected, pickerOpen]);

  const statusLine =
    status.kind === "idle"
      ? "본부실 밖 — 본부실에 들어서면 자동으로 로비에 붙습니다"
      : status.kind === "connecting"
        ? "로비에 붙는 중…"
        : status.kind === "connected"
          ? `로비 연결됨 · 같은 방 ${roomSize}명 · G: 인사`
          : `혼자 둘러보는 중(${REASON_TEXT[status.reason] ?? status.reason})${
              status.nextRetryAt ? " · 재시도 예약됨" : " · 이번 방문 재시도 없음"
            }`;

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30 }}>
      {status.kind === "solo" && (
        <div style={{ ...panel, position: "absolute", top: 60, right: 16, padding: "4px 10px", fontSize: 12 }}>
          혼자 둘러보는 중
        </div>
      )}

      <div
        style={{ ...panel, position: "absolute", left: 16, bottom: 16, padding: "8px 12px", maxWidth: 420 }}
        onMouseDown={stop}
        onClick={stop}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>로비 미리보기 · 개발용</div>
        <div>{me}</div>
        <div style={{ color: "#ffd479", margin: "4px 0" }}>{statusLine}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            style={button}
            onClick={() => {
              // 튜토리얼을 건너뛰고 본부실 안으로(개발용)
              const teleport = window.__game?.teleport as ((x: number, z: number) => void) | undefined;
              teleport?.(-14, 7);
            }}
          >
            본부실로 이동
          </button>
        </div>
        {!loggedIn && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            <input
              placeholder="비밀번호"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              style={button}
              onClick={() => {
                void devLogin(email, password);
                setPassword("");
              }}
            >
              로그인
            </button>
          </div>
        )}
      </div>

      {connected && !locked && (
        <button
          type="button"
          aria-label="인사하기"
          style={{ ...button, position: "absolute", right: 16, bottom: 16, pointerEvents: "auto", fontSize: 18 }}
          onMouseDown={stop}
          onClick={(event) => {
            stop(event);
            setPickerOpen((open) => !open);
          }}
        >
          💬
        </button>
      )}

      {pickerOpen && connected && (
        <div
          style={{
            ...panel,
            position: "absolute",
            right: 16,
            bottom: 64,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
          onMouseDown={stop}
          onClick={stop}
        >
          {GREETINGS.map((text, index) => (
            <button
              key={text}
              type="button"
              style={{ ...button, textAlign: "left" }}
              onClick={() => {
                greet(index + 1);
                setPickerOpen(false);
              }}
            >
              {index + 1}. {text}
            </button>
          ))}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>숫자 1~6 · Esc·G 닫기</div>
        </div>
      )}
    </div>
  );
}
