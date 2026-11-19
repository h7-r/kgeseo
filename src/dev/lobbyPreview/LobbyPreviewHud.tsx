// 로비 실제 화면 미리보기 — Canvas 밖(DOM). 「혼자 둘러보는 중」, 인사창, 개발용 조작.
// 인사창: 포인터 잠금 중 G → 숫자 1~6 / 커서가 보일 때 💬 단추 → 클릭. Esc·G 로 닫는다(설계 5절).
// 숫자 1~6(위 줄 · 키패드)은 인사창 없이 바로 인사한다(미르 11/6 키패드 · 11/8 위 줄도 — 본편은 숫자키를 안 쓴다).
// 1인칭에서는 내 말풍선이 눈 위라 안 보이므로 화면 아래에 띄운다. 쿨다운(3초) 중이면 짧게 알린다.
// 컷신·본편 화면창·자물쇠 확대 중에는 인사창을 열지 않고, 열려 있으면 닫는다(설계 5절).
// 모양은 동작 확인용이다 — 최종 톤은 3단계에서 해랑 님 화면에 맞춘다.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { useTouchMode } from "@/engine/input";
import { playerView } from "@/engine/playerView";
import { isTypingTarget, useOpenLayer } from "@/game/overlayLayer";
import { useLockControl } from "@/props/combinationLockState";
import { useIsCutscenePlaying } from "@/props/vendingPushState";
import { useDispatchState } from "@/tutorial/dispatchState";

import ChatBox from "./ChatBox";
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

/**
 * 로비에 처음 붙으면 여기서 할 수 있는 것을 몇 초 알려 준다 — 미르 플레이 시험 메모(11/8): 「로비입장후 채팅이 가능하다는 것을
 * 알게 하는 ui가 없다 또 1-6까지 제스처 사용이 가능하다는 것을 알리는 ui도 없다」(튜토피드백 검토 01회차). 컷신 · 창 · 자물쇠가
 * 끝나 실제로 볼 수 있을 때부터 세고, 이 탭에서 한 번만.
 */
const INTRO_MS = 9000;
let introShown = false;
// 위 가운데는 튜토리얼 안내판 · 출동 호출 카드 자리라 아래 가운데에 — 행동 안내(40) · 짧은 안내(104) · 1인칭 말풍선(96) 위
const introCard: CSSProperties = {
  position: "absolute",
  bottom: 168,
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(440px, calc(100% - 32px))",
  boxSizing: "border-box",
  padding: "12px 16px",
  borderRadius: 14,
  background: "rgba(10,20,40,0.9)",
  border: "1px solid #86a6f0",
  color: "#f1f1fc",
  font: "14px/1.5 system-ui, sans-serif",
  textAlign: "center",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
};
const introKey: CSSProperties = {
  display: "inline-block",
  minWidth: 22,
  padding: "1px 7px",
  margin: "0 3px",
  borderRadius: 6,
  border: "1px solid #86a6f0",
  font: "600 12px/1.6 system-ui, sans-serif",
};

/** 배포 빌드 상태 줄의 기본 자리(오른쪽 위 단추 아래) */
const STATUS_TOP = 60;
const STATUS_EDGE = 16;
const STATUS_GAP = 8;

/**
 * 배포 빌드 상태 줄 위치. 가운데 위 판(출동 목표 띠 · 튜토리얼 안내판 — role="status")이 이 자리까지 옆으로 뻗어 있으면 그 아래로 내린다.
 * 좁은 PC 창(800 · 1024)에서 출동 목표 띠 오른쪽 끝(「· 기차 문까지 7m」)을 이 줄이 덮었다(미르 11/10 기기 전수). 음악 알약(MusicPanel)과 같은 방식 —
 * 실제 상자를 잰다. 대화창(긴급 호출 카드 · alertdialog)은 이 줄 위에 덮이므로 비키지 않는다. 음악 알약은 role="group" 이라 서로 밀지 않는다
 */
function useStatusTop(pill: RefObject<HTMLDivElement | null>, active: boolean) {
  const [top, setTop] = useState(STATUS_TOP);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => {
      const self = pill.current;
      if (!self) return;
      const { width, height } = self.getBoundingClientRect();
      const left = window.innerWidth - STATUS_EDGE - width;
      let next = STATUS_TOP;
      for (const element of document.querySelectorAll<HTMLElement>('[role="status"]')) {
        if (element === self || element.closest('[role="alertdialog"]')) continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.top >= STATUS_TOP + height || box.right + STATUS_GAP <= left) continue;
        next = Math.max(next, Math.ceil(box.bottom) + STATUS_GAP);
      }
      setTop(next);
    };
    update();
    const timer = setInterval(update, 300);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", update);
    };
  }, [pill, active]);
  return top;
}

