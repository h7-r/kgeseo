import type { SafeArea } from "./CharacterPreview";
import { ZERO_INSETS, type SafeInsets } from "./compactLayout";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ScreenLayout = ReturnType<typeof measureScreenLayout>;

/** 손가락 기기 가로에서 이 높이 미만이면 휴대폰 배치(세 칸) */
export const COMPACT_MAX_HEIGHT = 800;

// 패널과 그 안 무대 칸의 자리. 카메라가 피할 안전영역은 무대 칸 바깥 전부 — 캐릭터가 늘 무대 칸 한가운데 선다.
// 수치는 4/8/16/24/32/48 배수(패널 안쪽 여백 32 · 머리 104 · 발치 84).
export function measureScreenLayout(
  width: number,
  height: number,
  insets: SafeInsets = ZERO_INSETS,
  isTouchDevice = false,
) {
  // 손가락 기기의 짧은 가로 화면 — 세로 탭 | 미리보기 | 설정 세 칸(아래 measureCompactLayout). 설정 칸이 화면 높이를 다 쓴다.
  // 휴대폰 가로(높이 360~430)뿐 아니라 키 작은 태블릿 가로도 여기로 — 아이패드 미니 6 사파리(1133×634~670) · 7인치 안드로이드
  // (1024×520~600)는 PC 두 칸 배치에서 설정 스크롤 칸이 48~156px 로 줄어 이름 칸 아래(안내 · 중복확인 결과)가 잘렸다(11/8 미르).
  // 두 칸 배치는 머리 104 · 아래 줄 84 · 탭 · 카드 머리에 약 460px 를 쓴다. 세 칸이면 설정 칸이 화면 높이를 거의 다 써서
  // 미니 가로 1133×634 기준 396 → 618px(코덱스 20회차 권장 — 높이 800 미만, 아이패드 10세대 · 프로 11 사파리 막대 상태도 포함).
  // PC 는 창 높이가 낮아도 이 배치로 바꾸지 않는다(11/8 해랑 검토 — 화면 크기가 아니라 기기로 고른다)
  const isCompact = isTouchDevice && height < COMPACT_MAX_HEIGHT && width >= height;
  if (isCompact) return measureCompactLayout(width, height, insets);
  // 가로로 넓은 태블릿(1024×768 등)은 위아래로 쌓으면 설정 칸이 109px 로 줄었다 — 손가락 기기 · 폭 900 이상 가로면 두 칸(코덱스 14c).
  // PC 는 예전 그대로(폭 1100 · 높이 640 미만이면 위아래로)
  const isNarrow = (width < 1100 || height < 640) && !(isTouchDevice && width >= height && width >= 900);
  const margin = isCompact ? 4 : isNarrow ? 8 : Math.max(24, Math.round(Math.min(width * 0.035, height * 0.04)));
  const panelWidth = Math.min(1560, width - margin * 2);
  const panelHeight = Math.min(960, height - margin * 2);
  const left = Math.round((width - panelWidth) / 2);
  const top = Math.round((height - panelHeight) / 2);
  const padding = isCompact ? 10 : isNarrow ? 16 : 32;
  const header = isCompact ? 40 : isNarrow ? 76 : 104; // 제목 + 심장선
  const footer = isCompact ? 56 : isNarrow ? 72 : 84; // 아래 단추 줄
  const bodyTop = top + header;
  const bodyHeight = panelHeight - header - footer;
  // 넓으면 무대 | 설정 두 칸, 좁으면 무대 위 · 설정 아래
  const stage: Rect = isNarrow
    ? { x: left + padding, y: bodyTop, w: panelWidth - padding * 2, h: Math.round(bodyHeight * 0.42) }
    : {
        x: left + padding,
        y: bodyTop,
        w: Math.round((panelWidth - padding * 2) * (isCompact ? 0.4 : 0.43)),
        h: bodyHeight,
      };
  const columnGap = isCompact ? 12 : 32;
  const settings: Rect = isNarrow
    ? { x: left + padding, y: stage.y + stage.h + 12, w: panelWidth - padding * 2, h: bodyHeight - stage.h - 12 }
    : {
        x: stage.x + stage.w + columnGap,
        y: bodyTop,
        w: panelWidth - padding * 2 - stage.w - columnGap,
        h: bodyHeight,
      };
  const viewBar = isCompact ? 44 : 56; // 무대 칸 아래 보기 전환 줄
  const safeArea: SafeArea = {
    left: stage.x + 16,
    right: width - (stage.x + stage.w) + 16,
    top: stage.y + 12,
    bottom: height - (stage.y + stage.h) + viewBar + 8,
  };
  return {
    isCompact,
    isNarrow,
    panel: { x: left, y: top, w: panelWidth, h: panelHeight },
    padding,
    header,
    footer,
    stage,
    settings,
    viewBar,
    safeArea,
    // 휴대폰 가로 전용 칸 — 넓은 화면에서는 없다
    rail: null as Rect | null,
    toolbar: null as Rect | null,
    actionBar: null as Rect | null,
  };
}

