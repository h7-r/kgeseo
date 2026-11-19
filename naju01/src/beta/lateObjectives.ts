/**
 * 4 · 5스테이지 목표(목표표 objectives.ts 밖) — 베타 기록 전용(미르 11/16).
 * 바위 위(cliff) · 굿판(gut)의 단계 이름으로 「어디까지 끝났나」만 읽는다. 진행 판정 · 저장 칸 · 퍼즐 로직에는 쓰지 않는다.
 *
 * ID 는 나주 ID 대응표 v1.1 규칙 — 퍼즐은 P 번호(4 · 5스테이지 설계 1106 의 제안 번호 그대로), 판정 없는 걸음은 S<스테이지>_<이름>.
 *   P14        정화수 세 그릇 — 엎어진 사발 셋에 물을 떠 제 받침에 올린다
 *   P15        끊긴 발자국 — 귀때동이로 물을 뿌려 벼랑 끝까지 잇는다
 *   S4_POUCH   아랑사의 주머니 — 바위틈에서 주워 편지 두 장을 읽는다
 *   S4_SERPENT 구렁이상 — 구렁이 바위 홈에 세워 틈을 열고, 틈을 지나 물가에 내려선다(5스테이지 시작)
 *   S5_RINGS   소반에 가락지 — 굿이 열린다(불을 붙이기 전엔 도로 집을 수 있어 완료가 풀릴 수 있다)
 *   P16        다섯 횃불 — 일이 일어난 차례대로 다 켠다
 * 잎 · 오리 · 물고기는 날이 갠 뒤 저절로 나오는 연출이라 목표가 아니다 — 끝은 run_state released · dawn 이 맡는다.
 *
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */
export const LATE_OBJECTIVES = ["P14", "P15", "S4_POUCH", "S4_SERPENT", "S5_RINGS", "P16"] as const;
export type LateObjectiveId = (typeof LATE_OBJECTIVES)[number];

/** cliffState 의 단계 차례(앞으로만 간다) — 그쪽 ORDER 와 같아야 한다 */
const CLIFF_ORDER = ["idle", "vision", "flowing", "loose", "traced", "found", "done", "opened", "crossed"] as const;
type CliffStage = (typeof CLIFF_ORDER)[number];

const cliffAtLeast = (stage: string, at: CliffStage) =>
  CLIFF_ORDER.indexOf(stage as CliffStage) >= CLIFF_ORDER.indexOf(at);

/** 끝난 목표 — 목표마다 「다음 손짓이 열리는 단계」에 이르렀으면 끝난 것으로 본다 */
export function lateCompleted(cliffStage: string, gutStage: string): LateObjectiveId[] {
  const done: LateObjectiveId[] = [];
  // 세 사발을 받침에 올려 달이 내려앉았다(그 뒤 영상 · 물 흐름은 연출)
  if (cliffAtLeast(cliffStage, "vision")) done.push("P14");
  // 발자국이 벼랑 끝 바위 틈까지 이어졌다
  if (cliffAtLeast(cliffStage, "traced")) done.push("P15");
  // 주머니를 주워(found) 편지를 다 읽었다(done) — 구렁이상을 세울 수 있게 된다
  if (cliffAtLeast(cliffStage, "done")) done.push("S4_POUCH");
  // 틈을 지나 물가에 내려섰다
  if (cliffAtLeast(cliffStage, "crossed")) done.push("S4_SERPENT");
  // 가락지를 올려 굿이 열렸다
  if (gutStage !== "waiting") done.push("S5_RINGS");
  // 다섯 불을 차례대로 다 켰다
  if (gutStage === "released" || gutStage === "dawn") done.push("P16");
  return done;
}

/** 능선 틈(S3_RIFT)을 지난 뒤의 지금 목표 — 차례에서 처음 안 끝난 것. 그 전엔 null(목표표가 맡는다) */
export function lateFocus(completed: ReadonlySet<string>): LateObjectiveId | null {
  if (!completed.has("S3_RIFT")) return null;
  return LATE_OBJECTIVES.find((id) => !completed.has(id)) ?? null;
}
