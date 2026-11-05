// 상태 추정 평가 시나리오 — 실제 추적기(playerActivityTracker)와 AI 입력 생성기(npcAiInput)를 대본대로 돌려 만든다.
// 규칙 기준선과 나중의 학습 모델을 같은 시나리오로 잰다(assessmentEval). 기대 상태는 설계 의도 표시이지 실제 플레이 정답이 아니다.
// 대본의 구역 변화는 게임 이벤트 비교기처럼 zone_entered 를 함께 낸다(통로 null 은 건너뜀).
import type { AssessmentScenario } from "../assessmentEval";
import type { GameEvent } from "../gameEvents";
import { buildNpcAiInput, type NpcAiInput } from "../npcAiInput";
import { createPlayerActivityTracker } from "../playerActivityTracker";

/** 대본 한 칸: seconds 동안 그 구역 · 움직임으로 논다. events 는 그 칸을 시작할 때 들어온다 */
export interface ScriptStep {
  seconds: number;
  zone?: string | null;
  moving?: boolean;
  active?: boolean;
  events?: ("scene" | "clue" | "blocker")[];
}

const DT = 0.1;

export function playScript(steps: readonly ScriptStep[]): NpcAiInput {
  const tracker = createPlayerActivityTracker();
  let zone: string | null = null;
  let id = 0;
  let scene = 0;
  for (const step of steps) {
    const z: string | null = step.zone === undefined ? zone : step.zone;
    const active = step.active ?? true;
    const events: GameEvent[] = [];
    if (active && z !== null && z !== zone) {
      if (zone !== null)
        events.push({
          event_id: `s${++id}`,
          event_type: "zone_entered",
          target_id: z,
          previous_zone: zone,
          source: "script",
        });
      zone = z;
    }
    for (const kind of step.events ?? []) {
      const n = ++id;
      if (kind === "scene") {
        scene++;
        events.push({
          event_id: `s${n}`,
          event_type: "scene_cleared",
          target_id: String(scene),
          scene,
          source: "script",
        });
      } else if (kind === "clue")
        events.push({
          event_id: `s${n}`,
          event_type: "clue_discovered",
          target_id: "씬1.대본",
          clue_key: `씬1.대본#${n}`,
          source: "script",
        });
      else events.push({ event_id: `s${n}`, event_type: "blocker_cleared", target_id: `B${n}`, source: "script" });
    }
    const frames = Math.round(step.seconds / DT);
    for (let i = 0; i < frames; i++) {
      tracker.frame({ dt: DT, active, moving: step.moving ?? true, running: false, zone: z });
      if (i === 0 && events.length) tracker.record(events);
    }
    if (frames === 0 && events.length) tracker.record(events);
  }
  return buildNpcAiInput({
    intent: null,
    dialog: null,
    activity: tracker.snapshot(),
    npc: { behavior: "Follow", distance: 1.4, following: false, waiting: false },
  });
}

/** 같은 두 구역을 period 초마다 오가는 대본 (count 번 이동) */
function pingPong(a: string, b: string, count: number, period: number, moving = true): ScriptStep[] {
  return Array.from({ length: count }, (_, i) => ({ seconds: period, zone: i % 2 === 0 ? b : a, moving }));
}

export function buildAssessmentScenarios(): AssessmentScenario[] {
  const s = (id: string, description: string, expected: AssessmentScenario["expected"], steps: ScriptStep[]) => ({
    id,
    description,
    expected,
    input: playScript(steps),
  });
  return [
    s("explore-new-zones", "진행 없이 400 s 지났지만 처음 가 보는 구역을 차례로 돎 (Z1→Z2→Z3→Z4)", "EXPLORING", [
      { seconds: 100, zone: "Z1" },
      { seconds: 100, zone: "Z2" },
      { seconds: 100, zone: "Z3" },
      { seconds: 100, zone: "Z4" },
    ]),
    s("stall-only", "한 구역 안에서 400 s 동안 진행 없음 — 차분히 살피는 중일 수 있다", "EXPLORING", [
      { seconds: 400, zone: "Z1" },
    ]),
    s("backtrack-once", "진행 없이 한 번 되돌아옴 (Z1→Z2→Z1) — 정상 탐색 반례", "EXPLORING", [
      { seconds: 150, zone: "Z1" },
      { seconds: 150, zone: "Z2" },
      { seconds: 150, zone: "Z1" },
    ]),
    s("repeat-only", "반복 왕복은 있지만 100 s 전에 진행함", "EXPLORING", [
      { seconds: 300, zone: "Z1" },
      { seconds: 0, events: ["scene"] },
      ...pingPong("Z1", "Z2", 4, 25),
    ]),
    s("stall-and-repeat", "진행 뒤 450 s 동안 Z1↔Z2 를 계속 오감", "POSSIBLY_STUCK", [
      { seconds: 50, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 8, 56),
    ]),
    s("progress-resets", "같은 왕복 끝에 씬을 끝냄 → 판단 초기화", "EXPLORING", [
      { seconds: 50, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 8, 56),
      { seconds: 5, events: ["scene"] },
    ]),
    s("repeat-before-progress", "왕복은 진행 전 일 — 진행 뒤엔 한 구역에 머묾", "EXPLORING", [
      ...pingPong("Z1", "Z2", 6, 40),
      { seconds: 10, events: ["blocker"] },
      { seconds: 350, zone: "Z1" },
    ]),
    s("short-session", "60 s 만 놀았다", "INSUFFICIENT_DATA", [{ seconds: 60, zone: "Z1" }]),
    s("long-pause", "60 s 놀고 30 분 부감(씬 멈춤)", "INSUFFICIENT_DATA", [
      { seconds: 60, zone: "Z1" },
      { seconds: 1800, active: false },
    ]),
    s("stall-repeat-then-idle", "정체 · 왕복 뒤 200 s 동안 서 있음 — 자리를 비웠을 수 있다", "INSUFFICIENT_DATA", [
      { seconds: 50, zone: "Z1", events: ["clue"] },
      ...pingPong("Z1", "Z2", 8, 56),
      { seconds: 200, moving: false },
    ]),
    s(
      "stuck-standing-still-only",
      "진행 없이 400 s 서 있기만 함 — 정지만으로 막힘이라 하지 않는다",
      "INSUFFICIENT_DATA",
      [{ seconds: 400, zone: "Z1", moving: false }],
    ),
  ];
}
