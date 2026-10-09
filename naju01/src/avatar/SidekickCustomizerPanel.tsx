// Sidekick 캐릭터 꾸미기 패널 — naju01 게임 공간과 로비 테스트(?avatar=sidekick)가 함께 쓴다.
// 외형 값·저장 열쇠·위치만 바깥에서 받고, 저장값은 normalizeSidekickConfig 로 늘 현재 형식에 맞춘다.
import { useState, type CSSProperties, type Dispatch, type SetStateAction, type SyntheticEvent } from "react";

import {
  APPEARANCE_LABELS,
  APPEARANCE_OPTIONS,
  AUTO_MOTION,
  BODY_SLIDERS,
  COLOR_FIELDS,
  GENDER_OPTIONS,
  GENDER_OUTFIT_OPTIONS,
  MOTION_OPTIONS,
  applyGender,
  normalizeSidekickConfig,
  readSidekickAppearance,
  type SidekickConfig,
  type SidekickPartKey,
} from "./sidekickOptions";

interface SidekickCustomizerPanelProps {
  config: SidekickConfig;
  setConfig: Dispatch<SetStateAction<SidekickConfig>>;
  storageKey: string;
  legacyStorageKey?: string | null;
  side?: "left" | "right";
  topOffset?: number;
}

const MOTION_VALUES = MOTION_OPTIONS.map(([value]) => value);
const OUTFIT_KEYS = ["top", "bottom"] as const;
const PART_ENTRIES = Object.entries(APPEARANCE_OPTIONS) as [
  SidekickPartKey,
  (typeof APPEARANCE_OPTIONS)[SidekickPartKey],
][];

// 게임 입력은 window 리스너라 패널 루트에서 전파를 끊으면 키·마우스가 이동·T 시작·V 시점·펀치로 새지 않는다.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

