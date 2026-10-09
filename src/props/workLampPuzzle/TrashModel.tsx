import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { buildCrumpledGeometry, buildLatheGeometry } from "./puzzleGeometry";
import { makePrintTexture } from "./trashTextures";
import type { TrashId } from "./workLampState";

type TrashGeometries = Record<string, THREE.BufferGeometry>;

function buildTrashGeometries(id: TrashId): TrashGeometries {
  const o: TrashGeometries = {};
  if (id === "petBottle") {
    // 500 mL 생수병 — 꽃 모양 바닥 · 허리 홈 · 어깨 · 목
    o.bottle = buildLatheGeometry(
      [
        [0, 0],
        [0.07, 0.004],
        [0.1, 0.02],
        [0.108, 0.05],
        [0.108, 0.22],
        [0.098, 0.245],
        [0.108, 0.27],
        [0.108, 0.46],
        [0.1, 0.52],
        [0.07, 0.6],
        [0.045, 0.64],
        [0.04, 0.68],
      ],
      22,
    );
    o.bottle.scale(1, 1, 0.82); // 한쪽이 밟혀 찌그러졌다
    o.band = new THREE.CylinderGeometry(0.11, 0.11, 0.13, 22, 1, true);
    o.band.scale(1, 1, 0.82);
    o.cap = new THREE.CylinderGeometry(0.044, 0.044, 0.05, 18);
    o.ring = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 18);
  } else if (id === "yogurtBottle") {
    o.bottle = buildLatheGeometry(
      [
        [0, 0],
        [0.05, 0],
        [0.062, 0.015],
        [0.066, 0.07],
        [0.052, 0.11],
        [0.06, 0.15],
        [0.066, 0.2],
        [0.058, 0.235],
        [0.046, 0.25],
        [0.046, 0.26],
      ],
      18,
    );
    o.lid = new THREE.CylinderGeometry(0.05, 0.05, 0.006, 18);
  } else if (id === "takeoutCup") {
    // 16 oz 투명 컵 — 바닥에 남은 커피 · 돔 뚜껑
    o.cup = new THREE.CylinderGeometry(0.15, 0.105, 0.46, 24, 1, true);
    o.bottom = new THREE.CircleGeometry(0.105, 24);
    o.coffee = new THREE.CylinderGeometry(0.118, 0.103, 0.1, 24);
    o.lid = new THREE.CylinderGeometry(0.157, 0.157, 0.025, 24);
    o.dome = new THREE.SphereGeometry(0.13, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  } else if (id === "detergentBottle") {
    // 손잡이 구멍이 뚫린 옆모습 — 눕혀 두어 라벨이 위를 본다
    const outline = new THREE.Shape();
    outline.moveTo(-0.2, 0);
    outline.lineTo(0.2, 0);
    outline.quadraticCurveTo(0.23, 0, 0.23, 0.04);
    outline.lineTo(0.23, 0.56);
    outline.quadraticCurveTo(0.23, 0.66, 0.12, 0.7);
    outline.lineTo(0.02, 0.7);
    outline.lineTo(-0.06, 0.62);
    outline.lineTo(-0.2, 0.62);
    outline.quadraticCurveTo(-0.23, 0.62, -0.23, 0.58);
    outline.lineTo(-0.23, 0.04);
    outline.quadraticCurveTo(-0.23, 0, -0.2, 0);
    const hole = new THREE.Path();
    hole.moveTo(0.06, 0.4);
    hole.lineTo(0.17, 0.4);
    hole.quadraticCurveTo(0.19, 0.4, 0.19, 0.44);
    hole.lineTo(0.19, 0.56);
    hole.quadraticCurveTo(0.15, 0.62, 0.1, 0.6);
    hole.lineTo(0.06, 0.52);
    hole.closePath();
    outline.holes.push(hole);
    o.jug = new THREE.ExtrudeGeometry(outline, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
      curveSegments: 8,
    });
    o.jug.translate(0, 0, -0.08);
    o.cap = new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16);
  } else if (id === "toothbrush") {
    const outline = new THREE.Shape();
    outline.moveTo(-0.3, -0.018);
    outline.quadraticCurveTo(-0.32, 0, -0.3, 0.02);
    outline.quadraticCurveTo(-0.1, 0.032, 0.06, 0.012);
    outline.lineTo(0.2, 0.012);
    outline.quadraticCurveTo(0.29, 0.016, 0.29, 0);
    outline.quadraticCurveTo(0.29, -0.016, 0.2, -0.012);
    outline.lineTo(0.06, -0.012);
    outline.quadraticCurveTo(-0.1, -0.03, -0.3, -0.018);
    o.handle = new THREE.ExtrudeGeometry(outline, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 2,
    });
    o.handle.rotateX(-Math.PI / 2);
    o.bristle = new THREE.BoxGeometry(0.013, 0.05, 0.013);
  } else if (id === "straw") {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, 0, 0),
      new THREE.Vector3(0.12, 0, 0),
      new THREE.Vector3(0.2, 0.02, 0.05),
      new THREE.Vector3(0.24, 0.03, 0.16),
    ]);
    o.straw = new THREE.TubeGeometry(path, 40, 0.014, 8, false);
  } else if (id === "receipt") {
    // 감열지 한 장 — 위쪽 끝이 돌돌 말려 올라간다
    const g = new THREE.PlaneGeometry(0.2, 0.62, 1, 40);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); // −0.31 ~ 0.31
      const t = Math.max(0, (y - 0.06) / 0.25);
      const angle = t * Math.PI * 1.5;
      const r = 0.045;
      const ny = t > 0 ? 0.06 + Math.sin(angle) * r : y;
      const nz = t > 0 ? (1 - Math.cos(angle)) * r : 0;
      pos.setXYZ(i, pos.getX(i), ny, nz + Math.sin(y * 9) * 0.004);
    }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);
    o.paper = g;
  } else {
    o.large = buildCrumpledGeometry(0.13, 7);
    o.small = buildCrumpledGeometry(0.09, 13);
  }
  return o;
}

