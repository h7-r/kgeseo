import { useEffect, useMemo } from "react";

import type { ItemSpot, LobbyState } from "@/lobby/interactions";
import {
  registerSnapPoint,
  setMovedItems,
  surfaceHeightAt,
  unregisterSnapPoint,
  useSurfaceVersion,
} from "@/lobby/placement";
import { monitorRelativePose, type DeskPose } from "@/station/office/deskLayout";
import { EVIDENCE_ITEMS } from "@/station/office/evidence/evidenceItems";
import { PAPER_SINK_DEPTH } from "@/station/office/paper";

import type { CoatRackControls, HatValues } from "../controls/furnitureControls";
import type {
  EvidenceControls,
  EvidencePose,
  KeyboardMouseControls,
  LaptopValues,
  MonitorValues,
  MugValues,
} from "../controls/officePropControls";
import type { PaperValues } from "../controls/paperControls";
import { DRAWER_RIDERS } from "./cabinetDrawers";

/** 들었다 놓을 수 있는 물건. kind 는 쥠표(gripTable)가 「어떻게 쥐나」를 정하는 이름이다. name 은 화면 안내에 보인다. */
export type PickupItem =
  | { id: string; kind: "mug"; name: string; values: MugValues }
  | { id: string; kind: "laptop"; name: string; values: LaptopValues }
  | { id: string; kind: "paper"; name: string; values: PaperValues }
  | { id: string; kind: "hat"; name: string; values: HatValues }
  | { id: string; kind: "numberTag"; name: string; number: number; values: EvidencePose }
  | { id: string; kind: "box" | "collectionBox"; name: string; caseNo: string; values: EvidencePose }
  | { id: string; kind: "keyboard" | "mouse"; name: string; values: DeskPose };

export type PickupKind = PickupItem["kind"];

/** 지금 놓인 자리 — 옮긴 적이 없으면 Leva 제자리 */
export const pickupSpot = (item: PickupItem, itemSpots: LobbyState["itemSpots"]): ItemSpot =>
  itemSpots[item.id] ?? { x: item.values.x, y: item.values.height, z: item.values.z, rot: item.values.rotation };

/** 발자국을 다시 잴 크기 값 — 개별크기가 없으면 크기, 둘 다 없으면 1 */
export const pickupSize = (item: PickupItem) =>
  "sizeMul" in item.values ? item.values.sizeMul : "size" in item.values ? item.values.size : 1;

const pickupTilt = (item: PickupItem) => (item.kind === "hat" ? item.values.tilt : 0);

/**
 * 서류 높이는 책상 윗면에서 가져온다. 「서류N › 높이」와 「책상N › 높이」가 따로 놀면 서류가 공중에 뜨는데 눈으로는 어느 쪽이 틀렸는지 모른다.
 * 면은 GLB 가 다 붙은 뒤에야 등록돼서 useSurfaceVersion 이 그때 한 번 더 그려 준다.
 */
