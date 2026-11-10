/**
 * [H] 로 여는 힌트함. 치수·색은 소지품 창과 같다 — 생김새가 다르면 다른 게임 화면으로 읽힌다.
 * 힌트는 그림 한 장 + 한 줄 설명이라 왼쪽에서 고르면 오른쪽에 크게 펴 준다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useTouchMode } from "@/engine/input";
import { restoreHintPaper, VALVE_HINT } from "@/props/hintPaperState";

import { NoteIcon } from "./gameIcons";
import GamePanel from "./GamePanel";
import { UI, UI_FONT, keyCapStyle } from "./gameUi";
import { isHintUnseen, markHintSeen, removeHint, useHintBox } from "./hintBox";
import { isTypingTarget } from "./overlayLayer";
import { takeExtraHint, useExtraHintAvailable } from "./valveHelp";
import {
  categoryStyle,
  descriptionStyle,
  detailColumnStyle,
  detailImageStyle,
  detailNameStyle,
  emptyStyle,
  gridStyle,
  listColumnStyle,
  sectionCountStyle,
  sectionTitleStyle,
  slotImageStyle,
  slotLetterStyle,
  slotNameStyle,
  slotStyle,
} from "./panelStyles";

interface HintPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function HintPanel({ open, onClose }: HintPanelProps) {
  const hints = useHintBox();
  // 열 때는 맨 마지막에 넣은 것을 펴 준다(방금 주운 걸 보려고 여는 일이 많다).
  // 닫을 때는 고른 것을 지운다 — 다음에 열었을 때 엉뚱한 게 펼쳐져 있으면 헷갈린다.
  const latestId = () => (hints.length ? hints[hints.length - 1].id : null);
  const [selectedId, setSelectedId] = useState<string | null>(() => (open ? latestId() : null));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setSelectedId(open ? latestId() : null);
  }

  // 펼쳐 보인 쪽지만 「본 것」 — 창을 연 것만으로 다 지우면 창이 열린 채 들어온 쪽지 · 여러 장 쌓인 쪽지를 안 읽고 넘긴다(09회차 Codex)
  useEffect(() => {
    if (open && selectedId) markHintSeen(selectedId);
  }, [open, selectedId]);

  const isTouch = useTouchMode();
  // 추가 힌트를 「아니요」로 미뤘어도 여기서 언제든 받는다(12회차) — 받으면 그 쪽지를 펴 준다
  const isExtraHintAvailable = useExtraHintAvailable();
  const takeExtra = () => {
    if (takeExtraHint()) setSelectedId(hints.length ? hints[hints.length - 1].id : null);
  };
  // 「정답 보기」를 누른 쪽지 — 한 번 본 정답은 이 탭에서는 계속 보인다
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());

  // 골라 둔 힌트를 버린다 — 지우지 않고 실물 쪽지를 바닥에 도로 내놓는다(잘못 누른 사람이 걸어가 주우면 된다).
  // 실물이 없는 쪽지(튜토리얼 첫 쪽지 등)는 떨어뜨릴 종이가 없어 버리지 않는다. 버린 자리는 옆 것을 이어서 펴 준다.
  const discardSelected = () => {
    if (!selectedId) return;
    const selected = hints.find((hint) => hint.id === selectedId);
    if (selected?.isPhysical === false) return;
    const remaining = hints.filter((hint) => hint.id !== selectedId);
    if (removeHint(selectedId) && selectedId === VALVE_HINT.id) restoreHintPaper();
    setSelectedId(remaining.length ? remaining[remaining.length - 1].id : null);
  };
  const discardRef = useRef(discardSelected);
  useLayoutEffect(() => {
    discardRef.current = discardSelected;
  });

  // [E] — 창이 열리면 마우스 잠금이 풀려 App 의 E 까지 가지 않으므로 창이 직접 듣는다. 휴대폰은 아래 단추로 버린다(14회차)
  useEffect(() => {
    if (!open || !selectedId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      discardRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, selectedId]);

  if (!open) return null;
  const selected = selectedId ? hints.find((hint) => hint.id === selectedId) : null;

  return (
    <GamePanel title="힌트함" meta={`모은 것 ${hints.length}`} closeKey="H" onClose={onClose}>
      <div className="game-panel-scroll" style={listColumnStyle}>
        {isExtraHintAvailable && (
          <div style={extraHintStyle} data-hud="추가 힌트 받기">
            <span>받을 수 있는 추가 힌트가 있다</span>
            <button type="button" style={extraHintButtonStyle} onClick={takeExtra}>
              받기
            </button>
          </div>
        )}
        <div style={sectionTitleStyle}>
          모은 힌트 <span style={sectionCountStyle}>{hints.length}</span>
        </div>
        {hints.length ? (
          <div style={gridStyle}>
            {hints.map((hint) => (
              <button
                type="button"
                key={hint.id}
                className="game-slot"
                aria-pressed={selectedId === hint.id}
                style={slotFrameStyle}
                onClick={() => setSelectedId(hint.id)}
                title={isHintUnseen(hint.id) ? `${hint.name} — 새 쪽지` : hint.name}
              >
                {hint.image ? (
                  <img src={hint.image} alt="" style={slotImageStyle} />
                ) : (
                  <span style={slotLetterStyle}>{hint.name?.[0] ?? "?"}</span>
                )}
                <span style={slotNameStyle}>{hint.name}</span>
                {/* 맨 뒤에 둔다 — 터치 창 CSS 가 칸의 첫 자식(썸네일)을 36px 로 키운다(gameUi.css, Codex 리뷰 6a1acdd) */}
                {isHintUnseen(hint.id) && <span aria-hidden style={unseenDotStyle} />}
              </button>
            ))}
          </div>
        ) : (
          <div style={emptyStyle}>
            <span style={{ color: UI.accent }}>
              <NoteIcon size={30} />
            </span>
            <span>
              아직 모은 힌트가 없다.
              <br />
              {isTouch ? (
                "쪽지를 집어 든 채 위 💡 단추를 누르면 여기 적힌다."
              ) : (
                <>
                  쪽지를 집어 든 채 <kbd style={inlineKeyStyle}>H</kbd> 를 누르면 여기 적힌다.
                </>
              )}
            </span>
          </div>
        )}
      </div>

      <aside className="game-panel-scroll" style={detailColumnStyle}>
        {selected ? (
          <>
            <div style={categoryStyle}>힌트</div>
            <h3 style={detailNameStyle}>{selected.name}</h3>
            {selected.image && <img src={selected.image} alt="" style={detailImageStyle} />}
            <p style={descriptionStyle}>{selected.description ?? "아직 적힌 것이 없다."}</p>
            {selected.spoiler &&
              (revealed.has(selected.id) ? (
                <p role="status" style={spoilerStyle}>
                  정답: {selected.spoiler}
                </p>
              ) : (
                <button
                  type="button"
                  style={discardButtonStyle}
                  onClick={() => setRevealed((current) => new Set(current).add(selected.id))}
                >
                  정답 보기
                </button>
              ))}
            {selected.isPhysical === false ? (
              <div style={discardStyle}>힌트함에 늘 남아 있는 쪽지</div>
            ) : isTouch ? (
              <div style={discardStyle}>
                <button type="button" style={discardButtonStyle} onClick={discardSelected}>
                  쪽지 버리기
                </button>
                <div style={{ marginTop: 6 }}>쪽지가 바닥에 떨어진다 — 다시 주울 수 있다</div>
              </div>
            ) : (
              <div style={discardStyle}>
                <kbd style={inlineKeyStyle}>E</kbd> 버리기 — 쪽지가 바닥에 떨어진다
              </div>
            )}
          </>
        ) : (
          <div style={emptyStyle}>
            {hints.length ? "왼쪽에서 하나를 고르면 여기에 펼쳐진다." : "막히는 자리마다 쪽지가 하나씩 있다."}
          </div>
        )}
      </aside>
    </GamePanel>
  );
}

