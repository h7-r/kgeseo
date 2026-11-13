/**
 * 나주 베타 기록 — 회차 · 시작 · 목표 · 엔딩 · 활동(15초) · 동행 · 도움 · 대사를 betaLog 로 남긴다(미르 11/11).
 * 참여 코드가 없으면 betaLog 가 아무것도 받지 않는다. 여기서 난 오류는 게임으로 새지 않는다.
 *
 * 시간: 모든 기록에 active_ms(조사 시계 playClock — 창 · 멈춤 · 게임 밖 · 시작 카드 시간을 뺀 누적)를 붙인다.
 *       퍼즐 시간은 같은 회차의 「처음 지금 목표가 된 때(available)」와 「완료(complete)」의 active_ms 차이로 본다.
 * 목표: 1초마다 퍼즐 상태로 본 완료 목록 · 지금 목표를 읽어 바뀐 것만 남긴다. 페이지를 연 때 이미 끝나 있던 것(이어 하기 복원)은
 *       완료로 다시 세지 않고 시작 기록(completed_at_start)에 적는다.
 */
import { droppedLookSpikes } from "@/engine/input/lookGuard";
import { betaLog } from "@/beta/betaLog";
import { onBetaHidden, trackError } from "@/beta/betaBoot";

import { completedObjectives, currentObjective } from "../dialogue/gameObserver";
import { betaSignals } from "./betaSignals";
import { cliff } from "../puzzles/cliff/cliffState";
import { gut } from "../puzzles/gut/gutState";
import { attemptCount } from "../progress/attemptCount";
import { helpLog } from "../progress/helpLog";
import { playClock } from "../progress/playClock";

const TICK_MS = 1000;
const SNAPSHOT_MS = 15_000;
/** 이 회차에서 이미 「처음 지금 목표가 됐다」를 남긴 목표(새로 고침에도 두 번 남기지 않게) */
const availKey = (runId: string) => `waegok.beta.avail.${runId}`;

let hasStarted = false;
let tickTimer = 0;
let snapshotTimer = 0;
let lastCompleted = new Set<string>();
let lastFocus: string | null = null;
let availableSeen = new Set<string>();
let lastGut: string | null = null;
let lastCliff: string | null = null;
let isReadyNoted = false;

const activeMs = () => Math.round(playClock.elapsed());

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    // 기록이 게임을 막으면 안 된다
  }
}

