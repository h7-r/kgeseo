import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { UNIT_BOX } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { toggleFlap, vendingMachineStore, type VendingId } from "@/props/vendingMachineState";
import { getWorldPositionOf } from "@/props/shared/aimTarget";
import ToonMaterial from "@/props/shared/ToonMaterial";

import { buildMergedBoxGeometry } from "./vendingGeometry";

interface DispenserFlapProps {
  y: number;
  width: number;
  depth: number;
  height?: number;
  innerColor?: string;
  flapColor: string;
  outline?: OutlineValues | null;
  /** 없으면 만질 수 없는 장식 */
  vendingId?: VendingId;
  /** 닫혔을 때 기울기(도). 0 이면 수직, 음수면 앞으로 눕는다 */
  closedAngle?: number;
  /** 열었을 때(도). −90 보다 작으면 수평을 넘겨 위로 젖혀진다 */
  openAngle?: number;
  /** 구역 높이 대비 덮개 판의 세로 */
  flapHeight?: number;
  /** 바닥판이 자판기 앞면보다 더 나오는 길이 */
  trayReach?: number;
  /** 옆판이 앞 끝에 남기는 높이(구역 높이 대비) */
  sideFrontRatio?: number;
}

/**
 * 음료 배출구 — 우묵하게 파인 구멍과 위쪽 경첩 덮개. [E] 로 안쪽·위로 밀어 올려 음료를 꺼낸다.
 * 옆판이 뒤는 높고 앞은 낮은 사다리꼴이라 덮개를 젖히면 속이 비스듬히 드러난다.
 */
export default function DispenserFlap({
  y,
  width,
  depth,
  height = 1.1,
  innerColor = "#15171b",
  flapColor,
  outline,
  vendingId,
  closedAngle = -26,
  openAngle = -104,
  flapHeight = 0.72,
  trayReach = 0.34,
  sideFrontRatio = 0.22,
}: DispenserFlapProps) {
  const halfDepth = depth / 2;
  // 경첩 자리는 닫힌 각도가 바뀌어도 덮개 가운데가 같은 자리에 오도록 역산한다.
  const closedRad = (closedAngle * Math.PI) / 180;
  const openRad = (openAngle * Math.PI) / 180;
  const arm = height * 0.4;
  const hingeY = 0.16 + arm * Math.cos(closedRad);
  const hingeZ = halfDepth - 0.16 + arm * Math.sin(closedRad);
  const flapRef = useRef<THREE.Group>(null);
  const openness = useRef(0);
  useFrame((_, dt) => {
    const flap = flapRef.current;
    if (!flap) return;
    const target = vendingId && vendingMachineStore.get(vendingId).flapOpen ? 1 : 0;
    // 지수 감쇠 — 프레임 수와 상관없이 같은 속도로 붙는다
    openness.current += (target - openness.current) * (1 - Math.exp(-dt * 11));
    flap.rotation.x = closedRad + (openRad - closedRad) * openness.current;
  });

  const sideFrontHeight = Math.max(0.03, height * sideFrontRatio);
  const inner = useMemo(() => {
    const backZ = halfDepth - 1.3;
    const frontZ = halfDepth + trayReach;
    const sideThickness = 0.12;
    // 상자(index 있음)와 Extrude(index 없음)를 섞으면 mergeGeometries 가 null 을 돌려줘 렌더가 죽는다.
    const boxes = buildMergedBoxGeometry([
      { size: [width, 0.12, frontZ - backZ], position: [0, -height / 2, (frontZ + backZ) / 2] },
      { size: [width, height, 0.12], position: [0, 0, backZ + 0.06] },
    ]);
    const pieces = [boxes.toNonIndexed()];
    boxes.dispose();
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(backZ, -height / 2);
      shape.lineTo(backZ, height / 2);
      shape.lineTo(frontZ, -height / 2 + sideFrontHeight);
      shape.lineTo(frontZ, -height / 2);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: sideThickness, bevelEnabled: false });
      // (z, y) 평면에 그린 모양을 세운다: 모양의 x → 월드 z, 밀어낸 z → 월드 −x
      geometry.rotateY(-Math.PI / 2);
      geometry.translate(side * (width / 2) + sideThickness / 2, 0, 0);
      pieces.push(geometry);
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((geometry) => geometry.dispose());
    return merged;
  }, [width, height, halfDepth, sideFrontHeight, trayReach]);
  useEffect(() => () => inner.dispose(), [inner]);

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={inner}>
        <ToonMaterial color={innerColor} />
      </mesh>
      <group ref={flapRef} position={[0, hingeY, hingeZ]}>
        {vendingId && (
          <Interactable
            id={`vendingFlap:${vendingId}`}
            radius={0.6}
            reach={5}
            position={() => getWorldPositionOf(flapRef)}
            label=""
            run={() => toggleFlap(vendingId)}
          />
        )}
        {/* 주름선은 메시와 같은 지오여야 맞는다 — 단위 상자를 scale 로 늘린다 */}
        <mesh geometry={UNIT_BOX} scale={[width - 0.1, height * flapHeight, 0.1]} position={[0, -arm, 0]} castShadow>
          <ToonMaterial color={flapColor} />
          <ToonOutline geometry={UNIT_BOX} outline={outline} />
        </mesh>
      </group>
    </group>
  );
}
