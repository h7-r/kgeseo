// 로비 스피커 음악 화면(Canvas 밖) — 큰 화면 · 미니 플레이어 · 스피커 겨냥 안내. 검토 17회차.
// 플레이어 자리(빈 상자)는 큰 화면과 미니에서 같은 DOM 칸을 쓴다 — 바꿔 그리면 iframe 이 새로 떠서 곡이 처음부터 나온다.
// 규정: 플레이어 위에 아무것도 올리지 않는다(단추는 플레이어 바깥, z 순서는 HUD 보다 위), 크기는 16:9 · 높이 200 이상.
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { playerView } from "@/engine/playerView";
import { DOCK_EDGE, DOCK_TOP, PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";
import { aimStore } from "@/lobby/interactions";

import {
  attachHost,
  canMini,
  closeMusic,
  expandMusic,
  JUKEBOX_WIDTH,
  MINI_SIZE,
  minimizeMusic,
  PLAYLIST_URL,
  SPEAKER_AIM_ID,
  useMusic,
} from "./musicState";

/** 로비 HUD(30) · 말풍선보다 위 */
const Z_INDEX = 70;
/** 가운데 위 조작 안내판(폭 600) — 이보다 좁은 화면에선 미니를 그 아래로 내린다 */
const GUIDE_HALF_WIDTH = 300;
const GUIDE_BOTTOM = 196;
/** 큰 화면의 머리 · 단추 줄 · 여백 높이 */
const BIG_CHROME = 140;

function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** 큰 화면 플레이어 크기 — 권장 480×270 이상, 화면의 82%, 머리 · 단추 줄까지 세로에 들어가게 */
function bigPlayerSize(width: number, height: number) {
  const fit = Math.min(960, width * 0.82, ((height * 0.92 - BIG_CHROME) * 16) / 9);
  const playerWidth = Math.round(Math.max(356, Math.min(fit, width - 24)));
  return { width: playerWidth, height: Math.round((playerWidth * 9) / 16) };
}

/** 미니(주크박스) 위치 — 오른쪽 위 알약 단추 · 「혼자 둘러보는 중」 아래. 안내판과 겹칠 만큼 좁으면 안내판 아래로 */
function miniTop(viewportWidth: number) {
  const left = viewportWidth - DOCK_EDGE - JUKEBOX_WIDTH;
  return left > viewportWidth / 2 + GUIDE_HALF_WIDTH + 12 ? DOCK_TOP + 26 : GUIDE_BOTTOM + 8;
}

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

export default function MusicPanel() {
  const music = useMusic();
  const viewport = useViewport();
  const { mode } = music;

  // 큰 화면이 떠 있는 동안: Esc = 작게(못 하면 닫기), 다른 키는 게임에 넘기지 않는다(뒤에서 캐릭터가 걷지 않게).
  // 떼기(keyup)는 막지 않는다 — 누른 채 연 키가 계속 눌린 것으로 남는다.
  useEffect(() => {
    if (mode !== "big") return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.code !== "Escape") return;
      event.preventDefault();
      minimizeMusic();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode]);

  if (mode === "closed") return <SpeakerHint />;

  const isBig = mode === "big";
  const size = isBig ? bigPlayerSize(viewport.width, viewport.height) : MINI_SIZE;
  const container: CSSProperties = isBig
    ? {
        ...panel,
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        padding: "14px 16px 16px",
        gap: 12,
      }
    : { ...jukebox, top: miniTop(viewport.width) };

  return (
    <>
      {isBig && <div style={backdrop} onMouseDown={stop} onPointerDown={stop} onClick={stop} />}
      <div style={container} onMouseDown={stop} onPointerDown={stop} onClick={stop} onWheel={stop}>
        {isBig && (
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ font: `700 17px/1.2 ${UI_FONT.title}` }}>본부실 스피커</div>
              <div style={{ color: UI.textSubtle, fontSize: 12, marginTop: 3 }}>
                미르 플레이리스트 · 나에게만 들려요 · 볼륨은 플레이어에서
              </div>
            </div>
            <a href={PLAYLIST_URL} target="_blank" rel="noopener noreferrer" style={link}>
              YouTube에서 열기 ↗
            </a>
          </div>
        )}
        {!isBig && (
          // 주크박스 머리 — 네온 제목 · 이퀄라이저(재생 중에만 춤춘다). 막히면 ▶ 안내
          <div style={{ height: 52, display: "grid", placeItems: "center", alignContent: "center", gap: 6 }}>
            <style>{JUKEBOX_CSS}</style>
            <div style={neonTitle}>♪ 본부실 라디오 ♪</div>
            {music.blocked || music.error ? (
              <div style={{ color: music.error ? "#fecaca" : "#fde68a", fontSize: 11 }}>
                {music.error ? "재생 오류 — 크게 보기" : "▶ 를 눌러 주세요"}
              </div>
            ) : (
              <div className={`lobby-jukebox-eq${music.playing ? "" : " is-paused"}`} aria-hidden>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        )}
        {/* 플레이어 자리 — 큰 화면 · 미니가 같은 칸. 위에 아무것도 겹치지 않는다(테두리는 칸 바깥에 그려진다) */}
        <div
          key="player"
          ref={attachHost}
          style={{
            width: size.width,
            height: size.height,
            background: "#000",
            // 게임 전역이 border-box 라 테두리가 플레이어 안쪽을 깎는다(194×194 — 규정 200 미만). 칸은 늘 이 크기 그대로
            boxSizing: "content-box",
            border: isBig ? "none" : "3px solid #3a3346",
          }}
        />
        {isBig && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 160, color: music.error ? UI.danger : UI.textMuted, fontSize: 12 }}>
              {music.error
                ? `${music.error} — 위 「YouTube에서 열기」로 들을 수 있어요`
                : music.blocked
                  ? "브라우저가 자동 재생을 막았어요 — 플레이어의 ▶ 를 눌러 주세요"
                  : canMini()
                    ? "Esc · 「작게 보기」로 걸으면서 계속 들어요"
                    : "이 화면에선 작게 띄울 수 없어 닫으면 멈춰요"}
            </span>
            {canMini() && <PanelButton onClick={minimizeMusic}>작게 보기 · 계속 듣기</PanelButton>}
            <PanelButton onClick={() => closeMusic("user")} danger title="다음 방문부터는 자동으로 틀지 않아요">
              정지하고 닫기
            </PanelButton>
          </div>
        )}
        {!isBig && (
          // 주크박스 아래 — 크게 보기 · 스피커 망 · 정지
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, width: "100%" }}>
            <IconButton label="크게 보기" onClick={expandMusic}>
              ⤢
            </IconButton>
            <div style={grille} aria-hidden />
            <IconButton
              label="정지하고 닫기 — 다음 방문부터는 자동으로 틀지 않아요"
              onClick={() => closeMusic("user")}
              danger
            >
              ■
            </IconButton>
          </div>
        )}
      </div>
    </>
  );
}

function IconButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: 999,
        border: `1px solid ${danger ? "rgba(248,113,113,.7)" : "#f2b05e"}`,
        background: danger ? "rgba(248,113,113,.14)" : "rgba(242,176,94,.12)",
        color: danger ? "#fecaca" : "#ffe8b0",
        font: "700 14px/1 system-ui, sans-serif",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

/** 스피커를 겨냥했을 때 아래 안내(게임 ActionHint 와 같은 자리 · 모양). 기차 안내판처럼 특별한 물건만 글로 적는다 */
function SpeakerHint() {
  const aimed = useSyncExternalStore(aimStore.subscribe, aimStore.get) === SPEAKER_AIM_ID;
  const music = useMusic();
  if (music.relockFailed) return <div style={hint}>[T] 를 눌러 조작으로 돌아가요</div>;
  if (!aimed) return null;
  return <div style={hint}>{playerView.isThirdPerson ? "[E] 음악 틀기" : "[E] 또는 클릭 — 음악 틀기"}</div>;
}

function PanelButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: "7px 12px",
        borderRadius: 999,
        border: `1px solid ${danger ? "rgba(248,113,113,.55)" : UI.borderStrong}`,
        background: danger ? "rgba(248,113,113,.12)" : UI.surfaceRaised,
        color: danger ? "#fecaca" : UI.text,
        font: `600 12px/1 ${UI_FONT.body}`,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