export default function SidekickCustomizerPanel({
  config,
  setConfig,
  storageKey,
  legacyStorageKey = null,
  side = "right",
  topOffset = 52,
}: SidekickCustomizerPanelProps) {
  const [saveNotice, setSaveNotice] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const position: CSSProperties = { ...panelStyle, top: topOffset, [side === "left" ? "left" : "right"]: 14 };

  // 첫 칸(자동)은 순환에서 뺀다
  const showPreviousMotion = () => {
    const index = Math.max(1, MOTION_VALUES.indexOf(config.motion));
    setConfig((old) => ({ ...old, motion: MOTION_VALUES[index <= 1 ? MOTION_VALUES.length - 1 : index - 1] }));
  };
  const showNextMotion = () => {
    const index = Math.max(0, MOTION_VALUES.indexOf(config.motion));
    setConfig((old) => ({ ...old, motion: MOTION_VALUES[index >= MOTION_VALUES.length - 1 ? 1 : index + 1] }));
  };

  const handleSave = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(normalizeSidekickConfig(config)));
      setSaveNotice("현재 외형 저장됨");
    } catch {
      setSaveNotice("저장 실패 · 브라우저 저장소를 쓸 수 없음");
    }
  };

  return (
    <div style={position} onKeyDown={stopPropagation} onKeyUp={stopPropagation} onMouseDown={stopPropagation}>
      <button type="button" style={toggleButtonStyle} onClick={() => setIsOpen((open) => !open)}>
        {isOpen ? "▾" : "▸"} 캐릭터 꾸미기 · Sidekick
      </button>
      {isOpen && (
        <div style={contentStyle}>
          <label style={rowStyle}>
            <span>동작</span>
            <select
              style={selectStyle}
              value={config.motion}
              onChange={(e) => setConfig((old) => ({ ...old, motion: e.target.value }))}
            >
              {MOTION_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div style={motionButtonRowStyle}>
            <button type="button" style={smallButtonStyle} onClick={showPreviousMotion}>
              이전
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              onClick={() => setConfig((old) => ({ ...old, motion: AUTO_MOTION }))}
            >
              자동
            </button>
            <button type="button" style={smallButtonStyle} onClick={showNextMotion}>
              다음
            </button>
          </div>
          <div style={motionHelpStyle}>
            <b>총 {MOTION_OPTIONS.length - 1}개 동작</b> · 위 목록 또는 이전/다음으로 전부 미리보기
            <br />
            <b>자동</b>: WASD 걷기 · Shift 달리기 · C 앉기 · Space 점프 · 좌클릭 펀치
            <br />
            다른 동작을 고르면 이동 상태를 무시하고 그 모션을 제자리에서 미리보기합니다. 테스트 후에는 자동으로
            돌려놓으세요.
          </div>
          <label style={rowStyle}>
            <span>걷기 자세</span>
            <select
              style={selectStyle}
              value={config.walkMotion}
              onChange={(e) => setConfig((old) => ({ ...old, walkMotion: e.target.value }))}
            >
              <option value="Walk_Loop">기본 걷기</option>
              <option value="Walk_Formal_Loop">정중한 걷기</option>
            </select>
          </label>
          <label style={rowStyle}>
            <span>달리기 자세</span>
            <select
              style={selectStyle}
              value={config.runMotion}
              onChange={(e) => setConfig((old) => ({ ...old, runMotion: e.target.value }))}
            >
              <option value="Jog_Fwd_Loop">조깅 · 안정적</option>
              <option value="Sprint_Loop">전력 질주</option>
            </select>
          </label>
          <div style={genderRowStyle}>
            {GENDER_OPTIONS.map(([gender, label]) => (
              <button
                key={gender}
                type="button"
                aria-pressed={config.gender === gender}
                style={config.gender === gender ? selectedButtonStyle : smallButtonStyle}
                onClick={() => setConfig((old) => applyGender(old, gender))}
              >
                {label} 체형
              </button>
            ))}
          </div>
          {OUTFIT_KEYS.map((key) => (
            <label key={key} style={rowStyle}>
              <span>{APPEARANCE_LABELS[key]}</span>
              <select
                style={selectStyle}
                value={config[key]}
                onChange={(e) => setConfig((old) => ({ ...old, [key]: Number(e.target.value) }))}
              >
                {GENDER_OUTFIT_OPTIONS[config.gender][key].map(([value, label]) => (
                  <option key={`${key}-${value}`} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {PART_ENTRIES.map(([key, options]) => (
            <label key={key} style={rowStyle}>
              <span>{APPEARANCE_LABELS[key]}</span>
              <select
                style={selectStyle}
                value={config[key]}
                onChange={(e) => setConfig((old) => ({ ...old, [key]: Number(e.target.value) }))}
              >
                {options.map(([value, label]) => (
                  <option key={`${key}-${value}`} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {BODY_SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key} style={sliderRowStyle}>
              <span>{label}</span>
              <input
                type="range"
                style={sliderStyle}
                min={min}
                max={max}
                step={step}
                value={config[key]}
                onChange={(e) => setConfig((old) => ({ ...old, [key]: Number(e.target.value) }))}
              />
              <output style={sliderValueStyle}>{Number(config[key]).toFixed(2)}</output>
            </label>
          ))}
          <div style={colorRowStyle}>
            {COLOR_FIELDS.map(([key, label]) => (
              <label key={key} title={label} style={colorCellStyle}>
                <span>{label}</span>
                <input
                  type="color"
                  style={colorInputStyle}
                  value={config[key]}
                  onChange={(e) => setConfig((old) => ({ ...old, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div style={saveRowStyle}>
            <button type="button" style={smallButtonStyle} onClick={handleSave}>
              외형 저장
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              onClick={() => {
                setConfig(readSidekickAppearance(storageKey, legacyStorageKey));
                setSaveNotice("저장 외형 불러옴");
              }}
            >
              불러오기
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              onClick={() => {
                setConfig(normalizeSidekickConfig(null));
                setSaveNotice("기본값 복원");
              }}
            >
              초기화
            </button>
          </div>
          {saveNotice && <div style={saveNoticeStyle}>{saveNotice}</div>}
        </div>
      )}
    </div>
  );
}

const MONO_FONT = "ui-monospace, Menlo, monospace";

const panelStyle: CSSProperties = {
  position: "absolute",
  zIndex: 60,
  width: "min(360px, calc(100vw - 28px))",
  minWidth: 0,
  maxWidth: "calc(100vw - 28px)",
  boxSizing: "border-box",
  display: "grid",
  gap: 5,
};
const toggleButtonStyle: CSSProperties = {
  position: "static",
  right: 14,
  top: 14,
  zIndex: 20,
  border: "1px solid rgba(170,190,220,.35)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "rgba(14,18,26,.72)",
  color: "#E8EFFA",
  font: `12px/1.2 ${MONO_FONT}`,
  cursor: "pointer",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
};
const genderRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
  minWidth: 0,
  gap: 4,
};
const motionButtonRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  minWidth: 0,
  gap: 4,
};
const smallButtonStyle: CSSProperties = {
  minWidth: 0,
  border: "1px solid rgba(170,190,220,.25)",
  borderRadius: 5,
  padding: "4px 6px",
  background: "rgba(14,18,26,.68)",
  color: "#DDE7F6",
  font: `11px/1.2 ${MONO_FONT}`,
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const selectedButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  background: "rgba(92,140,196,.45)",
  borderColor: "rgba(170,210,255,.7)",
  color: "#FFFFFF",
};
const contentStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  maxHeight: "calc(100dvh - 120px)",
  overflowY: "auto",
  overflowX: "hidden",
  display: "grid",
  gap: 5,
  padding: 8,
  borderRadius: 7,
  background: "rgba(14,18,26,.84)",
  border: "1px solid rgba(170,190,220,.25)",
  color: "#DDE7F6",
  font: '11px/1.3 ui-monospace, Menlo, "Malgun Gothic", monospace',
};
const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(52px, 28%) minmax(0, 1fr)",
  minWidth: 0,
  alignItems: "center",
  gap: 5,
};
const selectStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid rgba(170,190,220,.3)",
  borderRadius: 4,
  padding: "3px 4px",
  background: "#202632",
  color: "#E8EFFA",
  font: "inherit",
};
const motionHelpStyle: CSSProperties = {
  padding: "6px 7px",
  borderRadius: 5,
  background: "rgba(85,110,145,.18)",
  color: "#BECBE0",
  lineHeight: 1.45,
};
const sliderRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(44px, 22%) minmax(0, 1fr) 34px",
  minWidth: 0,
  alignItems: "center",
  gap: 5,
};
const sliderStyle: CSSProperties = { width: "100%", minWidth: 0, margin: 0 };
const sliderValueStyle: CSSProperties = { textAlign: "right", color: "#AFC0D8", fontSize: 10 };
const colorRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(52px, 1fr))",
  minWidth: 0,
  gap: 5,
};
const colorCellStyle: CSSProperties = { minWidth: 0, display: "grid", gap: 2, textAlign: "center", fontSize: 9 };
const colorInputStyle: CSSProperties = { width: "100%", minWidth: 0, height: 26, padding: 1, boxSizing: "border-box" };
const saveRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  minWidth: 0,
  gap: 4,
  marginTop: 2,
};
const saveNoticeStyle: CSSProperties = { color: "#9ED6AF", textAlign: "center", fontSize: 10 };
