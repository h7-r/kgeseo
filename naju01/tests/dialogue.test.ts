/**
 * 동행 대화 — 쪽 나누기 · 대화창 순서 · 상황 판정 · 대사 고르기. node --test naju01/tests/dialogue.test.ts
 * 승인 대기 초안(draftLines.ts)은 운영 번들에 없다 — 검사는 직접 불러 넣는다(registerDraftLines).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { createDialogueStore, pageDurationMs } from "../src/dialogue/dialogueStore.ts";
import { HINT_UNAVAILABLE, SENT_BACK_KEY, createDirector } from "../src/dialogue/director.ts";
import { hasCompanionVoice, inCompanionVoice } from "../src/dialogue/gameVoice.ts";
import { GAME_VOICE } from "../src/dialogue/gameVoiceLines.ts";
import { DRAFT_GENERAL_LINES, DRAFT_LINES, DRAFT_OBJECTIVE_LINES } from "../src/dialogue/draftLines.ts";
import {
  APPROVAL_CATEGORIES,
  GENERAL_LINES,
  WHAT_TO_DO,
  categoryOf,
  registerDraftLines,
  allLines,
  chatterZones,
  ownLines,
  pickChatter,
  pickLine,
  rotateGeneral,
  setTone,
  whatToDo,
} from "../src/dialogue/lines.ts";
import {
  OBJECTIVES,
  PANEL_OBJECTIVE,
  SENT_BACK_NOTICE,
  SERVER_JUDGED,
  caveCompleted,
  countedAsHeld,
  createPanelReader,
  nextCaveObjective,
  type CaveProgress,
  type ObjectiveId,
} from "../src/dialogue/objectives.ts";
import { paginate, textWidth } from "../src/dialogue/paginate.ts";
import { SITUATION_CODES, toSituationPayload } from "../src/dialogue/situationCodes.ts";
import { createSituationWatcher, type Observation, type Situation } from "../src/dialogue/situations.ts";
import { buildExport } from "../tools/export-npc-lines.mjs";
import { listGameTexts } from "../tools/list-game-texts.mjs";

registerDraftLines(DRAFT_LINES);

// ── 쪽 나누기 ──

const LONG_RULE =
  "여는 법은 큰 비석에 수수께끼로 새겨져 있다. 검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채운다.\n뜬 돌은 물레를 겨눠 [E] 로 끼운다(한 번 끼우면 안 빠진다). 물레는 겨눠 [E] 를 꾹.\n톱니돌은 위 홈부터 — 하나 끼우고 물레를 돌려야 다음 홈이 열린다. 빈손 [E] 로 도로 뺀다.";

test("긴 글은 한 쪽 폭을 넘지 않게 나뉘고, 글자는 하나도 빠지지 않는다", () => {
  for (const capacity of [40, 60, 97]) {
    const pages = paginate(LONG_RULE, capacity);
    assert.ok(pages.length > 1);
    for (const page of pages) assert.ok(textWidth(page) <= capacity, `${capacity}: 「${page}」`);
    assert.equal(pages.join("").replace(/\s/g, ""), LONG_RULE.replace(/\s/g, ""));
  }
});

test("짧은 글은 한 쪽이고, 키 표시 [E] 는 쪼개지지 않는다", () => {
  assert.deepEqual(paginate("빈 통발이다. 물만 줄줄 흐른다.", 97), ["빈 통발이다. 물만 줄줄 흐른다."]);
  for (const page of paginate(LONG_RULE, 30)) assert.ok(!/\[[^\]]*$/.test(page), page);
});

test("띄어쓰기 없는 긴 글도 넘치지 않는다", () => {
  const pages = paginate("가".repeat(250), 60);
  assert.equal(pages.length, 5);
  for (const page of pages) assert.ok(textWidth(page) <= 60);
});

test("마지막 쪽에 한 마디만 남지 않는다", () => {
  const pages = paginate("가나다라 ".repeat(11) + "끝.", 50);
  assert.ok(textWidth(pages[pages.length - 1]) >= 50 * 0.3, pages.join(" | "));
});

// ── 대화창 ──

function fakeTimers() {
  let timers: { at: number; run: () => void; id: number }[] = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        now = due.at;
        due.run();
      }
      now = until;
    },
  };
}

test("같은 key 로 바꿔 끼우거나 retract 로 내린 물음은 「대답 없음」(null)으로 돌려준다 — 부른 쪽이 끝없이 기다리지 않게", async () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 97 });
  const choices = [{ id: "yes", label: "네" }, { id: "no", label: "아니요" }];
  // 떠 있는 물음을 같은 key 가 바꿔 끼움
  const first = store.ask({ text: "첫 물음", key: "offer", choices });
  const second = store.ask({ text: "둘째 물음", key: "offer", choices });
  assert.equal(await first, null);
  assert.equal(store.getState()?.speech.text, "둘째 물음");
  // 줄 서 있던 물음을 같은 key 가 바꿔 끼움
  store.setHeld(true);
  const queued = store.ask({ text: "줄 선 물음", key: "q", choices });
  const replacing = store.ask({ text: "바꾼 물음", key: "q", choices });
  assert.equal(await queued, null);
  // retract 로 내림
  store.retract("q");
  assert.equal(await replacing, null);
  store.setHeld(false);
  store.answer("yes");
  assert.equal(await second, "yes");
});

test("급한 말이 덜 급한 말을 밀어내고, 밀린 말은 뒤에 이어진다", () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 97 });
  store.say({ kind: "notice", text: "철컥 — 자물통이 풀렸다." });
  store.say({ kind: "guide", text: "걸상 다섯 윗면에 그림이 새겨져 있다.", key: "guide" });
  assert.equal(store.getState()?.speech.kind, "notice");
  timers.advance(pageDurationMs("철컥 — 자물통이 풀렸다."));
  assert.equal(store.getState()?.speech.kind, "guide");
  store.say({ kind: "notice", text: "걸상 위에 올라섰다." });
  assert.equal(store.getState()?.speech.kind, "notice");
  timers.advance(60_000);
  assert.equal(store.getState(), null);
});

test("긴 말은 쪽이 저절로 넘어가고, 넘기기로 바로 넘길 수도 있다", () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 40 });
  store.say({ kind: "guide", text: LONG_RULE });
  const total = store.getState()!.pages.length;
  assert.ok(total >= 3);
  assert.equal(store.advance(), true);
  assert.equal(store.getState()?.pageIndex, 1);
  timers.advance(pageDurationMs(store.getState()!.pages[1]));
  assert.equal(store.getState()?.pageIndex, 2);
  for (let page = 2; page < total; page++) store.advance();
  assert.equal(store.getState(), null);
});

test("물음은 대답할 때까지 자리를 지키고, 그 사이 온 알림은 대답 뒤에 나온다", async () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 97 });
  const answered = store.ask({
    text: "조금 더 알려 줄까요?",
    choices: [
      { id: "yes", label: "응" },
      { id: "no", label: "아니" },
    ],
  });
  store.say({ kind: "notice", text: "물이 빠지기 시작한다." });
  assert.equal(store.getState()?.speech.kind, "ask");
  assert.equal(store.advance(), false, "물음은 넘길 수 없다");
  assert.equal(store.answer("maybe"), false, "없는 선택지는 받지 않는다");
  assert.equal(store.answer("yes"), true);
  assert.equal(await answered, "yes");
  assert.equal(store.getState()?.speech.kind, "notice");
});

test("대답 없이 시간이 지난 물음은 null 로 물러난다", async () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 97 });
  const answered = store.ask({ text: "열어 볼까요?", choices: [{ id: "yes", label: "응" }], timeoutMs: 5_000 });
  timers.advance(5_000);
  assert.equal(await answered, null);
  assert.equal(store.getState(), null);
});

test("읽던 퍼즐 설명은 알림이 끼어들어도 남은 쪽부터 이어 간다", () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 40 });
  store.say({ kind: "guide", text: LONG_RULE, key: "guide" });
  store.advance();
  const rest = store.getState()!.pages.slice(1).join(" ");
  store.say({ kind: "notice", text: "철컥 — 자물통이 풀렸다." });
  assert.equal(store.getState()?.speech.kind, "notice");
  store.advance();
  assert.equal(store.getState()?.speech.kind, "guide");
  assert.equal(store.getState()!.pages.join(" ").replace(/\s/g, ""), rest.replace(/\s/g, ""));
});

test("같은 급의 말은 서로 덮지 않고 차례로 이어진다", () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 97 });
  store.say({ kind: "line", text: "막히면 [F] 로 불러 주세요." });
  store.say({ kind: "line", text: "젖은 모래에 숨구멍이 여럿 보여요." });
  assert.equal(store.getState()?.speech.text, "막히면 [F] 로 불러 주세요.");
  store.advance();
  assert.equal(store.getState()?.speech.text, "젖은 모래에 숨구멍이 여럿 보여요.");
});

test("동행이 먼저 건 물음은 방금 일어난 일의 알림에 자리를 내주고, 플레이어가 건 물음은 지킨다", async () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 97 });
  const offer = store.ask({ text: "조금 더 알려 드릴까요?", choices: [{ id: "yes", label: "네" }], timeoutMs: 14_000 });
  store.say({ kind: "notice", text: "빈 통발이네요." });
  assert.equal(store.getState()?.speech.kind, "notice");
  assert.equal(await offer, null);
  store.advance();

  void store.ask({ text: "무엇이 궁금하세요?", choices: [{ id: "hint", label: "힌트" }], freeCursor: true });
  store.say({ kind: "notice", text: "첫 알림." });
  store.say({ kind: "notice", text: "둘째 알림." });
  assert.equal(store.getState()?.speech.kind, "ask");
  assert.equal(store.queueLength(), 2, "물음 뒤에 온 알림이 하나로 줄지 않는다");
});

test("연출이 시작되면 떠 있던 알림과 청한 힌트는 끝난 뒤 다시 나오고, 동행이 먼저 건 말은 거둔다", () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 97 });
  store.say({ kind: "notice", text: "오메, 뚜껑이 열렸어요." });
  store.setHeld(true);
  store.setHeld(false);
  assert.equal(store.getState()?.speech.text, "오메, 뚜껑이 열렸어요.");
  store.advance();

  store.say({ kind: "line", text: "힌트 한 칸.", asked: "힌트를 주세요" });
  store.say({ kind: "notice", text: "철컥." });
  store.advance();
  assert.equal(store.getState()?.speech.text, "힌트 한 칸.", "알림에 밀린 힌트가 이어진다");
  store.advance();

  store.say({ kind: "line", text: "서두르지 않으셔도 돼요." });
  store.setHeld(true);
  store.setHeld(false);
  assert.equal(store.getState(), null);
});

test("연출 중에는 말을 멈추고, 끝나면 밀린 물음부터 이어 간다", () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 97 });
  void store.ask({ text: "더 알려 줄까요?", choices: [{ id: "yes", label: "응" }] });
  store.setHeld(true);
  assert.equal(store.getState(), null);
  store.say({ kind: "notice", text: "철컥 — 자물통이 풀렸다." });
  assert.equal(store.getState(), null);
  store.setHeld(false);
  assert.equal(store.getState()?.speech.kind, "ask");
});

test("퍼즐에서 멀어지면 읽던 설명을 내린다", () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 97 });
  store.say({ kind: "guide", text: "굴 넷에 물고기들이 숨어 있다.", key: "guide" });
  store.retract("guide");
  assert.equal(store.getState(), null);
});

test("미룰 수 없는 말은 알림 · 물음이 떠 있어도 바로 뜨고, 밀려난 알림과 플레이어가 건 물음은 그 뒤에 돌아온다", async () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 97 });
  const warn = { kind: "notice" as const, urgent: true, text: "숨이 얼마 안 남았어요!" };
  store.say({ kind: "notice", text: "철컥." });
  store.say(warn);
  assert.equal(store.getState()?.speech.text, warn.text);
  store.advance();
  assert.equal(store.getState()?.speech.text, "철컥.");
  store.advance();

  const offer = store.ask({ text: "조금 더 알려 드릴까요?", choices: [{ id: "yes", label: "네" }], timeoutMs: 14_000 });
  store.say(warn);
  assert.equal(store.getState()?.speech.text, warn.text);
  assert.equal(await offer, null, "동행이 먼저 건 물음은 거둔다");
  store.advance();

  void store.ask({ text: "무엇이 궁금하세요?", choices: [{ id: "hint", label: "힌트" }], freeCursor: true });
  store.say(warn);
  assert.equal(store.getState()?.speech.text, warn.text);
  store.advance();
  assert.equal(store.getState()?.speech.kind, "ask", "플레이어가 건 물음은 경고 뒤에 돌아온다");
});

// ── 대사 ──

test("대사는 모두 200자 이내이고 id 가 겹치지 않으며 서버 line_id 규칙을 따른다", () => {
  const lines = allLines();
  assert.ok(lines.length >= 150, `대사 ${lines.length}개`);
  const ids = new Set<string>();
  for (const line of lines) {
    assert.ok([...line.text].length <= 200, line.id);
    assert.match(line.id, /^NUDGE_[A-Z0-9_]+$/);
    assert.ok(!ids.has(line.id), line.id);
    ids.add(line.id);
  }
});

test("모든 목표에 [F] 로 힌트를 청했을 때 할 말이 있다", () => {
  for (const id of Object.keys(OBJECTIVES) as ObjectiveId[]) assert.ok(DRAFT_OBJECTIVE_LINES[id].help?.length, `${id} help`);
});

/** 존댓말 한 벌 — 베타에 실리는 줄(말투를 정하기 전의 말 포함) */
const oneSet = () => allLines().filter((line) => line.tone !== "casual");

