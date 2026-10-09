// 외형 단계의 설정 칸 — 기본(성별·피부) · 체형 · 헤어.
import type { CSSProperties } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import {
  BODY_FIELD_GROUPS,
  BODY_FIELDS,
  getBodyFieldDefault,
  getGenderOptions,
  getSlotOptions,
  type BodyField,
  type BodyParameters,
  type DraftAppearance,
} from "./appearanceData";
import { getItemThumbnail, type CharacterCatalog } from "./catalog";
import { ColorPicker, SettingGroup, CatalogItemCard, ToggleSwitch, TileButton } from "./controls";
import { GENDER_ICONS } from "./icons";
import { COLORS, FONTS, SPACING, cardGridStyle, smallTextStyle } from "./styles";
import TickSlider from "./TickSlider";
import type { UpdateAppearance } from "./useLookHistory";

const selectedLargeTileStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.06) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.35) inset, 0 10px 30px rgba(255,255,255,0.18)",
};

interface BasicsPanelProps {
  catalog: CharacterCatalog;
  appearance: DraftAppearance;
  gender: AvatarGender;
  showUnderwear: boolean;
  onGenderChange: (gender: AvatarGender) => void;
  onShowUnderwearChange: (isOn: boolean) => void;
  updateAppearance: UpdateAppearance;
}

export function BasicsPanel({
  catalog,
  appearance,
  gender: currentGender,
  showUnderwear,
  onGenderChange,
  onShowUnderwearChange,
  updateAppearance,
}: BasicsPanelProps) {
  return (
    <>
      <SettingGroup title="성별">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.m }}>
          {getGenderOptions().map(([gender, label]) => {
            const isSelected = currentGender === gender;
            return (
              <TileButton
                key={gender}
                isSelected={isSelected}
                onClick={() => onGenderChange(gender)}
                style={{
                  padding: "20px 16px",
                  display: "grid",
                  justifyItems: "center",
                  gap: 10,
                  ...(isSelected ? selectedLargeTileStyle : null),
                }}
              >
                <span style={{ color: isSelected ? COLORS.accent : COLORS.textMuted, display: "grid" }}>
                  {GENDER_ICONS[gender]}
                </span>
                <span
                  style={{
                    font: `700 17px/1 ${FONTS.body}`,
                    color: isSelected ? "#fff" : COLORS.textMuted,
                  }}
                >
                  {label}
                </span>
              </TileButton>
            );
          })}
        </div>
      </SettingGroup>
      <SettingGroup title="피부 컬러" aside="흰색은 원본 그대로입니다">
        <ColorPicker
          slot="skin"
          palette={catalog.palettes.skin}
          value={appearance.colors.skin}
          onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, skin: hex } }))}
        />
      </SettingGroup>
      <SettingGroup title="미리보기">
        <ToggleSwitch isOn={showUnderwear} onChange={onShowUnderwearChange}>
          <span style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>속옷으로 체형 보기</span>
          <span style={smallTextStyle}>골라 둔 옷은 그대로 남습니다.</span>
        </ToggleSwitch>
      </SettingGroup>
    </>
  );
}

interface BodyPanelProps {
  gender: AvatarGender;
  body: BodyParameters;
  isWide: boolean;
  onChange: (field: BodyField, value: number, isHistoryStep: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function BodyPanel({ gender, body, isWide, onChange, onDragStart, onDragEnd }: BodyPanelProps) {
  return (
    <>
      {BODY_FIELD_GROUPS.map(([group, label]) => (
        <SettingGroup key={group} title={label}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isWide ? "1fr 1fr" : "1fr",
              gap: SPACING.m,
            }}
          >
            {BODY_FIELDS.filter((field) => field.group === group).map((field) => (
              <TickSlider
                key={field.key}
                field={field}
                gender={gender}
                value={body[field.key]}
                onChange={(value, isHistoryStep) => onChange(field, value, isHistoryStep)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onReset={() => onChange(field, getBodyFieldDefault(field, gender), true)}
              />
            ))}
          </div>
        </SettingGroup>
      ))}
    </>
  );
}

interface HairPanelProps {
  catalog: CharacterCatalog;
  appearance: DraftAppearance;
  gender: AvatarGender;
  updateAppearance: UpdateAppearance;
}

export function HairPanel({ catalog, appearance, gender, updateAppearance }: HairPanelProps) {
  return (
    <>
      <SettingGroup title="머리 모양">
        <div style={cardGridStyle}>
          {getSlotOptions(catalog, "hair", gender).map((it) => (
            <CatalogItemCard
              key={it.id}
              isSelected={appearance.hairId === it.id}
              label={it.label}
              thumbnail={getItemThumbnail(it, gender)}
              onClick={() => updateAppearance((v) => ({ ...v, hairId: it.id }))}
            />
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="헤어 컬러" aside="원본에 색을 입힙니다">
        <ColorPicker
          slot="hair"
          palette={catalog.palettes.hair}
          value={appearance.colors.hair}
          onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, hair: hex } }))}
        />
      </SettingGroup>
    </>
  );
}
