import { useEffect } from "react";

import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import type { ColliderBox } from "@/station/layout/collision";

import type { WorkLampPuzzleValues } from "./controls";
import { BIN_SIZE } from "./dimensions";
import RecyclingBin from "./RecyclingBin";
import TrashModel from "./TrashModel";
import { floorStainTexture } from "./trashTextures";
import {
  BIN_LABELS,
  binCount,
  heldTrash,
  isSortingDone,
  isWorkLampPuzzleHandFull,
  pickUpTrash,
  throwTrash,
  TRASH_ITEMS,
  trashPlace,
  useCorridorPower,
  useTrashKey,
  type TrashBin,
  type TrashId,
} from "./workLampState";

export type RegisterCollider = (name: string, box: ColliderBox) => (() => void) | void;

/** 통 둘레 바닥의 쓰레기 자리 [x, z, 돌림] (통이 바깥벽 z −41.9 · −40.1 에 선다) */
const TRASH_SPOTS: Record<TrashId, [number, number, number]> = {
  petBottle: [-28.6, -43.1, 0.35],
  detergentBottle: [-27.4, -41.6, -0.4],
  yogurtBottle: [-29.3, -38.7, 0.2],
  takeoutCup: [-28.1, -39.3, 1.2],
  toothbrush: [-26.8, -42.7, 0.9],
  straw: [-29.2, -41.0, -0.5],
  receipt: [-26.5, -40.1, 0.25],
  tissue: [-28.5, -37.8, 0],
};

const GENERAL_COUNT = TRASH_ITEMS.filter((t) => t.bin === "general").length;
const PLASTIC_COUNT = TRASH_ITEMS.length - GENERAL_COUNT;

interface RecyclingProps {
  values: Pick<WorkLampPuzzleValues, "binGeneralZ" | "binPlasticZ" | "binOffset" | "trashScale">;
  outerX: number;
  brightnessAt: (z: number) => number;
  registerCollider?: RegisterCollider;
  outline?: OutlineValues | null;
}

/**
 * ⟦분리수거 퍼즐⟧ 막힌 옆문 옆 통 둘 + 널린 쓰레기 여덟. 비상 전원이 들어와야 무엇인지 보이고 주울 수 있다.
 * 통마다 몫(넷)을 칸 수로 말해 주고, 다 채우면 그 통의 선으로 전류가 흐른다.
 */
export default function Recycling({ values, outerX, brightnessAt, registerCollider, outline }: RecyclingProps) {
  const isPowered = useCorridorPower();
  useTrashKey(); // 쓰레기 자리가 바뀌면 다시 그린다(값은 아래에서 직접 읽는다)
  const bins: { bin: TrashBin; z: number }[] = [
    { bin: "general", z: values.binGeneralZ },
    { bin: "plastic", z: values.binPlasticZ },
  ];
  const binX = outerX + values.binOffset;
  // 통은 사람보다 크다 — 걸어서 뚫고 지나가면 안 된다
  useEffect(() => {
    if (!registerCollider) return;
    const releases = (
      [
        ["general", values.binGeneralZ],
        ["plastic", values.binPlasticZ],
      ] as const
    ).map(([bin, z]) =>
      registerCollider(`recyclingBin:${bin}`, {
        minX: binX,
        maxX: binX + BIN_SIZE.depth + 0.1,
        minZ: z - BIN_SIZE.width / 2 - 0.05,
        maxZ: z + BIN_SIZE.width / 2 + 0.05,
      }),
    );
    return () => releases.forEach((release) => release?.());
  }, [registerCollider, binX, values.binGeneralZ, values.binPlasticZ]);
  const stain = floorStainTexture();
  const centerZ = (values.binGeneralZ + values.binPlasticZ) / 2;
  return (
    <group>
      <mesh position={[binX + 1.6, 0.02, centerZ]} rotation={[-Math.PI / 2, 0, 0.4]}>
        <planeGeometry args={[4.2, 5.2]} />
        <meshBasicMaterial map={stain} transparent depthWrite={false} opacity={0.9} />
      </mesh>
      {bins.map(({ bin, z }) => (
        <group key={bin}>
          <Highlight id={`recycling:bin:${bin}`} anchor={() => null} grow={0} strength={0.14}>
            <RecyclingBin
              bin={bin}
              position={[binX, 0.01, z]}
              direction={1}
              brightness={brightnessAt(z)}
              slotCount={bin === "general" ? GENERAL_COUNT : PLASTIC_COUNT}
              filledCount={binCount(bin)}
              outline={outline}
            />
          </Highlight>
          <Interactable
            id={`recycling:bin:${bin}`}
            radius={1.1}
            reach={6.5}
            position={() => [binX + BIN_SIZE.depth * 0.62, BIN_SIZE.bodyHeight + 0.2, z]}
            label={`[E] ${BIN_LABELS[bin]}에 버리기`}
            disabled={() => !heldTrash()}
            run={() => throwTrash(bin)}
          />
        </group>
      ))}

      {TRASH_ITEMS.map((t) => {
        if (trashPlace(t.id) !== "floor") return null;
        const [x, z, yaw] = TRASH_SPOTS[t.id];
        return (
          <group key={t.id}>
            <Highlight id={`recycling:${t.id}`} anchor={() => [x, 0.1, z]} grow={0.12} strength={0.5}>
              <group position={[x, 0.01, z]} rotation={[0, yaw, 0]} scale={values.trashScale}>
                {/* 어둠 속에선 형체만 — 비상 전원이 들어와야 무엇인지 보인다 */}
                <TrashModel id={t.id} brightness={brightnessAt(z)} />
              </group>
            </Highlight>
            <Interactable
              id={`recycling:${t.id}`}
              radius={0.85}
              reach={6.5}
              position={() => [x, 0.25, z]}
              label={`[E] ${t.name} 줍기`}
              // 비상 전원 전에는 어둠 속이라 못 줍고, 다 끝난 뒤엔 할 일이 없다
              disabled={() => !isPowered || isSortingDone() || isWorkLampPuzzleHandFull()}
              run={() => pickUpTrash(t.id)}
            />
          </group>
        );
      })}
    </group>
  );
}
