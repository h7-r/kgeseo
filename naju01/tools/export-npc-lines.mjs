// 동행 대사(src/dialogue/lines.ts)를 콘텐츠 담당에게 넘길 두 벌로 뽑는다.
//   node naju01/tools/export-npc-lines.mjs
//     → docs/naju/naju-angam-01.npc-lines.draft.json   옮겨 적을 원문 목록(존댓말 · 보관용 반말 모두)
//     → docs/naju/NPC_상황별_대사_1106.md               사람이 읽는 문서(베타에 쓰는 존댓말 한 벌만)
// 상황 코드와 분류는 계약 v0.4.16 §9 로 확정됐고, 대사 원문은 G3 승인을 기다린다. 서버 npc.json 에 그대로 넣는 파일이 아니다.
// 분류(category)는 계약 §6 의 자리, situation_code 는 §9 의 코드 열한 개다.
// focus_local_id · zone 은 FE 임시 이름이다. 서버의 focus_object_id · zone_id 는 11/9 대응표의 값으로 바꿔 싣는다.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GAME_VOICE } from "../src/dialogue/gameVoiceLines.ts";
import { APPROVAL_CATEGORIES, allLines, chatterZones } from "../src/dialogue/lines.ts";
import { OBJECTIVES } from "../src/dialogue/objectives.ts";
import { SITUATION_CODES } from "../src/dialogue/situationCodes.ts";

const JSON_OUT = fileURLToPath(new URL("../../docs/naju/naju-angam-01.npc-lines.draft.json", import.meta.url));
const DOC_OUT = fileURLToPath(new URL("../../docs/naju/NPC_상황별_대사_1106.md", import.meta.url));

/** 콘텐츠로 옮길 자리 — 문서 머리말의 표 */
const PLACE_OF = {
  "퍼즐 넛지": "`puzzles[].nudges`",
  "상황 대사": "`situations[].lines[]`",
  "일반 잡담": "`general_nudges`",
  "나주 잡담": "`general_nudges`",
  "FE 문구": "화면 쪽 고정 문구(서버로 가지 않는다)",
};

/**
 * 계약 v0.4.16 §9 의 상황 코드 — 겹칠 때 앞서는 차례대로(situations.ts). limit 은 §9 가 정한 코드당 줄 수(조정 중인 숫자)다.
 * limit 은 어느 걸음에도 딸리지 않은 공통 줄에만 건다. 걸음 대사(STEP_ARRIVED · 걸음의 NO_PROGRESS)는 focus_object_id 로
 * 걸음마다 따로 고르는 말이라 §9-6 「걸음 12개는 각 1~2줄」 — 걸음당(두 코드 합)으로 센다. 잡담은 general_nudges 라 따로 센다.
 */
const CODE_SPEC = [
  { code: "BREATH_LOW", meaning: "물속 숨이 기준 아래로 처음 떨어짐", limit: 2 },
  { code: "SENT_BACK", meaning: "숨이 다하거나 빠져서 되돌려짐", limit: 2 },
  { code: "ITEM_MISSING", meaning: "필요한 물건 없이 다음 자리에 옴", limit: 2 },
  { code: "ITEM_LEFT_BEHIND", meaning: "가진 물건을 내려놓고 멀어짐", limit: 2 },
  { code: "ITEM_NOT_PICKED", meaning: "보상 물건을 안 줍고 다음 구역으로 감", limit: 2 },
  { code: "REPEATED_MISTAKE", meaning: "같은 실수를 거듭함(화면 판정 퍼즐 · 판정 없는 걸음만)", limit: 3 },
  { code: "OFF_OBJECTIVE", meaning: "목표 구역에서 오래 벗어남", limit: 3 },
  { code: "NO_PROGRESS", meaning: "오래 진전이 없음(화면 판정 퍼즐 · 판정 없는 걸음만)", limit: 3 },
  { code: "STEP_ARRIVED", meaning: "걸음 자리에 처음 도착 — 분위기 · 보이는 것만(§10-3)", limit: null },
  { code: "STEP_DONE", meaning: "걸음 · 화면 판정 퍼즐이 풀림. 연출이 끝난 뒤 한 번", limit: 2 },
  { code: "QUIET", meaning: "한동안 조용함(잡담)", limit: null },
];
/** 판정 없는 걸음 하나에 실을 수 있는 줄 수(§9-6) — 도착 · 진전 없음을 합쳐 센다(§10-3 은 나누기만 하고 수를 늘리지 않았다) */
const STEP_LINE_LIMIT = 2;

