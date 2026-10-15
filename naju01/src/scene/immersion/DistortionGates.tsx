/**
 * DistortionGates.tsx — 「왜곡의 문」 고리 (옛 초점.jsx 의 N왜곡의문 이식)
 *   통로 T1~T4 한가운데에 반원 고리. 안개를 타지 않고(fog=false) 스스로 빛난다.
 *
 * [옛 이름 → 새 이름]  N왜곡의문 → DistortionGates · 자리들 → spots · group name 「왜곡의문」 → "distortionGates"
 */
import { useMemo } from "react";
import * as THREE from "three";

import { UNITS_PER_METER } from "../../plan/sitePlan";
import { DISTORTION_GATES_NAME, focus, type GateSpot } from "./focusFog";

const U = UNITS_PER_METER;

export default function DistortionGates({ spots }: { spots: GateSpot[] }) {
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: focus.gateColor, fog: false, transparent: true, opacity: 0.85, toneMapped: false }),
    [],
  );
  const geometry = useMemo(() => new THREE.TorusGeometry(1.7 * U, 0.06 * U, 8, 48, Math.PI), []);
  return (
    <group name={DISTORTION_GATES_NAME}>
      {spots.map((d) => (
        <mesh
          key={d.code}
          geometry={geometry}
          material={material}
          position={[d.x * U, d.y * U, d.z * U]}
          rotation={[0, d.heading + Math.PI / 2, 0]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