test("상황 대사는 코드 하나에 두 줄, 진전 없음 · 반복 실수 · 목표 이탈만 세 줄까지다", () => {
  const perCode: Record<string, number> = {};
  for (const line of oneSet()) {
    if (line.scope !== "GENERAL" || line.category !== "상황 대사") continue;
    const code = SITUATION_CODES[line.kind as keyof typeof SITUATION_CODES];
    assert.ok(code, `${line.id} 는 실릴 상황 코드가 없다`);
    perCode[code] = (perCode[code] ?? 0) + 1;
  }
  const roomy = new Set(["NO_PROGRESS", "REPEATED_MISTAKE", "OFF_OBJECTIVE"]);
  for (const [code, count] of Object.entries(perCode))
    assert.ok(count <= (roomy.has(code) ? 3 : 2), `${code} ${count}줄`);
  // 걸음 도착(걸음마다 다른 말) · 잡담(general_nudges)은 공통 줄이 없다. 나머지 아홉은 두 줄을 채운다
  assert.deepEqual(perCode, {
    BREATH_LOW: 2,
    SENT_BACK: 2,
    ITEM_MISSING: 2,
    ITEM_LEFT_BEHIND: 2,
    ITEM_NOT_PICKED: 2,
    REPEATED_MISTAKE: 2,
    OFF_OBJECTIVE: 2,
    NO_PROGRESS: 3,
    STEP_DONE: 2,
  });
});

test("안 챙긴 물건을 알리는 말은 물건 이름 · 자리를 말하지 않는다", () => {
  const names = /빛 물고기|물고기|쌀|막걸리|술병|뜬 돌|톱니돌|진주|눈물|나루터|장독대|배 안|석실/;
  for (const line of allLines())
    if (line.scope === "GENERAL" && (line.kind === "missing" || line.kind === "unpicked"))
      assert.ok(!names.test(line.text), `${line.id}: ${line.text}`);
});

test("판정 없는 걸음의 대사는 걸음마다 한두 줄이고, 가리키는 대상은 걸음에만 둔다", () => {
  for (const id of Object.keys(OBJECTIVES) as ObjectiveId[]) {
    if (OBJECTIVES[id].puzzleId) {
      assert.equal(OBJECTIVES[id].focusLocalId, null, `${id} 는 서버가 퍼즐로 찾는다`);
      continue;
    }
    const count = Object.values(DRAFT_OBJECTIVE_LINES[id]).reduce((sum, ladder) => sum + ladder.length, 0);
    assert.ok(count >= 1 && count <= 2, `${id} ${count}줄`);
  }
});

test("걸음이 가리키는 FE 상호작용 ID 는 퍼즐 코드에 실제로 있다", () => {
  const dir = new URL("../src/puzzles/", import.meta.url);
  const source = (readdirSync(dir, { recursive: true }) as string[])
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => readFileSync(new URL(name, dir), "utf8"))
    .join("\n");
  for (const { id, focusLocalId } of Object.values(OBJECTIVES)) {
    if (!focusLocalId) continue;
    // 「float-stone-0」처럼 번호가 붙은 것은 코드에 `float-stone-${index}` 로 있다
    const family = focusLocalId.replace(/-\d+$/, "");
    const isRegistered = source.includes(`id: "${focusLocalId}"`) || source.includes(`id: \`${family}-\${`);
    assert.ok(isRegistered, `${id}: ${focusLocalId}`);
  }
});

test("넛지 대사에 답(가락 · 숨 횟수)을 적지 않는다", () => {
  for (const line of allLines()) {
    assert.ok(!/도\s*미\s*솔/.test(line.text), line.id);
    assert.ok(!/(세|3)\s*번\s*숨/.test(line.text), line.id);
  }
});

test("말투를 바꾸면 같은 자리의 대사가 그 말투로 나오고 line_id 끝이 달라진다", () => {
  setTone("polite");
  const polite = pickLine("P01", "help", 0)!;
  setTone("casual");
  const casual = pickLine("P01", "help", 0)!;
  setTone("polite");
  assert.notEqual(polite.text, casual.text);
  assert.match(polite.id, /_J$/);
  assert.match(casual.id, /_B$/);
});

test("대사는 다섯 중 하나로 분류되고, 두 말투 어느 쪽도 「~다.」「~습니까?」로 끝나지 않는다", () => {
  const counts: Record<string, number> = {};
  for (const line of allLines()) {
    counts[line.category] = (counts[line.category] ?? 0) + 1;
    assert.ok(
      !/(습니다|한다|이다|있다|없다|었다|았다|는다|니까)[.!?…]*$/.test(line.text.trim()),
      `${line.id}: ${line.text}`,
    );
  }
  assert.deepEqual(Object.keys(counts).sort(), ["FE 문구", "나주 잡담", "상황 대사", "일반 잡담", "퍼즐 넛지"]);
});

test("대화를 이어 가는 말과 진행 알림은 FE 문구로 분류되어 승인 대상에서 빠진다", () => {
  const fe = allLines().filter((line) => line.category === "FE 문구");
  for (const kind of [
    "opening",
    "greet",
    "menu",
    "helpEnd",
    "firstItem",
    "progress",
    "pinched",
    "offerHelp",
    "hintDeclined",
  ])
    assert.ok(
      fe.some((line) => line.kind === kind),
      kind,
    );
  // 퍼즐 · 걸음에 딸린 도움말은 이름(help)이 같아도 FE 문구가 아니다. 목표에 딸린 FE 문구는 「여기서 뭘 해야 해요?」의 대답뿐이다
  assert.ok(fe.every((line) => line.scope === "GENERAL" || line.kind === "what"));
  assert.equal(
    fe.filter((line) => line.kind === "what" && line.tone === "polite").length,
    Object.keys(WHAT_TO_DO).length,
  );
  for (const kind of ["breath", "sentBack", "missing", "stuck", "solved"])
    assert.ok(!fe.some((line) => line.kind === kind), kind);
  assert.ok(!(APPROVAL_CATEGORIES as readonly string[]).includes("FE 문구"));
});

