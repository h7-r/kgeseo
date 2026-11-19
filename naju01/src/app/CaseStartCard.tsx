/**
 * 나주 시작 카드(PC) — 나주는 새 페이지라 브라우저가 첫 몸짓 전에는 마우스를 잠가 주지 않는다. 예전엔 아무 안내 없이 [T] 를 눌러야만
 * 시작했다(운영 화면엔 [T] 안내도 없었다). 그 첫 몸짓을 이 카드로 받는다 — 「조사 시작」 클릭 · Enter · W A S D(그대로 걷기로 이어짐)가
 * 곧 잠금 요청이다. [T] 도 그대로 된다(미르 11/11, 나주입장 01 · 02회차 Codex).
 *
 *   full    이 케이스 처음 — 사건 · 첫 목표 · 조작 · (평가) · 시작
 *   resume  하던 케이스(저장 있음) — 한 줄 「이어서 조사」, 끝낸 케이스면 「조사 완료 — 둘러보기」
 *   guide   설정(P)의 「조작 · 평가 다시 보기」 — full 과 같은 내용, 단추는 「계속하기」
 *
 * 평가(시간 20분 · 직접 청한 도움 → 낮은 별, 미르 11/11)는 아직 결과 화면 · 서버 기록이 없어 운영에서는 숨긴다(?rating=on · ?rating=rank 로 시안만).
 * 문구는 초안 — 이야기팀 · 기획 확인 전. 다시 보기(guide)는 Esc 로 닫는다 — 멈춤 메뉴에서 열었으면 메뉴로 돌아간다.
 * 시작 몸짓에서 빼는 것: 자동 반복 · 수식키 조합 · 한글 조합 중 · 입력칸 · 다른 단추(설정 등).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { PANEL_SHADOW, UI, UI_FONT, keyCapStyle } from "@/game/gameUi";

import { RATING_PREVIEW, type CaseStartMode } from "./caseStart";

/** 사건 정보 — 본편 목적지 창(destinationData NAJU_LEGEND)과 같은 이름 */
const CASE = {
  label: "CASE 01 · 나주 영산강",
  title: "앙암바위의 전설",
  goal: "앙암바위의 기억과 기록이 어긋나고 있어요. 물가의 여인에게 무슨 일이 있었는지 물어보세요.",
} as const;

const START_KEYS = new Set(["Enter", "NumpadEnter", "KeyW", "KeyA", "KeyS", "KeyD"]);

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");

