/**
 * 게임 안 설정 창([P] 또는 오른쪽 위 ⚙). 바꾸는 즉시 적용·저장된다.
 * 창 규칙은 다른 창과 같다 — 한 번에 하나(화면층), ESC·[P]·닫기 단추로 닫는다.
 * 자리: 게임 중 [P] · ⚙ 는 오른쪽 위(게임을 보며 밝기 · 감도를 맞춘다). ESC 멈춤 메뉴에서 열면 메뉴가 있던 화면 가운데(미르 11/11
 * 「중앙 배치해야 자연스럽지 않나」) — 바탕은 어둡게 덮지 않는다(밝기 판단이 틀어진다), 메뉴에 이미 있는 「게임」 묶음은 숨긴다.
 * 닫으면(ESC · P · X · 바깥) 메뉴로 돌아간다 — 열 때 조작 중이 아니었다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useTouchMode } from "@/engine/input";
import { QUALITY, readQualityChoice, saveQualityChoice, type QualityChoice } from "@/engine/quality";
import { CloseIcon } from "@/game/gameIcons";
import LeaveToLobby, { type LeaveToLobbyAction } from "@/game/LeaveToLobby";
import { isPauseMenuOpen } from "@/game/pauseMenuState";
import { DOCK_EDGE, DOCK_TOP, PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";

import "@/game/gameUi.css";

import {
  DEFAULT_SETTINGS,
  FOV_RANGE,
  RESOLUTION_LABELS,
  RESOLUTION_OPTIONS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "./settings";

/** 고른 품질로 다시 연다 — 주소의 ?q= 는 저장값보다 먼저라 떼고 연다(안 떼면 고른 값이 안 먹는다, Codex 리뷰 10) */
function reopenWithChosenQuality() {
  const url = new URL(window.location.href);
  url.searchParams.delete("q");
  url.searchParams.delete("quality");
  window.location.replace(url.toString());
}

const QUALITY_CHOICES: readonly QualityChoice[] = ["auto", "standard", "low"];
const QUALITY_LABELS: Record<QualityChoice, string> = { auto: "자동", standard: "보통", low: "저사양" };
/** 페이지를 열 때 저장돼 있던 값 — 지금 고른 값이 이것과 다르면 다시 열어야 적용된다 */
const QUALITY_CHOICE_AT_LOAD = readQualityChoice();

interface SliderRowProps {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function SliderRow({ id, label, description, value, min, max, step, format, onChange }: SliderRowProps) {
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
        {description && <span style={descriptionStyle}>{description}</span>}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={sliderStyle}
      />
      <span style={valueStyle}>{format(value)}</span>
    </div>
  );
}

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatMultiplier = (value: number) => `${value.toFixed(2)}×`;

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** 게임(케이스) 중이면 맨 아래 「로비로 나가기」(나주) — 없으면 그리지 않는다 */
  leaveToLobby?: LeaveToLobbyAction;
  /** 시작 카드(조작 · 평가)를 다시 띄운다(나주) — 없으면 그리지 않는다 */
  onShowGuide?: () => void;
  /** 그 단추 글자 */
  guideLabel?: string;
}

export default function SettingsPanel(props: SettingsPanelProps) {
  if (!props.open) return null;
  return <SettingsDialog {...props} />;
}

