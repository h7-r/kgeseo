/**
 * 개발 서버 전용 모의 응답 — 승인된 나주 NPC 대사가 아직 없어 UI 만 확인할 때 쓴다(?npc-mock=<시나리오>).
 * companionRuntime 이 import.meta.env.DEV 일 때만 동적으로 불러온다 → 배포 빌드에는 이 파일이 없다.
 *
 * 응답 모양은 계약(backend/app/schemas/npc_turn.py · hint.py) 그대로다. 문장은 모두 「[모의]」 자리 표시이고
 * 승인 원문 · 정답이 아니다. 이 응답을 승인 데이터로 보거나 운영에서 켜지 않는다.
 *
 * 시나리오
 *   mix(기본)   말 걸 때마다 ① 대사 + 힌트 제안 ② 대사 없음(null) ③ 대사만 — 차례로
 *   reply       늘 대사
 *   null        늘 대사 없음(운영 기본값과 같다)
 *   suggest     대사 없이 힌트 제안만(NPC_GENERIC_PACK_MISSING)
 *   generic     긴급 중단 — generic · NPC_CONTENT_WITHDRAWN · 대사 없음 · 제안도 숨김
 *   pause       긴급 중단 + 「잠시 멈춤」 자리 대사
 *   version     NPC 409 CASE_VERSION_UNAVAILABLE
 *   error500    NPC 500 NPC content is unavailable.
 *   flaky       첫 시도는 네트워크 오류, 같은 본문 재전송은 성공
 *   balance     힌트 409 HINT_BALANCE_EMPTY
 *   session404  첫 NPC 턴은 404(세션 없음) — 새 세션을 만든다
 */
import { exposeDevHook } from "@/debug/devHooks";

const PLAY_ID = "00000000-0000-4000-8000-00000000a001";
const MOCK_PUZZLE = "PUZZLE_MOCK_01";
const DELAY_MS = 450;

interface MockCall {
  path: string;
  method: string;
  body: unknown;
  status: number | "network";
}

type Reply = { status: number; body: unknown } | "network";

export function installCompanionMock(scenario: string) {
  const realFetch = window.fetch.bind(window);
  const calls: MockCall[] = [];
  let turnCount = 0;
  let hintBalance = 3;
  let hintLevel = 0;
  let flakySeen = new Set<string>();
  let sessionGone = scenario === "session404";

  const turn = (patch: Record<string, unknown> = {}) => ({
    npc_event_id: crypto.randomUUID(),
    reply: null,
    suggest_hint: null,
    fallback_reason: null,
    content_mode: "case",
    ...patch,
  });
  const reply = (n: number) => ({
    source: "approved_line",
    text: `[모의] 승인 대사 자리 ${n} — 자막이 어떻게 보이는지 확인하는 문장입니다.`,
    line_id: `MOCK_LINE_${n}`,
  });
  const suggest = { suggest_hint: { hint_ref: "hr1.mock.0000000000000000000000000000000000000000000" } };

  function npcTurn(body: Record<string, unknown>): Reply {
    if (sessionGone) {
      sessionGone = false;
      return { status: 404, body: { detail: "Play session not found." } };
    }
    turnCount += 1;
    switch (scenario) {
      case "reply":
        return { status: 200, body: turn({ reply: reply(turnCount) }) };
      case "null":
        return { status: 200, body: turn() };
      case "suggest":
        return { status: 200, body: turn({ ...suggest, fallback_reason: "NPC_GENERIC_PACK_MISSING" }) };
      case "generic":
        return {
          status: 200,
          body: turn({ ...suggest, content_mode: "generic", fallback_reason: "NPC_CONTENT_WITHDRAWN" }),
        };
      case "pause":
        return {
          status: 200,
          body: turn({
            content_mode: "generic",
            fallback_reason: "NPC_CONTENT_WITHDRAWN",
            reply: { source: "approved_line", text: "[모의] 「잠시 멈춤」 자리 문장", line_id: "GENERIC_PAUSE_MOCK" },
          }),
        };
      case "version":
        return { status: 409, body: { detail: "CASE_VERSION_UNAVAILABLE" } };
      case "error500":
        return { status: 500, body: { detail: "NPC content is unavailable." } };
      case "flaky": {
        const id = String(body.client_event_id);
        if (!flakySeen.has(id)) {
          flakySeen.add(id);
          return "network";
        }
        return { status: 200, body: turn({ reply: reply(turnCount) }) };
      }
      default: {
        const step = (turnCount - 1) % 3;
        if (step === 0) return { status: 200, body: turn({ reply: reply(turnCount), ...suggest }) };
        if (step === 1) return { status: 200, body: turn() };
        return { status: 200, body: turn({ reply: reply(turnCount) }) };
      }
    }
  }

  function hint(body: Record<string, unknown>): Reply {
    if (scenario === "balance")
      return {
        status: 409,
        body: {
          detail: {
            code: "HINT_BALANCE_EMPTY",
            message: "Hint balance is empty.",
            minigames_left: 0,
            special_minigame_available: false,
          },
        },
      };
    const level = body.target_level === 2 ? 2 : 1;
    if (level === 2 && hintLevel < 1) return { status: 409, body: { detail: "Previous hint level is not unlocked." } };
    const isNew = level > hintLevel;
    if (isNew) {
      hintLevel = level;
      hintBalance -= 1;
    }
    return {
      status: 200,
      body: {
        interaction_id: crypto.randomUUID(),
        result: {
          result_type: isNew ? "hint_unlocked" : "already_unlocked",
          puzzle_id: MOCK_PUZZLE,
          hint_level: hintLevel,
          state: {},
          state_changes: [],
          hint_balance: hintBalance,
          help_used: hintLevel,
        },
        hint: { level, text: level === 1 ? "[모의] 힌트 1단계(방향) 자리" : "[모의] 힌트 2단계(정답) 자리" },
      },
    };
  }

  function route(path: string, method: string, body: Record<string, unknown>): Reply | null {
    if (path === "/api/v1/anonymous-sessions" && method === "POST")
      return { status: 201, body: { success: true, data: { anonymous_session_id: crypto.randomUUID() } } };
    if (path === "/api/v1/play-sessions" && method === "POST")
      return {
        status: 201,
        body: { success: true, data: { play_session_id: PLAY_ID, case_id: body.case_id, state: { hint_levels: {} } } },
      };
    if (path.endsWith("/npc/turns")) return npcTurn(body);
    if (path.endsWith("/hints")) return hint(body);
    return null;
  }

  window.fetch = async (input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const reply = route(path, method, body);
    if (!reply) return realFetch(input, init);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    calls.push({ path, method, body, status: reply === "network" ? "network" : reply.status });
    if (reply === "network") throw new TypeError("[모의] 네트워크 오류");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  // 브라우저 검사가 무엇을 보냈는지 읽는다
  exposeDevHook("companionMock", {
    scenario,
    calls: () => calls.slice(),
    reset: () => {
      calls.length = 0;
      flakySeen = new Set();
    },
  });
  console.info(`[동행 NPC] 개발용 모의 응답 사용 중: ${scenario}`);
}