test("내보낸 목록은 걸음 대사에 그 걸음의 대상을, 구역 잡담에 그 구역을 붙이고 문서에는 존댓말만 싣는다", () => {
  const { json, markdown } = buildExport();
  const byId = new Map(json.lines.map((line: { line_id: string }) => [line.line_id, line]));
  const offer = byId.get("NUDGE_S2_OFFER_HELP_1_J");
  assert.deepEqual(
    [offer.step, offer.focus_local_id, offer.puzzle_id],
    ["S2_OFFER", OBJECTIVES.S2_OFFER.focusLocalId, null],
  );
  assert.equal(byId.get("NUDGE_P03_HELP_1_J").focus_local_id, null, "퍼즐 넛지는 puzzle_id 로 찾는다");
  assert.equal(byId.get("NUDGE_GENERAL_CHATTER_CAVE_1_J").zone, "cave");
  assert.equal(byId.get("NUDGE_GENERAL_CHATTER_1_J").zone, null, "어디서나 하는 잡담");
  // 물 밖 세 구역에서 도는 잡담은 한 구역으로 못 적는다
  assert.equal(byId.get("NUDGE_GENERAL_CHATTER_NAJU_1_J").zone, null);
  assert.deepEqual(chatterZones("chatterNaju"), ["dock", "rock", "ridge"]);

  // 목표에 딸린 FE 문구는 서버로 가지 않는다 — 걸음의 대상을 붙이지 않고 상황 코드도 없다
  const what = byId.get("NUDGE_S2_OFFER_WHAT_1_J");
  assert.deepEqual([what.category, what.focus_local_id, what.situation_code], ["FE 문구", null, null]);

  const { one_set: counted } = json;
  assert.equal(counted.count, oneSet().length);
  assert.equal(counted.approval_count, counted.count - counted.by_category["FE 문구"]);
  // 머리말의 코드별 줄 수 — 확정된 코드 열한 개가 다 나오고 분량 안에 든다
  const perCode = counted.by_situation_code as {
    code: string;
    count: number;
    limit?: number | null;
    per_step?: Record<string, number>;
  }[];
  assert.deepEqual(perCode.map((entry) => entry.code).sort(), [...new Set(Object.values(SITUATION_CODES))].sort());
  for (const entry of perCode) if (entry.limit) assert.ok(entry.count <= entry.limit, `${entry.code} ${entry.count}줄`);
  // 걸음 대사는 걸음당(도착 + 진전 없음 합) 1~2줄 — §9-6
  const steps = counted.steps.per_step as Record<string, number>;
  assert.equal(Object.keys(steps).length, 12);
  assert.ok(Object.values(steps).every((count) => count >= 1 && count <= 2));
  // §10-3: 걸음 도착은 분위기 · 보이는 것(arrive)만, 걸음의 도움말은 진전 없음 + 그 걸음의 대상으로 옮겼다(수는 그대로)
  const stepLines = json.lines.filter(
    (line: { step: string | null; tone: string; category: string }) =>
      line.step && line.tone !== "casual" && line.category === "상황 대사",
  );
  for (const line of stepLines)
    assert.equal(line.situation_code, line.fe_situation === "arrive" ? "STEP_ARRIVED" : "NO_PROGRESS", line.line_id);
  assert.equal(
    stepLines.filter((line: { situation_code: string }) => line.situation_code === "NO_PROGRESS").length,
    15,
  );
  assert.equal(byId.get("NUDGE_S2_OFFER_HELP_1_J").situation_code, "NO_PROGRESS");
  assert.equal(byId.get("NUDGE_S2_OFFER_HELP_1_J").focus_local_id, "ritual-table");
  const noProgress = perCode.find((entry) => entry.code === "NO_PROGRESS")!;
  assert.deepEqual([noProgress.count, noProgress.limit], [3, 3], "코드 분량은 공통 줄에만 건다");
  assert.match(markdown, /계약 v0\.4\.16 §9 로 상황 코드\(11개\)와 분류가 확정됐다\. 대사 원문은 G3 승인을 기다린다/);
  for (const line of allLines()) {
    const isShown = markdown.includes(line.text);
    if (line.tone === "casual")
      assert.ok(!isShown || oneSet().some((polite) => polite.text === line.text), `반말이 문서에 실렸다: ${line.id}`);
    else assert.ok(isShown, `문서에 빠졌다: ${line.id}`);
  }
});

test("같은 상황이 되풀이되면 사다리의 다음 칸, 끝에서는 마지막 칸에 머문다", () => {
  assert.notEqual(pickLine("P01", "help", 0)?.text, pickLine("P01", "help", 1)?.text);
  assert.equal(pickLine("P01", "help", 99)?.isLast, true);
  // 계약: 글 속에 바뀌는 자리를 두지 않는다 — 전부 고정 문장
  for (const line of allLines()) assert.ok(!/\{\w+\}/.test(line.text), `${line.id}: ${line.text}`);
});

// ── 상황 판정 ──

const BASE: Observation = {
  now: 0,
  objective: "P03",
  completed: new Set(),
  progressKey: "a",
  activityKey: "",
  mistakes: {},
  x: 41.5,
  z: 31.9,
  isPlaying: true,
  isBusy: false,
  worldItems: [],
  breath: null,
  sentBackCount: 0,
  heldKinds: [],
};

/** from 초부터 to 초까지 0.5초 간격으로 본다. 나온 상황을 모은다 */
function watch(
  watcher: ReturnType<typeof createSituationWatcher>,
  from: number,
  to: number,
  at: (now: number) => Partial<Observation>,
) {
  const seen: Situation[] = [];
  for (let now = from; now <= to; now += 0.5) {
    const situation = watcher.observe({ ...BASE, now, ...at(now) });
    if (situation) seen.push(situation);
  }
  return seen;
}

const run = (...args: Parameters<typeof watch>) =>
  watch(...args).map((situation) => `${situation.kind}${situation.step}`);

test("진전 없이 머물면 80초 · 170초에 말을 걸고, 뭔가 하면 처음부터 다시 센다", () => {
  const watcher = createSituationWatcher();
  // 걸어 다니며 헤매는 중 — 가만히 있음(idle)과 겹치지 않게 자리를 조금씩 옮긴다
  const wander = (now: number) => ({ x: 41.5 + Math.sin(now) * 2 });
  assert.deepEqual(run(watcher, 0, 79, wander), ["arrive0"]);
  assert.deepEqual(run(watcher, 79.5, 100, wander), ["stuck0"]);
  assert.deepEqual(run(watcher, 100.5, 180, wander), ["stuck1"]);
  assert.deepEqual(
    run(watcher, 180.5, 250, (now) => ({ ...wander(now), progressKey: `k${Math.floor(now / 30)}` })),
    [],
  );
});

test("틀리기가 2번 · 4번 쌓이면 말을 걸되 사이를 띄운다", () => {
  const watcher = createSituationWatcher();
  const wander = (now: number) => ({ x: 41.5 + Math.sin(now) * 2 });
  run(watcher, 0, 1, wander);
  assert.deepEqual(
    run(watcher, 1.5, 3, (now) => ({ ...wander(now), mistakes: { P03: 2 } })),
    ["wrong0"],
  );
  // 곧바로 4번이 돼도 간격(35초)이 지나야 다시 말한다
  assert.deepEqual(
    run(watcher, 3.5, 30, (now) => ({ ...wander(now), mistakes: { P03: 4 } })),
    [],
  );
  assert.deepEqual(
    run(watcher, 30.5, 45, (now) => ({ ...wander(now), mistakes: { P03: 4 } })),
    ["wrong1"],
  );
});

test("목표에서 멀어진 채 머물면 벗어났다고 하고, 목표로 걸어가는 중이면 하지 않는다", () => {
  const away = createSituationWatcher();
  // 장독대(41.5, 31.9)에서 25m 떨어진 곳을 서성인다
  assert.ok(run(away, 0, 30, (now) => ({ x: 16 + Math.sin(now), z: 32 })).includes("astray0"));

  const approaching = createSituationWatcher();
  // 초속 0.8m 로 장독대를 향해 걸어온다
  const kinds = run(approaching, 0, 30, (now) => ({ x: 10 + now * 0.8, z: 32 }));
  assert.ok(!kinds.some((kind) => kind.startsWith("astray")), kinds.join(","));
});

test("필요한 물건을 내려놓고 9m 넘게 가면 한 번 알리고, 주울 가치가 없는 것은 알리지 않는다", () => {
  const watcher = createSituationWatcher();
  const items = [
    { uid: 1, kind: "rice", x: 41.5, z: 31.9, isDropped: true },
    { uid: 2, kind: "strawShoe", x: 41.5, z: 31.9, isDropped: true },
  ];
  assert.ok(!run(watcher, 0, 2, () => ({ worldItems: items })).includes("dropped0"));
  const kinds = run(watcher, 2.5, 10, (now) => ({ worldItems: items, x: 41.5 + (now - 2) * 2 }));
  assert.equal(kinds.filter((kind) => kind === "dropped0").length, 1);
});

