/**
 * 베타 기록 집계 — 관리자 「베타 기록」 화면과 tools/beta/beta-report.mjs 가 같이 쓰는 계산(수집 계획 v1.1 의 로그 지표).
 * 별칭 · React · 브라우저 API 가 없어 node 가 TS 를 바로 읽는다(npm run web:test).
 *
 * - 사람은 계정(로그인)으로 묶는다. 계정 없는 기록은 참여 코드로, 그 코드가 정확히 한 계정에만 붙어 있으면 그 계정으로 합친다.
 * - 숫자는 「N명 중 M명」으로 함께 보인다. 표본이 10명 미만이면 비율을 쓰지 않는다(수집 계획 3절).
 * - 시각은 서버가 시간대 없이 내려 주는 UTC 다(끝에 Z 를 붙여 읽는다).
 */

/** 서버 schemas/beta_event.py 의 BetaEventOut. */
export interface BetaEventRow {
  id: number;
  event_id: string;
  received_at: string;
  client_ts: string | null;
  event_type: string;
  phase: string | null;
  participant_code: string | null;
  run_id: string | null;
  run_index: number | null;
  tab_id: string | null;
  seq: number | null;
  objective_id: string | null;
  page: string | null;
  build: string | null;
  app_user_id: string | null;
  guest_session_id: string | null;
  data: Record<string, unknown> | null;
}

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- 기록마다 data 모양이 다르다

export interface BetaEvent extends Omit<BetaEventRow, "data"> {
  data: Data;
  /** client_ts(없으면 received_at)의 UTC 밀리초 */
  t: number;
  /** 사람 — "u:<계정>" · "c:<코드>" · null */
  who: string | null;
  /** 참가 번호 — 게임이 설문 폼에 미리 채운 값(계정 지문, 없으면 코드) */
  key: string | null;
}

export interface FunnelStep {
  name: string;
  people: number;
}

export interface ObjectiveRow {
  id: string;
  reached: number;
  done: number;
  pass: string;
  median: string;
  p75: string;
  fail3: string;
  serverWrong: string;
  help: string;
}

export interface PersonRow {
  who: string;
  key: string;
  account: string;
  started: boolean;
  dawn: boolean;
  activeSeconds: number | null;
  lastObjective: string;
}

/** 영상 한 편 — 사람마다 첫 기록 하나(오프닝은 처음 한 번만 튼다, 엔딩 필름은 다시 보기 제외) */
export interface VideoStat {
  /** 끝까지 봤거나 건너뛴 기록이 남은 사람 */
  people: number;
  skipped: number;
  completed: number;
  /** 건너뛴 사람이 본 시간(ms) — 오프닝은 영상 안의 초, 엔딩 필름은 열린 뒤 흐른 시간 */
  skipAtMs: number[];
  /** 건너뛴 장(1부터) — 엔딩 필름만 */
  skipShot: number[];
  /** 영상 길이(ms) · 장 수 — 있으면 */
  lengthMs: number[];
  shots: number[];
}

export interface BetaReport {
  now: number;
  events: BetaEvent[];
  people: number;
  accountPeople: number;
  codeOnlyPeople: number;
  firstAt: number | null;
  lastAt: number | null;
  builds: string[];
  funnel: FunnelStep[];
  firstRun: { starters: number; finished: number; observing: number };
  lastSpots: { spot: string; people: number; reached: number | null }[];
  objectives: ObjectiveRow[];
  personRows: PersonRow[];
  stars: { three: number; two: number; one: number };
  playTimes: number[];
  story: { najuPeople: number; heardAll: number };
  companion: {
    responses: number;
    withReply: number;
    noReply: number;
    fallback: number;
    errors: number;
    directRtt: number[];
  };
  errors: { category: string; people: number }[];
  najuLoad: { readyMs: number[]; timeouts: number };
  environments: { name: string; people: number }[];
  surveys: { kind: string; shown: number; opened: number; dismissedDone: number }[];
  videos: { opening: VideoStat; endingFilm: VideoStat };
  issuedCodes: number | null;
}

const DAY = 24 * 3600 * 1000;
const TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/;

/** 서버 시각(시간대 없는 UTC) → 밀리초. */
export function parseUtc(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const trimmed = value.trim().replace(/(\.\d{3})\d+/, "$1");
  return Date.parse(TIMEZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
}

/** 참가 번호 — src/beta/betaLog.ts shortKey 와 같은 식(FNV-1a, 8자리 대문자). */
export function shortKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").toUpperCase();
}

