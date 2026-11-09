/**
 * 굿판(5스테이지) — 바위 아래 물가, 금줄 둘레. 말뚝 횃불 다섯에 그림패가 하나씩 걸린다.
 * 좌표는 미터.
 */
import * as THREE from "three";

/** 소반 — 기우제 때의 그 상(ritual/magicCircle 의 가운데). top 은 상판 높이 */
export const TABLE = { x: 45, z: 37, top: 0.38 };
/** 가락지 한 쌍이 놓이는 자리(소반 가운데에서) — 제물 셋 사이 빈 데 · 눈에 띄게 키우는 배 */
export const RINGS_ON_TABLE = { x: 0.14, z: 0.11, scale: 1.15 };
/**
 * 횃불대 다섯 — 소반을 가운데 두고 넓게 둘러선다. 금줄 기둥(42.7 · 47.3)과 돌탑 둘레(반지름 2.2 m)보다 바깥이다.
 * 사람 키를 넘는다 — 불은 머리 위에서 타고, 그림패는 눈높이에서 소반 쪽을 보고 걸린다
 */
const STAKE_RING = 3.6;
export const STAKES = [36, 108, 180, 252, 324].map((degrees) => {
  const angle = THREE.MathUtils.degToRad(degrees);
  return { x: TABLE.x + STAKE_RING * Math.sin(angle), z: TABLE.z + STAKE_RING * Math.cos(angle) };
});
export const STAKE_HEIGHT = 2.3;
/** 그림패 가운데 높이(미터) · 횃불대에서 소반 쪽으로 나온 거리(미터) */
export const TAG_HEIGHT = 1.45;
export const TAG_REACH = 0.42;
/** 화톳불 — 소반 곁, 세 발 받침 위의 쇠 화덕. 바람이 횃불을 다 꺼도 여기 불은 남는다. size 는 키(미터) */
export const BRAZIER = { x: 45.75, z: 37.85, size: 0.85 };
/** 가락지를 올리면 이는 돌풍(초) — 불기 시작 · 횃불이 차례로 꺼지는 간격 · 잦아드는 때 */
export const GUST = { at: 0.7, each: 0.16, calmFrom: 2.6, calmBy: 4.4 };
/** 화덕에 꽂아 둔 관솔 가지 — 화덕 가운데에서의 자리(미터)와 기운 각(라디안). 첫째 것을 뽑아 든다 */
export const BRAZIER_STICKS = [
  { x: 0.03, z: 0.06, tilt: [0.42, 0.1] },
  { x: -0.08, z: -0.02, tilt: [-0.16, 0.44] },
  { x: 0.08, z: -0.06, tilt: [-0.3, -0.36] },
] as const;

interface RiteTag {
  /** 겨눌 때 뜨는 이름 */
  title: string;
  /** 살펴볼 때의 말 */
  look: string;
  /** 제 차례에 불이 붙었을 때의 말 */
  told: string;
}
/**
 * 그림패 다섯 — 그 밤부터의 일들. 그림은 앞에서 본 두 영상의 장면이다(tagArt). **이 차례가 일이 일어난 차례다**(판정이 이 차례를 본다).
 * 서버 판정으로 옮길 때는 차례를 여기서 빼고 말뚝 번호만 보낸다.
 */
export const TAGS: readonly RiteTag[] = [
  {
    title: "초롱 든 사내",
    look: "달 앞 벼랑 위를 초롱 든 사내가 걷는다. 함에서 솟은 빛 속에서 본 장면이다.",
    told: "아랑사는 그 밤도 초롱을 들고 바위에 올랐다.",
  },
  {
    title: "미끄러진 발",
    look: "벼랑 끝에서 뒤꿈치가 미끄러진다. 함에서 솟은 빛 속에서 본 장면이다.",
    told: "벼랑 끝에서 발이 미끄러졌다. 숨어 있던 셋이 보는 앞이었다.",
  },
  {
    title: "물 세 그릇",
    look: "달 아래 여인이 물 세 그릇 앞에 무릎을 꿇었다. 선바위에 비친 장면이다.",
    told: "아비사는 그 뒤로도 밤마다 바위에 올라 물 세 그릇을 떠 놓았다.",
  },
  {
    title: "바위 틈의 구렁이",
    look: "벼랑 끝 바위 틈에서 긴 목이 달을 가리며 올라온다. 선바위에 비친 장면이다.",
    told: "떨어진 그 틈에서 구렁이가 올라와 곁에 누웠다.",
  },
  {
    title: "횃불 든 사내들",
    look: "횃불을 든 사내들이 길 쪽에서 올라온다. 여인이 그 앞을 막아섰다. 선바위에 비친 장면이다.",
    told: "횃불 든 사내들이 바위에 올라왔다 — 그 뒤의 일은 아무도 말하지 않는다.",
  },
];
/** 말뚝마다 걸린 그림패 번호 — 둘레를 돌며 보면 차례가 뒤섞여 있다 */
export const STAKE_TAGS = [3, 0, 4, 2, 1] as const;

/**
 * 굿이 풀린 뒤의 차례(초).
 *   rise 불기둥이 다 솟는 데 걸리는 시간 · descendAt 불길이 횃불대를 타고 내려오기 시작 · runAt 땅을 달리기 시작
 *   igniteAt 소반에 불이 붙음 · ringsAt 가락지가 떠오르기 시작 · dawnAt 날이 개기 시작(가락지가 오르는 중) · burntAt 소반이 다 탐 · endAt 불이 다 잦아듦
 * height 는 불기둥 높이, ringsRise 는 가락지가 오르는 높이(미터)
 */
export const FINALE = {
  rise: 1.4,
  descendAt: 5,
  runAt: 6.4,
  igniteAt: 8.4,
  ringsAt: 9.6,
  // 날은 소반의 불이 아니라 가락지가 하늘로 오르면서 갠다 — 가락지가 한참 떠오른 뒤에
  dawnAt: 12.2,
  burntAt: 13,
  endAt: 17,
  height: 16,
  ringsRise: 13,
};
