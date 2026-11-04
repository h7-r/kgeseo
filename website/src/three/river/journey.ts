import type { SectionId } from "@/navigation/subMenus";
import { ANGAM_PIN_LENGTH } from "@/sections/home/homeLayout";

// 홈 구역과 배경 필름을 잇는 표. 진행도 0~1 이 필름 속 자리고, 홈의 어느 구역에 있는지가 진행도를 정한다.

interface JourneySection {
  id: SectionId;
  /** 구역이 화면 가운데 왔을 때의 진행도. 핀 구간은 [멈춤 시작, 멈춤 끝]. */
  at: number | readonly [number, number];
  /** 핀 구간이면 멈춘 동안의 스크롤 길이(무대 px). */
  pinLength?: number;
}

/** 홈 구역 순서. 바뀌는 순간마다 화면이 짧게 일그러진다(RiverFilm). */
export const JOURNEY_SECTIONS: readonly JourneySection[] = [
  { id: "intro", at: 0.03 },
  { id: "case-file", at: 0.2 },
  // 필름의 앙암바위 장면(0.72~0.84)에 맞춘다.
  { id: "angam", at: [0.72, 0.84], pinLength: ANGAM_PIN_LENGTH },
  { id: "legend-regions", at: 0.88 },
  { id: "scenarios", at: 0.92 },
  { id: "start", at: 0.97 },
];

/** 한 화면에 함께 걸리는 글 덩이 수의 한도. */
export const MAX_SCRIMS = 6;

/**
 * 필름이 매 프레임 읽는 입력. homeScroll 이 쓴다.
 * React 상태로 두면 스크롤마다 다시 그려지므로 그냥 값으로 둔다.
 */
export const journeyInput = {
  progress: 0,
  section: 0,
  /** 화면에 걸린 글 덩이 자리 [왼, 위, 오른, 아래](0~1, 왼쪽 위 기준). 필름이 이 자리만 어둡게 누른다. */
  scrims: Array.from({ length: MAX_SCRIMS }, (): [number, number, number, number] => [0, 0, 0, 0]),
  scrimCount: 0,
};
