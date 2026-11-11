import assert from "node:assert/strict";
import { test } from "node:test";

import { FOREIGN_KEEP_MS, KEYS, QUEUE_CAP, clampData, createBetaLog, normalizeCode, type BetaEvent } from "../../src/beta/betaLog.ts";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: { accepted: 0, duplicates: 0, disabled: false } };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name: string) => next.headers?.[name] ?? null },
      json: async () => next.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function setup(
  options: { href?: string; storage?: ReturnType<typeof memoryStore>; responses?: Parameters<typeof fakeFetch>[0]; account?: string | null | false } = {},
) {
  const storage = options.storage ?? memoryStore();
  const session = memoryStore();
  const { fn, calls } = fakeFetch(options.responses ?? []);
  let now = 1_700_000_000_000;
  const log = createBetaLog();
  const isActive = log.init({
    page: "naju",
    apiOrigin: "https://api.example.test/",
    build: "abc1234",
    href: options.href ?? "https://play.example.test/?pc=b-7k2q",
    env: {
      storage,
      session,
      fetch: fn,
      now: () => now,
      setTimer: () => 0,
      clearTimer: () => {},
    },
  });
  // 저장 초기화 뒤 계정을 알린다(기본: 로그인한 user-1). false 면 알리지 않는다
  if (options.account !== false) log.setAccount(options.account === undefined ? "user-1" : options.account);
  return { log, storage, session, calls, isActive, advance: (ms: number) => (now += ms) };
}

const queued = (storage: ReturnType<typeof memoryStore>) => JSON.parse(storage.getItem(KEYS.queue) ?? "[]") as BetaEvent[];

test("로그인하지 않았고 참여 코드도 없으면 계정을 안 뒤로 쌓지 않는다", () => {
  const { log, storage } = setup({ href: "https://play.example.test/", account: null });
  assert.equal(log.isActive(), false);
  log.track("run_state", "start");
  assert.equal(queued(storage).length, 0);
});

test("참여 코드 없이도 로그인한 계정이면 기록한다(베타 참가자는 모두 회원)", async () => {
  const { log, storage, calls } = setup({ href: "https://play.example.test/", account: "user-9", responses: [{ status: 200, body: {} }] });
  assert.equal(log.isActive(), true);
  log.track("run_state", "start");
  assert.equal(queued(storage)[0].pc, undefined);
  await log.flush();
  assert.equal(calls.length, 1);
  assert.equal(queued(storage).length, 0);
});

test("계정을 확인하기 전 기록은 페이지 안에 잡아 두었다가, 확인되면 계정 · 회차를 찍어 보낸다", async () => {
  const { log, storage, calls } = setup({ account: false, responses: [{ status: 200, body: {} }] });
  log.track("run_state", "start");
  assert.equal(log.run(), null);
  assert.equal(queued(storage).length, 0);
  await log.flush();
  assert.equal(calls.length, 0);
  log.setAccount("user-3");
  await log.flush();
  const sent = (JSON.parse(String(calls[0].init.body)) as { events: BetaEvent[] }).events;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].acct, "user-3");
  assert.match(sent[0].run_id ?? "", /^[0-9a-f-]{36}$/);
});

test("공용 PC — 앞사람 기록은 다음 사람 쿠키로 보내지 않고, 회차도 잇지 않는다", async () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/", account: "user-A", responses: [{ status: 503 }] });
  a.log.track("run_state", "start");
  const runA = a.log.run();
  const b = setup({ storage, href: "https://play.example.test/", account: "user-B", responses: [{ status: 200, body: {} }] });
  b.log.track("run_state", "start");
  await b.log.flush();
  const sent = (JSON.parse(String(b.calls[0].init.body)) as { events: BetaEvent[] }).events;
  assert.deepEqual([...new Set(sent.map((e) => e.acct))], ["user-B"]);
  assert.notEqual(sent[0].run_id, runA?.id);
  assert.equal(sent[0].run_index, 0);
  // 앞사람 기록은 하루 동안 남겨 두었다가(그 사람이 돌아오면 보낸다) 지나면 버린다
  assert.equal(queued(storage).filter((e) => e.acct === "user-A").length, 1);
  b.advance(FOREIGN_KEEP_MS + 1);
  await b.log.flush();
  assert.equal(queued(storage).filter((e) => e.acct === "user-A").length, 0);
});

