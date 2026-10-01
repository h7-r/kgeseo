import { useSyncExternalStore } from "react";

/* ═══════════════════════════════════════════════════════
   히어로가 화면을 **통째로** 덮고 있나

   히어로핀이 붙어 있는 동안 불투명한 히어로(WebGL 영상)가 창을 다 가린다.
   그 뒤의 입체 공간(깊은우주)은 한 픽셀도 안 보이는데 스크롤마다 깨어나
   그리고 있었다 → 덮여 있을 땐 재운다. 값이 **바뀔 때만** 알린다(리렌더 최소).
   ═══════════════════════════════════════════════════════ */
let 덮음 = false;
const 듣는이 = new Set();
export function 히어로덮음알림(값) {
  if (값 === 덮음) return;
  덮음 = 값;
  for (const f of 듣는이) f();
}
export function use히어로덮음() {
  return useSyncExternalStore(
    (f) => { 듣는이.add(f); return () => 듣는이.delete(f); },
    () => 덮음,
    () => false,
  );
}
