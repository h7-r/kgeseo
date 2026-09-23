// 캐릭터 생성 화면이 보여 줄 선택지 목록(헤어·의상·색).
//
// [왜 따로 두나]
//   렌더러(치비게임아바타)는 `hair: 0`, `top: -1` 같은 **파츠 번호**로 움직인다. 번호는
//   모델을 다시 구우면 바뀔 수 있고, 저장한 캐릭터가 엉뚱한 옷을 입게 된다. 그래서 바깥으로
//   나가는 데이터에는 번호 대신 **변하지 않는 아이디**를 쓰고, 번호와의 대응은 여기 한 곳에만 둔다.
//
// [아이템 추가하는 법]
//   목록에 한 줄 더 적으면 화면의 카드가 자동으로 늘어난다. 다만 **모델·리깅·체형 대응은
//   자동으로 따라오지 않는다.** 새 옷은 그 옷을 입은 전신 GLB(meshy-*.glb)와 짝이 되는
//   신발 GLB 가 있어야 하고, 지원하지 않는 조합은 여기서 빼 둬야 한다.
import { 기본메시설정, 메시선택지 } from "../메시외형옵션.js";

// 목록이 바뀌면 올린다. 저장된 캐릭터를 다시 읽을 때 "어느 시점 목록으로 만든 것인가"를 안다.
export const 카탈로그판 = "2026-09-24";

export const 슬롯이름 = { hair: "헤어", top: "상의", bottom: "하의", shoes: "신발" };

// 아이템 한 줄
//   id      바깥으로 나가는 변하지 않는 이름. 절대 재사용하지 않는다.
//   슬롯    hair | top | bottom | shoes
//   성별    이 아이템을 쓸 수 있는 성별. 둘 다면 두 개를 적는다.
//   변형    치비게임아바타가 쓰는 파츠 번호(-1 = 없음). 렌더러 사정이라 바깥으로 안 나간다.
//   미착용  이 아이템이 "안 입음"인가(기본 속옷·맨발·민머리)
const 항목 = (id, 슬롯, 이름, 성별, 변형, 덧 = {}) => ({ id, 슬롯, 이름, 성별, 변형, 미착용: 변형 < 0, ...덧 });

// 썸네일은 **실제 모델을 찍어 구운 그림**이다(도구/캐릭터생성썸네일.mjs 가 gait 화면에서 잘라 낸다).
// 옷·신발은 몸이 달라 성별마다 한 장씩 둔다.
const 그림 = (이름) => `/thumbs/캐릭터생성/${이름}.png`;
const 성별그림 = (이름) => ({ masculine: 그림(`${이름}.m`), feminine: 그림(`${이름}.f`) });

// 그 성별에서 쓸 썸네일 한 장을 고른다.
export function 썸네일고르기(아이템, 성별) {
  const t = 아이템?.썸네일;
  if (!t) return null;
  return typeof t === "string" ? t : (t[성별] ?? null);
}

export const 기본카탈로그 = {
  판: 카탈로그판,
  아이템: [
    항목("hair.none", "hair", "민머리", ["masculine", "feminine"], -1, { 썸네일: 그림("hair.none") }),
    항목("hair.m.crop", "hair", "짧은 머리", ["masculine"], 0, { 썸네일: 그림("hair.m.crop") }),
    항목("hair.m.long", "hair", "긴 머리", ["masculine"], 1, { 썸네일: 그림("hair.m.long") }),
    항목("hair.f.bob", "hair", "단발", ["feminine"], 0, { 썸네일: 그림("hair.f.bob") }),
    항목("hair.f.long", "hair", "긴 머리", ["feminine"], 1, { 썸네일: 그림("hair.f.long") }),

    항목("top.none", "top", "입지 않음", ["masculine", "feminine"], -1, { 설명: "기본 속옷", 썸네일: 성별그림("top.none") }),
    항목("top.tee.white", "top", "흰 티셔츠", ["masculine", "feminine"], 0, { 썸네일: 성별그림("top.tee.white") }),

    항목("bottom.none", "bottom", "입지 않음", ["masculine", "feminine"], -1, { 설명: "기본 속옷", 썸네일: 성별그림("bottom.none") }),
    항목("bottom.shorts.black", "bottom", "검은 반바지", ["masculine", "feminine"], 0, { 썸네일: 성별그림("bottom.shorts.black") }),

    항목("shoes.none", "shoes", "맨발", ["masculine", "feminine"], -1, { 썸네일: 성별그림("shoes.none") }),
    항목("shoes.sneaker.white", "shoes", "흰 운동화", ["masculine", "feminine"], 0, { 썸네일: 성별그림("shoes.sneaker.white") }),
  ],
  // 처음 들어왔을 때의 착장 — 기본 속옷·맨발이다(요구 4장).
  신규기본: {
    masculine: { hair: "hair.m.crop", top: "top.none", bottom: "bottom.none", shoes: "shoes.none" },
    feminine: { hair: "hair.f.bob", top: "top.none", bottom: "bottom.none", shoes: "shoes.none" },
  },
  색상: 색상표(),
};

