// 로비 실제 화면 미리보기 — Canvas 밖(DOM). 「혼자 둘러보는 중」, 인사창, 개발용 조작.
// 인사창: 포인터 잠금 중 G → 숫자 1~6 / 커서가 보일 때 💬 단추 → 클릭. Esc·G 로 닫는다(설계 5절).
// 오른쪽 키패드 1~6 은 인사창 없이 바로 인사한다(미르 11/6 — 게임이 키패드를 안 쓴다). 위 줄 숫자는 인사창이 열렸을 때만.
// 1인칭에서는 내 말풍선이 눈 위라 안 보이므로 화면 아래에 띄운다. 쿨다운(3초) 중이면 짧게 알린다.
// 컷신·본편 화면창·자물쇠 확대 중에는 인사창을 열지 않고, 열려 있으면 닫는다(설계 5절).
// 모양은 동작 확인용이다 — 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
import { useEffect, useState, type CSSProperties } from "react";

import { playerView } from "@/engine/playerView";
import { isTypingTarget, useOpenLayer } from "@/game/overlayLayer";
import { useLockControl } from "@/props/combinationLockState";
import { useIsCutscenePlaying } from "@/props/vendingPushState";
import { useDispatchState } from "@/tutorial/dispatchState";

import ChatBox from "./ChatBox";
import { JUKEBOX_WIDTH, useMusic } from "./music/musicState";
import { bubbles, connection, devLogin, greet, GREETINGS, usePreviewState } from "./previewState";
import SpeechBubble from "./SpeechBubble";

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
  REPLACED: "다른 곳에서 같은 계정으로 접속함",
  REMOVED: "로비 이용이 제한됨",
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
  const musicMode = useMusic().mode;
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const cutscene = useIsCutscenePlaying();
  // 본편 화면창(소지품·설정 등)이나 자물쇠 확대가 열려 있으면 인사 입력을 받지 않는다(설계 5절 「동시에 열리지 않게」)
  const openLayer = useOpenLayer();
  const lockControl = useLockControl();
  const connected = status.kind === "connected";
  const busy = cutscene || openLayer !== null || lockControl !== null;
  // 인사를 할 수 있는 때: 붙어 있고, 컷신·화면창·자물쇠가 아닐 때
  const canGreet = connected && !busy;
  // 채팅은 출동 경보 중에도 열지 않는다 — 경보 카드가 Enter 를 출동 확인으로 받는다(검토 14회차 3)
  const dispatchPhase = useDispatchState().phase;
  const canChat = canGreet && dispatchPhase !== "alert";
  // 그런 것이 열리면 인사창을 닫는다(렌더 중 이전 값과 비교 — effect 안 setState 를 피한다)
  const [wasBusy, setWasBusy] = useState(busy);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (busy) setPickerOpen(false);
  }
  // 같은 방 사람 수·1인칭 내 말풍선은 상태 변화가 아니라 방 상태에서 읽는다 — 0.2초마다 다시 본다
  const [roomSize, setRoomSize] = useState(0);
  const [firstPersonBubble, setFirstPersonBubble] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setRoomSize(connection.players().size);
      const current = connection.status();
      const said = current.kind === "connected" ? bubbles.get(current.sessionId) : undefined;
      const text = said && said.until > Date.now() && !playerView.isThirdPerson ? said.text : null;
      setFirstPersonBubble(text);
    }, 200);
    return () => clearInterval(timer);
  }, []);
  // 쿨다운 중에 누르면 「잠시 뒤」를 잠깐 보여 준다
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 1500);
    return () => clearTimeout(timer);
  }, [notice]);

  // 포인터 잠금 여부(커서가 보일 때만 💬 단추)
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  // G 로 열고 닫기, 열려 있을 때만 숫자 1~6 이 인사, Esc 로 닫기. 입력칸에 쓰는 중이면 무시
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 입력칸에 쓰는 중, 누르고 있어 반복되는 키, 조합키(Ctrl·Cmd·Alt)는 무시 — 본편 키 처리와 같은 기준
      if (isTypingTarget(event.target) || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "KeyG" && canGreet) {
        setPickerOpen((open) => !open);
        return;
      }
      if (event.code === "Escape") {
        setPickerOpen(false);
        return;
      }
      // 오른쪽 키패드 1~6 은 바로, 위 줄 숫자는 인사창이 열렸을 때만
      const numpad = /^Numpad([1-6])$/.exec(event.code);
      const digit = /^Digit([1-6])$/.exec(event.code);
      const id = numpad ? Number(numpad[1]) : digit && pickerOpen ? Number(digit[1]) : null;
      if (id !== null && canGreet) {
        if (!greet(id)) setNotice("인사는 3초에 한 번 할 수 있어요");
        setPickerOpen(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [canGreet, pickerOpen]);

  const statusLine =
    status.kind === "idle"
      ? "본부실 밖 — 본부실에 들어서면 자동으로 로비에 붙습니다"
      : status.kind === "connecting"
        ? "로비에 붙는 중…"
        : status.kind === "connected"
          ? `로비 연결됨 · 같은 방 ${roomSize}명 · G: 인사 · 키패드 1~6: 바로 인사 · Enter: 채팅`
          : `혼자 둘러보는 중(${REASON_TEXT[status.reason] ?? status.reason})${
              status.nextRetryAt ? " · 재시도 예약됨" : " · 이번 방문 재시도 없음"
            }`;

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30 }}>
      {(firstPersonBubble || notice) && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 96,
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          {firstPersonBubble && <SpeechBubble text={firstPersonBubble} />}
          {notice && <div style={{ ...panel, padding: "4px 10px", fontSize: 12 }}>{notice}</div>}
        </div>
      )}
      <ChatBox canChat={canChat} />
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

      {canGreet && !locked && (
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

      {pickerOpen && canGreet && (
        <div
          style={{
            ...panel,
            position: "absolute",
            // 미니 음악 플레이어가 오른쪽에 떠 있으면 그 왼쪽에 연다 — 플레이어를 덮으면 안 된다(유튜브 규정)
            right: musicMode === "mini" ? 16 + JUKEBOX_WIDTH + 12 : 16,
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
                if (!greet(index + 1)) setNotice("인사는 3초에 한 번 할 수 있어요");
                setPickerOpen(false);
              }}
            >
              {index + 1}. {text}
            </button>
          ))}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>숫자 1~6 · 키패드는 바로 · Esc·G 닫기</div>
        </div>
      )}
    </div>
  );
}
