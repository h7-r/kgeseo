/**
 * 지금 플레이어가 풀 것 — 동행이 「어느 퍼즐 이야기인지」 아는 기준표.
 * 퍼즐은 진행표의 공식 ID(P01~P13)를 그대로 쓰고, 판정이 없는 걸음(불 붙이기 · 술병 줍기 등)은 S · C 로 시작하는 걸음 ID 를 쓴다.
 * 자리(anchor)는 도면 미터 — 값의 출처는 각 줄 옆에 적었다. 물굴 · 능선 장막 안은 갇힌 곳이라 「딴 데로 감」을 재지 않는다(anchor 없음).
 * 게임에서 읽어 온 값(안내판 줄 · 물굴 진행)을 목표 · 진전 · 틀림으로 옮기는 셈도 여기 둔다 — 게임 모듈 없이 시험할 수 있게.
 * React · 별칭을 쓰지 않는다(node --test).
 */

export type ObjectiveId =
  | "P01"
  | "P02"
  | "P02-2"
  | "S1_FIRE"
  | "S1_SMOKE"
  | "P03"
  | "S2_BOTTLE"
  | "P05"
  | "S2_OFFER"
  | "S2_STONES"
  | "S2_ENTER"
  | "C_JAR"
  | "P07"
  | "P08"
  | "P09"
  | "P10"
  | "C_SOCKET"
  | "S3_GO"
  | "P11"
  | "P12"
  | "P13"
  | "P13-2"
  | "S3_SCALE"
  | "S3_KEY"
  | "S3_RIFT";

export interface Objective {
  id: ObjectiveId;
  /** 대화창 이름 옆에 붙는 화제 */
  name: string;
  /** 서버에 등록되는 퍼즐이면 그 ID — 정식 힌트는 이 퍼즐에만 있다 */
  puzzleId: string | null;
  /** 이 목표의 자리와 「근처」로 치는 반경(미터). 없으면 벗어남을 재지 않는다 */
  anchor: { x: number; z: number; radius: number } | null;
  /** 이 시간을 넘기면 「오래 걸린다」고 본다(초) */
  limitSec: number;
  /** 이 목표 자리에 올 때 가지고 있어야 하는 소지품 종류 — 없이 오면 알려 준다(여기서 얻는 물건은 넣지 않는다) */
  needs: string[];
  /**
   * 판정 없는 걸음이 가리키는 것 — puzzles/* 가 registerInteractable 에 넣는 FE 로컬 상호작용 ID.
   * 걸음 대사를 그 대상과 짝지어 두려는 FE 임시 이름이다. 서버의 focus_object_id 가 아니다 — 대응표가 나오면 그 ID 로 바꿔 싣는다.
   * 퍼즐(P번호)은 서버가 퍼즐로 찾으므로 두지 않는다. 겨눌 대상 없이 걸어가기만 하는 걸음도 null.
   */
  focusLocalId: string | null;
}

const objective = (
  id: ObjectiveId,
  name: string,
  anchor: Objective["anchor"],
  options: { limitSec?: number; needs?: string[]; isPuzzle?: boolean; focus?: string } = {},
): Objective => ({
  id,
  name,
  puzzleId: (options.isPuzzle ?? id.startsWith("P")) ? id : null,
  anchor,
  limitSec: options.limitSec ?? 420,
  needs: options.needs ?? [],
  focusLocalId: options.focus ?? null,
});

