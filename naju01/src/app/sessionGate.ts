/**
 * 에셋보다 세션 먼저 — CDN 에셋 빌드에서는 받기 전에 동행 세션을 잠깐 기다린다.
 * 세션이 준 판 경로(asset_base_path → setAssetVersionPath)로 케이스 에셋을 받아야 게시 판과 어긋나지 않는다(#47 · #50).
 * 로딩을 막지 않는다 — 로컬 에셋이면 기다리지 않고, 세션이 꺼졌거나 실패하면 그 즉시, 늦어도 timeoutMs 뒤에 진행한다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
export const SESSION_WAIT_MS = 2500;

export function waitForSessionBeforeAssets(
  session: Promise<unknown>,
  options: { isCdn: boolean; timeoutMs?: number },
): Promise<void> {
  if (!options.isCdn) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, options.timeoutMs ?? SESSION_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    session.then(done, done);
  });
}