test("다른 탭에서 다른 계정을 확인하면 앞 탭은 더 쌓지도 보내지도 않는다", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/", account: "user-A" });
  setup({ storage, href: "https://play.example.test/", account: "user-B" });
  a.log.track("run_state", "released");
  assert.equal(a.log.isActive(), false);
  assert.equal(queued(storage).filter((e) => e.phase === "released").length, 0);
});

test("주소의 코드를 대문자로 보관하고, 기록에 회차 · 탭 · 순번 · 빌드를 붙인다", () => {
  const { log, storage, isActive } = setup();
  assert.equal(isActive, true);
  assert.equal(storage.getItem(KEYS.pc), "B-7K2Q");
  log.track("objective_state", "complete", { objective_id: "P01", data: { active_ms: 1200 } });
  const [event] = queued(storage);
  assert.equal(event.type, "objective_state");
  assert.equal(event.phase, "complete");
  assert.equal(event.pc, "B-7K2Q");
  assert.equal(event.objective_id, "P01");
  assert.equal(event.run_index, 0);
  assert.match(event.run_id ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(event.seq, 1);
  assert.equal(event.build, "abc1234");
  assert.equal(event.page, "naju");
  assert.ok(event.client_ts.endsWith("Z"));
});

test("형식이 틀린 단계 · 목표 이름은 빼고 보낸다", () => {
  const { log, storage } = setup();
  log.track("objective_state", "Bad Phase!", { objective_id: "P 01" });
  const [event] = queued(storage);
  assert.equal(event.phase, undefined);
  assert.equal(event.objective_id, undefined);
});

test("보내기 성공하면 대기열에서 지우고, 자격 증명 · JSON 으로 보낸다", async () => {
  const { log, storage, calls } = setup({ responses: [{ status: 200, body: { accepted: 2, duplicates: 0, disabled: false } }] });
  log.track("run_state", "start");
  log.track("run_state", "released");
  await log.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/api/v1/beta-events");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal((JSON.parse(String(calls[0].init.body)) as { events: unknown[] }).events.length, 2);
  assert.equal(queued(storage).length, 0);
});

test("서버 오류 · 연결 실패면 남겨 두고 기다렸다가 같은 event_id 로 다시 보낸다", async () => {
  const { log, storage, calls, advance } = setup({
    responses: [{ status: 503 }, { status: 200, body: { accepted: 1, duplicates: 0 } }],
  });
  log.track("run_state", "start");
  await log.flush();
  assert.equal(queued(storage).length, 1);
  const firstId = (JSON.parse(String(calls[0].init.body)) as { events: BetaEvent[] }).events[0].event_id;
  await log.flush(); // 기다리는 중 — 보내지 않는다
  assert.equal(calls.length, 1);
  advance(5000);
  await log.flush();
  assert.equal(calls.length, 2);
  assert.equal((JSON.parse(String(calls[1].init.body)) as { events: BetaEvent[] }).events[0].event_id, firstId);
  assert.equal(queued(storage).length, 0);
});

test("형식 오류(422)인 묶음은 버리고 버린 수를 센다", async () => {
  const { log, storage } = setup({ responses: [{ status: 422 }] });
  log.track("run_state", "start");
  await log.flush();
  assert.equal(queued(storage).length, 0);
  assert.equal(log.takeDropped(), 1);
  assert.equal(log.takeDropped(), 0);
});

test("서버가 꺼 두었으면(disabled) 이 페이지에서는 그만 보낸다", async () => {
  const { log, calls } = setup({ responses: [{ status: 200, body: { accepted: 0, duplicates: 0, disabled: true } }] });
  log.track("run_state", "start");
  await log.flush();
  assert.equal(log.isActive(), false);
  log.track("run_state", "released");
  await log.flush();
  assert.equal(calls.length, 1);
});

test("대기열이 넘치면 오래된 것부터 버린다", () => {
  const { log, storage } = setup({ responses: Array.from({ length: 50 }, () => ({ status: 503 })) });
  for (let i = 0; i < QUEUE_CAP + 5; i += 1) log.track("activity_snapshot", "interval", { data: { i } });
  const queue = queued(storage);
  assert.equal(queue.length, QUEUE_CAP);
  assert.equal(queue.at(-1)?.data?.i, QUEUE_CAP + 4);
  assert.ok(Number(storage.getItem(KEYS.dropped)) >= 5);
});

test("처음부터 다시 뒤 나주가 열리면 새 회차(번호 +1)", () => {
  const { log } = setup();
  const first = log.run();
  log.markRunReset();
  assert.equal(log.consumeRunReset(), true);
  const second = log.run();
  assert.notEqual(second?.id, first?.id);
  assert.equal(second?.index, 1);
  assert.equal(log.consumeRunReset(), false);
});

test("다른 참여 코드로 들어오면 앞사람의 회차를 잇지 않는다", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/?pc=AAAA-1111" });
  const runA = a.log.run();
  const b = setup({ storage, href: "https://play.example.test/?pc=BBBB-2222" });
  assert.equal(storage.getItem(KEYS.pc), "BBBB-2222");
  assert.notEqual(b.log.run()?.id, runA?.id);
});

