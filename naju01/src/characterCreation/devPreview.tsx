// 캐릭터 생성 화면 개발용 미리보기(naju01/character-creation.html).
// 회원가입·서버·오프닝 없이 생성 화면만 연다. 이름 확인과 완료는 여기서 만든 가짜 함수로 대신하고,
// 돌려줄 답을 골라 모든 상태를 재현한다. 이 조작 도구는 미리보기에만 있다 — 생성 화면 안에는 「무조건 사용 가능」 같은
// 기본값이 없어 확인 함수가 없으면 완료가 막힌다.
import { useCallback, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";

import type { Option } from "../avatar/sidekickOptions";
import type { CharacterDraft, CompletedCharacter, CompleteResult } from "./appearanceData";
import CharacterCreationScreen from "./CharacterCreationScreen";
import type { NameCheckResult } from "./nameRules";
import { COLORS, FONTS, SCREEN_CSS, TYPE_SCALE, buttonStyle, selectedButtonStyle } from "./styles";

type NameAnswer = "available" | "taken" | "invalid" | "reject";
type CompleteAnswer = "ok" | "name_taken" | "failed" | "reject";

const NAME_ANSWERS: readonly Option<NameAnswer>[] = [
  ["available", "사용 가능"],
  ["taken", "이미 사용 중"],
  ["invalid", "허용되지 않는 이름"],
  ["reject", "확인 실패(통신 오류)"],
];

const COMPLETE_ANSWERS: readonly Option<CompleteAnswer>[] = [
  ["ok", "성공"],
  ["name_taken", "이름 충돌"],
  ["failed", "저장 실패"],
  ["reject", "예외(통신 오류)"],
];

// 이미 쓰이고 있다고 칠 이름들 — 「사용 가능」을 골라도 이 이름은 중복으로 답한다
const TAKEN_NAMES = new Set(["조사관", "홍길동", "테스트"]);

// 엔트리 파일이라 내보낼 것이 없다(Fast Refresh 대신 새로고침)
// eslint-disable-next-line react-refresh/only-export-components
function CharacterCreationDevPreview() {
  const [nameAnswer, setNameAnswer] = useState<NameAnswer>("available");
  const [completeAnswer, setCompleteAnswer] = useState<CompleteAnswer>("ok");
  const [isSlow, setIsSlow] = useState(false);
  const [isCheckNameAttached, setIsCheckNameAttached] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const [sentPayload, setSentPayload] = useState<CompletedCharacter | null>(null);
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [initialValue, setInitialValue] = useState<CharacterDraft | null>(null);
  const [mountKey, setMountKey] = useState(0);
  // 개발 도구는 기본으로 접혀 있다 — 시각 검토 화면을 밀어내지 않는다
  const [isToolOpen, setIsToolOpen] = useState(false);
  const addLog = (line: string) =>
    setLog((previous) => [`${new Date().toLocaleTimeString("ko-KR")} ${line}`, ...previous].slice(0, 12));

  const checkName = useCallback(
    async (name: string, { signal }: { signal?: AbortSignal } = {}): Promise<NameCheckResult> => {
      addLog(`checkName("${name}")`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, isSlow ? 2600 : 320);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("abort"));
        });
      });
      if (nameAnswer === "reject") throw new Error("네트워크 오류(가짜)");
      if (nameAnswer === "available") return TAKEN_NAMES.has(name) ? { status: "taken" } : { status: "available" };
      if (nameAnswer === "taken") return { status: "taken" };
      return { status: "invalid", message: "쓸 수 없는 이름입니다(가짜 금칙어)." };
    },
    [nameAnswer, isSlow],
  );

  const handleComplete = useCallback(
    async (payload: CompletedCharacter): Promise<CompleteResult> => {
      addLog(`onComplete(${payload.displayName})`);
      setSentPayload(payload);
      await new Promise((resolve) => setTimeout(resolve, isSlow ? 1600 : 350));
      if (completeAnswer === "reject") throw new Error("네트워크 오류(가짜)");
      if (completeAnswer === "ok") return { ok: true };
      if (completeAnswer === "name_taken") {
        return { ok: false, reason: "name_taken", message: "그 사이 누군가 쓴 이름입니다." };
      }
      return { ok: false, reason: "failed", message: "저장에 실패했습니다(가짜)." };
    },
    [completeAnswer, isSlow],
  );

  const handleDraftChange = useCallback((value: CharacterDraft) => setDraft(value), []);

  // 받은 초안을 그대로 initialValue 로 넣고 다시 마운트한다(이어 만들기 검증)
  const reopenWithDraft = () => {
    setInitialValue(draft);
    setMountKey((n) => n + 1);
    addLog("초안을 initialValue 로 넣고 다시 마운트");
  };

  return (
    <div style={rootStyle}>
      <style>{SCREEN_CSS}</style>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <CharacterCreationScreen
          key={mountKey}
          initialValue={initialValue}
          checkName={isCheckNameAttached ? checkName : null}
          onComplete={handleComplete}
          onDraftChange={handleDraftChange}
          onCancel={() => addLog("onCancel() — 부모가 화면을 닫을 차례")}
        />
      </div>

      {isToolOpen ? null : (
        <button type="button" style={openToolButtonStyle} onClick={() => setIsToolOpen(true)}>
          개발 도구 열기
        </button>
      )}
      <aside style={{ ...toolPanelStyle, display: isToolOpen ? "grid" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...TYPE_SCALE.step, color: COLORS.warning }}>개발 미리보기 · 실제 화면 아님</div>
          <button
            type="button"
            style={{ ...buttonStyle, marginLeft: "auto", padding: "2px 8px" }}
            onClick={() => setIsToolOpen(false)}
          >
            접기
          </button>
        </div>
        <p style={TYPE_SCALE.caption}>아래는 생성 화면이 아니라 **가짜 서버**를 조종하는 도구입니다.</p>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={TYPE_SCALE.step}>checkName 이 돌려줄 답</span>
          {NAME_ANSWERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              style={nameAnswer === value ? selectedButtonStyle : buttonStyle}
              onClick={() => setNameAnswer(value)}
            >
              {label}
            </button>
          ))}
          <span style={TYPE_SCALE.caption}>‘사용 가능’ 이어도 조사관·홍길동·테스트는 중복으로 답합니다.</span>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <span style={TYPE_SCALE.step}>onComplete 가 돌려줄 답</span>
          {COMPLETE_ANSWERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              style={completeAnswer === value ? selectedButtonStyle : buttonStyle}
              onClick={() => setCompleteAnswer(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <button type="button" style={isSlow ? selectedButtonStyle : buttonStyle} onClick={() => setIsSlow((v) => !v)}>
            {isSlow ? "느린 응답 켬(2.6초)" : "느린 응답 끔"}
          </button>
          <button
            type="button"
            style={isCheckNameAttached ? selectedButtonStyle : buttonStyle}
            onClick={() => setIsCheckNameAttached((v) => !v)}
          >
            {isCheckNameAttached ? "checkName 연결됨" : "checkName 없음(미연결 상태 보기)"}
          </button>
          <button type="button" style={buttonStyle} onClick={reopenWithDraft}>
            초안을 initialValue 로 다시 열기
          </button>
        </div>

        <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
          <span style={TYPE_SCALE.step}>onComplete 로 나간 데이터</span>
          <pre style={codeStyle}>{sentPayload ? JSON.stringify(sentPayload, null, 2) : "아직 없음"}</pre>
        </div>

        <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
          <span style={TYPE_SCALE.step}>onDraftChange 최근 초안</span>
          <pre style={codeStyle}>{draft ? JSON.stringify(draft, null, 2) : "아직 없음"}</pre>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <span style={TYPE_SCALE.step}>기록</span>
          {log.map((line) => (
            <span key={line} style={TYPE_SCALE.caption}>
              {line}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}

// 원본은 없는 색 토큰(색.바탕)을 읽어 배경이 비어 있었다 — 같은 화면이 되도록 배경을 두지 않는다
const rootStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  color: COLORS.text,
  fontFamily: FONTS.body,
};

const openToolButtonStyle: CSSProperties = {
  ...buttonStyle,
  position: "fixed",
  right: 0,
  top: "50%",
  zIndex: 5,
  borderRadius: "8px 0 0 8px",
  writingMode: "vertical-rl",
};

const toolPanelStyle: CSSProperties = {
  width: 320,
  flex: "0 0 auto",
  display: "grid",
  gap: 14,
  alignContent: "start",
  overflowY: "auto",
  padding: 14,
  borderLeft: `1px solid ${COLORS.line}`,
  background: "rgba(255,194,102,0.05)",
};

const codeStyle: CSSProperties = {
  margin: 0,
  maxHeight: 220,
  overflow: "auto",
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${COLORS.line}`,
  background: "#04070f",
  font: `400 11px/1.5 ${FONTS.mono}`,
  color: COLORS.textMuted,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<CharacterCreationDevPreview />);
