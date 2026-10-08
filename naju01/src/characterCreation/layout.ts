import type { SafeArea } from "./CharacterPreview";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ScreenLayout = ReturnType<typeof measureLayout>;

// 패널과 그 안 무대 칸의 자리. 카메라가 피할 안전영역은 무대 칸 바깥 전부 — 캐릭터가 늘 무대 칸 한가운데 선다.
// 수치는 4/8/16/24/32/48 배수(패널 안쪽 여백 32 · 머리 104 · 발치 84).
export function measureLayout(width: number, height: number) {
  const isNarrow = width < 1100 || height < 640;
  const margin = isNarrow ? 8 : Math.max(24, Math.round(Math.min(width * 0.035, height * 0.04)));
  const panelWidth = Math.min(1560, width - margin * 2);
  const panelHeight = Math.min(960, height - margin * 2);
  const left = Math.round((width - panelWidth) / 2);
  const top = Math.round((height - panelHeight) / 2);
  const padding = isNarrow ? 16 : 32;
  const header = isNarrow ? 76 : 104; // 제목 + 심장선
  const footer = isNarrow ? 72 : 84; // 아래 단추 줄
  const bodyTop = top + header;
  const bodyHeight = panelHeight - header - footer;
  // 넓으면 무대 | 설정 두 칸, 좁으면 무대 위 · 설정 아래
  const stage: Rect = isNarrow
    ? { x: left + padding, y: bodyTop, w: panelWidth - padding * 2, h: Math.round(bodyHeight * 0.42) }
    : { x: left + padding, y: bodyTop, w: Math.round((panelWidth - padding * 2) * 0.43), h: bodyHeight };
  const settings: Rect = isNarrow
    ? { x: left + padding, y: stage.y + stage.h + 12, w: panelWidth - padding * 2, h: bodyHeight - stage.h - 12 }
    : { x: stage.x + stage.w + 32, y: bodyTop, w: panelWidth - padding * 2 - stage.w - 32, h: bodyHeight };
  const viewBar = 56; // 무대 칸 아래 보기 전환 줄
  const safeArea: SafeArea = {
    left: stage.x + 16,
    right: width - (stage.x + stage.w) + 16,
    top: stage.y + 12,
    bottom: height - (stage.y + stage.h) + viewBar + 8,
  };
  return {
    isNarrow,
    panel: { x: left, y: top, w: panelWidth, h: panelHeight },
    padding,
    header,
    footer,
    stage,
    settings,
    viewBar,
    safeArea,
  };
}