test("코드 형식 · data 크기", () => {
  assert.equal(normalizeCode(" b-7k2q "), "B-7K2Q");
  assert.equal(normalizeCode("ab"), null);
  assert.equal(normalizeCode("<script>"), null);
  const big = clampData({ text: "가".repeat(5000) });
  assert.ok(String(big?.text).length <= 301);
  const many = clampData(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, "x".repeat(20)])));
  assert.equal(many?.truncated, true);
});

test("저장소가 막혀도 던지지 않는다", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const log = createBetaLog();
  assert.doesNotThrow(() =>
    log.init({ page: "main", apiOrigin: "", href: "https://x.test/?pc=ABCD-1234", env: { storage: broken, session: broken, fetch: null, setTimer: () => 0, clearTimer: () => {} } }),
  );
  assert.doesNotThrow(() => log.track("run_state", "start"));
});

test("한글이 많은 묶음도 본문 상한(바이트) 안으로 나눠 보내고, 413 이면 반으로 줄여 다시 보낸다(Codex 리뷰 4)", async () => {
  const { log, storage, calls } = setup({ responses: [{ status: 413 }] });
  for (let i = 0; i < 50; i += 1) log.track("activity_snapshot", "interval", { data: { note: "가".repeat(190), i } });
  const encoder = new TextEncoder();
  await log.flush();
  const first = String(calls[0].init.body);
  assert.ok(encoder.encode(first).length <= 60_000);
  const firstCount = (JSON.parse(first) as { events: unknown[] }).events.length;
  // 413 — 하나도 버리지 않고 다음에는 절반으로
  assert.equal(queued(storage).length, 50);
  await log.flush();
  const second = (JSON.parse(String(calls[1].init.body)) as { events: unknown[] }).events.length;
  assert.equal(second, Math.floor(firstCount / 2));
});

test("거절된 묶음은 반씩 줄여 문제 기록 하나만 버린다", async () => {
  const { log, storage } = setup({ responses: [{ status: 422 }, { status: 200, body: {} }, { status: 422 }, { status: 200, body: {} }] });
  log.track("run_state", "start");
  log.track("run_state", "released");
  await log.flush(); // 2개 거절 → 1개씩
  await log.flush(); // 첫째 성공
  await log.flush(); // 둘째 거절 → 버림
  assert.equal(queued(storage).length, 0);
  assert.equal(log.takeDropped(), 1);
});

