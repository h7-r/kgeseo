export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 화면 가운데 16:9 상자 — 가로·세로 둘 다 넘치지 않게. */
export function targetBox(): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = vw < 700 ? 12 : 48;
  let width = Math.min(vw - margin * 2, 1440);
  let height = (width * 9) / 16;
  if (height > vh - margin * 2) {
    height = vh - margin * 2;
    width = (height * 16) / 9;
  }
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

export const toPx = (box: Box) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
});
