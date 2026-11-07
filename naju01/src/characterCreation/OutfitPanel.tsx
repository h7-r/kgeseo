// 의상 단계 — 상의 · 하의 · 신발 세 칸과, 한 칸을 눌렀을 때 여는 고르기 창.
import { useEffect, type CSSProperties } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import { getSlotOptions, type DraftAppearance } from "./appearanceData";
import { SLOT_LABELS, getItemThumbnail, type CharacterCatalog } from "./catalog";
import { useIsCompact, useIsTouchSized } from "./compactLayout";
import { ColorPicker, SettingGroup, CatalogItemCard, TileButton } from "./controls";
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
  // 휴대폰 가로 — 큰 4:3 카드 세 장 대신 64px 선택 줄 세 개(작은 썸네일 · 이름 · 지금 고른 것 · 색 · ›)
  const isCompact = useIsCompact();
  if (isCompact)
    return (
      <SettingGroup title="의상 항목">
        <div style={{ display: "grid", gap: SPACING.s }}>
          {OUTFIT_SLOTS.map((slot) => {
            const current = getSlotOptions(catalog, slot, gender).find((it) => it.id === appearance.equipmentIds[slot]);
            const thumbnail = current ? getItemThumbnail(current, gender) : null;
            const color = appearance.colors[OUTFIT_COLOR_SLOTS[slot]] ?? WHITE;
            return (
              <TileButton
                key={slot}
                onClick={() => onOpenSlot(slot)}
                aria-haspopup="dialog"
                aria-label={`${SLOT_LABELS[slot]} 고르기 — 지금 ${current?.label ?? "없음"}`}
                style={{
                  minHeight: 64,
                  padding: "6px 10px 6px 6px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 52,
                    height: 52,
                    flexShrink: 0,
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "rgba(0,0,0,0.3)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {thumbnail ? (
                    <img src={thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : null}
                </span>
                <span style={{ display: "grid", gap: 3, minWidth: 0, flex: 1 }}>
                  <span style={{ font: `700 15px/1.2 ${FONTS.body}`, color: COLORS.text }}>{SLOT_LABELS[slot]}</span>
                  <span
                    style={{
                      font: `400 13px/1.3 ${FONTS.body}`,
                      color: COLORS.textMuted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {current?.label ?? "없음"}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 5,
                    background: color,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.25)",
                  }}
                />
                <span aria-hidden="true" style={{ color: COLORS.textMuted, display: "grid" }}>
                  {ICONS.next}
                </span>
              </TileButton>
            );
          })}
        </div>
      </SettingGroup>
    );
  return (
    <SettingGroup title="의상 항목" aside="누르면 고르는 창이 열립니다">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isWide ? "repeat(3, 1fr)" : "1fr",
          gap: SPACING.m,
        }}
      >
        {OUTFIT_SLOTS.map((slot) => {
          const current = getSlotOptions(catalog, slot, gender).find((it) => it.id === appearance.equipmentIds[slot]);
          const thumbnail = current ? getItemThumbnail(current, gender) : null;
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
    </SettingGroup>
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
  // 휴대폰 가로 — 바깥 여백 16 · 머리 48 · 아래 56 만 고정하고 나머지를 목록에 준다(393 에서 본문 약 270px). 닫기 44
  const isCompact = useIsCompact();
  const isTouchSized = useIsTouchSized();
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${SLOT_LABELS[slot]} 고르기`}
        style={
          isCompact
            ? {
                ...modalStyle,
                width:
                  "min(720px, calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))",
                maxHeight: "calc(100% - 32px - env(safe-area-inset-bottom, 0px))",
                height: "calc(100% - 32px - env(safe-area-inset-bottom, 0px))",
                gridTemplateRows: "48px minmax(0, 1fr) 56px",
              }
            : modalStyle
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: SPACING.m,
            padding: isCompact ? "0 4px 0 16px" : `${SPACING.xl}px ${SPACING.xl}px ${SPACING.l}px`,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <h2 style={{ margin: 0, font: `700 ${isCompact ? 17 : 22}px/1.25 ${FONTS.body}`, color: COLORS.text }}>
              {SLOT_LABELS[slot]}
            </h2>
            {!isCompact ? (
              <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>{OUTFIT_DESCRIPTIONS[slot]}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="character-creator__tile"
            aria-label="닫기"
            onClick={onClose}
            style={{
              ...tileStyle,
              marginLeft: "auto",
              width: isTouchSized ? 44 : 40,
              height: isTouchSized ? 44 : 40,
              padding: 0,
              display: "grid",
              placeItems: "center",
            }}
          >
            {ICONS.close}
          </button>
        </div>
        <div
          style={{
            padding: isCompact ? "12px 16px" : SPACING.xl,
            display: "grid",
            gap: isCompact ? SPACING.l : SPACING.xl,
            alignContent: "start",
            overflowY: "auto",
            minHeight: 0,
            overscrollBehavior: "contain",
          }}
        >
          <SettingGroup title={`${SLOT_LABELS[slot]} 종류`}>
            <div style={cardGridStyle}>
              {getSlotOptions(catalog, slot, gender).map((it) => (
                <CatalogItemCard
                  key={it.id}
                  isSelected={appearance.equipmentIds[slot] === it.id}
                  label={it.label}
                  description={it.description}
                  thumbnail={getItemThumbnail(it, gender)}
                  onClick={() =>
                    updateAppearance((v) => ({ ...v, equipmentIds: { ...v.equipmentIds, [slot]: it.id } }))
                  }
                />
              ))}
            </div>
          </SettingGroup>
          <SettingGroup
            title={`${SLOT_LABELS[slot]} 컬러`}
            aside={slot === "bottom" ? "검은 바지라 짙은 색만 또렷이 보입니다" : "원본에 색을 입힙니다"}
          >
            <ColorPicker
              slot={colorSlot}
              palette={catalog.palettes[colorSlot] ?? catalog.palettes.cloth}
              value={appearance.colors[colorSlot]}
              onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, [colorSlot]: hex } }))}
            />
          </SettingGroup>
        </div>
        <div
          style={{
            padding: isCompact ? "0 16px" : `${SPACING.l}px ${SPACING.xl}px ${SPACING.xl}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderTop: isCompact ? `1px solid ${COLORS.line}` : undefined,
          }}
        >
          <button
            type="button"
            className="character-creator__confirm-button"
            onClick={onClose}
            style={{ ...confirmButtonStyle, height: isCompact ? 44 : 46, padding: "0 32px" }}
          >
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
