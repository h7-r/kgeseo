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

/** 미니 위치 — 오른쪽 위 알약 단추 · 「혼자 둘러보는 중」 아래. 안내판과 겹칠 만큼 좁으면 안내판 아래로 */
function miniTop(viewportWidth: number) {
  const left = viewportWidth - DOCK_EDGE - MINI_SIZE.width;
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
    : { ...panel, position: "fixed", right: DOCK_EDGE, top: miniTop(viewport.width), padding: 8, gap: 6 };

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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, color: UI.textMuted, fontSize: 12 }}>
              {music.playing ? "♪ 재생 중" : music.blocked ? "▶ 를 눌러 주세요" : "본부실 스피커"}
            </span>
            <PanelButton onClick={expandMusic}>크게 보기</PanelButton>
            <PanelButton onClick={() => closeMusic("user")} danger title="다음 방문부터는 자동으로 틀지 않아요">
              정지하고 닫기
            </PanelButton>
          </div>
        )}
        {/* 플레이어 자리 — 큰 화면 · 미니가 같은 칸. 위에 아무것도 겹치지 않는다 */}
        <div key="player" ref={attachHost} style={{ width: size.width, height: size.height, background: "#000" }} />
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
      </div>
    </>
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
