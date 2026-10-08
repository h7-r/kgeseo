// 설정 칸 — 위 단계 탭, 가운데 큰 카드, 아래 다음 단계 단추.
import type { CSSProperties, ReactNode } from "react";

import { ICONS, TAB_ICONS } from "./icons";
import { NEXT_LABELS, TABS, type TabId } from "./steps";
import { COLORS, FONTS, SPACING, smallTextStyle, stepNumberStyle, textButtonStyle, tileStyle } from "./styles";

const selectedTabStyle: CSSProperties = {
  borderColor: COLORS.accent,
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 100%)",
  boxShadow: `inset 0 -2px 0 ${COLORS.accent}`,
};

interface StepNavProps {
  activeTab: TabId;
  isNarrow: boolean;
  onSelect: (tab: TabId) => void;
}

/** 01~05 단계 탭. 지나온 단계는 번호 대신 ✓ */
export function StepNav({ activeTab, isNarrow, onSelect }: StepNavProps) {
  const activeIndex = TABS.findIndex((tab) => tab.id === activeTab);
  return (
    <nav
      aria-label="만드는 순서"
      style={{ display: "grid", gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, gap: SPACING.s }}
    >
      {TABS.map((tab, i) => {
        const isSelected = activeTab === tab.id;
        const isPassed = i < activeIndex;
        return (
          <button
            key={tab.id}
            type="button"
            className="cc-tile"
            aria-pressed={isSelected}
            aria-current={isSelected ? "step" : undefined}
            onClick={() => onSelect(tab.id)}
            style={{
              ...tileStyle,
              ...(isSelected ? selectedTabStyle : null),
              padding: isNarrow ? "8px 6px" : "12px 12px 11px",
              display: "grid",
              gap: 6,
              justifyItems: isNarrow ? "center" : "start",
              textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              <span
                style={{
                  ...stepNumberStyle,
                  color: isSelected ? COLORS.accent : isPassed ? COLORS.success : COLORS.textFaint,
                }}
              >
                {isPassed ? "✓" : `0${i + 1}`}
              </span>
              {!isNarrow ? (
                <span
                  style={{
                    marginLeft: "auto",
                    color: isSelected ? COLORS.accent : COLORS.textFaint,
                    display: "grid",
                  }}
                >
                  {TAB_ICONS[tab.id]}
                </span>
              ) : null}
            </span>
            <span style={{ font: `700 15px/1.2 ${FONTS.body}`, color: isSelected ? "#fff" : COLORS.textMuted }}>
              {tab.label}
            </span>
            {!isNarrow ? (
              <span
                style={{
                  ...smallTextStyle,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                }}
              >
                {tab.summary}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

interface NextStepProps {
  nextTab: TabId | undefined;
  isNameConfirmed: boolean;
  onSelect: (tab: TabId) => void;
}

/** 설정 칸 맨 아래 — 다음 단계 단추, 마지막 단계에서는 남은 일을 알려 주는 한 줄 */
export function NextStep({ nextTab, isNameConfirmed, onSelect }: NextStepProps) {
  if (nextTab) {
    return (
      <button
        type="button"
        className="cc-tile"
        onClick={() => onSelect(nextTab)}
        style={{ ...tileStyle, padding: "15px 20px", display: "flex", alignItems: "center", gap: SPACING.m }}
      >
        <span style={{ font: `700 16px/1 ${FONTS.body}`, color: COLORS.text }}>{NEXT_LABELS[nextTab]}</span>
        <span style={{ marginLeft: "auto", color: COLORS.text, display: "grid" }}>{ICONS.next}</span>
      </button>
    );
  }
  return (
    <div style={{ ...smallTextStyle, padding: "15px 4px", textAlign: "right" }}>
      {isNameConfirmed
        ? "준비가 끝났습니다. 확인을 누르면 튜토리얼이 시작됩니다."
        : "이름 중복확인을 마치면 게임을 시작할 수 있습니다."}
    </div>
  );
}

const contentCardStyle: CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto 1fr",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(8,9,11,0.45)",
  overflow: "hidden",
};
const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: SPACING.s,
  margin: `${SPACING.m}px ${SPACING.xl}px 0`,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid rgba(240,194,122,0.3)",
  background: "rgba(240,194,122,0.08)",
  color: COLORS.warning,
  font: `500 13px/1.5 ${FONTS.body}`,
};

interface SettingsCardProps {
  title: string;
  description: string;
  notice: string | null;
  /** 없으면 「이 항목 초기화」 단추를 숨긴다 */
  onResetSection: (() => void) | null;
  onDismissNotice: () => void;
  children: ReactNode;
}

/** 탭 아래 큰 칸 — 머리(제목) · 알림 · 스크롤되는 몸 */
export function SettingsCard({
  title,
  description,
  notice,
  onResetSection,
  onDismissNotice,
  children,
}: SettingsCardProps) {
  return (
    <div style={contentCardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: SPACING.m,
          padding: `${SPACING.xl}px ${SPACING.xl}px ${SPACING.l}px`,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <h2
            style={{
              margin: 0,
              font: `700 22px/1.25 ${FONTS.body}`,
              color: COLORS.text,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>{description}</p>
        </div>
        {onResetSection ? (
          <button
            type="button"
            className="cc-text-button"
            style={{ ...textButtonStyle, marginLeft: "auto" }}
            onClick={onResetSection}
          >
            {ICONS.reset} 이 항목 초기화
          </button>
        ) : null}
      </div>

      {notice ? (
        <div style={noticeStyle} role="status">
          <span style={{ flex: 1 }}>{notice}</span>
          <button
            type="button"
            className="cc-text-button"
            style={{ ...textButtonStyle, color: COLORS.warning }}
            onClick={onDismissNotice}
          >
            확인
          </button>
        </div>
      ) : null}

      <div
        style={{
          overflowY: "auto",
          padding: SPACING.xl,
          display: "grid",
          gap: SPACING.xl,
          alignContent: "start",
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