function loadAvailable(): Set<string> {
  const run = betaLog.run();
  if (!run) return new Set();
  try {
    const raw = localStorage.getItem(availKey(run.id));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveAvailable() {
  const run = betaLog.run();
  if (!run) return;
  try {
    localStorage.setItem(availKey(run.id), JSON.stringify([...availableSeen]));
  } catch {
    /* 무시 */
  }
}

function readCompleted(): Set<string> {
  const done = new Set<string>(completedObjectives());
  // 바위 위 · 굿판은 목표표 밖 — 단계로 덧붙인다
  if (cliff.isAtLeast("crossed")) done.add("CLIFF");
  if (gut.stage() === "released" || gut.stage() === "dawn") done.add("GUT");
  return done;
}

function tick() {
  safe(() => {
    const completed = readCompleted();
    for (const id of completed) {
      if (lastCompleted.has(id)) continue;
      betaLog.track("objective_state", "complete", { objective_id: id, data: { active_ms: activeMs(), origin: "live" } });
    }
    lastCompleted = completed;
    // 목표표 밖의 끝 두 단계 — 능선 틈을 지났으면 바위 위, 바위 위를 건넜으면 굿판
    const tail = completed.has("S3_RIFT") ? (!completed.has("CLIFF") ? "CLIFF" : !completed.has("GUT") ? "GUT" : null) : null;
    const focus = currentObjective(null, completedObjectives()) ?? tail;
    if (focus && !availableSeen.has(focus) && !completed.has(focus)) {
      availableSeen.add(focus);
      saveAvailable();
      betaLog.track("objective_state", "available", { objective_id: focus, data: { active_ms: activeMs(), basis: "first_focus" } });
    }
    if (focus !== lastFocus) {
      lastFocus = focus;
      if (focus) betaLog.track("objective_state", "focus", { objective_id: focus, data: { active_ms: activeMs() } });
    }
  });
}

/** 활동 기록 — 마지막 위치 · 누적 시간(L04 · L06 · L17) */
export function snapshot(reason: string) {
  safe(() => {
    if (!betaLog.isActive() || !hasStarted) return;
    const stats = betaLog.stats();
    betaLog.track("activity_snapshot", reason, {
      objective_id: lastFocus,
      data: {
        active_ms: activeMs(),
        clock_final: playClock.isFinal(),
        completed: [...lastCompleted].slice(0, 40),
        gut: gut.stage(),
        cliff: cliff.stage(),
        help_received: helpLog.asked(),
        answer_seen: helpLog.isAnswerSeen(),
        visible: typeof document !== "undefined" ? document.visibilityState : null,
        queued: stats.queued,
        dropped: betaLog.takeDropped(),
      },
    });
  });
}

/** 나주 페이지가 열렸다(엔트리 직후) — 처음부터 다시 뒤면 새 회차 */
export function initNajuBeta() {
  safe(() => {
    if (!betaLog.isActive()) return;
    betaSignals.mistake = (objective, how) => notePuzzleAttempt(objective, "fail", "inferred", { how });
    betaSignals.sentBack = noteSentBack;
    betaSignals.help = (phase, kind) => noteHelp(phase, kind);
    betaSignals.npcTurn = noteNpcTurn;
    betaSignals.story = noteStory;
    betaSignals.attempt = notePuzzleAttempt;
    betaSignals.failure = noteKnownFailure;
    const isNewRun = betaLog.consumeRunReset();
    if (isNewRun) betaLog.track("run_state", "new_run", { data: { reason: "restart" } });
    onBetaHidden(() => snapshot("hidden"));
    gut.subscribe(() =>
      safe(() => {
        const stage = gut.stage();
        if (stage === lastGut) return;
        const before = lastGut;
        lastGut = stage;
        // 페이지를 열 때 저장에서 되살아난 단계(restore)는 엔딩으로 세지 않는다 — 첫 조작 뒤에 바뀐 것만
        if (!hasStarted) return;
        if (stage === "released" || stage === "dawn")
          // 추첨 집계용(미르 11/12) — 계정 기준 다시 시작 횟수 · 직접 청한 도움 · 정답 열람을 같이 싣는다
          betaLog.track("run_state", stage, {
            urgent: true,
            data: {
              active_ms: activeMs(),
              from: before,
              origin: "live",
              restarts: attemptCount.restarts(),
              help_received: helpLog.asked(),
              answer_seen: helpLog.isAnswerSeen(),
              // 이번 접속에서 버린 「튀는 마우스 값」 수 — 윈도우 크롬에서 실제로 튀는지 본다(lookGuard, 11/13)
              look_spikes: droppedLookSpikes(),
            },
          });
        else if (stage === "rite") betaLog.track("objective_state", "rite", { objective_id: "GUT", data: { active_ms: activeMs() } });
      }),
    );
    cliff.subscribe(() =>
      safe(() => {
        const stage = cliff.stage();
        if (stage === lastCliff) return;
        lastCliff = stage;
        if (hasStarted) betaLog.track("objective_state", "progress", { objective_id: "CLIFF", data: { stage, active_ms: activeMs() } });
      }),
    );
  });
}

/** 시작 카드가 처음 떴다 — 나주 페이지 로딩이 끝나 조작을 받을 수 있다(L14 · L01) */
export function noteNajuReady(extra: Record<string, unknown> = {}) {
  safe(() => {
    if (isReadyNoted || !betaLog.isActive()) return;
    isReadyNoted = true;
    betaLog.track("stage_reached", "naju_ready", { data: { load_ms: Math.round(performance.now()), ...extra } });
  });
}

/** 첫 조작(잠금) — 조사 시계가 도는 순간. mode: 저장 없이 처음(full) · 이어 하기(resume) */
export function noteNajuStart(mode: "full" | "resume", isCleared: boolean) {
  safe(() => {
    if (hasStarted || !betaLog.isActive()) return;
    hasStarted = true;
    lastGut = gut.stage();
    lastCliff = cliff.stage();
    availableSeen = loadAvailable();
    lastCompleted = readCompleted();
    betaLog.track("stage_reached", "naju_controllable", { data: { load_ms: Math.round(performance.now()) } });
    betaLog.track("run_state", mode === "full" ? "start" : "resume", {
      urgent: true,
      data: {
        active_ms: activeMs(),
        cleared_save: isCleared,
        completed_at_start: [...lastCompleted].slice(0, 40),
        help_received: helpLog.asked(),
        restarts: attemptCount.restarts(),
      },
    });
    tickTimer = window.setInterval(tick, TICK_MS);
    snapshotTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") snapshot("interval");
    }, SNAPSHOT_MS);
    tick();
  });
}

