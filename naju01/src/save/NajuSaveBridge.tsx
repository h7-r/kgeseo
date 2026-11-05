/** 나주의 자리·시선을 저장 칸에 넘기고, 이어 하기면 나갔던 시선으로 돌려놓는다. 그리는 것은 없다. */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { readSavedSection, registerSaveSection, setGameStage, startGameSaveLoop } from "@/save/gameSave";

import { playerPose } from "../movement/playerPose";
import { PLAYER_SECTION, type SavedNajuPlayer } from "./najuSaveData";

export default function NajuSaveBridge() {
  const camera = useThree((state) => state.camera);
  const pendingYaw = useRef(readSavedSection<SavedNajuPlayer>(PLAYER_SECTION)?.yaw ?? null);

  useEffect(() => {
    registerSaveSection(PLAYER_SECTION, {
      read: (): SavedNajuPlayer => ({ x: playerPose.x, z: playerPose.z, yaw: camera.rotation.y }),
    });
    setGameStage("naju");
    startGameSaveLoop();
  }, [camera]);

  // 시작 순간이동이 끝난 다음 프레임에 시선을 맞춘다.
  useFrame(() => {
    if (pendingYaw.current === null) return;
    camera.rotation.set(0, pendingYaw.current, 0, "YXZ");
    pendingYaw.current = null;
  });

  return null;
}
