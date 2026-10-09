// 캐릭터 생성 화면이 보여 줄 선택지 목록(헤어·의상·색).
//
// 렌더러(ChibiGameAvatar)는 `hair: 0`, `top: -1` 같은 파츠 번호로 움직인다. 번호는 모델을 다시 구우면 바뀔 수
// 있어 바깥으로 나가는 데이터에는 변하지 않는 아이디를 쓰고, 번호와의 대응은 여기 한 곳에만 둔다.
// 목록에 한 줄 더 적으면 카드가 늘어나지만 모델·리깅은 따라오지 않는다 — 새 옷은 그 옷을 입은 전신 GLB 와
// 짝이 되는 신발 GLB 가 있어야 하고, 지원하지 않는 조합은 여기서 빼 둔다.
import { DEFAULT_MESH_CONFIG, MESH_PART_OPTIONS } from "../avatar/meshAppearance";
import type { AvatarGender, Option } from "../avatar/sidekickOptions";

// 목록이 바뀌면 올린다. 저장된 캐릭터가 어느 목록으로 만든 것인지 안다.
const CATALOG_VERSION = "2026-09-24";

/** 생성 화면 썸네일·배경 그림 폴더 */
export const THUMBNAIL_DIR = "/thumbs/character-creation";

export type CatalogSlot = "hair" | "top" | "bottom" | "shoes";
export type ColorSlot = "skin" | "hair" | "cloth" | "bottom" | "shoes";

export const SLOT_LABELS: Record<CatalogSlot, string> = { hair: "헤어", top: "상의", bottom: "하의", shoes: "신발" };

export interface CatalogItem {
  /** 바깥으로 나가는 변하지 않는 이름. 절대 재사용하지 않는다. */
  id: string;
  slot: CatalogSlot;
  label: string;
  /** 이 아이템을 쓸 수 있는 성별 */
  genders: readonly AvatarGender[];
  /** 렌더러 파츠 번호(-1 = 없음). 바깥으로 안 나간다. */
  variant: number;
  /** 기본 속옷·맨발·민머리처럼 「안 입음」인가 */
  isNone: boolean;
  description?: string;
  /** 한 장이거나, 몸이 달라 성별마다 한 장씩 */
  thumbnail?: string | Record<AvatarGender, string>;
}

export interface CharacterCatalog {
  version: string;
  items: readonly CatalogItem[];
  /** 처음 들어왔을 때의 착장(아이템 id) */
  newDefaults?: Partial<Record<AvatarGender, Partial<Record<CatalogSlot, string>>>>;
  palettes: Record<ColorSlot, readonly Option<string>[]>;
}

function defineCatalogItem(
  id: string,
  slot: CatalogSlot,
  label: string,
  genders: readonly AvatarGender[],
  variant: number,
  extra: Pick<CatalogItem, "description" | "thumbnail"> = {},
): CatalogItem {
  return { id, slot, label, genders, variant, isNone: variant < 0, ...extra };
}

// 썸네일은 실제 모델을 찍어 구운 그림이다(tools/character-thumbnails.mjs 가 gait 화면에서 잘라 낸다).
const thumbnailUrl = (name: string) => `${THUMBNAIL_DIR}/${name}.png`;
const genderThumbnailUrls = (name: string) => ({
  masculine: thumbnailUrl(`${name}.m`),
  feminine: thumbnailUrl(`${name}.f`),
});

const BOTH: readonly AvatarGender[] = ["masculine", "feminine"];

/** 그 성별에서 쓸 썸네일 한 장 */
export function getItemThumbnail(target: CatalogItem | null | undefined, gender: AvatarGender): string | null {
  const thumb = target?.thumbnail;
  if (!thumb) return null;
  return typeof thumb === "string" ? thumb : (thumb[gender] ?? null);
}

// 색은 원본 텍스처에 곱해진다 — 흰색이 「원본 그대로」이고 원본보다 밝게는 못 만든다. 그래서 팔레트는 전부
// 원본을 어둡게·물들이는 쪽이다(피부 「흰색」은 흰 피부가 아니라 원본). 피부와 의상을 따로 칠하는 것은 정점 표식(_tint)이
// 있는 몸체 + 툰 재질일 때만 되고, 상의(2)·하의(3) 표식은 따로다. 신발은 따로 된 GLB 라 재질 색을 곱한다.
const PALETTES: CharacterCatalog["palettes"] = {
  skin: [
    ["#ffffff", "원본"],
    ["#f0d8c8", "밝게"],
    ["#e0b79c", "볕에 탄"],
    ["#c9926f", "짙게"],
    ["#a06b4a", "더 짙게"],
  ],
  hair: [
    ["#ffffff", "원본"],
    ["#e6d2ae", "밀빛"],
    ["#d8b48a", "밝은 갈색"],
    ["#b0805a", "캐러멜"],
    ["#9a6b44", "갈색"],
    ["#6b4a33", "짙은 갈색"],
    ["#4a3628", "흑갈색"],
    ["#2e2a30", "흑발"],
    ["#9aa3ad", "애쉬 그레이"],
    ["#b3746c", "로즈 브라운"],
    ["#8d4a52", "와인"],
    ["#5c6f8f", "블루 블랙"],
  ],
  // 흰 티셔츠를 물들인다
  cloth: [
    ["#ffffff", "원본"],
    ["#e9e4d8", "아이보리"],
    ["#cfd8e6", "연회색"],
    ["#8fa6c4", "청회색"],
    ["#5b7aa6", "네이비"],
    ["#6f8f7a", "카키"],
    ["#c2a46b", "머스터드"],
    ["#b08a86", "흙분홍"],
    ["#9c5b5b", "버건디"],
    ["#5a5f6b", "차콜"],
    ["#2d3036", "블랙"],
  ],
  // 검은 반바지라 밝은 색은 거의 안 먹는다 — 짙은 계열 위주
  bottom: [
    ["#ffffff", "원본"],
    ["#c9ccd2", "회색 빛"],
    ["#8fa6c4", "청 빛"],
    ["#7d8c6f", "올리브 빛"],
    ["#a08070", "갈색 빛"],
    ["#5a5f6b", "더 짙게"],
  ],
  // 흰 운동화를 물들인다
  shoes: [
    ["#ffffff", "원본"],
    ["#e9e4d8", "아이보리"],
    ["#cfd8e6", "연회색"],
    ["#8fa6c4", "청회색"],
    ["#c2a46b", "베이지"],
    ["#9c5b5b", "버건디"],
    ["#5a5f6b", "차콜"],
    ["#2d3036", "블랙"],
  ],
};

