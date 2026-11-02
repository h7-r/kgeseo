/**
 * 장독대 자리(미터) — 퍼즐과 땅 자갈이 같이 본다.
 * 절벽 바위에 등을 붙인 자리. 어부2 와 금줄 왼쪽 기둥 사이 안쪽이고 나룻배·돌무지와 안 겹친다.
 */
export const JAR_SITE = { x: 41.5, z: 31.9 };
/** 돌판 크기(미터) */
export const JAR_SLAB = { width: 4.7, depth: 1.2, height: 0.25 };

/** 돌판을 뚫고 나오는 자갈을 비울 여유(미터) */
const CLEAR_MARGIN = 0.5;

export const isOnJarSite = (x: number, z: number) =>
  Math.abs(x - JAR_SITE.x) <= JAR_SLAB.width / 2 + CLEAR_MARGIN &&
  Math.abs(z - JAR_SITE.z) <= JAR_SLAB.depth / 2 + CLEAR_MARGIN;
