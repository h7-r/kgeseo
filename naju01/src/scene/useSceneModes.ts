import { useCallback, useEffect, useState, type RefObject } from "react";

import type { AvatarLink } from "@/engine/avatarLink";
import { requestShadowUpdates } from "@/engine/shadowUpdates";

import { createEmptyEdits, getPrefetchedEdits, loadEdits } from "../placement/editFile";

interface SceneModesOptions {
  active: boolean;
  isThirdPerson: boolean;
  playerState: RefObject<AvatarLink>;
}

/** 편집 모드(플레이 화면에서는 켜는 키가 없다 — Q 를 막았다)·부감(Tab)·3인칭 캐릭터 붙이기·좌클릭 공격, 그리고 손 배치 편집 층. */
export function useSceneModes({ active, isThirdPerson, playerState }: SceneModesOptions) {
  const [isEditing, setIsEditing] = useState(false);
  // 편집 중 공중에서 내려다보기(Tab). 편집을 끄면 같이 내려온다.
  const [isOverview, setIsOverview] = useState(false);
  // 캐릭터 GLB 는 15 MB 가 넘는다 — 처음 V 를 누를 때 붙이고, 한 번 붙으면 계속 붙어 있다.
  const [isAvatarMounted, setIsAvatarMounted] = useState(isThirdPerson);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 커밋 뒤에 붙여야 1인칭 첫 화면이 캐릭터를 기다리지 않는다
    if (isThirdPerson) setIsAvatarMounted(true);
  }, [isThirdPerson]);
  // 그림자 갱신을 아끼는 동안 늦게 붙은 캐릭터는 그림자 맵에 없다 — 붙는 순간 한 번 흔든다.
  useEffect(() => {
    if (isAvatarMounted) requestShadowUpdates(2);
  }, [isAvatarMounted, isThirdPerson]);
  // 3인칭 중 좌클릭은 잽/크로스. 패널·Leva 를 누른 클릭은 공격으로 치지 않는다.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!active || !isThirdPerson || isEditing || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input, select, label, [role='slider']"))
        return;
      const state = playerState.current;
      const serial = (state.attackSerial ?? 0) + 1;
      state.attackSerial = serial;
      state.attackMotion = serial % 2 === 1 ? "Punch_Jab" : "Punch_Cross";
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [active, isThirdPerson, isEditing, playerState]);

  // 편집 층 — assets/edits.json 을 읽어 생성 결과 위에 덧씌운다.
  // 미리 읽어 뒀으면 첫 렌더부터 그 값으로 선다 — 빈 편집으로 무리를 세웠다가 통째로 다시 세우지 않게.
  const [edits, setEdits] = useState(() => getPrefetchedEdits() ?? createEmptyEdits());
  useEffect(() => {
    if (getPrefetchedEdits()) return;
    let isAlive = true;
    loadEdits().then((loaded) => {
      if (isAlive) setEdits(loaded);
    });
    return () => {
      isAlive = false;
    };
  }, []);

  // 편집 모드의 「편집 끝내기」 단추
  const exitEditing = useCallback(() => {
    setIsEditing(false);
    setIsOverview(false);
  }, []);

  return { isEditing, exitEditing, isOverview, setIsOverview, isAvatarMounted, edits, setEdits };
}
