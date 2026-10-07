/** 초 → "0:07" */
export function formatTime(seconds: number): string {
  const safe = !Number.isFinite(seconds) || seconds < 0 ? 0 : seconds;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
