import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { mergeBoxes, type MergeBox } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { corridorDepthBrightness, type CorridorDepthRule } from "./depthShading";

/** z축을 따라 뻗는 파이프. CylinderGeometry 는 Y축 방향이라 X로 90° 눕힌다. */
function pipeGeometry(radius: number, z0: number, z1: number, x: number, y: number, lengthSegments = 24) {
  const length = Math.abs(z1 - z0);
  const g = new THREE.CylinderGeometry(radius, radius, length, 8, lengthSegments);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

/** 합친 지오에 정점 z 위치로 밝기를 칠한다. 정점색은 재질 색에 곱해져 한 덩어리 안에서도 z 따라 밝기가 달라진다. */
function applyDepthColors(geometry: THREE.BufferGeometry | null, brightnessAt: (z: number) => number) {
  if (!geometry) return geometry;
  const pos = geometry.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = brightnessAt(pos.getZ(i));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geometry;
}

interface CorridorPipesProps {
  x0?: number;
  x1?: number;
  z0?: number;
  z1?: number;
  height?: number;
  /** 0 = 바깥벽(문 있는 쪽), 1 = 안쪽벽. 문 위를 피해 안쪽으로 치우친다 */
  xRatio?: number;
  /** 천장에서 내려 단 정도 */
  sag?: number;
  largeRadius?: number;
  smallRadius?: number;
  trayWidth?: number;
  rungSpacing?: number;
  hangerSpacing?: number;
  pipeColor?: string;
  trayColor?: string;
  hangerColor?: string;
  brightness?: number;
  /** 벽과 같은 깊이 규칙. 없으면 감광 없음. */
  depth?: CorridorDepthRule | null;
  outline?: OutlineValues | null;
}

/**
 * 천장 배관·전선 트레이. 천장을 따라 뻗은 선이 소실점으로 모여 복도를 길어 보이게 한다.
 * 재질이 같은 것끼리 미리 합쳐 메시 3개로 끝낸다.
 */
export default function CorridorPipes({
  x0 = -31,
  x1 = -20,
  z0 = -60,
  z1 = 25,
  height = 8,
  xRatio = 0.62,
  sag = 0.1,
  largeRadius = 0.18,
  smallRadius = 0.1,
  trayWidth = 1.0,
  rungSpacing = 1.7,
  hangerSpacing = 6,
  pipeColor = "#474c53",
  trayColor = "#474c54",
  hangerColor = "#3e434a",
  brightness = 0.7,
  depth = null,
  outline,
}: CorridorPipesProps) {
  const px = x0 + (x1 - x0) * xRatio;
  const py = height - sag;

  // 부모가 depth 객체를 그 자리에서 만들어 넘기면 렌더마다 새 객체다.
  // 객체째 의존하면 지오를 매번 다시 만들므로 안에 든 숫자들에 의존한다.
  const hasDepth = !!depth;
  const fields: Partial<CorridorDepthRule> = depth ?? {};
  const {
    doorZ = 0,
    falloff = 0,
    darkness = 0,
    minBrightness = 0,
    endDarkness = 0,
    endCurve = 0,
    z0: depthZ0 = 0,
    darkBoundary,
    darkFactor,
    brightBoundary,
  } = fields;
  const brightnessAt = useMemo(() => {
    if (!hasDepth) return () => brightness;
    const rule: CorridorDepthRule = {
      doorZ,
      falloff,
      darkness,
      minBrightness,
      endDarkness,
      endCurve,
      z0: depthZ0,
      darkBoundary,
      darkFactor,
      brightBoundary,
    };
    return (z: number) => corridorDepthBrightness(z, rule) * brightness;
  }, [
    doorZ,
    falloff,
    darkness,
    minBrightness,
    endDarkness,
    endCurve,
    depthZ0,
    darkBoundary,
    darkFactor,
    brightBoundary,
    brightness,
    hasDepth,
  ]);

  const parts = useMemo(() => {
    const zA = Math.min(z0, z1) + 0.2;
    const zB = Math.max(z0, z1) - 0.2;

    // 굵은 것 2 + 전선관 3
    const pipes = mergeGeometries(
      [
        pipeGeometry(largeRadius, zA, zB, px - 0.34, py, 40),
        pipeGeometry(largeRadius * 0.78, zA, zB, px + 0.02, py + 0.06, 40),
        pipeGeometry(smallRadius, zA, zB, px + 0.3, py - 0.02, 40),
        pipeGeometry(smallRadius, zA, zB, px + 0.42, py + 0.05, 40),
        pipeGeometry(smallRadius * 0.8, zA, zB, px + 0.36, py - 0.13, 40),
      ],
      false,
    );

    // 사다리형 케이블 트레이 — 레일 2 + 가로대
    const ty = py - 0.62;
    const rungCount = Math.max(2, Math.floor((zB - zA) / rungSpacing));
    const tray = mergeBoxes([
      ...[-1, 1].map((sx): MergeBox => ({
        size: [0.07, 0.12, zB - zA],
        position: [px + sx * (trayWidth / 2), ty, (zA + zB) / 2],
      })),
      ...Array.from({ length: rungCount }, (_, i): MergeBox => ({
        size: [trayWidth, 0.04, 0.09],
        position: [px, ty - 0.03, zA + ((zB - zA) * (i + 0.5)) / rungCount],
      })),
    ]);

    // 파이프를 천장에 매다는 ㄷ자 행어
    const hangerCount = Math.max(2, Math.floor((zB - zA) / hangerSpacing));
    const hangers = mergeBoxes(
      Array.from({ length: hangerCount }, (_, i) => {
        const z = zA + ((zB - zA) * (i + 0.5)) / hangerCount;
        const pieces: MergeBox[] = [
          ...[-0.5, 0.6].map((sx): MergeBox => ({
            size: [0.06, sag + 0.72, 0.06],
            position: [px + sx, height - (sag + 0.72) / 2, z],
          })),
          {
            size: [1.24, 0.07, 0.07],
            position: [px + 0.05, py - 0.34, z],
          },
          {
            size: [trayWidth + 0.2, 0.06, 0.06],
            position: [px, ty - 0.11, z],
          },
        ];
        return pieces;
      }).flat(),
    );

    return {
      pipes: applyDepthColors(pipes, brightnessAt),
      tray: applyDepthColors(tray, brightnessAt),
      hangers: applyDepthColors(hangers, brightnessAt),
    };
  }, [px, py, z0, z1, height, sag, largeRadius, smallRadius, trayWidth, rungSpacing, hangerSpacing, brightnessAt]);

  useEffect(
    () => () => {
      for (const g of Object.values(parts)) g?.dispose();
    },
    [parts],
  );

  return (
    <group>
      <mesh geometry={parts.pipes ?? undefined} castShadow>
        <meshToonMaterial color={pipeColor} vertexColors gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={parts.pipes ?? undefined} outline={outline} />
      </mesh>
      <mesh geometry={parts.tray ?? undefined} castShadow>
        <meshToonMaterial color={trayColor} vertexColors gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={parts.tray ?? undefined} outline={outline} />
      </mesh>
      <mesh geometry={parts.hangers ?? undefined} castShadow>
        <meshToonMaterial color={hangerColor} vertexColors gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={parts.hangers ?? undefined} outline={outline} />
      </mesh>
    </group>
  );
}
