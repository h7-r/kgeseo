import * as THREE from "three";

import { TEXTURE_SCALE } from "@/engine/quality";
import { makeRandom } from "@/engine/random";

/**
 * 캔버스로 그리는 간판·표지 글씨. 기기에 실제로 있는 한글 고딕부터 찾는다 —
 * 웹폰트가 앞이면 아직 안 실린 화면에서 엉뚱한 글꼴로 떨어져 글자 폭이 어긋난다.
 */
export const SIGN_FONT = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

export type CanvasDraw = (
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
) => void;

function context2d(canvas: HTMLCanvasElement, willReadFrequently: boolean): CanvasRenderingContext2D {
  const g = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  return g;
}

/** 빈 캔버스와 2D 컨텍스트 — 한 장짜리 텍스처를 직접 그릴 때 */
export function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, g: context2d(canvas, false) };
}

/** 다 그린 캔버스를 sRGB 텍스처로 */
export function canvasToTexture(canvas: HTMLCanvasElement, anisotropy: number | null = null): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (anisotropy !== null) texture.anisotropy = anisotropy;
  return texture;
}

/** 정사각 캔버스 텍스처. 저사양 모드면 해상도를 낮추되 무늬가 뭉개지지 않게 128px 아래로는 안 내려간다. */
export function makeCanvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const scaled = Math.max(128, Math.round(size * TEXTURE_SCALE));
  canvas.width = canvas.height = scaled;
  draw(context2d(canvas, true), scaled);
  return canvasToTexture(canvas, 8);
}

export interface CachedCanvasTextureOptions {
  width: number;
  /** 비우면 width 와 같다 */
  height?: number;
  /** 기본 true. 그리기 결과는 같고 캔버스 저장 방식만 다르다 */
  willReadFrequently?: boolean;
  /** 기본 8. null 이면 three 기본값을 그대로 둔다 */
  anisotropy?: number | null;
  /** 이어 붙여 반복할 텍스처(벽·바닥) */
  repeat?: boolean;
  /** 처음 만든 직후 한 번 — 글꼴이 늦게 오면 다시 그리기, 캔버스를 그림으로 뽑기 등 */
  onCreate?: (texture: THREE.CanvasTexture, canvas: HTMLCanvasElement) => void;
}

const canvasTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * 열쇠마다 한 번만 그려 두고 돌려 쓰는 캔버스 텍스처. 텍스처 해상도는 그대로다(저사양 배율 없음).
 * 열쇠는 모든 호출이 한 캐시를 같이 쓰므로 "sticker|3" 처럼 종류를 앞에 붙인다.
 */
export function cachedCanvasTexture(
  key: string,
  draw: CanvasDraw,
  {
    width,
    height = width,
    willReadFrequently = true,
    anisotropy = 8,
    repeat = false,
    onCreate,
  }: CachedCanvasTextureOptions,
): THREE.CanvasTexture {
  const cached = canvasTextureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(context2d(canvas, willReadFrequently), width, height, canvas);
  const texture = canvasToTexture(canvas, anisotropy);
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  canvasTextureCache.set(key, texture);
  onCreate?.(texture, canvas);
  return texture;
}

/**
 * 손때·물자국 같은 넓고 옅은 얼룩과 종이 결 같은 미세한 점을 덧칠한다.
 * 코드로 그린 텍스처는 색이 너무 고르게 깔려 인쇄물처럼 보인다. strength 0 이면 아무것도 안 한다.
 */
export function addGrain(g: CanvasRenderingContext2D, width: number, height: number, seed: number, strength = 1) {
  if (strength <= 0) return;
  const rnd = makeRandom((seed | 0) * 977 + 13);
  const reach = Math.max(width, height);

  const stainCount = 5 + ((rnd() * 4) | 0);
  for (let i = 0; i < stainCount; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const r = reach * (0.12 + rnd() * 0.3);
    const isDark = rnd() < 0.72;
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    const alpha = (isDark ? 0.06 : 0.05) * strength;
    gradient.addColorStop(0, isDark ? `rgba(90,80,66,${alpha})` : `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, width, height);
  }

  // 흰 점·검은 점을 섞어야 결로 보인다.
  const dotCount = ((width * height) / 170) | 0;
  g.globalAlpha = 0.05 * strength;
  for (let i = 0; i < dotCount; i++) {
    g.fillStyle = rnd() < 0.5 ? "#000" : "#fff";
    g.fillRect((rnd() * width) | 0, (rnd() * height) | 0, 1, 1);
  }
  g.globalAlpha = 1;
}

/** 원형 얼룩 하나. 텍스처를 이어 붙여도 티가 안 나게 상하좌우로 감아 찍는다. */
export function drawRoundStain(
  g: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number,
) {
  for (const dx of [-size, 0, size])
    for (const dy of [-size, 0, size]) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < -r || cx > size + r || cy < -r || cy > size + r) continue;
      const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gradient;
      g.beginPath();
      g.arc(cx, cy, r, 0, 6.2832);
      g.fill();
    }
}