test("퍼즐이 내놓은 물건은 안 줍고 다음 구역으로 넘어갔을 때 물건마다 한 번 알린다", () => {
  const item = [{ uid: 7, kind: "lightFish", x: 24, z: 42.5, isDropped: false }];
  const dock = { objective: "S1_SMOKE" as const, worldItems: item };
  const unpicked = (kinds: string[]) => kinds.filter((kind) => kind === "unpicked0").length;

  const watcher = createSituationWatcher();
  // 같은 구역 안에서는 곁을 지나쳐 멀리 가도 알리지 않는다 — 아직 주우러 올 수 있다
  assert.equal(unpicked(run(watcher, 0, 2, () => ({ ...dock, x: 24.5, z: 42.5 }))), 0);
  assert.equal(unpicked(run(watcher, 2.5, 12, (now) => ({ ...dock, x: 24.5 + (now - 2) * 2, z: 42.5 }))), 0);
  // 목표가 비는 사이(연출 · 이동)는 마지막 구역 그대로다
  assert.equal(unpicked(run(watcher, 12.5, 14, () => ({ ...dock, objective: null, x: 30, z: 39.5 }))), 0);
  // 바위 아래로 넘어갔다 — 한 번. 그 뒤 물굴로 더 가도 되풀이하지 않는다
  assert.equal(unpicked(run(watcher, 14.5, 20, () => ({ worldItems: item, objective: "P03" }))), 1);
  assert.equal(unpicked(run(watcher, 20.5, 26, () => ({ worldItems: item, objective: "C_JAR" }))), 0);

  // 이어 하기 — 처음부터 다른 구역에 남아 있던 물건은 기준일 뿐이다
  const resumed = createSituationWatcher();
  assert.equal(unpicked(run(resumed, 0, 10, () => ({ worldItems: item, objective: "P03" }))), 0);

  // 구역을 알기 전(목표가 서기 전)에 본 물건은 처음 선 목표의 구역을 제 구역으로 삼는다
  const early = createSituationWatcher();
  run(early, 0, 1, () => ({ worldItems: item, objective: null }));
  assert.equal(unpicked(run(early, 1.5, 5, () => ({ worldItems: item, objective: "P11" }))), 0);
});

test("동행이 90초 말이 없으면 먼저 잡담을 걸고, 방금 무슨 일이 있었으면 미룬다", () => {
  const watcher = createSituationWatcher();
  // 할 일이 없는 구간(연출 사이)을 걸어 다닌다
  const stroll = (now: number) => ({ objective: null, x: 20 + Math.sin(now) * 3 });
  assert.deepEqual(run(watcher, 0, 89, stroll), []);
  assert.deepEqual(run(watcher, 89.5, 100, stroll), ["chatter0"]);
  watcher.noteEvent(170);
  assert.deepEqual(run(watcher, 100.5, 259, stroll), []);
  assert.deepEqual(run(watcher, 259.5, 262, stroll), ["chatter1"]);
});

test("헛손질(알림만 뜨는 조작)은 진전이 아니라서 막힘을 미루지 못하지만, 가만히 있는 것으로 치지도 않는다", () => {
  const watcher = createSituationWatcher();
  // 제자리에 서서 5초마다 듣지 않는 것을 건드린다
  const kinds = run(watcher, 0, 200, (now) => ({ activityKey: String(Math.floor(now / 5)) }));
  assert.ok(kinds.includes("stuck0"), kinds.join(","));
  assert.ok(!kinds.some((kind) => kind.startsWith("idle")), kinds.join(","));
});

test("연출 중이거나 걷는 중이 아니면 시간을 세지 않는다", () => {
  const watcher = createSituationWatcher();
  assert.deepEqual(
    run(watcher, 0, 300, () => ({ isBusy: true })),
    [],
  );
  assert.deepEqual(
    run(watcher, 300.5, 600, () => ({ isPlaying: false })),
    [],
  );
});

test("숨이 20초 아래로 떨어지면 한 번 알리고, 다시 찬 뒤에야 · 45초가 지나야 또 알린다(BREATH_LOW 쿨다운 45초)", () => {
  const watcher = createSituationWatcher();
  assert.deepEqual(
    run(watcher, 0, 5, () => ({ breath: 15, objective: null })),
    ["breath0"],
  );
  assert.deepEqual(
    run(watcher, 5.5, 8, () => ({ breath: 60, objective: null })),
    [],
  );
  // 다시 찼어도 45초 안이면 아직 — 떠올랐다 바로 다시 들어가 숨이 줄어도 되풀이하지 않는다
  assert.deepEqual(
    run(watcher, 8.5, 44.5, () => ({ breath: 12, objective: null })),
    [],
  );
  assert.deepEqual(
    run(watcher, 45, 46, () => ({ breath: 12, objective: null })),
    ["breath0"],
  );
  // 같은 낮은 상태 — 다 차지 않은 채(40초 아래) 오르내리는 동안은 45초가 지나도 거듭 알리지 않는다
  assert.deepEqual(
    run(watcher, 46.5, 48, () => ({ breath: 30, objective: null })),
    [],
  );
  assert.deepEqual(
    run(watcher, 48.5, 120, () => ({ breath: 8, objective: null })),
    [],
  );
});

test("물굴 안에서는 잡담을 내지 않고, 물 밖으로 나오면 다시 한다(계약 §10-5)", () => {
  const watcher = createSituationWatcher();
  // 물굴 목표(P08)에 숨이 넉넉한 채 오래 머문다 — 다른 말이 없어도 잡담은 없다
  const inCave = watch(watcher, 0, 300, (now) => ({
    objective: "P08",
    breath: 60,
    progressKey: String(Math.floor(now / 20)),
  }));
  assert.ok(!inCave.some((situation) => situation.kind === "chatter"), inCave.map((s) => s.kind).join(","));
  // 물굴을 나와 능선 목표로 — 잡담이 돌아온다
  const outside = watch(watcher, 300.5, 500, (now) => ({
    objective: "S3_GO",
    x: 69.8,
    z: 20,
    progressKey: String(Math.floor(now / 20)),
  }));
  assert.ok(outside.some((situation) => situation.kind === "chatter" && situation.zone === "ridge"));
});

test("이어 하기로 이미 풀려 있던 퍼즐은 칭찬하지 않고, 새로 풀린 것만 알린다", () => {
  const watcher = createSituationWatcher();
  assert.deepEqual(
    run(watcher, 0, 1, () => ({ completed: new Set<ObjectiveId>(["P01"]), objective: null })),
    [],
  );
  const kinds = run(watcher, 1.5, 2, () => ({ completed: new Set<ObjectiveId>(["P01", "P02"]), objective: null }));
  assert.deepEqual(kinds, ["solved0"]);
});

test("필요한 물건 없이 목표 자리에 머물면 한 번 알리고, 지나가기만 하면 알리지 않는다", () => {
  const offer = { objective: "S2_OFFER" as const, x: 45, z: 37 };
  const passing = createSituationWatcher();
  assert.ok(!run(passing, 0, 4, () => ({ ...offer, heldKinds: ["rice"] })).includes("missing0"));

  const staying = createSituationWatcher();
  const kinds = run(staying, 0, 20, (now) => ({ ...offer, x: 45 + Math.sin(now), heldKinds: ["rice", "makgeolli"] }));
  assert.equal(kinds.filter((kind) => kind === "missing0").length, 1);

  const ready = createSituationWatcher();
  const all = ["lightFish", "rice", "makgeolli"];
  assert.ok(!run(ready, 0, 20, () => ({ ...offer, heldKinds: all })).includes("missing0"));
});

test("목표에서 멀리 서 있기만 하면 벗어났다고 하지 않고, 걸어서 멀어질 때만 센다", () => {
  const isAstray = (kind: string) => kind.startsWith("astray");
  const resting = createSituationWatcher();
  // 장독대(41.5, 31.9)에서 25m 떨어진 곳에 서서 구경한다
  const rested = run(resting, 0, 120, () => ({ x: 16, z: 32 }));
  assert.ok(!rested.some(isAstray), rested.join(","));

  const leaving = createSituationWatcher();
  // 초속 0.8m 로 장독대에서 멀어진다
  assert.ok(run(leaving, 0, 30, (now) => ({ x: 28 - now * 0.8, z: 32 })).includes("astray0"));

  const paused = createSituationWatcher();
  // 10초 걸어 멀어진 뒤 멈춰 선다 — 서 있는 시간은 더하지 않는다
  const stopped = run(paused, 0, 120, (now) => ({ x: 28 - Math.min(now, 10) * 0.8, z: 32 }));
  assert.ok(!stopped.some(isAstray), stopped.join(","));
});

test("숨이 모자란 동안에는 막힘 · 벗어남 · 가만히 있음 · 잡담을 미루고, 숨이 차면 말한다", () => {
  const working = createSituationWatcher();
  const wander = (now: number) => ({ x: 41.5 + Math.sin(now) * 2 });
  assert.deepEqual(
    run(working, 0, 200, (now) => ({ ...wander(now), breath: 12 })),
    ["breath0", "arrive0"],
  );
  assert.ok(run(working, 200.5, 203, (now) => ({ ...wander(now), breath: 60 })).includes("stuck0"));

  const strayed = createSituationWatcher();
  // 목표에서 먼 곳을 서성이다 그대로 서 있다
  const far = (now: number) => ({ x: 16 + Math.sin(Math.min(now, 60)), z: 32, breath: 12 });
  assert.deepEqual(run(strayed, 0, 400, far), ["breath0", "arrive0"]);
});

