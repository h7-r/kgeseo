import { useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";

import type { MergeBox } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { heldCoin, registerReturnLanding, registerReturnSlot, tryInsertCoin } from "@/props/coinState";
import type { VendingId } from "@/props/vendingMachineState";

import { mergedBoxes } from "./common";
import { worldPositionOf } from "@/props/shared/worldPosition";
import ToonMaterial from "@/props/shared/ToonMaterial";

interface PaymentPanelProps {
  y: number;
  x: number;
  /**
   * 기본 0.04. 구멍 속 어둠의 앞면이 뒤 판보다 확실히 앞이어야 한다 —
   * 커피 자판기 제어 스트립과 0.005 만 뜨면 멀리서 깊이가 엎치락뒤치락해 스트립 색이 깜빡인다.
   */
  z?: number;
  depth: number;
  color: string;
  darkColor: string;
  /** 구멍 안쪽 — 빛이 안 드는 어둠 */
  innerColor?: string;
  height?: number;
  outline?: OutlineValues | null;
  /** 없으면 만질 수 없는 장식 */
  vendingId?: VendingId;
}

interface Hole {
  name: "return" | "coin" | "bill";
  y: number;
  w: number;
  h: number;
}

const PANEL_WIDTH = 0.46;
const PANEL_DEPTH = 0.14;
// 이만큼이 구멍 테두리 = 파여 보이는 깊이. 커피 자판기 스트립 판보다 앞이어야 해서 0.035 가 상한이다.
const FRONT_THICKNESS = 0.035;
const CAVITY_DEPTH = PANEL_DEPTH - FRONT_THICKNESS;

/**
 * 결제부 — 지폐 투입구·동전 투입구·동전 반환구.
 * 어두운 상자를 얹으면 판에 붙인 검은 스티커로 보여, 앞판을 구멍 자리만 비운 조각들로 만들고 뒤에 어두운 굴을 둔다.
 */
export default function PaymentPanel({
  y,
  x,
  z = 0.04,
  depth,
  color,
  darkColor,
  innerColor = "#0c0e11",
  height = 1.3,
  outline,
  vendingId,
}: PaymentPanelProps) {
  const halfDepth = depth / 2;
  const rootRef = useRef<THREE.Group>(null);
  // 패널 원점을 겨냥하면 동전이 구멍이 아닌 곳으로 날아간다. 진짜 구멍 자리에 기준점을 둔다.
  const slotRef = useRef<THREE.Group>(null);
  const returnSlotRef = useRef<THREE.Group>(null);
  const returnLandingRef = useRef<THREE.Group>(null);

  // 월드 행렬이 준비될 때까지 다시 잰다.
  useEffect(() => {
    if (!vendingId) return;
    let triesLeft = 20;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const slot = worldPositionOf(returnSlotRef);
      const landing = worldPositionOf(returnLandingRef);
      if (slot && landing) {
        registerReturnSlot(vendingId, slot);
        registerReturnLanding(vendingId, landing);
        return;
      }
      if (--triesLeft > 0) timer = setTimeout(measure, 100);
    };
    timer = setTimeout(measure, 100);
    return () => clearTimeout(timer);
  }, [vendingId]);

  const scale = height / 1.3;

  // 구멍이 전부 가로 가운데라 판을 가로 띠로 잘라 만들 수 있다.
  const holes = useMemo<Hole[]>(() => {
    const limit = height / 2 - 0.03;
    const all: Hole[] = [
      { name: "return", y: -0.42 * scale, w: 0.28, h: 0.16 },
      { name: "coin", y: 0.05 * scale, w: 0.07, h: 0.3 * scale },
      { name: "bill", y: 0.42 * scale, w: 0.32, h: 0.08 },
    ];
    return all
      .filter((hole) => Math.abs(hole.y) + hole.h / 2 <= limit && hole.w < PANEL_WIDTH - 0.04)
      .sort((a, b) => a.y - b.y);
  }, [scale, height]);

  // 띠 경계 [맨아래, 구멍1아래, 구멍1위, …, 맨위]. 짝수 칸 = 막힌 띠, 홀수 칸 = 구멍 띠(양옆만 남긴다).
  const front = useMemo(() => {
    const edges = [-height / 2];
    for (const hole of holes) edges.push(hole.y - hole.h / 2, hole.y + hole.h / 2);
    edges.push(height / 2);
    const zc = halfDepth - FRONT_THICKNESS / 2;
    const boxes: MergeBox[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const h = edges[i + 1] - edges[i];
      if (h <= 1e-4) continue;
      const yc = (edges[i] + edges[i + 1]) / 2;
      if (i % 2 === 0) {
        boxes.push({ size: [PANEL_WIDTH, h, FRONT_THICKNESS], position: [0, yc, zc] });
      } else {
        const hole = holes[(i - 1) / 2];
        const side = (PANEL_WIDTH - hole.w) / 2;
        boxes.push({ size: [side, h, FRONT_THICKNESS], position: [-(PANEL_WIDTH - side) / 2, yc, zc] });
        boxes.push({ size: [side, h, FRONT_THICKNESS], position: [(PANEL_WIDTH - side) / 2, yc, zc] });
      }
    }
    return mergedBoxes(boxes);
  }, [holes, height, halfDepth]);

  // 구멍 뒤 어두운 공간. 뒤의 광고판·스트립을 덮어 가린다.
  const cavity = useMemo(
    () =>
      mergedBoxes([
        { size: [PANEL_WIDTH, height, CAVITY_DEPTH], position: [0, 0, halfDepth - FRONT_THICKNESS - CAVITY_DEPTH / 2] },
      ]),
    [height, halfDepth],
  );

  // 반환구 둘레에 앞으로 세운 테 — 앞판만으로는 얕아서 '손을 넣어 집는 자리'로 안 읽힌다.
  const returnHole = holes.find((hole) => hole.name === "return");
  const returnRim = useMemo(() => {
    if (!returnHole) return null;
    const rim = 0.05;
    const protrude = 0.04;
    const zc = halfDepth + protrude / 2;
    const w = returnHole.w + rim * 2;
    return mergedBoxes([
      { size: [w, rim, protrude], position: [0, returnHole.y + returnHole.h / 2 + rim / 2, zc] },
      { size: [w, rim, protrude], position: [0, returnHole.y - returnHole.h / 2 - rim / 2, zc] },
      { size: [rim, returnHole.h, protrude], position: [-returnHole.w / 2 - rim / 2, returnHole.y, zc] },
      { size: [rim, returnHole.h, protrude], position: [returnHole.w / 2 + rim / 2, returnHole.y, zc] },
    ]);
  }, [returnHole, halfDepth]);

  useEffect(
    () => () => {
      front.dispose();
      cavity.dispose();
      returnRim?.dispose();
    },
    [front, cavity, returnRim],
  );

  // 조각을 이어 붙인 판이라 주름선을 켜면 이음매마다 줄이 그어진다. 외곽선만으로도 구멍 둘레가 그려진다.
  const panelOutline = outline ? { ...outline, crease: false } : outline;

  return (
    <group position={[x, y, z]} ref={rootRef}>
      <group ref={slotRef} position={[0, 0.05 * scale, halfDepth]} />
      <group ref={returnSlotRef} position={[0, -0.42 * scale, halfDepth]} />
      {/* 반환구보다 앞이자 아래 — 잘못 넣은 동전이 떨어지는 자리 */}
      <group ref={returnLandingRef} position={[0, -0.42 * scale, halfDepth + 0.55]} />
      {vendingId && (
        <Interactable
          id={`vendingCoin:${vendingId}`}
          radius={0.6}
          reach={6}
          position={() => worldPositionOf(slotRef) || worldPositionOf(rootRef)}
          label="동전 넣기"
          // 맞는 동전이면 불이 켜지고 틀리면 반환구로 나온다. 동전을 안 들었으면 겨냥 대상에서 뺀다.
          disabled={() => !heldCoin()}
          run={() => tryInsertCoin(vendingId, worldPositionOf(slotRef) || worldPositionOf(rootRef))}
        />
      )}
      <mesh geometry={cavity}>
        <ToonMaterial color={innerColor} />
      </mesh>
      <mesh geometry={front} castShadow>
        <ToonMaterial color={color} />
        <ToonOutline geometry={front} outline={panelOutline} />
      </mesh>
      {returnRim && (
        <mesh geometry={returnRim} castShadow>
          <ToonMaterial color={darkColor} />
          <ToonOutline geometry={returnRim} outline={panelOutline} />
        </mesh>
      )}
    </group>
  );
}
