// 목적지 창의 내용. 나주 전설 글은 웹사이트 지역 소개(website/src/sections/home)와 같은 문구를 쓴다.

export const NAJU_LEGEND = {
  region: "나주",
  name: "앙암바위의 전설",
  description: "강가에 선 바위에 얽힌 오래된 이야기, 그 진짜 결말을 찾아내세요.",
  /** 카드에 커서를 올리면 흐르는 나주 진입 영상 */
  video: "/transitions/naju-enter.mp4",
  photo: "/destinations/naju.webp",
  stars: 3,
};

export interface LockedLegend {
  id: string;
  name: string;
  photo: string;
}

/**
 * 화살표로 넘기는 나주의 다른 전설. 아직 열리지 않아 이름만 걸어 둔다.
 * 사진은 나주 게임 화면을 어둡게 깐 자리 표시다. 전설이 만들어지면 그 사진으로 바꾼다.
 */
export const LOCKED_LEGENDS: readonly LockedLegend[] = [
  { id: "wansacheon", name: "완사천의 전설", photo: "/destinations/naju-ritual.webp" },
  { id: "deudeul", name: "드들강의 전설", photo: "/destinations/naju-cave.webp" },
  { id: "geumseong", name: "금성산의 전설", photo: "/destinations/naju-ferry.webp" },
  { id: "bulhoesa", name: "불회사 돌장승", photo: "/destinations/naju-birds.webp" },
];

/** 지도 이름표 자리. 도시가 전남에 몰려 있어 점 위에 못 찍고 바다로 빼낸다. */
interface MapTag {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Destination {
  id: string;
  name: string;
  /** 영문 이름 — 웹사이트 표기와 같다 */
  roman: string;
  /** 없으면 목록 칸을 사진 없이 바탕색으로 둔다 */
  photo?: string;
  lon: number;
  lat: number;
  isOpen: boolean;
  tag: MapTag;
}

const TAG_W = 104;
const TAG_H = 40;

/** 목록 순서가 곧 화면 순서다. 지금은 나주만 열려 있다. */
export const DESTINATIONS: readonly Destination[] = [
  {
    id: "naju",
    name: "나주",
    roman: "NAJU",
    photo: NAJU_LEGEND.photo,
    lon: 126.72,
    lat: 35.03,
    isOpen: true,
    tag: { x: 40, y: 410, w: 130, h: 58 },
  },
  {
    id: "yeosu",
    name: "여수",
    roman: "YEOSU",
    photo: "/destinations/yeosu.webp",
    lon: 127.66,
    lat: 34.76,
    isOpen: false,
    tag: { x: 386, y: 600, w: TAG_W, h: TAG_H },
  },
  {
    id: "mokpo",
    name: "목포",
    roman: "MOKPO",
    photo: "/destinations/mokpo.webp",
    lon: 126.39,
    lat: 34.81,
    isOpen: false,
    tag: { x: 40, y: 548, w: TAG_W, h: TAG_H },
  },
  {
    id: "muan",
    name: "무안",
    roman: "MUAN",
    lon: 126.48,
    lat: 34.99,
    isOpen: false,
    tag: { x: 40, y: 490, w: TAG_W, h: TAG_H },
  },
  {
    id: "buyeo",
    name: "부여",
    roman: "BUYEO",
    lon: 126.91,
    lat: 36.28,
    isOpen: false,
    tag: { x: 40, y: 358, w: TAG_W, h: TAG_H },
  },
  {
    id: "gyeongju",
    name: "경주",
    roman: "GYEONGJU",
    photo: "/destinations/gyeongju.webp",
    lon: 129.22,
    lat: 35.85,
    isOpen: false,
    tag: { x: 548, y: 407, w: TAG_W, h: TAG_H },
  },
];

export const DOKDO = { lon: 131.87, lat: 37.24 };