test("물레에 다 끼운 뜬 돌 · 홈에 끼운 큰 진주 · 저절로 따라올 함은 「없다」고 하지 않는다", () => {
  const unused = { isFloatsSet: false, isPearlSet: false };
  const missingAt = (objective: ObjectiveId, heldKinds: string[], spot = {}) =>
    run(createSituationWatcher(), 0, 20, () => ({ objective, heldKinds, ...spot })).includes("missing0");

  const empty = countedAsHeld({ offered: [], cave: unused, isBoxFollowing: false });
  const fitted = countedAsHeld({ offered: [], cave: { isFloatsSet: true, isPearlSet: true }, isBoxFollowing: false });
  assert.equal(missingAt("P09", empty), true);
  assert.equal(missingAt("P09", fitted), false);
  assert.equal(missingAt("C_SOCKET", empty), true);
  assert.equal(missingAt("C_SOCKET", fitted), false);

  const ridge = { x: 69.8, z: 20 };
  assert.equal(missingAt("S3_GO", empty, ridge), true, "빈자리가 없어 못 따라오는 함은 알린다");
  const following = countedAsHeld({ offered: ["rice"], cave: unused, isBoxFollowing: true });
  assert.equal(missingAt("S3_GO", following, ridge), false);
  assert.ok(following.includes("rice"));
});

test("내려놓은 함은 두고 간다고 하지 않는다 — 다음 구역으로 넘어갈 때 따라온다", () => {
  const watcher = createSituationWatcher();
  const items = [
    { uid: 1, kind: "letterBox", x: 41.5, z: 31.9, isDropped: true },
    { uid: 2, kind: "scale", x: 41.5, z: 31.9, isDropped: true },
  ];
  run(watcher, 0, 2, () => ({ worldItems: items }));
  const told = watch(watcher, 2.5, 10, (now) => ({ worldItems: items, x: 41.5 + (now - 2) * 2 })).flatMap(
    (situation) => (situation.kind === "dropped" ? [situation.item] : []),
  );
  assert.deepEqual(told, ["scale"]);
});

test("상황이 겹치면 한 번에 가장 앞선 하나만 내고, 밀린 물건 · 풀림 · 도착은 다음 차례에 낸다", () => {
  const crowded = createSituationWatcher();
  run(crowded, 0, 0, () => ({}));
  // 장독대를 풀고 배 앞에 섰다 — 숨이 모자라고, 방금 되돌려졌고, 쌀은 멀리 내려놓고 왔다
  const rice = { uid: 1, kind: "rice", x: 10, z: 10, isDropped: true };
  const boat = { objective: "S2_BOTTLE" as const, x: 42.85, z: 43.9, completed: new Set<ObjectiveId>(["P03"]) };
  const kinds = run(crowded, 0.5, 5, () => ({ ...boat, worldItems: [rice], breath: 12, sentBackCount: 1 }));
  assert.deepEqual(kinds, ["breath0", "sentBack0", "dropped0", "solved0", "arrive0"]);

  // 실수 · 풀림 · 도착이 한꺼번에 — 실수가 앞서고, 풀림의 맞장구가 다음 걸음 설명보다 먼저다
  const cave = createSituationWatcher();
  run(cave, 0, 0, () => ({ objective: "P07" }));
  const next = { objective: "P08" as const, completed: new Set<ObjectiveId>(["P07"]), mistakes: { P08: 2 } };
  assert.deepEqual(
    run(cave, 0.5, 5, () => next),
    ["wrong0", "solved0", "arrive0"],
  );

  // 두고 온 물건이 둘이면 내려놓은 것부터 하나씩 알린다
  const forgetful = createSituationWatcher();
  const fish = { uid: 2, kind: "lightFish", x: 41.5, z: 31.9, isDropped: false };
  const dropped = { uid: 3, kind: "makgeolli", x: 41.5, z: 31.9, isDropped: true };
  run(forgetful, 0, 1, () => ({ worldItems: [fish, dropped] }));
  // 둘을 두고 물굴로 넘어갔다
  const left = watch(forgetful, 1.5, 4, () => ({ worldItems: [fish, dropped], objective: "C_JAR", x: 60 })).flatMap(
    (situation) =>
      situation.kind === "dropped" || situation.kind === "unpicked" ? [`${situation.kind}:${situation.item}`] : [],
  );
  assert.deepEqual(left, ["dropped:makgeolli", "unpicked:lightFish"]);
});

test("풀림은 연출이 도는 동안 내지 않고 끝난 뒤에 낸다", () => {
  const watcher = createSituationWatcher();
  run(watcher, 0, 1, () => ({ objective: null }));
  const solved = { objective: null, completed: new Set<ObjectiveId>(["P05"]) };
  assert.deepEqual(
    run(watcher, 1.5, 5, () => ({ ...solved, isBusy: true })),
    [],
  );
  assert.deepEqual(
    run(watcher, 5.5, 7, () => solved),
    ["solved0"],
  );
});

test("숨이 다해 되돌려지면 그때마다 한 번 알리고, 몇 번째인지를 값으로 싣는다", () => {
  const watcher = createSituationWatcher();
  const cave = { objective: null, breath: 60 };
  assert.deepEqual(
    run(watcher, 0, 2, () => cave),
    [],
  );
  assert.deepEqual(
    run(watcher, 2.5, 4, () => ({ ...cave, sentBackCount: 1 })),
    ["sentBack0"],
  );
  // 두 번째는 읽는 창이 떠 있을 때 일어났다 — 창을 닫은 뒤에 나온다
  assert.deepEqual(
    run(watcher, 4.5, 6, () => ({ ...cave, sentBackCount: 2, isBusy: true })),
    [],
  );
  const [again] = watch(watcher, 6.5, 8, () => ({ ...cave, sentBackCount: 2 }));
  assert.equal(again.kind, "sentBack");
  assert.deepEqual(toSituationPayload(again), { code: "SENT_BACK", value: 2 });
});

test("잡담에는 지금 구역을 싣고, 목표가 비는 사이에는 마지막으로 있던 구역으로 본다", () => {
  const watcher = createSituationWatcher();
  run(watcher, 0, 1, () => ({ objective: "P05" }));
  // 기우제 퍼즐을 끝내고 다음 목표가 서기 전(비 내리는 연출 뒤) — 목표 없이 걸어 다닌다
  const [chatter] = watch(watcher, 1.5, 100, (now) => ({ objective: null, x: 20 + Math.sin(now) * 3 }));
  assert.equal(chatter.kind, "chatter");
  assert.deepEqual(toSituationPayload(chatter), { code: "QUIET", zone: "rock" });
  // 구역은 잡담에만 싣는다
  assert.deepEqual(toSituationPayload({ kind: "arrive", objective: "P08", step: 0 }), { code: "STEP_ARRIVED" });
});

// ── 게임 상태 읽기(물굴 진행 · 안내판) ──

const CAVE_START: CaveProgress = {
  isJarTilted: false,
  isLightSolved: false,
  isBurrowsSolved: false,
  isFloatsSet: false,
  isDoorOpen: false,
  isChamberSolved: false,
  isPearlSet: false,
};

test("물굴의 다음 할 일은 아직 안 한 것 가운데 가장 앞선 것이고, 문이 열린 뒤에는 석실 쪽이다", () => {
  assert.equal(nextCaveObjective(CAVE_START), "C_JAR");
  assert.equal(nextCaveObjective({ ...CAVE_START, isJarTilted: true }), "P07");
  assert.equal(nextCaveObjective({ ...CAVE_START, isJarTilted: true, isLightSolved: true }), "P08");
  const gathered = { ...CAVE_START, isJarTilted: true, isLightSolved: true, isBurrowsSolved: true };
  assert.equal(nextCaveObjective(gathered), "P09");
  // 독을 건너뛰고 뒤의 것부터 풀었으면 남은 독이 다음이다
  assert.equal(nextCaveObjective({ ...CAVE_START, isLightSolved: true, isBurrowsSolved: true }), "C_JAR");
  // 문이 열렸으면 큰 방에 안 푼 것이 남아 있어도 고리문 · 큰 방 퍼즐로 돌아가지 않는다
  assert.equal(nextCaveObjective({ ...CAVE_START, isDoorOpen: true }), "P10");
  assert.equal(nextCaveObjective({ ...gathered, isDoorOpen: true, isChamberSolved: true }), "C_SOCKET");
  assert.equal(nextCaveObjective({ ...gathered, isDoorOpen: true, isChamberSolved: true, isPearlSet: true }), null);
});

test("물굴 퍼즐의 풀림은 저장 기록의 진행으로 읽는다", () => {
  assert.deepEqual(caveCompleted(CAVE_START), []);
  assert.deepEqual(caveCompleted({ ...CAVE_START, isLightSolved: true, isDoorOpen: true }), ["P07", "P09"]);
  const all = { ...CAVE_START, isJarTilted: true, isLightSolved: true, isBurrowsSolved: true };
  assert.deepEqual(caveCompleted({ ...all, isDoorOpen: true, isChamberSolved: true, isPearlSet: true }), [
    "C_JAR",
    "P07",
    "P08",
    "P09",
    "P10",
    "C_SOCKET",
  ]);
});

const lightPanel = (count: number, clam = "꼭 다물고 있다") => ({
  title: "진주 빛 잇기",
  rows: [
    { label: "이어진 조개", value: `${count} / 4` },
    { label: "큰 조개", value: clam },
  ],
});

