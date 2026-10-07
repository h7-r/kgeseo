import { useMemo } from "react";

type GroundHeight = (x: number, z: number) => number;

interface SurfaceHolder {
  surface: { heightAt: GroundHeight } | null;
}

/**
 * 땅 위에 자리를 깐다 — 돌다리·씬1~씬5 가 똑같은 몸통을 쓴다.
 * 부르는 횟수·순서가 렌더마다 같으므로 훅 규칙에 어긋나지 않는다.
 */
export function useGroundSpots<T>(
  enabled: boolean,
  ground: SurfaceHolder | null,
  build: (options: { groundHeight: GroundHeight }) => T,
): T | null {
  return useMemo(() => {
    const surface = ground?.surface;
    if (!enabled || !surface) return null;
    return build({ groundHeight: (x, z) => surface.heightAt(x, z) });
  }, [enabled, ground, build]);
}