function SettingsDialog({ onClose, leaveToLobby, onShowGuide, guideLabel }: SettingsPanelProps) {
  const settings = useSettings();
  const [qualityChoice, setQualityChoice] = useState<QualityChoice>(readQualityChoice);
  // 고른 값이 달라졌거나, 고른 값과 지금 적용된 값이 다르면(주소 ?q= 로 열었을 때) 다시 열어야 한다
  const isQualityPending =
    qualityChoice !== QUALITY_CHOICE_AT_LOAD || (qualityChoice !== "auto" && qualityChoice !== QUALITY.mode);
  // 멈춤 메뉴에서 열었나 — 열리는 그 그리기에서 한 번 읽는다(메뉴는 이 커밋 뒤에 내려가 그때는 이미 거짓이다, 16회차 Codex)
  const [isFromMenu] = useState(isPauseMenuOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 휴대폰 — 화면 가운데 · 제목 줄 고정 · 단추와 막대 44px(gameUi.css 의 .settings-dialog.is-touch, 14회차 · 11/8 해랑 검토)
  const isTouch = useTouchMode();

  // 막대를 만진 뒤엔 포커스가 <input> 에 남아 App 의 키 처리가 「글씨 입력 중」으로 보고 [P]·ESC 를 무시한다.
  // 그래서 막대 위일 때만 여기서 받는다(단추 위라면 App 이 이미 닫는다 — 두 번 닫지 않게).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.type !== "range") return;
      if (event.code === "KeyP" || event.code === "Escape") {
        event.preventDefault();
        target.blur();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isCentered = isFromMenu && !isTouch;
  // 가운데 창 — 멈춤 메뉴처럼 Web Animations 로 뜬다(게임 밖 쉼의 CSS 애니메이션 정지에 걸리지 않게) · 창 안으로 초점을 옮긴다
  useLayoutEffect(() => {
    if (!isCentered) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    dialog?.animate?.(
      [
        { opacity: 0, transform: "translateY(10px) scale(.98)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 190, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }, [isCentered]);
  const hasGameGroup = !isFromMenu && (leaveToLobby || onShowGuide);

  return (
    <div
      className={isTouch ? "settings-overlay is-touch" : undefined}
      style={isCentered ? centeredOverlayStyle : overlayStyle}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className={isTouch ? "settings-dialog is-touch" : "settings-dialog"}
        style={
          isCentered ? centeredDialogStyle : ({ ...dialogStyle, "--panel-from": "14px" } as CSSProperties)
        }
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-dialog__header" style={headerStyle}>
          <h2 id="settings-title" style={titleStyle}>
            설정
          </h2>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="설정 닫기">
            <CloseIcon />
          </button>
        </div>

        <div style={groupTitleStyle}>소리</div>
        <SliderRow
          id="settings-bgm-volume"
          label="배경음악"
          value={settings.bgmVolume}
          min={0}
          max={1}
          step={0.05}
          format={formatPercent}
          onChange={(value) => updateSettings({ bgmVolume: value })}
        />
        <SliderRow
          id="settings-sfx-volume"
          label="효과음"
          value={settings.sfxVolume}
          min={0}
          max={1}
          step={0.05}
          format={formatPercent}
          onChange={(value) => updateSettings({ sfxVolume: value })}
        />

        <div style={groupTitleStyle}>화면</div>
        <SliderRow
          id="settings-brightness"
          label="밝기"
          value={settings.brightness}
          min={0.6}
          max={1.4}
          step={0.05}
          format={formatPercent}
          onChange={(value) => updateSettings({ brightness: value })}
        />
        <div style={rowStyle}>
          <span style={labelStyle}>
            해상도
            <span style={descriptionStyle}>낮추면 부드럽게 돈다</span>
          </span>
          <div style={choicesStyle} role="radiogroup" aria-label="해상도">
            {RESOLUTION_OPTIONS.map((resolution) => (
              <button
                key={resolution}
                type="button"
                role="radio"
                aria-checked={settings.resolution === resolution}
                onClick={() => updateSettings({ resolution })}
                style={settings.resolution === resolution ? choiceActiveStyle : choiceStyle}
              >
                {RESOLUTION_LABELS[resolution]}
              </button>
            ))}
          </div>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>
            그래픽 품질
            <span style={descriptionStyle}>
              {/* 이 페이지에 실제로 적용된 값 — 고른 값은 다시 열어야 바뀐다 */}
              지금: {QUALITY.mode === "low" ? "저사양" : "보통"}
              {QUALITY.source === "자동" ? "(자동)" : ""}
            </span>
          </span>
          <div style={choicesStyle} role="radiogroup" aria-label="그래픽 품질">
            {QUALITY_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={qualityChoice === choice}
                onClick={() => {
                  if (saveQualityChoice(choice)) setQualityChoice(choice);
                }}
                style={qualityChoice === choice ? choiceActiveStyle : choiceStyle}
              >
                {QUALITY_LABELS[choice]}
              </button>
            ))}
            {isQualityPending && (
              <button type="button" style={choiceStyle} onClick={reopenWithChosenQuality}>
                다시 열어 적용
              </button>
            )}
          </div>
        </div>

        <div style={groupTitleStyle}>조작</div>
        <SliderRow
          id="settings-sensitivity"
          label={isTouch ? "시점 감도" : "마우스 감도"}
          value={settings.sensitivity}
          min={0.2}
          max={2}
          step={0.05}
          format={formatMultiplier}
          onChange={(value) => updateSettings({ sensitivity: value })}
        />
        <SliderRow
          id="settings-fov"
          label="시야각"
          value={settings.fov}
          min={FOV_RANGE.min}
          max={FOV_RANGE.max}
          step={1}
          format={(value) => `${Math.round(value)}°`}
          onChange={(value) => updateSettings({ fov: value })}
        />
        <div style={rowStyle}>
          <span style={labelStyle}>
            흔들림 줄이기
            <span style={descriptionStyle}>걸음 출렁임 · 당겨 보기를 끕니다</span>
          </span>
          <div style={choicesStyle} role="radiogroup" aria-label="화면 흔들림 줄이기">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={settings.reduceMotion === value}
                onClick={() => updateSettings({ reduceMotion: value })}
                style={settings.reduceMotion === value ? choiceActiveStyle : choiceStyle}
              >
                {value ? "켬" : "끔"}
              </button>
            ))}
          </div>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>
            대사 자동 넘김
            <span style={descriptionStyle}>끄면 [F] 로 넘깁니다</span>
          </span>
          <div style={choicesStyle} role="radiogroup" aria-label="대사 자동 넘김">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={settings.autoAdvance === value}
                onClick={() => updateSettings({ autoAdvance: value })}
                style={settings.autoAdvance === value ? choiceActiveStyle : choiceStyle}
              >
                {value ? "켬" : "끔"}
              </button>
            ))}
          </div>
        </div>

        {hasGameGroup && (
          <>
            <div style={groupTitleStyle}>게임</div>
            {onShowGuide && (
              <div style={leaveRowStyle}>
                <button type="button" onClick={onShowGuide} style={guideButtonStyle}>
                  {guideLabel ?? "조작 다시 보기"}
                </button>
              </div>
            )}
            {leaveToLobby && (
              <div style={leaveRowStyle}>
                <LeaveToLobby action={leaveToLobby} tone="panel" />
              </div>
            )}
          </>
        )}

        <div style={footerStyle}>
          <button
            type="button"
            onClick={resetSettings}
            style={resetButtonStyle}
            disabled={SETTING_KEYS.every((key) => settings[key] === DEFAULT_SETTINGS[key])}
          >
            기본값으로
          </button>
          <span style={noteStyle}>
            {isTouch
              ? "바꾸면 바로 저장됩니다"
              : isFromMenu
                ? "[P] · [ESC] 로 일시정지로 돌아가기 · 바꾸면 바로 저장됩니다"
                : "[P] · [ESC] 로 닫기 · 바꾸면 바로 저장됩니다"}
          </span>
        </div>
      </div>
    </div>
  );
}

