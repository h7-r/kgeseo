/** 권역별로 묶어 17개 중 내 지역이 어디쯤인지 바로 보이게 한다. */
export const REGION_GROUPS = [
  { name: "수도권", regions: ["서울", "인천", "경기"] },
  { name: "강원", regions: ["강원"] },
  { name: "충청", regions: ["대전", "세종", "충북", "충남"] },
  { name: "전라", regions: ["광주", "전북", "전남"] },
  { name: "경상", regions: ["부산", "대구", "울산", "경북", "경남"] },
  { name: "제주", regions: ["제주"] },
] as const;

/** 가입 검사가 받는 지역 이름 전부. 지역 선택 상자의 방향키 순서이기도 하다. */
export const REGIONS: readonly string[] = REGION_GROUPS.flatMap((group) => group.regions);
