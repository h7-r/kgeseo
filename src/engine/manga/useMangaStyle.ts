import { useEffect, useMemo } from "react";

import { useSavedControls } from "@/engine/leva/savedControls";
import { setToonRamp, type ToonRampStyle } from "@/engine/toon";

import type { MangaEffectOptions } from "./mangaEffect";
import { highKeyUniforms, paintedUniforms } from "./paintedToon";
import type { FlattenSettings } from "./textureFlatten";

const RAMP_OPTIONS: Record<string, ToonRampStyle> = { 나주실내: "najuIndoor", 나주: "naju", 원래: "classic" };

export interface MangaStyle {
  effect: MangaEffectOptions;
  /** 껍데기 외곽선·주름선을 감추고 깊이 선 하나로 */
  hideShellLines: boolean;
  /** 텍스처 잔결 펴기. null 이면 원래 텍스처 */
  flatten: FlattenSettings | null;
  /** 팔레트·밝은 조를 입힐 구역과 팔레트. null 이면 색은 원래대로 */
  /** 팔레트·밝은 조를 입힐지 — 어느 구역에 입힐지는 게임이 정한다(app/MangaScene) */
  paletteOn: boolean;
}

const SCREEN_SATURATION = 0.95;

// 색 고르개의 16진수를 곱하는 숫자 그대로 읽는다(#e6e3f2 → 0.90, 0.89, 0.95)
const hexToFactors = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * 「화풍(만화)」·「화풍(재질)」 — 나주맵 만화 v3 를 본편 씬(복도·본부실·승강장·기차 안)에 얹는 층.
 * 팀이 맞춘 빛·자리·선 값은 건드리지 않고 새 열쇠만 더한다. 켜기를 끄거나 ?만화=off 면 원래 화면이다.
 * 실내 기본값이 나주와 다른 것: 밝기(나주 0.86)·그늘차가움(나주 1) — 폐역은 화면 대부분이 어두워 나주 값이면 가라앉고 푸르게 뜬다.
 * 안개는 더하지 않는다 — 건물 안이다.
 */
