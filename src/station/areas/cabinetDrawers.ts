import type { Vector3Tuple } from "three";

import type { LobbyState } from "@/lobby/interactions";
import { CAB_FZ, CAB_OPEN_PLAN, CAB_SEAMS, type CabinetOpening } from "@/station/office/cabinet/cabinetGeometry";

import type { CabinetCommonValues, CabinetValues } from "../controls/cabinetControls";

/**
 * 서랍에 실린 물건(증거물 id → 캐비닛 번호). 서랍과 한 몸이라 열고 닫을 때 같이 움직이고, 따로 집을 수 없다 —
 * 떼어 옮길 수 있게 하면 열고 닫을 때 표지가 어느 쪽을 따라가야 하는지가 매번 애매해진다.
 */
export const DRAWER_RIDERS: Readonly<Record<string, number>> = { "E-02": 0 };

/**
 * 캐비닛 서랍 여닫기. 손대기 전에는 Leva 연출값(CAB_OPEN_PLAN)으로 몇 칸이 열려 있고,
 * 손댄 뒤로는 로비 상태(null = 닫음)를 따른다.
 */
export function cabinetDrawers(
  common: CabinetCommonValues,
  cabinets: readonly CabinetValues[],
  drawers: LobbyState["drawers"],
) {
  const row = (i: number) => CAB_OPEN_PLAN[i]?.row ?? 1;
  const hasPapers = (i: number) => !!CAB_OPEN_PLAN[i]?.hasPapers && common.showPapers;

  const defaultOpening = (i: number): CabinetOpening | null => {
    const plan = CAB_OPEN_PLAN[i];
    if (!common.drawersOpen || !plan) return null;
    return {
      row: plan.row,
      amount: plan.extent === "wide" ? common.wideOpen : common.slightOpen,
      hasPapers: hasPapers(i),
    };
  };

  const opening = (i: number): CabinetOpening | null => {
    const touched = drawers[`cab${i}`];
    if (touched === undefined) return defaultOpening(i);
    if (touched === null) return null;
    return { ...touched, hasPapers: hasPapers(i) };
  };

  const isOpen = (i: number) => {
    const v = opening(i);
    return !!v && v.amount > 0.005;
  };

  /** 만질 수 있는 서랍 한 칸의 앞면 가운데 */
  const handlePosition = (i: number): Vector3Tuple => {
    const c = cabinets[i];
    const r = row(i);
    const centerY = (CAB_SEAMS[r] + CAB_SEAMS[r + 1]) / 2;
    const frontZ = CAB_FZ * common.height;
    return [c.x + Math.sin(c.rotation) * frontZ, centerY * common.height, c.z + Math.cos(c.rotation) * frontZ];
  };

  /**
   * 서랍에 실린 물건이 서랍을 따라 움직인 만큼 [dx, dz].
   * 지금 좌표는 서랍이 살짝 열린 모습을 보고 맞춘 값이라 기본 열림량과의 「차이」만 움직인다 — 0 기준이면 두 번 밀린다.
   */
  const riderOffset = (itemId: string): [number, number] => {
    const i = DRAWER_RIDERS[itemId];
    if (i === undefined) return [0, 0];
    const d = ((opening(i)?.amount ?? 0) - (defaultOpening(i)?.amount ?? 0)) * common.height;
    const c = cabinets[i];
    return [Math.sin(c.rotation) * d, Math.cos(c.rotation) * d];
  };

  return { row, opening, isOpen, handlePosition, riderOffset };
}
