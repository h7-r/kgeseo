// 캐릭터 생성 화면 — 외형을 정하고 이름을 붙여 바깥으로 넘긴다.
//
// 배경층 웹사이트 그림(수사 책상)을 흐리고 어둡게 · 3D층 투명 캔버스(무대 칸 안에만 캐릭터를 담는다) ·
// 패널 가운데 큰 창 하나(제목 · 심장박동 선 · 무대 | 설정 · 아래 단추 줄). 모든 조작은 테두리 있는 칸 안에 있고
// 순서는 01~05 단계 탭이 말해 준다.
//   ‹ 뒤로 → onCancel(부모가 웹사이트로 돌려보낸다)
//   확인 · 게임 시작 → 이름 확인이 끝났으면 onComplete, 아직이면 이름 탭으로 데려간다
// 이 화면은 외형 편집·미리보기·이름 입력·완료 데이터 만들기까지만 한다. 로그인·라우팅·API·저장은 부모 몫이다.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AvatarGender, Option } from "../avatar/sidekickOptions";
import {
  BODY_FIELD_GROUPS,
  BODY_FIELDS,
  bodyFieldDefault,
  createDefaultDraft,
  defaultBodyParameters,
  genderOptions,
  matchGender,
  nearestTick,
  normalizeDraft,
  outfitSummary,
  slotOptions,
  tickValues,
  toCompletedCharacter,
  toRendererConfig,
  type BodyField,
  type BodyFieldKey,
  type CharacterDraft,
  type CompletedCharacter,
  type CompleteResult,
  type DraftAppearance,
  type DraftColors,
} from "./appearanceData";
import {
  COLOR_SLOT_LABELS,
  DEFAULT_CATALOG,
  SLOT_LABELS,
  THUMBNAIL_DIR,
  pickThumbnail,
  type CharacterCatalog,
  type ColorSlot,
} from "./catalog";
import CharacterPreview, { type PreviewControls, type SafeArea } from "./CharacterPreview";
import HeartbeatLine from "./HeartbeatLine";
import {
  DEFAULT_NAME_RULES,
  countCharacters,
  normalizeName,
  normalizeNameRules,
  validateNameFormat,
  type CheckName,
} from "./nameRules";
import { PREVIEW_VIEWS, type PreviewQuality, type PreviewView } from "./previewViews";
import { COLORS as BASE_COLORS, FONTS, HEARTBEAT_LINE_CSS, MOTION, SCREEN_CSS, SPACING } from "./styles";

export interface CharacterCreationScreenProps {
  /** 이어 만들 초안(믿지 않고 보정한다) */
  initialValue?: unknown;
  catalog?: CharacterCatalog | null;
  nameRules?: unknown;
  checkName?: CheckName | null;
  onDraftChange?: ((draft: CharacterDraft) => void) | null;
  onComplete?: ((payload: CompletedCharacter) => Promise<CompleteResult>) | null;
  onCancel?: (() => void) | null;
}

// 이 화면만의 색 — 검정·흰색 위주. 고른 것 = 흰 테두리 + 옅은 흰 바탕, 주 단추 = 흰 바탕 검은 글. 청록은 쓰지 않는다.
const COLORS = {
  ...BASE_COLORS,
  text: "#F5F6F7",
  textMuted: "rgba(245,246,247,0.72)",
  textFaint: "rgba(245,246,247,0.46)",
  accent: "#FFFFFF",
  accentStrong: "rgba(245,246,247,0.55)",
  line: "rgba(255,255,255,0.10)",
};

// 웹사이트 「게임 영상」 카드의 수사 책상. 공용 public 에 두어 본편·naju01 어디서 떠도 같은 주소로 읽힌다.
const BACKGROUND_IMAGE = `${THUMBNAIL_DIR}/bg-investigation.webp`;

// ── 아이콘 — 한 가지 선 굵기·둥근 끝으로 맞춘다 ──
const ICON_FRAME = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONS = {
  undo: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  ),
  redo: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </svg>
  ),
  reset: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  close: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  next: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  previous: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
};

const GENDER_ICONS: Record<AvatarGender, ReactNode> = {
  masculine: (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="10" cy="14" r="5.5" />
      <path d="M14 10l6-6M15 4h5v5" />
    </svg>
  ),
  feminine: (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="12" cy="9" r="5.5" />
      <path d="M12 14.5V21M9 18h6" />
    </svg>
  ),
};

// ── 탭 01~05 — 탭 순서가 곧 만드는 순서다 ──
type TabId = "basics" | "body" | "hair" | "outfit" | "name";
type AppearanceTab = Exclude<TabId, "name">;

const TABS: readonly { id: TabId; label: string; summary: string }[] = [
  { id: "basics", label: "기본", summary: "성별 · 피부" },
  { id: "body", label: "체형", summary: "키 · 비율 · 체격" },
  { id: "hair", label: "헤어", summary: "머리 모양 · 색" },
  { id: "outfit", label: "의상", summary: "옷 · 신발 · 색" },
  { id: "name", label: "이름", summary: "조사관 이름" },
];

const TAB_ICONS: Record<TabId, ReactNode> = {
  basics: (
    <svg {...ICON_FRAME}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c.6-3.7 3.3-5.6 6.5-5.6s5.9 1.9 6.5 5.6" />
    </svg>
  ),
  body: (
    <svg {...ICON_FRAME}>
      <path d="M4 9h16v6H4z" />
      <path d="M8 9v3M12 9v4M16 9v3" />
    </svg>
  ),
  hair: (
    <svg {...ICON_FRAME}>
      <path d="M5 13a7 7 0 0 1 14 0" />
      <path d="M5 13c0 4 1 6 1 6M19 13c0 4-1 6-1 6" />
      <path d="M9 6.5C10.5 4.8 13.8 4.6 15.5 6.6" />
    </svg>
  ),
  outfit: (
    <svg {...ICON_FRAME}>
      <path d="M9 4 6 6 4 9l3 2v9h10v-9l3-2-2-3-3-2" />
      <path d="M9 4a3 3 0 0 0 6 0" />
    </svg>
  ),
  name: (
    <svg {...ICON_FRAME}>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M7 10h5M7 14h8" />
      <circle cx="16.5" cy="10" r="1.2" />
    </svg>
  ),
};

// 다음 단추에 적는 말 — 「어디로 가나」만
const NEXT_LABELS: Partial<Record<TabId, string>> = {
  body: "체형 설정",
  hair: "헤어 설정",
  outfit: "의상 설정",
  name: "조사관 이름",
};

const TAB_DESCRIPTIONS: Record<TabId, string> = {
  basics: "조사관의 성별과 피부색을 정합니다.",
  body: "키와 몸의 비율을 조절합니다. 기본값 그대로 넘어가도 됩니다.",
  hair: "머리 모양과 머리색을 고릅니다.",
  outfit: "지금 준비된 옷과 신발입니다. 아래에서 상의 · 하의 · 신발을 하나씩 고르세요.",
  name: "게임 안에서 불릴 조사관의 이름입니다.",
};

type OutfitSlot = "top" | "bottom" | "shoes";
const OUTFIT_SLOTS: readonly OutfitSlot[] = ["top", "bottom", "shoes"];

// 의상 칸 → 색 갈래. 상의는 예전 이름 그대로 cloth
const OUTFIT_COLOR_SLOTS: Record<OutfitSlot, keyof DraftColors> = { top: "cloth", bottom: "bottom", shoes: "shoes" };
const OUTFIT_DESCRIPTIONS: Record<OutfitSlot, string> = {
  top: "상의 종류와 상의 컬러를 고릅니다.",
  bottom: "하의 종류와 하의 컬러를 고릅니다.",
  shoes: "신발 종류와 신발 컬러를 고릅니다.",
};

