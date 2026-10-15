// ── 주석·표식 켜고 끄기 (N 키, 10/13 미르) ─────────────────
//   이름표(구역·씬 요소·차단물·시점), 조사점 고리·핀, 시점 V1~V3 핀, 왜곡의 문 반원,
//   사람 자 · 격자 · 단면선을 **한 번에** 끈다. Leva 의 개별 손잡이는 그대로 두고 그 위에 건다.
//   브라우저에 기억한다. **기본은 꺼짐**(10/15 미르) — N 을 눌러 켠 적이 있을 때만 켠 상태로 시작한다.
//   옛 공간그레이박스 `표식켬` 이식. 저장 열쇠는 「왜곡.표식.v2」 — 예전 열쇠(「왜곡.표식」)에 남은 「켬」이 새 기본값을 덮지 않게 바꿨다.
//
//   쓰는 법(NajuScene):
//     const showMarkers = useMarkerToggle();
//     const controls = applyMarkerToggle(usePresentationOverrides(useNajuControls()), showMarkers);
//   → controls.showLabels · showGrid · showSections · showInvestigationPoints · showHumanScale 가 모두 AND 된다.
//     DevMarkers(시점 V1~V3 핀은 ?dev 만 보고 Leva 손잡이가 없다)는 `showMarkers && <DevMarkers …/>` 로 감싼다.
//     DistortionGates 는 showInvestigationPoints 를 타므로 저절로 따라간다.

import { useEffect, useState } from "react";

import { readStorage, writeStorage } from "@/engine/storage";

const STORAGE_KEY = "왜곡.표식.v2";
const OFF = "끔";
const ON = "켬";

/** N 키로 뒤집히는 「표식 보이기」. 입력칸에 글을 쓰는 중이거나 Ctrl/⌘ 조합이면 건드리지 않는다. */
export function useMarkerToggle(): boolean {
  const [showMarkers, setShowMarkers] = useState(() => readStorage(STORAGE_KEY) === ON);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || e.repeat || e.ctrlKey || e.metaKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement | null)?.tagName ?? "")) return;
      setShowMarkers((v) => {
        writeStorage(STORAGE_KEY, v ? OFF : ON);
        return !v;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return showMarkers;
}

/** N 키가 한꺼번에 끄는 Leva 손잡이들 */
export interface MarkerFlags {
  /** 이름표(구역·씬 요소·차단물·시점·아비사) */
  showLabels: boolean;
  showGrid: boolean;
  showSections: boolean;
  /** 조사점 고리·핀 · 왜곡의 문 반원 · 아비사 자리표 */
  showInvestigationPoints: boolean;
  /** 사람 자 */
  showHumanScale: boolean;
}

const MARKER_FLAGS: (keyof MarkerFlags)[] = [
  "showLabels",
  "showGrid",
  "showSections",
  "showInvestigationPoints",
  "showHumanScale",
];

/**
 * 표식이 꺼져 있으면 위 손잡이들을 모두 false 로 덮은 복사본을 돌려준다(켜져 있으면 그대로).
 * Leva 저장값은 안 건드린다 — 다시 N 을 누르면 각자 맞춰 둔 값이 그대로 돌아온다.
 */
export function applyMarkerToggle<T extends MarkerFlags>(controls: T, showMarkers: boolean): T {
  if (showMarkers) return controls;
  const masked = { ...controls };
  for (const key of MARKER_FLAGS) masked[key] = false as T[typeof key];
  return masked;
}
