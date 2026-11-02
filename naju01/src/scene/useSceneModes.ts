import { useCallback, useEffect, useState, type RefObject } from "react";

import type { AvatarLink } from "@/engine/avatarLink";
import { requestShadowUpdates } from "@/engine/shadowUpdates";

import { createEmptyEdits, getPrefetchedEdits, loadEdits } from "../placement/editFile";
import { IS_REVIEW_REQUESTED } from "../review/ReviewBridge";

interface SceneModesOptions {
  active: boolean;
  isThirdPerson: boolean;
  playerState: RefObject<AvatarLink>;
}

const TEXT_ENTRY =
  "input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable='true']";

/** 편집 모드(E — 라이브러리 배치·기존 에셋 편집을 겸하는 통합 편집 모드)·부감(Tab)·3인칭 캐릭터 붙이기·좌클릭 공격, 그리고 손 배치 편집 층. */
export function useSceneModes({ active, isThirdPerson, playerState }: SceneModesOptions) {
  // Leva 는 항목이 많아 찾기 어려워 키(E)로 켠다. Leva 에는 setter 가 없어 같이 두면 상태가 둘이 된다.
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
  useEffect(() => {
    // 검수 실행(?review=1)에서는 편집 모드를 열지 않는다 — 검수 둘러보기 카메라와 편집 카메라가 겹친다
    if (IS_REVIEW_REQUESTED) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      // 서랍 검색칸 등 글 입력 중의 e 는 편집 끄기가 아니다
      if ((e.target as Element | null)?.closest?.(TEXT_ENTRY)) return;
      if (e.code === "KeyE" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey)
        setIsEditing((v) => {
          if (v) setIsOverview(false);
          return !v;
        });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // 편집 모드의 「편집 끝내기」 단추 — E 와 같다
  const exitEditing = useCallback(() => {
    setIsEditing(false);
    setIsOverview(false);
  }, []);

  return { isEditing, exitEditing, isOverview, setIsOverview, isAvatarMounted, edits, setEdits };
}
