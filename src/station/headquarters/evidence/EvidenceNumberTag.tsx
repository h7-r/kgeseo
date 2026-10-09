import { useMemo } from "react";
import * as THREE from "three";

import { UNIT_PLANE } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";

import { makeEvidenceLabelTexture } from "./evidenceLabel";

const SIDES = [0, Math.PI];

interface EvidenceNumberTagProps {
  number?: number;
  outline?: OutlineValues | null;
}

/**
 * A 자로 접힌 노란 번호 표지. 판 한 장을 세우고 다른 한 장은 Y 로 180° 돌린 거울상이라
 * 뒤에서 봐도 숫자가 바깥을 보고 똑바로 읽힌다.
 */
export default function EvidenceNumberTag({ number = 2, outline }: EvidenceNumberTagProps) {
  const texture = useMemo(
    () =>
      makeEvidenceLabelTexture(
        `num-${number}`,
        (g, w, h) => {
          g.fillStyle = "#E8B62C";
          g.fillRect(0, 0, w, h);
          g.fillStyle = "#23262B";
          g.font = "bold 108px sans-serif";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(String(number), w / 2, h / 2 + 4);
        },
        160,
        160,
      ),
    [number],
  );
  return (
    <group>
      {SIDES.map((yaw, i) => (
        <group key={i} rotation={[0, yaw, 0]}>
          <mesh
            geometry={UNIT_PLANE}
            position={[0, 0.21, 0.11]}
            rotation={[-0.42, 0, 0]}
            scale={[0.42, 0.46, 1]}
            castShadow
          >
            <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
            {/* 평면은 외곽선(면 부풀리기)이 안 통해 주름선이 테두리가 된다. */}
            <ToonOutline geometry={UNIT_PLANE} outline={outline} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