/** 「처음부터 다시」가 성공했다(지우고 새로 열기 직전) */
export function noteNajuRestart(where: string) {
  safe(() => {
    if (!betaLog.isActive()) return;
    snapshot("restart");
    betaLog.track("run_state", "restart", { urgent: true, data: { active_ms: activeMs(), where } });
    betaLog.markRunReset();
    window.clearInterval(tickTimer);
    window.clearInterval(snapshotTimer);
  });
}

/** 게임 종료 · 로비로 나가기 — 명시적으로 떠났다 */
export function noteNajuLeave(kind: "quit" | "lobby") {
  safe(() => {
    if (!betaLog.isActive()) return;
    snapshot(kind);
    betaLog.track("run_state", kind, { urgent: true, data: { active_ms: activeMs(), cleared: playClock.isFinal() } });
  });
}

/** 퍼즐 판정 — 서버 판정 결과(server) · 알림 문장 · 안내판으로 알아챈 틀림(inferred) */
export function notePuzzleAttempt(objective: string, result: string, source: "server" | "local" | "inferred", extra: Record<string, unknown> = {}) {
  safe(() => {
    betaLog.track("puzzle_attempt", result, { objective_id: objective, data: { source, active_ms: activeMs(), ...extra } });
  });
}

/** 숨이 다해 되돌려졌다 */
export function noteSentBack() {
  safe(() => betaLog.track("puzzle_attempt", "sent_back", { objective_id: lastFocus, data: { source: "inferred", active_ms: activeMs() } }));
}

/** 직접 청한 도움 — request(보기를 골랐다) · received(대답 · 힌트 글을 받았다) */
export function noteHelp(phase: "request" | "received" | "answer_seen", kind: string, objective: string | null = lastFocus) {
  safe(() => betaLog.track("help_event", phase, { objective_id: objective, data: { kind, active_ms: activeMs() } }));
}

/** 동행 서버 턴 — request · response · error. rtt 는 보낸 뒤 받기까지(ms) */
export function noteNpcTurn(phase: "request" | "response" | "error", data: Record<string, unknown>) {
  safe(() => betaLog.track("npc_turn", phase, { objective_id: lastFocus, data }));
}

/** 설화 근거 줄 · 의뢰 대사가 화면에 떴다(L10a) */
export function noteStory(passage: string, phase: "heard" | "skipped" | "completed", data: Record<string, unknown> = {}) {
  safe(() => betaLog.track("story_exposure", phase, { objective_id: passage, data: { active_ms: activeMs(), ...data } }));
}

/** 알려진 실패(저장 · 판정 제출 · 로딩) — 게임이 이미 처리한 실패를 기록만. code 는 정해 둔 값 */
export function noteKnownFailure(category: string, code: string, extra: Record<string, unknown> = {}) {
  safe(() => trackError(category, code, { code: code.slice(0, 60), ...extra }));
}