export default function CaseStartCard({
  mode,
  isCleared,
  onStart,
  onClose,
}: {
  mode: CaseStartMode;
  /** 끝낸 케이스(resume 일 때 「조사 완료」) */
  isCleared: boolean;
  /** 시작 몸짓 — 잠금을 요청한다(잠기면 부른 쪽이 카드를 내린다) */
  onStart: () => void;
  /** 다시 보기(guide)를 Esc 로 닫는다 — 없으면 Esc 를 받지 않는다 */
  onClose?: () => void;
}) {
  const [isRefused, setIsRefused] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const onStartRef = useRef(onStart);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onStartRef.current = onStart;
    onCloseRef.current = onClose;
  }, [onStart, onClose]);

  // 시작 단추에 처음 초점 — Enter · Space 로도 눌린다
  useEffect(() => startRef.current?.focus({ preventScroll: true }), [mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && onCloseRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (!START_KEYS.has(event.code) || event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      // Enter 는 시작만 — 동행 대화(Enter) 같은 다른 처리로 새지 않게. W A S D 는 그대로 걷기로도 간다
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      setIsRefused(false);
      onStartRef.current();
    };
    // 브라우저가 잠금을 거절했다(ESC 직후 · 창 밖 초점) — 카드를 그대로 두고 한 번 더 누르게
    const handleRefused = () => setIsRefused(true);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("pointerlockerror", handleRefused);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("pointerlockerror", handleRefused);
    };
  }, []);

  const start = () => {
    setIsRefused(false);
    onStart();
  };
  const refused = isRefused && <p style={refusedStyle}>브라우저가 잠시 막았어요 — 한 번 더 눌러 주세요.</p>;

  if (mode === "resume") {
    return (
      <div style={backdropStyle} data-hud="나주 시작 카드">
        <div role="dialog" aria-label={`${CASE.title} 이어서 조사`} style={{ ...cardStyle, ...compactCardStyle }}>
          <div style={compactRowStyle}>
            <div style={compactTextStyle}>
              <span style={eyebrowStyle}>{CASE.title}</span>
              <span style={compactTitleStyle}>{isCleared ? "조사 완료 — 자유롭게 둘러보세요" : "이어서 조사"}</span>
            </div>
            <button ref={startRef} type="button" style={startButtonStyle} onClick={start}>
              {isCleared ? "둘러보기" : "계속하기"}
            </button>
          </div>
          <p style={{ ...hintLineStyle, justifyContent: "flex-start", marginTop: 6 }}>
            클릭 · <Key>Enter</Key> · <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key> 로 바로 이동
          </p>
          {refused}
        </div>
      </div>
    );
  }

  return (
    <div style={backdropStyle} data-hud="나주 시작 카드">
      <div role="dialog" aria-label={`${CASE.title} 시작 안내`} style={cardStyle}>
        <div style={eyebrowStyle}>{CASE.label}</div>
        <h2 style={titleStyle}>{CASE.title}</h2>

        <section style={goalStyle}>
          <div style={sectionLabelStyle}>첫 목표</div>
          <p style={goalTextStyle}>{CASE.goal}</p>
        </section>

        <section style={sectionStyle}>
          <div style={sectionLabelStyle}>조작</div>
          <ul style={controlListStyle}>
            <ControlRow keys={["W", "A", "S", "D"]} label="이동" extra={<Key>Shift</Key>} extraLabel="달리기" />
            <ControlRow keys={["마우스"]} label="둘러보기" />
            <ControlRow keys={["E"]} label="살펴보기 · 쓰기" />
            <ControlRow keys={["F"]} label="동행 부르기(도움 청하기)" />
            <ControlRow keys={["Esc"]} label="멈춤" extra={<Key>P</Key>} extraLabel="설정" />
          </ul>
        </section>

        {RATING_PREVIEW !== "off" && (
          <section style={sectionStyle}>
            <div style={sectionLabelStyle}>평가</div>
            <ul style={ratingListStyle}>
              <RatingRow icon="⏱">
                <b style={strongStyle}>시간</b> 20분 이내 <Stars n={3} /> · 넘으면 <Stars n={2} />
              </RatingRow>
              <RatingRow icon="🙋">
                <b style={strongStyle}>도움</b> 직접 청하지 않으면 <Stars n={3} /> · 청하면 <Stars n={2} /> · 정답 확인 <Stars n={1} />
              </RatingRow>
              <RatingRow icon="★">
                <b style={strongStyle}>시간과 도움 중 낮은 별</b>이 이번 판의 별이에요.
              </RatingRow>
              <RatingRow icon="💬">동행이 먼저 건넨 안내는 도움 횟수에 들지 않아요.</RatingRow>
              {RATING_PREVIEW === "rank" && <RatingRow icon="🏁">클리어 시간은 시간 순위에 올라요.</RatingRow>}
            </ul>
          </section>
        )}

        <div style={startRowStyle}>
          <button ref={startRef} type="button" style={startButtonStyle} onClick={start}>
            {mode === "guide" ? "계속하기" : "조사 시작"}
          </button>
          <p style={hintLineStyle}>
            <Key>Enter</Key> · 클릭 · <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key> 로도 {mode === "guide" ? "이어 가요" : "시작해요"}
            {onClose && (
              <>
                {" "}
                · <Key>Esc</Key> 닫기
              </>
            )}
          </p>
        </div>
        {refused}
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd style={keyStyle}>{children}</kbd>;
}

function ControlRow({
  keys,
  label,
  extra,
  extraLabel,
}: {
  keys: string[];
  label: string;
  extra?: ReactNode;
  extraLabel?: string;
}) {
  return (
    <li style={controlRowStyle}>
      <span style={keysStyle}>
        {keys.map((key) => (
          <Key key={key}>{key}</Key>
        ))}
      </span>
      <span style={controlLabelStyle}>
        {label}
        {extra && (
          <span style={extraStyle}>
            {extra} {extraLabel}
          </span>
        )}
      </span>
    </li>
  );
}

