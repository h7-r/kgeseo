/**
 * P09 물레 고리문 — 서버로 보내는 답의 모양. 정답은 들어 있지 않다(서버에만).
 * 고리마다 지금 틈이 가리키는 바퀴 눈금 번호(0~35)를 [바깥, 가운데, 안쪽] 차례로 쉼표로 잇는다. 예: [7, 18, 35] → "7,18,35".
 * 눈금 번호는 바퀴 얼굴에 새긴 숫자 그대로다 — 위가 0, 문을 마주 보고 왼쪽으로 돌며 하나씩 는다(RingDoor 의 gapNotch).
 * 물레를 돌린 누적 횟수가 아니다. 서버는 공백을 지우고 비교한다(backend normalize_answer) — 공백 · 앞자리 0 을 넣지 않는다.
 */
export const RING_COUNT = 3;
export const NOTCH_COUNT = 36;

export function ringDoorAnswer(notches: readonly number[]): string {
  if (notches.length !== RING_COUNT) throw new Error("ring door answer needs one notch per ring");
  if (!notches.every((notch) => Number.isInteger(notch) && notch >= 0 && notch < NOTCH_COUNT))
    throw new Error("ring door notches must be 0-35");
  return notches.join(",");
}
