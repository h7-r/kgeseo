import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { DOOR_OPENING } from "./doorOpening";
import { stepTexture } from "./stepTexture";

/** 「기차 발판」 크기·위치. 모델 로컬 단위라 기차의 크기를 물려받는다 */
export interface TrainStepSize {
  /** 문 너비 방향(x) 길이 */
  width?: number;
  /** 바깥으로 나온 깊이(z) — 밟는 면 */
  depth?: number;
  thickness?: number;
  /** x 위치 보정(+오른쪽) */
  offsetX?: number;
  /** 문턱 대비 위아래(−면 아래로 내려 계단처럼) */
  offsetY?: number;
  /** 바깥으로 더/덜(+면 더 튀어나온다) */
  offsetZ?: number;
}

interface TrainStepProps {
  color: string;
  outline?: OutlineValues | null;
  size?: TrainStepSize;
}

/** 문 밑 얇은 디딤판. 차체와 한 몸처럼 보이도록 같은 색 바탕 텍스처와 같은 선을 입힌다. */
export default function TrainStep({ color, outline, size = {} }: TrainStepProps) {
  const { width = 0.5, depth = 0.14, thickness = 0.02, offsetX = 0, offsetY = -0.08, offsetZ = 0 } = size;
  const sillY = DOOR_OPENING.centerY - DOOR_OPENING.height / 2;
  const geometry = useMemo(() => new THREE.BoxGeometry(width, thickness, depth), [width, thickness, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const map = stepTexture(7, color);

  return (
    <mesh
      geometry={geometry}
      // 차체 면에서 바깥으로 돌출, 안쪽은 살짝 겹친다
      position={[DOOR_OPENING.centerX + offsetX, sillY + offsetY, DOOR_OPENING.z - depth / 2 + 0.01 - offsetZ]}
      castShadow
      receiveShadow
    >
      <meshToonMaterial map={map} gradientMap={TOON_GRADIENT} />
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}
