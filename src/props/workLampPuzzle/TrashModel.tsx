import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { mergeAndDispose } from "@/engine/geometry";
import { createRandom } from "@/engine/random";
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
  } else if (id === "mask") {
    // 일회용 마스크 — 주름 셋이 잡힌 몸판이 바닥에 반쯤 오므라져 있다. 귀끈 둘, 코 철사 하나
    // 크기 기준: 페트병 0.68 ≈ 22cm → 1 유닛 ≈ 32cm. 마스크 17.5cm × 9cm
    const W = 0.54,
      H = 0.28;
    const body = new THREE.PlaneGeometry(W, H, 24, 12);
    const pos = body.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i);
      const pleat = Math.abs(Math.sin(((y + H / 2) / H) * Math.PI * 3)) * 0.012;
      const cup = (x / (W / 2)) ** 2 * 0.07 + (y / (H / 2)) ** 2 * 0.016; // 가장자리가 들린다
      pos.setZ(i, pleat + cup);
    }
    body.computeVertexNormals();
    body.rotateX(-Math.PI / 2);
    o.body = body;
    o.wire = new THREE.BoxGeometry(0.15, 0.007, 0.01);
    // 귀끈 둘은 한 메시 — 쓰레기 하나에 드로우콜을 아낀다
    o.loops = mergeAndDispose(
      [-1, 1].map((side) => {
        const path = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * (W / 2 - 0.01), 0.014, -H * 0.4),
          new THREE.Vector3(side * (W / 2 + 0.1), 0.005, -H * 0.16),
          new THREE.Vector3(side * (W / 2 + 0.13), 0.005, H * 0.16),
          new THREE.Vector3(side * (W / 2 - 0.01), 0.014, H * 0.4),
        ]);
        return new THREE.TubeGeometry(path, 24, 0.006, 6, false);
      }),
    );
  } else if (id === "chopsticks") {
    // 쪼갠 나무젓가락 한 쌍 — 네모난 단면이 끝으로 갈수록 가늘다. 끝에 양념이 묻었다. 찢긴 종이 봉지가 옆에
    // 젓가락 20cm → 0.62
    // 한 쌍을 한 메시로, 양념 둘도 한 메시로 — 쓰레기 하나에 드로우콜 셋
    const pair = (make: () => THREE.BufferGeometry) =>
      mergeAndDispose(
        [-1, 1].map((side) => {
          const g = make();
          g.rotateY(side * 0.07);
          g.translate(0, 0, side * 0.018);
          return g;
        }),
      );
    o.sticks = pair(() => {
      const g = new THREE.CylinderGeometry(0.009, 0.016, 0.62, 4);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 4); // 각진 면이 바닥에 눕게
      return g;
    });
    o.sauce = pair(() => {
      const g = new THREE.SphereGeometry(0.018, 8, 6);
      g.scale(1.8, 0.5, 1);
      g.translate(-0.28, 0.006, 0);
      return g;
    });
    o.sleeve = new THREE.PlaneGeometry(0.3, 0.11);
    o.sleeve.rotateX(-Math.PI / 2);
  } else if (id === "trashBag") {
    // 묶은 종량제 봉투(5L) — 구를 울퉁불퉁 눌러 속이 찬 꼴로. UV 는 구면 그대로라 인쇄가 앞쪽에 한 번 붙는다
    const sack = new THREE.SphereGeometry(0.3, 28, 18);
    const rnd = createRandom(41);
    const bumps = new Map<string, number>();
    const pos = sack.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let k = bumps.get(key);
      if (k === undefined) {
        k = 0.86 + rnd() * 0.24;
        bumps.set(key, k);
      }
      // 아래는 바닥에 눌려 납작, 위는 묶어 오므라든다
      const y = pos.getY(i) / 0.3;
      const squash = y < 0 ? 0.78 : 1 - y * 0.18;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
    }
    sack.computeVertexNormals();
    o.sack = sack;
    // 묶은 매듭과 양쪽으로 삐죽 선 손잡이 귀
    o.knot = new THREE.SphereGeometry(0.05, 10, 8);
    o.ears = mergeAndDispose(
      [-1, 1].map((side) => {
        const g = new THREE.ConeGeometry(0.045, 0.22, 7);
        g.translate(0, 0.11, 0);
        g.rotateZ(side * 0.7);
        g.translate(side * 0.03, 0, 0);
        return g;
      }),
    );
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
  if (id === "mask")
    return (
      <group position={[0, 0.01, 0]} rotation={[0, 0.3, 0]}>
        {/* 안팎이 다 보이는 얇은 부직포 — 겉은 희고 때가 탔다 */}
        <mesh geometry={geo.body} castShadow>
          {toon("#e9ebe6", 1, { side: THREE.DoubleSide })}
          {rim}
        </mesh>
        <mesh geometry={geo.wire} position={[0, 0.02, -0.13]}>
          {toon("#8c8f93")}
        </mesh>
        <mesh geometry={geo.loops}>{toon("#f3f4f1")}</mesh>
      </group>
    );
  if (id === "chopsticks")
    return (
      <group position={[0, 0.012, 0]} rotation={[0, -0.25, 0]}>
        <mesh geometry={geo.sticks} castShadow>
          {toon("#d9b878")}
          {rim}
        </mesh>
        {/* 가는 끝에 묻은 양념 */}
        <mesh geometry={geo.sauce}>{toon("#9a3b1c")}</mesh>
        <mesh geometry={geo.sleeve} position={[0.2, 0.001, 0.14]} rotation={[0, 0.7, 0]}>
          <meshToonMaterial
            map={makePrintTexture("sleeve")}
            color={white}
            gradientMap={TOON_GRADIENT}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    );
  if (id === "trashBag")
    return (
      <group position={[0, 0.23, 0]} rotation={[0.12, 1.9, 0]}>
        <mesh geometry={geo.sack} castShadow>
          <meshToonMaterial map={makePrintTexture("bag")} color={white} gradientMap={TOON_GRADIENT} />
          {rim}
        </mesh>
        <group position={[0, 0.27, 0]}>
          <mesh geometry={geo.knot}>{toon("#e4e6e1")}</mesh>
          <mesh geometry={geo.ears} castShadow>
            {toon("#eceeea")}
            {rim}
          </mesh>
        </group>
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
