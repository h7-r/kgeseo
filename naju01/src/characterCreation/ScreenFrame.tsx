// 패널의 머리(제목 · 닫기)와 발치(아래 단추 줄 · 심장선).
import type { CSSProperties } from "react";

import HeartbeatLine from "./HeartbeatLine";
import { ICONS } from "./icons";
import type { ScreenLayout } from "./screenLayout";
import { TABS } from "./steps";
import {
  COLORS,
  FONTS,
  SPACING,
  backButtonStyle,
  confirmButtonStyle,
  smallTextStyle,
  stepNumberStyle,
  textButtonStyle,
  tileStyle,
} from "./styles";

const titleStyle: CSSProperties = {
  font: `800 34px/1.1 ${FONTS.body}`,
  letterSpacing: "-0.02em",
  color: COLORS.text,
  textShadow: "0 2px 18px rgba(0,0,0,0.5)",
};
const closeButtonStyle: CSSProperties = {
  ...tileStyle,
  position: "absolute",
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  padding: 0,
};

interface ScreenHeaderProps {
  layout: ScreenLayout;
  onCancel: (() => void) | null;
}

/** 패널 머리의 「캐릭터 생성」 제목과 오른쪽 위 닫기 단추 */
export function ScreenHeader({ layout, onCancel }: ScreenHeaderProps) {
  const { isNarrow, panel, padding, header } = layout;
  return (
    <>
      <header
        style={{
          position: "absolute",
          left: panel.x + padding,
          width: panel.w - padding * 2,
          top: panel.y,
          height: header,
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
          gap: 6,
          paddingBottom: 14,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, ...titleStyle, fontSize: isNarrow ? 24 : 34 }}>캐릭터 생성</h1>
        <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>
          왜곡을 조사할 당신의 모습을 만들어 주세요
        </p>
      </header>

      {/* 닫기 — 「뒤로」와 같은 일을 한다 */}
      {onCancel ? (
        <button
          type="button"
          className="character-creator__tile"
          aria-label="닫고 웹사이트로 돌아가기"
          onClick={onCancel}
          style={{
            ...closeButtonStyle,
            left: panel.x + panel.w - padding - 40,
            top: panel.y + 20,
            pointerEvents: "auto",
          }}
        >
          {ICONS.close}
        </button>
      ) : null}
    </>
  );
}

// 이름이 아직이어도 누를 수는 있다(이름 탭으로 데려간다) — 빛만 줄인다
const pendingConfirmStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.38) 100%)",
  color: "rgba(10,11,13,0.82)",
};

interface ScreenFooterProps {
  layout: ScreenLayout;
  activeTabIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  isNameConfirmed: boolean;
  isBusy: boolean;
  confirmLabel: string;
  /** 이름 확인이 아직이면 확인 단추가 그 결과 문구를 가리킨다 */
  nameResultId: string;
  onCancel: (() => void) | null;
  onUndo: () => void;
  onRedo: () => void;
  onResetAll: () => void;
  onConfirm: () => void;
}

/** 아래 단추 줄(뒤로 · 되돌리기 · 단계 · 확인)과 발치 심장선 */
export function ScreenFooter({
  layout,
  activeTabIndex,
  canUndo,
  canRedo,
  isNameConfirmed,
  isBusy,
  confirmLabel,
  nameResultId,
  onCancel,
  onUndo,
  onRedo,
  onResetAll,
  onConfirm,
}: ScreenFooterProps) {
  const { isNarrow, panel, padding, footer } = layout;
  // 「캐릭터 생성」 제목과 같은 폭 — 위아래 정렬선이 하나로 맞는다
  const heartbeatWidth = isNarrow ? 150 : 200;
  return (
    <>
      <footer
        style={{
          position: "absolute",
          left: panel.x + padding,
          width: panel.w - padding * 2,
          top: panel.y + panel.h - footer,
          height: footer,
          display: "flex",
          alignItems: "center",
          gap: SPACING.l,
        }}
      >
        {onCancel ? (
          <button
            type="button"
            className="character-creator__back-button"
            onClick={onCancel}
            style={{ ...backButtonStyle, pointerEvents: "auto" }}
          >
            {ICONS.previous} 뒤로
          </button>
        ) : null}
        <div style={{ display: "flex", gap: 4, pointerEvents: "auto" }}>
          <button
            type="button"
            className="character-creator__text-button"
            style={textButtonStyle}
            onClick={onUndo}
            disabled={!canUndo}
          >
            {ICONS.undo} 되돌리기
          </button>
          <button
            type="button"
            className="character-creator__text-button"
            style={textButtonStyle}
            onClick={onRedo}
            disabled={!canRedo}
          >
            {ICONS.redo} 다시 실행
          </button>
          <button type="button" className="character-creator__text-button" style={textButtonStyle} onClick={onResetAll}>
            {ICONS.reset} 외형 초기화
          </button>
        </div>
        {/* 가운데는 비운다 — 심장선은 아래에서 패널 정중앙에 따로 놓는다 */}
        <div style={{ flex: 1 }} />
        <span
          aria-label={`${TABS.length}단계 중 ${activeTabIndex + 1}단계`}
          style={{ ...stepNumberStyle, color: COLORS.text }}
        >
          {`0${activeTabIndex + 1}`}
          <span style={{ color: COLORS.textFaint }}>{` / 0${TABS.length}`}</span>
        </span>
        <button
          type="button"
          className="character-creator__confirm-button"
          onClick={onConfirm}
          disabled={isBusy}
          aria-describedby={!isNameConfirmed ? nameResultId : undefined}
          style={{ ...confirmButtonStyle, ...(isNameConfirmed ? null : pendingConfirmStyle), pointerEvents: "auto" }}
        >
          {confirmLabel} {ICONS.next}
        </button>
      </footer>
      {/* 발치 심장선 — 위 「캐릭터 생성」 제목과 같은 가운데 · 같은 폭 */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: panel.x + panel.w / 2 - heartbeatWidth / 2,
          width: heartbeatWidth,
          top: panel.y + panel.h - footer / 2 - 6,
          height: 12,
        }}
      >
        <HeartbeatLine
          shape="cardSmall"
          height={12}
          color="#FFFFFF"
          glow="#FFFFFF"
          opacity={0.28}
          period={2.8}
          style={{ width: "100%" }}
        />
      </div>
    </>
  );
}
