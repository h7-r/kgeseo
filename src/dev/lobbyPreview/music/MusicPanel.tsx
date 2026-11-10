// 로비 스피커 음악 화면(Canvas 밖) — 지금 곡 알약 · 스피커 겨냥 안내. 검토 17 · 20 · 21회차.
// 모양은 게임 HUD(gameUi 남색 유리)를 따른다 — 주크박스 네온 틀이 다른 창 · 게임 공간과 톤이 달랐다(미르 11/7, 20회차).
// 음원을 직접 트니(21회차) 유튜브 플레이어 · 크게 보기 창이 없다. 글자는 「제목 · 가수」만(미르 11/7), 조작은 아이콘 둘.
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { playerView } from "@/engine/playerView";
import { DOCK_EDGE, DOCK_TOP, PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";
import { aimStore } from "@/lobby/interactions";

import { nextTrack, SPEAKER_AIM_ID, stopMusic, useMusic, type MusicState } from "./musicState";

/** 로비 HUD(30) · 말풍선보다 위 */
const Z_INDEX = 70;
/** 알약 최대 폭 — 긴 제목은 말줄임 */
const MUSIC_CHIP_MAX_WIDTH = 260;
/** 알약 기본 자리 — 오른쪽 위 알약 단추 · 「혼자 둘러보는 중」 아래 */
const CHIP_TOP = DOCK_TOP + 26;
const GAP = 8;
/** 알약 높이(어림) — 알약 자리(top ~ top + 높이)에 걸치는 판을 찾을 때 */
const CHIP_HEIGHT = 34;

/**
 * 알약 위치. 가운데 위 조작 안내판(TutorialPanel) · 출동 목표 띠 · 로비 상태 줄(모두 role="status")이 알약 자리까지 옆으로 뻗어 있으면 그 아래로 내린다.
 * 안내판 높이는 단계 · 화면 폭(폰에선 글이 줄바꿈돼 길어진다)마다 달라 고정값이 아니라 실제 상자를 잰다 — 접으면 올라간다.
 * 위에서부터 차례로 본다 — 로비 상태 줄도 목표 띠를 비켜 내려가므로, 처음 자리보다 아래로 내려간 판도 알약 자리에 걸치면 비킨다(Codex 리뷰 11/10).
 * 알약 폭은 곡마다 달라 최대 폭으로 견준다(곡이 바뀔 때 자리가 튀지 않게)
 */
function readChipTop() {
  const chipLeft = window.innerWidth - DOCK_EDGE - MUSIC_CHIP_MAX_WIDTH;
  const boxes = [...document.querySelectorAll<HTMLElement>('[role="status"]')]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.right + GAP * 1.5 > chipLeft)
    .sort((a, b) => a.top - b.top);
  let top = CHIP_TOP;
  for (const box of boxes) if (box.top < top + CHIP_HEIGHT) top = Math.max(top, Math.ceil(box.bottom) + GAP);
  return top;
}

function useChipTop(active: boolean) {
  const [top, setTop] = useState(CHIP_TOP);
  useEffect(() => {
    if (!active) return;
    // 안내판은 단계가 넘어가거나 F1 로 접힐 때 상자가 바뀐다 — 가볍게 자주 잰다(바뀔 때만 다시 그린다)
    const update = () => setTop(readChipTop());
    update();
    const timer = setInterval(update, 300);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return top;
}

const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

export default function MusicPanel() {
  const music = useMusic();
  const top = useChipTop(music.on);
  return (
    <>
      <SpeakerHint on={music.on} />
      {music.on && (
        <div
          role="group"
          aria-label="본부실 스피커"
          style={{ ...chip, top }}
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={stop}
          onWheel={stop}
        >
          <span
            aria-hidden
            style={{ color: music.playing ? UI.accent : UI.textSubtle, font: "700 14px/1 system-ui, sans-serif" }}
          >
            ♪
          </span>
          <NowPlaying music={music} />
          <IconButton label="다음 곡" onClick={nextTrack}>
            ⏭
          </IconButton>
          <IconButton label="음악 끄기 — 다음 방문부터는 자동으로 틀지 않아요" onClick={() => stopMusic("user")} danger>
            ■
          </IconButton>
        </div>
      )}
    </>
  );
}

/** 제목 · 가수(가수는 흐리게). 막히거나 실패하면 그 자리에 안내 */
function NowPlaying({ music }: { music: MusicState }) {
  if (music.error) return <span style={{ ...label, color: UI.danger }}>{music.error}</span>;
  if (music.blocked) return <span style={{ ...label, color: "#fde68a" }}>▶ 눌러서 재생</span>;
  const track = music.track;
  if (!track) return <span style={label} />;
  return (
    <span style={label} title={`${track.title} · ${track.artist}`}>
      {track.title}
      <span style={{ color: UI.textSubtle, fontWeight: 500 }}> · {track.artist}</span>
    </span>
  );
}

function IconButton({
  children,
  label: name,
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
      aria-label={name}
      title={name}
      onClick={onClick}
      style={{
        // 게임 HUD 키 표시(keyCapStyle)와 같은 상자 — 26 · 모서리 6 · 남색
        width: 26,
        height: 26,
        flex: "none",
        display: "grid",
        placeItems: "center",
        boxSizing: "border-box",
        borderRadius: 6,
        border: `1px solid ${danger ? "rgba(248,113,113,.55)" : UI.borderStrong}`,
        background: danger ? "rgba(248,113,113,.12)" : UI.surfaceHover,
        color: danger ? "#fecaca" : UI.text,
        font: "700 12px/1 system-ui, sans-serif",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

/** 스피커를 겨냥했을 때 아래 안내(게임 ActionHint 와 같은 자리 · 모양). 기차 안내판처럼 특별한 물건만 글로 적는다 */
function SpeakerHint({ on }: { on: boolean }) {
  const aimed = useSyncExternalStore(aimStore.subscribe, aimStore.get) === SPEAKER_AIM_ID;
  if (!aimed) return null;
  const action = on ? "음악 끄기" : "음악 틀기";
  return <div style={hint}>{playerView.isThirdPerson ? `[E] ${action}` : `[E] 또는 클릭 — ${action}`}</div>;
}

/** 지금 곡 알약 — 위 알약 단추들(설정 · 1인칭)과 같은 남색 유리 · 둥근 끝 */
const chip: CSSProperties = {
  position: "fixed",
  right: DOCK_EDGE,
  zIndex: Z_INDEX,
  maxWidth: MUSIC_CHIP_MAX_WIDTH,
  height: 34,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 4px 0 12px",
  borderRadius: 17,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  pointerEvents: "auto",
};
const label: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  font: `600 12px/1.2 ${UI_FONT.body}`,
  marginRight: 2,
};
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
