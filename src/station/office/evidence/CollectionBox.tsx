import { useEffect, useMemo } from "react";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { evidenceLabelTexture } from "./evidenceLabel";

interface CollectionBoxProps {
  caseNo: string;
  outline?: OutlineValues | null;
  width?: number;
  depth?: number;
  boxHeight?: number;
}

/** 현장 수거품 상자. 밑면이 y=0 이라 Leva 「높이」가 곧 바닥에서 띄운 값이다. */
export default function CollectionBox({
  caseNo,
  outline,
  width = 0.95,
  depth = 0.78,
  boxHeight = 0.62,
}: CollectionBoxProps) {
  const texture = useMemo(
    () =>
      evidenceLabelTexture(`box2b-${caseNo}`, (g, w, h) => {
        g.fillStyle = "#EDE6D2";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 4;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = "#23262B";
        g.font = "bold 26px sans-serif";
        g.fillText("현장 수거품", 22, 48);
        g.font = "20px sans-serif";
        g.fillText(`사건 ${caseNo}`, 22, 84);
        g.fillText("봉인 2026.08.22", 22, 112);
        g.fillStyle = "#B3271E";
        g.font = "bold 20px sans-serif";
        g.fillText("반출 대기", 22, 140);
      }),
    [caseNo],
  );
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(width, boxHeight, depth)),
    [width, boxHeight, depth],
  );
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <group position={[0, boxHeight / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, boxHeight, depth]} />
        {/* 증거물 상자와 같은 골판지를 한 톤 어둡게 — 똑같으면 한 덩어리로 보인다 */}
        <meshToonMaterial color="#9C8C71" gradientMap={TOON_GRADIENT} />
        {outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
      </mesh>
      {outline?.crease && (
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={outline.creaseColor} toneMapped={false} />
        </lineSegments>
      )}
      <mesh position={[0, boxHeight / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, depth]} />
        <meshToonMaterial color="#C9BE9A" gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh position={[0, 0.02, depth / 2 + 0.003]}>
        <planeGeometry args={[width * 0.72, boxHeight * 0.68]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
