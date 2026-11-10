/**
 * 튜토리얼 중에 나갔다 다시 들어와 처음부터 다시 할 때 「튜토리얼을 처음부터 다시 시작합니다」를 짧게 띄운다(미르 11/10).
 * 로딩 영상이 걷힌 뒤 한 번 — 영상 밑에서 시간만 흘러가 버리지 않게. 처음 들어온 사람 · 로비로 들어온 사람에게는 안 뜬다.
 * 그리는 것은 없다(글은 Toast 가 띄운다).
 */
import { useEffect } from "react";

import { showToast } from "@/game/toast";
import { useLoadingVideoState } from "@/naju";
import { TUTORIAL_RESTART_MESSAGE, takeRestartNotice } from "@/save/resumeStart";

const NOTICE_MS = 5000;

export default function TutorialRestartNotice() {
  const isLoading = useLoadingVideoState() !== null;
  useEffect(() => {
    if (isLoading || !takeRestartNotice()) return;
    showToast(TUTORIAL_RESTART_MESSAGE, NOTICE_MS);
  }, [isLoading]);
  return null;
}
