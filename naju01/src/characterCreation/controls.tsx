// 설정 칸들이 같이 쓰는 작은 조작 부품 — 묶음 제목, 칸 단추, 스위치, 항목 카드, 색 고르기.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import type { Option } from "../avatar/sidekickOptions";
import { COLOR_SLOT_LABELS, type ColorSlot } from "./catalog";
import { COLORS, FONTS, MOTION, SPACING, selectedTileStyle, smallTextStyle, tileStyle } from "./styles";

const groupTitleStyle: CSSProperties = {
  margin: 0,
  font: `700 13px/1 ${FONTS.body}`,
  letterSpacing: "0.04em",
  color: COLORS.textMuted,
};

interface SettingGroupProps {
  title: string;
  aside?: string;
  children: ReactNode;
}

/** 작은 제목 + 내용. 묶음끼리는 24px 띄운다 */
export function SettingGroup({ title, aside, children }: SettingGroupProps) {
  return (
    <section style={{ display: "grid", gap: SPACING.m }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: SPACING.s }}>
        <h3 style={groupTitleStyle}>{title}</h3>
        {aside ? <span style={{ marginLeft: "auto", ...smallTextStyle }}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface TileButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isSelected?: boolean;
}

/** 테두리가 있는 하나의 칸. 고르면 강조색 테와 옅은 바탕 */
export function TileButton({ isSelected, children, style, ...rest }: TileButtonProps) {
  return (
    <button
      type="button"
      className="character-creator__tile"
      aria-pressed={isSelected}
      style={{ ...tileStyle, ...(isSelected ? selectedTileStyle : null), ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

interface ToggleSwitchProps {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  children: ReactNode;
}

/** 체크박스를 그대로 두고 모양만 스위치로 */
export function ToggleSwitch({ isOn, onChange, children }: ToggleSwitchProps) {
  return (
    <label
      className="character-creator__tile"
      style={{
        ...tileStyle,
        display: "flex",
        alignItems: "center",
        gap: SPACING.m,
        cursor: "pointer",
        padding: "14px 16px",
      }}
    >
      <input
        type="checkbox"
        checked={isOn}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <span style={{ display: "grid", gap: 2, flex: 1 }}>{children}</span>
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: isOn ? COLORS.accent : "rgba(255,255,255,0.14)",
          position: "relative",
          transition: `background ${MOTION.normal}`,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: isOn ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: isOn ? "#0A0B0D" : "#d6dde3",
            transition: `left ${MOTION.normal}`,
          }}
        />
      </span>
    </label>
  );
}

const checkMarkStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 20,
  height: 20,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "#FFFFFF",
  color: "#0A0B0D",
  font: "800 11px/1 sans-serif",
};

interface CatalogItemCardProps {
  isSelected: boolean;
  label: string;
  description?: string;
  thumbnail: string | null;
  onClick: () => void;
}

export function CatalogItemCard({ isSelected, label, description, thumbnail, onClick }: CatalogItemCardProps) {
  return (
    <button
      type="button"
      className="character-creator__tile"
      onClick={onClick}
      aria-pressed={isSelected}
      style={{
        ...tileStyle,
        ...(isSelected ? selectedTileStyle : null),
        padding: 8,
        display: "grid",
        gap: 8,
        justifyItems: "stretch",
        position: "relative",
      }}
    >
      <span
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 8,
          overflow: "hidden",
          background: "rgba(0,0,0,0.25)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span style={smallTextStyle}>없음</span>
        )}
      </span>
      <span
        style={{
          font: `600 13px/1.3 ${FONTS.body}`,
          color: isSelected ? "#fff" : COLORS.textMuted,
          textAlign: "center",
        }}
      >
        {label}
      </span>
      {description ? (
        <span style={{ ...smallTextStyle, textAlign: "center", marginTop: -4 }}>{description}</span>
      ) : null}
      {isSelected ? <span style={checkMarkStyle}>✓</span> : null}
    </button>
  );
}

const swatchStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  padding: 0,
  border: "1px solid rgba(0,0,0,0.35)",
  borderRadius: 8,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  transition: `box-shadow ${MOTION.fast}, transform ${MOTION.fast}`,
};
const selectedSwatchStyle: CSSProperties = { boxShadow: `0 0 0 2px #0A121C, 0 0 0 4px ${COLORS.accent}` };

interface ColorPickerProps {
  slot: ColorSlot;
  palette: readonly Option<string>[];
  value: string | undefined;
  onChange: (hex: string) => void;
}

export function ColorPicker({ slot, palette, value, onChange }: ColorPickerProps) {
  return (
    <div
      className="color-picker"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: SPACING.s }}
    >
      {palette.map(([hex, label]) => {
        const isSelected = hex.toLowerCase() === (value ?? "").toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            className="color-picker__swatch"
            onClick={() => onChange(hex)}
            aria-pressed={isSelected}
            aria-label={`${COLOR_SLOT_LABELS[slot]} 색 ${label}`}
            title={label}
            style={{ ...swatchStyle, background: hex, ...(isSelected ? selectedSwatchStyle : null) }}
          >
            {isSelected ? <span style={{ color: "#0A0B0D", font: "800 12px/1 sans-serif" }}>✓</span> : null}
          </button>
        );
      })}
      <label
        className="color-picker__swatch"
        style={{
          ...swatchStyle,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,0.06)",
          cursor: "pointer",
        }}
        title="직접 고르기"
      >
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${COLOR_SLOT_LABELS[slot]} 색 직접 고르기`}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        />
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={COLORS.textMuted}
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </label>
    </div>
  );
}
