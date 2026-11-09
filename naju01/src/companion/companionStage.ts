/**
 * 동행을 플레이어 앞으로 불러 세운다 — 첫 입장 자기소개 클로즈업(미르 11/9 「누가 어디서 말하는지 알 수가 없다」).
 * 평소 동행은 오른쪽 뒤에 떠 있어 화면에 없다. 부르는 쪽(CompanionIntro)이 callCompanion 하면
 * CompanionNpc 가 카메라 앞 빈자리(카메라와 사이에 가리는 것 없는 곳)를 골라 spot 에 적고 그리로 날아와 플레이어를 본다.
 * 마땅한 자리가 없으면 status = "failed" — 부른 쪽은 클로즈업 없이 대사만 한다. releaseCompanion 하면 그 자리에서 다시 따라온다.
 *
 * 소개 중(isIntro)에는 동행에게 말 걸기(E · Enter · 💬)와 구역 진입 자동 끼어들기를 막는다 — 소개 대사와 동행 대화가 겹치지 않게(Codex 08).
 * 좌표는 월드 유닛(나주 씬 좌표).
 */
import { useSyncExternalStore } from "react";
import type * as THREE from "three";

import { createChangeSignal } from "@/lib/changeSignal";

export type CompanionStageStatus = "idle" | "picking" | "flying" | "arrived" | "failed";

export const companionStage = {
  status: "idle" as CompanionStageStatus,
  /** 고른 자리(몸 가운데) — flying · arrived 일 때만 */
  spot: null as THREE.Vector3 | null,
};

export function callCompanion() {
  companionStage.status = "picking";
  companionStage.spot = null;
}

export function releaseCompanion() {
  companionStage.status = "idle";
  companionStage.spot = null;
}

export const isCompanionCalled = () => companionStage.status !== "idle" && companionStage.status !== "failed";

const introSignal = createChangeSignal();
let isIntro = false;

/** 첫 입장 소개 중인가 — 동행 대화 · 자동 끼어들기를 막는다 */
export const isCompanionIntro = () => isIntro;

export function setCompanionIntro(next: boolean) {
  if (isIntro === next) return;
  isIntro = next;
  introSignal.notify();
}

export const useCompanionIntro = () => useSyncExternalStore(introSignal.subscribe, isCompanionIntro);
