import { useEffect, useMemo } from "react";

import { wallTexture } from "@/engine/textures/surfaces";
import { TOON_GRADIENT } from "@/engine/toon";

import { wallPieceGeometry } from "./wallPieceGeometry";

interface WallPieceProps {
  width: number;
  height: number;
  x: number;
  y: number;
  color: string;
  seed: number;
  wear?: number;
  flipU?: boolean;
  /** 가로 분할 수 — brightness 를 여러 단계로 줄 때 늘린다(segments+1 개가 딱 맞다) */
  segments?: number;
  /** 왼쪽 끝 → 오른쪽 끝 밝기 목록. 없으면 균일 */
  brightness?: readonly number[] | null;
}

/** 옆 벽과 같은 벽돌 무늬가 이어지는 작은 벽 판 */
export default function WallPiece({
  width,
  height,
  x,
  y,
  color,
  seed,
  wear = 0.7,
  flipU = false,
  segments = 1,
  brightness = null,
}: WallPieceProps) {
  const texture = wallTexture(seed, wear);
  // 배열은 렌더마다 새로 오므로 내용으로 비교한다. 숫자→문자→숫자는 값이 그대로 돌아온다.
  const brightnessKey = brightness ? brightness.join(",") : "";
  const geometry = useMemo(
    () =>
      wallPieceGeometry({
        width,
        height,
        x,
        y,
        flipU,
        segments,
        brightness: brightnessKey ? brightnessKey.split(",").map(Number) : null,
      }),
    [width, height, x, y, flipU, segments, brightnessKey],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh position={[x, y, 0]} geometry={geometry} receiveShadow>
      <meshToonMaterial color={color} map={texture} gradientMap={TOON_GRADIENT} vertexColors={!!brightness} />
    </mesh>
  );
}
