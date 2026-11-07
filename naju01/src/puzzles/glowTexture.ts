import * as THREE from "three";

/** 둥근 흰 빛무리 — 스프라이트에 얹어 「주변에 빛이 맴도는」 느낌을 낸다. 뜬 돌·진주가 같이 쓴다 */
export function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  // 가우스처럼 매끈히 — 중간에 꺾이는 마디가 있으면 테두리 동그라미가 생겨 보인다
  const size = 128;
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = r >= 1 ? 0 : Math.exp(-r * r * 4.2) * (1 - r * r);
      const k = (y * size + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = 255;
      image.data[k + 3] = Math.round(a * 230);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 안개결 — 흐린 덩이 여럿이 고르지 않게 겹친 얼룩. 둥근 빛무리 대신 쓰면 테두리가 읽히지 않는다(달빛이 바위에 번진 자리 등).
 * seed 가 같으면 같은 얼룩이 나온다.
 */
export function makeMistTexture(seed = 7) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  // 덩이마다 자리 · 가로세로 퍼짐 · 짙기
  const puffs = Array.from({ length: 11 }, () => ({
    x: 0.5 + (random() - 0.5) * 0.52,
    y: 0.5 + (random() - 0.5) * 0.34,
    wide: 0.12 + random() * 0.16,
    tall: 0.09 + random() * 0.12,
    dense: 0.1 + random() * 0.2,
  }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let a = 0;
      for (const puff of puffs) {
        const dx = (u - puff.x) / puff.wide;
        const dy = (v - puff.y) / puff.tall;
        a += puff.dense * Math.exp(-(dx * dx + dy * dy));
      }
      // 판 가장자리에서는 반드시 0 으로 — 네모가 비치지 않게
      const edge = Math.min(u, 1 - u, v, 1 - v) * 6;
      const k = (y * size + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = 255;
      image.data[k + 3] = Math.round(Math.min(1, a) * Math.min(1, edge) * 170);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