const panel: CSSProperties = {
  zIndex: Z_INDEX,
  display: "flex",
  flexDirection: "column",
  background: UI.glass,
  color: UI.text,
  border: `1px solid ${UI.borderStrong}`,
  borderRadius: 16,
  boxShadow: PANEL_SHADOW,
  font: `500 13px/1.35 ${UI_FONT.body}`,
  pointerEvents: "auto",
};
/** 주크박스 틀 — 아치 머리 · 네온 테두리 · 짙은 몸통. 플레이어(200×200 + 테두리 3)를 가운데 두고 둘레만 꾸민다 */
const jukebox: CSSProperties = {
  position: "fixed",
  right: DOCK_EDGE,
  zIndex: Z_INDEX,
  width: JUKEBOX_WIDTH,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0 7px 9px",
  borderRadius: "60px 60px 18px 18px",
  border: "2px solid #f2b05e",
  background: "linear-gradient(180deg, #3a1d46 0%, #1a1730 34%, #0b0f1c 100%)",
  boxShadow: "0 0 0 3px rgba(236,72,153,.4), 0 0 22px rgba(245,158,11,.32), 0 18px 48px rgba(1,4,10,.62)",
  color: UI.text,
  font: `600 12px/1 ${UI_FONT.body}`,
  pointerEvents: "auto",
};
const neonTitle: CSSProperties = {
  font: `700 12px/1 ${UI_FONT.title}`,
  letterSpacing: 0.5,
  color: "#ffe8b0",
  textShadow: "0 0 6px rgba(255,170,80,.9), 0 0 12px rgba(236,72,153,.6)",
  whiteSpace: "nowrap",
};
const grille: CSSProperties = {
  flex: 1,
  height: 22,
  borderRadius: 6,
  background: "repeating-linear-gradient(180deg, #2b2638 0 2px, #12101c 2px 5px)",
  boxShadow: "inset 0 0 0 1px rgba(242,176,94,.35)",
};
/** 이퀄라이저 막대 — 재생 중에만 춤추고(멈추면 그 자리에서 쉼), 움직임 줄이기 설정이면 가만히 */
const JUKEBOX_CSS = `
.lobby-jukebox-eq { display: flex; align-items: flex-end; gap: 3px; height: 14px; }
.lobby-jukebox-eq span { width: 4px; height: 14px; border-radius: 2px; transform-origin: bottom;
  background: linear-gradient(180deg, #fde68a, #f472b6); animation: lobby-jukebox-eq .9s ease-in-out infinite; }
.lobby-jukebox-eq span:nth-child(2) { animation-delay: -.45s; }
.lobby-jukebox-eq span:nth-child(3) { animation-delay: -.2s; }
.lobby-jukebox-eq span:nth-child(4) { animation-delay: -.65s; }
.lobby-jukebox-eq span:nth-child(5) { animation-delay: -.1s; }
.lobby-jukebox-eq span:nth-child(6) { animation-delay: -.55s; }
.lobby-jukebox-eq span:nth-child(7) { animation-delay: -.3s; }
.lobby-jukebox-eq.is-paused span { animation-play-state: paused; opacity: .55; }
@keyframes lobby-jukebox-eq { 0%, 100% { transform: scaleY(.25); } 50% { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .lobby-jukebox-eq span { animation: none; transform: scaleY(.6); } }
`;
const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: Z_INDEX - 1,
  background: "rgba(1,4,10,.45)",
};
const link: CSSProperties = { color: UI.accent, fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" };
const hint: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 40,
  transform: "translateX(-50%)",
  zIndex: Z_INDEX,
  color: UI.text,
  font: `500 14px/1 ${UI_FONT.body}`,
  background: UI.glass,
  border: `1px solid ${UI.borderStrong}`,
  boxShadow: PANEL_SHADOW,
  padding: "13px 20px",
  borderRadius: 22,
  whiteSpace: "pre",
  pointerEvents: "none",
};
