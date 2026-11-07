/**
 * 터치 모드의 키 이름 — 화면 단추 그림으로 바꿔 보인다(계획서 7.5).
 * 문구 속 「[E]」「E 를」 같은 키 표기를 손대지 않고, 그리는 순간에만 바꾼다(PC 문구는 그대로).
 */
import { useTouchMode } from "./touchMode";

/** 키 → 터치 단추 이름. 없는 키는 그대로 둔다 */
const TOUCH_KEY_NAMES: Record<string, string> = {
  E: "✋",
  H: "💡",
  I: "🎒",
  P: "⚙",
  V: "시점",
  T: "탭",
  Space: "점프",
  C: "앉기",
  ESC: "✕",
  Esc: "✕",
  Enter: "✋",
};

export function touchKeyName(key: string): string {
  return TOUCH_KEY_NAMES[key] ?? key;
}

/** 문구 속 키 표기를 단추 그림으로 — 「[E] 내려놓기」 → 「[✋] 내려놓기」, 「E 를 누르면」 → 「✋ 를 누르면」 */
export function touchifyText(text: string): string {
  return text
    .replace(/\[(E|H|I|P|V|ESC|Esc|Enter)\]/g, (_, key: string) => `[${touchKeyName(key)}]`)
    .replace(/ 또는 클릭/g, "")
    .replace(
      /(^|[^A-Za-z])([EH]) (로|를|키)/g,
      (_, before: string, key: string, particle: string) => `${before}${touchKeyName(key)} ${particle}`,
    );
}

/** 화면에서 쓰는 꼴 — 터치 모드면 바꾸고, 아니면 그대로 */
export function useKeyLabels() {
  const isTouch = useTouchMode();
  return {
    isTouch,
    key: (key: string) => (isTouch ? touchKeyName(key) : key),
    text: (text: string) => (isTouch ? touchifyText(text) : text),
  };
}
