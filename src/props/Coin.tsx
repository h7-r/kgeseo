import { useEffect, useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import type { Euler, Vector3Tuple } from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import { makeRandom } from "@/engine/random";
import { cachedCanvasTexture } from "@/engine/textures/canvas";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

/** 동전 가운데 새긴 무늬. can 은 음료 자판기용, cup 은 커피 자판기용. */
export type CoinPattern = "star" | "keyhole" | "can" | "cup";

// roundRect 가 없는 환경에서도 되게 arcTo 로 그린다
function roundedRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 가운데 심볼을 음각 느낌으로 새긴다. */
function drawPattern(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  pattern: CoinPattern,
  dark: string,
  light: string,
) {
  g.save();
  g.translate(cx, cy);
  if (pattern === "can") {
    // 원통 뚜껑 UV 가 90° 돌아가 있어, 뚜껑이 위로 오게 캔버스에서 미리 −90° 돌린다.
    g.rotate(-Math.PI / 2);
    const w = R * 0.5;
    const h = R * 0.98;
    const lidY = -h / 2;
    roundedRectPath(g, -w / 2, lidY + R * 0.06, w, h - R * 0.06, w * 0.24);
    g.fillStyle = dark;
    g.fill();
    g.beginPath();
    g.ellipse(0, lidY + R * 0.06, w / 2, R * 0.09, 0, 0, Math.PI * 2);
    g.fill();
    // 따개 구멍
    g.fillStyle = light;
    g.beginPath();
    g.ellipse(R * 0.07, lidY + R * 0.05, w * 0.17, R * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    // 라벨 띠
    g.strokeStyle = light;
    g.lineWidth = R * 0.035;
    for (const dy of [-R * 0.08, R * 0.12]) {
      g.beginPath();
      g.moveTo(-w / 2 + R * 0.03, dy);
      g.lineTo(w / 2 - R * 0.03, dy);
      g.stroke();
    }
  } else if (pattern === "cup") {
    // 위가 넓은 사다리꼴 + 말린 테 + 김 두 줄
    const tw = R * 0.46;
    const bw = R * 0.29;
    const h = R * 0.82;
    const top = -h / 2 + R * 0.06;
    const bottom = h / 2;
    g.beginPath();
    g.moveTo(-tw, top);
    g.lineTo(tw, top);
    g.lineTo(bw, bottom);
    g.lineTo(-bw, bottom);
    g.closePath();
    g.fillStyle = dark;
    g.fill();
    g.lineWidth = R * 0.05;
    g.strokeStyle = light;
    g.beginPath();
    g.ellipse(0, top, tw, R * 0.08, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = R * 0.03;
    g.beginPath();
    g.moveTo(-tw * 0.78, top + h * 0.42);
    g.lineTo(tw * 0.78, top + h * 0.42);
    g.stroke();
    g.lineWidth = R * 0.03;
    for (const sx of [-R * 0.16, R * 0.16]) {
      g.beginPath();
      g.moveTo(sx, top - R * 0.12);
      g.bezierCurveTo(sx + R * 0.12, top - R * 0.28, sx - R * 0.12, top - R * 0.4, sx + R * 0.02, top - R * 0.56);
      g.stroke();
    }
  } else if (pattern === "keyhole") {
    const r = R * 0.32;
    g.beginPath();
    g.arc(0, -R * 0.12, r, 0, Math.PI * 2);
    g.fillStyle = dark;
    g.fill();
    g.beginPath();
    g.moveTo(-r * 0.62, -R * 0.12);
    g.lineTo(-r * 0.95, R * 0.55);
    g.lineTo(r * 0.95, R * 0.55);
    g.lineTo(r * 0.62, -R * 0.12);
    g.closePath();
    g.fill();
    g.strokeStyle = light;
    g.lineWidth = R * 0.03;
    g.beginPath();
    g.arc(0, -R * 0.12, r, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  } else {
    const outer = R * 0.5;
    const innerR = R * 0.21;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? innerR : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = dark;
    g.fill();
    g.strokeStyle = light;
    g.lineWidth = R * 0.025;
    g.stroke();
  }
  g.restore();
}

// 시드가 같으면 세월 얼룩·기스가 늘 같은 모양이라 캐시해 돌려 쓸 수 있다.
const FACE_SEED = 3;

function coinFaceTexture(pattern: CoinPattern, color: string, patternColor: string) {
  return cachedCanvasTexture(
    `coinFace|${pattern}:${color}:${patternColor}:${FACE_SEED}`,
    (g, S) => {
      const rnd = makeRandom(FACE_SEED * 131 + 9);
      const cx = S / 2;
      const cy = S / 2;
      const R = S * 0.46;
      const bright = scaleColor(color, 1.22);
      const shadow = scaleColor(color, 0.72);
      const deep = scaleColor(patternColor, 0.85);
      const highlight = scaleColor(color, 1.35);

      // 원 밖은 투명 — 뚜껑 UV 는 사각이지만 원만 보이게
      g.clearRect(0, 0, S, S);

      // 가운데가 밝고 가장자리가 어두운 금속 — 볼록한 주화
      const metal = g.createRadialGradient(cx, cy - R * 0.15, R * 0.1, cx, cy, R);
      metal.addColorStop(0, bright);
      metal.addColorStop(0.7, color);
      metal.addColorStop(1, shadow);
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fillStyle = metal;
      g.fill();

      // 테두리 두 겹
      g.lineWidth = R * 0.06;
      g.strokeStyle = shadow;
      g.beginPath();
      g.arc(cx, cy, R * 0.965, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = R * 0.02;
      g.strokeStyle = highlight;
      g.beginPath();
      g.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
      g.stroke();

      // 구슬 테
      const beadCount = 40;
      for (let i = 0; i < beadCount; i++) {
        const a = (i / beadCount) * Math.PI * 2;
        const rr = R * 0.86;
        g.beginPath();
        g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * 0.022, 0, Math.PI * 2);
        g.fillStyle = i % 2 ? deep : highlight;
        g.fill();
      }

      drawPattern(g, cx, cy, R * 0.9, pattern, deep, highlight);

      // 세월 — 옅은 얼룩·기스(원 안에서만)
      g.save();
      g.beginPath();
      g.arc(cx, cy, R * 0.96, 0, Math.PI * 2);
      g.clip();
      for (let i = 0; i < 9; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 8 + rnd() * 26;
        const tone = rnd() < 0.5 ? "255,255,255" : "20,16,8";
        const stain = g.createRadialGradient(x, y, 0, x, y, r);
        stain.addColorStop(0, `rgba(${tone},${(0.05 + rnd() * 0.08).toFixed(3)})`);
        stain.addColorStop(1, `rgba(${tone},0)`);
        g.fillStyle = stain;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = `rgba(30,22,10,${(0.08 + rnd() * 0.12).toFixed(3)})`;
        g.lineWidth = 0.6 + rnd() * 1.1;
        const x0 = rnd() * S;
        const y0 = rnd() * S;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x0 + (rnd() - 0.5) * 60, y0 + (rnd() - 0.5) * 60);
        g.stroke();
      }
      g.restore();
    },
    { width: 256, willReadFrequently: false },
  );
}

/** 옆면 빗살(세로 줄무늬). */
function coinEdgeTexture(color: string) {
  return cachedCanvasTexture(
    `coinEdge|${color}`,
    (g, W, H) => {
      g.fillStyle = scaleColor(color, 0.82);
      g.fillRect(0, 0, W, H);
      const lines = 90;
      for (let i = 0; i < lines; i++) {
        const x = (i / lines) * W;
        g.strokeStyle = i % 2 ? scaleColor(color, 1.15) : scaleColor(color, 0.6);
        g.lineWidth = W / lines / 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
    },
    {
      width: 256,
      height: 16,
      willReadFrequently: false,
      anisotropy: null,
      onCreate: (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
      },
    },
  );
}

type GroupProps = Omit<ThreeElements["group"], "position" | "rotation">;

interface CoinProps extends GroupProps {
  position?: Vector3Tuple;
  rotation?: Vector3Tuple | Euler;
  radius?: number;
  thickness?: number;
  /** 놋쇠 */
  color?: string;
  patternColor?: string;
  pattern?: CoinPattern;
  /** true = 바닥에 놓인 자세(면이 위) */
  isLying?: boolean;
  outline?: OutlineValues | null;
}

/**
 * 자판기용 동전(토큰). 원통을 눕혀 쓰고 옆면(빗살)·윗면·아랫면(무늬)을 다른 재질로 칠한다.
 * 색·무늬만 바꿔 동전 두 종을 찍어 낸다.
 */
export default function Coin({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  radius = 0.42,
  thickness = 0.09,
  color = "#b6923f",
  patternColor = "#6f531f",
  pattern = "star",
  isLying = true,
  outline,
  ...rest
}: CoinProps) {
  const geometry = useMemo(() => new THREE.CylinderGeometry(radius, radius, thickness, 44, 1), [radius, thickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const faceTexture = useMemo(() => coinFaceTexture(pattern, color, patternColor), [pattern, color, patternColor]);
  const edgeTexture = useMemo(() => coinEdgeTexture(color), [color]);

  // 원통 그룹 순서: [옆면, 윗면, 아랫면]
  const materials = useMemo(
    () => [
      new THREE.MeshToonMaterial({ map: edgeTexture, gradientMap: TOON_GRADIENT }),
      new THREE.MeshToonMaterial({ map: faceTexture, gradientMap: TOON_GRADIENT, transparent: true }),
      new THREE.MeshToonMaterial({ map: faceTexture, gradientMap: TOON_GRADIENT, transparent: true }),
    ],
    [faceTexture, edgeTexture],
  );
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);

  // 원통 축(y) 그대로면 면이 위를 본다. 세울 때는 x 로 90° 눕혀 면이 정면을 보게 한다.
  const pose: Vector3Tuple = isLying ? [0, 0, 0] : [Math.PI / 2, 0, 0];
  return (
    <group position={position} rotation={rotation} {...rest}>
      <group rotation={pose}>
        <mesh geometry={geometry} material={materials} castShadow receiveShadow>
          <ToonOutline geometry={geometry} outline={outline} />
        </mesh>
      </group>
    </group>
  );
}
