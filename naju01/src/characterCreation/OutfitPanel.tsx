// 의상 단계 — 상의 · 하의 · 신발 세 칸과, 한 칸을 눌렀을 때 여는 고르기 창.
import { useEffect, type CSSProperties } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import { slotOptions, type DraftAppearance } from "./appearanceData";
import { SLOT_LABELS, pickThumbnail, type CharacterCatalog } from "./catalog";
import { ColorPicker, Group, ItemCard, TileButton } from "./controls";
import { ICONS } from "./icons";
import { OUTFIT_COLOR_SLOTS, OUTFIT_DESCRIPTIONS, OUTFIT_SLOTS, type OutfitSlot } from "./steps";
import { COLORS, FONTS, SPACING, WHITE, cardGridStyle, confirmButtonStyle, smallTextStyle, tileStyle } from "./styles";
import type { UpdateAppearance } from "./useLookHistory";

interface OutfitPanelProps {
  catalog: CharacterCatalog;
  appearance: DraftAppearance;
  gender: AvatarGender;
  isWide: boolean;
  onOpenSlot: (slot: OutfitSlot) => void;
}

/** 상의 · 하의 · 신발 세 칸. 누르면 그 칸을 고르는 창이 열린다 */
export function OutfitPanel({ catalog, appearance, gender, isWide, onOpenSlot }: OutfitPanelProps) {
  return (
    <Group title="의상 항목" aside="누르면 고르는 창이 열립니다">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isWide ? "repeat(3, 1fr)" : "1fr",
          gap: SPACING.m,
        }}
      >
        {OUTFIT_SLOTS.map((slot) => {
          const current = slotOptions(catalog, slot, gender).find((it) => it.id === appearance.equipmentIds[slot]);
          const thumbnail = current ? pickThumbnail(current, gender) : null;
          const color = appearance.colors[OUTFIT_COLOR_SLOTS[slot]] ?? WHITE;
          return (
            <TileButton
              key={slot}
              onClick={() => onOpenSlot(slot)}
              aria-haspopup="dialog"
              style={{ padding: 12, display: "grid", gap: 10, textAlign: "left" }}
            >
              <span
                style={{
                  width: "100%",
                  aspectRatio: "4 / 3",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "rgba(0,0,0,0.3)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {thumbnail ? (
                  <img src={thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={smallTextStyle}>없음</span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ font: `700 16px/1.2 ${FONTS.body}`, color: COLORS.text }}>{SLOT_LABELS[slot]}</span>
                <span
                  aria-label={`${SLOT_LABELS[slot]} 컬러`}
                  style={{
                    marginLeft: "auto",
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: color,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.25)",
                  }}
                />
              </span>
              <span style={{ ...smallTextStyle, color: COLORS.textMuted }}>{current?.label ?? "없음"}</span>
            </TileButton>
          );
        })}
      </div>
    </Group>
  );
}

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  pointerEvents: "auto",
};
const modalStyle: CSSProperties = {
  width: "min(720px, calc(100% - 48px))",
  maxHeight: "min(760px, calc(100% - 48px))",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "linear-gradient(180deg, #16181C 0%, #0F1013 100%)",
  boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
  overflow: "hidden",
};

interface OutfitModalProps {
  slot: OutfitSlot;
  catalog: CharacterCatalog;
  appearance: DraftAppearance;
  gender: AvatarGender;
  updateAppearance: UpdateAppearance;
  onClose: () => void;
}

/** 의상 한 칸(상의 · 하의 · 신발)의 종류와 색을 고르는 창 */
export function OutfitModal({ slot, catalog, appearance, gender, updateAppearance, onClose }: OutfitModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const colorSlot = OUTFIT_COLOR_SLOTS[slot];
  return (
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={`${SLOT_LABELS[slot]} 고르기`} style={modalStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: SPACING.m,
            padding: `${SPACING.xl}px ${SPACING.xl}px ${SPACING.l}px`,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <h2 style={{ margin: 0, font: `700 22px/1.25 ${FONTS.body}`, color: COLORS.text }}>{SLOT_LABELS[slot]}</h2>
            <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>{OUTFIT_DESCRIPTIONS[slot]}</p>
          </div>
          <button
            type="button"
            className="cc-tile"
            aria-label="닫기"
            onClick={onClose}
            style={{
              ...tileStyle,
              marginLeft: "auto",
              width: 40,
              height: 40,
              padding: 0,
              display: "grid",
              placeItems: "center",
            }}
          >
            {ICONS.close}
          </button>
        </div>
        <div style={{ padding: SPACING.xl, display: "grid", gap: SPACING.xl, overflowY: "auto" }}>
          <Group title={`${SLOT_LABELS[slot]} 종류`}>
            <div style={cardGridStyle}>
              {slotOptions(catalog, slot, gender).map((it) => (
                <ItemCard
                  key={it.id}
                  isSelected={appearance.equipmentIds[slot] === it.id}
                  label={it.label}
                  description={it.description}
                  thumbnail={pickThumbnail(it, gender)}
                  onClick={() =>
                    updateAppearance((v) => ({ ...v, equipmentIds: { ...v.equipmentIds, [slot]: it.id } }))
                  }
                />
              ))}
            </div>
          </Group>
          <Group
            title={`${SLOT_LABELS[slot]} 컬러`}
            aside={slot === "bottom" ? "검은 바지라 짙은 색만 또렷이 보입니다" : "원본에 색을 입힙니다"}
          >
            <ColorPicker
              slot={colorSlot}
              palette={catalog.palettes[colorSlot] ?? catalog.palettes.cloth}
              value={appearance.colors[colorSlot]}
              onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, [colorSlot]: hex } }))}
            />
          </Group>
        </div>
        <div
          style={{
            padding: `${SPACING.l}px ${SPACING.xl}px ${SPACING.xl}px`,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            className="cc-confirm"
            onClick={onClose}
            style={{ ...confirmButtonStyle, height: 46, padding: "0 32px" }}
          >
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