test("참가자가 바뀌면 앞사람의 못 보낸 기록은 버린다 — 지금 쿠키 주인으로 붙지 않게(Codex 리뷰 3)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/?pc=AAAA-1111", responses: [{ status: 503 }] });
  a.log.track("run_state", "start");
  assert.equal(queued(storage).length, 1);
  setup({ storage, href: "https://play.example.test/?pc=BBBB-2222" });
  assert.equal(queued(storage).length, 0);
  assert.equal(Number(storage.getItem(KEYS.dropped)), 1);
});

test("한 페이지의 회차는 고정 — 다른 탭이 회차를 바꿔도 이 페이지 기록은 그대로(Codex 리뷰 6)", () => {
  const storage = memoryStore();
  const a = setup({ storage });
  const runA = a.log.run();
  // 다른 탭이 처음부터 다시 뒤 새 회차를 썼다
  storage.setItem(KEYS.run, JSON.stringify({ id: "other-tab-run", index: 5 }));
  a.log.track("activity_snapshot", "interval");
  const last = queued(storage).at(-1);
  assert.equal(last?.run_id, runA?.id);
  assert.equal(last?.run_index, 0);
});

test("처음부터 다시 표시는 그 탭에만 — 다른 탭이 새로 열려도 새 회차가 되지 않는다", () => {
  const storage = memoryStore();
  const a = setup({ storage });
  a.log.run();
  a.log.markRunReset();
  // 다른 탭(탭 저장소가 다르다)
  const b = setup({ storage, href: "https://play.example.test/" });
  assert.equal(b.log.consumeRunReset(), false);
  assert.equal(a.log.consumeRunReset(), true);
});

test("저장소가 없으면 회차 · 대기열을 메모리에 고정한다(Codex 리뷰 7)", async () => {
  const log = createBetaLog();
  const { fn, calls } = fakeFetch([{ status: 200, body: {} }]);
  log.init({ page: "naju", apiOrigin: "", href: "https://x.test/?pc=ABCD-1234", env: { storage: null, session: null, fetch: fn, setTimer: () => 0, clearTimer: () => {} } });
  log.setAccount("user-1");
  log.track("run_state", "start");
  log.track("run_state", "dawn");
  await log.flush();
  const events = (JSON.parse(String(calls[0].init.body)) as { events: BetaEvent[] }).events;
  assert.equal(events.length, 2);
  assert.equal(events[0].run_id, events[1].run_id);
});

test("저장소 쓰기가 실패하면 메모리 대기열로 넘어가 기록을 잃지 않는다", async () => {
  const storage = memoryStore();
  const { log, calls } = setup({ storage, responses: [{ status: 200, body: {} }] });
  storage.setItem = () => {
    throw new Error("QuotaExceeded");
  };
  log.track("run_state", "start");
  log.track("run_state", "dawn");
  await log.flush();
  assert.equal((JSON.parse(String(calls[0].init.body)) as { events: BetaEvent[] }).events.length, 2);
});

test("다른 탭이 다른 참여 코드로 들어오면 앞사람 탭은 더 쌓지도 보내지도 않는다(Codex 재확인 1)", async () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/?pc=AAAA-1111" });
  const b = setup({ storage, href: "https://play.example.test/?pc=BBBB-2222", responses: [{ status: 200, body: {} }] });
  a.log.track("run_state", "start");
  assert.equal(a.log.isActive(), false);
  b.log.track("run_state", "start");
  // 누가 대기열에 앞사람 코드를 넣어 두었어도 보내기 전에 버린다
  const q = queued(storage);
  storage.setItem(KEYS.queue, JSON.stringify([{ ...q[0], event_id: "x", pc: "AAAA-1111" }, ...q]));
  await b.log.flush();
  const sent = (JSON.parse(String(b.calls[0].init.body)) as { events: BetaEvent[] }).events;
  assert.deepEqual([...new Set(sent.map((e) => e.pc))], ["BBBB-2222"]);
});

