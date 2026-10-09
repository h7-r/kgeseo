import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { buildConnectorGeometry } from "./puzzleGeometry";
import type { WireShape } from "./workLampState";

const SAGGING_POINTS: THREE.Vector3Tuple[] = [
  [0, 0, 0],
  [0.014, -0.075, 0.018],
  [-0.01, -0.15, 0.042],
  [0.008, -0.21, 0.026],
];

interface WireStrandProps {
  shape: WireShape;
  /** 뿌리 → 끝(로컬). 끝에 접속 모양이 앉는다 */
  points?: THREE.Vector3Tuple[];
  /** 모양의 면이 볼 쪽(+1 = +x) */
  direction?: number;
  brightness?: number;
  size?: number;
}

/**
 * 전선 한 가닥 — 곡선을 관으로 훑고 끝에 접속 모양을 단다.
 * 직선 원통을 이으면 마디가 각져 철사로 보인다. 늘어져야 전선이다.
 */
export default function WireStrand({
  shape,
  points = SAGGING_POINTS,
  direction = 1,
  brightness = 1,
  size = 1,
}: WireStrandProps) {
  const pointsKey = points.map((p) => p.map((v) => v.toFixed(3)).join(",")).join("|");
  const tube = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      "catmullrom",
      0.4,
    );
    return new THREE.TubeGeometry(curve, 20, 0.015 * size, 6, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 점 배열은 판마다 새로 만들어져 값(pointsKey)으로 비교한다
  }, [pointsKey, size]);
  const tip = useMemo(() => buildConnectorGeometry(shape, size), [shape, size]);
  useEffect(
    () => () => {
      tube.dispose();
      tip.dispose();
    },
    [tube, tip],
  );
  const end = points[points.length - 1];
  return (
    <>
      <mesh geometry={tube} castShadow>
        {/* 셋 다 같은 회색이다 — 색으로는 못 가른다 */}
        <meshToonMaterial color={scaleColor("#3f444b", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <group position={end} rotation={[0, direction > 0 ? 0 : Math.PI, 0]}>
        <mesh geometry={tip} castShadow>
          <meshToonMaterial color={scaleColor("#dfe5ea", brightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#131416" />
        </mesh>
      </group>
    </>
  );
}