/** FE 상황 → 문서의 「언제」 */
const WHEN = {
  breath: "물속 숨이 기준 아래로 처음 떨어졌을 때",
  sentBack: "숨이 다해 되돌아왔을 때",
  missing: "필요한 물건 없이 그 자리에 왔을 때",
  dropped: "필요한 물건을 내려놓고 멀어질 때",
  unpicked: "나온 물건을 줍지 않고 다음 구역으로 갔을 때",
  wrong: "틀리기를 되풀이할 때",
  astray: "목표에서 멀어질 때",
  stuck: "진전 없이 오래 머물 때",
  overtime: "정해 둔 시간을 넘겼을 때",
  idle: "한참 가만히 있을 때",
  solved: "걸음 · 화면 판정 퍼즐을 풀었을 때",
  arrive: "처음 섰을 때 — 무엇이 있다",
  help: "도움말 — 무엇을 하면 된다",
  // 걸음의 도움말은 진전이 없을 때만 나온다(§10-3)
  stepHelp: "진전이 없을 때 — 무엇을 하면 된다",
};
/** 그 줄의 「언제」 — 걸음의 도움말은 NO_PROGRESS 로 실려 진전이 없을 때 나온다 */
const whenOf = (line) => (line.step && line.fe_situation === "help" ? WHEN.stepHelp : WHEN[line.fe_situation]);

/** FE 문구 → 문서의 「언제」 */
const FE_WHEN = {
  opening: "맨 처음 인사(말투를 정하기 전)",
  toneAsk: "반말 · 존댓말 묻기",
  toneSet: "말투를 고른 뒤(키 안내)",
  greet: "다시 만났을 때 인사(키 안내)",
  menu: "[F] 로 말을 걸었을 때",
  help: "할 일이 없을 때 [F] 로 물으면",
  helpEnd: "도움말을 다 들었을 때",
  hintOffer: "더 알려 줄지 물을 때",
  hintDeclined: "괜찮다고 했을 때",
  firstItem: "첫 물건을 얻었을 때(조작 안내)",
  progress: "하나 해냈을 때 — 남은 수",
  progressLast: "하나만 남았을 때",
  pinched: "게한테 물렸을 때",
  offerHelp: "한참 못 풀 때 — 도울지 묻기",
  offerAfterWrong: "틀리기를 되풀이할 때 — 도울지 묻기",
};

const FE_ORDER = Object.keys(FE_WHEN);
/** 목표별 FE 문구 — [F] 보기 「여기서 뭘 해야 해요?」의 대답(lines.ts 의 WHAT_TO_DO) */
const WHAT_KIND = "what";

const ZONE_NAME = { dock: "나루터", rock: "바위 아래", cave: "물굴", ridge: "증언 능선" };

/** 걸음(판정 없는 목표)인가 — 서버 퍼즐로 등록되지 않는 것 */
const stepOf = (scope) => (OBJECTIVES[scope] && !OBJECTIVES[scope].puzzleId ? OBJECTIVES[scope] : null);

