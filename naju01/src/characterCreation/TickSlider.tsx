import { useId, useMemo, type CSSProperties } from "react";

import type { AvatarGender } from "../avatar/sidekickOptions";
import { computeNearestTickIndex, computeTickValues, type BodyField, type BodyFieldKey } from "./appearanceData";
import { COLORS, FONTS, SPACING, smallTextStyle, tileStyle } from "./styles";

// 「아주 작게 · 작게 · 기본」 대신 와닿는 말로. 다섯 칸은 computeTickValues 순서와 같다(기본이 한쪽 끝인 항목은 첫 칸이 기본).
// cm 는 기본 키를 170cm 로 본 안내값이다.
const TICK_LABELS: Record<BodyFieldKey, readonly string[]> = {
  heightScale: ["150cm 이하", "160cm", "170cm", "180cm", "190cm 이상"],
  headScale: ["보통", "조금 큼", "큼", "많이 큼", "아주 큼"],
  handScale: ["아주 작은 손", "작은 손", "보통", "큰 손", "아주 큰 손"],
  footScale: ["230mm 이하", "245mm", "260mm", "275mm", "290mm 이상"],
  shoulderWidth: ["좁은 어깨", "조금 좁음", "보통", "조금 넓음", "넓은 어깨"],
  hipWidth: ["좁은 골반", "조금 좁음", "보통", "조금 넓음", "넓은 골반"],
  armLength: ["짧은 팔", "조금 짧음", "보통", "조금 긺", "긴 팔"],
  legLength: ["짧은 다리", "조금 짧음", "보통", "조금 긺", "긴 다리"],
  armThickness: ["아주 가늚", "가늚", "보통", "굵음", "아주 굵음"],
  legThickness: ["아주 가늚", "가늚", "보통", "굵음", "아주 굵음"],
  build: ["마름", "슬림", "보통", "통통", "풍채 있음"],
  buff: ["보통", "조금 탄탄", "탄탄", "근육질", "아주 근육질"],
};

const sliderCardStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: "14px 16px 12px",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.025)",
};
const valueBadgeStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.10)",
  color: "#FFFFFF",
  font: `600 12.5px/1 ${FONTS.body}`,
};
const stepButtonStyle: CSSProperties = {
  ...tileStyle,
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  display: "grid",
  placeItems: "center",
  font: `500 13px/1 ${FONTS.body}`,
};

interface TickSliderProps {
  field: BodyField;
  value: number;
  gender: AvatarGender;
  onChange: (value: number, isHistoryStep: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onReset: () => void;
}

// 슬라이더 값은 칸 번호(0~4)이고 바깥으로 나가는 값은 그 칸이 가리키는 실수다 — 초안·렌더러는 실수만 본다.
export default function TickSlider({
  field,
  value,
  gender,
  onChange,
  onDragStart,
  onDragEnd,
  onReset,
}: TickSliderProps) {
  const sliderId = useId();
  const ticks = useMemo(() => computeTickValues(field, gender), [field, gender]);
  const tickIndex = computeNearestTickIndex(ticks, value);
  const getTickLabel = (i: number) => TICK_LABELS[field.key]?.[i] ?? ticks[i]?.label ?? "";
  const currentLabel = getTickLabel(tickIndex);
  const moveToTick = (next: number, isHistoryStep: boolean) => {
    const i = Math.max(0, Math.min(ticks.length - 1, next));
    onChange(ticks[i].value, isHistoryStep);
  };
  return (
    <div className="tick-slider" style={sliderCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACING.s }}>
        <label htmlFor={sliderId} style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>
          {field.label}
        </label>
        <output htmlFor={sliderId} style={{ marginLeft: "auto", ...valueBadgeStyle }}>
          {currentLabel}
        </output>
        <span className="tick-slider__step-buttons" style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            aria-label={`${field.label} 한 칸 줄이기`}
            style={stepButtonStyle}
            onClick={() => moveToTick(tickIndex - 1, true)}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`${field.label} 한 칸 늘리기`}
            style={stepButtonStyle}
            onClick={() => moveToTick(tickIndex + 1, true)}
          >
            ＋
          </button>
          <button type="button" aria-label={`${field.label} 초기화`} style={stepButtonStyle} onClick={onReset}>
            ↺
          </button>
        </span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={0}
        max={ticks.length - 1}
        step={1}
        value={tickIndex}
        // 읽어 주는 값도 화면에 보이는 칸 이름이다
        aria-valuetext={currentLabel}
        list={`${sliderId}-ticks`}
        onPointerDown={onDragStart}
        onKeyDown={onDragStart}
        onChange={(e) => moveToTick(Number(e.target.value), false)}
        onPointerUp={onDragEnd}
        onKeyUp={onDragEnd}
        onBlur={onDragEnd}
      />
      <datalist id={`${sliderId}-ticks`}>
        {ticks.map((tick, i) => (
          <option key={tick.label} value={i} label={tick.label} />
        ))}
      </datalist>
      {/* 양 끝 말 — 어느 쪽으로 밀면 무엇이 되나가 손대기 전에 읽힌다 */}
      <div style={{ display: "flex", justifyContent: "space-between", ...smallTextStyle }}>
        <span>{getTickLabel(0)}</span>
        <span>{getTickLabel(ticks.length - 1)}</span>
      </div>
    </div>
  );
}
