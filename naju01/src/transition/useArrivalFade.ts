/**
 * 허브에서 넘어왔을 때 검은 화면에서 밝아지는 연출의 상태.
 * 진입 연출(src/station/NajuEntryTransition.tsx)은 주소를 통째로 옮겨 허브 쪽 오버레이가 DOM 째 사라진다 —
 * 그래서 도착 후 페이드 인은 넘어온 쪽(나주)이 한다. 첫 프레임이 언제 그려지는지도 여기서만 안다.
 */
import { useEffect, useState } from "react";

/** 밝아지는 데 걸리는 시간(ms). 연출 담당이 정한 값 — 검정 → 투명, ease-out */
export const ARRIVAL_FADE_MS = 500;
// 첫 프레임이 이때까지 안 오면 그냥 밝힌다. 화면이 영영 까만 것이 제일 나쁜 실패다.
const SAFETY_TIMEOUT_MS = 15000;

/** [밝힐까, 첫 프레임이 왔다고 알리는 함수]. 꺼져 있으면 처음부터 밝다 */
export function useArrivalFade(isEnabled: boolean): [boolean, () => void] {
  const [isRevealed, setIsRevealed] = useState(!isEnabled);

  useEffect(() => {
    if (!isEnabled || isRevealed) return undefined;
    const timer = setTimeout(() => setIsRevealed(true), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isEnabled, isRevealed]);

  return [isRevealed, () => setIsRevealed(true)];
}
