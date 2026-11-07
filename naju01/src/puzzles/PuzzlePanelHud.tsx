import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { addPointerActiveListener, isPointerActive, useKeyLabels, useTouchMode } from "@/engine/input";

import { AMBER, CREAM, HUD_FONT as FONT } from "./hudTheme";
import { usePuzzlePanel } from "./puzzlePanel";

/** 퍼즐 안내판 — 화면 오른쪽 가운데. 퍼즐이 올린 제목 · 규칙 · 상태 줄 · 그림을 그대로 보여 준다. Canvas 밖 DOM 층 */
export default function PuzzlePanelHud() {
  const panel = usePuzzlePanel();
  const isTouch = useTouchMode();
  if (!panel) return null;
  if (isTouch) {
    // 퍼즐이 바뀌면(제목) 접힘 상태를 새로 — 같은 퍼즐의 개수 갱신으로는 바뀌지 않는다
    return (
      <TouchPuzzlePanel
        key={panel.title}
        title={panel.title}
        rule={panel.rule}
        rows={panel.rows}
        diagram={panel.diagram}
      />
    );
  }
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{panel.title}</div>
      <div style={ruleStyle}>{panel.rule}</div>
      {panel.diagram && <div style={diagramStyle}>{panel.diagram}</div>}
      {panel.rows && panel.rows.length > 0 && (
        <div style={rowsStyle}>
          {panel.rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span style={labelStyle}>{row.label}</span>
              <span style={{ ...valueStyle, color: row.ok ? AMBER : CREAM }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TouchPuzzlePanelProps {
  title: string;
  rule: string;
  rows?: { label: string; value: string; ok?: boolean }[];
  diagram?: ReactNode;
}

/**
 * 터치 — 좌상단(미르 폰 시험 「우상단은 가시성이 너무 나쁘다」 11/7). 목표 · 단서 추적창을 좌상단에 모으는 모바일 게임 관행
 * (원신 모바일 목표 표시) 참고, 코덱스 구현 07회차.
 * 기본은 제목 + 진행 줄(개수)만, 탭하면 규칙 · 그림을 펼친다. 글 14px · 배경 0.92 — 3D 장면 위에서도 읽히게.
 * 조작 화면(z 900)보다 위라 이 판을 누른 손가락은 시점 드래그로 새지 않는다.
 */
function TouchPuzzlePanel({ title, rule: rawRule, rows, diagram }: TouchPuzzlePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  // 조작 중엔 터치 조작면(이동 · 시점) 위에서 눌려야 해 층이 높다. 소지품 · 힌트함 · 설정 창이 열리면(조작이 풀림)
  // 창 아래로 내려간다 — 예전엔 창 제목 위를 덮었다(14회차)
  const [isPlaying, setIsPlaying] = useState(isPointerActive);
  useEffect(() => addPointerActiveListener(() => setIsPlaying(isPointerActive())), []);
  // 규칙 글의 [E] · [C] 같은 키 이름을 터치 단추 이름(✋ · 앉기)으로 — 휴대폰엔 키보드가 없다(14회차)
  const rule = useKeyLabels().text(rawRule);
  return (
    <div style={isPlaying ? touchCardStyle : { ...touchCardStyle, zIndex: 30 }} data-hud="퍼즐 안내판">
      <button
        type="button"
        style={touchHeaderStyle}
        aria-expanded={isOpen}
        aria-label={isOpen ? `${title} 접기` : `${title} 펼치기`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span style={{ ...titleStyle, marginBottom: 0 }}>{title}</span>
        <span style={chevronStyle} aria-hidden="true">
          {isOpen ? "▴ 접기" : "▾ 규칙"}
        </span>
      </button>
      {rows && rows.length > 0 && (
        <div style={{ ...rowsStyle, borderTop: "none", paddingTop: 2 }}>
          {rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span style={{ ...labelStyle, fontSize: 14 }}>{row.label}</span>
              <span style={{ ...valueStyle, fontSize: 14, color: row.ok ? AMBER : CREAM }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {isOpen ? (
        <div style={touchBodyStyle}>
          <div style={{ ...ruleStyle, marginBottom: diagram ? 8 : 0 }}>{rule}</div>
          {diagram && <div style={diagramStyle}>{diagram}</div>}
        </div>
      ) : (
        // 접혀 있어도 규칙 앞 두 줄은 보인다 — 개수 줄이 없는 퍼즐도 무엇을 하는 곳인지 알 수 있게
        <div style={clampedRuleStyle}>{rule}</div>
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  position: "absolute",
  right: 24,
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 24,
  width: 250,
  padding: "14px 16px",
  borderRadius: 12,
  background: "rgba(14,18,26,.78)",
  color: CREAM,
  font: `500 13px/1.5 ${FONT}`,
  pointerEvents: "none",
  boxShadow: "0 8px 28px rgba(0,0,0,.3)",
};

/** 터치 — 좌상단 안전 영역 안 12px. 아래쪽 이동 스틱 자리를 넘지 않게 높이를 묶는다 */
const touchCardStyle: CSSProperties = {
  position: "absolute",
  left: "calc(env(safe-area-inset-left, 0px) + 12px)",
  top: "calc(env(safe-area-inset-top, 0px) + 12px)",
  zIndex: 950,
  width: "min(300px, 40vw)",
  boxSizing: "border-box",
  maxHeight: "calc(100dvh - 24px - 150px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
  pointerEvents: "auto",
  padding: "2px 12px 10px",
  borderRadius: 12,
  background: "rgba(10,13,19,.92)",
  border: "1px solid rgba(242,238,228,.12)",
  color: CREAM,
  font: `500 14px/1.5 ${FONT}`,
  boxShadow: "0 8px 28px rgba(0,0,0,.35)",
};

/** 제목 줄 — 누르면 펼치기 · 접기(누르는 높이 44px) */
const touchHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  minHeight: 44,
  padding: 0,
  border: "none",
  background: "none",
  textAlign: "left",
  cursor: "pointer",
};
const chevronStyle: CSSProperties = {
  color: "#A9B3B0",
  font: `500 13px/1 ${FONT}`,
  flexShrink: 0,
  whiteSpace: "nowrap",
};
const clampedRuleStyle: CSSProperties = {
  marginTop: 6,
  color: "#CFD6D4",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const touchBodyStyle: CSSProperties = { borderTop: "1px solid rgba(242,238,228,.14)", marginTop: 8, paddingTop: 8 };

const titleStyle: CSSProperties = { font: `700 15px/1.3 ${FONT}`, color: AMBER, marginBottom: 6 };
const ruleStyle: CSSProperties = { color: "#CFD6D4", whiteSpace: "pre-line", marginBottom: 8 };
const diagramStyle: CSSProperties = { display: "grid", placeItems: "center", margin: "4px 0 8px" };
const rowsStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  borderTop: "1px solid rgba(242,238,228,.14)",
  paddingTop: 8,
};
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10 };
const labelStyle: CSSProperties = { color: "#A9B3B0" };
const valueStyle: CSSProperties = { font: `600 13px/1.5 ${FONT}`, textAlign: "right" };
