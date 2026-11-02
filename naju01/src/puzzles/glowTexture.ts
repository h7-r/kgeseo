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
