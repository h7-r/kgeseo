// Meshy 캐릭터 꾸미기 패널(로비 ?avatar=meshy / ?avatar=chibi).
// Sidekick 패널과 같은 구성: 성별 체형 · 파츠 · 크기 슬라이더 · 색 · 동작 미리보기 · 저장/불러오기/초기화.
import { useState, type CSSProperties, type Dispatch, type SetStateAction, type SyntheticEvent } from "react";

import {
  MESH_COLOR_FIELDS,
  MESH_PART_LABELS,
  MESH_PART_OPTIONS,
  MESH_SLIDERS,
  MOTION_SOURCE_OPTIONS,
  normalizeMeshConfig,
  readMeshAppearance,
  type MeshAppearanceConfig,
  type MeshPartKey,
  type MotionSource,
} from "./meshAppearance";
import { AUTO_MOTION, MOTION_OPTIONS, type AvatarGender, type Option, type Slider } from "./sidekickOptions";
import type { ToonConfig } from "./toonMaterial";
import type { OutlineConfig } from "./toonOutline";

interface ChibiTestPanelProps {
  config: MeshAppearanceConfig;
  setConfig: Dispatch<SetStateAction<MeshAppearanceConfig>>;
  storageKey: string;
  toonConfig: ToonConfig;
  setToonConfig: Dispatch<SetStateAction<ToonConfig>>;
  outlineConfig: OutlineConfig;
  setOutlineConfig: Dispatch<SetStateAction<OutlineConfig>>;
}

const MOTION_VALUES = MOTION_OPTIONS.map(([value]) => value);
const GENDER_BUTTONS: readonly Option<AvatarGender>[] = [
  ["masculine", "남성 체형"],
  ["feminine", "여성 체형"],
];
const PART_ENTRIES = Object.entries(MESH_PART_OPTIONS) as [MeshPartKey, (typeof MESH_PART_OPTIONS)[MeshPartKey]][];
const TOON_STEPS = [2, 3] as const;
const TOON_SLIDERS: readonly Slider<"threshold" | "rimStrength" | "faceFlatten" | "hairShine">[] = [
  ["threshold", "그림자 경계", 0.25, 0.75, 0.01],
  ["rimStrength", "림 라이트", 0, 0.8, 0.01],
  ["faceFlatten", "얼굴 평탄", 0, 1, 0.05],
  ["hairShine", "머리 광택", 0, 1, 0.05],
];
const OUTLINE_SLIDERS: readonly Slider<"thickness">[] = [["thickness", "선 굵기", 0, 4, 0.1]];

// 개발 서버(뿌리 vite 설정)가 받아 기본 외형 JSON 파일로 적는다. connect 는 퍼센트 인코딩을 안 풀어서 길은 ASCII 여야 한다.
const DEFAULT_LOOK_ENDPOINT = "/__default-look";

// 게임 입력은 window 리스너라 패널 루트에서 전파를 끊으면 게임으로 새지 않는다.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