export function useMangaStyle(enabled: boolean): MangaStyle | null {
  const look = useSavedControls("화풍(만화)", {
    on: { value: true, label: "켜기" },
    lineStrength: { value: 0.9, min: 0, max: 1, step: 0.05, label: "선진하기" },
    lineWidth: { value: 1.5, min: 0.5, max: 4, step: 0.25, label: "선굵기" },
    // 손으로 그은 펜선 — 선 자리·굵기를 세계에 붙은 잡음으로 흔든다(걸어도 선이 기어 다니지 않는다)
    lineWobble: { value: 2, min: 0, max: 4, step: 0.1, label: "선손떨림" },
    creaseFar: { value: 60, min: 5, max: 200, step: 1, label: "모서리선거리" },
    edgeFar: { value: 300, min: 20, max: 400, step: 5, label: "윤곽선거리" },
    ink: { value: "#473d3d", label: "선색" },
    grade: { value: 1, min: 0, max: 1, step: 0.05, label: "색보정" },
    exposure: { value: 1, min: 0.6, max: 1.2, step: 0.01, label: "보정밝기" },
    cool: { value: 0.35, min: 0, max: 1, step: 0.05, label: "그늘차가움" },
    // 열쇠 이름을 바꿨다 — 앞 판의 저장값(0.6·0.3)이 새 기본값을 덮지 않게
    midLift: { value: 0.15, min: 0, max: 1, step: 0.05, label: "중간밝기" },
  });
  const paint = useSavedControls("화풍(재질)", {
    paint: { value: true, label: "칠한툰" },
    // 열쇠 이름을 바꿨다 — 앞 판의 저장값(나주)이 새 기본값을 덮지 않게
    shadeRamp: { value: "najuIndoor", options: RAMP_OPTIONS, label: "명암계단" },
    detail: { value: 0.3, min: 0, max: 1, step: 0.05, label: "잔결남김" },
    flatten: { value: 4, min: 1, max: 7, step: 0.5, label: "펴는넓이" },
    soft: { value: 0.22, min: 0, max: 0.6, step: 0.02, label: "칠한기울기" },
    bands: { value: 4, min: 0, max: 10, step: 1, label: "빛계단" },
    // 그림 느낌 — 넓은 면의 붓 얼룩(세계 좌표) + 화면에 고정된 옅은 종이결. 필터가 아니라 살짝
    paintFeel: { value: 0.5, min: 0, max: 1, step: 0.05, label: "그림느낌" },
    lightNeutral: { value: 0.8, min: 0, max: 1, step: 0.05, label: "빛중성" },
    shadow: { value: "#e6e3f2", label: "그림자색" },
    unifyLines: { value: true, label: "펜선하나로" },
  });
  // 「사실색」 팔레트(engine/manga/palette)와 밝은 조. 전체에 노란 기운을 씌우지 않는다 — 빛은 중성
  const tones = useSavedControls("화풍(팔레트)", {
    on: { value: true, label: "켜기" },
    // 열쇠 이름을 바꿨다 — 앞 판의 저장값(0.5)이 새 기본값을 덮지 않게. 그늘이 더 떠야 등 줄무늬 그림자가 덜 튄다
    shadowLevel: { value: 0.62, min: 0.2, max: 0.9, step: 0.02, label: "그림자밝기" },
    keyRef: { value: 1.3, min: 0.3, max: 3, step: 0.05, label: "기준빛" },
    // 열쇠 이름을 바꿨다 — 앞 판의 저장값(0.1)이 새 기본값을 덮지 않게. 켠 스탠드의 빛 웅덩이가 보여야 켬/끔이 갈린다
    lampPool: { value: 0.35, min: 0, max: 1, step: 0.05, label: "빛웅덩이" },
  });
  const isOn = enabled && look.on;
  const isPainted = isOn && paint.paint;
  // 저장값이 옛 이름이면 기본 계단으로
  const ramp = Object.values(RAMP_OPTIONS).find((style) => style === paint.shadeRamp) ?? "najuIndoor";

  // 명암 계단은 후처리와 따로 산다 — 후처리를 끈 실행(?fx=off)에서도 같은 툰이 보이게
  useEffect(() => {
    setToonRamp(isOn ? ramp : "classic", isPainted ? paint.soft : 0);
  }, [isOn, isPainted, ramp, paint.soft]);

  const isHighKey = isPainted && tones.on;
  useEffect(() => {
    highKeyUniforms.uKeyFloor.value = tones.shadowLevel;
    highKeyUniforms.uKeyRef.value = tones.keyRef;
    highKeyUniforms.uKeyTop.value = tones.lampPool;
  }, [tones.shadowLevel, tones.keyRef, tones.lampPool]);

  // 화면 채도 — 회색으로 누르지 않는다(실내라 또렷하게, 사탕 같지 않게)
  const saturation = isHighKey ? SCREEN_SATURATION : 1;

  // 유니폼 값만 바꾼다 — 재질 수백 개가 다시 컴파일되지 않는다
  useEffect(() => {
    paintedUniforms.uMangaPaint.value = isPainted ? 1 : 0;
    paintedUniforms.uMangaBands.value = paint.bands;
    paintedUniforms.uMangaBrush.value = isPainted ? paint.paintFeel * 0.08 : 0;
    paintedUniforms.uMangaNeutral.value = isPainted ? paint.lightNeutral : 0;
    paintedUniforms.uMangaAmbient.value.set(...hexToFactors(paint.shadow));
  }, [isPainted, paint.bands, paint.shadow, paint.paintFeel, paint.lightNeutral]);

  const { lineStrength, lineWidth, lineWobble, creaseFar, edgeFar, ink, grade, exposure, cool, midLift: lift } = look;
  const hideShellLines = isOn && paint.unifyLines;
  const paper = isPainted ? paint.paintFeel * 0.035 : 0;
  const flatten = useMemo<FlattenSettings | null>(
    () => (isPainted ? { detail: paint.detail, lod: paint.flatten, hand: Math.min(1, paint.paintFeel * 1.6) } : null),
    [isPainted, paint.detail, paint.flatten, paint.paintFeel],
  );
  return useMemo(
    () =>
      isOn
        ? {
            effect: {
              strength: lineStrength,
              width: lineWidth,
              wobble: lineWobble,
              creaseFar,
              edgeFar,
              ink,
              grade,
              exposure,
              cool,
              saturation,
              lift,
              paper,
            },
            hideShellLines,
            flatten,
            paletteOn: isHighKey,
          }
        : null,
    [
      isOn,
      lineStrength,
      lineWidth,
      lineWobble,
      creaseFar,
      edgeFar,
      ink,
      grade,
      exposure,
      cool,
      saturation,
      lift,
      paper,
      hideShellLines,
      flatten,
      isHighKey,
    ],
  );
}
