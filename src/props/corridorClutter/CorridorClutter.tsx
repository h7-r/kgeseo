import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import Drips from "./Drips";
import { buildClutterGeometry, buildPuddleGeometry, computePuddleSpots, type BrightnessAt } from "./clutterGeometry";
import { makeCanAtlasTexture, makePaperAtlasTexture } from "./clutterTextures";

const fullBrightness: BrightnessAt = () => 1;

interface CorridorClutterProps {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** 비우면 복도 길이로 정한다 */
  count?: number;
  puddleCount?: number;
  /** 복도 바닥판이 깔린 높이 */
  floorY?: number;
  /** 물방울이 시작하는 높이(천장 배관) */
  ceilingY?: number;
  /** 실물 치수대로면 넓은 복도에서 너무 작게 읽혀 조금 키운다 */
  size?: number;
  seed?: number;
  /** z 에 따른 깊이 감광 — 벽과 같은 규칙이어야 어두운 끝에 쓰레기만 환하게 뜨지 않는다 */
  brightness?: BrightnessAt;
  outline?: OutlineValues | null;
  /** 물방울 소리가 안 들려야 하는 세계 z — 자판기 앞 */
  quietZs?: readonly number[];
}

/**
 * 비밀복도 바닥에 흩어진 생활 쓰레기·물웅덩이·물방울.
 * 빈 바닥은 '아직 안 만든 곳' 으로 읽힌다. 찌그러진 캔 하나가 사람이 있었다가 오래 비었다는 걸 말해 준다.
 * 캔 1 · 종이 1 · 나머지 1 · 웅덩이 1 드로우콜 + 물방울 몇 개.
 */
export default function CorridorClutter({
  x0,
  x1,
  z0,
  z1,
  count,
  puddleCount = 3,
  floorY = 0.01,
  ceilingY = 7,
  size = 1.45,
  seed = 4711,
  brightness = fullBrightness,
  outline,
  quietZs = [],
}: CorridorClutterProps) {
  const itemCount = count ?? Math.round(Math.min(90, Math.max(8, (z1 - z0) * 0.55)));
  const spots = useMemo(
    () => computePuddleSpots({ x0, x1, z0, z1, count: puddleCount, seed }),
    [x0, x1, z0, z1, puddleCount, seed],
  );
  const { cans, papers, others } = useMemo(
    () => buildClutterGeometry({ x0, x1, z0, z1, count: itemCount, seed, brightness, floorY, size }),
    [x0, x1, z0, z1, itemCount, seed, brightness, floorY, size],
  );
  const puddles = useMemo(
    () => buildPuddleGeometry({ spots, seed, floorY, brightness }),
    [spots, seed, floorY, brightness],
  );
  const canAtlas = useMemo(() => makeCanAtlasTexture(), []);
  const paperAtlas = useMemo(() => makePaperAtlasTexture(), []);
  useEffect(
    () => () => {
      cans?.dispose();
      papers?.dispose();
      others?.dispose();
      puddles?.dispose();
      canAtlas.dispose();
      paperAtlas.dispose();
    },
    [cans, papers, others, puddles, canAtlas, paperAtlas],
  );

  return (
    <group>
      {cans && (
        <mesh geometry={cans} castShadow receiveShadow>
          {/* 라벨 그림 × 정점색(때·깊이 감광) */}
          <meshToonMaterial map={canAtlas} vertexColors gradientMap={TOON_GRADIENT} />
          <ToonOutline outline={outline} />
        </mesh>
      )}
      {papers && (
        <mesh geometry={papers} castShadow receiveShadow>
          {/* 귀퉁이가 말려 뒷면이 드러나므로 양면 */}
          <meshToonMaterial map={paperAtlas} vertexColors gradientMap={TOON_GRADIENT} side={THREE.DoubleSide} />
          <ToonOutline outline={outline} />
        </mesh>
      )}
      {others && (
        <mesh geometry={others} castShadow receiveShadow>
          {/* 색은 전부 정점색에 구웠다 — 재질 색은 흰색 */}
          <meshToonMaterial vertexColors color="#ffffff" gradientMap={TOON_GRADIENT} flatShading />
          <ToonOutline outline={outline} />
        </mesh>
      )}
      {puddles && (
        <mesh geometry={puddles}>
          <meshBasicMaterial vertexColors transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <Drips spots={spots} ceilingY={ceilingY} floorY={floorY} brightness={brightness} quietZs={quietZs} />
    </group>
  );
}