export const OBJECTIVES: Record<ObjectiveId, Objective> = {
  // ── 1스테이지 나루터 ──
  // ClamDig DIG_SPOT
  P01: objective("P01", "조개 숨구멍", { x: 14.4, z: 42.0, radius: 9 }),
  // trapRig 말뚝 셋의 가운데
  P02: objective("P02", "통발 고르기", { x: 22.5, z: 44.3, radius: 11 }),
  "P02-2": objective("P02-2", "떨리는 줄", { x: 23.35, z: 43.6, radius: 9 }, { limitSec: 300 }),
  // fishTrap/site HEARTH. 불씨를 쏟는 대상은 건져 올린 통발인데, 그 통발의 번호가 곧 통발 고르기의 답이라 대상 ID 를 적지 않는다
  S1_FIRE: objective("S1_FIRE", "화톳불", { x: 24.0, z: 42.5, radius: 9 }, { limitSec: 240 }),
  // fishTrap/site GUIDE_PATH 의 바위틈. 연기를 따라 걷기만 한다 — 겨눌 대상이 없다
  S1_SMOKE: objective("S1_SMOKE", "연기 화살표", { x: 30.0, z: 39.4, radius: 13 }, { limitSec: 240 }),

  // ── 2스테이지 바위 아래 ──
  // jars/site JAR_SITE
  P03: objective("P03", "장독대 항아리", { x: 41.5, z: 31.9, radius: 10 }, { limitSec: 480 }),
  // BoatBottles INTACT_SPOT
  S2_BOTTLE: objective(
    "S2_BOTTLE",
    "배 안의 술병",
    { x: 42.85, z: 43.9, radius: 10 },
    { limitSec: 300, focus: "boat-bottle-intact" },
  ),
  // ritual/magicCircle CIRCLE_CENTER
  P05: objective("P05", "돌탑과 마법진", { x: 45.0, z: 37.0, radius: 11 }, { limitSec: 480 }),
  S2_OFFER: objective(
    "S2_OFFER",
    "제물 올리기",
    { x: 45.0, z: 37.0, radius: 11 },
    { limitSec: 240, needs: ["lightFish", "rice", "makgeolli"], focus: "ritual-table" },
  ),
  // FloatingStones SPOTS 의 가운데. 뜬 돌은 넷(float-stone-0…3)이라 첫 번째를 대표로 둔다
  S2_STONES: objective(
    "S2_STONES",
    "물에 뜬 돌",
    { x: 46.5, z: 39.5, radius: 13 },
    { limitSec: 300, focus: "float-stone-0" },
  ),
  // caveState CORRIDOR 입구. 갈라진 물 사이로 걸어 들어가기만 한다 — 겨눌 대상이 없다
  S2_ENTER: objective(
    "S2_ENTER",
    "갈라진 강",
    { x: 45.0, z: 44.5, radius: 11 },
    { limitSec: 180, needs: ["floatStone"] },
  ),

  // ── 물굴(갇힌 곳) ──
  C_JAR: objective("C_JAR", "엎어진 독", null, { limitSec: 240, focus: "cave-jar" }),
  P07: objective("P07", "진주 빛 잇기", null, { limitSec: 480 }),
  P08: objective("P08", "물고기 굴", null, { limitSec: 480 }),
  P09: objective("P09", "물레 고리문", null, { limitSec: 600, needs: ["floatStone"] }),
  P10: objective("P10", "석실 받침", null, { limitSec: 480 }),
  C_SOCKET: objective("C_SOCKET", "바위 홈", null, { limitSec: 240, needs: ["bigPearl"], focus: "cave-socket" }),

  // ── 3스테이지 증언 능선 ──
  // ridgeShape RIDGE_CENTER. 능선까지 걸어가는 걸음이라 겨눌 대상이 없다
  S3_GO: objective("S3_GO", "증언 능선", { x: 69.8, z: 20.0, radius: 15 }, { limitSec: 300, needs: ["letterBox"] }),
  P11: objective("P11", "지게와 궤", null, { limitSec: 600 }),
  P12: objective("P12", "장승 고리", null, { limitSec: 480 }),
  P13: objective("P13", "통나무 걸상", null, { limitSec: 480 }),
  "P13-2": objective("P13-2", "돌새", null, { limitSec: 420 }),
  S3_SCALE: objective("S3_SCALE", "눈물 자국", null, { limitSec: 240, needs: ["scale"], focus: "ridge-fossil" }),
  // 열쇠는 떨어진 물건(world-item-<uid>)이라 고정 ID 가 없다 — 열쇠로 여는 함의 자물통을 대상으로 둔다
  S3_KEY: objective("S3_KEY", "청동 열쇠와 함", null, { limitSec: 300, focus: "ridge-box-lock" }),
  // 틈은 [E] 없이 걸어 들어간다 — 겨눌 대상이 없다
  S3_RIFT: objective("S3_RIFT", "시공간 틈", null, { limitSec: 240 }),
};

