/** 빛기둥 그라데이션 — 튜토리얼 바닥 동그라미가 쓴다(컴포넌트 파일은 컴포넌트만 내보내야 빠른 새로 고침이 된다) */
import * as THREE from "three";

/** 빛기둥이 위로 갈수록 스러지게 하는 세로 그라데이션. 한 장을 함께 쓴다 */
let beamFade: THREE.CanvasTexture | null = null;
export function getBeamFade() {
  if (beamFade) return beamFade;
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(1, "#fff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 64);
  }
  beamFade = new THREE.CanvasTexture(canvas);
  return beamFade;
}
