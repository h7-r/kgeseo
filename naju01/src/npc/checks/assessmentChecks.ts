// 플레이어 상태 추정 · 도움 제안 정책 검사 (L 묶음). 꾸민 대본 · 판단만 쓴다(게임 상태를 바꾸지 않는다).
import { evaluateAssessor } from "../assessmentEval";
import { trackBehaviorStore } from "../behaviorLog";
import { createNpcBehaviorStore } from "../behaviorState";
import { createHelpPolicy, HELP_POLICY_CONFIG, type HelpContext } from "../helpPolicy";
import {
  ASSESSMENT_CONFIG,
  assessPlayerByRules,
  createRuleBaselineAssessor,
  type NpcAssessment,
} from "../npcAssessment";
import { buildAssessmentScenarios, playScript } from "./assessmentScenarios";
import type { NpcCheckOutput } from "./npcChecks";

export function runAssessmentChecks(): NpcCheckOutput {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "L 상태 추정 · 도움 제안";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  // ── 상태 추정: 시나리오 (1~6) ──────────────────────────────────────────
  const scenarios = buildAssessmentScenarios();
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const judge = (id: string) => assessPlayerByRules(byId.get(id)!.input);
  const show = (a: NpcAssessment) =>
    `${a.state} [${a.evidence.join(", ")}] · 정체 ${a.metrics.since_last_progress_s} s · 창 재진입 ${a.metrics.window_revisits}/${a.metrics.window_zone_entries}`;
  const expect = (label: string, id: string, state: NpcAssessment["state"], evidence: string[] = []) => {
    const a = judge(id);
    check(label, a.state === state && evidence.every((e) => a.evidence.includes(e as never)), show(a));
  };
  expect("1 정상 탐색: 처음 가는 구역을 차례로 돎 → EXPLORING (새 구역)", "explore-new-zones", "EXPLORING", [
    "NEW_AREA_VISITED",
  ]);
  expect(
    "1 정상 탐색 반례: 한 번 되돌아옴 → EXPLORING (창 재진입 0 — 창 시작 구역으로의 복귀는 못 셈 · 아래 한계)",
    "backtrack-once",
    "EXPLORING",
  );
  expect("2 진행 정체만 → EXPLORING (NO_RECENT_PROGRESS 근거만)", "stall-only", "EXPLORING", ["NO_RECENT_PROGRESS"]);
  expect("3 반복 방문만(최근 진행 있음) → EXPLORING", "repeat-only", "EXPLORING", [
    "RECENT_PROGRESS",
    "REPEATED_ZONE_VISITS",
  ]);
  expect("4 정체 + 반복 방문 → POSSIBLY_STUCK", "stall-and-repeat", "POSSIBLY_STUCK", [
    "NO_RECENT_PROGRESS",
    "REPEATED_ZONE_VISITS",
  ]);
  expect("5 진행 직후 → 판단 초기화 (EXPLORING · RECENT_PROGRESS)", "progress-resets", "EXPLORING", [
    "RECENT_PROGRESS",
  ]);
  expect("5 반복은 진행 전 일 → 창 밖이라 세지 않음", "repeat-before-progress", "EXPLORING", ["NO_RECENT_PROGRESS"]);
  expect("6 데이터 부족: 60 s 만 놂 → INSUFFICIENT_DATA", "short-session", "INSUFFICIENT_DATA", [
    "INSUFFICIENT_OBSERVATION",
  ]);
  expect("6 데이터 부족: 30 분 멈춤은 놀이 시간이 아님 → INSUFFICIENT_DATA", "long-pause", "INSUFFICIENT_DATA");
  expect(
    "단순 정지만으로 막힘이라 하지 않음 → INSUFFICIENT_DATA (PLAYER_IDLE_LONG)",
    "stuck-standing-still-only",
    "INSUFFICIENT_DATA",
    ["PLAYER_IDLE_LONG"],
  );
  expect("정체 · 왕복 뒤 오래 서 있음 → 막힘으로 단정하지 않음", "stall-repeat-then-idle", "INSUFFICIENT_DATA", [
    "PLAYER_IDLE_LONG",
  ]);
  {
    const a = judge("stall-and-repeat");
    const json = JSON.stringify(a);
    check(
      "판단 결과: npc_assessment/0.1 · rule_baseline · 깊이 얼림 · JSON 그대로",
      a.schema === "npc_assessment/0.1" &&
        a.decision_source === "rule_baseline" &&
        Object.isFrozen(a) &&
        Object.isFrozen(a.evidence) &&
        JSON.stringify(JSON.parse(json)) === json,
    );
    out.measurements.assessmentExample = JSON.parse(json);
  }
  {
    // 임계값을 바꾸면 판단이 따라 바뀐다 (규칙과 값이 분리돼 있다)
    const strict = assessPlayerByRules(byId.get("stall-and-repeat")!.input, {
      ...ASSESSMENT_CONFIG,
      minWindowRevisits: 10,
    });
    const loose = assessPlayerByRules(byId.get("backtrack-once")!.input, {
      ...ASSESSMENT_CONFIG,
      minWindowRevisits: 0,
    });
    check(
      "임계값 분리: 재진입 기준 10 → 같은 대본도 EXPLORING · 기준 0 → 되돌아옴도 POSSIBLY_STUCK",
      strict.state === "EXPLORING" && loose.state === "POSSIBLY_STUCK",
      `${strict.state} · ${loose.state}`,
    );
  }
  {
    const evalResult = evaluateAssessor(createRuleBaselineAssessor(), scenarios);
    out.measurements.assessmentEval = evalResult;
    check(
      `평가 틀: 같은 시나리오 ${scenarios.length}개로 추정기 비교 (규칙 기준선 ${evalResult.correct}/${evalResult.total})`,
      evalResult.correct === evalResult.total,
      evalResult.misses.map((m) => `${m.id}: ${m.expected}→${m.got}`).join(", ") || "틀린 것 없음",
    );
    const flip = evaluateAssessor(
      { id: "always_stuck", assess: (i) => ({ ...assessPlayerByRules(i), state: "POSSIBLY_STUCK" }) },
      scenarios,
    );
    check(
      "평가 틀: 다른 추정기(늘 POSSIBLY_STUCK)도 같은 계약으로 잼 · 오탐을 셈",
      flip.assessor === "always_stuck" && flip.confusion.EXPLORING.POSSIBLY_STUCK > 0 && flip.correct < flip.total,
      `${flip.correct}/${flip.total}`,
    );
  }

  // ── 개입 정책 (7~14) ─────────────────────────────────────────────
  const stuck = judge("stall-and-repeat");
  const at = (a: NpcAssessment, t: number): NpcAssessment => ({ ...a, observed_at_s: t });
  const ok: HelpContext = {
    sceneActive: true,
    pointerLocked: true,
    cutActive: false,
    dialogOpen: false,
    canInteract: true,
    interactionBlock: null,
  };
  {
    const p = createHelpPolicy();
    const blocked = (patch: Partial<HelpContext>) => p.preview(stuck, { ...ok, ...patch });
    const dialog = blocked({ dialogOpen: true, canInteract: false });
    const cut = blocked({ cutActive: true });
    const inactive = blocked({ sceneActive: false });
    const unlocked = blocked({ pointerLocked: false });
    const far = blocked({ canInteract: false, interactionBlock: "too-far" });
    check(
      "7 대화 중 → WAIT (DIALOG_ACTIVE)",
      dialog.action === "WAIT" && dialog.reasons.includes("DIALOG_ACTIVE"),
      dialog.reasons.join(),
    );
    check(
      "8 컷 · 게임 비활성 → WAIT (CUTSCENE_ACTIVE · GAME_INACTIVE)",
      cut.action === "WAIT" && cut.reasons.includes("CUTSCENE_ACTIVE") && inactive.reasons.includes("GAME_INACTIVE"),
      `${cut.reasons} · ${inactive.reasons}`,
    );
    check(
      "9 포인터 잠금 풀림 → WAIT (POINTER_UNLOCKED)",
      unlocked.reasons.includes("POINTER_UNLOCKED"),
      unlocked.reasons.join(),
    );
    check(
      "10 NPC 에게 말 걸 수 없음 → WAIT (INTERACTION_BLOCKED · 이유 기록)",
      far.reasons.includes("INTERACTION_BLOCKED") && far.interaction_block === "too-far",
      far.reasons.join(),
    );
    const insufficient = p.preview(judge("short-session"), ok);
    const exploring = p.preview(judge("stall-only"), ok);
    check(
      "근거 부족 · 탐색 중 → WAIT (INSUFFICIENT_DATA · NOT_STUCK)",
      insufficient.reasons.includes("INSUFFICIENT_DATA") && exploring.reasons.includes("NOT_STUCK"),
      `${insufficient.reasons} · ${exploring.reasons}`,
    );
    check("preview 는 상태를 바꾸지 않음", p.state().offers === 0, `제안 ${p.state().offers}`);
  }
  {
    const p = createHelpPolicy();
    const t0 = stuck.observed_at_s;
    const first = p.decide(stuck, ok);
    const same = p.decide(stuck, ok);
    const many = Array.from({ length: 50 }, () => p.decide(at(stuck, t0 + 1), ok));
    check(
      "14 같은 판단을 거듭 불러도 OFFER_HELP 한 번 (뒤는 COOLDOWN_ACTIVE)",
      first.action === "OFFER_HELP" &&
        first.offer_id === 1 &&
        same.action === "WAIT" &&
        same.reasons.includes("COOLDOWN_ACTIVE") &&
        many.every((d) => d.action === "WAIT") &&
        p.state().offers === 1,
      `${first.action}#${first.offer_id} · ${same.reasons} · 제안 ${p.state().offers}`,
    );
    const during = p.decide(at(stuck, t0 + HELP_POLICY_CONFIG.offerCooldownSeconds - 1), ok);
    const after = p.decide(at(stuck, t0 + HELP_POLICY_CONFIG.offerCooldownSeconds), ok);
    check(
      `11 제안 쿨다운 ${HELP_POLICY_CONFIG.offerCooldownSeconds} s(놀이 시간) 안 → WAIT · 지나면 다음 제안(#2)`,
      during.action === "WAIT" &&
        during.cooldown_until_s === t0 + HELP_POLICY_CONFIG.offerCooldownSeconds &&
        after.action === "OFFER_HELP" &&
        after.offer_id === 2,
      `${during.action}(${during.cooldown_until_s}) · ${after.action}#${after.offer_id}`,
    );
    const t2 = t0 + HELP_POLICY_CONFIG.offerCooldownSeconds;
    const wrong = p.decline(1, t2); // 지난 제안 번호
    const declined = p.decline(2, t2);
    const blockedLater = p.decide(at(stuck, t2 + HELP_POLICY_CONFIG.offerCooldownSeconds + 1), ok);
    const reopened = p.decide(at(stuck, t2 + HELP_POLICY_CONFIG.declineCooldownSeconds), ok);
    check(
      `12 거절 뒤 ${HELP_POLICY_CONFIG.declineCooldownSeconds} s 는 제안 쿨다운이 끝나도 WAIT (PLAYER_DECLINED) · 지난 제안 번호 거절은 무시`,
      !wrong &&
        declined &&
        blockedLater.action === "WAIT" &&
        blockedLater.reasons.includes("PLAYER_DECLINED") &&
        reopened.action === "OFFER_HELP",
      `${wrong} · ${declined} · ${blockedLater.reasons} · ${reopened.action}`,
    );
    p.reset();
    const fresh = p.decide(stuck, ok);
    check(
      "13 세션 재시작(reset) → 제안 · 거절 기록 지움 · 번호 #1 부터",
      p.state().resets === 1 && p.state().declines === 0 && fresh.action === "OFFER_HELP" && fresh.offer_id === 1,
      `${fresh.action}#${fresh.offer_id} · ${JSON.stringify(p.state())}`,
    );
    out.measurements.helpDecisionExample = JSON.parse(JSON.stringify(first));
  }
  {
    // 판단 루프는 FSM · 대화에 손대지 않는다 (훅과 같은 순서로 대본을 돌려 OFFER_HELP 를 낸다)
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const p = createHelpPolicy();
    const assessor = createRuleBaselineAssessor();
    let offers = 0;
    for (let t = 0; t <= 600; t += 30) {
      const input = playScript([
        { seconds: 50, zone: "Z1", events: ["clue"] },
        ...Array.from({ length: Math.floor(t / 56) }, (_, i) => ({ seconds: 56, zone: i % 2 === 0 ? "Z2" : "Z1" })),
      ]);
      if (p.decide(assessor.assess(input), ok).action === "OFFER_HELP") offers++;
    }
    check(
      "OFFER_HELP 가 나와도 FSM 변화 0 · START_INTERACT 없음",
      offers >= 1 && store.log.accepted === 0 && store.log.rejected === 0 && store.getState().current === "Follow",
      `제안 ${offers} · 수락 ${store.log.accepted}`,
    );
  }
  {
    const input = byId.get("stall-and-repeat")!.input;
    const start = performance.now();
    for (let i = 0; i < 5000; i++) assessPlayerByRules(input);
    const ms = (performance.now() - start) / 5000;
    out.measurements.assessmentCost = { assessMs: ms };
    check("비용: 상태 추정 한 번 < 0.05 ms (훅은 30 프레임마다)", ms < 0.05, `${ms.toFixed(5)} ms`);
  }
  return out;
}