export default function LobbyPreviewHud() {
  const { status, me, loggedIn } = usePreviewState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const cutscene = useIsCutscenePlaying();
  const isTouch = useTouchMode();
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
  // 처음 로비에 붙어 화면을 볼 수 있게 된 순간 안내 카드(INTRO_MS)
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    if (introShown || !canGreet) return;
    introShown = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 붙은 순간 한 번만 연다
    setIntroOpen(true);
  }, [canGreet]);
  useEffect(() => {
    if (!introOpen) return;
    const timer = setTimeout(() => setIntroOpen(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, [introOpen]);
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
      // 서버가 둔 팀 캐릭터(NPC)는 사람 수에서 뺀다
      let people = 0;
      connection.players().forEach((player) => {
        if (!player.npc) people += 1;
      });
      setRoomSize(people);
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

  // G 로 열고 닫기, 숫자 1~6(위 줄 · 키패드)은 바로 인사, Esc 로 닫기. 입력칸에 쓰는 중이면 무시.
  // 위 줄 숫자도 바로 — 키패드 없는 노트북이 많다(미르 플레이 시험 11/8). 본편은 숫자키를 쓰지 않는다
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
      const number = /^(?:Numpad|Digit)([1-6])$/.exec(event.code);
      const id = number ? Number(number[1]) : null;
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
          ? `로비 연결됨 · 같은 방 ${roomSize}명 · 숫자 1~6: 바로 인사 · G: 인사 고르기 · Enter: 채팅`
          : `혼자 둘러보는 중(${REASON_TEXT[status.reason] ?? status.reason})${
              status.nextRetryAt ? " · 재시도 예약됨" : " · 이번 방문 재시도 없음"
            }`;

  const prodStatus =
    status.kind === "connected"
      ? isTouch
        ? `같은 방 ${roomSize}명 · 💬 인사`
        : `같은 방 ${roomSize}명 · Enter 채팅 · 1~6 인사 · G 인사 고르기`
      : status.kind === "solo"
        ? status.reason === "LOGIN_REQUIRED"
          ? "혼자 둘러보는 중 · 로그인하면 다른 조사관과 만나요"
          : `혼자 둘러보는 중(${REASON_TEXT[status.reason] ?? status.reason})`
        : status.kind === "connecting"
          ? "로비에 붙는 중…"
          : null;
  const statusRef = useRef<HTMLDivElement>(null);
  const statusTop = useStatusTop(statusRef, !import.meta.env.DEV && prodStatus !== null);

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
      {introOpen && canGreet && (
        <div role="status" aria-live="polite" style={introCard}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>로비에 들어왔어요 — 다른 조사관과 함께예요</div>
          {isTouch ? (
            <div>오른쪽 아래 💬 단추로 인사(제스처)를 할 수 있어요</div>
          ) : (
            <div>
              <span style={introKey}>Enter</span> 채팅 · <span style={introKey}>1</span>~<span style={introKey}>6</span>{" "}
              인사(제스처) · <span style={introKey}>G</span> 인사 고르기
            </div>
          )}
        </div>
      )}
      {/* 배포 빌드(베타, 11/8) — 개발 패널(본부실로 이동 · 개발 로그인) 없이 상태 한 줄만 오른쪽 위에.
          한 줄로 둔다 — 폭을 260 으로 묶었더니 「…만나요」의 끝 글자만 다음 줄로 넘어갔다(미르 11/10). 화면보다 길 때만 말줄임.
          role="status" — 음악 알약이 이 줄 아래로 자리를 잡는다(MusicPanel readChipTop). 가운데 위 판에 걸리면 그 아래로(useStatusTop) */}
      {!import.meta.env.DEV && prodStatus && (
        <div
          ref={statusRef}
          role="status"
          style={{
            ...panel,
            position: "absolute",
            top: statusTop,
            right: STATUS_EDGE,
            padding: "4px 10px",
            fontSize: 12,
            whiteSpace: "nowrap",
            maxWidth: "calc(100vw - 32px)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {prodStatus}
        </div>
      )}
      {import.meta.env.DEV && (
        <>
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
                <input
                  placeholder="이메일"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
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
        </>
      )}
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
                if (!greet(index + 1)) setNotice("인사는 3초에 한 번 할 수 있어요");
                setPickerOpen(false);
              }}
            >
              {index + 1}. {text}
            </button>
          ))}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>숫자 1~6 은 창 없이도 바로 · Esc·G 닫기</div>
        </div>
      )}
    </div>
  );
}
