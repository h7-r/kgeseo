import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { UNIT_BOX } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { createRandom } from "@/engine/random";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { applyDents, applySurfaceJitter, applyGrimeStains } from "@/station/vertexNoise";

import { CABINET_SEAMS, CABINET_SLOT_Z } from "./cabinetGeometry";

const PAPER_COLORS = ["#E7E0CE", "#D6CAAE", "#EFEBE1", "#DED3BC", "#E9E3D3"];

interface CabinetDrawerProps {
  /** 아래부터 0 */
  row: number;
  /** 뺀 깊이 */
  amount: number;
  hasPapers?: boolean;
  color?: THREE.ColorRepresentation;
  seed?: number;
  dentCount?: number;
  dentDepth?: number;
  stainCount?: number;
  stainStrength?: number;
  /** 몸통 대비 눌린 자국 깊이. 1 = 몸통과 같게 */
  wearScale?: number;
  outline?: OutlineValues | null;
}

/**
 * 열린 서랍. GLB 는 서랍이 통짜라 열 수 없어, 그 칸을 어두운 상자로 덮어 구멍을 만들고 앞에 서랍을 새로 그린다.
 * 닫혔을 때 보이는 몸통과 낡은 정도가 같아야 해서 같은 시드·같은 깊이로 찌그러뜨린다.
 */
export default function CabinetDrawer({
  row,
  amount: d,
  hasPapers = false,
  color = "#4A4F56",
  seed = 1,
  dentCount = 4,
  dentDepth = 0.016,
  stainCount = 10,
  stainStrength = 1,
  wearScale = 1,
  outline,
}: CabinetDrawerProps) {
  const y0 = CABINET_SEAMS[row];
  const y1 = CABINET_SEAMS[row + 1];
  const h = y1 - y0;
  const cy = (y0 + y1) / 2;
  const frontZ = CABINET_SLOT_Z + d;
  // 안쪽이라 빛을 덜 받는다
  const innerColor = useMemo(() => new THREE.Color(color).multiplyScalar(0.72).getStyle(), [color]);

  const parts = useMemo(() => {
    const make = (w: number, hh: number, dd: number, partSeed: number, yOffset: number) => {
      // 면 분할(12,12,2)이 있어야 자국이 실제로 눌린다.
      const geometry = new THREE.BoxGeometry(w, hh, dd, 12, 12, 2);
      // 세게 흔들면 정사각 격자 때문에 사선 줄무늬가 뜬다.
      applySurfaceJitter(geometry, partSeed, 0.01);
      // 부품이 작아 반경을 크게(0.12) 잡아야 눌린 게 보인다.
      applyDents(geometry, partSeed, dentCount, dentDepth * wearScale, 0.12);
      applyGrimeStains(geometry, partSeed, stainCount, stainStrength, yOffset);
      return geometry;
    };
    return {
      front: make(0.34, h, 0.014, seed + 1, cy),
      side: make(0.008, h - 0.01, d, seed + 2, cy),
      bottom: make(0.336, 0.01, d, seed + 3, y0 + 0.014),
      handle: make(0.11, 0.034, 0.012, seed + 4, cy - 0.02),
    };
  }, [seed, dentCount, dentDepth, stainCount, stainStrength, wearScale, h, d, cy, y0]);
  useEffect(() => () => Object.values(parts).forEach((geometry) => geometry.dispose()), [parts]);

  // 세워 꽂힌 파일철. 칸 윗변 위로 살짝 튀어나와야 눈에 띈다.
  const papers = useMemo(() => {
    if (!hasPapers || d < 0.05) return [];
    const rnd = createRandom(seed + 313);
    const n = 5;
    return Array.from({ length: n }, (_, i) => {
      const t = (i + 0.5) / n;
      return {
        z: CABINET_SLOT_Z + 0.018 + t * (d - 0.036),
        tilt: (rnd() - 0.5) * 0.16,
        hh: h * (0.62 + rnd() * 0.22),
        up: 0.012 + rnd() * 0.026,
        w: 0.27 + rnd() * 0.03,
        color: PAPER_COLORS[i % PAPER_COLORS.length],
      };
    });
  }, [hasPapers, d, h, seed]);

  return (
    <group>
      {/* 구멍은 빈 공간이라 선을 두르지 않는다(두르면 판때기처럼 보인다). */}
      <mesh geometry={UNIT_BOX} position={[0, cy, CABINET_SLOT_Z - 0.031]} scale={[0.336, h - 0.006, 0.062]}>
        <meshToonMaterial color="#191D24" gradientMap={TOON_GRADIENT} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} geometry={parts.side} position={[sx * 0.166, cy, CABINET_SLOT_Z + d / 2]} castShadow>
          <meshToonMaterial color={innerColor} gradientMap={TOON_GRADIENT} vertexColors flatShading />
          <ToonOutline geometry={parts.side} outline={outline} />
        </mesh>
      ))}
      <mesh geometry={parts.bottom} position={[0, y0 + 0.014, CABINET_SLOT_Z + d / 2]} castShadow>
        <meshToonMaterial color={innerColor} gradientMap={TOON_GRADIENT} vertexColors flatShading />
        <ToonOutline geometry={parts.bottom} outline={outline} />
      </mesh>
      <mesh geometry={parts.front} position={[0, cy, frontZ + 0.007]} castShadow receiveShadow>
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} vertexColors flatShading />
        <ToonOutline geometry={parts.front} outline={outline} />
      </mesh>
      <mesh geometry={parts.handle} position={[0, cy - 0.02, frontZ + 0.02]} castShadow>
        <meshToonMaterial color={innerColor} gradientMap={TOON_GRADIENT} vertexColors flatShading />
        <ToonOutline geometry={parts.handle} outline={outline} />
      </mesh>
      {papers.map((paper, i) => (
        <mesh
          key={i}
          geometry={UNIT_BOX}
          position={[0, y0 + 0.02 + paper.hh / 2, paper.z]}
          rotation={[0, 0, paper.tilt]}
          scale={[paper.w, paper.hh + paper.up, 0.005]}
          castShadow
        >
          <meshToonMaterial color={paper.color} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={UNIT_BOX} outline={outline} />
        </mesh>
      ))}
    </group>
  );
}
