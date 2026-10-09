import { useMemo } from "react";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { makeEvidenceLabelTexture } from "./evidenceLabel";

const BOX_SIZE: THREE.Vector3Tuple = [1.35, 0.9, 1.05];
// 면을 부풀리는 외곽선과 달리 모서리에 딱 붙는 선. 크기가 고정이라 모든 상자가 한 벌을 같이 쓴다.
const BOX_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(...BOX_SIZE));

interface EvidenceBoxProps {
  caseNo: string;
  outline?: OutlineValues | null;
}

/** 증거물 상자(봉인 테이프가 한 번 뜯겼다가 다시 붙은). */
export default function EvidenceBox({ caseNo, outline }: EvidenceBoxProps) {
  const texture = useMemo(
    () =>
      makeEvidenceLabelTexture(`box2-${caseNo}`, (g, w, h) => {
        g.fillStyle = "#EDE6D2";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 4;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = "#23262B";
        g.font = "bold 26px sans-serif";
        g.fillText("왜곡 단서", 22, 48);
        g.font = "20px sans-serif";
        g.fillText(`사건 ${caseNo}`, 22, 84);
        g.fillText("봉인 2026.08.21", 22, 112);
        g.fillStyle = "#B3271E";
        g.font = "bold 20px sans-serif";
        g.fillText("재봉인 08.25", 22, 140);
      }),
    [caseNo],
  );
  return (
    <group>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={BOX_SIZE} />
        <meshToonMaterial color="#A8977A" gradientMap={TOON_GRADIENT} />
        {outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
      </mesh>
      {/* toneMapped=false 라 어두운 방에서도 고른 색 그대로 나온다 */}
      {outline?.crease && (
        <lineSegments position={[0, 0.45, 0]} geometry={BOX_EDGES}>
          <lineBasicMaterial color={outline.creaseColor} toneMapped={false} />
        </lineSegments>
      )}
      {/* 봉인 테이프 */}
      <mesh position={[0, 0.905, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.2, 1.05]} />
        <meshToonMaterial color="#C9BE9A" gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh position={[0, 0.47, 0.528]}>
        <planeGeometry args={[0.95, 0.6]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