/**
 * 그 줄이 실릴 상황 코드. 퍼즐 넛지 · 잡담 · FE 문구는 상황 코드의 줄이 아니다.
 * 걸음 대사의 자리는 `situations[].lines[]` + `focus_object_id` 다(§9). §10-3: 걸음 도착(STEP_ARRIVED)에는 분위기 · 보이는 것(arrive)만,
 * 도움말(help)은 진전 없음(NO_PROGRESS) + 그 걸음의 대상으로 — 진전이 없을 때만 나온다.
 */
function situationCodeOf(line) {
  if (line.category !== "상황 대사") return null;
  if (stepOf(line.scope) && line.kind === "help") return SITUATION_CODES.stuck;
  if (stepOf(line.scope) && line.kind === "arrive") return SITUATION_CODES.arrive;
  return SITUATION_CODES[line.kind] ?? null;
}

export function buildExport() {
  const lines = allLines().map((line) => {
    const objective = OBJECTIVES[line.scope];
    const zones = chatterZones(line.kind);
    return {
      line_id: line.id,
      // 퍼즐 넛지 / 상황 대사 / 일반 잡담 / 나주 잡담 / FE 문구 — 콘텐츠로 옮길 자리(계약 v0.4.16 §6). FE 문구는 승인 대상이 아니다
      category: line.category,
      tone: line.tone,
      // 서버에 등록되는 퍼즐이면 그 ID. 판정 없는 걸음은 걸음 ID 를 step 에 남긴다
      puzzle_id: objective?.puzzleId ?? null,
      step: stepOf(line.scope) ? line.scope : null,
      // 걸음 대사가 가리키는 FE 로컬 상호작용 ID(임시). 겨눌 대상이 없는 걸음은 null. 서버로 가지 않는 FE 문구에는 붙이지 않는다
      focus_local_id: line.category === "FE 문구" ? null : (stepOf(line.scope)?.focusLocalId ?? null),
      // 한 구역에서만 하는 잡담의 FE 구역 이름(임시). 여러 구역에 걸친 잡담은 한 값으로 못 적어 null
      zone: zones.length === 1 ? zones[0] : null,
      fe_situation: line.kind,
      // 계약 v0.4.16 §9 의 코드. 상황 대사가 아닌 줄은 null
      situation_code: situationCodeOf(line),
      text: line.text,
      length: [...line.text].length,
    };
  });

  // 베타는 존댓말 한 벌이다 — 수는 그 한 벌로 센다(말투를 정하기 전의 말 both 포함)
  const oneSet = lines.filter((line) => line.tone !== "casual");
  const byCategory = Object.fromEntries(
    Object.keys(PLACE_OF).map((category) => [category, oneSet.filter((line) => line.category === category).length]),
  );
  const approvalCount = oneSet.filter((line) => APPROVAL_CATEGORIES.includes(line.category)).length;
  const codeCounts = countByCode(oneSet);
  const stepCounts = countBySteps(oneSet);

  const json = {
    case_id: "naju-angam-01",
    // 상황 코드 · 분류는 확정, 대사 원문은 G3 승인 대기(계약 v0.4.16 §9)
    status: "g3_pending",
    note:
      "상황 코드와 분류는 계약 v0.4.16 §9 로 확정됐고, 대사 원문은 G3 승인을 기다린다. 넛지(1단계)만 있고 정답 · 정식 힌트 원문은 없다. " +
      "tone: polite 존댓말(베타 한 벌) · casual 반말(보관만 한다) · both 말투를 정하기 전. " +
      "focus_local_id · zone 은 FE 임시 이름이다 — 서버의 focus_object_id · zone_id 는 11/9 대응표의 값으로 바꿔 싣는다. " +
      "category 가 「FE 문구」인 줄은 화면 쪽 고정 문구라 승인 대상이 아니다.",
    count: lines.length,
    one_set: {
      count: oneSet.length,
      by_category: byCategory,
      approval_count: approvalCount,
      by_situation_code: codeCounts,
      steps: stepCounts,
    },
    lines,
  };
  return { json, markdown: renderDoc(oneSet, byCategory, approvalCount, codeCounts, stepCounts) };
}

