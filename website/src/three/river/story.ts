import * as THREE from "three";

/** 흔들림이 가라앉기 시작하고 멎는 진행도(journey 의 앙암 구간과 같다). */
const CALM_FROM = 0.72;
const CALM_TO = 0.84;

const { smoothstep } = THREE.MathUtils;

/** 「왜곡」으로 화면이 일렁이는 정도. 사건 파일에서 커지고 앙암 앞에서 가라앉는다. */
export function distortAt(t: number): number {
  return smoothstep(t, 0.06, 0.2) * (1 - smoothstep(t, CALM_FROM, CALM_TO));
}