function useDeskFittedPapers(papers: readonly PaperValues[]) {
  const surfaceVersion = useSurfaceVersion();
  return useMemo(
    () =>
      papers.map((v) => {
        if (v.fitToDesk === false) return v;
        // 서류도 놓을 수 있는 면이라 서로를 기준으로 삼으면 끝없이 기어오른다
        const top = surfaceHeightAt(v.x, v.z, (id) => id.startsWith("paper"));
        // 아주 살짝 파묻는다(같은 깊이면 지글거린다). 0.01 칸으로 끊어야 다시재기 서명이 매번 안 바뀌어 외곽선이 안 떨린다.
        return top === null ? v : { ...v, height: Math.round((top - PAPER_SINK_DEPTH) * 100) / 100 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 면이 바뀌면(책상을 다 재고 나면) 다시 계산한다
    [papers, surfaceVersion],
  );
}

interface PickupSources {
  lobby: LobbyState;
  mugs: readonly MugValues[];
  laptops: readonly LaptopValues[];
  papers: readonly PaperValues[];
  coatRacks: CoatRackControls;
  evidence: EvidenceControls;
  monitors: readonly MonitorValues[];
  keyboardMouse: KeyboardMouseControls;
}

/**
 * 머그컵 3 · 노트북 3 · 서류 7 · 모자 · 번호표 · 증거물 상자 둘 · 키보드·마우스.
 * 제자리를 걸이(스냅 지점)로 등록해 언제든 정확히 제자리로 되돌릴 수 있게 한다(GRD-01).
 */
export function usePickupItems({
  lobby,
  mugs,
  laptops,
  papers,
  coatRacks: { hat },
  evidence,
  monitors,
  keyboardMouse: { keyboard, mouse },
}: PickupSources): PickupItem[] {
  const fittedPapers = useDeskFittedPapers(papers);
  const items: PickupItem[] = [
    ...mugs.map((values, i): PickupItem => ({ id: `mug${i}`, kind: "mug", name: "머그컵", values })),
    ...laptops.map((values, i): PickupItem => ({ id: `laptop${i}`, kind: "laptop", name: "노트북", values })),
    ...fittedPapers.map((values, i): PickupItem => ({ id: `paper${i}`, kind: "paper", name: "서류", values })),
    // 옷걸이 가지에 걸린 중절모
    ...(hat.visible ? [{ id: "hat0", kind: "hat", name: "중절모", values: hat } as const] : []),
    // 서랍에 실린 번호표는 서랍과 한 몸이라 뺀다
    ...(evidence.common.visible
      ? EVIDENCE_ITEMS.flatMap((item, i): PickupItem[] =>
          item.kind === "numberTag" && DRAWER_RIDERS[item.id] === undefined
            ? [
                {
                  id: item.id,
                  kind: "numberTag",
                  name: `번호표 ${item.number}`,
                  number: item.number ?? 2,
                  values: evidence.items[i],
                },
              ]
            : [],
        )
      : []),
    // 봉투는 들 수 없다 — 납작해서 들면 종잇장 한 장을 든 것처럼 보인다
    ...(evidence.common.visible
      ? EVIDENCE_ITEMS.flatMap((item, i): PickupItem[] =>
          item.kind === "box" || item.kind === "collectionBox"
            ? [{ id: item.id, kind: item.kind, name: item.name, caseNo: item.caseNo, values: evidence.items[i] }]
            : [],
        )
      : []),
    // 제자리가 모니터 기준 상대좌표라 월드 좌표로 펴서 넘긴다
    ...monitors.flatMap((monitor, i): PickupItem[] => [
      ...(keyboard.visible !== false
        ? [{ id: `kb${i}`, kind: "keyboard", name: "키보드", values: monitorRelativePose(monitor, keyboard) } as const]
        : []),
      ...(mouse.visible !== false
        ? [{ id: `ms${i}`, kind: "mouse", name: "마우스", values: monitorRelativePose(monitor, mouse) } as const]
        : []),
    ]),
  ];

  // 시선이 제자리에 걸리면 그리로 스냅한다. 옷걸이 가지처럼 면이 아닌 곳은 광선↔수평면으로 못 잡는다.
  const homeSignature = items
    .map((o) => `${o.id}:${o.values.x},${o.values.height},${o.values.z},${o.values.rotation},${pickupTilt(o)}`)
    .join("|");
  useEffect(() => {
    for (const o of items)
      registerSnapPoint(`home:${o.id}`, {
        itemId: o.id,
        x: o.values.x,
        y: o.values.height,
        z: o.values.z,
        rot: o.values.rotation,
        // 걸린 모습 그대로 돌아가야 하는 건 모자뿐이다
        tilt: pickupTilt(o),
        // 모자는 공중에 걸린 점이라 넉넉하게, 책상 위 물건은 넓으면 옆에 놓으려 해도 자꾸 빨려든다
        radius: o.kind === "hat" ? 1.1 : 0.75,
      });
    return () => {
      for (const o of items) unregisterSnapPoint(`home:${o.id}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 목록은 매 렌더 새로 만들어져 자리 값이 바뀔 때만 다시 등록한다
  }, [homeSignature]);

  // 제자리 겹침은 「누가 거기 갖다 놓은 것」만 따진다
  useEffect(() => {
    setMovedItems(Object.keys(lobby.itemSpots));
  }, [lobby.itemSpots]);

  return items;
}
