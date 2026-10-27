// HTTP AI 전송 검사 (O 묶음) — 모의 엔드포인트(fetch 모양 함수 · 진짜 Response)만 쓴다. 서버 · 모델 없음. 비동기.
import { AI_PROVIDER_CONFIG, createAiDialogueProvider } from "../aiDialogueProvider";
import { trackBehaviorStore } from "../behaviorLog";
import { createNpcBehaviorStore } from "../behaviorState";
import { createDialogSession } from "../dialogSession";
import { createHttpAiTransport, DEFAULT_NPC_DIALOGUE_ENDPOINT, resolveSameOriginEndpoint } from "../httpAiTransport";
import { createMockAiEndpoint, type MockEndpointMode } from "../mockAiEndpoint";
import { buildNpcAiInput } from "../npcAiInput";
import { createScriptedDialogueProvider, type NpcDialogueContext } from "../npcDialogue";
import { createPlayerActivityTracker } from "../playerActivityTracker";
import type { NpcCheckOutput } from "./npcChecks";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runHttpTransportChecks(): Promise<NpcCheckOutput> {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "O HTTP 전송 · 모의 엔드포인트";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  const ORIGIN = "http://localhost:5184";
  const fast = { ...AI_PROVIDER_CONFIG, timeoutMs: 80 };
  const ctx = (patch: Partial<NpcDialogueContext> = {}): NpcDialogueContext => ({
    sessionId: 3,
    turn: 0,
    speaker: "검사 NPC",
    observation: { distance: 1.4, zone: "Z1", recentEvents: [] },
    intent: "manual",
    aiInput: null,
    ...patch,
  });
  const make = (mode: MockEndpointMode) => {
    const endpoint = createMockAiEndpoint(mode);
    const provider = createAiDialogueProvider({
      transport: createHttpAiTransport({ fetchImpl: endpoint.fetch, origin: ORIGIN }),
      fallback: createScriptedDialogueProvider(["고정 0", "고정 1"]),
      config: fast,
    });
    return { endpoint, provider, last: () => provider.records().at(-1) };
  };
  const live = () => new AbortController().signal;

  // 정상 200 · 요청 모양
  {
    const r = make("ok");
    const line = await r.provider.open(ctx(), live());
    const call = r.endpoint.calls[0];
    check(
      "200 정상 → 모의 HTTP 대사 · source ai",
      /^\(모의 HTTP\) 대화 1번째/.test(line.text) && r.last()?.source === "ai",
      line.text,
    );
    check(
      "요청: 같은 출처 상대 경로 POST · JSON · credentials same-origin · 본문 npc_dialogue_request/0.1 그대로",
      call.url === DEFAULT_NPC_DIALOGUE_ENDPOINT &&
        call.method === "POST" &&
        call.headers["content-type"] === "application/json" &&
        call.credentials === "same-origin" &&
        call.body.schema === "npc_dialogue_request/0.1" &&
        call.body.session_id === 3 &&
        call.body.turn === 0,
      `${call.method} ${call.url} · ${JSON.stringify(call.headers)}`,
    );
    check(
      "비밀값 없음: Authorization · 키 헤더를 보내지 않음 (헤더를 넣는 옵션 자체가 없음)",
      Object.keys(call.headers).every((h) => ["content-type", "accept"].includes(h)),
      Object.keys(call.headers).join(","),
    );
  }
  // HTTP 오류 · 네트워크 실패
  {
    const results: string[] = [];
    let ok = true;
    for (const status of [400, 401, 404, 429, 500, 502, 503]) {
      const r = make({ status });
      const line = await r.provider.open(ctx(), live());
      const pass =
        line.text === "고정 0" && r.last()?.reason === "transport_error" && r.last()?.detail === `HTTP ${status}`;
      if (!pass) ok = false;
      results.push(`${status}:${pass ? "fallback" : "실패"}`);
    }
    check("4xx · 5xx 7종 → fallback(transport_error · HTTP 상태 기록)", ok, results.join(" "));
    const net = make("network");
    const line = await net.provider.open(ctx(), live());
    check(
      "네트워크 실패(fetch 거부) → fallback(transport_error)",
      line.text === "고정 0" && net.last()?.reason === "transport_error",
      `${net.last()?.detail}`,
    );
  }
  // 잘못된 응답
  {
    const cases: [string, MockEndpointMode, RegExp][] = [
      ["JSON 아님", "bad_json", /JSON/],
      ["schema 틀림", "wrong_schema", /schema/],
      ["지난 세션 응답", "stale_session", /다른 세션/],
      ["다른 차례 응답", "stale_turn", /다른 차례/],
    ];
    const results: string[] = [];
    let ok = true;
    for (const [label, mode, detail] of cases) {
      const r = make(mode);
      const line = await r.provider.open(ctx(), live());
      const pass =
        line.text === "고정 0" && r.last()?.reason === "invalid_response" && detail.test(r.last()?.detail ?? "");
      if (!pass) ok = false;
      results.push(`${label}:${pass ? r.last()?.detail : "실패"}`);
    }
    check(
      "잘못된 JSON · 봉투 · 지난 세션/차례 응답 → 출력 안 함 · fallback(invalid_response)",
      ok,
      results.join(" | "),
    );
    const dup = make("duplicate");
    const first = await dup.provider.open(ctx({ sessionId: 7 }), live());
    const second = await dup.provider.next(ctx({ sessionId: 7, turn: 1 }), live());
    check(
      "같은 response_id 가 다시 오면 출력 안 함 (중복 표시 없음) → fallback",
      /모의 HTTP/.test(first.text) &&
        second?.text === "고정 1" &&
        dup.provider.records().some((x) => /같은 응답/.test(x.detail ?? "")),
      `${first.text} → ${second?.text}`,
    );
  }
  // 지연 · 시간 초과 · 취소
  {
    const slow = make({ delayMs: 400 });
    const start = performance.now();
    const line = await slow.provider.open(ctx(), live());
    const ms = performance.now() - start;
    check(
      `지연(400 ms) > 시간 제한(${fast.timeoutMs} ms) → fetch 끊음 · fallback(timeout)`,
      line.text === "고정 0" && slow.last()?.reason === "timeout" && slow.endpoint.calls[0].aborted && ms < 300,
      `${ms.toFixed(0)} ms · 끊김 ${slow.endpoint.calls[0].aborted}`,
    );
    const quick = make({ delayMs: 20 });
    const quickLine = await quick.provider.open(ctx(), live());
    check("지연(20 ms) < 시간 제한 → AI 대사", /모의 HTTP/.test(quickLine.text) && quick.last()?.source === "ai");
    const cancel = make({ delayMs: 400 });
    const controller = new AbortController();
    const pending = cancel.provider.open(ctx(), controller.signal);
    await wait(10);
    controller.abort();
    let name = "";
    try {
      await pending;
    } catch (error) {
      name = (error as Error).name;
    }
    check(
      "세션 취소 → fetch 끊음 · AbortError · fallback 안 부름",
      name === "AbortError" && cancel.endpoint.calls[0].aborted && cancel.last()?.source === "aborted",
      `${name} · 끊김 ${cancel.endpoint.calls[0].aborted}`,
    );
  }
  // 같은 출처만
  {
    const bad = [
      "https://api.example.com/npc",
      "//evil.example.com/npc",
      "api/v1/npc/dialogue",
      "http://localhost:9999/x",
    ];
    const rejected = bad.filter((e) => {
      try {
        createHttpAiTransport({ endpoint: e, origin: ORIGIN, fetchImpl: createMockAiEndpoint().fetch });
        return false;
      } catch {
        return true;
      }
    });
    check(
      "다른 출처 · 프로토콜 상대 · 상대 경로 아닌 주소는 만들 때 거부 (외부 모델 서비스 직접 접속 막음)",
      rejected.length === bad.length &&
        resolveSameOriginEndpoint("/api/v1/npc/dialogue?x=1", ORIGIN) === "/api/v1/npc/dialogue?x=1",
      `${rejected.length}/${bad.length}`,
    );
  }
  // 보내는 데이터: 발견한 단서만 · 퍼즐 정답 없음
  {
    const tracker = createPlayerActivityTracker();
    tracker.frame({ dt: 0.1, active: true, moving: false, running: false, zone: "Z1" });
    tracker.record([
      {
        event_id: "c1",
        event_type: "clue_discovered",
        target_id: "씬1.구렁이",
        clue_key: "씬1.구렁이#3",
        source: "test",
      },
    ]);
    const aiInput = buildNpcAiInput({
      intent: "manual",
      dialog: { sessionId: 3, turn: 0 },
      activity: tracker.snapshot(),
      npc: { behavior: "Interact", distance: 1.4, following: false, waiting: false },
    });
    const r = make("ok");
    await r.provider.open(ctx({ aiInput }), live());
    const sent = JSON.stringify(r.endpoint.calls[0].body);
    check(
      "보내는 데이터: 발견한 단서만(씬1.구렁이#3) · 퍼즐 · 정답 필드 없음 · puzzle/backend null",
      r.endpoint.calls[0].body.ai_input?.progress.discovered_clues.join() === "씬1.구렁이#3" &&
        !/answer|solution|정답/i.test(sent) &&
        r.endpoint.calls[0].body.ai_input?.puzzle === null &&
        r.endpoint.calls[0].body.ai_input?.backend === null,
      `${sent.length} 바이트`,
    );
  }
  // 대화 세션과 함께: 두 차례 · 지난 세션 응답 무시
  {
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const endpoint = createMockAiEndpoint("ok");
    const provider = createAiDialogueProvider({
      transport: createHttpAiTransport({ fetchImpl: endpoint.fetch, origin: ORIGIN }),
      fallback: createScriptedDialogueProvider(["고정 0"]),
      config: fast,
    });
    const session = createDialogSession({
      store,
      getProvider: () => provider,
      getSpeaker: () => "검사 NPC",
      timeoutMs: 400,
    });
    session.open();
    await wait(20);
    const first = session.getSnapshot().text;
    session.advance();
    await wait(20);
    const second = session.getSnapshot();
    session.advance();
    check(
      "세션: HTTP 대사 두 차례 → 마지막 뒤 닫힘 · FSM Follow",
      /1번째/.test(first ?? "") &&
        /2번째/.test(second.text ?? "") &&
        second.last &&
        store.getState().current === "Follow",
      `${first} → ${second.text}`,
    );
    endpoint.setMode({ delayMs: 60 });
    session.open(); // 세션 2 — 늦은 응답
    session.close("user");
    endpoint.setMode("ok");
    session.open(); // 세션 3
    await wait(120);
    const s3 = session.getSnapshot();
    check(
      "세션: 닫힌 세션의 늦은 HTTP 응답은 새 세션에 안 나옴",
      s3.sessionId === 3 &&
        /1번째/.test(s3.text ?? "") &&
        provider.records().some((x) => x.sessionId === 2 && x.source === "aborted"),
      `세션 ${s3.sessionId} · ${s3.text}`,
    );
    session.close("user");
  }
  return out;
}
