// 팀 캐릭터 카탈로그 — 플레이어 카탈로그 + 팀 전용 옷(캡 · 해병대 반팔, 검토 22회차). 팀 꾸미기 창이 선택지로 쓰고,
// 로비 화면이 방 상태의 look(아이템 ID)을 렌더러 파츠 번호로 바꿀 때 쓴다(플레이어 아이템은 그대로라 상위 집합이다).
// 플레이어 생성 화면 · 서버의 사람 허용 목록에는 없다. ID 는 서버(lobby/src/npc/teamRoster.ts TEAM_LOOK_ITEMS)가 정하고,
// 여기서 이름 · 번호를 붙인다 — 서버 ID 가 늘면 아래 표가 빠졌다고 타입 검사가 알려 준다.
import { TEAM_LOOK_ITEMS, type TeamGender, type TeamLookItemId } from "../../lobby/src/npc/teamRoster";
import { TEAM_CAP_HAIR_OFFSET, TEAM_MARINE_TOP, TEAM_PANTS_BY_BOTTOM } from "../../naju01/src/avatar/teamOutfit";
import {
  DEFAULT_CATALOG,
  THUMBNAIL_DIR,
  type CatalogItem,
  type CharacterCatalog,
} from "../../naju01/src/characterCreation/catalog";

type TeamItemInfo = Pick<CatalogItem, "slot" | "label" | "variant" | "description" | "thumbnail">;

// 썸네일은 실제 모델을 찍어 구운 그림이다(tools/team-npc-thumbnails.mjs — 기존 카드와 같은 화면 · 자르기)
const thumbnail = (name: string) => `${THUMBNAIL_DIR}/${name}.png`;
const bottomOf = (style: string) =>
  Number(Object.entries(TEAM_PANTS_BY_BOTTOM).find(([, value]) => value === style)?.[0] ?? -1);
const cap = (label: string, base: number, name: string): TeamItemInfo => ({
  slot: "hair",
  label,
  variant: TEAM_CAP_HAIR_OFFSET + base,
  description: "팀 전용 캡",
  thumbnail: thumbnail(name),
});

const TEAM_ITEM_INFO: Record<TeamLookItemId, TeamItemInfo> = {
  "hair.cap.none": cap("민머리 + 캡", -1, "hair.cap.none"),
  "hair.m.crop.cap": cap("짧은 머리 + 캡", 0, "hair.m.crop.cap"),
  "hair.m.long.cap": cap("긴 머리 + 캡", 1, "hair.m.long.cap"),
  "hair.f.bob.cap": cap("단발 + 캡", 0, "hair.f.bob.cap"),
  "hair.f.long.cap": cap("긴 머리 + 캡", 1, "hair.f.long.cap"),
  "top.tee.marine": {
    slot: "top",
    label: "해병대 반팔",
    variant: TEAM_MARINE_TOP,
    description: "팀 전용 · 빨강 바탕, 가슴에 노란 「해병대」 · 등에 닻 마크(상의 색은 따르지 않는다)",
    thumbnail: { masculine: thumbnail("top.tee.marine.m"), feminine: thumbnail("top.tee.marine.f") },
  },
  "bottom.jeans.skinny": {
    slot: "bottom",
    label: "스키니 청바지",
    variant: bottomOf("jeans"),
    description: "팀 전용 · 발목까지 붙는 청바지(하의 색 「원본」이면 데님 파랑)",
    thumbnail: { masculine: thumbnail("bottom.jeans.skinny.m"), feminine: thumbnail("bottom.jeans.skinny.f") },
  },
  "bottom.pants.baggy": {
    slot: "bottom",
    label: "통 큰 바지",
    variant: bottomOf("baggy"),
    description: "팀 전용 · 밑단으로 갈수록 넓은 힙한 바지(하의 색 「원본」이면 짙은 회색)",
    thumbnail: { masculine: thumbnail("bottom.pants.baggy.m"), feminine: thumbnail("bottom.pants.baggy.f") },
  },
};

function gendersOf(id: TeamLookItemId): TeamGender[] {
  const genders: TeamGender[] = [];
  for (const perGender of Object.values(TEAM_LOOK_ITEMS)) {
    for (const gender of ["masculine", "feminine"] as const) {
      if ((perGender[gender] as readonly string[]).includes(id) && !genders.includes(gender)) genders.push(gender);
    }
  }
  return genders;
}

const TEAM_ITEMS: CatalogItem[] = (Object.keys(TEAM_ITEM_INFO) as TeamLookItemId[]).map((id) => {
  const info = TEAM_ITEM_INFO[id];
  return { id, ...info, genders: gendersOf(id), isNone: info.variant < 0 };
});

export const TEAM_CATALOG: CharacterCatalog = {
  ...DEFAULT_CATALOG,
  items: [...DEFAULT_CATALOG.items, ...TEAM_ITEMS],
};
