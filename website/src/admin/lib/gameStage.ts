/** 게임 저장의 stage 값(src/save/gameSave.ts 의 GameStage)을 사람이 읽는 이름으로. */
const STAGE_LABELS: Readonly<Record<string, string>> = {
  character: "캐릭터 만들기",
  tutorial: "튜토리얼",
  headquarters: "본부실",
  train: "기차 이동",
  naju: "나주 사건",
};

/** 저장이 없으면 null. 모르는 값은 그대로 보여 준다 — 게임 쪽에 새 단계가 생겨도 숨기지 않는다. */
export function stageLabel(stage: string | null): string {
  if (!stage) return "저장 없음";
  return STAGE_LABELS[stage] ?? stage;
}