export default function ChibiTestPanel({
  config,
  setConfig,
  storageKey,
  toonConfig,
  setToonConfig,
  outlineConfig,
  setOutlineConfig,
}: ChibiTestPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [notice, setNotice] = useState("");
  // 미리보기 모션은 보정이 「자동」으로 되돌리므로 따로 실어 보낸다
  const update = (patch: Partial<MeshAppearanceConfig>) =>
    setConfig((old) => normalizeMeshConfig({ ...old, ...patch, motion: patch.motion ?? old.motion }));
  // 첫 칸(자동)을 뺀 나머지 안에서 돈다
  const stepMotion = (step: number) => {
    const index = Math.max(1, MOTION_VALUES.indexOf(config.motion));
    const count = MOTION_VALUES.length - 1;
    setConfig((old) => ({ ...old, motion: MOTION_VALUES[((index - 1 + step + count) % count) + 1] }));
  };

  const handleSave = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(normalizeMeshConfig(config)));
      setNotice("현재 외형 저장됨");
    } catch {
      setNotice("저장 실패");
    }
  };

  // 기본 모습은 화면을 보고 맞춰야 정해지는데 그 값은 localStorage 에만 있다 — 개발 서버로 보내 파일로 적는다
  const handleSaveAsDefault = async () => {
    try {
      const response = await fetch(DEFAULT_LOOK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeMeshConfig(config)),
      });
      setNotice(response.ok ? "모두의 시작 모습으로 저장됨" : "저장 실패(개발 서버 아님)");
    } catch {
      setNotice("저장 실패(개발 서버 아님)");
    }
  };

  return (
    <div style={panelStyle} onKeyDown={stopPropagation} onKeyUp={stopPropagation} onMouseDown={stopPropagation}>
      <button type="button" style={titleButtonStyle} onClick={() => setIsOpen((open) => !open)}>
        {isOpen ? "▾" : "▸"} 캐릭터 꾸미기
      </button>
      {isOpen && (
        <div style={contentStyle}>
          <div style={twoColumnStyle}>
            {GENDER_BUTTONS.map(([gender, label]) => (
              <button
                key={gender}
                type="button"
                style={config.gender === gender ? selectedButtonStyle : buttonStyle}
                onClick={() => update({ gender })}
              >
                {label}
              </button>
            ))}
          </div>
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
          <div style={threeColumnStyle}>
            <button type="button" style={buttonStyle} onClick={() => stepMotion(-1)}>
              이전
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => setConfig((old) => ({ ...old, motion: AUTO_MOTION }))}
            >
              자동
            </button>
            <button type="button" style={buttonStyle} onClick={() => stepMotion(1)}>
              다음
            </button>
          </div>
          <label style={rowStyle}>
            <span>걷기</span>
            <select
              style={selectStyle}
              value={config.walkMotion}
              onChange={(e) => update({ walkMotion: e.target.value })}
            >
              <option value="Walk_Loop">기본 걷기</option>
              <option value="Walk_Formal_Loop">정중한 걷기</option>
            </select>
          </label>
          <label style={rowStyle}>
            <span>동작 출처</span>
            <select
              style={selectStyle}
              value={config.motionSource}
              onChange={(e) => update({ motionSource: e.target.value as MotionSource })}
            >
              {MOTION_SOURCE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={rowStyle}>
            <span>달리기</span>
            <select
              style={selectStyle}
              value={config.runMotion}
              onChange={(e) => update({ runMotion: e.target.value })}
            >
              <option value="Jog_Fwd_Loop">조깅</option>
              <option value="Sprint_Loop">전력 질주</option>
            </select>
          </label>
          {PART_ENTRIES.map(([key, perGender]) => (
            <label key={key} style={rowStyle}>
              <span>{MESH_PART_LABELS[key]}</span>
              <select
                style={selectStyle}
                value={config[key]}
                onChange={(e) => update({ [key]: Number(e.target.value) })}
              >
                {perGender[config.gender].map(([value, label]) => (
                  <option key={`${key}-${value}`} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {MESH_SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key} style={sliderRowStyle}>
              <span>{label}</span>
              <input
                type="range"
                style={sliderStyle}
                min={min}
                max={max}
                step={step}
                value={config[key]}
                onChange={(e) => update({ [key]: Number(e.target.value) })}
              />
              <output style={valueStyle}>{Number(config[key]).toFixed(2)}</output>
            </label>
          ))}
          <div style={colorRowStyle}>
            {MESH_COLOR_FIELDS.map(([key, label]) => (
              <label key={key} style={colorCellStyle}>
                <span>{label}</span>
                <input
                  type="color"
                  style={colorInputStyle}
                  value={config[key]}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div style={threeColumnStyle}>
            <button type="button" style={buttonStyle} onClick={handleSave}>
              외형 저장
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setConfig(readMeshAppearance(storageKey));
                setNotice("저장 외형 불러옴");
              }}
            >
              불러오기
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setConfig(normalizeMeshConfig(null));
                setNotice("기본값 복원");
              }}
            >
              초기화
            </button>
          </div>
          {import.meta.env.DEV && (
            <button type="button" style={saveAsDefaultButtonStyle} onClick={() => void handleSaveAsDefault()}>
              이 모습을 모두의 시작 모습으로
            </button>
          )}
          <div style={dividerStyle}>화면 연출 (개발용)</div>
          <div style={twoColumnStyle}>
            <button
              type="button"
              style={toonConfig.enabled ? selectedButtonStyle : buttonStyle}
              onClick={() => setToonConfig((v) => ({ ...v, enabled: !v.enabled }))}
            >
              {toonConfig.enabled ? "애니풍 켬" : "원본 PBR"}
            </button>
            <button
              type="button"
              style={outlineConfig.enabled ? selectedButtonStyle : buttonStyle}
              onClick={() => setOutlineConfig((v) => ({ ...v, enabled: !v.enabled }))}
            >
              {outlineConfig.enabled ? "외곽선 켬" : "외곽선 끔"}
            </button>
          </div>
          <div style={twoColumnStyle}>
            {TOON_STEPS.map((steps) => (
              <button
                key={steps}
                type="button"
                style={toonConfig.steps === steps ? selectedButtonStyle : buttonStyle}
                onClick={() => setToonConfig((v) => ({ ...v, steps }))}
              >
                명암 {steps}단계
              </button>
            ))}
          </div>
          {TOON_SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key} style={sliderRowStyle}>
              <span>{label}</span>
              <input
                type="range"
                style={sliderStyle}
                min={min}
                max={max}
                step={step}
                value={toonConfig[key]}
                onChange={(e) => setToonConfig((v) => ({ ...v, [key]: Number(e.target.value) }))}
              />
              <output style={valueStyle}>{Number(toonConfig[key]).toFixed(2)}</output>
            </label>
          ))}
          {OUTLINE_SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key} style={sliderRowStyle}>
              <span>{label}</span>
              <input
                type="range"
                style={sliderStyle}
                min={min}
                max={max}
                step={step}
                value={outlineConfig[key]}
                onChange={(e) => setOutlineConfig((v) => ({ ...v, [key]: Number(e.target.value) }))}
              />
              <output style={valueStyle}>{Number(outlineConfig[key]).toFixed(2)}</output>
            </label>
          ))}
          {notice && <div style={noticeStyle}>{notice}</div>}
          <div style={helpStyle}>
            색은 원본 질감 위에 곱해진다(흰색 = 원본 그대로).
            <br />V 시점 · T 조작 시작 · ESC 패널 조작 · WASD/Shift/C/Space · 좌클릭 펀치
          </div>
        </div>
      )}
    </div>
  );
}

