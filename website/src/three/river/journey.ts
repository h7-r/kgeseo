import * as THREE from "three";

import type { SectionId } from "@/navigation/subMenus";
import { ANGAM_PIN_LENGTH, CASE_FILE_PIN_LENGTH } from "@/sections/home/homeLayout";

// 강을 내려가는 길 한 줄. 진행도 0~1 이 이 길 위의 자리고, 홈의 어느 구역에 있는지가 진행도를 정한다.

interface JourneySection {
  id: SectionId;
  /** 구역이 화면 가운데 왔을 때의 진행도. 핀 구간은 [멈춤 시작, 멈춤 끝]. */
  at: number | readonly [number, number];
  /** 핀 구간이면 멈춘 동안의 스크롤 길이(무대 px). */
  pinLength?: number;
}

/** 홈 구역 순서. 바뀌는 순간마다 화면이 짧게 일그러진다(FinishPass). */
export const JOURNEY_SECTIONS: readonly JourneySection[] = [
  { id: "intro", at: 0.03 },
  { id: "case-file", at: [0.13, 0.28], pinLength: CASE_FILE_PIN_LENGTH },
  { id: "legend-regions", at: 0.44 },
  { id: "scenarios", at: 0.58 },
  { id: "angam", at: [0.72, 0.84], pinLength: ANGAM_PIN_LENGTH },
  { id: "start", at: 0.95 },
];

interface Stop {
  t: number;
  position: THREE.Vector3Tuple;
  target: THREE.Vector3Tuple;
}

// 정거장. 구역이 화면 가운데 오는 순간 카메라가 서는 자리다(homeScroll 이 스크롤 → t 를 맞춘다).
const STOPS: readonly Stop[] = [
  // 소개 — 지금의 강. 다리와 오른쪽 둑의 불빛을 멀리서 본다.
  { t: 0, position: [-2, 16, 60], target: [12, 3, -60] },
  // 사건 파일 — 오른쪽 둑의 편의점·정류장·가로등 무리를 화면 오른쪽 절반에 크게 잡는다.
  // 핀 동안은 거의 서서 아주 조금만 다가간다 — 지나쳐 버리면 바뀌는 모습을 못 본다.
  { t: 0.13, position: [8, 5.5, 10], target: [32, 3.5, -34] },
  { t: 0.28, position: [11, 5, 2], target: [33, 3.5, -36] },
  // 지역·시나리오 — 강을 따라 흐르며 이미 섞인 마을 곁을 지난다.
  { t: 0.44, position: [2, 3.4, -70], target: [-14, 4, -150] },
  { t: 0.58, position: [-6, 3.6, -112], target: [20, 8, -250] },
  // 앙암 — 절벽 앞에 닿는다. 봉인 고리가 페이지의 앙암 사진 둘레에 맞물린다.
  { t: 0.72, position: [-14, 4, -150], target: [34, 19, -255] },
  { t: 0.84, position: [-10, 3.6, -166], target: [34, 21, -256] },
  // 마무리 — 조금 떠올라 앙암 곁의 섞인 마을과 절벽·달을 함께 본다(가운데 글은 하늘 위에 앉는다).
  { t: 1, position: [-12, 14, -168], target: [16, 18, -292] },
];

const positionCurve = new THREE.CatmullRomCurve3(
  STOPS.map(({ position }) => new THREE.Vector3(...position)),
  false,
  "centripetal",
);
const targetCurve = new THREE.CatmullRomCurve3(
  STOPS.map(({ target }) => new THREE.Vector3(...target)),
  false,
  "centripetal",
);

/** CatmullRom 은 점마다 같은 몫을 갖는다. 정거장 t 를 그 몫으로 옮겨 구간마다 다른 속도를 낸다. */
function curveParameter(t: number): number {
  const last = STOPS.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = STOPS[i].t;
    const b = STOPS[i + 1].t;
    if (t <= b) return (i + THREE.MathUtils.clamp((t - a) / (b - a), 0, 1)) / last;
  }
  return 1;
}

export function sampleJourney(t: number, position: THREE.Vector3, target: THREE.Vector3): void {
  const u = curveParameter(THREE.MathUtils.clamp(t, 0, 1));
  positionCurve.getPoint(u, position);
  targetCurve.getPoint(u, target);
}

/** 한 화면에 함께 걸리는 글 덩이 수의 한도. */
export const MAX_SCRIMS = 6;

/**
 * 장면이 매 프레임 읽는 입력. 홈에서는 homeScroll 이, 시험 화면에서는 슬라이더가 쓴다.
 * React 상태로 두면 스크롤마다 다시 그려지므로 그냥 값으로 둔다.
 */
export const journeyInput = {
  progress: 0,
  section: 0,
  /** 봉인이 맞물릴 원의 화면 자리 — 가운데(0~1, 왼쪽 위 기준)와 반지름(창 높이 비율). */
  sealAnchor: { x: 0.31, y: 0.47, radius: 0.24 },
  /** 화면에 걸린 글 덩이 자리 [왼, 위, 오른, 아래](0~1, 왼쪽 위 기준). 마무리 패스가 이 자리만 장면을 누른다. */
  scrims: Array.from({ length: MAX_SCRIMS }, (): [number, number, number, number] => [0, 0, 0, 0]),
  scrimCount: 0,
};

const middleOf = (at: JourneySection["at"]) => (typeof at === "number" ? at : (at[0] + at[1]) / 2);

/** 진행도만 알 때 어느 구역인지(시험 화면용). 홈은 스크롤 자리로 직접 정한다. */
export function sectionAtProgress(t: number): number {
  let index = 0;
  for (let i = 1; i < JOURNEY_SECTIONS.length; i += 1) {
    if (t >= (middleOf(JOURNEY_SECTIONS[i - 1].at) + middleOf(JOURNEY_SECTIONS[i].at)) / 2) index = i;
  }
  return index;
}