test("안내판의 수는 전에 없이 오를 때만 진전이고, 오르내림 · 상태 표시는 진전이 아니다", () => {
  const reader = createPanelReader();
  reader.read(lightPanel(1));
  assert.equal(reader.gain(), 0, "처음 본 수는 기준일 뿐이다");
  reader.read(lightPanel(2));
  assert.equal(reader.gain(), 1);
  reader.read(lightPanel(1));
  reader.read(lightPanel(2));
  reader.read(lightPanel(2, "빛이 닿았다!"));
  assert.equal(reader.gain(), 1, "줄었다 도로 오른 것 · 글만 바뀐 것");
  reader.read(lightPanel(3));
  assert.equal(reader.gain(), 2);

  reader.read({ title: "바위 홈", rows: [{ label: "손에 든 것", value: "빈손" }] });
  reader.read({ title: "바위 홈", rows: [{ label: "손에 든 것", value: "큰 진주" }] });
  reader.read(null);
  assert.equal(reader.gain(), 2);
  // 글 뒤에 붙은 수도 읽는다
  reader.read({ title: "물레 고리문", rows: [{ label: "물레", value: "뜬 돌 1/4" }] });
  reader.read({ title: "물레 고리문", rows: [{ label: "물레", value: "뜬 돌 2/4" }] });
  assert.equal(reader.gain(), 3);
});

test("수가 줄어 틀린 것으로 치는 것은 처음부터 다시 하는 퍼즐뿐이다 — 빛이 지나쳤다 돌아오는 것은 실수가 아니다", () => {
  const reader = createPanelReader();
  reader.read(lightPanel(3));
  assert.equal(reader.read(lightPanel(1)), null);

  const stumps = (count: number) => ({
    title: "통나무 걸상",
    rows: [{ label: "빛이 든 새김", value: `${count} / 5` }],
  });
  reader.read(stumps(2));
  assert.equal(reader.read(stumps(0)), "P13");
  assert.equal(reader.read(stumps(1)), null);

  // 물고기 굴 — 따라 한 차례는 다시 볼 때마다 0 으로 돌아간다. 맞춘 판이 줄 때만 틀림이다
  const burrows = (rounds: number, taps: number) => ({
    title: "물고기 굴",
    rows: [
      { label: "맞춘 판", value: `${rounds} / 3` },
      { label: "따라 한 차례", value: `${taps} / 4` },
    ],
  });
  reader.read(burrows(1, 3));
  assert.equal(reader.read(burrows(1, 0)), null);
  assert.equal(reader.read(burrows(0, 0)), "P08");
});

test("감지한 상황은 계약의 상황 코드로 바뀌고, 수치는 있을 때만 싣는다", () => {
  assert.deepEqual(toSituationPayload({ kind: "breath", objective: "P09", step: 0 }, 12.4), {
    code: "BREATH_LOW",
    value: 12,
  });
  assert.deepEqual(toSituationPayload({ kind: "astray", objective: "P03", step: 1 }), { code: "OFF_OBJECTIVE" });
  // 서버가 판정하는 퍼즐의 실수 · 진전 없음은 서버 자동 개입에 맡긴다. 화면 판정 퍼즐 · 걸음은 보낸다
  assert.equal(toSituationPayload({ kind: "wrong", objective: "P10", step: 0 }), null);
  assert.equal(toSituationPayload({ kind: "stuck", objective: "P03", step: 0 }), null);
  assert.deepEqual(toSituationPayload({ kind: "wrong", objective: "P08", step: 0 }, 2), {
    code: "REPEATED_MISTAKE",
    value: 2,
  });
  assert.deepEqual(toSituationPayload({ kind: "stuck", objective: "S2_OFFER", step: 0 }), { code: "NO_PROGRESS" });
  assert.deepEqual(toSituationPayload({ kind: "missing", objective: "S2_OFFER", step: 0, item: "rice" }), {
    code: "ITEM_MISSING",
  });
  for (const code of Object.values(SITUATION_CODES)) assert.match(code, /^[A-Z][A-Z_]+$/);
  assert.equal(new Set(Object.values(SITUATION_CODES)).size, 11);
});

test("풀림은 걸음 · 화면 판정 퍼즐만 보내고, 서버가 판정하는 퍼즐의 풀림은 보내지 않는다", () => {
  for (const id of Object.keys(OBJECTIVES) as ObjectiveId[]) {
    const payload = toSituationPayload({ kind: "solved", objective: id, step: 0 });
    if (SERVER_JUDGED.has(id)) assert.equal(payload, null, id);
    else assert.deepEqual(payload, { code: "STEP_DONE" }, id);
  }
  // 걸음 · 화면 판정 퍼즐은 실수 · 진전 없음도 보낸다
  assert.deepEqual(toSituationPayload({ kind: "idle", objective: "P11", step: 0 }), { code: "NO_PROGRESS" });
  assert.equal(toSituationPayload({ kind: "overtime", objective: "P12", step: 0 }), null);
});

// ── 대사 고르기 ──

function directorWith(guide: string | null = null) {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 200 });
  const director = createDirector({ store, guideOf: () => guide });
  return { store, director, timers };
}

test("힌트는 청할 때마다 한 칸씩 더 구체적으로 답하고, 다 들으면 처음으로 돌아간다", () => {
  const { store, director } = directorWith();
  const heard: string[] = [];
  for (let ask = 0; ask < 5; ask++) {
    director.help("P01");
    heard.push(store.getState()!.speech.text);
    while (store.advance());
  }
  const help = ownLines("P01", "help").map((line) => line.text);
  assert.deepEqual(heard.slice(0, 3), help);
  assert.match(heard[3], /여기까지|하나씩 다시/);
  assert.equal(heard[4], help[0]);
});

test("[F] 로 말을 걸면 보기가 뜨고, 「여기서 뭘 해야 해요?」는 안내판 설명으로 답한다", async () => {
  const { store, director } = directorWith("굴 넷에 물고기들이 숨어 있다.");
  void director.openMenu("P08");
  const menu = store.getState()!.speech;
  assert.equal(menu.kind, "ask");
  assert.equal(menu.freeCursor, true);
  // 베타는 존댓말 한 벌 — 말투 바꾸기 보기는 없다
  assert.deepEqual(
    menu.choices!.map((choice) => choice.id),
    ["what", "hint", "close"],
  );
  store.answer("what");
  await Promise.resolve();
  assert.equal(store.getState()?.speech.kind, "guide");
  assert.equal(store.getState()?.speech.text, "굴 넷에 물고기들이 숨어 있다.");
  assert.equal(store.getState()?.speech.asked, "여기서 뭘 해야 해요?");
});

test("안내판도 첫 설명 대사도 없는 목표는 「여기서 뭘 해야 해요?」에 무엇을 하는 곳인지 한 줄로 답한다", async () => {
  const panelled = new Set(Object.values(PANEL_OBJECTIVE));
  const bare = (Object.keys(OBJECTIVES) as ObjectiveId[]).filter(
    (id) => !panelled.has(id) && !ownLines(id, "arrive").length,
  );
  // 안내판 설명 · 첫 설명 대사와 겹치지 않게, 둘 다 없는 목표에만 둔다
  assert.deepEqual(Object.keys(WHAT_TO_DO).sort(), [...bare].sort());
  assert.equal(bare.length, 7);

  for (const id of bare) {
    const { store, director } = directorWith();
    void director.openMenu(id);
    assert.deepEqual(
      store.getState()!.speech.choices!.map((choice) => choice.id),
      ["what", "hint", "close"],
      id,
    );
    store.answer("what");
    await Promise.resolve();
    const { speech } = store.getState()!;
    assert.equal(speech.kind, "guide");
    assert.equal(speech.asked, "여기서 뭘 해야 해요?");
    // 할 일의 이름까지만 — 조작 키나 도움말(힌트)의 말을 미리 하지 않는다
    assert.ok(!/\[[A-Z]\]/.test(speech.text), `${id}: ${speech.text}`);
    assert.ok(!ownLines(id, "help").some((line) => line.text === speech.text), id);
  }
  const listed = allLines().filter((line) => line.kind === "what");
  assert.ok(listed.length > 0 && listed.every((line) => line.category === "FE 문구"));
});

test("보기에서 힌트를 고르면 그 퍼즐의 도움말을 주고, 「괜찮아요」는 조용히 닫는다", async () => {
  const { store, director } = directorWith();
  void director.openMenu("P03");
  store.answer("hint");
  await Promise.resolve();
  assert.equal(store.getState()?.speech.text, ownLines("P03", "help")[0].text);
  while (store.advance());
  void director.openMenu("P03");
  assert.equal(store.getState()!.speech.choices![1].label, "힌트를 더 주세요");
  store.answer("close");
  await Promise.resolve();
  assert.equal(store.getState(), null);
});

test("한참 못 풀면 힌트를 바로 주지 않고 도울지 먼저 묻고, 「네」일 때만 도움말을 준다", async () => {
  const { store, director } = directorWith();
  director.handle({ kind: "stuck", objective: "P01", step: 0 });
  const ask = store.getState()!;
  assert.equal(ask.speech.kind, "ask");
  assert.match(ask.speech.text, /도와 드릴까요\?$/);
  assert.ok(
    !ownLines("P01", "help").some((line) => ask.speech.text.includes(line.text)),
    "물음에 풀이가 섞이지 않는다",
  );
  store.answer("yes");
  await Promise.resolve();
  assert.equal(store.getState()?.speech.text, ownLines("P01", "help")[0].text);
  assert.equal(store.getState()?.speech.asked, "네, 알려 주세요");
});

