/**
 * 베타 설문 안내 카드 — 시작 전(pre) · 끝난 뒤(post) 설문을 새 창으로 연다. 참여 코드 · 폼 주소가 없으면 그리지 않는다.
 * 게임 화면 위에 덮이고, 누르기 · 키 입력이 뒤의 게임으로 새지 않게 막는다.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { betaLog } from "./betaLog";
import { dismissSurvey, noteSurveyShown, openSurvey, shouldOfferSurvey, type SurveyKind } from "./betaSurvey";

const TEXT: Record<"pre" | "post", { title: string; body: string; open: string; skip: string; skipHow: "already" | "later" }> = {
  pre: {
    title: "베타 테스트 — 시작 전 설문(1분)",
    body: "게임을 시작하기 전에 짧은 설문 하나만 부탁드려요. 새 창에서 열리고, 답한 뒤 이 창으로 돌아오면 바로 시작할 수 있어요.",
    open: "설문 열기",
    skip: "이미 답했어요",
    skipHow: "already",
  },
  post: {
    title: "조사 완료! 베타 설문(3~5분)",
    body: "결과 화면을 보기 전에 설문에 먼저 답해 주세요. 새 창에서 열리고, 답한 뒤 이 창으로 돌아오면 결과 화면이 이어져요.",
    open: "설문 열기",
    skip: "나중에 할게요",
    skipHow: "later",
  },
};

const shade: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483000,
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "rgba(8, 10, 16, 0.72)",
  fontFamily: "inherit",
};
const card: CSSProperties = {
  width: "min(440px, 100%)",
  padding: "26px 24px 20px",
  borderRadius: 14,
  background: "#f7f3ea",
  color: "#1c1a17",
  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  lineHeight: 1.55,
};
const buttonBase: CSSProperties = {
  minHeight: 44,
  padding: "10px 18px",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #1c1a17",
};

function stop(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

/** 설문 안내 카드 하나. onDone 은 열었거나 넘겼을 때 */
export function BetaSurveyCard({ kind, where, onDone }: { kind: "pre" | "post"; where: string; onDone: () => void }) {
  const text = TEXT[kind];
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    noteSurveyShown(kind, where);
    // 카드가 떠 있는 동안 키가 뒤의 게임(걷기 · 점프 · 단축키)으로 가지 않게 — 전파만 끊고 기본 동작(Space · Enter 로 단추 누르기)은 둔다.
    // Tab 은 카드 안 단추 사이에서만 돈다
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.type !== "keydown" || event.key !== "Tab") return;
      const buttons = [...(dialogRef.current?.querySelectorAll("button") ?? [])];
      if (buttons.length === 0) return;
      event.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[at < 0 ? buttons.length - 1 : next].focus();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKey, { capture: true });
    if (document.pointerLockElement) document.exitPointerLock?.();
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKey, { capture: true });
    };
  }, [kind, where]);
  return (
    <div
      ref={dialogRef}
      style={shade}
      role="dialog"
      aria-modal="true"
      aria-label={text.title}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      <div style={card}>
        <div style={{ fontSize: 12, letterSpacing: 1, color: "#7a6f5d", marginBottom: 6 }}>왜곡 · 베타 테스트</div>
        <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>{text.title}</h2>
        <p style={{ margin: "0 0 18px", fontSize: 15 }}>{text.body}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...buttonBase, background: "transparent", color: "#1c1a17", borderColor: "#b9ae9b" }}
            onClick={() => {
              dismissSurvey(kind, where, text.skipHow);
              onDone();
            }}
          >
            {text.skip}
          </button>
          <button
            type="button"
            autoFocus
            style={{ ...buttonBase, background: "#1c1a17", color: "#f7f3ea" }}
            onClick={() => {
              openSurvey(kind, where);
              onDone();
            }}
          >
            {text.open}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 시작 전 설문 — 본편 첫 화면에 한 번(열었거나 「이미 답했어요」면 다시 띄우지 않는다). 계정을 확인한 뒤에 정한다 */
export function BetaPreSurvey() {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    let isAlive = true;
    void betaLog.accountReady().then(() => {
      if (isAlive) setIsOpen(shouldOfferSurvey("pre"));
    });
    return () => {
      isAlive = false;
    };
  }, []);
  if (!isOpen) return null;
  return <BetaSurveyCard kind="pre" where="main_entry" onDone={() => setIsOpen(false)} />;
}

/**
 * 끝난 뒤 설문 — 클리어 화면(현장 방문 창 포함)보다 먼저 묻는다. 방문 안내를 보기 전에 「보상 없는 방문 의향」(D1)을 받으려고
 * (수집 계획 「정할 것」 3번 가안). 「나중에」를 고르면 결과 화면 위에 작은 단추로 남긴다.
 */
export function BetaPostSurveyGate({ children }: { children: ReactNode }) {
  // 계정을 아직 모르면(드묾 — 보통 페이지를 열 때 확인된다) 잠깐 기다렸다가 정한다. 3초가 지나도 모르면 결과 화면을 연다
  const [stage, setStage] = useState<"waiting" | "card" | "later" | "done">(() =>
    betaLog.isActive() && betaLog.account() === undefined ? "waiting" : shouldOfferSurvey("post") ? "card" : "done",
  );
  useEffect(() => {
    if (stage !== "waiting") return undefined;
    let isAlive = true;
    const decide = () => {
      if (isAlive) setStage(shouldOfferSurvey("post") ? "card" : "done");
    };
    void betaLog.accountReady().then(decide);
    const timer = window.setTimeout(() => {
      if (isAlive) setStage((current) => (current === "waiting" ? "done" : current));
    }, 3000);
    return () => {
      isAlive = false;
      window.clearTimeout(timer);
    };
  }, [stage]);
  if (stage === "waiting") return null;
  if (stage === "card")
    return (
      <BetaSurveyCard
        kind="post"
        where="ending_clear"
        onDone={() => setStage(shouldOfferSurvey("post") ? "later" : "done")}
      />
    );
  return (
    <>
      {children}
      {stage === "later" && (
        <button
          type="button"
          style={{ ...buttonBase, position: "fixed", top: 16, right: 16, zIndex: 2147483000, background: "#f7f3ea", color: "#1c1a17" }}
          onClick={() => {
            openSurvey("post", "ending_later");
            setStage("done");
          }}
        >
          베타 설문 열기(3~5분)
        </button>
      )}
    </>
  );
}

export type { SurveyKind };
