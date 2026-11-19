// 패널의 머리(제목 · 닫기)와 발치(아래 단추 줄 · 심장선).
import type { CSSProperties } from "react";

import { useIsTouchSized } from "./compactLayout";
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
  const { isCompact, isNarrow, panel, padding, header } = layout;
  const isTouchSized = useIsTouchSized(); // 태블릿 — 닫기 44
  // 휴대폰 가로는 제목 · 닫기를 두지 않는다 — 미리보기 위 「뒤로」가 같은 일을 하고, 그 높이를 설정 칸에 준다
  if (isCompact) return null;
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
          gap: isCompact ? 0 : 6,
          paddingBottom: isCompact ? 0 : 14,
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, ...titleStyle, fontSize: isCompact ? 18 : isNarrow ? 24 : 34 }}>캐릭터 생성</h1>
        {!isCompact && (
          <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>
            왜곡을 조사할 당신의 모습을 만들어 주세요
          </p>
        )}
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
            ...(isTouchSized ? { width: 44, height: 44 } : null),
            left: panel.x + panel.w - padding - (isTouchSized ? 44 : 40),
            top: panel.y + (isCompact ? 0 : 20),
            pointerEvents: "auto",
          }}
        >
          {ICONS.close}
        </button>
      ) : null}
    </>
  );
}

// 휴대폰 가로의 아이콘 단추 — 누르는 영역 44×44(Apple HIG)
const compactIconButtonStyle: CSSProperties = {
  ...textButtonStyle,
  width: 44,
  height: 44,
  padding: 0,
  justifyContent: "center",
};

// 이름이 아직이어도 누를 수는 있다(이름 탭으로 데려간다) — 빛만 줄인다
const pendingConfirmStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.38) 100%)",
  color: "rgba(10,11,13,0.82)",
};

interface ScreenFooterProps {
  layout: ScreenLayout;
  /** 휴대폰 가로: 아래 큰 단추가 「다음」 이다(마지막 단계면 확인 · 게임 시작) */
  nextLabel: string | null;
  onNext: () => void;
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
  nextLabel,
  onNext,
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
  const { isCompact, isNarrow, panel, padding, footer, toolbar, actionBar } = layout;
  // 태블릿(넓은 배치 + 손가락) — 되돌리기 · 다시 · 초기화 글 단추도 높이 44
  const footerTextButtonStyle = useIsTouchSized() ? { ...textButtonStyle, minHeight: 44 } : textButtonStyle;
  // 「캐릭터 생성」 제목과 같은 폭 — 위아래 정렬선이 하나로 맞는다
  const heartbeatWidth = isNarrow ? 150 : 200;
  if (isCompact && toolbar && actionBar) {
    // 휴대폰 가로 — 미리보기 위: 뒤로 · 되돌리기 · 다시 실행 · 외형 초기화(모두 44px), 미리보기 아래: 다음 / 확인 · 게임 시작
    const isTight = toolbar.w < 236;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: toolbar.x,
            top: toolbar.y,
            width: toolbar.w,
            height: toolbar.h,
            display: "flex",
            alignItems: "center",
            gap: 4,
            pointerEvents: "auto",
          }}
        >
          {onCancel ? (
            <button
              type="button"
              className="character-creator__back-button"
              onClick={onCancel}
              aria-label="뒤로 — 웹사이트로 돌아가기"
              style={{
                ...backButtonStyle,
                height: 44,
                minWidth: 44,
                padding: isTight ? 0 : "0 14px",
                justifyContent: "center",
                font: `700 14px/1 ${FONTS.body}`,
              }}
            >
              {ICONS.previous}
              {isTight ? null : " 뒤로"}
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="character-creator__text-button"
            style={compactIconButtonStyle}
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="되돌리기"
          >
            {ICONS.undo}
          </button>
          <button
            type="button"
            className="character-creator__text-button"
            style={compactIconButtonStyle}
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="다시 실행"
          >
            {ICONS.redo}
          </button>
          <button
            type="button"
            className="character-creator__text-button"
            style={compactIconButtonStyle}
            onClick={onResetAll}
            aria-label="외형 초기화"
          >
            {ICONS.reset}
          </button>
        </div>
        <button
          type="button"
          className="character-creator__confirm-button"
          onClick={nextLabel ? onNext : onConfirm}
          disabled={!nextLabel && isBusy}
          aria-describedby={!nextLabel && !isNameConfirmed ? nameResultId : undefined}
          style={{
            ...confirmButtonStyle,
            ...(nextLabel || isNameConfirmed ? null : pendingConfirmStyle),
            position: "absolute",
            left: actionBar.x,
            top: actionBar.y,
            width: actionBar.w,
            height: actionBar.h,
            padding: "0 12px",
            justifyContent: "center",
            font: `800 15px/1.1 ${FONTS.body}`,
            pointerEvents: "auto",
          }}
        >
          {nextLabel ? `다음 · ${nextLabel}` : isNameConfirmed ? confirmLabel : "이름 중복확인 필요"} {ICONS.next}
        </button>
      </>
    );
  }
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
          gap: isCompact ? 8 : SPACING.l,
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
            style={footerTextButtonStyle}
            onClick={onUndo}
            disabled={!canUndo}
          >
            {ICONS.undo} {!isCompact && "되돌리기"}
          </button>
          <button
            type="button"
            className="character-creator__text-button"
            style={footerTextButtonStyle}
            onClick={onRedo}
            disabled={!canRedo}
          >
            {ICONS.redo} {!isCompact && "다시 실행"}
          </button>
          <button
            type="button"
            className="character-creator__text-button"
            style={footerTextButtonStyle}
            onClick={onResetAll}
          >
            {ICONS.reset} {!isCompact && "외형 초기화"}
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
      {/* 발치 심장선 — 위 「캐릭터 생성」 제목과 같은 가운데 · 같은 폭. 짧은 가로 화면은 단추 줄에 자리가 없어 뺀다 */}
      {!isCompact && (
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
      )}
    </>
  );
}
