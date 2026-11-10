/**
 * 가운데가 꽉 차고 바깥으로 투명해지는 흰 원 — 가산 혼합 스프라이트 빛무리에 쓴다(색은 재질이 입힌다).
 * 기차 텔레포트 장치 · 소화전 밸브(미르 11/10 「밸브 자체에 빛나는 효과」)가 같이 쓴다. 한 장만 만들어 둔다.
 */
import * as THREE from "three";

let glowTexture: THREE.CanvasTexture | null = null;

export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  const gradient = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // 빠르게 옅어졌다가 길게 사라져야 부드럽게 번진다.
  gradient.addColorStop(0.0, "rgba(255,255,255,1.0)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.42)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, s, s);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glowTexture = texture;
  return texture;
}
