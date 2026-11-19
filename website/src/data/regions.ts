import REGION_POLICY from "../../../shared/regions.json";

/** 권역별로 묶어 17개 중 내 지역이 어디쯤인지 바로 보이게 한다. 목록은 저장소 공용 shared/regions.json — 백엔드도 같은 파일로 대조한다. */
export const REGION_GROUPS: readonly { name: string; regions: readonly string[] }[] = REGION_POLICY.groups;

/** 가입 검사가 받는 지역 이름 전부. 지역 선택 상자의 방향키 순서이기도 하다. */
export const REGIONS: readonly string[] = REGION_GROUPS.flatMap((group) => group.regions);
