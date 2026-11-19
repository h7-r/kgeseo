// 비밀 복도(튜토리얼 공간)는 1인칭으로만 — 미르 플레이 시험 메모(11/8): 「튜토리얼 마지막에 1인칭으로 바꾸고 나서는 다시 3인칭으로
// 바꾸려 해도 '3인칭 전환은 로비공간에서만 가능합니다' 안내가 뜨면서 V 를 눌러도 바뀌지 않게」(튜토피드백 검토 01회차).
// 튜토리얼 「시점 바꾸기」 단계(1인칭으로 바꿔 보기)를 지나면 복도에서는 3인칭을 막는다. 수사 본부(로비)에 들어서면 다시 고를 수 있고,
// 본부실 첫 진입 때 3인칭으로 맞추는 기존 동작(onEnteredHeadquarters)은 그대로다.
import { playerView } from "@/engine/playerView";
import { HEADQUARTERS_MIN_X } from "@/station/layout/dimensions";
import { TUTORIAL_STEPS, tutorialStore } from "@/tutorial/tutorialState";

export const THIRD_PERSON_LOCKED_MESSAGE = "3인칭 전환은 로비(수사 본부) 공간에서만 가능합니다";

const VIEW_STEP = TUTORIAL_STEPS.findIndex((step) => step.id === "view");

/** 지금 비밀 복도에 서 있나(본부실 왼쪽 벽 x 보다 왼쪽) — 자리를 아직 모르면 아니라고 본다 */
export const isInCorridor = () => playerView.ready && playerView.eye.x < HEADQUARTERS_MIN_X;

/** 튜토리얼 「시점 바꾸기」 단계를 지났나 */
const isPastViewStep = () => {
  const { step, isFinished } = tutorialStore.get();
  return isFinished || step > VIEW_STEP;
};

/** 3인칭이 막혔나 — 복도에서 「시점 바꾸기」를 지난 뒤 */
export const isThirdPersonLocked = () => isInCorridor() && isPastViewStep();