/**
 * 휴대폰 가로(높이 375~430) — 세로 탭(rail) | 미리보기 칸 | 설정 칸(코덱스 14회차 권장안).
 * 예전에는 제목 · 가로 탭 · 카드 머리 · 「다음」 줄 · 아래 단추 줄이 모두 설정 칸 높이를 깎아 852×393 에서 실제 조작이 14px 만 보였다.
 *   · 제목 · 닫기를 없앤다(아래 「뒤로」와 같은 일) · 탭은 왼쪽 세로 줄 · 뒤로/되돌리기는 미리보기 위 · 다음/시작은 미리보기 아래
 *   · 설정 칸은 화면 높이를 다 쓴다(머리 44 + 스크롤). 852×393 에서 약 325px
 *   · 노치 · 홈 막대(안전 영역) 안쪽에만 놓는다
 */
function measureCompactLayout(width: number, height: number, insets: SafeInsets) {
  const margin = 8;
  const gap = 8;
  const left = insets.left + margin;
  const right = width - insets.right - margin;
  const top = insets.top + margin;
  const bottom = height - insets.bottom - margin;
  const panel: Rect = { x: left, y: top, w: right - left, h: bottom - top };
  const railWidth = 60;
  const rail: Rect = { x: left, y: top, w: railWidth, h: panel.h };
  const remaining = panel.w - railWidth - gap * 2;
  const stageWidth = Math.round(Math.min(320, Math.max(200, remaining * 0.38)));
  const columnX = rail.x + railWidth + gap;
  const toolbarHeight = 44;
  const actionHeight = 48;
  const toolbar: Rect = { x: columnX, y: top, w: stageWidth, h: toolbarHeight };
  const actionBar: Rect = { x: columnX, y: bottom - actionHeight, w: stageWidth, h: actionHeight };
  const stage: Rect = {
    x: columnX,
    y: top + toolbarHeight + gap,
    w: stageWidth,
    h: panel.h - toolbarHeight - actionHeight - gap * 2,
  };
  const settingsX = columnX + stageWidth + gap;
  const settings: Rect = { x: settingsX, y: top, w: right - settingsX, h: panel.h };
  const viewBar = 52; // 보기 전환(44) + 위아래 4
  const safeArea: SafeArea = {
    left: stage.x + 8,
    right: width - (stage.x + stage.w) + 8,
    top: stage.y + 8,
    bottom: height - (stage.y + stage.h) + viewBar + 4,
  };
  return {
    isCompact: true,
    isNarrow: false,
    panel,
    padding: 0,
    header: 0,
    footer: 0,
    stage,
    settings,
    viewBar,
    safeArea,
    rail: rail as Rect | null,
    toolbar: toolbar as Rect | null,
    actionBar: actionBar as Rect | null,
  };
}