type NameStatusKind = "idle" | "checking" | "available" | "taken" | "forbidden" | "failed" | "notConnected" | "format";

interface NameStatus {
  kind: NameStatusKind;
  /** 확인을 마친 이름 — 입력이 바뀌면 다시 확인해야 한다 */
  checkedName: string | null;
  message?: string;
}

const NAME_STATUS_TEXT: Partial<Record<NameStatusKind, string>> = {
  idle: "이름 중복확인을 진행해 주세요.",
  checking: "확인하고 있습니다…",
  available: "사용할 수 있는 이름입니다.",
  taken: "이미 사용 중인 이름입니다. 다른 이름을 입력해 주세요.",
  forbidden: "사용할 수 없는 이름입니다. 다른 이름을 입력해 주세요.",
  failed: "이름을 확인하지 못했습니다. 다시 시도해 주세요.",
  notConnected: "이름 확인 기능이 연결되지 않았습니다.",
};
const NAME_STATUS_COLORS: Partial<Record<NameStatusKind, string>> = {
  available: COLORS.success,
  taken: COLORS.error,
  forbidden: COLORS.error,
  failed: COLORS.warning,
  notConnected: COLORS.warning,
};

// 「아주 작게 · 작게 · 기본」 대신 와닿는 말로. 다섯 칸은 tickValues 순서와 같다(기본이 한쪽 끝인 항목은 첫 칸이 기본).
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 패널과 그 안 무대 칸의 자리. 카메라가 피할 안전영역은 무대 칸 바깥 전부 — 캐릭터가 늘 무대 칸 한가운데 선다.
// 수치는 4/8/16/24/32/48 배수(패널 안쪽 여백 32 · 머리 104 · 발치 84).
function measureLayout(width: number, height: number) {
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

// ── 작은 조각들 ──
interface TileButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isSelected?: boolean;
}

