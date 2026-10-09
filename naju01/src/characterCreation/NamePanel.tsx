import type { CSSProperties, Ref } from "react";

import type { Option } from "../avatar/sidekickOptions";
import { SettingGroup } from "./controls";
import type { NameRules } from "./nameRules";
import { COLORS, FONTS, MOTION, SPACING, smallTextStyle, tileStyle } from "./styles";
import type { NameStatusKind } from "./useNameCheck";

const NAME_STATUS_COLORS: Partial<Record<NameStatusKind, string>> = {
  available: COLORS.success,
  taken: COLORS.error,
  forbidden: COLORS.error,
  failed: COLORS.warning,
  notConnected: COLORS.warning,
};

const nameInputStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "15px 18px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.28)",
  background: "rgba(6,7,9,0.8)",
  color: COLORS.text,
  font: `600 18px/1.3 ${FONTS.body}`,
  transition: `border-color ${MOTION.fast}, box-shadow ${MOTION.fast}`,
};
const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 1,
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  overflow: "hidden",
  background: "rgba(255,255,255,0.14)",
};
const summaryRowStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "12px 14px",
  background: "rgba(12,13,15,0.95)",
};
const messageStyle: CSSProperties = { font: `500 14px/1.5 ${FONTS.body}` };

interface NamePanelProps {
  inputId: string;
  inputRef: Ref<HTMLInputElement>;
  name: string;
  characterCount: number;
  rules: NameRules;
  statusKind: NameStatusKind;
  message: string | undefined;
  isComposing: boolean;
  isConfirmNudged: boolean;
  summary: Option<string>[];
  completeError: string | null;
  isCompleted: boolean;
  onInput: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (value: string) => void;
  onCheck: () => void;
}

export default function NamePanel({
  inputId,
  inputRef,
  name,
  characterCount,
  rules,
  statusKind,
  message,
  isComposing,
  isConfirmNudged,
  summary,
  completeError,
  isCompleted,
  onInput,
  onCompositionStart,
  onCompositionEnd,
  onCheck,
}: NamePanelProps) {
  return (
    <>
      <SettingGroup title="조사관 이름" aside={`${characterCount} / ${rules.max}자`}>
        <div style={{ display: "flex", gap: SPACING.s }}>
          <input
            ref={inputRef}
            id={inputId}
            value={name}
            style={nameInputStyle}
            maxLength={rules.max * 2}
            placeholder={`${rules.min}~${rules.max}자로 입력해 주세요`}
            aria-label="조사관 이름"
            aria-describedby={`${inputId}-help ${inputId}-result`}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중의 Enter 는 「입력 확정」이라 제출로 받으면 안 된다
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !isComposing) {
                e.preventDefault();
                onCheck();
              }
            }}
          />
          <button
            type="button"
            className="character-creator__tile"
            style={{
              ...tileStyle,
              padding: "0 22px",
              font: `700 14px/1 ${FONTS.body}`,
              color: COLORS.text,
            }}
            onClick={onCheck}
            disabled={statusKind === "checking"}
          >
            중복확인
          </button>
        </div>
        <span id={`${inputId}-help`} style={smallTextStyle}>
          {rules.allowedHint}
        </span>
        {/* 결과 자리를 미리 비워 둔다 — 메시지가 떠도 입력칸·단추가 튀지 않는다 */}
        <div
          id={`${inputId}-result`}
          role="status"
          aria-live="polite"
          style={{
            minHeight: 22,
            ...messageStyle,
            color: NAME_STATUS_COLORS[statusKind] ?? (isConfirmNudged ? COLORS.warning : COLORS.textMuted),
          }}
        >
          {message}
        </div>
      </SettingGroup>
      <SettingGroup title="조사관 정보">
        <div style={summaryGridStyle}>
          {summary.map(([label, value]) => (
            <div key={label} style={summaryRowStyle}>
              <span style={smallTextStyle}>{label}</span>
              <span style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>{value}</span>
            </div>
          ))}
        </div>
      </SettingGroup>
      {completeError ? <div style={{ ...messageStyle, color: COLORS.error }}>{completeError}</div> : null}
      {isCompleted ? (
        <div style={{ ...messageStyle, color: COLORS.success }}>캐릭터를 만들었습니다. 튜토리얼로 이동합니다.</div>
      ) : null}
    </>
  );
}