const FONT = '11px/1.35 ui-monospace, Menlo, "Malgun Gothic", monospace';
const panelStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  top: 14,
  zIndex: 60,
  width: "min(320px, calc(100vw - 28px))",
  boxSizing: "border-box",
  display: "grid",
  gap: 5,
  color: "#DDE7F6",
  font: FONT,
};
const buttonStyle: CSSProperties = {
  minWidth: 0,
  border: "1px solid rgba(170,190,220,.25)",
  borderRadius: 5,
  padding: "4px 6px",
  background: "rgba(14,18,26,.68)",
  color: "#DDE7F6",
  font: FONT,
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const saveAsDefaultButtonStyle: CSSProperties = { ...buttonStyle, width: "100%", marginTop: 6 };
const titleButtonStyle: CSSProperties = {
  ...buttonStyle,
  textAlign: "left",
  padding: "6px 9px",
  background: "rgba(14,18,26,.84)",
  fontWeight: 700,
};
const selectedButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "rgba(92,140,196,.45)",
  borderColor: "rgba(170,210,255,.7)",
  color: "#FFFFFF",
};
const contentStyle: CSSProperties = {
  display: "grid",
  gap: 5,
  padding: 8,
  borderRadius: 7,
  background: "rgba(14,18,26,.86)",
  border: "1px solid rgba(170,190,220,.25)",
  maxHeight: "calc(100dvh - 90px)",
  overflowY: "auto",
  overflowX: "hidden",
};
const twoColumnStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 };
const threeColumnStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 };
const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(44px, 26%) minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
};
const sliderRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(44px, 24%) minmax(0, 1fr) 34px",
  alignItems: "center",
  gap: 6,
};
const sliderStyle: CSSProperties = { width: "100%", minWidth: 0, margin: 0 };
const valueStyle: CSSProperties = { textAlign: "right", color: "#AFC0D8", fontSize: 10 };
const selectStyle: CSSProperties = {
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid rgba(170,190,220,.3)",
  borderRadius: 4,
  padding: "3px 4px",
  background: "#202632",
  color: "#E8EFFA",
  font: FONT,
};
const colorRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(46px, 1fr))",
  gap: 5,
};
const colorCellStyle: CSSProperties = { minWidth: 0, display: "grid", gap: 2, textAlign: "center", fontSize: 9 };
const colorInputStyle: CSSProperties = { width: "100%", minWidth: 0, height: 24, padding: 1, boxSizing: "border-box" };
const dividerStyle: CSSProperties = {
  marginTop: 4,
  paddingTop: 5,
  borderTop: "1px solid rgba(170,190,220,.22)",
  color: "#AFC0D8",
  fontSize: 10,
};
const noticeStyle: CSSProperties = { color: "#9ED6AF", textAlign: "center", fontSize: 10 };
const helpStyle: CSSProperties = { color: "#AFC0D8", fontSize: 10 };
