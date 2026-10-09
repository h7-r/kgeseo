/**
 * 발표용 프리셋 — 주소 스위치(?present · ?mood)로 Leva 값을 덮는다.
 * Leva 기본값을 고치지 않는 까닭: 저장값이 기본값을 이겨서 발표장 노트북에 무엇이 남아 있을지 모른다.
 * 스위치는 저장값 위에 얹혀 어느 브라우저에서나 같은 화면이 나오고, 떼면 원래 화면이다.
 */
import { useMemo } from "react";

import type { NajuControls } from "../scene/useNajuControls";
import { IS_LIGHT_PRESENTATION, PRESENTATION_MODE, PRESENTATION_MOOD } from "./runtimeFlags";

/** Leva 에 없는 값 — 프리셋만 바꾼다. 기본값이 곧 원래 화면이다. */
interface PresentationExtras {
  sunColor: string;
  // 물가에 서면 화면 절반이 물이라 픽셀마다 그림자맵 9 탭(PCF)이 물결 계산보다 비싸다
  waterReceivesShadow: boolean;
}

export type PresentedControls = NajuControls & PresentationExtras;

type Preset = Partial<PresentedControls>;

const EXTRA_DEFAULTS: PresentationExtras = { sunColor: "#ffffff", waterReceivesShadow: true };

// 도면 대조용 겹침을 끈다. drei <Html> 라벨은 하나마다 매 프레임 DOM 을 옮긴다.
const DEFAULT_PRESET: Preset = {
  showLabels: false,
  showGrid: false,
  showInvestigationPoints: false,
  showSections: false,
};

// 원경은 멀어서 밀도를 줄여도 허허벌판이 되지 않는다(1000 m² 에 한 그루 = 320 그루가 허허벌판이었다).
const LIGHT_PRESET: Preset = {
  forestCount: 420,
  hillTreeCount: 300,
  hillShrubCount: 600,
  cliffShrubCount: 220,
  cliffTreeCount: 18,
  cloudCount: 14,
  bankStoneCount: 70,
  screeCount: 80,
  // 18 m — 그림자 카메라가 사람을 따라다녀 걸으며 보이는 그림자는 그대로 덮인다
  shadowRange: 60,
  waterReceivesShadow: false,
};

// 비상용. 바닥결 0 이면 삼면결 셰이더를 아예 안 건다(땅이 단색이 된다). 그림자는 툰 화풍의 뼈대라 남긴다.
const MINIMAL_PRESET: Preset = {
  groundGrain: 0,
  waterRipple: 0,
  forestCount: 300,
  hillTreeCount: 220,
  hillShrubCount: 420,
  cliffShrubCount: 160,
};

// 로비가 만화처럼 보이는 건 어두운 바탕 + 주광 하나 덕이다. 하늘돔은 낮 색으로 구워져 있어 끄고 하늘색 단색을 쓴다.
const EVENING_PRESET: Preset = {
  skyColor: "#3B4557",
  hemisphereSkyColor: "#6F86A6",
  hemisphereGroundColor: "#5C4B3B",
  ambientIntensity: 0.16,
  hemisphereIntensity: 0.26,
  sunIntensity: 2.4,
  sunColor: "#FFC993",
  sunAzimuth: 250,
  sunElevation: 16,
  fogNear: 35,
  fogFar: 420,
  skyDome: false,
  cloudCount: 0,
};

const NIGHT_PRESET: Preset = {
  skyColor: "#1C2230",
  hemisphereSkyColor: "#3E5070",
  hemisphereGroundColor: "#2E2A28",
  ambientIntensity: 0.1,
  hemisphereIntensity: 0.18,
  sunIntensity: 1.4,
  sunColor: "#B9CBE8",
  sunAzimuth: 300,
  sunElevation: 40,
  fogNear: 25,
  fogFar: 260,
  skyDome: false,
  cloudCount: 0,
};

const OVERRIDES: Preset = {
  ...(PRESENTATION_MODE ? DEFAULT_PRESET : null),
  ...(IS_LIGHT_PRESENTATION ? LIGHT_PRESET : null),
  ...(PRESENTATION_MODE === "minimal" ? MINIMAL_PRESET : null),
  ...(PRESENTATION_MOOD === "evening" ? EVENING_PRESET : null),
  ...(PRESENTATION_MOOD === "night" ? NIGHT_PRESET : null),
};

if (Object.keys(OVERRIDES).length > 0) {
  console.log(
    `%c[발표] 프리셋 켬 — present: ${PRESENTATION_MODE ?? "없음"} · mood: ${PRESENTATION_MOOD ?? "없음"} · ` +
      `${Object.keys(OVERRIDES).length} 개 값 덮음`,
    "color:#F2C879;font-weight:bold",
  );
}

/** Leva 값 위에 프리셋을 얹는다. 스위치가 없으면 Leva 값 + 원래 화면의 기본값 그대로다. */
export function usePresentationOverrides(controls: NajuControls): PresentedControls {
  return useMemo(() => ({ ...EXTRA_DEFAULTS, ...controls, ...OVERRIDES }), [controls]);
}