interface ToonExtra {
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: THREE.Side;
}

const SEE_THROUGH: ToonExtra = { transparent: true, opacity: 0.62, depthWrite: false };

interface TrashModelProps {
  id: TrashId;
  brightness?: number;
}

/** 쓰레기 한 점의 생김새. 원점이 바닥에 닿는 자리다. */
export default function TrashModel({ id, brightness = 1 }: TrashModelProps) {
  const geo = useMemo(() => buildTrashGeometries(id), [id]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  const toon = (color: string, factor = 1, extra: ToonExtra = {}) => (
    <meshToonMaterial color={scaleColor(color, brightness * factor)} gradientMap={TOON_GRADIENT} {...extra} />
  );
  const rim = <Outlines thickness={2} color="#131416" />;
  const white = scaleColor("#ffffff", brightness);

  if (id === "petBottle")
    return (
      <group rotation={[0, 0, Math.PI / 2]} position={[0.34, 0.09, 0]}>
        <mesh geometry={geo.bottle} castShadow>
          {toon("#bfe3f2", 1.05, SEE_THROUGH)}
          {rim}
        </mesh>
        <mesh geometry={geo.band} position={[0, 0.36, 0]}>
          <meshToonMaterial map={makePrintTexture("water")} color={white} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh geometry={geo.ring} position={[0, 0.655, 0]}>
          {toon("#2f7ad8")}
        </mesh>
        <mesh geometry={geo.cap} position={[0, 0.69, 0]} castShadow>
          {toon("#2f7ad8")}
          {rim}
        </mesh>
      </group>
    );
  if (id === "yogurtBottle")
    return (
      <group rotation={[0, 0, 1.3]} position={[0.1, 0.06, 0]}>
        <mesh geometry={geo.bottle} castShadow>
          <meshToonMaterial map={makePrintTexture("yogurt")} color={white} gradientMap={TOON_GRADIENT} />
          {rim}
        </mesh>
        {/* 반쯤 뜯긴 은박 뚜껑 */}
        <mesh geometry={geo.lid} position={[0.01, 0.264, 0.012]} rotation={[0.5, 0, 0.2]}>
          {toon("#d8233b", 1.1)}
        </mesh>
      </group>
    );
  if (id === "takeoutCup")
    return (
      <group rotation={[0, 0, Math.PI / 2 - 0.06]} position={[0.22, 0.14, 0]}>
        <mesh geometry={geo.cup} position={[0, 0.23, 0]} castShadow>
          {toon("#e6f2f6", 1.05, { ...SEE_THROUGH, side: THREE.DoubleSide })}
          {rim}
        </mesh>
        <mesh geometry={geo.bottom} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          {toon("#e6f2f6", 1, SEE_THROUGH)}
        </mesh>
        {/* 다 못 마신 커피 — 이물질 묻은 채 버리면 원래는 안 된다 */}
        <mesh geometry={geo.coffee} position={[0, 0.05, 0]}>
          {toon("#5a3520", 1, { transparent: true, opacity: 0.85 })}
        </mesh>
        <mesh geometry={geo.lid} position={[0, 0.47, 0]}>
          {toon("#f1f5f7", 1, SEE_THROUGH)}
        </mesh>
        <mesh geometry={geo.dome} position={[0, 0.482, 0]} scale={[1, 0.45, 1]}>
          {toon("#f1f5f7", 1, SEE_THROUGH)}
        </mesh>
      </group>
    );
  if (id === "detergentBottle")
    return (
      <group rotation={[-Math.PI / 2, 0, 0.3]} position={[0, 0.1, 0]}>
        <mesh geometry={geo.jug} castShadow>
          {toon("#1f63c9")}
          {rim}
        </mesh>
        <mesh position={[-0.02, 0.3, 0.101]}>
          <planeGeometry args={[0.36, 0.34]} />
          <meshToonMaterial map={makePrintTexture("detergent")} color={white} gradientMap={TOON_GRADIENT} transparent />
        </mesh>
        <mesh geometry={geo.cap} position={[0.07, 0.73, 0]}>
          {toon("#f07a1a")}
          {rim}
        </mesh>
      </group>
    );
  if (id === "toothbrush")
    return (
      <group position={[0, 0.025, 0]} rotation={[0, 0.2, 0]}>
        <mesh geometry={geo.handle} castShadow>
          {toon("#2fb3a2")}
          {rim}
        </mesh>
        <mesh position={[-0.2, 0.02, 0]}>
          <boxGeometry args={[0.1, 0.04, 0.045]} />
          {toon("#e9f1ef")}
        </mesh>
        {/* 털 뭉치 스물넷 — 끝이 벌어진 다 쓴 칫솔 */}
        {Array.from({ length: 24 }, (_, i) => {
          const row = i % 3,
            column = Math.floor(i / 3);
          return (
            <mesh
              key={i}
              geometry={geo.bristle}
              position={[0.14 + column * 0.018, 0.058, (row - 1) * 0.016]}
              rotation={[(row - 1) * 0.35, 0, (column - 3.5) * 0.06]}
            >
              {toon(column % 3 === 0 ? "#6fb9e8" : "#f4f6f8")}
            </mesh>
          );
        })}
      </group>
    );
  if (id === "straw")
    return (
      <group position={[0, 0.016, 0]}>
        <mesh geometry={geo.straw} castShadow>
          <meshToonMaterial map={makePrintTexture("straw")} color={white} gradientMap={TOON_GRADIENT} />
          {rim}
        </mesh>
      </group>
    );
  if (id === "receipt")
    return (
      <group position={[0, 0.012, 0]}>
        <mesh geometry={geo.paper} castShadow>
          <meshToonMaterial
            map={makePrintTexture("receipt")}
            color={white}
            gradientMap={TOON_GRADIENT}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    );
  return (
    <group position={[0, 0.1, 0]}>
      <mesh geometry={geo.large} castShadow>
        {toon("#f3f4f1")}
        {rim}
      </mesh>
      <mesh geometry={geo.small} position={[0.18, -0.03, 0.07]} rotation={[0.6, 0.3, 0]}>
        {toon("#e8eae5")}
        {rim}
      </mesh>
    </group>
  );
}
