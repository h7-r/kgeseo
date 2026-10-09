/** 브라우저가 한가할 때 실행한다. requestIdleCallback 이 없으면(사파리) fallbackDelay 뒤에 실행한다. */
export function runWhenIdle(callback: () => void, timeout: number, fallbackDelay: number): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(callback, fallbackDelay);
  return () => clearTimeout(id);
}
