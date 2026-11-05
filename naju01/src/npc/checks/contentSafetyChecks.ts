// AI 대사 콘텐츠 안전성 검사 (P 묶음) — ⚠ 검사 전용 가상 콘텐츠(TEST_DIALOGUE_CATALOG)만 쓴다. 실제 나주 데이터가 아니다. 비동기.
import { AI_PROVIDER_CONFIG, type AiDialogueTransport } from "../aiDialogueProvider";
import { createNpcBehaviorStore } from "../behaviorState";
import { NAJU_DIALOGUE_CATALOG } from "../dialogueContent";
import {
  CONTENT_POLICY_CONFIG,
  createSafeAiDialogueProvider,
  evaluateDialogueContent,
  type ContentVerdict,
} from "../dialogueContentPolicy";
import { TEST_DIALOGUE_CATALOG } from "../dialogueContentTestCatalog";
import { createDialogSession } from "../dialogSession";
import { createMockAiTransport } from "../mockAiTransport";
import { createScriptedDialogueProvider, PLACEHOLDER_DIALOGUE, type NpcDialogueContext } from "../npcDialogue";
import { buildSafetyCases, stateInput } from "./contentSafetyScenarios";
import type { NpcCheckOutput } from "./npcChecks";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runContentSafetyChecks(): Promise<NpcCheckOutput> {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "P 콘텐츠 안전성 (가상 콘텐츠)";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  // ── 평가셋: strict(게임 기본) · screen(평가용 자유 문장 대조) ──
  const cases = buildSafetyCases();
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const verdictOk = (v: ContentVerdict, exp: { allow: boolean; reasons?: string[] }) =>
    v.allow === exp.allow && (v.allow || sameSet(v.reasons, exp.reasons ?? []));
  const rows: { id: string; item: number; strict: string; screen: string; ok: boolean; miss: boolean }[] = [];
  for (const c of cases) {
    const strict = evaluateDialogueContent(
      c.candidate,
      c.intent,
      c.input,
      TEST_DIALOGUE_CATALOG,
      CONTENT_POLICY_CONFIG,
    );
    const screen = evaluateDialogueContent(c.candidate, c.intent, c.input, TEST_DIALOGUE_CATALOG, {
      ...CONTENT_POLICY_CONFIG,
      allowFreeText: true,
    });
    const show = (v: ContentVerdict) => (v.allow ? `허용(${v.source})` : `차단[${v.reasons.join(",")}]`);
    rows.push({
      id: c.id,
      item: c.item,
      strict: show(strict),
      screen: show(screen),
      ok: verdictOk(strict, c.strict) && verdictOk(screen, c.screen),
      miss: !!c.screen.expectMiss,
    });
  }
  out.measurements.contentSafetyEval = rows;
  for (let item = 1; item <= 10; item++) {
    const mine = rows.filter((r) => r.item === item);
    check(
      `평가 ${item}: ${cases.find((c) => c.item === item)?.description} 외 ${mine.length - 1}건 — 기대 판정과 같음`,
      mine.length > 0 && mine.every((r) => r.ok),
      mine.map((r) => `${r.id}: strict ${r.strict} · screen ${r.screen}`).join(" | "),
    );
  }
  const aux = rows.filter((r) => r.item === 0);
  check(
    "보조: 유형 없음 · 까닭과 다른 유형 · 도움 대화의 승인 help_offer",
    aux.every((r) => r.ok),
    aux.map((r) => `${r.id}: ${r.strict}`).join(" | "),
  );
  const strictLeaks = cases.filter((c) => {
    const v = evaluateDialogueContent(c.candidate, c.intent, c.input, TEST_DIALOGUE_CATALOG);
    return v.allow && v.source === "free_text";
  });
  check("strict(게임 기본): 자유 문장은 하나도 화면에 안 나감", strictLeaks.length === 0, `${strictLeaks.length}건`);
  const misses = rows.filter((r) => r.miss);
  check(
    "screen(평가용) 대조의 한계를 기록: 목록에 없는 바꿔 말하기 · 지어낸 정보는 놓침 (예상한 놓침 — strict 는 막음)",
    misses.length === 2 && misses.every((r) => r.screen.startsWith("허용") && r.strict.startsWith("차단")),
    misses.map((r) => `${r.id}: screen ${r.screen} / strict ${r.strict}`).join(" | "),
  );
  out.notes.push(
    `[${group}] 표현 목록 대조는 완전하지 않다 — 평가셋에서 screen 이 놓친 사례 ${misses.map((m) => m.id).join(", ")}. 게임 기본(strict)은 자유 문장을 아예 내보내지 않는다.`,
  );

  // ── 안전 공급자: 형식 검증 → 콘텐츠 정책 → 화면 ──
  const fast = { ...AI_PROVIDER_CONFIG, timeoutMs: 60 };
  const ctx = (patch: Partial<NpcDialogueContext> = {}): NpcDialogueContext => ({
    sessionId: 1,
    turn: 0,
    speaker: "검사 NPC",
    observation: null,
    intent: "manual",
    aiInput: stateInput({ zone: "Z1" }),
    ...patch,
  });
  const safe = (
    transport: AiDialogueTransport,
    intent: "manual" | "hint_offer" = "manual",
    catalog = TEST_DIALOGUE_CATALOG,
  ) => {
    const verdicts: ContentVerdict[] = [];
    let sent = 0;
    const provider = createSafeAiDialogueProvider({
      transport: (req, signal) => {
        sent++;
        return transport(req, signal);
      },
      intent,
      baseFallback: createScriptedDialogueProvider(PLACEHOLDER_DIALOGUE.lines),
      catalog,
      config: fast,
      onVerdict: (v) => verdicts.push(v),
    });
    return { provider, verdicts, sent: () => sent, last: () => provider.records().at(-1) };
  };
  const live = () => new AbortController().signal;
  {
    const r = safe(createMockAiTransport("catalog"));
    const line = await r.provider.open(ctx(), live());
    check(
      "승인 대사 id → 목록 문장이 화면에 (AI 가 덧붙인 문장은 안 나감) · 기록에 line_id",
      line.text === "(가상) 여기 바람이 차네." &&
        !/화면에 나가면 안 된다/.test(line.text) &&
        r.last()?.lineId === "v.ambient.wind",
      `${line.text} · ${r.last()?.lineId}`,
    );
  }
  {
    const r = safe(createMockAiTransport("spoiler"));
    const line = await r.provider.open(ctx(), live());
    check(
      "스포일러 자유 문장 → 화면에 안 나감 · fallback = 검수된 가상 대사 · 이유 기록(content_rejected)",
      line.text === "(가상) 여기 바람이 차네." &&
        r.last()?.reason === "content_rejected" &&
        /FREE_TEXT_NOT_APPROVED/.test(r.last()?.detail ?? "") &&
        /TWIST_LEAK/.test(r.last()?.detail ?? "") &&
        /ANSWER_LEAK/.test(r.last()?.detail ?? ""),
      `${line.text} · ${r.last()?.detail}`,
    );
  }
  {
    const r = safe(createMockAiTransport("ok"), "manual", NAJU_DIALOGUE_CATALOG);
    const line = await r.provider.open(ctx(), live());
    check(
      "게임 목록(검수 대사 없음) → AI 자유 문장은 막히고 지금의 임시 고정 대사로",
      line.text === PLACEHOLDER_DIALOGUE.lines[0] && r.last()?.reason === "content_rejected",
      `${line.text} · ${r.last()?.detail}`,
    );
  }
  {
    const r = safe(
      async () => ({ text: "x", content_type: "puzzle_hint", line_id: "v.hint.box", last: true }),
      "hint_offer",
    );
    const line = await r.provider.open(ctx({ intent: "hint_offer" }), live());
    check(
      "puzzle_hint 는 검수돼 있어도 안 나감 → 검수된 help_offer 로 대체",
      line.text === "(가상) 같이 천천히 둘러보자." && /PUZZLE_HINT_NOT_ALLOWED/.test(r.last()?.detail ?? ""),
      `${line.text} · ${r.last()?.detail}`,
    );
  }
  {
    const r = safe(createMockAiTransport("catalog"));
    const leaky = stateInput({ zone: "Z1", clues: ["씬9.상자4721#1"] }); // 요청에 정답 표현이 섞임
    const line = await r.provider.open(ctx({ aiInput: leaky }), live());
    check(
      "요청에 아직 비밀인 말(정답 4721)이 섞이면 보내지 않음(unsafe_request) → fallback",
      r.sent() === 0 &&
        r.last()?.reason === "unsafe_request" &&
        r.last()?.detail === "v.answer.box" &&
        line.text === "(가상) 여기 바람이 차네.",
      `전송 ${r.sent()} · ${r.last()?.reason} · ${r.last()?.detail}`,
    );
    const ok = safe(createMockAiTransport("catalog"));
    await ok.provider.open(ctx(), live());
    check("비밀이 없는 평범한 요청은 보냄", ok.sent() === 1);
  }
  {
    const slow = safe(createMockAiTransport("slow"));
    const line = await slow.provider.open(ctx(), live());
    check(
      "시간 초과 유지 → fallback(timeout) · 검수 대사",
      line.text === "(가상) 여기 바람이 차네." && slow.last()?.reason === "timeout",
    );
    const cancel = safe(createMockAiTransport("slow"));
    const controller = new AbortController();
    const pending = cancel.provider.open(ctx(), controller.signal);
    controller.abort();
    let name = "";
    try {
      await pending;
    } catch (error) {
      name = (error as Error).name;
    }
    check(
      "취소 유지 → AbortError · fallback 안 부름 · 판정 없음",
      name === "AbortError" && cancel.verdicts.length === 0,
      name,
    );
    const sticky = safe(createMockAiTransport("spoiler"));
    await sticky.provider.open(ctx({ sessionId: 5 }), live());
    const second = await sticky.provider.next(ctx({ sessionId: 5, turn: 1 }), live());
    check(
      "막힌 세션은 끝까지 fallback (다시 AI 에 묻지 않음 · 검수 대사가 떨어지면 대화 끝)",
      sticky.sent() === 1 && sticky.last()?.reason === "sticky_fallback",
      `전송 ${sticky.sent()} · 둘째 차례 ${second === null ? "끝" : second.text}`,
    );
  }
  {
    const store = createNpcBehaviorStore();
    const r = safe(createMockAiTransport("catalog"), "hint_offer");
    const session = createDialogSession({
      store,
      getProvider: () => r.provider,
      getSpeaker: () => "검사 NPC",
      getAiInput: () => stateInput({ zone: "Z1" }),
    });
    session.open("hint_offer");
    await wait(20);
    const shown = session.getSnapshot().text;
    session.advance();
    check(
      "세션: 도움 대화(hint_offer) → 승인 help_offer 문장 · 끝나면 FSM 복귀",
      shown === "(가상) 같이 천천히 둘러보자." && store.getState().current === "Follow",
      `${shown} · ${store.getState().current}`,
    );
  }
  return out;
}
