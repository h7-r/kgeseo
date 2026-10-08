import { useMemo } from "react";
import { Outlines } from "@react-three/drei";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { evidenceLabelTexture } from "./evidenceLabel";

interface EvidenceBagProps {
  caseNo: string;
  item: string;
  outline?: OutlineValues | null;
  /** 지퍼백 두께. 납작할수록 증거물처럼 보인다 */
  thickness?: number;
  /** 이 봉투만의 배수(증거물(공통) 크기 × 이 값) */
  size?: number;
}

/** 증거물 지퍼백. 납작하고 각진 물건이라 상자 몇 개로 그린다. */
export default function EvidenceBag({ caseNo, item, outline, thickness = 0.05, size = 1 }: EvidenceBagProps) {
  const texture = useMemo(
    () =>
      evidenceLabelTexture(`bag-${caseNo}-${item}`, (g, w, h) => {
        g.fillStyle = "#E9E3CD";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#3A3E46";
        g.lineWidth = 3;
        g.strokeRect(9, 9, w - 18, h - 18);
        g.fillStyle = "#B3271E";
        g.fillRect(9, 9, w - 18, 30);
        g.fillStyle = "#F6F2E6";
        g.font = "bold 19px sans-serif";
        g.fillText("EVIDENCE · 증거물", 20, 31);
        g.fillStyle = "#23262B";
        g.font = "17px sans-serif";
        g.fillText(`사건 ${caseNo}`, 20, 72);
        g.fillText(`품목 ${item}`, 20, 98);
        g.strokeStyle = "#8A8677";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(20, 118);
        g.lineTo(w - 20, 118);
        g.stroke();
        g.font = "14px sans-serif";
        g.fillStyle = "#5A5648";
        g.fillText("수집 2026.08.21  담당 ______", 20, 138);
      }),
    [caseNo, item],
  );
  // 고정 두께면 봉투를 얇게 줄였을 때 안의 종이가 뚫고 나온다 — 봉투 두께를 따라간다.
  const paperThickness = thickness * 0.45;
  // 겉면 + z-fighting 방지 틈
  const labelZ = thickness / 2 + 0.002;
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} scale={size}>
      {/* 반투명해야 봉투 안에 뭔가 들어 있다로 읽힌다 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.66, 0.9, thickness]} />
        <meshToonMaterial color="#CFD6DA" gradientMap={TOON_GRADIENT} transparent opacity={0.55} />
        {outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
      </mesh>
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.56, 0.74, paperThickness]} />
        <meshToonMaterial color="#DED8C6" gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh position={[0, 0.22, labelZ]}>
        <planeGeometry args={[0.58, 0.36]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}
