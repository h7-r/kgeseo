import type { ReactNode } from "react";
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import { UNITS_PER_METER } from "../../plan/sitePlan";
import { planPoint, type PlanPoint } from "./planPoint";

interface SlopeSegmentProps {
  a: PlanPoint;
  b: PlanPoint;
  width: number;
  thickness?: number;
  color: string;
  outline: ReactNode;
}

const FORWARD = new THREE.Vector3(0, 0, 1);

/** 두 점을 잇는 경사판. 윗면이 정확히 고도에 오도록 두께의 절반만큼 내려 앉힌다. */
export default function SlopeSegment({ a, b, width, thickness = 0.35, color, outline }: SlopeSegmentProps) {
  const start = planPoint(a[0], a[1], a[2]);
  const end = planPoint(b[0], b[1], b[2]);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-6) return null;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(FORWARD, direction.clone().normalize());
  const center = start.clone().add(end).multiplyScalar(0.5);
  center.y -= (thickness / 2) * UNITS_PER_METER;
  return (
    <mesh position={center} quaternion={quaternion} receiveShadow castShadow>
      <boxGeometry args={[width * UNITS_PER_METER, thickness * UNITS_PER_METER, length]} />
      <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
      {outline}
    </mesh>
  );
}