/** 걸음별 줄 수(도착 + 진전 없음) — §9-6 의 걸음당 1~2줄과 견준다 */
function countBySteps(oneSet) {
  const steps = oneSet.filter((line) => line.category === "상황 대사" && line.step);
  const perStep = Object.fromEntries(
    [...new Set(steps.map((line) => line.step))].map((step) => [
      step,
      steps.filter((line) => line.step === step).length,
    ]),
  );
  return { count: steps.length, limit_per_step: STEP_LINE_LIMIT, per_step: perStep };
}

/**
 * 상황 코드별 줄 수(존댓말 한 벌)를 §9 분량과 나란히 — 코드 열한 개가 빠짐없이 나온다.
 * count 는 공통 줄(분량 검사 대상), step_count 는 그 코드에 실린 걸음 대사(걸음별 검사는 countBySteps). 잡담은 general_nudges 에 실리는 줄 수.
 */
function countByCode(oneSet) {
  const chatter = oneSet.filter((line) => line.category === "일반 잡담" || line.category === "나주 잡담");
  return CODE_SPEC.map(({ code, limit }) => {
    const stepCount = oneSet.filter((line) => line.step && line.situation_code === code).length;
    if (code === "QUIET")
      return {
        code,
        count: chatter.length,
        general: chatter.filter((line) => line.category === "일반 잡담").length,
        // 나주 잡담 = 물 밖 세 구역이 함께 쓰는 것 + 구역마다 따로인 것
        case_shared: chatter.filter((line) => line.category === "나주 잡담" && !line.zone).length,
        case_zoned: chatter.filter((line) => line.category === "나주 잡담" && line.zone).length,
      };
    const count = oneSet.filter((line) => !line.step && line.situation_code === code).length;
    return stepCount ? { code, count, step_count: stepCount, limit } : { code, count, limit };
  });
}

/** §9 분량을 넘은 코드(공통 줄) · 걸음(도착 + 진전 없음) — 넘으면 내보내지 않는다 */
function overLimit(codeCounts, stepCounts) {
  const codes = codeCounts.flatMap((entry) =>
    entry.limit && entry.count > entry.limit ? [`${entry.code} ${entry.count}줄(${entry.limit}줄까지)`] : [],
  );
  const steps = Object.entries(stepCounts.per_step)
    .filter(([, count]) => count > stepCounts.limit_per_step)
    .map(([step, count]) => `${step} ${count}줄(걸음당 ${stepCounts.limit_per_step}줄까지)`);
  return [...codes, ...steps];
}

/** 표의 한 칸 — 줄바꿈과 세로줄이 표를 깨지 않게 */
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
const table = (head, rows) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
const code = (text) => (text ? `\`${text}\`` : "—");

