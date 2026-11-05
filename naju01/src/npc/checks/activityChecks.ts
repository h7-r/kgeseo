// 플레이어 행동 · 진행 추적기와 AI 입력 검사 (K 묶음). 꾸민 프레임 · 이벤트만 쓴다(게임 상태를 바꾸지 않는다).
// run-npc-checks.mjs 가 다른 묶음 다음에 부른다.
import { createGameEventDiffer, type NajuGameSnapshot } from "../gameEventDiff";
import type { GameEvent } from "../gameEvents";
import { buildNpcAiInput, NPC_AI_INPUT_SCHEMA } from "../npcAiInput";
import { createNpcBehaviorStore } from "../behaviorState";
import { createNpcEventController } from "../npcEventController";
import { ACTIVITY_CONFIG, createPlayerActivityTracker, type PlayerActivityTracker } from "../playerActivityTracker";
import type { NpcCheckOutput } from "./npcChecks";

const DT = 1 / 60;

export function runActivityChecks(): NpcCheckOutput {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "K 행동 · 진행 추적";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  const step = (
    t: PlayerActivityTracker,
    seconds: number,
    f: { moving?: boolean; zone?: string | null; active?: boolean } = {},
  ) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++)
      t.frame({ dt: DT, active: f.active ?? true, moving: f.moving ?? false, running: false, zone: f.zone ?? "Z1" });
  };
  let id = 0;
  const ev = {
    zone: (target: string, previous: string | null = null): GameEvent => ({
      event_id: `t${++id}`,
      event_type: "zone_entered",
      target_id: target,
      previous_zone: previous,
      source: "test",
    }),
    clue: (key: string, eventId = `t${++id}`): GameEvent => ({
      event_id: eventId,
      event_type: "clue_discovered",
      target_id: key.split("#")[0],
      clue_key: key,
      source: "test",
    }),
    scene: (n: number, eventId = `t${++id}`): GameEvent => ({
      event_id: eventId,
      event_type: "scene_cleared",
      target_id: String(n),
      scene: n,
      source: "test",
    }),
    blocker: (code: string, eventId = `t${++id}`): GameEvent => ({
      event_id: eventId,
      event_type: "blocker_cleared",
      target_id: code,
      source: "test",
    }),
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

  // 1 유휴 시간
  {
    const t = createPlayerActivityTracker();
    step(t, 2);
    const still = t.snapshot().idleSeconds;
    step(t, 1, { moving: true });
    const walking = t.snapshot().idleSeconds;
    step(t, 1.5);
    const stopped = t.snapshot().idleSeconds;
    check(
      "1 유휴: 서 있던 2 s → 걷는 동안 0 → 멈춘 뒤 1.5 s",
      near(still, 2) && walking === 0 && near(stopped, 1.5) && !t.snapshot().moving,
      `${still} · ${walking} · ${stopped}`,
    );
  }
  // 2 구역 반복 방문 (통로 null 은 건너뜀)
  {
    const t = createPlayerActivityTracker();
    step(t, 1, { zone: "Z1" });
    step(t, 1, { zone: null });
    step(t, 1, { zone: "Z1" }); // 통로 다녀와도 같은 구역이면 안 셈
    step(t, 1, { zone: "Z2" });
    step(t, 1, { zone: "Z1" });
    step(t, 1, { zone: "Z2" });
    t.record([ev.zone("Z2", "Z1"), ev.zone("Z1", "Z2"), ev.zone("Z2", "Z1")]); // 이벤트로는 다시 세지 않음
    const s = t.snapshot();
    check(
      "2 구역 방문: Z1 2 · Z2 2 · 다시 들어선 구역 [Z1, Z2] · 재방문 2 (통로 왕복은 안 셈 · 이벤트로 겹쳐 세지 않음)",
      s.zoneVisits.Z1 === 2 && s.zoneVisits.Z2 === 2 && s.repeatedZones.join() === "Z1,Z2" && s.revisits === 2,
      JSON.stringify(s.zoneVisits),
    );
    const base = createPlayerActivityTracker();
    step(base, 1, { zone: null });
    step(base, 1, { zone: "Z1" });
    check("2 처음이 통로(null)면 첫 구역 진입을 1 로 셈", base.snapshot().zoneVisits.Z1 === 1);
  }
  // 3 scene_cleared 뒤 정체 시간 초기화 · zone_entered 는 초기화 안 함
  {
    const t = createPlayerActivityTracker();
    step(t, 30);
    t.record([ev.zone("Z2", "Z1")]);
    const afterZone = t.snapshot().sinceLastProgressSeconds;
    t.record([ev.scene(1)]);
    const afterScene = t.snapshot().sinceLastProgressSeconds;
    step(t, 5);
    const later = t.snapshot();
    check(
      "3 구역 진입은 진행 아님(30 s 그대로) · scene_cleared → 0 · 5 s 뒤 5",
      near(afterZone, 30) && afterScene === 0 && near(later.sinceLastProgressSeconds, 5) && later.progressCount === 1,
      `${afterZone} · ${afterScene} · ${later.sinceLastProgressSeconds} · 진행 ${later.progressCount}`,
    );
    check(
      "3 마지막 진행 기록 (종류 · 대상 · 시각)",
      later.lastProgress?.type === "scene_cleared" &&
        later.lastProgress.target === "1" &&
        near(later.lastProgress.at, 30),
      JSON.stringify(later.lastProgress),
    );
  }
  // 4 처음 단서만 진행
  {
    const t = createPlayerActivityTracker();
    step(t, 3);
    t.record([ev.clue("씬1.구렁이#3")]);
    step(t, 3);
    t.record([ev.clue("씬1.구렁이#3")]); // 다른 event_id · 같은 열쇠
    const s = t.snapshot();
    check(
      "4 처음 단서만 진행 · 같은 열쇠는 event_id 가 달라도 다시 안 셈",
      s.progressCount === 1 && near(s.sinceLastProgressSeconds, 3) && s.discoveredClues.length === 1,
      `진행 ${s.progressCount} · ${s.sinceLastProgressSeconds} s`,
    );
  }
  // 5 차단물 해제 중복 제거 (추적기 · 비교기 둘 다)
  {
    const t = createPlayerActivityTracker();
    t.record([ev.blocker("B2"), ev.blocker("B2")]);
    check(
      "5 같은 차단물 두 번(다른 event_id) → 진행 1",
      t.snapshot().progressCount === 1 && t.snapshot().clearedBlockers.join() === "B2",
    );
    const S = (blockers: string[]): NajuGameSnapshot => ({
      zone: "Z1",
      seenClues: new Set(),
      clearedScenes: 0,
      clearedBlockers: new Set(blockers),
      cutActive: false,
    });
    const d = createGameEventDiffer();
    d.observe(S([]));
    const first = d.observe(S(["B2"]));
    const again = [...d.observe(S(["B2"])), ...d.observe(S([])), ...d.observe(S(["B2"]))];
    const mount = createGameEventDiffer();
    const atMount = [...mount.observe(S(["B2"])), ...mount.observe(S(["B2"]))];
    check(
      "5 비교기: 처음 치워진 B2 만 blocker_cleared · 되살아났다 다시 치워져도 안 냄 · 마운트 때 이미 치워진 것도 안 냄",
      first.length === 1 &&
        first[0].event_type === "blocker_cleared" &&
        first[0].target_id === "B2" &&
        again.length === 0 &&
        atMount.length === 0,
      `${first.map((e) => e.event_id).join()} · 다시 ${again.length} · 마운트 ${atMount.length}`,
    );
    const ctl = createNpcEventController(createNpcBehaviorStore());
    const r = ctl.handle(first[0]);
    check(
      "5 컨트롤러: blocker_cleared 는 계약 통과 · 규칙 없음이라 기록만",
      r.status === "ignored" && r.reason === "no-rule",
      `${r.status}/${r.reason}`,
    );
    ctl.dispose();
  }
  // 6 이벤트 중복 수신 → 결과 불변
  {
    const t = createPlayerActivityTracker();
    step(t, 2, { zone: "Z1" });
    const batch = [ev.zone("Z2", "Z1"), ev.clue("씬2.돌탑#0"), ev.scene(2), ev.blocker("B3")];
    t.record(batch);
    const once = JSON.stringify({ ...t.snapshot(), duplicates: 0 });
    t.record(batch);
    t.record(batch);
    const thrice = t.snapshot();
    check(
      "6 같은 이벤트 묶음을 세 번 넣어도 결과 같음 (중복 8건으로만 셈)",
      JSON.stringify({ ...thrice, duplicates: 0 }) === once && thrice.duplicates === 8,
      `중복 ${thrice.duplicates}`,
    );
  }
  // 7 일시정지 · 비활성 · 탭 복귀
  {
    const t = createPlayerActivityTracker();
    step(t, 2);
    const before = t.snapshot();
    t.frame({ dt: 30, active: false, moving: false, running: false, zone: "Z1" }); // 부감 30 s
    step(t, 10, { active: false });
    const paused = t.snapshot();
    t.frame({ dt: 5, active: true, moving: false, running: false, zone: "Z1" }); // 탭이 깨며 5 s 튐
    const jump = t.snapshot();
    t.frame({ dt: NaN, active: true, moving: false, running: false, zone: "Z1" });
    t.frame({ dt: -1, active: true, moving: false, running: false, zone: "Z1" });
    const bad = t.snapshot();
    check(
      "7 씬이 멈춘 동안 놀이 시간 · 유휴 · 정체 그대로",
      paused.activeSeconds === before.activeSeconds &&
        paused.idleSeconds === before.idleSeconds &&
        paused.sinceLastProgressSeconds === before.sinceLastProgressSeconds,
      `${before.activeSeconds} → ${paused.activeSeconds}`,
    );
    check(
      `7 한 프레임 delta 는 ${ACTIVITY_CONFIG.maxFrameSeconds} s 까지만 (탭 복귀 5 s 튐) · NaN · 음수는 0`,
      near(jump.activeSeconds - paused.activeSeconds, ACTIVITY_CONFIG.maxFrameSeconds) &&
        bad.activeSeconds === jump.activeSeconds,
      `${paused.activeSeconds} → ${jump.activeSeconds} → ${bad.activeSeconds}`,
    );
  }
  // 8 재마운트 · 구독 재연결
  {
    const S = (p: Partial<NajuGameSnapshot>): NajuGameSnapshot => ({
      zone: "Z3",
      seenClues: new Set(["씬1.구렁이#3"]),
      clearedScenes: 2,
      clearedBlockers: new Set(["B2"]),
      cutActive: false,
      ...p,
    });
    // 앞 인스턴스: 진행 3 을 셌다. 재마운트: 새 비교기 · 새 추적기가 같은 게임 상태로 붙는다
    const remountDiffer = createGameEventDiffer();
    const remount = createPlayerActivityTracker();
    for (let i = 0; i < 3; i++) {
      remount.frame({ dt: DT, active: true, moving: false, running: false, zone: "Z3" });
      remount.record(remountDiffer.observe(S({})));
    }
    const s = remount.snapshot();
    check(
      "8 재마운트: 이미 있던 단서 · 씬 · 차단물로 진행을 다시 세지 않음 (지난 기록도 복원하지 않음)",
      s.progressCount === 0 && s.discoveredClues.length === 0 && s.clearedScenes.length === 0,
      `진행 ${s.progressCount}`,
    );
    // 같은 비교기 출력을 두 군데(구독 재연결 등)서 다시 넣어도 한 번
    const d = createGameEventDiffer();
    const t = createPlayerActivityTracker();
    d.observe(S({ clearedScenes: 0, seenClues: new Set(), clearedBlockers: new Set() }));
    const events = d.observe(S({ clearedScenes: 1, seenClues: new Set(["a#1"]), clearedBlockers: new Set(["B2"]) }));
    t.record(events);
    t.record(events);
    check(
      "8 같은 이벤트를 다시 받아도 진행 3 그대로",
      t.snapshot().progressCount === 3,
      `${t.snapshot().progressCount}`,
    );
  }
  // 9 새 세션 → 초기화
  {
    const t = createPlayerActivityTracker();
    step(t, 5, { zone: "Z1" });
    step(t, 1, { zone: "Z2", moving: true });
    t.record([ev.scene(1, "0:scene_cleared:1"), ev.clue("a#1", "0:clue_discovered:a#1")]);
    t.reset("세션");
    const empty = t.snapshot();
    check(
      "9 reset → 시간 · 방문 · 진행 · 최근 이벤트 모두 0 (reset 횟수만 1)",
      empty.activeSeconds === 0 &&
        empty.progressCount === 0 &&
        Object.keys(empty.zoneVisits).length === 0 &&
        empty.recentEvents.length === 0 &&
        empty.lastProgress === null &&
        !empty.started &&
        empty.resets === 1,
      JSON.stringify(empty).slice(0, 160),
    );
    t.record([ev.scene(1, "1:scene_cleared:1")]); // 새 기준(앞머리 1) 의 같은 씬
    check("9 새 세션의 같은 씬은 다시 진행으로 셈", t.snapshot().progressCount === 1);
  }
  // 10 AI 입력 JSON
  {
    const t = createPlayerActivityTracker();
    step(t, 4, { zone: "Z1" });
    t.record([ev.scene(1), ev.clue("씬1.천막#2"), ev.scene(3)]);
    step(t, 2, { zone: "Z1", moving: true });
    const input = buildNpcAiInput({
      intent: "manual",
      dialog: { sessionId: 2, turn: 1 },
      activity: t.snapshot(),
      npc: { behavior: "Interact", distance: NaN, following: false, waiting: null },
    });
    const json = JSON.stringify(input);
    const back = JSON.parse(json);
    const frozen = (v: unknown): boolean =>
      !v || typeof v !== "object" ? true : Object.isFrozen(v) && Object.values(v).every(frozen);
    let threw = false;
    try {
      (input.progress.cleared_scenes as number[]).push(9);
    } catch {
      threw = true;
    }
    check(
      "10 JSON 직렬화 · 되읽기 같음 · 스키마 이름",
      JSON.stringify(back) === json && back.schema === NPC_AI_INPUT_SCHEMA,
      `${json.length} 바이트`,
    );
    check(
      "10 없는 데이터는 null (퍼즐 · 백엔드 · PlaySession · 이동 누적 거리 · 모르는 NPC 거리) — NaN 없음",
      back.puzzle === null &&
        back.backend === null &&
        back.session.play_session_id === null &&
        back.player.distance_travelled_m === null &&
        back.npc.distance_m === null &&
        !json.includes("NaN"),
    );
    check(
      "10 건너뛴 씬 번호(2)는 완료로 치지 않고 따로 표시",
      back.progress.cleared_scenes.join() === "1,3" && back.progress.skipped_scene_numbers.join() === "2",
      `${back.progress.cleared_scenes} · 건너뜀 ${back.progress.skipped_scene_numbers}`,
    );
    check(
      "10 읽기 전용: 깊이 얼림 · 고치려 하면 막힘 · 추적기 사본과 참조 공유 없음",
      frozen(input) &&
        threw &&
        t.snapshot().clearedScenes.length === 2 &&
        input.progress.cleared_scenes !== t.snapshot().clearedScenes,
    );
    out.measurements.aiInputExample = back;
  }
  // 비용: 추적기 한 프레임 + 스냅숏
  {
    const t = createPlayerActivityTracker();
    const start = performance.now();
    for (let i = 0; i < 20000; i++)
      t.frame({ dt: DT, active: true, moving: i % 50 < 25, running: false, zone: i % 600 < 300 ? "Z1" : "Z2" });
    const frameMs = (performance.now() - start) / 20000;
    const s0 = performance.now();
    for (let i = 0; i < 2000; i++)
      buildNpcAiInput({
        intent: null,
        dialog: null,
        activity: t.snapshot(),
        npc: { behavior: "Follow", distance: 1.4, following: false, waiting: false },
      });
    const snapMs = (performance.now() - s0) / 2000;
    out.measurements.activityCost = { frameMs, aiInputMs: snapMs };
    check("비용: 추적기 한 프레임 < 0.01 ms", frameMs < 0.01, `${frameMs.toFixed(5)} ms`);
    out.notes.push(
      `[${group}] 추적기 프레임 ${frameMs.toFixed(5)} ms · AI 입력 만들기 ${snapMs.toFixed(4)} ms (스냅숏 포함, 대화·디버그 때만 부른다)`,
    );
  }
  return out;
}
