/** 캔버스 안에서 본편의 자리와 단계를 읽어 저장 칸에 넘긴다. */
import { useThree } from "@react-three/fiber";
import { useEffect, type RefObject } from "react";
import type * as THREE from "three";

import { registerSaveSection, setGameStage } from "./gameSave";
import {
  STATION_POSE_SECTION,
  TRAIN_POSE_SECTION,
  currentStage,
  savedStationPose,
  savedTrainPose,
  type SavedPose,
} from "./mainGameSave";

/** 역에서 읽을 사람의 자리 */
interface PlayerPoint {
  position: THREE.Vector3;
  facing: number;
}

/** 그리는 것은 없다. */
export default function MainGameSaveBridge({
  isTrain,
  playerRef,
}: {
  isTrain: boolean;
  playerRef: RefObject<PlayerPoint>;
}) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    // 두 씬이 카메라를 나눠 쓰므로 지금 있는 씬의 자리만 고쳐 적는다. 다른 씬의 값은 마지막 그대로 둔다.
    registerSaveSection(STATION_POSE_SECTION, {
      read: () => {
        if (isTrain) return savedStationPose();
        // 3인칭에서는 카메라가 뒤로 물러나 있으므로 사람의 자리를 쓴다.
        const { position, facing } = playerRef.current;
        return { position: [position.x, position.y, position.z], yaw: facing } satisfies SavedPose;
      },
    });
    registerSaveSection(TRAIN_POSE_SECTION, {
      read: () =>
        isTrain
          ? ({
              position: [camera.position.x, camera.position.y, camera.position.z],
              yaw: camera.rotation.y,
            } satisfies SavedPose)
          : savedTrainPose(),
    });
    setGameStage(currentStage(isTrain));
  }, [camera, isTrain, playerRef]);

  // 본부실에 들어서면 단계가 바뀐다. 이벤트를 하나 더 두지 않고 저장 주기에 맞춰 살핀다.
  useEffect(() => {
    const timer = window.setInterval(() => setGameStage(currentStage(isTrain)), 2000);
    return () => window.clearInterval(timer);
  }, [isTrain]);

  return null;
}
