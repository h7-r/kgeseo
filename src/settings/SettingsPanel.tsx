/**
 * 게임 안 설정 창([P] 또는 오른쪽 위 ⚙). 바꾸는 즉시 적용·저장된다.
 * 창 규칙은 다른 창과 같다 — 한 번에 하나(화면층), ESC·[P]·닫기 단추로 닫는다.
 */
import { useEffect, type CSSProperties } from "react";

import {
  DEFAULT_SETTINGS,
  RESOLUTION_LABELS,
  RESOLUTION_OPTIONS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "./settings";

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
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const settings = useSettings();

  // 막대를 만진 뒤엔 포커스가 <input> 에 남아 App 의 키 처리가 「글씨 입력 중」으로 보고 [P]·ESC 를 무시한다.
  // 그래서 막대 위일 때만 여기서 받는다(단추 위라면 App 이 이미 닫는다 — 두 번 닫지 않게).
  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={dialogStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div style={headerStyle}>
          <h2 id="settings-title" style={titleStyle}>
            설정
          </h2>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="설정 닫기">
            ✕
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

        <div style={groupTitleStyle}>조작</div>
        <SliderRow
          id="settings-sensitivity"
          label="마우스 감도"
          value={settings.sensitivity}
          min={0.4}
          max={2}
          step={0.05}
          format={formatMultiplier}
          onChange={(value) => updateSettings({ sensitivity: value })}
        />

        <div style={footerStyle}>
          <button
            type="button"
            onClick={resetSettings}
            style={resetButtonStyle}
            disabled={SETTING_KEYS.every((key) => settings[key] === DEFAULT_SETTINGS[key])}
          >
            기본값으로
          </button>
          <span style={noteStyle}>[P] · [ESC] 로 닫기 · 바꾸면 바로 저장됩니다</span>
        </div>
      </div>
    </div>
  );
}

const GOLD = "#ffd36b";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "rgba(4, 8, 14, 0.55)",
  zIndex: 45,
};

const dialogStyle: CSSProperties = {
  width: "min(480px, 100%)",
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto",
  padding: "18px 22px 16px",
  borderRadius: 12,
  background: "#161b22",
  border: "1px solid #2c343e",
  boxShadow: "0 18px 48px rgba(0,0,0,.5)",
  color: "#e6ebf1",
  fontSize: 14,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};
const titleStyle: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700 };
const closeButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid #2c343e",
  background: "transparent",
  color: "#b7c0cb",
  cursor: "pointer",
  fontSize: 14,
};

const groupTitleStyle: CSSProperties = {
  marginTop: 16,
  marginBottom: 4,
  font: "12px ui-monospace,Menlo,monospace",
  letterSpacing: 1,
  color: GOLD,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(90px, 1fr) 2fr 52px",
  alignItems: "center",
  gap: 12,
  padding: "8px 0",
  borderBottom: "1px solid #222a33",
};
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const descriptionStyle: CSSProperties = { fontSize: 11, color: "#7d8b97" };
const sliderStyle: CSSProperties = { width: "100%", accentColor: GOLD, cursor: "pointer" };
const valueStyle: CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  color: "#b7c0cb",
};
const choicesStyle: CSSProperties = { gridColumn: "2 / 4", display: "flex", flexWrap: "wrap", gap: 6 };
const choiceStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 99,
  border: "1px solid #2c343e",
  background: "transparent",
  color: "#b7c0cb",
  cursor: "pointer",
  fontSize: 13,
};
const choiceActiveStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 99,
  border: `1px solid ${GOLD}`,
  background: "rgba(255, 211, 107, 0.12)",
  color: GOLD,
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
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px solid #2c343e",
  background: "#1d2430",
  color: "#e6ebf1",
  cursor: "pointer",
};
const noteStyle: CSSProperties = { fontSize: 12, color: "#5b6b80" };