/** 기준을 나타내는 별 — 받은 별처럼 보이지 않게 작고 옅게 */
function Stars({ n }: { n: number }) {
  return (
    <span style={starsStyle} aria-label={`별 ${n}개`}>
      {"★".repeat(n)}
    </span>
  );
}

function RatingRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li style={ratingRowStyle}>
      <span style={ratingIconStyle} aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 950,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  boxSizing: "border-box",
  background: "rgba(3,7,16,0.6)",
  fontFamily: UI_FONT.body,
  color: UI.text,
};
const cardStyle: CSSProperties = {
  width: "min(560px, 92vw)",
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "26px 28px 22px",
  borderRadius: 18,
  background: "rgba(5,11,26,.94)",
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
};
const compactCardStyle: CSSProperties = { width: "min(520px, 92vw)", padding: "18px 22px 16px" };
const eyebrowStyle: CSSProperties = { color: UI.accent, font: `600 13px/1.3 ${UI_FONT.body}`, letterSpacing: ".04em" };
const titleStyle: CSSProperties = { margin: "6px 0 0", font: `700 28px/1.25 ${UI_FONT.title}`, color: UI.text };
const goalStyle: CSSProperties = {
  marginTop: 18,
  padding: "12px 14px",
  borderRadius: 12,
  background: "rgba(46,72,137,.28)",
  border: `1px solid ${UI.borderStrong}`,
};
const goalTextStyle: CSSProperties = { margin: "4px 0 0", font: `600 17px/1.5 ${UI_FONT.body}`, wordBreak: "keep-all" };
const sectionStyle: CSSProperties = { marginTop: 16 };
const sectionLabelStyle: CSSProperties = {
  color: UI.textSubtle,
  font: `600 12px/1.3 ${UI_FONT.body}`,
  letterSpacing: ".06em",
};
const controlListStyle: CSSProperties = {
  listStyle: "none",
  margin: "8px 0 0",
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "8px 16px",
};
const controlRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, minHeight: 28 };
const keysStyle: CSSProperties = { display: "inline-flex", gap: 3, flexShrink: 0 };
const keyStyle: CSSProperties = { ...keyCapStyle, minWidth: 24, height: 24, padding: "0 6px", fontSize: 12 };
const controlLabelStyle: CSSProperties = { color: UI.textMuted, fontSize: 15, lineHeight: 1.35, wordBreak: "keep-all" };
const extraStyle: CSSProperties = { marginLeft: 8, color: UI.textSubtle, fontSize: 14 };
const ratingListStyle: CSSProperties = { listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 };
const ratingRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  color: UI.textMuted,
  fontSize: 15,
  lineHeight: 1.5,
  wordBreak: "keep-all",
};
const ratingIconStyle: CSSProperties = { width: 22, flexShrink: 0, textAlign: "center" };
const strongStyle: CSSProperties = { color: UI.text, fontWeight: 600 };
const starsStyle: CSSProperties = { color: "#e9c46a", fontSize: 13, letterSpacing: ".06em" };
const startRowStyle: CSSProperties = {
  marginTop: 22,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
};
const startButtonStyle: CSSProperties = {
  minWidth: 180,
  minHeight: 48,
  padding: "0 26px",
  borderRadius: 24,
  border: `1px solid ${UI.accent}`,
  background: "linear-gradient(166deg, rgb(46,72,137) 0%, rgb(54,64,143) 45%, rgb(43,71,143) 100%)",
  color: UI.text,
  font: `700 17px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};
const hintLineStyle: CSSProperties = {
  margin: 0,
  color: UI.textSubtle,
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 3,
  flexWrap: "wrap",
  justifyContent: "center",
};
const refusedStyle: CSSProperties = { margin: "10px 0 0", color: "#fbbf24", fontSize: 14, textAlign: "center" };
const compactRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 };
const compactTextStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const compactTitleStyle: CSSProperties = { font: `700 20px/1.3 ${UI_FONT.title}`, color: UI.text };