/**
 * 답을 서버가 판정하는 퍼즐(대응표 11/5). 이 퍼즐들의 실수 · 진전 없음 · 풀림은 서버의 퍼즐 자동 개입이 맡으므로
 * FE 가 상황으로 보내지 않는다(계약 v0.4.16 §9). 화면 판정 퍼즐과 판정 없는 걸음만 보낸다.
 */
export const SERVER_JUDGED: ReadonlySet<ObjectiveId> = new Set([
  "P01",
  "P02",
  "P03",
  "P05",
  "P09",
  "P10",
  "P12",
  "P13",
]);

/** 이야기가 벌어지는 구역 — 잡담처럼 돌려 쓰는 말을 지금 있는 곳에 맞게 고를 때 쓴다 */
export type Stage = "dock" | "rock" | "cave" | "ridge";

const STAGE_OF: Record<Stage, readonly ObjectiveId[]> = {
  dock: ["P01", "P02", "P02-2", "S1_FIRE", "S1_SMOKE"],
  rock: ["P03", "S2_BOTTLE", "P05", "S2_OFFER", "S2_STONES", "S2_ENTER"],
  cave: ["C_JAR", "P07", "P08", "P09", "P10", "C_SOCKET"],
  ridge: ["S3_GO", "P11", "P12", "P13", "P13-2", "S3_SCALE", "S3_KEY", "S3_RIFT"],
};

export function stageOf(objective: ObjectiveId): Stage {
  for (const stage of Object.keys(STAGE_OF) as Stage[]) if (STAGE_OF[stage].includes(objective)) return stage;
  return "dock";
}

/** 숨이 다해 되돌려질 때 게임이 띄우는 알림의 첫머리(puzzles/cave/CaveWorld 의 원문) — 이 알림으로 되돌려짐을 알아챈다 */
export const SENT_BACK_NOTICE = "숨이 다했다";

/** 안내판 제목 → 목표. 플레이어가 그 퍼즐 앞에 서 있다는 가장 확실한 신호다(puzzles/* 가 올리는 제목 그대로) */
export const PANEL_OBJECTIVE: Record<string, ObjectiveId> = {
  "숨구멍 — 조개 캐기": "P01",
  "물에 뜬 돌": "S2_STONES",
  "엎어진 독": "C_JAR",
  "진주 빛 잇기": "P07",
  "물고기 굴": "P08",
  "물레 고리문": "P09",
  "석실 받침": "P10",
  "바위 홈": "C_SOCKET",
  "장승 고리": "P12",
  "통나무 걸상": "P13",
};

export interface PanelSight {
  title: string;
  rows?: { label: string; value: string }[];
}

/**
 * 틀리면 처음부터 다시 하는 퍼즐의 안내판 줄(제목 → 줄 이름) — 이 줄의 수가 줄면 틀린 것이다.
 * 풀다 보면 저절로 오르내리는 줄(이어진 조개 · 따라 한 차례 · 고리 안 물고기)은 넣지 않는다. 지나쳤다 돌아오는 것은 실수가 아니다.
 */
export const RESTART_ROWS: Record<string, string> = {
  "물고기 굴": "맞춘 판",
  "석실 받침": "맞춘 수",
  "통나무 걸상": "빛이 든 새김",
};

