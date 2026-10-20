import * as THREE from "three";

// 밤의 영산강 한 줄기. 강은 -z 로 흐르고 수면은 y = 0, 단위는 대략 미터다.
// 강가의 지금 건물들이 왜곡되며 옛 나루의 모습으로 바뀌고, 끝내 게임 에셋으로 굳는다 — story.ts · siteCatalog.ts.
// 셰이더와 JS 가 같은 값을 써야 하는 것(달 방향·색)만 여기 모은다.

/**
 * 달이 있는 쪽. 강을 내려가는 동안엔 화면 위로 비껴 있어 물 위 달빛 기둥과 하늘 번짐으로만 보이다가,
 * 앙암바위 앞에서 고개를 들면 절벽 왼쪽 위로 처음 온전히 드러난다.
 */
export const MOON_DIRECTION = new THREE.Vector3(0.22, 0.41, -0.885).normalize();

/** 사이트 팔레트(남색·청회색)를 밤 장면 값으로 옮긴 것. 게임 모습의 툰 색도 같은 남색 달빛 안에서 고른다. */
export const PALETTE = {
  zenith: new THREE.Color("#080e1b"),
  horizon: new THREE.Color("#42506f"),
  /** 안개에 달빛이 퍼진 색. 달 쪽으로 볼수록 이 색에 가까워진다. */
  moonHaze: new THREE.Color("#91a0c0"),
  moon: new THREE.Color("#e9eef8"),
  fog: new THREE.Color("#36425e"),
  land: new THREE.Color("#080c17"),
  water: new THREE.Color("#02040a"),
  /** 게임 모습으로 굳은 뒤의 산 — 겹마다 평평한 툰 색. */
  gameNear: new THREE.Color("#1b2f47"),
  gameFar: new THREE.Color("#6f8fb8"),
  /** 툰 윤곽선(먹선). */
  ink: new THREE.Color("#04070e"),
  /** 창·가로등·횃불의 따뜻한 빛. */
  lamp: new THREE.Color("#f0c890"),
  /** 왜곡 솔기와 봉인 글자의 빛 — 사이트 강조색(#9fb2ea). */
  seam: new THREE.Color("#9fb2ea"),
} as const;

/** 강 한가운데의 x. 크게 굽히면 둑 능선이 꺾이는 자리마다 판 끝이 드러나 살짝만 휜다. */
export function riverCenterX(z: number): number {
  return Math.sin(z * 0.011) * 7 + Math.sin(z * 0.027 + 1.3) * 3;
}

export const RIVER_HALF_WIDTH = 30;

/** 앙암바위가 서는 자리. 강 오른쪽 둑, 카메라가 다가오는 쪽을 향해 비스듬히 선다. */
export const CLIFF = {
  /** 판의 왼쪽 아래 — 물에 닿는 바위 발치. 강 오른쪽 절반으로 튀어나와 물길이 그 왼쪽으로 돈다. */
  position: new THREE.Vector3(2, -5, -268),
  /** 사진 칸의 높이(m). 가로는 그림 비율을 따른다. */
  height: 50,
  aspect: 1024 / 786,
  /** 앙암 정거장에 선 카메라를 마주 보게 돌린다. */
  rotationY: -0.4,
  /** 사진 속 물 닿는 선이 원근으로 기울어 있어 판을 그만큼 눕혀 수면과 나란하게 한다. */
  roll: -0.115,
} as const;

/** 장면 셰이더가 함께 읽는 값. 같은 객체를 나눠 써 한 번만 고치면 모두 바뀐다. */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uMoonDir: { value: MOON_DIRECTION.clone() },
    uZenith: { value: PALETTE.zenith.clone() },
    uHorizon: { value: PALETTE.horizon.clone() },
    uMoonHaze: { value: PALETTE.moonHaze.clone() },
    uMoonColor: { value: PALETTE.moon.clone() },
    uFogColor: { value: PALETTE.fog.clone() },
    // 이야기(story.ts) — 매 프레임 RiverScene 이 진행도에서 다시 계산해 넣는다.
    uDistort: { value: 0 },
    uGame: { value: 0 },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;
