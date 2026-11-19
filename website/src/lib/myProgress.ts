/**
 * 마이페이지 「내 진행」 요약. 서버의 내 저장본(/api/v1/me/game-save) · 보유 아이템 · 캐릭터를 화면용 값으로 바꾼다.
 * 나주 진행은 나주가 정한 셈법(caseProgress)을, 물건 이름은 나주 물건 표(itemCatalog)를 그대로 읽는다 — 게임과 같은 숫자가 나온다.
 * "@/" 별칭을 쓰지 않아 node 테스트가 바로 읽는다.
 */
import { najuCaseProgress, type CaseProgress } from "../../../naju01/src/progress/caseProgress.ts";
import { ITEMS, type ItemKind } from "../../../naju01/src/puzzles/itemCatalog.ts";

/** 게임 저장의 단계(src/save/gameSave.ts GameStage) — 앞에서부터 차례로 지난다 */
const JOURNEY = [
  { stage: "character", name: "캐릭터 생성" },
  { stage: "tutorial", name: "버려진 역" },
  { stage: "headquarters", name: "합동수사본부" },
  { stage: "train", name: "기차 출동" },
  { stage: "naju", name: "나주 앙암바위" },
] as const;

export interface GameSaveBody {
  stage: string;
  state: unknown;
  updated_at: string;
}

export interface OwnedItemBody {
  item_id: string;
  kind: string;
  name: string;
  quantity: number;
  source: string;
  acquired_at: string;
}

export interface CharacterBody {
  display_name: string;
  appearance: Record<string, unknown>;
}

export interface JourneyStep {
  name: string;
  state: "done" | "current" | "ahead";
}

export interface CaseItem {
  name: string;
  description: string;
  count: number;
}

export interface Badge {
  name: string;
  condition: string;
  isEarned: boolean;
}

export interface MyProgress {
  /** 게임을 한 번도 저장하지 않았다(캐릭터만 만들었거나 처음) */
  isEmpty: boolean;
  journey: JourneyStep[];
  /** 마지막 저장 시각 */
  savedAt: Date | null;
  isTutorialDone: boolean;
  naju: CaseProgress | null;
  /** 사건 진행 중 손에 든 물건(나주 소지품 + 본편 소지품) */
  caseItems: CaseItem[];
  /** 계정에 남는 아이템(서버 보유 목록) */
  ownedItems: OwnedItemBody[];
  characterName: string | null;
  badges: Badge[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function readSections(save: GameSaveBody | null): Record<string, unknown> {
  return asRecord(asRecord(save?.state).sections);
}

function buildJourney(stage: string | undefined, isNajuStarted: boolean): JourneyStep[] {
  // 나주에 들어간 적이 있으면 지금 저장 단계가 본부실(로비)이어도 나주까지 지난 것이다
  const reached = Math.max(
    JOURNEY.findIndex((step) => step.stage === stage),
    isNajuStarted ? JOURNEY.length - 1 : -1,
  );
  return JOURNEY.map((step, index) => ({
    name: step.name,
    state: index < reached ? "done" : index === reached ? "current" : "ahead",
  }));
}

function readCaseItems(sections: Record<string, unknown>): CaseItem[] {
  const counts = new Map<string, CaseItem>();
  const add = (name: string, description: string) => {
    const known = counts.get(name);
    if (known) known.count += 1;
    else counts.set(name, { name, description, count: 1 });
  };
  // 나주: 주머니(held) + 지금 손(hand). 땅에 내려놓은 것(world)은 들고 있지 않다.
  const naju = asRecord(sections["naju.inventory"]);
  const held = Array.isArray(naju.held) ? naju.held : [];
  for (const item of [...held, naju.hand]) {
    const kind = asRecord(item).kind;
    if (typeof kind === "string" && kind in ITEMS) {
      const def = ITEMS[kind as ItemKind];
      add(def.name, def.description);
    }
  }
  // 본편: 저장본에 이름이 같이 들어 있다. 예전 운영 저장본에 섞인 개발용 표본(id 「DEV_」)은 뺀다.
  const main = sections["main.inventory"];
  for (const item of Array.isArray(main) ? main : []) {
    const record = asRecord(item);
    if (typeof record.id === "string" && record.id.startsWith("DEV_")) continue;
    if (typeof record.name === "string")
      add(record.name, typeof record.description === "string" ? record.description : "");
  }
  return [...counts.values()];
}

function buildBadges(journey: JourneyStep[], isTutorialDone: boolean, naju: CaseProgress | null): Badge[] {
  const passed = (name: string) => journey.some((step) => step.name === name && step.state !== "ahead");
  const stageBadges = (naju?.stages ?? []).map((stage) => ({
    name: `${stage.name} 해결`,
    condition: `나주 「${stage.name}」의 일을 모두 마친다`,
    isEarned: stage.total > 0 && stage.done >= stage.total,
  }));
  return [
    { name: "첫 출근", condition: "버려진 역 튜토리얼을 마친다", isEarned: isTutorialDone },
    { name: "합동수사본부 합류", condition: "본부실에 들어선다", isEarned: passed("합동수사본부") },
    { name: "첫 출동", condition: "나주 앙암바위에 도착한다", isEarned: naju !== null },
    ...(stageBadges.length
      ? stageBadges
      : // 나주에 들어가기 전에도 무엇을 모으는지 보이게 이름만 깐다
        ["나루터", "바위 아래", "물굴", "능선", "바위 위", "굿판"].map((name) => ({
          name: `${name} 해결`,
          condition: `나주 「${name}」의 일을 모두 마친다`,
          isEarned: false,
        }))),
    { name: "앙암바위의 진실", condition: "나주 사건을 끝까지 해결한다", isEarned: naju?.isCleared === true },
  ];
}

/** 서버 응답 셋을 화면용 요약으로. 저장이 없으면(처음) 빈 진행으로 돌려준다 */
export function summarizeMyProgress(
  save: GameSaveBody | null,
  ownedItems: readonly OwnedItemBody[],
  character: CharacterBody | null,
): MyProgress {
  const sections = readSections(save);
  const read = (name: string) => (name in sections ? sections[name] : null);
  const naju = najuCaseProgress(read);
  const journey = buildJourney(save?.stage, naju !== null);
  const tutorial = asRecord(sections["main.tutorial"]);
  // 본부실 이후로 넘어갔으면 튜토리얼은 끝난 것이다(옛 저장본엔 끝 표시가 없을 수 있다)
  const isTutorialDone =
    tutorial.isFinished === true || journey.findIndex((step) => step.state === "current") > 1 || naju !== null;
  const savedAt = save?.updated_at ? new Date(save.updated_at) : null;
  return {
    isEmpty: save === null,
    journey,
    savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
    isTutorialDone,
    naju,
    caseItems: readCaseItems(sections),
    ownedItems: [...ownedItems],
    characterName: character?.display_name ?? null,
    badges: buildBadges(journey, isTutorialDone, naju),
  };
}
