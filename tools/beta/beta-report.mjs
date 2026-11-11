// 베타 기록 집계 — 관리자 내보내기(GET /api/v1/admin/beta-events)로 받은 JSON 파일들을 읽어 수집 계획(v1.1)의 로그 지표를 만든다.
// node tools/beta/beta-report.mjs <출력 폴더> <내보내기.json> [내보내기2.json …] [--codes 코드.csv] [--now 2026-11-14T00:00:00Z]
// 출력: events.csv(원시) · summary.md(지표 요약) · objectives.csv(목표별 도달 · 완료 · 시간 · 실패 · 도움)
// 숫자는 「N명 중 M명」으로 함께 적는다. 표본이 작으면(<10) 비율 대신 사람 수만 본다(수집 계획 3절).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outDir = args.shift();
const files = [];
let codesFile = null;
let nowArg = null;
while (args.length) {
  const a = args.shift();
  if (a === "--codes") codesFile = args.shift();
  else if (a === "--now") nowArg = args.shift();
  else files.push(a);
}
if (!outDir || files.length === 0) {
  console.error("사용법: node tools/beta/beta-report.mjs <출력 폴더> <내보내기.json …> [--codes 코드.csv] [--now ISO시각]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const NOW = nowArg ? Date.parse(nowArg) : Date.now();
const DAY = 24 * 3600 * 1000;

// ── 읽기(같은 event_id 는 한 번) ──
const byId = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8").trim();
  let chunks;
  try {
    chunks = [JSON.parse(text)];
  } catch {
    // 한 줄에 하나(JSON Lines)
    chunks = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  for (const chunk of chunks) {
    const list = Array.isArray(chunk) ? chunk : chunk.events ?? [chunk];
    for (const e of list) if (e?.event_id) byId.set(e.event_id, e);
  }
}
const events = [...byId.values()].map((e) => ({ ...e, t: Date.parse(e.client_ts), data: e.data ?? {} })).sort((a, b) => a.t - b.t || (a.seq ?? 0) - (b.seq ?? 0));
const pcs = [...new Set(events.map((e) => e.participant_code).filter(Boolean))];

// ── 도구 ──
const pct = (m, n) => (n >= 10 ? `${((m / n) * 100).toFixed(1)}%` : "—(10명 미만)");
const frac = (m, n) => `${n}명 중 ${m}명 · ${pct(m, n)}`;
function quantile(values, q) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  return v[lo] + (v[Math.ceil(pos)] - v[lo]) * (pos - lo);
}
const mmss = (ms) => (ms == null ? "—" : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`);
const sec = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}초`);
const of = (pc) => events.filter((e) => e.participant_code === pc);
const csvCell = (v) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

// ── 원시 CSV ──
const cols = ["id", "event_id", "client_ts", "received_at", "participant_code", "event_type", "phase", "page", "run_id", "run_index", "objective_id", "tab_id", "seq", "app_user_id", "guest_session_id", "build", "data"];
writeFileSync(`${outDir}/events.csv`, `\uFEFF${[cols.join(","), ...events.map((e) => cols.map((c) => csvCell(e[c])).join(","))].join("\n")}\n`);

// ── 사람별 정리 ──
const people = pcs.map((pc) => {
  const list = of(pc);
  const runs = new Map();
  for (const e of list) {
    if (e.run_id == null) continue;
    if (!runs.has(e.run_id)) runs.set(e.run_id, { id: e.run_id, index: e.run_index ?? 0, events: [] });
    runs.get(e.run_id).events.push(e);
  }
  const firstRun = [...runs.values()].sort((a, b) => a.index - b.index)[0] ?? null;
  return { pc, list, runs, firstRun, users: new Set(list.map((e) => e.app_user_id).filter(Boolean)) };
});
const has = (list, type, phase) => list.some((e) => e.event_type === type && (phase == null || e.phase === phase));

// L01 진입 단계
const STEPS = [
  ["게임 첫 실행", (l) => has(l, "beta_entry")],
  ["캐릭터 생성 시작", (l) => has(l, "stage_reached", "character_open")],
  ["캐릭터 생성 완료(튜토리얼 시작)", (l) => has(l, "stage_reached", "character_done")],
  ["본부실 진입", (l) => has(l, "stage_reached", "headquarters")],
  ["나주 조작 가능", (l) => has(l, "stage_reached", "naju_controllable")],
  ["첫 퍼즐 해결(P01)", (l) => l.some((e) => e.event_type === "objective_state" && e.phase === "complete" && e.objective_id === "P01")],
  ["엔딩(동트기)", (l) => has(l, "run_state", "dawn")],
];
const funnel = STEPS.map(([name, test]) => [name, people.filter((p) => test(p.list)).length]);

// L02 첫 회차 24시간 완주
let starters = 0, finished = 0, observing = 0;
const lastSpots = new Map();
for (const p of people) {
  const run = p.firstRun;
  if (!run) continue;
  const start = run.events.find((e) => e.event_type === "run_state" && (e.phase === "start" || e.phase === "resume"));
  if (!start) continue;
  if (start.phase === "resume" && start.data.completed_at_start?.length) continue; // 예전 저장을 이어 한 사람은 따로
  starters += 1;
  const dawn = run.events.find((e) => e.event_type === "run_state" && e.phase === "dawn" && e.t - start.t <= DAY);
  if (dawn) finished += 1;
  else if (NOW - start.t < DAY) observing += 1;
  else {
    // L06 마지막 관측 지점 — 그 회차의 마지막 목표(있으면)
    const last = [...run.events].reverse().find((e) => e.objective_id);
    const spot = last?.objective_id ?? "(목표 없음)";
    lastSpots.set(spot, (lastSpots.get(spot) ?? 0) + 1);
  }
}

// L03 · L04 · L07 · L08 목표별(첫 회차만, 실시간 완료만)
const objectives = new Map();
const obj = (id) => {
  if (!objectives.has(id)) objectives.set(id, { id, reached: new Set(), done: new Set(), times: [], fails: new Map(), helpers: new Set(), serverWrong: 0, serverTries: 0 });
  return objectives.get(id);
};
for (const p of people) {
  const run = p.firstRun;
  if (!run) continue;
  const availAt = new Map();
  for (const e of run.events) {
    const id = e.objective_id;
    if (!id) continue;
    if (e.event_type === "objective_state" && (e.phase === "available" || e.phase === "focus")) {
      obj(id).reached.add(p.pc);
      if (e.phase === "available" && !availAt.has(id)) availAt.set(id, e.data.active_ms);
    }
    if (e.event_type === "objective_state" && e.phase === "complete" && e.data.origin === "live") {
      const o = obj(id);
      o.reached.add(p.pc);
      o.done.add(p.pc);
      if (availAt.has(id) && Number.isFinite(e.data.active_ms)) o.times.push(e.data.active_ms - availAt.get(id));
    }
    if (e.event_type === "puzzle_attempt") {
      const o = obj(id);
      if (e.phase === "fail") o.fails.set(p.pc, (o.fails.get(p.pc) ?? 0) + 1);
      if (e.data.source === "server" && (e.phase === "correct" || e.phase === "incorrect")) {
        o.serverTries += 1;
        if (e.phase === "incorrect") o.serverWrong += 1;
      }
    }
    if (e.event_type === "help_event" && e.phase === "request") obj(id).helpers.add(p.pc);
  }
}
const objRows = [...objectives.values()].map((o) => {
  const reached = o.reached.size;
  const fail3 = [...o.fails.values()].filter((n) => n >= 3).length;
  return {
    id: o.id,
    reached,
    done: o.done.size,
    pass: reached >= 20 ? pct(o.done.size, reached) : reached ? `${o.done.size}/${reached}(20명 미만)` : "—",
    median: o.times.length >= 10 ? mmss(quantile(o.times, 0.5)) : `${o.times.length}명(10명 미만)`,
    p75: o.times.length >= 10 ? mmss(quantile(o.times, 0.75)) : "—",
    fail3: `${fail3}/${reached}`,
    serverWrong: o.serverTries ? `${o.serverWrong}/${o.serverTries}` : "—",
    help: `${o.helpers.size}/${reached}`,
  };
});
writeFileSync(
  `${outDir}/objectives.csv`,
  `\uFEFF목표,도달,완료,통과율,완료 시간 가운데,느린 쪽(75%),3번 이상 실패,서버 오답/판정,직접 도움 요청\n${objRows.map((r) => [r.id, r.reached, r.done, r.pass, r.median, r.p75, r.fail3, r.serverWrong, r.help].map(csvCell).join(",")).join("\n")}\n`,
);

// L09 별 · L17 한 판 시간
const stars = { 3: 0, 2: 0, 1: 0 };
const playTimes = [];
for (const p of people) {
  const run = p.firstRun;
  const dawn = run?.events.find((e) => e.event_type === "run_state" && e.phase === "dawn");
  if (!dawn) continue;
  const received = run.events.filter((e) => e.event_type === "help_event" && e.phase === "received" && e.t <= dawn.t).length;
  const answer = run.events.some((e) => e.event_type === "help_event" && e.phase === "answer_seen");
  stars[answer ? 1 : received > 0 ? 2 : 3] += 1;
  if (Number.isFinite(dawn.data.active_ms)) playTimes.push(dawn.data.active_ms);
}

// L10a 설화 근거 줄
const naju = people.filter((p) => has(p.list, "stage_reached", "naju_controllable"));
const heardAll = naju.filter((p) => {
  const ev = new Set(p.list.filter((e) => e.event_type === "story_exposure" && e.data.evidence).map((e) => e.data.evidence));
  return ev.has("c2_rock") && ev.has("c3_that_day") && ev.has("c3_ask");
});

// L11 동행
const turns = events.filter((e) => e.event_type === "npc_turn");
const responses = turns.filter((e) => e.phase === "response");
const errorsTurn = turns.filter((e) => e.phase === "error");
const direct = responses.filter((e) => e.data.trigger === "player_message").map((e) => e.data.rtt_ms);

// L13 오류 · L14 로딩 · L16 환경
const errPeople = new Map();
for (const e of events.filter((x) => x.event_type === "client_error")) {
  if (!errPeople.has(e.phase)) errPeople.set(e.phase, new Set());
  errPeople.get(e.phase).add(e.participant_code);
}
const loads = events.filter((e) => e.event_type === "stage_reached" && e.phase === "load_done" && e.page === "naju");
const loadMs = loads.filter((e) => e.data.result === "ready").map((e) => e.data.at_ms);
const envCount = new Map();
for (const p of people) {
  const entry = p.list.find((e) => e.event_type === "beta_entry");
  if (!entry) continue;
  const key = `${entry.data.os ?? "?"} · ${entry.data.browser ?? "?"}`;
  envCount.set(key, (envCount.get(key) ?? 0) + 1);
}

// L19 수집 · 설문
let issued = null;
if (codesFile) issued = readFileSync(codesFile, "utf8").split("\n").slice(1).filter((l) => l.trim()).length;
const survey = (kind, phase) => new Set(events.filter((e) => e.event_type === "survey_link" && e.data.kind === kind && e.phase === phase).map((e) => e.participant_code)).size;

// ── 요약 ──
const md = [];
const w = (s = "") => md.push(s);
w("# 베타 기록 집계");
w();
w(`- 기록 ${events.length}건 · 참여 코드 ${pcs.length}개${issued ? ` (발급 ${issued}개)` : ""} · 계정 연결 ${people.filter((p) => p.users.size).length}명 · 집계 시각 ${new Date(NOW).toISOString()}`);
w(`- 기간 ${events[0]?.client_ts ?? "—"} ~ ${events.at(-1)?.client_ts ?? "—"} · 빌드 ${[...new Set(events.map((e) => e.build).filter(Boolean))].join(", ") || "—"}`);
w();
w("## L01 진입 단계");
w();
w("| 단계 | 사람 | 앞 단계 대비 |");
w("|---|---|---|");
funnel.forEach(([name, n], i) => w(`| ${name} | ${n} | ${i === 0 ? "—" : pct(n, funnel[i - 1][1])} |`));
w();
w("## L02 첫 판 완주(24시간)");
w();
w(`- 나주 첫 시작 ${starters}명 중 24시간 안에 엔딩 ${finished}명 · ${pct(finished, starters - observing)} (관찰 중 ${observing}명은 분모에서 뺌)`);
w();
w("## L06 미완주 마지막 관측 지점");
w();
for (const [spot, n] of [...lastSpots.entries()].sort((a, b) => b[1] - a[1])) w(`- ${spot}: ${n}명 (도달 ${objectives.get(spot)?.reached.size ?? "—"}명)`);
w();
w("## L03 · L04 · L07 · L08 목표별 — objectives.csv");
w();
w("| 목표 | 도달 | 완료 | 통과율 | 가운데 시간 | 75% | 3번+ 실패 | 서버 오답 | 도움 요청 |");
w("|---|---|---|---|---|---|---|---|---|");
for (const r of objRows) w(`| ${r.id} | ${r.reached} | ${r.done} | ${r.pass} | ${r.median} | ${r.p75} | ${r.fail3} | ${r.serverWrong} | ${r.help} |`);
w();
w("## L09 별 · L17 한 판 시간(첫 판 완주자)");
w();
w(`- 별 ★★★ ${stars[3]} · ★★ ${stars[2]} · ★ ${stars[1]}`);
w(`- 조사 시간 가운데 ${mmss(quantile(playTimes, 0.5))} · 75% ${mmss(quantile(playTimes, 0.75))} (${playTimes.length}명)`);
w();
w("## L10a 설화 근거 줄");
w();
w(`- 나주 시작 ${frac(heardAll.length, naju.length)}이 근거 줄 세 개를 모두 봤다`);
w();
w("## L11 동행");
w();
w(`- 응답 ${responses.length}건(대답 있음 ${responses.filter((e) => e.data.has_reply).length} · 할 말 없음 ${responses.filter((e) => !e.data.has_reply).length} · 대체 문구 ${responses.filter((e) => e.data.fallback_reason).length}) · 실패 ${errorsTurn.length}건 · 실패율 ${pct(errorsTurn.length, responses.length + errorsTurn.length)}`);
w(`- 직접 요청 왕복 가운데 ${sec(quantile(direct, 0.5))} · 95% ${sec(quantile(direct, 0.95))} (${direct.length}건, 서버 왕복 기준)`);
w();
w("## L13 오류(사람 수)");
w();
for (const [cat, set] of errPeople) w(`- ${cat}: ${set.size}명`);
w();
w("## L14 나주 로딩(준비 완료)");
w();
w(`- 가운데 ${sec(quantile(loadMs, 0.5))} · 75% ${sec(quantile(loadMs, 0.75))} (${loadMs.length}건) · 시간 초과 ${loads.filter((e) => e.data.result === "timeout").length}건`);
w();
w("## L16 환경");
w();
for (const [k, n] of [...envCount.entries()].sort((a, b) => b[1] - a[1])) w(`- ${k}: ${n}명`);
w();
w("## L19 수집 · 설문");
w();
w(`- 기록이 남은 참여 코드 ${pcs.length}${issued ? ` / 발급 ${issued}` : ""}`);
for (const kind of ["pre", "post", "exit"]) w(`- ${kind}: 안내 ${survey(kind, "shown")}명 · 엶 ${survey(kind, "opened")}명 · 「이미 함」 ${survey(kind, "dismissed_done")}명 (제출 여부는 폼 응답과 맞춘다)`);
w();
w("> 숫자는 첫 판 · 실시간 기록 기준. 표본이 10명 미만이면 비율을 쓰지 않는다. 시간은 조사 시계(창 · 멈춤 · 게임 밖 제외) 기준.");
writeFileSync(`${outDir}/summary.md`, `${md.join("\n")}\n`);
console.log(`${events.length}건 · ${pcs.length}명 → ${outDir}/summary.md · objectives.csv · events.csv`);
