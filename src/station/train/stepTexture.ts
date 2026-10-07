import type * as THREE from "three";

import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture } from "@/engine/textures/canvas";

/** 문 밑 발판의 때·잔기스. 차체색을 바탕에 굽고 흰/검 얼룩을 옅게 얹는다(재질 color 는 흰색). */
export function stepTexture(seed = 7, color = "#1b2029"): THREE.CanvasTexture {
  return cachedCanvasTexture(
    `trainStep|${seed}:${color}`,
    (g, W, H) => {
      const rnd = makeRandom(seed * 91 + 7);
      g.fillStyle = color;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 11; i++) {
        const cx = rnd() * W;
        const cy = rnd() * H;
        const r = 18 + rnd() * 46;
        const tone = rnd() < 0.5 ? "255,255,255" : "18,20,26";
        const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, `rgba(${tone},${(0.04 + rnd() * 0.07).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(${tone},0)`);
        g.fillStyle = gradient;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      // 밟는 면이라 긁힌 자국이 자연스럽다
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = `rgba(16,18,24,${(0.1 + rnd() * 0.16).toFixed(3)})`;
        g.lineWidth = 0.6 + rnd() * 1.0;
        const x0 = rnd() * W;
        const y0 = rnd() * H;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + (rnd() - 0.5) * 46, y0 + (rnd() - 0.5) * 12);
        g.stroke();
      }
    },
    { width: 128, willReadFrequently: false },
  );
}
