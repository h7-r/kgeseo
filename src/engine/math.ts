// 보간·각도 계산. 범위 자르기는 THREE.MathUtils.clamp 를 쓴다.
// MathUtils.smoothstep 은 범위 밖을 잘라 버리고, degToRad 는 곱셈 한 번이라 끝자리가 달라 바꿔 끼우지 않는다.

/** 시작·끝 속도가 0 인 보간 비율. t 는 0~1 로 들어온다고 본다. */
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** 처음 빠르고 끝에서 부드럽게 멈추는 보간 비율. */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