/** 표본이 10 미만이면 비율을 쓰지 않는다. */
export const pct = (m: number, n: number) => (n >= 10 ? `${((m / n) * 100).toFixed(1)}%` : "—(10명 미만)");
export const frac = (m: number, n: number) => `${n}명 중 ${m}명 · ${pct(m, n)}`;

export function quantile(values: readonly number[], q: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  return v[lo] + (v[Math.ceil(pos)] - v[lo]) * (pos - lo);
}

export const mmss = (ms: number | null) =>
  ms == null ? "—" : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
export const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}초`);

/** 내보내기 응답(들)에서 기록만 꺼낸다 — {events}, 배열, JSON Lines 모두 받는다. 같은 event_id 는 한 번. */
export function collectEvents(chunks: readonly unknown[]): BetaEventRow[] {
  const byId = new Map<string, BetaEventRow>();
  for (const chunk of chunks) {
    const list = Array.isArray(chunk)
      ? chunk
      : chunk && typeof chunk === "object" && Array.isArray((chunk as { events?: unknown }).events)
        ? (chunk as { events: unknown[] }).events
        : [chunk];
    for (const item of list) {
      const row = item as BetaEventRow | null;
      if (row?.event_id) byId.set(row.event_id, row);
    }
  }
  return [...byId.values()];
}

export interface BuildOptions {
  /** 집계 기준 시각(밀리초). 24시간 관찰 창에 쓴다 */
  now: number;
  /** 뺄 계정 id · 참여 코드 */
  exclude?: ReadonlySet<string>;
  /** 발급한 참여 코드 수(있으면 요약에 적는다) */
  issuedCodes?: number | null;
}

export function buildBetaReport(rows: readonly BetaEventRow[], options: BuildOptions): BetaReport {
  const exclude = options.exclude ?? new Set<string>();
  const NOW = options.now;

  const all: BetaEvent[] = rows
    .map((e) => {
      const t = parseUtc(e.client_ts);
      return {
        ...e,
        data: (e.data ?? {}) as Data,
        t: Number.isFinite(t) ? t : parseUtc(e.received_at),
        who: null,
        key: null,
      };
    })
    .sort((a, b) => a.t - b.t || (a.seq ?? 0) - (b.seq ?? 0));

  // 사람 — 계정으로 묶고, 코드가 정확히 한 계정에만 붙어 있을 때만 계정 없는 기록을 그 계정으로 합친다.
  // 묶기는 뺄 계정을 빼기 전 전체 기록으로 정한다(뺀 계정의 코드 기록이 따로 남거나, 공유 코드가 한 계정에 잘못 붙지 않게)
  const accountsOfCode = new Map<string, Set<string>>();
  for (const e of all) {
    if (!e.participant_code || !e.app_user_id) continue;
    if (!accountsOfCode.has(e.participant_code)) accountsOfCode.set(e.participant_code, new Set());
    accountsOfCode.get(e.participant_code)!.add(e.app_user_id);
  }
  const accountOfCode = (code: string) => {
    const set = accountsOfCode.get(code);
    return set && set.size === 1 ? [...set][0] : null;
  };
  const excluded = (e: BetaEvent) =>
    (e.who?.startsWith("u:") && exclude.has(e.who.slice(2))) ||
    (e.app_user_id != null && exclude.has(e.app_user_id)) ||
    (e.participant_code != null && exclude.has(e.participant_code));
  for (const e of all) {
    const account = e.app_user_id ?? (e.participant_code ? accountOfCode(e.participant_code) : null);
    e.who = account ? `u:${account}` : e.participant_code ? `c:${e.participant_code}` : null;
    // 게임과 같은 차례 — 계정이 있으면 늘 계정 지문, 없으면 참여 코드
    e.key = e.app_user_id ? shortKey(e.app_user_id) : (e.participant_code ?? null);
  }
  const events = all.filter((e) => !excluded(e));
  const pcs = [...new Set(events.map((e) => e.who).filter((w): w is string => Boolean(w)))];
  const byWho = new Map<string, BetaEvent[]>();
  for (const e of events) if (e.who) (byWho.get(e.who) ?? byWho.set(e.who, []).get(e.who)!).push(e);

  type Run = { id: string; index: number; events: BetaEvent[] };
  const people = pcs.map((pc) => {
    const list = byWho.get(pc) ?? [];
    const runs = new Map<string, Run>();
    for (const e of list) {
      if (e.run_id == null) continue;
      if (!runs.has(e.run_id)) runs.set(e.run_id, { id: e.run_id, index: e.run_index ?? 0, events: [] });
      runs.get(e.run_id)!.events.push(e);
    }
    const firstRun = [...runs.values()].sort((a, b) => a.index - b.index)[0] ?? null;
    return { pc, list, firstRun, users: new Set(list.map((e) => e.app_user_id).filter(Boolean) as string[]) };
  });
  const has = (list: BetaEvent[], type: string, phase?: string) =>
    list.some((e) => e.event_type === type && (phase == null || e.phase === phase));
  const runStart = (run: Run | null) =>
    run?.events.find((e) => e.event_type === "run_state" && (e.phase === "start" || e.phase === "resume"));
  const runDawn = (run: Run | null) => run?.events.find((e) => e.event_type === "run_state" && e.phase === "dawn");

  // L01 진입 단계
  const STEPS: [string, (l: BetaEvent[]) => boolean][] = [
    ["게임 첫 실행", (l) => has(l, "beta_entry")],
    ["캐릭터 생성 시작", (l) => has(l, "stage_reached", "character_open")],
    ["캐릭터 생성 완료(튜토리얼 시작)", (l) => has(l, "stage_reached", "character_done")],
    ["본부실 진입", (l) => has(l, "stage_reached", "headquarters")],
    ["나주 조작 가능", (l) => has(l, "stage_reached", "naju_controllable")],
    [
      "첫 퍼즐 해결(P01)",
      (l) => l.some((e) => e.event_type === "objective_state" && e.phase === "complete" && e.objective_id === "P01"),
    ],
    ["엔딩(동트기)", (l) => has(l, "run_state", "dawn")],
  ];
  const funnel = STEPS.map(([name, test]) => ({ name, people: people.filter((p) => test(p.list)).length }));

  // L02 첫 회차 24시간 완주 · L06 미완주 마지막 관측 지점
  let starters = 0;
  let finished = 0;
  let observing = 0;
  const spots = new Map<string, number>();
  for (const p of people) {
    const run = p.firstRun;
    const start = runStart(run);
    if (!run || !start) continue;
    if (start.phase === "resume" && (start.data.completed_at_start as unknown[] | undefined)?.length) continue; // 예전 저장을 이어 한 사람은 따로
    starters += 1;
    const dawn = run.events.find((e) => e.event_type === "run_state" && e.phase === "dawn" && e.t - start.t <= DAY);
    if (dawn) finished += 1;
    else if (NOW - start.t < DAY) observing += 1;
    else {
      const last = [...run.events].reverse().find((e) => e.objective_id);
      const spot = last?.objective_id ?? "(목표 없음)";
      spots.set(spot, (spots.get(spot) ?? 0) + 1);
    }
  }

  // L03 · L04 · L07 · L08 목표별(첫 회차만, 실시간 완료만)
  type Obj = {
    id: string;
    reached: Set<string>;
    done: Set<string>;
    times: number[];
    fails: Map<string, number>;
    helpers: Set<string>;
    serverWrong: number;
    serverTries: number;
  };
  const objectives = new Map<string, Obj>();
  const obj = (id: string) => {
    if (!objectives.has(id))
      objectives.set(id, {
        id,
        reached: new Set(),
        done: new Set(),
        times: [],
        fails: new Map(),
        helpers: new Set(),
        serverWrong: 0,
        serverTries: 0,
      });
    return objectives.get(id)!;
  };
  for (const p of people) {
    const run = p.firstRun;
    if (!run) continue;
    const availAt = new Map<string, number>();
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
        if (availAt.has(id) && Number.isFinite(e.data.active_ms)) o.times.push(e.data.active_ms - availAt.get(id)!);
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
  const objectiveRows: ObjectiveRow[] = [...objectives.values()].map((o) => {
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
  const lastSpots = [...spots.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([spot, n]) => ({ spot, people: n, reached: objectives.get(spot)?.reached.size ?? null }));

  // 사람 목록 — 참가 번호로 설문 응답과 맞출 때 쓴다
  const personRows: PersonRow[] = people.map((p) => {
    const run = p.firstRun;
    const dawn = runDawn(run);
    const sample = p.list.find((e) => e.app_user_id) ?? p.list.find((e) => e.key);
    return {
      who: p.pc,
      key: sample?.key ?? "",
      account: [...p.users][0] ?? "",
      started: Boolean(runStart(run)),
      dawn: Boolean(dawn),
      activeSeconds: dawn?.data.active_ms ? Math.round(dawn.data.active_ms / 1000) : null,
      lastObjective: run ? ([...run.events].reverse().find((e) => e.objective_id)?.objective_id ?? "") : "",
    };
  });

  // L09 별 · L17 한 판 시간
  const stars = { three: 0, two: 0, one: 0 };
  const playTimes: number[] = [];
  for (const p of people) {
    const run = p.firstRun;
    const dawn = runDawn(run);
    if (!run || !dawn) continue;
    const received = run.events.filter(
      (e) => e.event_type === "help_event" && e.phase === "received" && e.t <= dawn.t,
    ).length;
    const answer = run.events.some((e) => e.event_type === "help_event" && e.phase === "answer_seen");
    if (answer) stars.one += 1;
    else if (received > 0) stars.two += 1;
    else stars.three += 1;
    if (Number.isFinite(dawn.data.active_ms)) playTimes.push(dawn.data.active_ms);
  }

  // L10a 설화 근거 줄
  const naju = people.filter((p) => has(p.list, "stage_reached", "naju_controllable"));
  const heardAll = naju.filter((p) => {
    const ev = new Set(
      p.list.filter((e) => e.event_type === "story_exposure" && e.data.evidence).map((e) => e.data.evidence),
    );
    return ev.has("c2_rock") && ev.has("c3_that_day") && ev.has("c3_ask");
  });

  // L11 동행
  const turns = events.filter((e) => e.event_type === "npc_turn");
  const responses = turns.filter((e) => e.phase === "response");
  const errorTurns = turns.filter((e) => e.phase === "error");

  // L13 오류 · L14 로딩 · L16 환경
  const errPeople = new Map<string, Set<string | null>>();
  for (const e of events.filter((x) => x.event_type === "client_error")) {
    const category = e.phase ?? "(분류 없음)";
    if (!errPeople.has(category)) errPeople.set(category, new Set());
    errPeople.get(category)!.add(e.who);
  }
  const loads = events.filter((e) => e.event_type === "stage_reached" && e.phase === "load_done" && e.page === "naju");
  const envCount = new Map<string, number>();
  for (const p of people) {
    const entry = p.list.find((e) => e.event_type === "beta_entry");
    if (!entry) continue;
    const name = `${entry.data.os ?? "?"} · ${entry.data.browser ?? "?"}`;
    envCount.set(name, (envCount.get(name) ?? 0) + 1);
  }

  // 영상(미르 11/12) — 오프닝 SKIP · 엔딩 필름 건너뛰기
  const msOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value * 1000 : null);
  const countOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const videoStat = (objective: string, at: string): VideoStat => {
    const firsts = people
      .map((p) =>
        p.list.find(
          (e) =>
            e.event_type === "story_exposure" &&
            e.objective_id === objective &&
            (e.phase === "skipped" || e.phase === "completed") &&
            !e.data.rewatch,
        ),
      )
      .filter((e): e is BetaEvent => e !== undefined);
    const skipped = firsts.filter((e) => e.phase === "skipped");
    const only = <T,>(values: (T | null)[]) => values.filter((v): v is T => v !== null);
    return {
      people: firsts.length,
      skipped: skipped.length,
      completed: firsts.length - skipped.length,
      skipAtMs: only(skipped.map((e) => msOf(e.data[at]))),
      skipShot: only(skipped.map((e) => countOf(e.data.shot))),
      lengthMs: only(firsts.map((e) => msOf(e.data.duration_sec))),
      shots: only(firsts.map((e) => countOf(e.data.shots))),
    };
  };

  // L19 설문
  const survey = (kind: string, phase: string) =>
    new Set(
      events
        .filter((e) => e.event_type === "survey_link" && e.data.kind === kind && e.phase === phase)
        .map((e) => e.who),
    ).size;

  return {
    now: NOW,
    events,
    people: pcs.length,
    accountPeople: pcs.filter((k) => k.startsWith("u:")).length,
    codeOnlyPeople: pcs.filter((k) => k.startsWith("c:")).length,
    firstAt: events[0]?.t ?? null,
    lastAt: events.at(-1)?.t ?? null,
    builds: [...new Set(events.map((e) => e.build).filter((b): b is string => Boolean(b)))],
    funnel,
    firstRun: { starters, finished, observing },
    lastSpots,
    objectives: objectiveRows,
    personRows,
    stars,
    playTimes,
    story: { najuPeople: naju.length, heardAll: heardAll.length },
    companion: {
      responses: responses.length,
      withReply: responses.filter((e) => e.data.has_reply).length,
      noReply: responses.filter((e) => !e.data.has_reply).length,
      fallback: responses.filter((e) => e.data.fallback_reason).length,
      errors: errorTurns.length,
      directRtt: responses.filter((e) => e.data.trigger === "player_message").map((e) => e.data.rtt_ms),
    },
    errors: [...errPeople.entries()].map(([category, set]) => ({ category, people: set.size })),
    najuLoad: {
      readyMs: loads.filter((e) => e.data.result === "ready").map((e) => e.data.at_ms),
      timeouts: loads.filter((e) => e.data.result === "timeout").length,
    },
    environments: [...envCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, people: n })),
    surveys: ["pre", "post", "exit"].map((kind) => ({
      kind,
      shown: survey(kind, "shown"),
      opened: survey(kind, "opened"),
      dismissedDone: survey(kind, "dismissed_done"),
    })),
    videos: { opening: videoStat("opening", "at_sec"), endingFilm: videoStat("ending_film", "watched_sec") },
    issuedCodes: options.issuedCodes ?? null,
  };
}

// ── 내려받기 파일(엑셀이 한글을 읽게 BOM 을 붙인다) ──

const BOM = "﻿";
export function csvCell(value: unknown): string {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csv = (lines: string[]) => `${BOM}${lines.join("\n")}\n`;

const EVENT_COLUMNS = [
  "id",
  "event_id",
  "client_ts",
  "received_at",
  "who",
  "key",
  "participant_code",
  "event_type",
  "phase",
  "page",
  "run_id",
  "run_index",
  "objective_id",
  "tab_id",
  "seq",
  "app_user_id",
  "guest_session_id",
  "build",
  "data",
] as const;

export const eventsCsv = (report: BetaReport) =>
  csv([
    EVENT_COLUMNS.join(","),
    ...report.events.map((e) =>
      EVENT_COLUMNS.map((c) => csvCell((e as unknown as Record<string, unknown>)[c])).join(","),
    ),
  ]);

export const peopleCsv = (report: BetaReport) =>
  csv([
    "사람,참가 번호,계정 id,첫 판 시작,첫 판 엔딩,조사 시간(초),마지막 목표",
    ...report.personRows.map((r) =>
      [r.who, r.key, r.account, r.started ? "예" : "", r.dawn ? "예" : "", r.activeSeconds ?? "", r.lastObjective]
        .map(csvCell)
        .join(","),
    ),
  ]);

export const objectivesCsv = (report: BetaReport) =>
  csv([
    "목표,도달,완료,통과율,완료 시간 가운데,느린 쪽(75%),3번 이상 실패,서버 오답/판정,직접 도움 요청",
    ...report.objectives.map((r) =>
      [r.id, r.reached, r.done, r.pass, r.median, r.p75, r.fail3, r.serverWrong, r.help].map(csvCell).join(","),
    ),
  ]);

export function summaryMarkdown(report: BetaReport): string {
  const md: string[] = [];
  const w = (s = "") => md.push(s);
  const { funnel, firstRun, companion } = report;
  const iso = (t: number | null) => (t == null ? "—" : new Date(t).toISOString());
  w("# 베타 기록 집계");
  w();
  w(
    `- 기록 ${report.events.length}건 · 사람 ${report.people}명(계정 ${report.accountPeople} · 코드만 ${report.codeOnlyPeople})${report.issuedCodes ? ` · 발급 코드 ${report.issuedCodes}개` : ""} · 집계 시각 ${iso(report.now)}`,
  );
  w(`- 기간 ${iso(report.firstAt)} ~ ${iso(report.lastAt)} · 빌드 ${report.builds.join(", ") || "—"}`);
  w();
  w("## L01 진입 단계");
  w();
  w("| 단계 | 사람 | 앞 단계 대비 |");
  w("|---|---|---|");
  funnel.forEach((step, i) =>
    w(`| ${step.name} | ${step.people} | ${i === 0 ? "—" : pct(step.people, funnel[i - 1].people)} |`),
  );
  w();
  w("## L02 첫 판 완주(24시간)");
  w();
  w(
    `- 나주 첫 시작 ${firstRun.starters}명 중 24시간 안에 엔딩 ${firstRun.finished}명 · ${pct(firstRun.finished, firstRun.starters - firstRun.observing)} (관찰 중 ${firstRun.observing}명은 분모에서 뺌)`,
  );
  w();
  w("## L06 미완주 마지막 관측 지점");
  w();
  for (const s of report.lastSpots) w(`- ${s.spot}: ${s.people}명 (도달 ${s.reached ?? "—"}명)`);
  w();
  w("## L03 · L04 · L07 · L08 목표별 — objectives.csv");
  w();
  w("| 목표 | 도달 | 완료 | 통과율 | 가운데 시간 | 75% | 3번+ 실패 | 서버 오답 | 도움 요청 |");
  w("|---|---|---|---|---|---|---|---|---|");
  for (const r of report.objectives)
    w(
      `| ${r.id} | ${r.reached} | ${r.done} | ${r.pass} | ${r.median} | ${r.p75} | ${r.fail3} | ${r.serverWrong} | ${r.help} |`,
    );
  w();
  w("## L09 별 · L17 한 판 시간(첫 판 완주자)");
  w();
  w(`- 별 ★★★ ${report.stars.three} · ★★ ${report.stars.two} · ★ ${report.stars.one}`);
  w(
    `- 조사 시간 가운데 ${mmss(quantile(report.playTimes, 0.5))} · 75% ${mmss(quantile(report.playTimes, 0.75))} (${report.playTimes.length}명)`,
  );
  w();
  w("## L10a 설화 근거 줄");
  w();
  w(`- 나주 시작 ${frac(report.story.heardAll, report.story.najuPeople)}이 근거 줄 세 개를 모두 봤다`);
  w();
  w("## L11 동행");
  w();
  w(
    `- 응답 ${companion.responses}건(대답 있음 ${companion.withReply} · 할 말 없음 ${companion.noReply} · 대체 문구 ${companion.fallback}) · 실패 ${companion.errors}건 · 실패율 ${pct(companion.errors, companion.responses + companion.errors)}`,
  );
  w(
    `- 직접 요청 왕복 가운데 ${sec(quantile(companion.directRtt, 0.5))} · 95% ${sec(quantile(companion.directRtt, 0.95))} (${companion.directRtt.length}건, 서버 왕복 기준)`,
  );
  w();
  w("## L13 오류(사람 수)");
  w();
  for (const e of report.errors) w(`- ${e.category}: ${e.people}명`);
  w();
  w("## L14 나주 로딩(준비 완료)");
  w();
  w(
    `- 가운데 ${sec(quantile(report.najuLoad.readyMs, 0.5))} · 75% ${sec(quantile(report.najuLoad.readyMs, 0.75))} (${report.najuLoad.readyMs.length}건) · 시간 초과 ${report.najuLoad.timeouts}건`,
  );
  w();
  w("## 영상(처음 볼 때)");
  w();
  const { opening, endingFilm } = report.videos;
  w(
    `- 오프닝: ${frac(opening.skipped, opening.people)}이 SKIP · 누른 때 가운데 ${sec(quantile(opening.skipAtMs, 0.5))} (영상 길이 ${sec(quantile(opening.lengthMs, 0.5))})`,
  );
  w(
    `- 엔딩 필름: ${frac(endingFilm.skipped, endingFilm.people)}이 건너뜀 · 가운데 ${quantile(endingFilm.skipShot, 0.5) ?? "—"}번째 장 / ${quantile(endingFilm.shots, 0.5) ?? "—"}장 · 연 뒤 ${sec(quantile(endingFilm.skipAtMs, 0.5))}`,
  );
  w();
  w("## L16 환경");
  w();
  for (const env of report.environments) w(`- ${env.name}: ${env.people}명`);
  w();
  w("## L19 수집 · 설문");
  w();
  w(
    `- 기록이 남은 사람 ${report.people}명${report.issuedCodes ? ` / 발급 코드 ${report.issuedCodes}` : ""} — 참가자 명단(가입 계정 수)과 맞춰 본다`,
  );
  for (const s of report.surveys)
    w(
      `- ${s.kind}: 안내 ${s.shown}명 · 엶 ${s.opened}명 · 「이미 함」 ${s.dismissedDone}명 (제출 여부는 폼 응답과 맞춘다)`,
    );
  w();
  w(
    "> 숫자는 첫 판 · 실시간 기록 기준. 표본이 10명 미만이면 비율을 쓰지 않는다. 시간은 조사 시계(창 · 멈춤 · 게임 밖 제외) 기준. 시각은 UTC.",
  );
  return `${md.join("\n")}\n`;
}
