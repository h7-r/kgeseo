/** 본편(튜토리얼·본부실·기차)의 저장 칸. */
import type * as THREE from "three";

import { inventory } from "@/game/inventory";
import { hasEnteredHeadquarters } from "@/props/vendingPushState";
import { restoreTutorial, tutorialStore } from "@/tutorial/tutorialState";

import { readSavedSection, registerSaveSection, scheduleGameSave, startGameSaveLoop, type GameStage } from "./gameSave";

export const TRAIN_POSE_SECTION = "main.trainPose";
export const STATION_POSE_SECTION = "main.stationPose";

export interface SavedPose {
  position: THREE.Vector3Tuple;
  yaw: number;
}

let isRegistered = false;

/** 게임 화면을 그리기 전에 한 번 부른다. */
export function registerMainGameSave(): void {
  if (isRegistered) return;
  isRegistered = true;
  registerSaveSection("main.tutorial", {
    read: () => {
      const { step, isFinished } = tutorialStore.get();
      return { step, isFinished };
    },
    apply: (value) => restoreTutorial(value as { step: number; isFinished: boolean }),
  });
  registerSaveSection("main.inventory", {
    read: () => inventory.list(),
    apply: (value) => inventory.addMany(value as Parameters<typeof inventory.addMany>[0], { silent: true }),
  });
  tutorialStore.subscribe(scheduleGameSave);
  inventory.subscribe(scheduleGameSave);
  startGameSaveLoop();
}

export function currentStage(isTrain: boolean): GameStage {
  if (isTrain) return "train";
  return hasEnteredHeadquarters() ? "headquarters" : "tutorial";
}

/** 저장된 역 자리. 시작 카메라에 넣는다. */
export const savedStationPose = () => readSavedSection<SavedPose>(STATION_POSE_SECTION);
export const savedTrainPose = () => readSavedSection<SavedPose>(TRAIN_POSE_SECTION);
