/**
 * 나주(앙암바위) 케이스 진행률 — 본편 기차의 목적지 창(케이스 목록)이 「내가 하던 케이스」임을 보여 주려고 읽는다(미르 11/10).
 *
 * 나주가 저장본에 남긴 칸(naju.*)을 그대로 읽어 센다 — 따로 요약 칸을 두지 않으므로 이 기능 전에 하던 저장본도 같은 값이 나온다.
 * 칸을 어떻게 읽는지는 나주만 안다(본편은 이 함수만 부른다, src/naju 입구).
 * 이정표는 되돌아가지 않는 값만 쓴다(퍼즐 단계 · 푼 표시). 횃불 수처럼 다시 0 이 되는 값은 쓰지 않는다.
 * 뒤 스테이지에 손을 댔으면 앞 스테이지는 다 한 것으로 본다 — 옛 저장 · 조각난 값으로 앞이 비어 보이지 않게.
 * 끝 = 굿판이 동트기(gut.dawn)까지 갔을 때(물굴을 나온 ritual.cleared 가 아니다).
 * React · 별칭을 쓰지 않는다(node --test).
 */

export interface CaseProgress {
  /** 나주에 들어온 적이 있다 — 0% 여도 「하던 케이스」다 */
  hasStarted: boolean;
  /** 0~100 */
  percent: number;
  done: number;
  total: number;
  /** 지금 스테이지 이름(끝냈으면 「완료」) */
  stageName: string;
  isCleared: boolean;
  /** 스테이지마다 한 이정표 수 — 마이페이지가 스테이지별로 보여 준다 */
  stages: StageProgress[];
}

export interface StageProgress {
  name: string;
  done: number;
  total: number;
}

/** 저장 칸 하나를 읽는다(없으면 null) */
type ReadSection = (name: string) => unknown;

const atLeast = (order: readonly string[], value: unknown, at: string) =>
  typeof value === "string" && order.indexOf(value) >= order.indexOf(at);

const RITUAL = ["cairns", "drawing", "offering", "rising", "flooded", "parted", "cave", "cleared"] as const;
const RIDGE = ["idle", "sealing", "sealed", "awakening", "circling", "leaving", "rift", "done"] as const;
const TRAP = ["idle", "full", "pulled", "lit", "told"] as const;
const CLIFF = ["idle", "vision", "flowing", "loose", "traced", "found", "done", "opened", "crossed"] as const;
const GUT = ["waiting", "rite", "released", "dawn"] as const;
const CLAM_BEFORE_DUG = ["buried", "hoe", "dug"];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

interface Stage {
  name: string;
  milestones: boolean[];
}

function readStages(read: ReadSection): Stage[] {
  const memory = asRecord(read("naju.puzzleMemory"));
  const trap = asRecord(read("naju.fishTrap"));
  const clam = read("naju.clam");
  const ritual = read("naju.ritual");
  const ridge = asRecord(read("naju.ridge")).stage;
  const quest = asRecord(read("naju.ridgeQuest"));
  const cliff = asRecord(memory.cliff).stage;
  const gut = asRecord(memory.gut).stage;
  return [
    {
      name: "나루터",
      milestones: [
        typeof clam === "string" && !CLAM_BEFORE_DUG.includes(clam),
        atLeast(TRAP, trap.stage, "pulled"),
        atLeast(TRAP, trap.stage, "lit"),
        trap.isGuideAhead === true,
      ],
    },
    {
      name: "바위 아래",
      milestones: [
        read("naju.jars") === "open",
        read("naju.makgeolli") === true,
        atLeast(RITUAL, ritual, "drawing"),
        atLeast(RITUAL, ritual, "rising"),
        atLeast(RITUAL, ritual, "parted"),
        atLeast(RITUAL, ritual, "cave"),
      ],
    },
    {
      name: "물굴",
      // 물굴을 나왔으면(ritual.cleared) 안의 퍼즐은 다 풀었다
      milestones: [
        memory["air.isJarTilted"] === true,
        memory["air.isLightSolved"] === true,
        typeof memory["burrows.roundsDone"] === "number" && memory["burrows.roundsDone"] >= 3,
        memory["door.isOpen"] === true,
        memory["chamber.isSolved"] === true,
        memory["chamber.isShone"] === true,
      ].map((isDone) => isDone || atLeast(RITUAL, ritual, "cleared")),
    },
    {
      name: "능선",
      // 틈까지 지났으면(ridge.done) 능선 일은 다 했다
      milestones: [
        atLeast(RIDGE, ridge, "sealing"),
        quest.chestOnAltar === true,
        quest.postsSolved === true,
        quest.stairs === true,
        quest.birdsFacing === true,
        quest.scaleSet === true,
        atLeast(RIDGE, ridge, "done"),
      ].map((isDone) => isDone || atLeast(RIDGE, ridge, "done")),
    },
    { name: "바위 위", milestones: CLIFF.slice(1).map((at) => atLeast(CLIFF, cliff, at)) },
    // 굿판: 「rite」(가락지를 올림)는 도로 집으면 waiting 으로 돌아간다(gut.pause) — 되돌아가지 않는 풀림 · 동트기만 센다(Codex 리뷰)
    { name: "굿판", milestones: (["released", "dawn"] as const).map((at) => atLeast(GUT, gut, at)) },
  ];
}

/** 저장본에서 나주 진행률을 센다. 나주에 들어온 적이 없으면 null */
export function najuCaseProgress(read: ReadSection): CaseProgress | null {
  const stages = readStages(read);
  // 뒤 스테이지에 손을 댔으면 그 앞은 다 했다
  const furthest = stages.reduce((last, stage, index) => (stage.milestones.some(Boolean) ? index : last), -1);
  const counts = stages.map((stage, index) =>
    index < furthest ? stage.milestones.length : stage.milestones.filter(Boolean).length,
  );
  const total = stages.reduce((sum, stage) => sum + stage.milestones.length, 0);
  const done = counts.reduce((sum, count) => sum + count, 0);
  const hasStarted = read("naju.player") != null || done > 0;
  if (!hasStarted) return null;
  const isCleared = atLeast(GUT, asRecord(asRecord(read("naju.puzzleMemory")).gut).stage, "dawn");
  const current = stages.findIndex((stage, index) => counts[index] < stage.milestones.length);
  return {
    hasStarted,
    percent: isCleared ? 100 : Math.min(99, Math.floor((done / total) * 100)),
    done: isCleared ? total : done,
    total,
    stageName: isCleared || current < 0 ? "완료" : stages[current].name,
    isCleared,
    stages: stages.map((stage, index) => {
      const total = stage.milestones.length;
      return { name: stage.name, done: isCleared ? total : counts[index], total };
    }),
  };
}