function renderDoc(lines, byCategory, approvalCount, codeCounts, stepCounts) {
  const of = (category) => lines.filter((line) => line.category === category);
  const situational = of("상황 대사");
  const common = situational.filter((line) => !line.step);
  const steps = situational.filter((line) => line.step);
  const stepIds = [...new Set(steps.map((line) => line.step))];
  const puzzleIds = [...new Set(of("퍼즐 넛지").map((line) => line.puzzle_id))];
  const chatter = [...of("일반 잡담"), ...of("나주 잡담")];
  const zoned = Object.keys(ZONE_NAME).filter((zone) => chatter.some((line) => line.zone === zone));
  // 나주 잡담 가운데 한 구역에 묶이지 않은 것 — 지금은 물 밖 세 구역에서 도는 묶음
  const shared = of("나주 잡담").filter((line) => !line.zone);
  const sharedZones = [...new Set(shared.flatMap((line) => chatterZones(line.fe_situation)))];

  const countNote = (category) =>
    category === "상황 대사"
      ? `${byCategory[category]} (공통 ${common.length} + 걸음 ${steps.length})`
      : byCategory[category];

  const stepNumbers = Object.values(stepCounts.per_step);
  const stepRule = `걸음마다 1~${stepCounts.limit_per_step}줄(도착 + 진전 없음 합) + \`focus_object_id\``;
  /** 코드별 줄 수 표의 한 줄 — [코드, 뜻, 줄 수, §9 분량] */
  const codeRow = ({ code: name, meaning }) => {
    const counted = codeCounts.find((entry) => entry.code === name);
    if (name === "STEP_ARRIVED") {
      const stepsWith = new Set(steps.filter((line) => line.situation_code === name).map((line) => line.step)).size;
      return [code(name), meaning, `걸음 ${counted.step_count ?? 0} (걸음 ${stepsWith}개)`, stepRule];
    }
    if (counted.step_count)
      return [
        code(name),
        meaning,
        `${counted.count} + 걸음 ${counted.step_count}`,
        `공통 ${counted.limit}줄까지 · 걸음 대사는 ${stepRule}`,
      ];
    if (name === "QUIET")
      return [
        code(name),
        meaning,
        `${counted.count} (일반 ${counted.general} + 나주 ${counted.case_shared + counted.case_zoned})`,
        `\`general_nudges\` 에 싣는다. 나주 잡담 ${counted.case_shared + counted.case_zoned}줄 = 공통 ${counted.case_shared} + 구역 ${counted.case_zoned}`,
      ];
    return [code(name), meaning, counted.count, `${counted.limit}줄까지`];
  };
  const generalFe = of("FE 문구").filter((line) => line.fe_situation !== WHAT_KIND);
  const whatFe = of("FE 문구").filter((line) => line.fe_situation === WHAT_KIND);

  return `${[
    "# 나주 동행 NPC — 상황별 대사 (2026-11-06)",
    "",
    "> `node naju01/tools/export-npc-lines.mjs` 가 `naju01/src/dialogue/lines.ts` 에서 뽑아 쓰는 문서다. 손으로 고치지 말고 원본을 고친 뒤 다시 뽑는다.",
    "",
    "**2026-11-06 계약 v0.4.16 §9 로 상황 코드(11개)와 분류가 확정됐다. 대사 원문은 G3 승인을 기다린다.** 쿨다운 · 분량 같은 숫자만 🟡 조정 중이다.",
    "",
    "동행이 **어떤 상황에서 어떤 말을 하는지**를 한 장에 모았다. 대사는 모두 넛지(1단계)다 — 어디를 보고 무엇을 만질지만 말하고 답은 적지 않았다.",
    "베타는 존댓말(해요체) 한 벌이라 **존댓말만** 실었다. 반말은 보관만 한다(`docs/naju/naju-angam-01.npc-lines.draft.json`).",
    "",
    "## 분류별 수 — 존댓말 한 벌 기준",
    "",
    table(
      ["분류", "콘텐츠로 옮길 자리", "줄 수", "승인"],
      Object.keys(PLACE_OF).map((category) => [
        category,
        PLACE_OF[category],
        countNote(category),
        APPROVAL_CATEGORIES.includes(category) ? "대상" : "대상 아님",
      ]),
    ),
    "",
    `- **승인(G3) 대상 ${approvalCount}줄.** FE 문구 ${byCategory["FE 문구"]}줄은 대화를 이어 가는 고정 문구라 승인 대상이 아니다(§9).`,
    `- 퍼즐 설명 · 진행 알림을 동행 말투로 옮긴 말(\`naju01/src/dialogue/gameVoiceLines.ts\`, ${GAME_VOICE.length}줄 — §9 의 「약 175줄」)도 FE 문구다. G3 가 아니라 퍼즐 검수(G2)와 게시 검사로 본다 — 이 문서의 수에는 넣지 않았다.`,
    "- 고정 문장이다. 이름 · 수를 끼워 넣는 자리가 없다. 「남은 수」처럼 바뀌는 값은 FE 문구가 맡는다.",
    "- `focus_local_id` · `zone` 은 FE 임시 이름이다. 서버의 `focus_object_id` · `zone_id` 는 11/9 나주 대응표의 Object · Zone ID 로 바꿔 싣는다.",
    "",
    "## 상황 코드별 줄 수 — §9 분량과 견줌",
    "",
    "코드 열한 개는 확정이고, 분량은 🟡 조정 중인 숫자다. 겹칠 때 앞서는 차례대로 적었다. 뜻과 감지 현황은 `docs/naju/NPC_상황분류표_1106.md`.",
    "",
    table(["상황 코드", "뜻", "줄 수", "§9 분량 🟡"], CODE_SPEC.map(codeRow)),
    "",
    "- 분량 안에 든다 — 넘으면 이 도구가 내보내기를 멈춘다. FE 문구와 겹치는 말(안내판 설명 · 게임 알림)은 싣지 않았다.",
    "- 코드당 분량은 공통 줄에 건다. 걸음 대사는 `focus_object_id` 로 걸음마다 고르므로 §9-6 대로 걸음당(도착 + 진전 없음 합) 1~2줄로 센다.",
    `- 걸음별 줄 수(${stepNumbers.length}개 · 걸음당 ${Math.min(...stepNumbers)}~${Math.max(...stepNumbers)}줄): ` +
      Object.entries(stepCounts.per_step)
        .map(([step, count]) => `\`${step}\` ${count}`)
        .join(" · "),
    "",
    "## 1. 상황 코드별 대사 — 어느 퍼즐에서든 나오는 말",
    "",
    "겹칠 때 앞서는 차례대로 적었다. 한 코드에 줄이 여럿이면 서버가 돌아가며 고른다(직전과 같은 줄은 피한다 — 계약 §4).",
    "",
    table(
      ["상황 코드", "언제", "대사"],
      CODE_SPEC.flatMap(({ code: situationCode }) =>
        common
          .filter((line) => line.situation_code === situationCode)
          .map((line) => [code(situationCode), whenOf(line), line.text]),
      ),
    ),
    "",
    "## 2. 걸음 대사 — 판정이 없는 걸음(서버 퍼즐이 아님)",
    "",
    "걸음마다 내용이 달라 코드만으로는 못 고른다. 대사에 그 걸음의 대상을 붙여 `situations[].lines[]` 에 싣는다(§9).",
    "§10-3: 걸음 도착(`STEP_ARRIVED`)에는 분위기 · 화면에 보이는 것만 두고, 도움말 성격 줄은 진전 없음(`NO_PROGRESS`) + 그 걸음의 대상으로 — 진전이 없을 때만 나온다.",
    "`focus_object_id` 는 11/9 대응표의 Object ID 로 맞춘다. 그 전까지는 화면 쪽 ID(`focus_local_id`)로 짝지어 둔다.",
    "`focus_local_id` 가 —인 걸음은 겨눌 대상 없이 걸어가기만 하거나(연기 · 갈라진 강 · 능선 · 틈), 대상 ID 가 퍼즐의 답을 드러내 적지 않은 것(화톳불)이다.",
    "",
    table(
      ["걸음", "focus_local_id", "상황 코드", "언제", "대사"],
      stepIds.flatMap((step) =>
        steps
          .filter((line) => line.step === step)
          .map((line) => [
            `${code(step)} ${OBJECTIVES[step].name}`,
            code(line.focus_local_id),
            code(line.situation_code),
            whenOf(line),
            line.text,
          ]),
      ),
    ),
    "",
    "## 3. 퍼즐 넛지 — 퍼즐별",
    "",
    "서버가 퍼즐로 찾아 주는 말이다. 안내판 설명 · 게임 알림이 이미 하는 말은 없다.",
    "",
    ...puzzleIds.flatMap((puzzleId) => [
      `### ${puzzleId} ${OBJECTIVES[puzzleId].name}`,
      "",
      table(
        ["언제", "대사"],
        of("퍼즐 넛지")
          .filter((line) => line.puzzle_id === puzzleId)
          .map((line) => [WHEN[line.fe_situation], line.text]),
      ),
      "",
    ]),
    "## 4. 잡담 — 동행이 한동안 말이 없었을 때 먼저 거는 말",
    "",
    "### 일반 잡담 — 어디서나",
    "",
    ...of("일반 잡담").map((line) => `- ${line.text}`),
    "",
    `### 나주 잡담 — ${sharedZones.map((zone) => ZONE_NAME[zone]).join(" · ")}(${sharedZones.join(" · ")})에서`,
    "",
    "한 구역에 묶이지 않아 `zone` 을 비워 뒀다 — 물속에서는 하지 않는 말이다. `zone_id` 는 줄마다 선택 필드다(§9).",
    "",
    ...shared.map((line) => `- ${line.text}`),
    "",
    "### 나주 잡담 — 구역별",
    "",
    table(
      ["zone", "대사"],
      zoned.flatMap((zone) =>
        chatter.filter((line) => line.zone === zone).map((line) => [`${code(zone)} ${ZONE_NAME[zone]}`, line.text]),
      ),
    ),
    "",
    "## 5. FE 문구 — 승인 대상 아님",
    "",
    "상황을 감지해 하는 말이 아니라 화면이 대화의 차례에 맞춰 하는 고정 문구다. 게임 알림 · 안내판 설명을 동행 말투로 옮긴 말은 `naju01/src/dialogue/gameVoiceLines.ts`, 보기 문구는 `naju01/src/dialogue/director.ts` 에 있다.",
    "말투 묻기 · 바꾸기는 베타에서 꺼 둔다(§9) — 그 문구는 보관만 한다.",
    "",
    "### 대화 진행 문구",
    "",
    table(
      ["언제", "문구"],
      // 대화가 흘러가는 차례(FE_WHEN 에 적은 차례)대로
      generalFe
        .toSorted((a, b) => FE_ORDER.indexOf(a.fe_situation) - FE_ORDER.indexOf(b.fe_situation))
        .map((line) => [FE_WHEN[line.fe_situation], line.text]),
    ),
    "",
    "### [F] 보기 「여기서 뭘 해야 해요?」의 대답 — 안내판도 첫 설명 대사도 없는 목표",
    "",
    "안내판이 있는 목표는 안내판 설명으로, 첫 설명 대사가 있는 목표는 그 대사로 답한다. 둘 다 없는 목표만 여기서 무엇을 하는 곳인지 한 줄로 말한다 — 푸는 법은 「힌트를 주세요」가 맡는다.",
    "",
    table(
      ["목표", "문구"],
      whatFe.map((line) => [
        `${code(line.puzzle_id ?? line.step)} ${OBJECTIVES[line.puzzle_id ?? line.step].name}`,
        line.text,
      ]),
    ),
  ].join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { json, markdown } = buildExport();
  const tooLong = json.lines.filter((line) => line.length > 200);
  if (tooLong.length) {
    console.error(`200자를 넘는 대사 ${tooLong.length}개:`, tooLong.map((line) => line.line_id).join(", "));
    process.exit(1);
  }
  const tooMany = overLimit(json.one_set.by_situation_code, json.one_set.steps);
  if (tooMany.length) {
    console.error("계약 v0.4.16 §9 분량을 넘었다:", tooMany.join(", "));
    process.exit(1);
  }
  writeFileSync(JSON_OUT, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(DOC_OUT, markdown);
  const { one_set: oneSet } = json;
  console.log(`대사 ${json.count}줄(한 벌 ${oneSet.count} · 승인 대상 ${oneSet.approval_count}) → ${JSON_OUT}`);
  console.log(`문서 → ${DOC_OUT}`);
}