/** 테두리가 있는 하나의 칸. 고르면 강조색 테와 옅은 바탕 */
function TileButton({ isSelected, children, style, ...rest }: TileButtonProps) {
  return (
    <button
      type="button"
      className="cc-tile"
      aria-pressed={isSelected}
      style={{ ...tileStyle, ...(isSelected ? selectedTileStyle : null), ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 작은 제목 + 내용. 묶음끼리는 24px 띄운다 */
function Group({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: SPACING.m }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: SPACING.s }}>
        <h3 style={groupTitleStyle}>{title}</h3>
        {aside ? <span style={{ marginLeft: "auto", ...smallTextStyle }}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface TickSliderProps {
  field: BodyField;
  value: number;
  gender: AvatarGender;
  onChange: (value: number, isHistoryStep: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onReset: () => void;
}

// 슬라이더 값은 칸 번호(0~4)이고 바깥으로 나가는 값은 그 칸이 가리키는 실수다 — 초안·렌더러는 예전과 같다.
function TickSlider({ field, value, gender, onChange, onDragStart, onDragEnd, onReset }: TickSliderProps) {
  const id = useId();
  const ticks = useMemo(() => tickValues(field, gender), [field, gender]);
  const index = nearestTick(ticks, value);
  const labelAt = (i: number) => TICK_LABELS[field.key]?.[i] ?? ticks[i]?.label ?? "";
  const currentLabel = labelAt(index);
  const moveTo = (next: number, isHistoryStep: boolean) => {
    const i = Math.max(0, Math.min(ticks.length - 1, next));
    onChange(ticks[i].value, isHistoryStep);
  };
  return (
    <div className="cc-slider-row" style={sliderCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACING.s }}>
        <label htmlFor={id} style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>
          {field.label}
        </label>
        <output htmlFor={id} style={{ marginLeft: "auto", ...valueBadgeStyle }}>
          {currentLabel}
        </output>
        <span className="cc-fine" style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            aria-label={`${field.label} 한 칸 줄이기`}
            style={smallTileStyle}
            onClick={() => moveTo(index - 1, true)}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`${field.label} 한 칸 늘리기`}
            style={smallTileStyle}
            onClick={() => moveTo(index + 1, true)}
          >
            ＋
          </button>
          <button type="button" aria-label={`${field.label} 초기화`} style={smallTileStyle} onClick={onReset}>
            ↺
          </button>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={ticks.length - 1}
        step={1}
        value={index}
        // 읽어 주는 값도 화면에 보이는 칸 이름이다
        aria-valuetext={currentLabel}
        list={`${id}-ticks`}
        onPointerDown={onDragStart}
        onKeyDown={onDragStart}
        onChange={(e) => moveTo(Number(e.target.value), false)}
        onPointerUp={onDragEnd}
        onKeyUp={onDragEnd}
        onBlur={onDragEnd}
      />
      <datalist id={`${id}-ticks`}>
        {ticks.map((tick, i) => (
          <option key={tick.label} value={i} label={tick.label} />
        ))}
      </datalist>
      {/* 양 끝 말 — 어느 쪽으로 밀면 무엇이 되나가 손대기 전에 읽힌다 */}
      <div style={{ display: "flex", justifyContent: "space-between", ...smallTextStyle }}>
        <span>{labelAt(0)}</span>
        <span>{labelAt(ticks.length - 1)}</span>
      </div>
    </div>
  );
}

interface ColorPickerProps {
  slot: ColorSlot;
  palette: readonly Option<string>[];
  value: string | undefined;
  onChange: (hex: string) => void;
}

function ColorPicker({ slot, palette, value, onChange }: ColorPickerProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: SPACING.s }}>
      {palette.map(([hex, label]) => {
        const isSelected = hex.toLowerCase() === (value ?? "").toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            className="cc-swatch"
            onClick={() => onChange(hex)}
            aria-pressed={isSelected}
            aria-label={`${COLOR_SLOT_LABELS[slot]} 색 ${label}`}
            title={label}
            style={{ ...swatchStyle, background: hex, ...(isSelected ? selectedSwatchStyle : null) }}
          >
            {isSelected ? <span style={{ color: "#0A0B0D", font: "800 12px/1 sans-serif" }}>✓</span> : null}
          </button>
        );
      })}
      <label
        className="cc-swatch"
        style={{
          ...swatchStyle,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,0.06)",
          cursor: "pointer",
        }}
        title="직접 고르기"
      >
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${COLOR_SLOT_LABELS[slot]} 색 직접 고르기`}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        />
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={COLORS.textMuted}
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </label>
    </div>
  );
}

interface ItemCardProps {
  isSelected: boolean;
  label: string;
  description?: string;
  thumbnail: string | null;
  onClick: () => void;
}

function ItemCard({ isSelected, label, description, thumbnail, onClick }: ItemCardProps) {
  return (
    <button
      type="button"
      className="cc-tile"
      onClick={onClick}
      aria-pressed={isSelected}
      style={{
        ...tileStyle,
        ...(isSelected ? selectedTileStyle : null),
        padding: 8,
        display: "grid",
        gap: 8,
        justifyItems: "stretch",
        position: "relative",
      }}
    >
      <span
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 8,
          overflow: "hidden",
          background: "rgba(0,0,0,0.25)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span style={smallTextStyle}>없음</span>
        )}
      </span>
      <span
        style={{
          font: `600 13px/1.3 ${FONTS.body}`,
          color: isSelected ? "#fff" : COLORS.textMuted,
          textAlign: "center",
        }}
      >
        {label}
      </span>
      {description ? (
        <span style={{ ...smallTextStyle, textAlign: "center", marginTop: -4 }}>{description}</span>
      ) : null}
      {isSelected ? <span style={checkMarkStyle}>✓</span> : null}
    </button>
  );
}

/**
 * 보기 전환(전신 · 머리 · 손 · 발) — 고른 칸의 반투명 상자가 누른 단추로 미끄러져 간다.
 * 상자 하나가 움직여야 어디서 어디로 옮겼는지 눈이 따라간다. 자리는 단추의 실제 크기를 재서 맞춘다.
 */
function ViewSwitcher({ selected, onSelect }: { selected: PreviewView; onSelect: (view: PreviewView) => void }) {
  const buttons = useRef<Partial<Record<PreviewView, HTMLButtonElement | null>>>({});
  const [highlight, setHighlight] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const element = buttons.current[selected];
    if (!element) {
      setHighlight(null);
      return;
    }
    setHighlight({ x: element.offsetLeft, w: element.offsetWidth });
  }, [selected]);
  return (
    <div role="group" aria-label="보기" style={{ ...segmentFrameStyle, position: "relative", pointerEvents: "auto" }}>
      <span
        aria-hidden="true"
        style={{
          ...segmentHighlightStyle,
          opacity: highlight ? 1 : 0,
          transform: `translateX(${highlight?.x ?? 0}px)`,
          width: highlight?.w ?? 0,
        }}
      />
      {PREVIEW_VIEWS.map(([view, label]) => {
        const isSelected = selected === view;
        return (
          <button
            key={view}
            ref={(element) => {
              buttons.current[view] = element;
            }}
            type="button"
            className="cc-segment"
            aria-pressed={isSelected}
            onClick={() => onSelect(view)}
            style={{ ...segmentButtonStyle, color: isSelected ? "#fff" : COLORS.textMuted }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 체크박스를 그대로 두고 모양만 스위치로 */
function Switch({
  isOn,
  onChange,
  children,
}: {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      className="cc-tile"
      style={{
        ...tileStyle,
        display: "flex",
        alignItems: "center",
        gap: SPACING.m,
        cursor: "pointer",
        padding: "14px 16px",
      }}
    >
      <input
        type="checkbox"
        checked={isOn}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <span style={{ display: "grid", gap: 2, flex: 1 }}>{children}</span>
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: isOn ? COLORS.accent : "rgba(255,255,255,0.14)",
          position: "relative",
          transition: `background ${MOTION.normal}`,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: isOn ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: isOn ? "#0A0B0D" : "#d6dde3",
            transition: `left ${MOTION.normal}`,
          }}
        />
      </span>
    </label>
  );
}

// ── 본체 ──
interface Look {
  gender: AvatarGender;
  /** 성별마다 따로 든 외형 — 성별을 오가도 각자 고른 것이 남는다 */
  drafts: Record<AvatarGender, DraftAppearance | null>;
}

interface History {
  past: Look[];
  future: Look[];
}

const HISTORY_LIMIT = 50;
const WHITE = "#ffffff";

export default function CharacterCreationScreen({
  initialValue = null,
  catalog = null,
  nameRules = null,
  checkName = null,
  onDraftChange = null,
  onComplete = null,
  onCancel = null,
}: CharacterCreationScreenProps) {
  const activeCatalog = useMemo(() => catalog ?? DEFAULT_CATALOG, [catalog]);
  const rules = useMemo(() => normalizeNameRules(nameRules ?? DEFAULT_NAME_RULES), [nameRules]);

  const [initial] = useState(() => normalizeDraft(initialValue ?? createDefaultDraft(activeCatalog), activeCatalog));
  const [look, setLook] = useState<Look>(() => {
    const appearance = initial.draft.appearance;
    return {
      gender: appearance.gender,
      drafts: {
        masculine: appearance.gender === "masculine" ? appearance : null,
        feminine: appearance.gender === "feminine" ? appearance : null,
      },
    };
  });
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [stage, setStage] = useState<"appearance" | "name">("appearance");
  const [section, setSection] = useState<AppearanceTab>("basics");
  const [showUnderwear, setShowUnderwear] = useState(false);
  const [notice, setNotice] = useState<string | null>(initial.notices.length ? initial.notices.join(" ") : null);
  const [view, setView] = useState<PreviewView>("full");
  // 관찰 옵션(대기/걷기·화질·돌리기)은 UI 개편 중이라 막아 두었다 — 자세는 걷기, 화질은 보통으로 고정
  const [pose] = useState("Walk_Loop");
  const [quality] = useState<PreviewQuality>("medium");
  const [size, setSize] = useState({ width: 1280, height: 800 });
  const [hasEntered, setHasEntered] = useState(false);

  const [name, setName] = useState(initial.draft.displayName);
  const [isComposing, setIsComposing] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameStatus>({ kind: "idle", checkedName: null });
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const lookBeforeDrag = useRef<Look | null>(null);
  const checkSerial = useRef(0);
  const checkAbort = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cameraControls = useRef<PreviewControls | null>(null);
  const handleControlsReady = useCallback((controls: PreviewControls) => {
    cameraControls.current = controls;
  }, []);

  const layout = useMemo(() => measureLayout(size.width, size.height), [size]);

  const appearance = useMemo(
    () =>
      look.drafts[look.gender] ??
      normalizeDraft(createDefaultDraft(activeCatalog, look.gender), activeCatalog).draft.appearance,
    [look, activeCatalog],
  );

  const draft = useMemo<CharacterDraft>(
    () => ({ schemaVersion: 1, displayName: normalizeName(name), appearance }),
    [name, appearance],
  );

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 첫 진입 — 밝기만 짧게 정돈한다. 입력은 이 연출을 기다리지 않는다.
  useEffect(() => {
    const timer = setTimeout(() => setHasEntered(true), 30);
    return () => clearTimeout(timer);
  }, []);

  // ── 외형 바꾸기 ──
  const changeLook = useCallback(
    (update: (previous: Look) => Look) => {
      setHistory((h) => ({ past: [...h.past, look].slice(-HISTORY_LIMIT), future: [] }));
      setLook(update);
    },
    [look],
  );

  const updateAppearance = useCallback(
    (update: (current: DraftAppearance) => DraftAppearance, isHistoryStep = true) => {
      const apply = (previous: Look): Look => {
        const current =
          previous.drafts[previous.gender] ??
          normalizeDraft(createDefaultDraft(activeCatalog, previous.gender), activeCatalog).draft.appearance;
        return { ...previous, drafts: { ...previous.drafts, [previous.gender]: update(current) } };
      };
      if (isHistoryStep) changeLook(apply);
      else setLook(apply);
    },
    [changeLook, activeCatalog],
  );

  const changeGender = (nextGender: AvatarGender) => {
    if (nextGender === look.gender) return;
    changeLook((previous) => {
      if (previous.drafts[nextGender]) return { ...previous, gender: nextGender };
      const current =
        previous.drafts[previous.gender] ??
        normalizeDraft(createDefaultDraft(activeCatalog, previous.gender), activeCatalog).draft.appearance;
      // 바꾼 항목 알림은 띄우지 않는다 — 성별마다 다른 항목은 그 성별 기본값으로 조용히 맞춘다
      const { appearance: matched } = matchGender(current, nextGender, activeCatalog);
      return { ...previous, gender: nextGender, drafts: { ...previous.drafts, [nextGender]: matched } };
    });
  };

  const undo = () => {
    if (!history.past.length) return;
    setLook(history.past[history.past.length - 1]);
    setHistory({ past: history.past.slice(0, -1), future: [look, ...history.future].slice(0, HISTORY_LIMIT) });
  };
  const redo = () => {
    if (!history.future.length) return;
    setLook(history.future[0]);
    setHistory({ past: [...history.past, look].slice(-HISTORY_LIMIT), future: history.future.slice(1) });
  };
  const resetAll = () => {
    changeLook(() => ({ gender: look.gender, drafts: { masculine: null, feminine: null } }));
    setNotice("외형을 기본값으로 되돌렸습니다. 되돌리기로 복구할 수 있습니다.");
  };
  const resetSection = () => {
    const fallback = normalizeDraft(createDefaultDraft(activeCatalog, look.gender), activeCatalog).draft.appearance;
    if (section === "body") updateAppearance((v) => ({ ...v, bodyParameters: defaultBodyParameters(look.gender) }));
    else if (section === "hair")
      updateAppearance((v) => ({ ...v, hairId: fallback.hairId, colors: { ...v.colors, hair: WHITE } }));
    else if (section === "outfit")
      updateAppearance((v) => ({
        ...v,
        equipmentIds: { ...fallback.equipmentIds },
        colors: { ...v.colors, cloth: WHITE, bottom: WHITE, shoes: WHITE },
      }));
    else updateAppearance((v) => ({ ...v, colors: { ...v.colors, skin: WHITE } }));
  };

  // 갈래를 고르면 그 부위로 초점을 옮긴다(슬라이더를 움직이는 동안에는 옮기지 않는다)
  const selectSection = (next: AppearanceTab) => {
    setSection(next);
    if (next === "hair") setView("head");
    else if (next === "outfit") setView("full");
    else if (next === "basics") setView("full");
  };

  // ── 이름 ──
  const format = validateNameFormat(name, rules);
  const normalizedName = normalizeName(name);
  const isNameConfirmed =
    nameStatus.kind === "available" && nameStatus.checkedName === normalizedName && normalizedName.length > 0;

  const changeName = (value: string) => {
    setName(value);
    checkSerial.current += 1;
    checkAbort.current?.abort();
    checkAbort.current = null;
    setNameStatus({ kind: "idle", checkedName: null });
    setCompleteError(null);
  };

  const checkDuplicate = async () => {
    if (isComposing) return;
    const candidate = normalizeName(name);
    const formatResult = validateNameFormat(candidate, rules);
    if (!formatResult.ok) {
      setNameStatus({ kind: "format", message: formatResult.message, checkedName: null });
      return;
    }
    if (typeof checkName !== "function") {
      setNameStatus({ kind: "notConnected", checkedName: null });
      return;
    }
    checkAbort.current?.abort();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    checkAbort.current = controller;
    checkSerial.current += 1;
    const serial = checkSerial.current;
    setNameStatus({ kind: "checking", checkedName: null });
    try {
      const answer = await checkName(candidate, { signal: controller?.signal });
      // 그 사이 입력이 바뀌었으면 옛 답은 버린다
      if (serial !== checkSerial.current) return;
      const status = answer?.status;
      if (status === "available") setNameStatus({ kind: "available", checkedName: candidate });
      else if (status === "taken") setNameStatus({ kind: "taken", message: answer.message, checkedName: null });
      else if (status === "invalid") setNameStatus({ kind: "forbidden", message: answer.message, checkedName: null });
      else setNameStatus({ kind: "failed", checkedName: null });
    } catch {
      if (serial !== checkSerial.current) return;
      setNameStatus({ kind: "failed", checkedName: null });
    }
  };

  const complete = async () => {
    if (isCompleting || isCompleted || !isNameConfirmed) return;
    if (typeof onComplete !== "function") {
      setCompleteError("완료 처리 함수가 연결되지 않았습니다.");
      return;
    }
    setIsCompleting(true);
    setCompleteError(null);
    try {
      const answer = await onComplete(toCompletedCharacter({ ...draft, displayName: normalizedName }, activeCatalog));
      if (answer?.ok) {
        setIsCompleted(true);
        return;
      }
      if (answer?.reason === "name_taken") {
        setNameStatus({ kind: "taken", message: answer?.message, checkedName: null });
        setCompleteError("이름을 다시 확인해 주세요.");
      } else {
        setCompleteError(answer?.message ?? "저장하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setCompleteError("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setIsCompleting(false);
    }
  };

  // ── 그리기 ──
  const rendererConfig = useMemo(
    () => toRendererConfig(appearance, activeCatalog, { showUnderwear, motion: pose }),
    [appearance, activeCatalog, showUnderwear, pose],
  );

  const body = appearance.bodyParameters;
  // 슬라이더를 끄는 동안은 한 번만 이력에 남긴다
  const handleSliderDragStart = () => {
    if (!lookBeforeDrag.current) lookBeforeDrag.current = look;
  };
  const handleSliderDragEnd = () => {
    const previous = lookBeforeDrag.current;
    lookBeforeDrag.current = null;
    if (previous && previous !== look) {
      setHistory((h) => ({ past: [...h.past, previous].slice(-HISTORY_LIMIT), future: [] }));
    }
  };
  const changeBodyValue = (field: BodyField, value: number, isHistoryStep: boolean) => {
    const clamped = Math.min(field.max, Math.max(field.min, Number(value.toFixed(4))));
    updateAppearance((v) => ({ ...v, bodyParameters: { ...v.bodyParameters, [field.key]: clamped } }), isHistoryStep);
  };

  const nameInputId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const nameMessage =
    nameStatus.kind === "format" ? nameStatus.message : (nameStatus.message ?? NAME_STATUS_TEXT[nameStatus.kind] ?? "");

  const { isNarrow, panel, padding, header, footer, stage: stageRect, settings, viewBar, safeArea } = layout;
  // 「캐릭터 생성」 제목과 같은 폭 — 위아래 정렬선이 하나로 맞는다
  const heartbeatWidth = isNarrow ? 150 : 200;

  // 「이름」은 단계(외형/이름)를 바꾸고, 나머지는 외형 안의 갈래를 바꾼다
  const activeTab: TabId = stage === "name" ? "name" : section;
  const activeTabIndex = TABS.findIndex((tab) => tab.id === activeTab);
  const activeTabInfo = TABS[activeTabIndex];
  const nextTab = TABS[activeTabIndex + 1];
  const selectTab = (tab: TabId) => {
    if (tab === "name") {
      setShowUnderwear(false);
      setStage("name");
      return;
    }
    setStage("appearance");
    selectSection(tab);
  };
  const [isConfirmNudged, setIsConfirmNudged] = useState(false);
  // 의상 모달 — 고르는 중인 칸. null 이면 닫힘
  const [openOutfitSlot, setOpenOutfitSlot] = useState<OutfitSlot | null>(null);
  useEffect(() => {
    if (!openOutfitSlot) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOutfitSlot(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openOutfitSlot]);
  const handleConfirm = () => {
    if (isNameConfirmed) {
      void complete();
      return;
    }
    selectTab("name");
    setIsConfirmNudged(true);
    setTimeout(() => nameInput.current?.focus(), 60);
  };
  const confirmLabel = isCompleted ? "튜토리얼로 이동 중…" : isCompleting ? "처리 중입니다…" : "확인 · 게임 시작";
  const previewView: PreviewView = stage === "name" ? "upperBody" : view;

  return (
    <div ref={root} className="cc-root" style={rootStyle}>
      <style>{SCREEN_CSS + REDESIGN_CSS + HEARTBEAT_LINE_CSS}</style>

      {/* 배경층 — 「어디에 들어왔나」만 말하고 주인공을 빼앗지 않는다 */}
      <div aria-hidden="true" style={backgroundImageStyle} />
      <div aria-hidden="true" style={backgroundShadeStyle} />

      <div aria-hidden="true" style={{ ...panelStyle, left: panel.x, top: panel.y, width: panel.w, height: panel.h }} />

      {/* 무대 칸 — 테두리 없이 캐릭터 뒤에 은은한 빛과 바닥 그림자만 */}
      <div
        aria-hidden="true"
        style={{ ...stageStyle, left: stageRect.x, top: stageRect.y, width: stageRect.w, height: stageRect.h }}
      >
        <div style={stageFloorGlowStyle} />
      </div>

      {/* 3D층 — 머리·상반신 보기에서 크게 당기면 칸 밖으로 삐져나와 무대 칸 모양으로 잘라 낸다.
          캔버스는 화면 전체 그대로 두어 어디서나 돌려 볼 수 있다. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: hasEntered ? 1 : 0,
          transition: "opacity 600ms ease-out",
          clipPath: `inset(${stageRect.y}px ${Math.max(0, size.width - stageRect.x - stageRect.w)}px ${Math.max(0, size.height - stageRect.y - stageRect.h)}px ${stageRect.x}px round 4px)`,
        }}
      >
        <CharacterPreview
          config={rendererConfig}
          view={previewView}
          pose={pose}
          quality={quality}
          safeArea={safeArea}
          onControlsReady={handleControlsReady}
        />
      </div>

      {/* UI층 — 빈 자리(무대)는 캐릭터를 돌려 보는 자리다 */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <header
          style={{
            position: "absolute",
            left: panel.x + padding,
            width: panel.w - padding * 2,
            top: panel.y,
            height: header,
            display: "grid",
            alignContent: "center",
            justifyItems: "center",
            gap: 6,
            paddingBottom: 14,
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ margin: 0, ...titleStyle, fontSize: isNarrow ? 24 : 34 }}>캐릭터 생성</h1>
          <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>
            왜곡을 조사할 당신의 모습을 만들어 주세요
          </p>
        </header>

        {/* 닫기 — 「뒤로」와 같은 일을 한다 */}
        {onCancel ? (
          <button
            type="button"
            className="cc-tile"
            aria-label="닫고 웹사이트로 돌아가기"
            onClick={onCancel}
            style={{
              ...closeButtonStyle,
              left: panel.x + panel.w - padding - 40,
              top: panel.y + 20,
              pointerEvents: "auto",
            }}
          >
            {ICONS.close}
          </button>
        ) : null}

        <div
          style={{
            position: "absolute",
            left: stageRect.x,
            width: stageRect.w,
            top: stageRect.y + stageRect.h - viewBar,
            height: viewBar,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ViewSwitcher selected={previewView} onSelect={setView} />
        </div>
        <div style={{ position: "absolute", left: stageRect.x + 28, top: stageRect.y + 26, display: "grid", gap: 4 }}>
          <span style={stageTagStyle}>{look.gender === "feminine" ? "FEMALE" : "MALE"} · 조사관</span>
          <span style={{ font: `700 20px/1.2 ${FONTS.body}`, color: COLORS.text }}>
            {normalizedName || "이름 없음"}
          </span>
        </div>

        <section
          aria-label="설정"
          style={{
            position: "absolute",
            left: settings.x,
            top: settings.y,
            width: settings.w,
            height: settings.h,
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            gap: SPACING.l,
            pointerEvents: "auto",
          }}
        >
          <nav
            aria-label="만드는 순서"
            style={{ display: "grid", gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, gap: SPACING.s }}
          >
            {TABS.map((tab, i) => {
              const isSelected = activeTab === tab.id;
              const isPassed = i < activeTabIndex;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="cc-tile"
                  aria-pressed={isSelected}
                  aria-current={isSelected ? "step" : undefined}
                  onClick={() => selectTab(tab.id)}
                  style={{
                    ...tileStyle,
                    ...(isSelected ? selectedTabStyle : null),
                    padding: isNarrow ? "8px 6px" : "12px 12px 11px",
                    display: "grid",
                    gap: 6,
                    justifyItems: isNarrow ? "center" : "start",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span
                      style={{
                        ...stepNumberStyle,
                        color: isSelected ? COLORS.accent : isPassed ? COLORS.success : COLORS.textFaint,
                      }}
                    >
                      {isPassed ? "✓" : `0${i + 1}`}
                    </span>
                    {!isNarrow ? (
                      <span
                        style={{
                          marginLeft: "auto",
                          color: isSelected ? COLORS.accent : COLORS.textFaint,
                          display: "grid",
                        }}
                      >
                        {TAB_ICONS[tab.id]}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ font: `700 15px/1.2 ${FONTS.body}`, color: isSelected ? "#fff" : COLORS.textMuted }}>
                    {tab.label}
                  </span>
                  {!isNarrow ? (
                    <span
                      style={{
                        ...smallTextStyle,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {tab.summary}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div style={contentCardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: SPACING.m,
                padding: `${SPACING.xl}px ${SPACING.xl}px ${SPACING.l}px`,
                borderBottom: `1px solid ${COLORS.line}`,
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <h2
                  style={{
                    margin: 0,
                    font: `700 22px/1.25 ${FONTS.body}`,
                    color: COLORS.text,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {activeTabInfo.label}
                </h2>
                <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>{TAB_DESCRIPTIONS[activeTab]}</p>
              </div>
              {activeTab !== "name" ? (
                <button
                  type="button"
                  className="cc-text-button"
                  style={{ ...textButtonStyle, marginLeft: "auto" }}
                  onClick={resetSection}
                >
                  {ICONS.reset} 이 항목 초기화
                </button>
              ) : null}
            </div>

            {notice ? (
              <div style={noticeStyle} role="status">
                <span style={{ flex: 1 }}>{notice}</span>
                <button
                  type="button"
                  className="cc-text-button"
                  style={{ ...textButtonStyle, color: COLORS.warning }}
                  onClick={() => setNotice(null)}
                >
                  확인
                </button>
              </div>
            ) : null}

            <div
              style={{
                overflowY: "auto",
                padding: SPACING.xl,
                display: "grid",
                gap: SPACING.xl,
                alignContent: "start",
                minHeight: 0,
              }}
            >
              {activeTab === "basics" ? (
                <>
                  <Group title="성별">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACING.m }}>
                      {genderOptions().map(([gender, label]) => {
                        const isSelected = look.gender === gender;
                        return (
                          <TileButton
                            key={gender}
                            isSelected={isSelected}
                            onClick={() => changeGender(gender)}
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
                  </Group>
                  <Group title="피부 컬러" aside="흰색은 원본 그대로입니다">
                    <ColorPicker
                      slot="skin"
                      palette={activeCatalog.palettes.skin}
                      value={appearance.colors.skin}
                      onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, skin: hex } }))}
                    />
                  </Group>
                  <Group title="미리보기">
                    <Switch isOn={showUnderwear} onChange={setShowUnderwear}>
                      <span style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>속옷으로 체형 보기</span>
                      <span style={smallTextStyle}>골라 둔 옷은 그대로 남습니다.</span>
                    </Switch>
                  </Group>
                </>
              ) : null}

              {activeTab === "body" ? (
                <>
                  {BODY_FIELD_GROUPS.map(([group, label]) => (
                    <Group key={group} title={label}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: settings.w > 560 ? "1fr 1fr" : "1fr",
                          gap: SPACING.m,
                        }}
                      >
                        {BODY_FIELDS.filter((field) => field.group === group).map((field) => (
                          <TickSlider
                            key={field.key}
                            field={field}
                            gender={look.gender}
                            value={body[field.key]}
                            onChange={(value, isHistoryStep) => changeBodyValue(field, value, isHistoryStep)}
                            onDragStart={handleSliderDragStart}
                            onDragEnd={handleSliderDragEnd}
                            onReset={() => changeBodyValue(field, bodyFieldDefault(field, look.gender), true)}
                          />
                        ))}
                      </div>
                    </Group>
                  ))}
                </>
              ) : null}

              {activeTab === "hair" ? (
                <>
                  <Group title="머리 모양">
                    <div style={cardGridStyle}>
                      {slotOptions(activeCatalog, "hair", look.gender).map((it) => (
                        <ItemCard
                          key={it.id}
                          isSelected={appearance.hairId === it.id}
                          label={it.label}
                          thumbnail={pickThumbnail(it, look.gender)}
                          onClick={() => updateAppearance((v) => ({ ...v, hairId: it.id }))}
                        />
                      ))}
                    </div>
                  </Group>
                  <Group title="헤어 컬러" aside="원본에 색을 입힙니다">
                    <ColorPicker
                      slot="hair"
                      palette={activeCatalog.palettes.hair}
                      value={appearance.colors.hair}
                      onChange={(hex) => updateAppearance((v) => ({ ...v, colors: { ...v.colors, hair: hex } }))}
                    />
                  </Group>
                </>
              ) : null}

              {activeTab === "outfit" ? (
                <Group title="의상 항목" aside="누르면 고르는 창이 열립니다">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: settings.w > 560 ? "repeat(3, 1fr)" : "1fr",
                      gap: SPACING.m,
                    }}
                  >
                    {OUTFIT_SLOTS.map((slot) => {
                      const current = slotOptions(activeCatalog, slot, look.gender).find(
                        (it) => it.id === appearance.equipmentIds[slot],
                      );
                      const thumbnail = current ? pickThumbnail(current, look.gender) : null;
                      const color = appearance.colors[OUTFIT_COLOR_SLOTS[slot]] ?? WHITE;
                      return (
                        <TileButton
                          key={slot}
                          onClick={() => setOpenOutfitSlot(slot)}
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
                              <img
                                src={thumbnail}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <span style={smallTextStyle}>없음</span>
                            )}
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ font: `700 16px/1.2 ${FONTS.body}`, color: COLORS.text }}>
                              {SLOT_LABELS[slot]}
                            </span>
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
                </Group>
              ) : null}

              {activeTab === "name" ? (
                <>
                  <Group title="조사관 이름" aside={`${countCharacters(name)} / ${rules.max}자`}>
                    <div style={{ display: "flex", gap: SPACING.s }}>
                      <input
                        ref={nameInput}
                        id={nameInputId}
                        value={name}
                        style={nameInputStyle}
                        maxLength={rules.max * 2}
                        placeholder={`${rules.min}~${rules.max}자로 입력해 주세요`}
                        aria-label="조사관 이름"
                        aria-describedby={`${nameInputId}-help ${nameInputId}-result`}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={(e) => {
                          setIsComposing(false);
                          changeName(e.currentTarget.value);
                        }}
                        onChange={(e) => {
                          changeName(e.target.value);
                          setIsConfirmNudged(false);
                        }}
                        onKeyDown={(e) => {
                          // 한글 조합 중의 Enter 는 「입력 확정」이라 제출로 받으면 안 된다
                          if (e.key === "Enter" && !e.nativeEvent.isComposing && !isComposing) {
                            e.preventDefault();
                            void checkDuplicate();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="cc-tile"
                        style={{
                          ...tileStyle,
                          padding: "0 22px",
                          font: `700 14px/1 ${FONTS.body}`,
                          color: COLORS.text,
                        }}
                        onClick={() => void checkDuplicate()}
                        disabled={nameStatus.kind === "checking"}
                      >
                        중복확인
                      </button>
                    </div>
                    <span id={`${nameInputId}-help`} style={smallTextStyle}>
                      {rules.allowedHint}
                    </span>
                    {/* 결과 자리를 미리 비워 둔다 — 메시지가 떠도 입력칸·단추가 튀지 않는다 */}
                    <div
                      id={`${nameInputId}-result`}
                      role="status"
                      aria-live="polite"
                      style={{
                        minHeight: 22,
                        font: `500 14px/1.5 ${FONTS.body}`,
                        color:
                          NAME_STATUS_COLORS[nameStatus.kind] ?? (isConfirmNudged ? COLORS.warning : COLORS.textMuted),
                      }}
                    >
                      {nameStatus.kind === "idle" && !format.ok && !format.isEmpty ? format.message : nameMessage}
                    </div>
                  </Group>
                  <Group title="조사관 정보">
                    <div style={summaryGridStyle}>
                      {outfitSummary(appearance, activeCatalog).map(([label, value]) => (
                        <div key={label} style={summaryRowStyle}>
                          <span style={smallTextStyle}>{label}</span>
                          <span style={{ font: `600 14px/1.3 ${FONTS.body}`, color: COLORS.text }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </Group>
                  {completeError ? (
                    <div style={{ font: `500 14px/1.5 ${FONTS.body}`, color: COLORS.error }}>{completeError}</div>
                  ) : null}
                  {isCompleted ? (
                    <div style={{ font: `500 14px/1.5 ${FONTS.body}`, color: COLORS.success }}>
                      캐릭터를 만들었습니다. 튜토리얼로 이동합니다.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          {nextTab ? (
            <button
              type="button"
              className="cc-tile"
              onClick={() => selectTab(nextTab.id)}
              style={{ ...tileStyle, padding: "15px 20px", display: "flex", alignItems: "center", gap: SPACING.m }}
            >
              <span style={{ font: `700 16px/1 ${FONTS.body}`, color: COLORS.text }}>{NEXT_LABELS[nextTab.id]}</span>
              <span style={{ marginLeft: "auto", color: COLORS.text, display: "grid" }}>{ICONS.next}</span>
            </button>
          ) : (
            <div style={{ ...smallTextStyle, padding: "15px 4px", textAlign: "right" }}>
              {isNameConfirmed
                ? "준비가 끝났습니다. 확인을 누르면 튜토리얼이 시작됩니다."
                : "이름 중복확인을 마치면 게임을 시작할 수 있습니다."}
            </div>
          )}
        </section>

        {openOutfitSlot ? (
          <div
            style={modalBackdropStyle}
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpenOutfitSlot(null);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${SLOT_LABELS[openOutfitSlot]} 고르기`}
              style={modalStyle}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: SPACING.m,
                  padding: `${SPACING.xl}px ${SPACING.xl}px ${SPACING.l}px`,
                  borderBottom: `1px solid ${COLORS.line}`,
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <h2 style={{ margin: 0, font: `700 22px/1.25 ${FONTS.body}`, color: COLORS.text }}>
                    {SLOT_LABELS[openOutfitSlot]}
                  </h2>
                  <p style={{ margin: 0, ...smallTextStyle, color: COLORS.textMuted }}>
                    {OUTFIT_DESCRIPTIONS[openOutfitSlot]}
                  </p>
                </div>
                <button
                  type="button"
                  className="cc-tile"
                  aria-label="닫기"
                  onClick={() => setOpenOutfitSlot(null)}
                  style={{
                    ...tileStyle,
                    marginLeft: "auto",
                    width: 40,
                    height: 40,
                    padding: 0,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {ICONS.close}
                </button>
              </div>
              <div style={{ padding: SPACING.xl, display: "grid", gap: SPACING.xl, overflowY: "auto" }}>
                <Group title={`${SLOT_LABELS[openOutfitSlot]} 종류`}>
                  <div style={cardGridStyle}>
                    {slotOptions(activeCatalog, openOutfitSlot, look.gender).map((it) => (
                      <ItemCard
                        key={it.id}
                        isSelected={appearance.equipmentIds[openOutfitSlot] === it.id}
                        label={it.label}
                        description={it.description}
                        thumbnail={pickThumbnail(it, look.gender)}
                        onClick={() =>
                          updateAppearance((v) => ({
                            ...v,
                            equipmentIds: { ...v.equipmentIds, [openOutfitSlot]: it.id },
                          }))
                        }
                      />
                    ))}
                  </div>
                </Group>
                <Group
                  title={`${SLOT_LABELS[openOutfitSlot]} 컬러`}
                  aside={openOutfitSlot === "bottom" ? "검은 바지라 짙은 색만 또렷이 보입니다" : "원본에 색을 입힙니다"}
                >
                  <ColorPicker
                    slot={OUTFIT_COLOR_SLOTS[openOutfitSlot]}
                    palette={activeCatalog.palettes[OUTFIT_COLOR_SLOTS[openOutfitSlot]] ?? activeCatalog.palettes.cloth}
                    value={appearance.colors[OUTFIT_COLOR_SLOTS[openOutfitSlot]]}
                    onChange={(hex) =>
                      updateAppearance((v) => ({
                        ...v,
                        colors: { ...v.colors, [OUTFIT_COLOR_SLOTS[openOutfitSlot]]: hex },
                      }))
                    }
                  />
                </Group>
              </div>
              <div
                style={{
                  padding: `${SPACING.l}px ${SPACING.xl}px ${SPACING.xl}px`,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="cc-confirm"
                  onClick={() => setOpenOutfitSlot(null)}
                  style={{ ...confirmButtonStyle, height: 46, padding: "0 32px" }}
                >
                  완료
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <footer
          style={{
            position: "absolute",
            left: panel.x + padding,
            width: panel.w - padding * 2,
            top: panel.y + panel.h - footer,
            height: footer,
            display: "flex",
            alignItems: "center",
            gap: SPACING.l,
          }}
        >
          {onCancel ? (
            <button
              type="button"
              className="cc-back"
              onClick={onCancel}
              style={{ ...backButtonStyle, pointerEvents: "auto" }}
            >
              {ICONS.previous} 뒤로
            </button>
          ) : null}
          <div style={{ display: "flex", gap: 4, pointerEvents: "auto" }}>
            <button
              type="button"
              className="cc-text-button"
              style={textButtonStyle}
              onClick={undo}
              disabled={!history.past.length}
            >
              {ICONS.undo} 되돌리기
            </button>
            <button
              type="button"
              className="cc-text-button"
              style={textButtonStyle}
              onClick={redo}
              disabled={!history.future.length}
            >
              {ICONS.redo} 다시 실행
            </button>
            <button type="button" className="cc-text-button" style={textButtonStyle} onClick={resetAll}>
              {ICONS.reset} 외형 초기화
            </button>
          </div>
          {/* 가운데는 비운다 — 심장선은 아래에서 패널 정중앙에 따로 놓는다 */}
          <div style={{ flex: 1 }} />
          <span
            aria-label={`${TABS.length}단계 중 ${activeTabIndex + 1}단계`}
            style={{ ...stepNumberStyle, color: COLORS.text }}
          >
            {`0${activeTabIndex + 1}`}
            <span style={{ color: COLORS.textFaint }}>{` / 0${TABS.length}`}</span>
          </span>
          <button
            type="button"
            className="cc-confirm"
            onClick={handleConfirm}
            disabled={isCompleting || isCompleted}
            aria-describedby={!isNameConfirmed ? `${nameInputId}-result` : undefined}
            style={{ ...confirmButtonStyle, ...(isNameConfirmed ? null : pendingConfirmStyle), pointerEvents: "auto" }}
          >
            {confirmLabel} {ICONS.next}
          </button>
        </footer>
        {/* 발치 심장선 — 위 「캐릭터 생성」 제목과 같은 가운데 · 같은 폭 */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: panel.x + panel.w / 2 - heartbeatWidth / 2,
            width: heartbeatWidth,
            top: panel.y + panel.h - footer / 2 - 6,
            height: 12,
          }}
        >
          <HeartbeatLine
            shape="cardSmall"
            height={12}
            color="#FFFFFF"
            glow="#FFFFFF"
            opacity={0.28}
            period={2.8}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ──
const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "#05080D",
};

// 크게 흐리고 어둡게. 가장자리가 흐림에 씻겨 하얗게 뜨지 않게 조금 키운다
const backgroundImageStyle: CSSProperties = {
  position: "absolute",
  inset: -24,
  background: `url("${BACKGROUND_IMAGE}") center / cover no-repeat`,
  filter: "blur(7px) brightness(0.62) saturate(0.95)",
  transform: "scale(1.04)",
};
// 패널 둘레를 더 어둡게 눌러 창이 떠 보이게
const backgroundShadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: [
    "radial-gradient(80% 70% at 50% 50%, rgba(5,9,15,0) 0%, rgba(5,9,15,0.55) 100%)",
    "linear-gradient(180deg, rgba(5,9,15,0.4) 0%, rgba(5,9,15,0) 22%, rgba(5,9,15,0) 78%, rgba(5,9,15,0.45) 100%)",
  ].join(","),
};

const panelStyle: CSSProperties = {
  position: "absolute",
  background: "linear-gradient(180deg, rgba(16,18,21,0.84) 0%, rgba(10,11,13,0.9) 100%)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 6,
  boxShadow: "0 40px 120px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
};

const stageStyle: CSSProperties = {
  position: "absolute",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.14)",
  background:
    "radial-gradient(70% 60% at 50% 42%, rgba(70,76,84,0.38) 0%, rgba(24,27,31,0.18) 70%, rgba(8,14,22,0) 100%)",
  overflow: "hidden",
};
const stageFloorGlowStyle: CSSProperties = {
  position: "absolute",
  left: "18%",
  right: "18%",
  bottom: 70,
  height: 46,
  borderRadius: "50%",
  background: "radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.12)",
};