test("도움말은 지금 해 놓은 단계에 맞는 것부터 주고, 같은 단계에서 또 청하면 다음 칸으로 간다", () => {
  const timers = fakeTimers();
  const store = createDialogueStore({ ...timers, capacity: 200 });
  let load = "none";
  const director = createDirector({
    store,
    guideOf: () => null,
    phaseHint: () => (load === "none" ? { kind: "help", index: 0 } : { kind: "stuck", index: 0 }),
  });
  director.help("P11", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, ownLines("P11", "help")[0].text);
  while (store.advance());
  load = "jigeChest";
  director.help("P11", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, ownLines("P11", "stuck")[0].text, "궤를 진 뒤에는 그 단계의 말");
});

test("첫 설명 단계에 따로 써 둔 첫 대사가 없으면 안내판 설명으로 답한다", () => {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 200 });
  const guide = "젖은 모래에 숨구멍이 여럿 있어요.";
  const director = createDirector({ store, guideOf: () => guide, phaseHint: () => ({ kind: "arrive", index: 0 }) });
  assert.equal(ownLines("P01", "arrive").length, 0);
  director.help("P01", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, guide);
  while (store.advance());
  // 같은 단계에서 또 청하면 도움말 사다리로 간다
  director.help("P01", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, ownLines("P01", "help")[0].text);
});

test("동행이 먼저 건 말은 같은 말을 곧바로 되풀이하지 않는다", () => {
  const { store, director } = directorWith();
  director.handle({ kind: "arrive", objective: "P03", step: 0 });
  assert.equal(store.getState()?.speech.text, ownLines("P03", "arrive")[0].text);
  while (store.advance());
  director.handle({ kind: "arrive", objective: "P03", step: 0 });
  assert.equal(store.getState(), null);
});

test("퍼즐을 풀면 짧은 맞장구를 돌려 가며 하고, 걸음에는 하지 않는다", () => {
  const { store, director } = directorWith();
  const heard: string[] = [];
  for (const objective of ["P03", "P05"] as const) {
    director.handle({ kind: "solved", objective, step: 0 });
    heard.push(store.getState()!.speech.lineId!);
    while (store.advance());
  }
  assert.deepEqual(heard, [rotateGeneral("solved", 0)!.id, rotateGeneral("solved", 1)!.id]);
  assert.notEqual(heard[0], heard[1]);
  // 맞장구가 몇 줄이든 차례가 끝나면 처음으로 돌아온다
  assert.equal(rotateGeneral("solved", DRAFT_GENERAL_LINES.solved.length)!.id, heard[0]);
  director.handle({ kind: "solved", objective: "S2_STONES", step: 0 });
  assert.equal(store.getState(), null);
});

test("하나를 더 해내면 남은 수를 말해 주고, 잡담에는 퍼즐 이름을 달지 않는다", () => {
  const { store, director } = directorWith();
  director.progress("P01", 2);
  assert.match(store.getState()!.speech.text, /둘/);
  store.advance();
  director.progress("P01", 1);
  assert.match(store.getState()!.speech.text, /하나/);
  store.advance();
  director.handle({ kind: "chatter", objective: "P01", step: 15, zone: "dock" });
  assert.equal(store.getState()!.speech.topic, undefined);
  assert.equal(store.getState()!.speech.text, pickChatter(15, "dock")!.text);
});

test("잡담은 지금 있는 구역의 것만 돌려 쓴다 — 물속에서 강바람 이야기를 하지 않는다", () => {
  const heard = (stage: "dock" | "rock" | "cave" | "ridge") =>
    Array.from({ length: 60 }, (_, turn) => pickChatter(turn, stage)!.id);
  assert.ok(heard("cave").some((id) => id.includes("CHATTER_CAVE")));
  assert.ok(!heard("cave").some((id) => /CHATTER_(NAJU|DOCK|ROCK|RIDGE)/.test(id)));
  assert.ok(heard("dock").some((id) => id.includes("CHATTER_DOCK")));
  assert.ok(!heard("dock").some((id) => /CHATTER_(CAVE|ROCK|RIDGE)/.test(id)));
  // 한 바퀴 도는 동안 같은 말이 연달아 나오지 않는다
  const ridge = heard("ridge");
  assert.ok(ridge.every((id, turn) => turn === 0 || id !== ridge[turn - 1]));
});

test("잡담은 판정이 일러 준 구역의 것으로 고른다", () => {
  const { store, director } = directorWith();
  director.handle({ kind: "chatter", objective: null, step: 1, zone: "cave" });
  assert.match(store.getState()!.speech.lineId!, /CHATTER_CAVE/);
});

test("물건을 두고 가면 알려 주되 물건 이름은 말하지 않는다", () => {
  const { store, director } = directorWith();
  director.handle({ kind: "dropped", objective: "P05", step: 0, item: "rice", uid: 3 });
  assert.match(store.getState()!.speech.text, /두고 오신 게 있어요/);
  assert.ok(!store.getState()!.speech.text.includes("쌀"));
});

test("숨 경고는 알림 · 물음이 떠 있어도 줄 서지 않고 바로 나오고, 방금 했어도 다시 한다", async () => {
  const { store, director } = directorWith();
  const warning = pickLine(null, "breath", 0)!.text;
  store.say({ kind: "notice", text: "복어 가시에 찔렸다." });
  director.handle({ kind: "breath", objective: "P09", step: 0 });
  assert.equal(store.getState()?.speech.text, warning);
  while (store.advance());

  director.handle({ kind: "stuck", objective: "P09", step: 0 });
  assert.equal(store.getState()?.speech.kind, "ask");
  director.handle({ kind: "breath", objective: "P09", step: 0 });
  assert.equal(store.getState()?.speech.text, warning);
});

test("되돌려짐의 말은 방금 뜬 되돌려짐 알림 자리에 들어서고, 다른 말이 떠 있어도 줄 서지 않는다", () => {
  const { store, director } = directorWith();
  // 게임이 띄운 알림 — 화면 쪽(dialogueRuntime)이 같은 key 를 달아 올린다
  const notice = GAME_VOICE.find(([source]) => source.startsWith(SENT_BACK_NOTICE))![1];
  store.say({ kind: "notice", text: notice, key: SENT_BACK_KEY });
  director.handle({ kind: "sentBack", objective: "P09", step: 0 });
  assert.equal(store.getState()?.speech.text, pickLine(null, "sentBack", 0)!.text);
  assert.equal(store.queueLength(), 0, "같은 소식의 알림이 뒤에 다시 나오지 않는다");
  while (store.advance());

  // 그 알림이 이미 다른 알림에 밀려났어도 바로 뜨고, 밀려난 알림은 뒤에 돌아온다. 되풀이되면 다음 칸
  store.say({ kind: "notice", text: "복어 가시에 찔렸어요." });
  director.handle({ kind: "sentBack", objective: "P09", step: 1 });
  assert.equal(store.getState()?.speech.text, pickLine(null, "sentBack", 1)!.text);
  assert.notEqual(pickLine(null, "sentBack", 0)!.text, pickLine(null, "sentBack", 1)!.text);
  store.advance();
  assert.equal(store.getState()?.speech.text, "복어 가시에 찔렸어요.");
});

test("되돌려짐을 알아채는 알림 문장이 게임과 동행 말투 표에 그대로 있다", () => {
  const { notices } = listGameTexts();
  assert.ok(notices.some((entry: { text: string }) => entry.text.startsWith(SENT_BACK_NOTICE)));
  assert.ok(GAME_VOICE.some(([source]) => source.startsWith(SENT_BACK_NOTICE)));
});

test("정식 힌트 창구가 있으면 넛지를 다 쓴 뒤 열지 묻고, 수락해야만 연다", async () => {
  const { store, director } = directorWith();
  let opened = 0;
  director.setHintProvider({
    canOpen: () => true,
    async open() {
      opened += 1;
      // 힌트 글은 서버 쪽 대화가 대화창에 올린다(companionBridge) — 여기서는 그 자리를 흉내 낸다
      store.say({ kind: "hint", text: "서버가 준 힌트" });
      return true;
    },
  });
  for (let ask = 0; ask < 3; ask++) {
    director.help("P01");
    while (store.advance());
  }
  director.help("P01");
  assert.equal(store.getState()?.speech.kind, "ask");
  assert.equal(opened, 0);
  store.answer("yes");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  assert.equal(store.getState()?.speech.kind, "hint");
  assert.equal(store.getState()?.speech.text, "서버가 준 힌트");
});

// ── 퍼즐 문장을 동행의 말로 ──

test("퍼즐 알림은 표에서 찾아 지금 말투로 말하고, 바뀌는 자리(수 · 이름)는 그대로 채운다", () => {
  setTone("polite");
  assert.equal(inCompanionVoice("빈 통발이다. 물만 줄줄 흐른다."), "빈 통발이네요. 물만 줄줄 흘러요.");
  assert.match(inCompanionVoice("쌀을 챙겼다. [I] 소지품"), /^쌀을 챙겼어요/);
  setTone("casual");
  assert.match(inCompanionVoice("쌀을 챙겼다. [I] 소지품"), /^쌀을 챙겼어\./);
  setTone("polite");
  assert.equal(inCompanionVoice("표에 없는 문장이다."), "표에 없는 문장이다.");
});