test("참가자 변경 때 대기열을 지우지 못하면 빈 메모리 대기열로 간다(Codex 재확인 2)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/?pc=AAAA-1111", responses: [{ status: 503 }] });
  a.log.track("run_state", "start");
  const realSet = storage.setItem;
  storage.setItem = (key: string, value: string) => {
    if (key === KEYS.queue) throw new Error("blocked");
    realSet(key, value);
  };
  const b = setup({ storage, href: "https://play.example.test/?pc=BBBB-2222" });
  assert.equal(b.log.stats().queued, 0);
});

test("대기열 쓰기가 막힌(메모리) 탭도 다른 참여 코드가 들어오면 멈춘다(Codex 최종 확인)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/?pc=AAAA-1111", responses: [{ status: 503 }] });
  const realSet = storage.setItem;
  storage.setItem = (key: string, value: string) => {
    if (key === KEYS.queue) throw new Error("blocked");
    realSet(key, value);
  };
  a.log.track("run_state", "start"); // 메모리 대기열로 넘어간다
  setup({ storage, href: "https://play.example.test/?pc=BBBB-2222" });
  a.log.track("run_state", "released");
  assert.equal(a.log.isActive(), false);
});

test("늦게 물은 탭이 이긴다 — 먼저 물은 탭의 답이 나중에 와도 덮어쓰지 않고 그 탭만 멈춘다(Codex 재확인)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/", account: false });
  const b = setup({ storage, href: "https://play.example.test/", account: false });
  const ticketA = a.log.accountTicket();
  b.advance(500);
  const ticketB = b.log.accountTicket(); // B 가 로그인한 뒤 물었다
  b.log.setAccount("user-B", ticketB);
  a.log.setAccount("user-A", ticketA); // 늦게 도착한 A 의 낡은 답
  assert.equal(a.log.isActive(), false);
  assert.equal(b.log.isActive(), true);
  assert.equal(storage.getItem(KEYS.account), "user-B");
});

test("답이 물은 차례대로 오면(A 먼저 · B 나중) 나중에 물은 B 가 이기고 A 탭이 멈춘다(Codex 최종 확인)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/", account: false });
  const b = setup({ storage, href: "https://play.example.test/", account: false });
  const ticketA = a.log.accountTicket();
  b.advance(500);
  const ticketB = b.log.accountTicket();
  a.log.setAccount("user-A", ticketA);
  b.log.setAccount("user-B", ticketB);
  assert.equal(b.log.isActive(), true);
  assert.equal(storage.getItem(KEYS.account), "user-B");
  a.log.track("run_state", "released");
  assert.equal(a.log.isActive(), false);
});

test("주인을 모르는 옛 회차(계정 기록 없음)는 잇지 않는다(Codex 재확인)", () => {
  const storage = memoryStore();
  storage.setItem(KEYS.run, JSON.stringify({ id: "legacy-run", index: 3 }));
  const { log } = setup({ storage, href: "https://play.example.test/", account: "user-B" });
  const run = log.run();
  assert.notEqual(run?.id, "legacy-run");
  assert.equal(run?.index, 0);
});

test("물음 표는 함께 쓰는 수 없이 만든다 — 같은 순간에 물어도 겹치지 않는다(Codex 최종 확인)", () => {
  const storage = memoryStore();
  const a = setup({ storage, href: "https://play.example.test/", account: false });
  const b = setup({ storage, href: "https://play.example.test/", account: false });
  const tickets = new Set(Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).log.accountTicket()));
  assert.equal(tickets.size, 200);
});
