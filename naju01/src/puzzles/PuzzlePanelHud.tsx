import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { inCompanionVoice } from "../dialogue/gameVoice";

import { addPointerActiveListener, isPointerActive, useKeyLabels, useTouchMode } from "@/engine/input";

import { AMBER, CREAM, HUD_FONT as FONT } from "./hudTheme";
import { useNotice } from "./interaction";
import { usePuzzlePanel } from "./puzzlePanel";

/**
 * PC — 알림과 겹치면 안내판이 잠깐 비켜 준다(흐려진다). 알림은 몇 초 뒤 사라지고 안내판은 퍼즐 곁에 있는 내내 떠 있어서,
 * 짧게 머무는 쪽(알림)을 또렷하게 둔다. 큰 그림이 든 안내판(물레 고리문) · 낮은 화면 · 긴 이야기 알림이 겹치는 경우(박람회 출품판 22회차 Codex).
 * 대사 상자 · 게이지가 떠서 알림이 옮겨 가는 것도 잡게 떠 있는 동안 0.25초마다 다시 잰다.
 */
function useYieldToNotice() {
  const notice = useNotice();
  const ref = useRef<HTMLDivElement>(null);
  const [isYielding, setIsYielding] = useState(false);
  useLayoutEffect(() => {
    if (!notice) return undefined;
    const check = () => {
      const panel = ref.current;
      const box = document.querySelector('[data-hud="알림"]');
      if (!panel || !box) return setIsYielding(false);
      const a = panel.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setIsYielding(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    };
    // 알림이 그려진 다음 프레임에 처음 재고, 떠 있는 동안 이어서 잰다
    const frame = requestAnimationFrame(check);
    const timer = window.setInterval(check, 250);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [notice]);
  // 알림이 없으면 비키지 않는다(마지막으로 잰 값이 남아 있어도)
  return { ref, isYielding: !!notice && isYielding };
}

/** 퍼즐 안내판 — PC 는 화면 오른쪽 위. 퍼즐이 올린 제목 · 규칙 · 상태 줄 · 그림을 그대로 보여 준다. Canvas 밖 DOM 층 */
export default function PuzzlePanelHud() {
  const panel = usePuzzlePanel();
  const isTouch = useTouchMode();
  const { ref, isYielding } = useYieldToNotice();
  if (!panel) return null;
  if (isTouch) {
    // 퍼즐이 바뀌면(제목) 접힘 상태를 새로 — 같은 퍼즐의 개수 갱신으로는 바뀌지 않는다
    return (
      <TouchPuzzlePanel
        key={panel.title}
        title={panel.title}
        rule={inCompanionVoice(panel.rule)}
        rows={panel.rows}
        diagram={panel.diagram}
      />
    );
  }
  return (
    <div
      ref={ref}
      style={{ ...cardStyle, opacity: isYielding ? 0.12 : 1 }}
      data-hud="퍼즐 안내판"
      data-yield={isYielding ? "1" : undefined}
    >
      <div style={titleStyle}>{panel.title}</div>
      <div style={ruleStyle}>{inCompanionVoice(panel.rule)}</div>
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
        <span style={{ ...titleStyle, marginBottom: 0, fontSize: 14 }}>{title}</span>
        <span style={chevronStyle} aria-hidden="true">
          {isOpen ? "▴ 접기" : "▾ 규칙"}
        </span>
      </button>
      {rows && rows.length > 0 && (
        <div style={{ ...rowsStyle, borderTop: "none", paddingTop: 2 }}>
          {rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span style={{ ...labelStyle, fontSize: 13 }}>{row.label}</span>
              <span style={{ ...valueStyle, fontSize: 13, color: row.ok ? AMBER : CREAM }}>{row.value}</span>
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
  // 오른쪽 위에 붙여 아래로 자란다 — 가운데(50%)에 두면 글씨를 키운 알림(긴 이야기는 4~5줄)이 아래에서 올라와 닿았다(박람회 출품판 22회차).
  // 「⚙ 설정 [P]」 단추(위 14 ~ 42px) 바로 아래부터 — 그림까지 든 물레 고리문 판(15px 글씨로 550px 안팎)도 낮은 화면(640)에 들어오게
  top: 54,
  zIndex: 24,
  // 글씨를 키웠다(13 → 15px · 제목 15 → 17px, 미르 11/9 「작아서 안 보인다 — 대사 상자와 같은 톤으로」) — 그만큼 넓게
  width: 290,
  boxSizing: "border-box",
  padding: "15px 18px",
  borderRadius: 14,
  background: "rgba(12,15,22,.9)",
  border: "1px solid rgba(242,238,228,.16)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: CREAM,
  font: `500 15px/1.55 ${FONT}`,
  wordBreak: "keep-all",
  overflowWrap: "break-word",
  pointerEvents: "none",
  boxShadow: "0 8px 28px rgba(0,0,0,.3)",
  transition: "opacity .2s ease",
};

/**
 * 터치 — 좌상단 안전 영역 안 8px. 아래쪽 이동 스틱 자리를 넘지 않게 높이를 묶는다.
 * 폭 최대 280 · 36vw, 글 13px · 줄 간격 1.5 — 게임 화면을 덜 덮게(11/8 해랑 검토). 숨 · 당김 게이지는 최대 300 · 40vw 를 비켜 둔다
 */
const touchCardStyle: CSSProperties = {
  position: "absolute",
  left: "calc(env(safe-area-inset-left, 0px) + 8px)",
  top: "calc(env(safe-area-inset-top, 0px) + 8px)",
  zIndex: 950,
  width: "min(280px, 36vw)",
  boxSizing: "border-box",
  // 주소창까지 보이는 낮은 휴대폰(780×304 등)에서는 130px 로 줄어 짧은 안내도 스크롤해야 했다 — 160px 은 지킨다(스틱은 그 아래 136px 에)
  maxHeight: "max(160px, calc(100dvh - 24px - 150px))",
  overflowY: "auto",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
  pointerEvents: "auto",
  padding: "0 12px 8px",
  borderRadius: 12,
  background: "rgba(10,13,19,.92)",
  border: "1px solid rgba(242,238,228,.12)",
  color: CREAM,
  font: `500 13px/1.5 ${FONT}`,
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
  marginTop: 4,
  color: "#CFD6D4",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const touchBodyStyle: CSSProperties = { borderTop: "1px solid rgba(242,238,228,.14)", marginTop: 8, paddingTop: 8 };

// PC 제목 15 → 17px · 값 13 → 15px(휴대폰 판은 fontSize 를 따로 덮어써 그대로다)
const titleStyle: CSSProperties = { font: `700 17px/1.3 ${FONT}`, color: AMBER, marginBottom: 7 };
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
const valueStyle: CSSProperties = { font: `600 15px/1.5 ${FONT}`, textAlign: "right" };
