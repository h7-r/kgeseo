// AI 대사 공급자 어댑터 검사 (N 묶음) — 가짜 전송만 쓴다(모델 · 백엔드 없음). 비동기.
import {
  AI_PROVIDER_CONFIG,
  createAiDialogueProvider,
  validateAiDialogueResponse,
  type AiDialogueRequest,
  type AiDialogueTransport,
} from "../aiDialogueProvider";
import { trackBehaviorStore } from "../behaviorLog";
import { createNpcBehaviorStore } from "../behaviorState";
import { createDialogSession } from "../dialogSession";
import { createMockAiTransport } from "../mockAiTransport";
import { buildNpcAiInput } from "../npcAiInput";
import { createScriptedDialogueProvider, type NpcDialogueContext, type NpcDialogueProvider } from "../npcDialogue";
import { createPlayerActivityTracker } from "../playerActivityTracker";
import type { NpcCheckOutput } from "./npcChecks";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runAiProviderChecks(): Promise<NpcCheckOutput> {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "N AI 대사 공급자 · 검증 · 시간 초과 · fallback";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  const FALLBACK = ["고정 0", "고정 1", "고정 2"];
  const fast = { ...AI_PROVIDER_CONFIG, timeoutMs: 60 };
  const ctx = (patch: Partial<NpcDialogueContext> = {}): NpcDialogueContext => ({
    sessionId: 1,
    turn: 0,
    speaker: "검사 NPC",
    observation: { distance: 1.4, zone: "Z1", recentEvents: ["zone_entered:Z1"] },
    intent: "manual",
    aiInput: null,
    ...patch,
  });
  const make = (transport: AiDialogueTransport, config = fast) => {
    const calls: AiDialogueRequest[] = [];
    let fallbackCalls = 0;
    const scripted = createScriptedDialogueProvider(FALLBACK);
    const fallback: NpcDialogueProvider = {
      open: (c, s) => {
        fallbackCalls++;
        return scripted.open(c, s);
      },
      next: (c, s) => {
        fallbackCalls++;
        return scripted.next(c, s);
      },
    };
    const provider = createAiDialogueProvider({
      transport: (req, signal) => {
        calls.push(req);
        return transport(req, signal);
      },
      fallback,
      config,
    });
    return { provider, calls, fallbackCalls: () => fallbackCalls };
  };
  const live = () => new AbortController().signal;

  // 1 정상 응답 · 요청 모양
  {
    const tracker = createPlayerActivityTracker();
    tracker.frame({ dt: 0.1, active: true, moving: false, running: false, zone: "Z1" });
    const aiInput = buildNpcAiInput({
      intent: "manual",
      dialog: { sessionId: 1, turn: 0 },
      activity: tracker.snapshot(),
      npc: { behavior: "Interact", distance: 1.4, following: false, waiting: false },
    });
    const r = make(async () => ({ text: "  AI 첫 대사\r\n둘째 줄  ", last: false, speaker: "가짜 이름" }));
    const line = await r.provider.open(ctx({ aiInput }), live());
    const req = r.calls[0];
    check(
      "1 정상 응답 → AI 대사 사용 (앞뒤 공백 · 줄바꿈 정리) · fallback 안 부름",
      line.text === "AI 첫 대사\n둘째 줄" && r.fallbackCalls() === 0 && r.provider.records().at(-1)?.source === "ai",
      JSON.stringify(line),
    );
    check("1 AI 가 보낸 speaker 는 버림 (NPC 이름은 설정 값)", line.speaker === undefined, `${line.speaker}`);
    check(
      "1 요청: npc_dialogue_request/0.1 · 차례 · intent · 관측 · npc_ai_input 실림 · JSON 그대로",
      req.schema === "npc_dialogue_request/0.1" &&
        req.kind === "open" &&
        req.turn === 0 &&
        req.intent === "manual" &&
        req.observation?.zone === "Z1" &&
        req.ai_input?.schema === "npc_ai_input/0.1" &&
        JSON.stringify(JSON.parse(JSON.stringify(req))) === JSON.stringify(req),
      `${JSON.stringify(req).length} 바이트`,
    );
    out.measurements.aiRequestExample = JSON.parse(
      JSON.stringify({ ...req, ai_input: req.ai_input ? "(npc_ai_input/0.1 생략)" : null }),
    );
  }
  // 2 잘못된 응답 → fallback
  {
    const bad: [string, unknown][] = [
      ["null", null],
      ["문자열", "그냥 문자열"],
      ["배열", ["x"]],
      ["text 없음", { last: true }],
      ["text 숫자", { text: 42 }],
      ["빈 text", { text: "   " }],
      ["너무 긺", { text: "가".repeat(AI_PROVIDER_CONFIG.maxTextLength + 1) }],
      ["제어 문자", { text: "안녕\u0007" }],
      ["방향 바꿈 문자", { text: "안녕‮" }],
      ["last 문자열", { text: "안녕", last: "yes" }],
      ["end 문자열", { text: "안녕", end: "yes" }],
    ];
    const results: string[] = [];
    let allFallback = true;
    for (const [label, raw] of bad) {
      const r = make(async () => raw);
      const line = await r.provider.open(ctx(), live());
      const rec = r.provider.records().at(-1);
      const ok = line.text === "고정 0" && rec?.source === "fallback" && rec.reason === "invalid_response";
      if (!ok) allFallback = false;
      results.push(`${label}:${ok ? rec?.detail : "통과못함"}`);
    }
    check(
      `2 잘못된 응답 ${bad.length}종 → 모두 fallback(invalid_response · 이유 기록)`,
      allFallback,
      results.join(" | "),
    );
    const edge = validateAiDialogueResponse({ text: "가".repeat(AI_PROVIDER_CONFIG.maxTextLength) }, false);
    check(
      "2 길이 한도 딱 맞음 · 줄바꿈 · 탭은 허용",
      edge.ok && validateAiDialogueResponse({ text: "가\n나\t다" }, false).ok,
    );
    const r = make(async () => ({ end: true }));
    const line = await r.provider.open(ctx(), live());
    check(
      "2 첫 대사에 end → fallback(end_on_open) — 첫 대사는 반드시 있음",
      line.text === "고정 0" && r.provider.records().at(-1)?.reason === "end_on_open",
      `${r.provider.records().at(-1)?.reason}`,
    );
  }
  // 3 전송 실패
  {
    const rejects = make(() => Promise.reject(new Error("연결 거부")));
    const throws = make(() => {
      throw new Error("동기 예외");
    });
    const a = await rejects.provider.open(ctx(), live());
    const b = await throws.provider.open(ctx(), live());
    check(
      "3 전송 실패(거부 · 동기 예외) → fallback(transport_error)",
      a.text === "고정 0" &&
        b.text === "고정 0" &&
        rejects.provider.records().at(-1)?.reason === "transport_error" &&
        throws.provider.records().at(-1)?.reason === "transport_error",
      `${rejects.provider.records().at(-1)?.detail} · ${throws.provider.records().at(-1)?.detail}`,
    );
  }
  // 4 시간 초과
  {
    let aborted = false;
    const r = make(
      (_req, signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
    );
    const start = performance.now();
    const line = await r.provider.open(ctx(), live());
    const ms = performance.now() - start;
    check(
      `4 응답 없음 → ${fast.timeoutMs} ms 에 시간 초과 · 전송 끊음 · fallback(timeout)`,
      line.text === "고정 0" &&
        aborted &&
        r.provider.records().at(-1)?.reason === "timeout" &&
        ms < fast.timeoutMs + 200,
      `${ms.toFixed(0)} ms · 끊음 ${aborted}`,
    );
    check(
      "4 기본 시간 제한 < 대화 세션 응답 제한(5000 ms) — fallback 이 세션 안에 답한다",
      AI_PROVIDER_CONFIG.timeoutMs < 5000,
      `${AI_PROVIDER_CONFIG.timeoutMs} ms`,
    );
  }
  // 5 세션 취소
  {
    let aborted = false;
    const r = make(
      (_req, signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
    );
    const controller = new AbortController();
    const pending = r.provider.open(ctx(), controller.signal);
    controller.abort();
    let name = "";
    try {
      await pending;
    } catch (error) {
      name = (error as Error).name;
    }
    check(
      "5 세션이 끊으면 전송도 끊고 fallback 을 부르지 않음 (AbortError)",
      aborted && name === "AbortError" && r.fallbackCalls() === 0 && r.provider.records().at(-1)?.source === "aborted",
      `${name} · fallback ${r.fallbackCalls()}`,
    );
    const pre = new AbortController();
    pre.abort();
    let preName = "";
    try {
      await make(async () => ({ text: "x" })).provider.open(ctx(), pre.signal);
    } catch (error) {
      preName = (error as Error).name;
    }
    check("5 이미 끊긴 신호로 부르면 바로 AbortError", preName === "AbortError", preName);
  }
  // 6 한 세션은 fallback 으로 고정
  {
    let n = 0;
    const r = make(async () => (n++ === 0 ? { text: 7 } : { text: "AI 대사" }));
    const a = await r.provider.open(ctx({ sessionId: 9 }), live());
    const b = await r.provider.next(ctx({ sessionId: 9, turn: 1 }), live());
    const c = await r.provider.open(ctx({ sessionId: 10 }), live());
    check(
      "6 한 번 fallback 이면 그 세션 끝까지 fallback (전송 안 부름) · 다음 세션은 다시 AI",
      a.text === "고정 0" &&
        b?.text === "고정 1" &&
        r.calls.length === 2 &&
        c.text === "AI 대사" &&
        r.provider.records().some((x) => x.reason === "sticky_fallback"),
      `${a.text} → ${b?.text} → ${c.text} · 전송 ${r.calls.length}`,
    );
  }
  // 7 대화 끝 · 차례 한도
  {
    const r = make(async (req) => (req.turn === 1 ? { end: true } : { text: `AI ${req.turn}` }));
    const end = await r.provider.next(ctx({ turn: 1 }), live());
    check("7 next 에 end → null (대화 끝)", end === null && r.provider.records().at(-1)?.source === "ai");
    const limited = make(async (req) => ({ text: `AI ${req.turn}`, last: false }));
    const lastTurn = await limited.provider.next(ctx({ turn: fast.maxTurns - 1 }), live());
    const over = await limited.provider.next(ctx({ turn: fast.maxTurns }), live());
    check(
      `7 차례 한도 ${fast.maxTurns}: 마지막 차례는 AI 가 last 를 안 붙여도 last · 그 뒤는 묻지 않고 끝`,
      lastTurn?.last === true &&
        limited.calls.at(-1)?.final_turn === true &&
        over === null &&
        limited.calls.length === 1,
      `${JSON.stringify(lastTurn)} · ${over} · 전송 ${limited.calls.length}`,
    );
  }
  // 8 · 9 대화 세션과 함께 (실제 dialogSession · FSM)
  {
    const run = async (transport: AiDialogueTransport, fallback: NpcDialogueProvider, waitMs: number) => {
      const store = trackBehaviorStore(createNpcBehaviorStore());
      const provider = createAiDialogueProvider({ transport, fallback, config: fast });
      const session = createDialogSession({
        store,
        getProvider: () => provider,
        getSpeaker: () => "검사 NPC",
        timeoutMs: 400,
      });
      session.open();
      await wait(waitMs);
      return { store, session, provider };
    };
    const ok = await run(createMockAiTransport("ok"), createScriptedDialogueProvider(FALLBACK), 20);
    const okText = ok.session.getSnapshot().text;
    ok.session.advance();
    await wait(20);
    const okSecond = ok.session.getSnapshot();
    ok.session.advance();
    check(
      "9 세션: AI 대사 두 차례 → 마지막 뒤 닫힘 · FSM Follow",
      /가짜 AI/.test(okText ?? "") &&
        /2번째/.test(okSecond.text ?? "") &&
        okSecond.last &&
        ok.store.getState().current === "Follow",
      `${okText} → ${okSecond.text} · ${ok.store.getState().current}`,
    );
    const slow = await run(createMockAiTransport("slow"), createScriptedDialogueProvider(FALLBACK), 150);
    check(
      "9 세션: AI 가 늦으면(시간 초과) 세션 제한 안에 fallback 대사가 보임 — 대화는 안 닫힘",
      slow.session.getSnapshot().phase === "showing" &&
        slow.session.getSnapshot().text === "고정 0" &&
        slow.store.getState().current === "Interact",
      `${slow.session.getSnapshot().phase} · ${slow.session.getSnapshot().text}`,
    );
    slow.session.close("user");
    const bothFail = await run(
      () => Promise.reject(new Error("AI 실패")),
      { open: () => Promise.reject(new Error("고정 대사도 실패")), next: async () => null },
      50,
    );
    check(
      "8 AI · fallback 둘 다 실패 → 대화 닫힘(error) · FSM Follow (Interact 에 남지 않음)",
      bothFail.session.getSnapshot().lastClose?.reason === "error" && bothFail.store.getState().current === "Follow",
      `${bothFail.session.getSnapshot().lastClose?.reason} · ${bothFail.store.getState().current}`,
    );
    const store = createNpcBehaviorStore();
    let seenAiInput: unknown = "없음";
    const capture = createAiDialogueProvider({
      transport: async (req) => {
        seenAiInput = req.ai_input;
        return { text: "x", last: true };
      },
      fallback: createScriptedDialogueProvider(FALLBACK),
      config: fast,
    });
    const session = createDialogSession({
      store,
      getProvider: () => capture,
      getSpeaker: () => "검사 NPC",
      getAiInput: () =>
        buildNpcAiInput({
          intent: "manual",
          dialog: null,
          activity: createPlayerActivityTracker().snapshot(),
          npc: { behavior: "Interact", distance: 1, following: false, waiting: false },
        }),
    });
    session.open("hint_offer");
    await wait(10);
    check(
      "9 세션의 getAiInput → 공급자 맥락 aiInput → 요청 ai_input (intent hint_offer 도 전달)",
      (seenAiInput as { schema?: string } | null)?.schema === "npc_ai_input/0.1" &&
        capture.records().at(-1)?.intent === "hint_offer",
      `${(seenAiInput as { schema?: string } | null)?.schema}`,
    );
    session.close("user");
  }
  // 고정 대사 공급자는 aiInput 이 있어도 그대로 (하위 호환)
  {
    const scripted = createScriptedDialogueProvider(["그대로"]);
    const line = await scripted.open(ctx({ aiInput: null }), live());
    check("하위 호환: 고정 대사 공급자는 aiInput · intent 와 상관없이 그대로", line.text === "그대로");
  }
  return out;
}