// 게임 알림은 동행이 따라 말하지 않는다(새 main 위 통합, Codex 01회차) — 동행 말투로 옮기는 것은 [F] 「여기서 뭘 해야 해요?」의
// 대답(안내판 설명)뿐이다. 목표표(objectives)가 있는 1~3스테이지 안내판만 본다 — 4 · 5스테이지(cliff · gut)는 목표표 밖이다
test("동행이 대답으로 읽는 안내판 설명은 모두 동행 말투 표에 있다(목표표 밖 4 · 5스테이지는 뺀다)", () => {
  const { guides } = listGameTexts();
  const sample = (text: string) => text.replace(/\{(\d+)\}/g, "3");
  const missing = guides
    .filter((entry) => !/^puzzles\/(cliff|gut)\//.test(entry.file) && entry.file !== "puzzles/PuzzlePanelHud.tsx")
    .filter((entry) => !hasCompanionVoice(sample(entry.text)));
  assert.deepEqual(
    missing.map((entry) => `${entry.file}: ${entry.text.slice(0, 40)}`),
    [],
  );
});

test("옮긴 말은 「~다.」「~까?」로 끝나는 딱딱한 말투를 쓰지 않고, 키 표시와 바뀌는 자리를 빠뜨리지 않는다", () => {
  for (const [source, polite, casual] of GAME_VOICE) {
    for (const line of [polite, casual]) {
      assert.ok(
        !/(습니다|입니다|한다|이다|있다|없다|었다|았다|ㄴ다|는다|니까)[.!?…]*$/.test(line.trim()),
        `${source.slice(0, 20)} → ${line}`,
      );
      for (const slot of source.match(/\{\d+\}/g) ?? []) assert.ok(line.includes(slot), `${slot} 빠짐: ${line}`);
      for (const key of source.match(/\[[A-Z0-9]\]/g) ?? []) assert.ok(line.includes(key), `${key} 빠짐: ${line}`);
    }
  }
});

// ── 배포판: 초안 대사는 미리 보기에서만(계약 v0.4.16 §9) ──

/** 배포판 director — 초안(넛지 · 상황 대사 · 잡담)을 내지 않는다 */
function releaseDirector(guide: string | null = null) {
  const store = createDialogueStore({ ...fakeTimers(), capacity: 200 });
  const director = createDirector({ store, guideOf: () => guide, showDraftLines: false });
  return { store, director };
}

test("초안 대사(퍼즐 넛지 · 상황 대사 · 잡담)만 isDraft 이고, 대화 진행 문구 · 「여기서 뭘 해야 해요?」 대답은 아니다", () => {
  assert.equal(pickLine("P01", "help", 0)!.isDraft, true);
  assert.equal(pickLine(null, "breath", 0)!.isDraft, true);
  assert.equal(pickChatter(0, "dock")!.isDraft, true);
  assert.equal(rotateGeneral("solved", 0)!.isDraft, true);
  for (const kind of ["menu", "greet", "helpEnd", "offerHelp", "progress", "pinched", "firstItem"] as const)
    assert.equal(rotateGeneral(kind, 0)!.isDraft, false, kind);
  for (const id of Object.keys(WHAT_TO_DO) as ObjectiveId[]) {
    assert.equal(whatToDo(id)!.isDraft, false, id);
    assert.ok(
      ownLines(id, "help").every((line) => line.isDraft),
      `${id} 걸음 도움말은 초안`,
    );
  }
});

test("배포판에서는 상황이 생겨도 초안 대사를 내지 않는다 — 도착 · 풀림 · 잡담 · 숨 · 물건 · 벗어남", () => {
  const { store, director } = releaseDirector();
  const situations: Situation[] = [
    { kind: "arrive", objective: "P03", step: 0 },
    { kind: "solved", objective: "P05", step: 0 },
    { kind: "chatter", objective: null, step: 0, zone: "dock" },
    { kind: "breath", objective: "P09", step: 0 },
    { kind: "sentBack", objective: "P09", step: 0 },
    { kind: "dropped", objective: "P05", step: 0, item: "rice", uid: 1 },
    { kind: "astray", objective: "P03", step: 0 },
    { kind: "idle", objective: "P03", step: 0 },
    // 「도와 드릴까요?」도 배포판에서는 묻지 않는다 — 개입 판단은 BE(v0.4.7 · v0.4.16 §1)
    { kind: "stuck", objective: "P03", step: 0 },
    { kind: "wrong", objective: "P08", step: 0 },
    { kind: "overtime", objective: "P01", step: 0 },
  ];
  for (const situation of situations) director.handle(situation);
  assert.equal(store.getState(), null);
  assert.equal(store.queueLength(), 0);
  // 정식 힌트를 열 수 있어도(서버 퍼즐 ID · 세션 준비) 동행이 먼저 묻지 않는다 — 서버가 권하면 그때 묻는다(askOpenHint)
  director.setHintProvider({ canOpen: () => true, open: async () => true });
  for (const situation of situations) director.handle(situation);
  assert.equal(store.getState(), null);
  assert.equal(store.queueLength(), 0);
});

test("배포판에서도 FE 문구는 그대로 — 남은 수 · 인사 · [F] 보기 · 안내판 설명 · 「여기서 뭘 해야 해요?」 대답", async () => {
  const { store, director } = releaseDirector("굴 넷에 물고기들이 숨어 있다.");
  director.progress("P01", 2);
  assert.match(store.getState()!.speech.text, /둘/);
  while (store.advance());
  void director.begin("polite");
  assert.equal(store.getState()!.speech.text, rotateGeneral("greet", 0)!.text);
  while (store.advance());
  void director.openMenu("P08");
  // 정식 힌트를 열 수 없는 동안 「힌트를 주세요」는 숨는다(눌러 봐야 「받을 수 없어요」뿐이다)
  assert.deepEqual(
    store.getState()!.speech.choices!.map((choice) => choice.id),
    ["what", "close"],
  );
  store.answer("what");
  await Promise.resolve();
  assert.equal(store.getState()?.speech.text, "굴 넷에 물고기들이 숨어 있다.");
  while (store.advance());

  // 안내판이 없고 첫 설명이 초안뿐인 목표는 「여기서 뭘 해야 해요?」 보기가 빠진다 — 초안을 대답으로 내지 않는다.
  // 힌트도 열 수 없으면 고를 것이 「괜찮아요」뿐이라 보기 없이 받을 수 없다고만 한다
  const bare = releaseDirector();
  void bare.director.openMenu("P03");
  assert.equal(bare.store.getState()!.speech.kind, "line");
  assert.equal(bare.store.getState()!.speech.text, HINT_UNAVAILABLE);
  bare.director.setHintProvider({ canOpen: (objective) => objective === "P03", open: async () => true });
  while (bare.store.advance());
  void bare.director.openMenu("P03");
  assert.deepEqual(
    bare.store.getState()!.speech.choices!.map((choice) => choice.id),
    ["hint", "close"],
  );
  // 목표표 밖(4 · 5스테이지)에서는 「걸리는 게 없다」고 하지 않는다
  const outside = releaseDirector();
  void outside.director.openMenu(null);
  assert.equal(outside.store.getState()!.speech.text, HINT_UNAVAILABLE);
  // 첫 설명이 FE 문구(WHAT_TO_DO)인 목표는 그대로 답한다
  const step = releaseDirector();
  void step.director.openMenu("S2_OFFER");
  step.store.answer("what");
  await Promise.resolve();
  assert.equal(step.store.getState()?.speech.text, whatToDo("S2_OFFER")!.text);
});

test("배포판의 「힌트를 주세요」 — 정식 힌트를 열 수 없으면 초안 넛지 대신 FE 고정 문구 하나, 열 수 있으면 열지 묻는다", async () => {
  const { store, director } = releaseDirector();
  director.help("P01", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, HINT_UNAVAILABLE);
  assert.equal(store.getState()?.speech.asked, "힌트를 주세요");
  assert.ok(!ownLines("P01", "help").some((line) => line.text === store.getState()?.speech.text));
  while (store.advance());

  let opened = 0;
  director.setHintProvider({
    canOpen: (objective) => objective === "P01",
    async open() {
      opened += 1;
      return false;
    },
  });
  director.help("P01", "힌트를 주세요");
  assert.equal(store.getState()?.speech.kind, "ask", "정식 힌트는 잔액이 줄어 먼저 묻는다");
  store.answer("yes");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, 1);
  // 보내지 못했으면 FE 고정 문구로 끝낸다
  assert.equal(store.getState()?.speech.text, HINT_UNAVAILABLE);
  // 걸음(서버 퍼즐이 아님)은 정식 힌트가 없다
  while (store.advance());
  director.help("S2_OFFER", "힌트를 주세요");
  assert.equal(store.getState()?.speech.text, HINT_UNAVAILABLE);
});

// ── 운영 번들에 초안이 없다(previewMode — VITE_NPC_PREVIEW 동적 import) ──

test("초안 파일(draftLines)은 미리 보기의 동적 import 로만 불리고, 늘 실리는 lines.ts 에는 FE 문구만 남는다", () => {
  const SRC = new URL("../src/", import.meta.url);
  const files = (dir: URL): URL[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(new URL(`${entry.name}/`, dir))
        : /\.tsx?$/.test(entry.name)
          ? [new URL(entry.name, dir)]
          : [],
    );
  const importers = files(SRC)
    .filter((file) => !file.pathname.endsWith("/draftLines.ts"))
    .filter((file) => /(from\s*|import\(\s*)["'][^"']*draftLines/.test(readFileSync(file, "utf8")))
    .map((file) => file.pathname.slice(SRC.pathname.length));
  assert.deepEqual(importers, ["dialogue/previewMode.ts"]);
  const preview = readFileSync(new URL("dialogue/previewMode.ts", SRC), "utf8");
  assert.match(preview, /import\("\.\/draftLines\.ts"\)/, "정적 import 가 아니라 동적 import");
  assert.doesNotMatch(preview, /^import .*draftLines/m);
  for (const kind of Object.keys(GENERAL_LINES)) assert.equal(categoryOf("GENERAL", kind), "FE 문구", kind);
});
