/**
 * 개발 빌드 전용 — 서버 판정을 쓸 수 없을 때(대응표 확정 전 · 세션 없음)만 P09 를 로컬로 판정한다.
 * RingDoor 가 `if (import.meta.env.DEV)` 안에서만 동적으로 불러온다 → 배포 빌드에는 이 파일(판정)이 들어가지 않는다.
 * 규칙은 서버 판정으로 옮기기 전 RingDoor 가 각도로 하던 판정을 그대로 옮기고, 각도 대신 눈금 번호로 받는다.
 * 배포 빌드 결과물에 이 판정이 없는지는 빌드 뒤 따로 확인한다(DEV 조건만 믿지 않는다).
 */
import { RING_COUNT } from "./ringDoorAnswer";

/** 고리 셋의 눈금 번호가 개발용 판정에 맞는가 */
export function isLocalRingDoorCorrect(notches: readonly number[]): boolean {
  return notches.length === RING_COUNT && notches.every((notch) => notch === 0);
}
