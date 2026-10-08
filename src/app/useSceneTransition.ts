import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { playSound } from "@/audio/sound";
import { dropChair, returnHeld, placeHeld } from "@/lobby/interactions";
import { latestPlacement } from "@/lobby/placement";
import { chairDragState } from "@/station/office/chairDragState";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import { entryLock, exitedTrain } from "@/station/layout/trainDoors";

/** 한 Canvas 안에서 주소로 씬을 고른다. /train 이면 객차 안, 그 밖은 역. */
const STATION_PATH = "/";
export const TRAIN_PATH = "/train";

// 어두워지기 260ms + 밝아지기 시작까지 120ms ≈ 0.4초 (PRD 전역-006 「페이드로 로딩을 가린다 · 1초 이내」)
const FADE_OUT_MS = 260;
const FADE_HOLD_MS = 120;
// 문 앞에 서 있으면 near 가 계속 trainEntrance 라 잠금이 없으면 같은 순간에 두 번 넘어간다.
const NO_FADE_LOCK_MS = 250;
const DOOR_CLOSE_DELAY_MS = 700;

interface ChangeSceneOptions {
  /** 검은 막을 끼울지. 세션이 통째로 바뀌는 자리용으로 남겨 둔다 — 기차는 끼우지 않는다. */
  fade?: boolean;
}

function playTrainDoorSounds() {
  playSound("trainOpen", { volume: 0.9 });
  setTimeout(() => playSound("trainClose", { volume: 0.9 }), DOOR_CLOSE_DELAY_MS);
}

/**
 * 역 ↔ 기차 전환. 두 씬을 버리지 않고 보임만 바꾸므로 가릴 끊김이 없어 기차는 페이드 없이 바로 넘어간다
 * (검은 막을 끼우면 걸어 들어가던 흐름이 끊긴다).
 * @returns fade — 검은 막 불투명도(0 투명 · 1 검정)
 */
export function useSceneTransition(isTrain: boolean, near: NearTarget) {
  const navigate = useNavigate();
  const [fade, setFade] = useState(0);
  const isChanging = useRef(false); // 연타로 두 번 넘어가는 것을 막는다

  const changeScene = useCallback(
    (path: string, prepare?: () => void, { fade: withFade = true }: ChangeSceneOptions = {}) => {
      if (isChanging.current) return;
      isChanging.current = true;

      if (!withFade) {
        prepare?.();
        navigate(path);
        setTimeout(() => {
          isChanging.current = false;
        }, NO_FADE_LOCK_MS);
        return;
      }

      setFade(1);
      setTimeout(() => {
        prepare?.();
        navigate(path);
        setTimeout(() => {
          setFade(0);
          isChanging.current = false;
        }, FADE_HOLD_MS);
      }, FADE_OUT_MS);
    },
    [navigate],
  );

  const boardTrain = useCallback(() => {
    playTrainDoorSounds();
    changeScene(
      TRAIN_PATH,
      () => {
        // 들고 있던 물건은 제자리에 두고 간다(GRD-01 되돌릴 수 있음).
        returnHeld();
        // 끌던 의자도 놓는다. 안 놓으면 돌아왔을 때 의자가 갑자기 다시 따라붙는다.
        dropChair(chairDragState.x, chairDragState.z);
      },
      { fade: false },
    );
  }, [changeScene]);

  const leaveTrain = useCallback(() => {
    playTrainDoorSounds();
    changeScene(
      STATION_PATH,
      () => {
        // 내리자마자 다시 빨려 들어가지 않게 잠그고, 역 씬이 문 앞에서 시작하게 표시한다.
        entryLock.active = true;
        exitedTrain.active = true;
      },
      { fade: false },
    );
  }, [changeScene]);

  // 문 안으로 걸어 들어가면 키 없이 넘어간다. near 는 바뀔 때만 갱신돼 매 프레임 돌지 않는다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 기차는 페이드 없이 넘어가 실제로는 setState 를 부르지 않는다
    if (near === NEAR_TARGET.trainEntrance && !isTrain) boardTrain();
  }, [near, isTrain, boardTrain]);

  return { fade, boardTrain, leaveTrain };
}

/** 지금 보고 있는 자리에 든 물건을 내려놓는다. 겹치거나 면이 아니면 아무 일도 안 한다. */
export function tryPlaceHeld() {
  const spot = latestPlacement();
  if (!spot?.ok) return false;
  // 걸이(옷걸이 등) = 제자리로. 좌표 대신 덮어쓴 자리를 지워야 원래 기울기까지 돌아온다.
  if (spot.snapId) {
    returnHeld();
    return true;
  }
  return placeHeld({ x: spot.x, y: spot.y, z: spot.z, rot: spot.rot });
}
