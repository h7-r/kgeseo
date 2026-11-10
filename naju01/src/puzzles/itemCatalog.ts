/**
 * 나주 사건의 물건 종류와 이름 · 설명. 게임 소지품(inventory.ts)과 웹사이트 마이페이지가 같이 읽는다.
 * React · three · 별칭을 쓰지 않는다 — 웹사이트 빌드와 node 테스트가 그대로 불러온다.
 */

export type ItemKind =
  | "lightFish"
  | "rice"
  | "makgeolli"
  | "floatStone"
  | "gearStone"
  | "pearl"
  | "bigPearl"
  | "scale"
  | "letterBox"
  | "bronzeKey"
  | "strawShoe"
  | "serpentFigure"
  | "bowlLarge"
  | "bowlMedium"
  | "bowlSmall"
  | "dewBowlLarge"
  | "dewBowlMedium"
  | "dewBowlSmall"
  | "emptyJug"
  | "waterJug"
  | "arangPouch"
  | "shellRings"
  | "pineTorch";

export interface ItemDef {
  name: string;
  description: string;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  lightFish: {
    name: "빛 물고기",
    description: "통발 바닥에 남은 한 마리. 그날 밤 꺼진 화톳불의 불티라 아직 따뜻하다.",
  },
  rice: { name: "쌀", description: "장독대 큰 항아리에 들어 있던 쌀 한 자루. 제물로 올릴 수 있다." },
  floatStone: { name: "뜬 돌", description: "물이 차오르자 떠오른 돌. 구멍이 숭숭해 가볍다." },
  makgeolli: {
    name: "막걸리",
    description: "안쪽 배에 남아 있던 흰 술병. 입구가 꼭 막혀 막걸리가 그대로 들어 있다. 제물로 올릴 수 있다.",
  },
  gearStone: {
    name: "톱니돌",
    description: "테두리에 톱니가 난 납작한 돌. 강 밑 큰 방에서 찾았다. 고리문 옆 홈에 꼭 맞을 크기다.",
  },
  pearl: {
    name: "진주",
    description:
      "강 밑에서 물고기 떼를 돌 고리 안으로 몰아넣자 모래에서 떠오른 진주. 은은히 빛난다. 어디에 쓰는지는 아직 모른다.",
  },
  bigPearl: {
    name: "큰 진주",
    description:
      "큰 조개 속에서 빛을 받아 드러난 주먹만 한 진주. 손안에서도 은은히 빛난다. 어디에 쓰는지는 아직 모른다.",
  },
  scale: {
    name: "푸른 눈물",
    description:
      "강 밑 석실 제단에 놓여 있던 푸른 눈물 한 방울. 비늘처럼 생겼고 손바닥만 하며 얼음처럼 차다. 어디에 쓰는지는 아직 모른다.",
  },
  strawShoe: {
    name: "짚신 한 짝",
    description:
      "검은 줄 통발에 걸려 올라온 큰 짚신 한 짝. 물에 불어 무겁다. 신코 안쪽에 물고기 하나가 새겨져 있다 — 어부가 제 신에 새기던 표시. 주인은 끝내 신으러 오지 않았다.",
  },
  letterBox: {
    name: "아랑사의 함",
    description:
      "물살에 떠밀려 나올 때 함께 건져 온 옻칠한 나무 함. 젖지 않았다. 청동 자물통이 채워져 있어 열쇠가 있어야 열린다. 흔들면 안에서 무언가 달그락거린다.",
  },
  bronzeKey: {
    name: "청동 열쇠",
    description:
      "증언 능선의 돌새가 물고 있던 청동 열쇠. 대가 길고 끝이 꺾였다 — 아랑사의 함에 채워진 자물통 구멍에 꼭 맞을 것 같다.",
  },
  serpentFigure: {
    name: "구렁이상",
    description:
      "아랑사의 함 바닥에 남아 있던 손바닥만 한 구렁이상. 똬리를 틀고 고개를 든 모양이다. 어부의 함에 왜 이것이 들어 있었을까.",
  },
  bowlLarge: {
    name: "큰 사발",
    description: "독 곁에 엎어져 있던 큰 흰 사발. 굽이 넓고 닳았다 — 누가 여기 두고 오래 썼다. 비어 있다.",
  },
  bowlMedium: {
    name: "사발",
    description: "너럭바위에 엎어져 있던 흰 사발. 굽이 닳았다. 비어 있다.",
  },
  bowlSmall: {
    name: "작은 사발",
    description: "선바위 발치에 엎어져 있던 작은 흰 사발. 한 손에 쏙 들어온다. 비어 있다.",
  },
  dewBowlLarge: { name: "물 담은 큰 사발", description: "독의 빗물을 가득 뜬 큰 사발. 물낯에 달이 내려앉는다." },
  dewBowlMedium: { name: "물 담은 사발", description: "독의 빗물을 가득 뜬 사발. 물낯에 달이 내려앉는다." },
  dewBowlSmall: { name: "물 담은 작은 사발", description: "독의 빗물을 뜬 작은 사발. 물낯에 달이 내려앉는다." },
  emptyJug: {
    name: "귀때동이",
    description:
      "흙에 묻혀 있던 귀때동이. 부리가 있어 물을 한곳에 뿌리기 좋다. 비어 있다 — 독에서 물을 퍼 담을 수 있다.",
  },
  waterJug: {
    name: "물 담은 귀때동이",
    description: "독의 물을 퍼 담은 귀때동이. 부리로 물을 한곳에 뿌릴 수 있다. 세 번 뿌릴 만큼 들었다.",
  },
  arangPouch: {
    name: "아랑사의 주머니",
    description:
      "굵은 삼베를 기워 만든 주머니. 그물 실로 아가리를 졸라맸다. 귀퉁이에 물고기 하나가 수놓여 있다 — 나루터 짚신 코에 새겨져 있던 그 표시다. 안에 접은 편지 두 장과 조가비 가락지 한 쌍이 들어 있었다(편지는 [H] 힌트함에서 다시 읽는다).",
  },
  shellRings: {
    name: "조가비 가락지 한 쌍",
    description:
      "강조개 껍데기를 갈아 만든 가락지 두 짝. 하나는 굵고 하나는 가늘다. 아랑사가 아비사에게 끼워 주려던 것 — 끝내 건네지 못했다.",
  },
  pineTorch: {
    name: "관솔불",
    description: "송진이 밴 소나무 가지에 화로의 불씨를 옮겨 붙였다. 꺼진 횃불에 대면 불이 옮겨붙는다.",
  },
};
