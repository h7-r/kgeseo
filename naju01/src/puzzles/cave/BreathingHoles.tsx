/** 조개 숨구멍 — 큰 방 모래에 작은 검은 점으로 툭툭. 장식이라 퍼즐 자리·길목은 피하고, 몇 곳에선 가는 거품이 샌다 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { M } from "../units";
import AirColumn from "./AirColumn";
import { FISH_BURROWS, HALL, floorY } from "./caveState";
import { nearLightPuzzle } from "./lightLayout";
import { JAR_SPOT } from "./overturnedJar";

function planBreathingHoles() {
  const random = createRandom(4413);
  const holes: { x: number; z: number; sx: number; sz: number }[] = [];
  let tries = 0;
  while (holes.length < 34 && tries++ < 400) {
    const x = HALL.x[0] + 1 + random() * (HALL.x[1] - HALL.x[0] - 2);
    const z = HALL.z[0] + 1 + random() * (HALL.z[1] - HALL.z[0] - 2);
    if (nearLightPuzzle(x, z, 0.5)) continue;
    if (Math.hypot(x - JAR_SPOT.x, z - JAR_SPOT.z) < 1.4 || Math.hypot(x - FISH_BURROWS.x, z - FISH_BURROWS.z) < 1.8)
      continue;
    if (Math.abs(x - 45) < 1.4 && z < 66) continue;
    if (holes.some((hole) => Math.hypot(hole.x - x, hole.z - z) < 0.35)) continue;
    holes.push({ x, z, sx: 0.8 + random() * 0.5, sz: 0.8 + random() * 0.5 });
  }
  return holes;
}
const HOLES = planBreathingHoles();

export default function BreathingHoles() {
  const parts = useMemo(
    () => ({
      geometry: new THREE.CircleGeometry(0.03, 9),
      material: new THREE.MeshBasicMaterial({ color: "#071518", toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      parts.geometry.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  return (
    <>
      <group scale={M}>
        <instancedMesh
          args={[parts.geometry, parts.material, HOLES.length]}
          frustumCulled={false}
          ref={(mesh) => {
            if (!mesh) return;
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            HOLES.forEach((hole, k) =>
              mesh.setMatrixAt(
                k,
                matrix.compose(
                  new THREE.Vector3(hole.x, floorY(hole.x, hole.z) + 0.004, hole.z),
                  quaternion,
                  new THREE.Vector3(hole.sx, hole.sz, 1),
                ),
              ),
            );
            mesh.instanceMatrix.needsUpdate = true;
          }}
        />
      </group>
      {HOLES.filter((_, k) => k % 6 === 0).map((hole, k) => (
        <AirColumn
          key={k}
          x={hole.x}
          z={hole.z}
          floor={floorY(hole.x, hole.z) + 0.02}
          radius={0.03}
          on
          count={6}
          breathable={false}
          speed={0.5}
        />
      ))}
    </>
  );
}