const discardButtonStyle: CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 22,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: `600 14px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};
const spoilerStyle: CSSProperties = {
  margin: "4px 0 0",
  color: UI.accent,
  font: `700 22px/1.3 ${UI_FONT.body}`,
  letterSpacing: "0.12em",
};
const inlineKeyStyle: CSSProperties = { ...keyCapStyle, minWidth: 22, height: 22, padding: "0 6px", margin: "0 2px" };
// 칸 모서리의 「새 쪽지」 점 — 왼쪽 위 힌트 칩의 점과 같은 색 · 크기
const slotFrameStyle: CSSProperties = { ...slotStyle, position: "relative" };
const unseenDotStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 9,
  height: 9,
  borderRadius: "50%",
  background: UI.accent,
  boxShadow: `0 0 0 2px ${UI.surfaceRaised}`,
};
const discardStyle: CSSProperties = {
  marginTop: 18,
  paddingTop: 14,
  borderTop: `1px solid ${UI.border}`,
  color: UI.textMuted,
  font: `400 14px/1.6 ${UI_FONT.body}`,
};
const extraHintStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 12,
  padding: "8px 8px 8px 12px",
  borderRadius: 12,
  border: `1px solid ${UI.accent}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: `500 14px/1.4 ${UI_FONT.body}`,
};
const extraHintButtonStyle: CSSProperties = {
  flex: "none",
  minHeight: 44,
  minWidth: 72,
  padding: "0 16px",
  borderRadius: 22,
  border: `1px solid ${UI.accent}`,
  background: UI.navy,
  color: UI.text,
  font: `600 14px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};