export const DEFAULT_CATALOG: CharacterCatalog = {
  version: CATALOG_VERSION,
  items: [
    defineCatalogItem("hair.none", "hair", "민머리", BOTH, -1, { thumbnail: thumbnailUrl("hair.none") }),
    defineCatalogItem("hair.m.crop", "hair", "짧은 머리", ["masculine"], 0, { thumbnail: thumbnailUrl("hair.m.crop") }),
    defineCatalogItem("hair.m.long", "hair", "긴 머리", ["masculine"], 1, { thumbnail: thumbnailUrl("hair.m.long") }),
    defineCatalogItem("hair.f.bob", "hair", "단발", ["feminine"], 0, { thumbnail: thumbnailUrl("hair.f.bob") }),
    defineCatalogItem("hair.f.long", "hair", "긴 머리", ["feminine"], 1, { thumbnail: thumbnailUrl("hair.f.long") }),

    defineCatalogItem("top.none", "top", "입지 않음", BOTH, -1, {
      description: "기본 속옷",
      thumbnail: genderThumbnailUrls("top.none"),
    }),
    defineCatalogItem("top.tee.white", "top", "흰 티셔츠", BOTH, 0, {
      thumbnail: genderThumbnailUrls("top.tee.white"),
    }),

    defineCatalogItem("bottom.none", "bottom", "입지 않음", BOTH, -1, {
      description: "기본 속옷",
      thumbnail: genderThumbnailUrls("bottom.none"),
    }),
    defineCatalogItem("bottom.shorts.black", "bottom", "검은 반바지", BOTH, 0, {
      thumbnail: genderThumbnailUrls("bottom.shorts.black"),
    }),

    defineCatalogItem("shoes.none", "shoes", "맨발", BOTH, -1, { thumbnail: genderThumbnailUrls("shoes.none") }),
    defineCatalogItem("shoes.sneaker.white", "shoes", "흰 운동화", BOTH, 0, {
      thumbnail: genderThumbnailUrls("shoes.sneaker.white"),
    }),
  ],
  // 티셔츠·반바지·운동화 차림으로 시작한다. 속옷만 보고 싶으면 「속옷으로 체형 보기」를 켜면 된다.
  newDefaults: {
    masculine: {
      hair: "hair.m.crop",
      top: "top.tee.white",
      bottom: "bottom.shorts.black",
      shoes: "shoes.sneaker.white",
    },
    // 여성 긴 머리는 귀 문제가 있어 처음 값으로 쓰지 않는다(고르면 된다)
    feminine: { hair: "hair.f.bob", top: "top.tee.white", bottom: "bottom.shorts.black", shoes: "shoes.sneaker.white" },
  },
  palettes: PALETTES,
};

export const COLOR_SLOT_LABELS: Record<ColorSlot, string> = {
  skin: "피부",
  hair: "헤어",
  cloth: "상의",
  bottom: "하의",
  shoes: "신발",
};

export function findItem(catalog: CharacterCatalog, id: string | null | undefined): CatalogItem | null {
  return catalog.items.find((it) => it.id === id) ?? null;
}

export function getSlotItems(catalog: CharacterCatalog, slot: CatalogSlot, gender: AvatarGender): CatalogItem[] {
  return catalog.items.filter((it) => it.slot === slot && it.genders.includes(gender));
}

/** 그 성별이 쓸 수 있는 기본값. 호환되지 않는 아이템을 대신할 때도 쓴다. */
export function getSlotDefault(catalog: CharacterCatalog, slot: CatalogSlot, gender: AvatarGender): CatalogItem | null {
  const candidate = findItem(catalog, catalog.newDefaults?.[gender]?.[slot]);
  if (candidate && candidate.slot === slot && candidate.genders.includes(gender)) return candidate;
  const items = getSlotItems(catalog, slot, gender);
  return items.find((it) => it.isNone) ?? items[0] ?? null;
}

/** 렌더러가 이 슬롯에서 아는 번호인가 — 모르는 번호를 넘기면 아무것도 안 보인다. */
export function isKnownVariant(slot: CatalogSlot, gender: AvatarGender, variant: number): boolean {
  return MESH_PART_OPTIONS[slot][gender].some(([value]) => value === variant);
}

/** 화면이 손대지 않는 렌더러 기본값(어깨 1.2, 팔 길이 0.88 처럼 보정된 값) */
export const RENDERER_DEFAULTS = DEFAULT_MESH_CONFIG;
