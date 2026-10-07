import * as THREE from "three";

import { WALL_TEX_H, WALL_TEX_W } from "@/engine/textures/surfaces";

export interface WallPieceGeometryOptions {
  width: number;
  height: number;
  /** 판 가운데의 벽 좌표. UV 를 이만큼 밀어 옆 벽의 벽돌 무늬를 그대로 잇는다 */
  x: number;
  y: number;
  flipU?: boolean;
  /** 가로 분할 수. 정점만 늘 뿐 드로우콜은 1 그대로다 */
  segments?: number;
  /** 왼쪽 끝 → 오른쪽 끝 밝기. 정점색으로 보간해 조명 없이 그라데이션을 만든다 */
  brightness?: readonly number[] | null;
}

/**
 * 벽돌 무늬가 이어지는 벽 조각 판. 여러 장을 한 덩어리로 합칠 때도 이 함수를 써야
 * UV·밝기 식이 한 벌로 남아 이음매가 안 어긋난다.
 */
export function wallPieceGeometry({
  width,
  height,
  x,
  y,
  flipU = false,
  segments = 1,
  brightness = null,
}: WallPieceGeometryOptions): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, Math.max(1, segments), 1);
  const uv = geometry.attributes.uv;
  const u0 = (x - width / 2) / WALL_TEX_W;
  const v0 = (y - height / 2) / WALL_TEX_H;
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, uv.getX(i) * (width / WALL_TEX_W) + (flipU ? -u0 : u0));
    uv.setY(i, uv.getY(i) * (height / WALL_TEX_H) + v0);
  }
  if (brightness && brightness.length >= 2) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const last = brightness.length - 1;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getX(i) + width / 2) / width;
      // 값이 2개면 직선, 여러 개면 꺾은선 보간
      const f = Math.max(0, Math.min(last, t * last));
      const i0 = Math.floor(f);
      const i1 = Math.min(last, i0 + 1);
      const v = brightness[i0] + (brightness[i1] - brightness[i0]) * (f - i0);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  return geometry;
}