// ── 색 ────────────────────────────────────────────────────────
// [지금 재질이 실제로 할 수 있는 것]
//   색은 **원본 텍스처에 곱해진다.** 흰색이 "원본 그대로"이고, 곱셈이라 원본보다 밝게는 못 만든다.
//   그래서 팔레트는 전부 원본을 어둡게·물들이는 쪽이다. 피부의 '흰색'은 흰 피부가 아니라 원본이다.
//   피부와 의상을 따로 칠하는 것은 정점 표식(_TINT)이 있는 몸체 + 툰 재질일 때만 된다.
//   상·하의는 표식이 같아서 **한 색을 함께 쓴다.** 따로 고르는 것처럼 보여 주면 안 된다.
function 색상표() {
  return {
    skin: [
      ["#ffffff", "원본"],
      ["#f0d8c8", "밝게"],
      ["#e0b79c", "볕에 탄"],
      ["#c9926f", "짙게"],
      ["#a06b4a", "더 짙게"],
    ],
    hair: [
      ["#ffffff", "원본"],
      ["#d8c6a8", "밝은 갈색"],
      ["#9a6b44", "갈색"],
      ["#6b4a33", "짙은 갈색"],
      ["#3a3540", "검정"],
      ["#8d5a6a", "붉은 기"],
    ],
    cloth: [
      ["#ffffff", "원본"],
      ["#cfd8e6", "연회색"],
      ["#8fa6c4", "청회색"],
      ["#6f8f7a", "카키"],
      ["#b08a86", "흙분홍"],
      ["#5a5f6b", "짙은 회색"],
    ],
  };
}

export const 색상슬롯이름 = { skin: "피부", hair: "머리카락", cloth: "의상" };

// ── 조회 도우미 ───────────────────────────────────────────────
export function 아이템찾기(카탈로그, id) {
  return 카탈로그.아이템.find((it) => it.id === id) ?? null;
}

export function 슬롯목록(카탈로그, 슬롯, 성별) {
  return 카탈로그.아이템.filter((it) => it.슬롯 === 슬롯 && it.성별.includes(성별));
}

// 그 성별이 쓸 수 있는 기본값. 호환되지 않는 아이템을 대신할 때도 쓴다.
export function 슬롯기본(카탈로그, 슬롯, 성별) {
  const id = 카탈로그.신규기본?.[성별]?.[슬롯];
  const 후보 = 아이템찾기(카탈로그, id);
  if (후보 && 후보.슬롯 === 슬롯 && 후보.성별.includes(성별)) return 후보;
  const 목록 = 슬롯목록(카탈로그, 슬롯, 성별);
  return 목록.find((it) => it.미착용) ?? 목록[0] ?? null;
}

// 렌더러가 이 슬롯에서 실제로 아는 번호인지 — 목록에 없는 번호를 넘기면 아무것도 안 보인다.
export function 렌더러가아는번호(슬롯, 성별, 번호) {
  const 목록 = 메시선택지[슬롯]?.[성별] ?? [];
  return 목록.some(([값]) => 값 === 번호);
}

// 화면이 직접 손대지 않는 렌더러 기본값(어깨 1.2, 팔 길이 0.88 같은 보정된 값)을 그대로 쓴다.
export const 렌더러기본 = 기본메시설정;