/** 안내판 줄 값 속 「n / m」의 n — 「뜬 돌 2/4」처럼 글 뒤에 붙은 수도 읽는다 */
function countIn(value: string): number | null {
  const match = /(\d+)\s*\/\s*\d+/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * 안내판의 수를 이어서 읽어 진전과 틀림을 가른다.
 * 진전은 줄마다 가장 높았던 수를 넘을 때만 센다 — 줄었다 도로 오르는 것, 글로 된 상태 표시(손에 든 것 · 물림)는 진전이 아니다.
 * 처음 본 수는 기준일 뿐이다(이어 하기).
 */
export function createPanelReader() {
  const last = new Map<string, number>();
  const best = new Map<string, number>();
  let gain = 0;
  return {
    /** 안내판이 바뀔 때마다 부른다. 이번에 처음부터 다시 하게 됐으면(틀렸으면) 그 목표를 돌려준다 */
    read(panel: PanelSight | null): ObjectiveId | null {
      if (!panel) return null;
      let hasRestarted = false;
      for (const row of panel.rows ?? []) {
        const count = countIn(row.value);
        if (count === null) continue;
        const key = `${panel.title}|${row.label}`;
        const before = last.get(key);
        const top = best.get(key);
        last.set(key, count);
        if (top === undefined || count > top) best.set(key, count);
        if (top !== undefined && count > top) gain += count - top;
        if (before !== undefined && count < before && RESTART_ROWS[panel.title] === row.label) hasRestarted = true;
      }
      return hasRestarted ? (PANEL_OBJECTIVE[panel.title] ?? null) : null;
    },
    /** 지금까지 오른 수의 합 — 바뀌면 「뭔가 해냈다」 */
    gain: () => gain,
  };
}

/** 물굴 진행 — 퍼즐 부품이 값이 바뀔 때마다 저장 기록(save/puzzleMemory)에 적는 것을 gameObserver 가 읽어 넘긴다 */
export interface CaveProgress {
  isJarTilted: boolean;
  isLightSolved: boolean;
  isBurrowsSolved: boolean;
  /** 뜬 돌을 물레 홈에 다 끼웠나 */
  isFloatsSet: boolean;
  isDoorOpen: boolean;
  isChamberSolved: boolean;
  /** 큰 진주를 바위 홈에 끼웠나 */
  isPearlSet: boolean;
}

/** 물굴에서 끝낸 목표 */
export function caveCompleted(cave: CaveProgress): ObjectiveId[] {
  const done: [ObjectiveId, boolean][] = [
    ["C_JAR", cave.isJarTilted],
    ["P07", cave.isLightSolved],
    ["P08", cave.isBurrowsSolved],
    ["P09", cave.isDoorOpen],
    ["P10", cave.isChamberSolved],
    ["C_SOCKET", cave.isPearlSet],
  ];
  return done.filter(([, isDone]) => isDone).map(([id]) => id);
}

/**
 * 물굴에서 다음 할 일 — 아직 안 한 것 가운데 차례가 가장 앞선 것(안내판 앞에 서 있지 않을 때의 목표).
 * 고리문이 열린 뒤에는 큰 방에 안 푼 것이 남아 있어도 석실 쪽을 본다 — 톱니돌을 다 모으지 않아도 문은 열리고,
 * 지나온 퍼즐을 붙들고 「막혔다」고 할 수는 없다. 다 끝냈으면 null(눈물을 챙겨 나가는 걸음은 ID 가 없다).
 */
export function nextCaveObjective(cave: CaveProgress): ObjectiveId | null {
  if (!cave.isDoorOpen) {
    if (!cave.isJarTilted) return "C_JAR";
    if (!cave.isLightSolved) return "P07";
    return cave.isBurrowsSolved ? "P09" : "P08";
  }
  if (!cave.isChamberSolved) return "P10";
  return cave.isPearlSet ? null : "C_SOCKET";
}

/**
 * 소지품에 없어도 「챙긴 것」으로 치는 물건 — 그 자리에 이미 써서 빠진 것과, 다음 문턱에서 저절로 따라오는 것.
 * 이것을 「없다」고 알리면 헛말이 된다.
 */
export function countedAsHeld(state: {
  /** 소반에 올린 제물 */
  offered: readonly string[];
  cave: Pick<CaveProgress, "isFloatsSet" | "isPearlSet">;
  /** 내려놓은 함이 능선에 들어설 때 따라와 소지품에 드는가 */
  isBoxFollowing: boolean;
}): string[] {
  return [
    ...state.offered,
    ...(state.cave.isFloatsSet ? ["floatStone"] : []),
    ...(state.cave.isPearlSet ? ["bigPearl"] : []),
    ...(state.isBoxFollowing ? ["letterBox"] : []),
  ];
}