const GOLD = UI.accent;

// 바깥을 누르면 닫히게 화면 전체를 받되, 어둡게 덮지 않는다.
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 45 };

const dialogStyle: CSSProperties = {
  position: "absolute",
  right: DOCK_EDGE,
  top: DOCK_TOP,
  width: `min(420px, calc(100% - ${DOCK_EDGE * 2}px))`,
  maxHeight: `calc(100% - ${DOCK_TOP + DOCK_EDGE}px)`,
  overflowY: "auto",
  padding: "20px 22px 16px",
  animation: "game-panel-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
  boxSizing: "border-box",
  borderRadius: 16,
  background: UI.surface,
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  font: `400 15px/1.6 ${UI_FONT.body}`,
};

// 멈춤 메뉴에서 열었을 때 — 화면 가운데, 바탕은 덮지 않는다(밝기 판단). 높이가 모자라면 창 안에서 스크롤
const centeredOverlayStyle: CSSProperties = {
  ...overlayStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: DOCK_EDGE,
  boxSizing: "border-box",
};
const centeredDialogStyle: CSSProperties = {
  ...dialogStyle,
  position: "relative",
  right: "auto",
  top: "auto",
  width: "min(420px, 100%)",
  maxHeight: "100%",
  animation: "none",
};
const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};
const titleStyle: CSSProperties = { margin: 0, font: `700 24px/1.2 ${UI_FONT.title}` };
const closeButtonStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  borderRadius: 18,
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
  cursor: "pointer",
};

const groupTitleStyle: CSSProperties = {
  marginTop: 16,
  marginBottom: 4,
  font: `600 14px/1.2 ${UI_FONT.body}`,
  color: UI.text,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(84px, 1fr) 2.4fr 48px",
  alignItems: "center",
  gap: 12,
  padding: "8px 0",
  borderBottom: `1px solid ${UI.border}`,
};
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const descriptionStyle: CSSProperties = { fontSize: 13, color: UI.textMuted };
const sliderStyle: CSSProperties = { width: "100%", accentColor: GOLD, cursor: "pointer" };
const valueStyle: CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  font: `500 13px/1 ${UI_FONT.mono}`,
  color: UI.textMuted,
};
const choicesStyle: CSSProperties = { gridColumn: "2 / 4", display: "flex", flexWrap: "wrap", gap: 6 };
const choiceStyle: CSSProperties = {
  padding: "6px 9px",
  borderRadius: 99,
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
  cursor: "pointer",
  fontSize: 13,
};
const choiceActiveStyle: CSSProperties = {
  padding: "6px 9px",
  borderRadius: 99,
  border: `1px solid ${UI.accent}`,
  background: UI.surfaceHover,
  color: UI.text,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 16,
};
const resetButtonStyle: CSSProperties = {
  padding: "9px 16px",
  borderRadius: 99,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
  cursor: "pointer",
};
const noteStyle: CSSProperties = { fontSize: 13, color: UI.textMuted };
const leaveRowStyle: CSSProperties = { padding: "8px 0 4px" };
const guideButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  borderRadius: 12,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
  font: `600 15px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};
