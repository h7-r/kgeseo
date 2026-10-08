import type * as THREE from "three";

import type { PresentedControls } from "../../app/presentation";
import { CORE, SECTIONS, UNITS_PER_METER } from "../../plan/sitePlan";
import { planPoint } from "./planPoint";

const U = UNITS_PER_METER;

interface PlanOverlaysProps {
  controls: PresentedControls;
  gridGeometry: THREE.BufferGeometry;
}

/** 도면 대조용 단면선과 10 m 격자. */
export default function PlanOverlays({ controls: T, gridGeometry }: PlanOverlaysProps) {
  const coreWidth = CORE.x[1] - CORE.x[0];
  const coreDepth = CORE.z[1] - CORE.z[0];
  return (
    <>
      {/* 단면선 A–A′ · B–B′ — 가늘고 반투명하게, 필요할 때만 눈에 들게 */}
      {T.showSections &&
        SECTIONS.map((c) => {
          const isAlongX = c.axis === "Z";
          return (
            <mesh
              key={c.code}
              position={isAlongX ? planPoint(coreWidth / 2, c.value, 0.06) : planPoint(c.value, coreDepth / 2, 0.06)}
            >
              <boxGeometry args={[(isAlongX ? coreWidth : 0.1) * U, 0.04 * U, (isAlongX ? 0.1 : coreDepth) * U]} />
              <meshBasicMaterial color="#C0555F" toneMapped={false} transparent opacity={0.45} depthWrite={false} />
            </mesh>
          );
        })}

      {T.showGrid && gridGeometry && (
        <lineSegments geometry={gridGeometry} frustumCulled={false}>
          <lineBasicMaterial color="#6B7788" toneMapped={false} transparent opacity={0.55} />
        </lineSegments>
      )}
    </>
  );
}