const stageTagStyle: CSSProperties = {
  font: `600 11px/1 ${FONTS.mono}`,
  letterSpacing: "0.22em",
  color: COLORS.accentStrong,
};
const titleStyle: CSSProperties = {
  font: `800 34px/1.1 ${FONTS.body}`,
  letterSpacing: "-0.02em",
  color: COLORS.text,
  textShadow: "0 2px 18px rgba(0,0,0,0.5)",
};
const smallTextStyle: CSSProperties = { font: `400 12.5px/1.5 ${FONTS.body}`, color: COLORS.textFaint };
const groupTitleStyle: CSSProperties = {
  margin: 0,
  font: `700 13px/1 ${FONTS.body}`,
  letterSpacing: "0.04em",
  color: COLORS.textMuted,
};
const stepNumberStyle: CSSProperties = { font: `600 12px/1 ${FONTS.mono}`, letterSpacing: "0.1em" };

const tileStyle: CSSProperties = {
  appearance: "none",
  position: "relative",
  boxSizing: "border-box",
  // 축약형 border 를 쓰지 않는다 — 고른 칸이 borderColor 만 바꿀 때 React 가 경고하고 테가 지워진다
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  color: COLORS.textMuted,
  font: `500 14px/1.3 ${FONTS.body}`,
  cursor: "pointer",
  transition: `border-color ${MOTION.fast}, background ${MOTION.fast}, color ${MOTION.fast}, transform ${MOTION.fast}`,
};
const selectedTileStyle: CSSProperties = {
  borderColor: COLORS.accent,
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset",
};
const selectedLargeTileStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.06) 100%)",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.35) inset, 0 10px 30px rgba(255,255,255,0.18)",
};
const selectedTabStyle: CSSProperties = {
  borderColor: COLORS.accent,
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 100%)",
  boxShadow: `inset 0 -2px 0 ${COLORS.accent}`,
};
const smallTileStyle: CSSProperties = {
  ...tileStyle,
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  display: "grid",
  placeItems: "center",
  font: `500 13px/1 ${FONTS.body}`,
};
const checkMarkStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 20,
  height: 20,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: "#FFFFFF",
  color: "#0A0B0D",
  font: "800 11px/1 sans-serif",
};
const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))",
  gap: SPACING.m,
};

const swatchStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  padding: 0,
  border: "1px solid rgba(0,0,0,0.35)",
  borderRadius: 8,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  transition: `box-shadow ${MOTION.fast}, transform ${MOTION.fast}`,
};
const selectedSwatchStyle: CSSProperties = { boxShadow: `0 0 0 2px #0A121C, 0 0 0 4px ${COLORS.accent}` };

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

// 탭 아래 큰 칸 — 머리(제목) · 알림 · 스크롤되는 몸
const contentCardStyle: CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto 1fr",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  background: "rgba(8,9,11,0.45)",
  overflow: "hidden",
};

const segmentFrameStyle: CSSProperties = {
  display: "flex",
  gap: 2,
  padding: 4,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(8,9,11,0.7)",
  backdropFilter: "blur(10px)",
};
const segmentButtonStyle: CSSProperties = {
  appearance: "none",
  position: "relative", // 미끄러지는 상자 위로 글자가 오게
  zIndex: 1,
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  background: "none",
  color: COLORS.textMuted,
  font: `600 13px/1 ${FONTS.body}`,
  cursor: "pointer",
  transition: `background ${MOTION.fast}, color ${MOTION.fast}`,
};
const segmentHighlightStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 4,
  bottom: 4,
  borderRadius: 6,
  background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.12) 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  transition: "transform 280ms cubic-bezier(.2,.8,.2,1), width 280ms cubic-bezier(.2,.8,.2,1), opacity 160ms",
  pointerEvents: "none",
};

const textButtonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  background: "none",
  padding: "8px 10px",
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: COLORS.textMuted,
  font: `500 13px/1 ${FONTS.body}`,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: `color ${MOTION.fast}, background ${MOTION.fast}`,
};
const closeButtonStyle: CSSProperties = {
  ...tileStyle,
  position: "absolute",
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  padding: 0,
};

// 호버하면 위에서 아래로 빛이 번지는 그라데이션이 얹힌다(REDESIGN_CSS ::before)
const backButtonStyle: CSSProperties = {
  appearance: "none",
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.16)",
  borderRadius: 10,
  padding: "0 26px",
  height: 50,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "linear-gradient(180deg, rgba(52,56,62,0.95) 0%, rgba(30,33,37,0.98) 100%)",
  color: COLORS.text,
  font: `700 15px/1 ${FONTS.body}`,
  letterSpacing: "0.04em",
  cursor: "pointer",
  transition: `border-color ${MOTION.normal}, box-shadow ${MOTION.normal}, transform ${MOTION.fast}`,
};
const confirmButtonStyle: CSSProperties = {
  ...backButtonStyle,
  borderColor: "rgba(255,255,255,0.6)",
  padding: "0 32px",
  height: 52,
  background: "linear-gradient(180deg, #FFFFFF 0%, #E4E6E9 100%)",
  color: "#0A0B0D",
  font: `800 16px/1 ${FONTS.body}`,
  boxShadow: "0 8px 28px rgba(255,255,255,0.18)",
};
// 이름이 아직이어도 누를 수는 있다(이름 탭으로 데려간다) — 빛만 줄인다
const pendingConfirmStyle: CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.38) 100%)",
  color: "rgba(10,11,13,0.82)",
};

const nameInputStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "15px 18px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.28)",
  background: "rgba(6,7,9,0.8)",
  color: COLORS.text,
  font: `600 18px/1.3 ${FONTS.body}`,
  transition: `border-color ${MOTION.fast}, box-shadow ${MOTION.fast}`,
};
const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 1,
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 8,
  overflow: "hidden",
  background: "rgba(255,255,255,0.14)",
};
const summaryRowStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  padding: "12px 14px",
  background: "rgba(12,13,15,0.95)",
};

const modalBackdropStyle: CSSProperties = {
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

const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: SPACING.s,
  margin: `${SPACING.m}px ${SPACING.xl}px 0`,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid rgba(240,194,122,0.3)",
  background: "rgba(240,194,122,0.08)",
  color: COLORS.warning,
  font: `500 13px/1.5 ${FONTS.body}`,
};

// 개편 화면 전용 호버 반응 — 인라인 스타일로는 :hover 를 못 건다.
// 그라데이션은 부드럽게 안 넘어가서 가상 요소를 깔고 투명도만 바꾼다.
const REDESIGN_CSS = `
.cc-root .cc-tile:hover:not(:disabled):not([aria-pressed="true"]) { border-color: rgba(255,255,255,0.38); background: rgba(255,255,255,0.06); color: #fff; }
.cc-root .cc-tile:active:not(:disabled) { transform: translateY(1px); }
.cc-root .cc-tile:disabled { opacity: 0.5; cursor: progress; }
.cc-root .cc-swatch:hover { transform: translateY(-1px); }
.cc-root .cc-segment:hover:not([aria-pressed="true"]) { color: #fff; }
.cc-root .cc-text-button:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.06); }
.cc-root .cc-text-button:disabled { opacity: 0.35; cursor: default; }
.cc-root .cc-back::before, .cc-root .cc-confirm::before, .cc-root .cc-tile::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  opacity: 0; transition: opacity 220ms ease; pointer-events: none;
}
.cc-root .cc-back::before { background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0) 100%); }
.cc-root .cc-confirm::before { background: linear-gradient(135deg, #FFFFFF 0%, #CDD3DA 100%); }
.cc-root .cc-tile::before { background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 70%); }
.cc-root .cc-back:hover::before, .cc-root .cc-confirm:hover:not(:disabled)::before, .cc-root .cc-tile:hover:not(:disabled)::before { opacity: 1; }
.cc-root .cc-back:hover { border-color: rgba(255,255,255,0.4); }
.cc-root .cc-confirm:hover:not(:disabled) { box-shadow: 0 10px 34px rgba(255,255,255,0.28); }
.cc-root .cc-back:active, .cc-root .cc-confirm:active:not(:disabled) { transform: translateY(1px); }
.cc-root .cc-tile { isolation: isolate; overflow: hidden; }
.cc-root .cc-confirm:disabled { cursor: progress; filter: saturate(0.6); }
.cc-root input[type="text"]:focus, .cc-root input:not([type]):focus { border-color: ${COLORS.accent}; box-shadow: 0 0 0 3px rgba(255,255,255,0.14); outline: none; }
.cc-root .cc-slider-row .cc-fine { opacity: 0.45; transition: opacity 160ms; }
.cc-root *:focus-visible { outline-color: #FFFFFF; }
.cc-root input[type="range"]::-webkit-slider-thumb { background: #FFFFFF; box-shadow: 0 0 0 4px rgba(255,255,255,0.14); }
.cc-root input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 0 7px rgba(255,255,255,0.16); }
.cc-root input[type="range"]::-moz-range-thumb { background: #FFFFFF; }
.cc-root .cc-slider-row:hover .cc-fine, .cc-root .cc-slider-row:focus-within .cc-fine { opacity: 1; }
`;
