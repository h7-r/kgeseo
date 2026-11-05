// 도움 제안 UI · 수락 · 거절 검사 (M 묶음). 비동기(공급자 실패 · 취소)라 async. 게임 상태를 바꾸지 않는다.
// 훅이 하는 일(안내 종류 고르기 · F 수락 · G 거절)을 같은 순서로 흉내 낸다 — 실제 게임 루프 연결은 browser-follow [2e] 가 본다.
import { trackBehaviorStore, type TrackedBehaviorStore } from "../behaviorLog";
import { createNpcBehaviorStore } from "../behaviorState";
import { dialogKeyAction } from "../dialogKeys";
import { createDialogSession, createInteractionPromptStore, type DialogSession } from "../dialogSession";
import { createHelpOfferStore, HELP_OFFER_CONFIG, promptKind } from "../helpOffer";
import { createHelpPolicy, HELP_POLICY_CONFIG, type HelpContext } from "../helpPolicy";
import { assessPlayerByRules, type NpcAssessment } from "../npcAssessment";
import {
  createScriptedDialogueProvider,
  PLACEHOLDER_HELP_LINES,
  type DialogIntent,
  type NpcDialogueContext,
  type NpcDialogueProvider,
} from "../npcDialogue";
import { buildAssessmentScenarios } from "./assessmentScenarios";
import type { NpcCheckOutput } from "./npcChecks";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runHelpOfferChecks(): Promise<NpcCheckOutput> {
  const out: NpcCheckOutput = { results: [], notes: [], measurements: {} };
  const group = "M 도움 제안 UI · 수락 · 거절";
  const check = (name: string, ok: boolean, detail = "") => out.results.push({ group, name, ok, detail });

  const scenarios = new Map(buildAssessmentScenarios().map((s) => [s.id, s]));
  const stuck = assessPlayerByRules(scenarios.get("stall-and-repeat")!.input);
  const exploring = assessPlayerByRules(scenarios.get("stall-only")!.input);
  const at = (a: NpcAssessment, t: number): NpcAssessment => ({ ...a, observed_at_s: t });
  const ok: HelpContext = {
    sceneActive: true,
    pointerLocked: true,
    cutActive: false,
    dialogOpen: false,
    canInteract: true,
    interactionBlock: null,
  };

  /** 훅과 같은 조립: 정책 · 제안 · 대화 세션 · 안내 */
  const rig = (helpProvider?: NpcDialogueProvider) => {
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const seen: { intent: DialogIntent | undefined; turn: number }[] = [];
    const record = (p: NpcDialogueProvider): NpcDialogueProvider => ({
      open: (c: NpcDialogueContext, s) => {
        seen.push({ intent: c.intent, turn: c.turn });
        return p.open(c, s);
      },
      next: (c: NpcDialogueContext, s) => {
        seen.push({ intent: c.intent, turn: c.turn });
        return p.next(c, s);
      },
    });
    const policy = createHelpPolicy();
    const offers = createHelpOfferStore();
    const dialog = createDialogSession({
      store,
      getProvider: (intent) =>
        record(
          intent === "hint_offer"
            ? (helpProvider ?? createScriptedDialogueProvider(PLACEHOLDER_HELP_LINES))
            : createScriptedDialogueProvider(["일반 대사"]),
        ),
      getSpeaker: () => "검사 NPC",
      timeoutMs: 200,
    });
    const prompt = createInteractionPromptStore();
    let now = stuck.observed_at_s;
    let progress = 0;
    const frame = (canInteract = true, assessment: NpcAssessment | null = stuck) => {
      offers.tick({ now, progressCount: progress, assessmentState: assessment?.state ?? null });
      prompt.set(dialog.isOpen() ? null : promptKind(canInteract, !!offers.pending(now)));
    };
    const evaluate = (assessment: NpcAssessment, ctx: HelpContext = ok) => {
      const d = policy.decide(at(assessment, now), { ...ctx, dialogOpen: dialog.isOpen() });
      if (d.action === "OFFER_HELP") offers.present(d, progress);
      return d;
    };
    const pressF = () => {
      const action = dialogKeyAction({ code: "KeyF" }, dialog.isOpen());
      if (action === "advance") return dialog.advance();
      if (action !== "talk") return;
      const kind = prompt.get();
      if (kind === "help") {
        const offer = offers.pending(now);
        if (offer && dialog.open("hint_offer")) offers.accept(offer.offerId, now);
      } else if (kind === "talk") dialog.open();
    };
    const pressG = () => {
      if (dialogKeyAction({ code: "KeyG" }, dialog.isOpen()) !== "decline" || prompt.get() !== "help") return false;
      const offer = offers.pending(now);
      if (!offer || !offers.decline(offer.offerId, now)) return false;
      policy.decline(offer.offerId, now);
      return true;
    };
    return {
      store,
      seen,
      policy,
      offers,
      dialog,
      prompt,
      frame,
      evaluate,
      pressF,
      pressG,
      advance: (s: number) => (now += s),
      progress: () => progress++,
      get now() {
        return now;
      },
    };
  };
  const fsm = (store: TrackedBehaviorStore) => `${store.getState().current} · 수락 ${store.log.accepted}`;

  // 1 · 2 · 3 안내 종류 · 자동 시작 없음
  {
    const r = rig();
    r.evaluate(exploring);
    r.frame(true, exploring);
    const talk = r.prompt.get();
    r.evaluate(stuck);
    r.frame();
    const help = r.prompt.get();
    check("1 WAIT(탐색 중) → 일반 [F] 대화", talk === "talk", `${talk}`);
    check("2 OFFER_HELP → [F] 도움", help === "help" && r.offers.pending(r.now)?.offerId === 1, `${help}`);
    check(
      "3 제안만으로는 대화를 열지 않음 · FSM 그대로",
      !r.dialog.isOpen() && r.store.log.accepted === 0 && r.store.getState().current === "Follow",
      fsm(r.store),
    );
  }
  // 4 · 5 · 12 수락 → FSM · 대사 · 중복
  {
    const r = rig();
    const offered = r.evaluate(stuck);
    r.frame();
    r.pressF();
    r.pressF(); // 같은 프레임 연속 F — 열려 있으니 advance(기다리는 중이라 무시)
    await wait(0);
    const s = r.dialog.getSnapshot();
    const consumed = r.offers.snapshot().current;
    check(
      "4 F 수락 → dialog.open(hint_offer) · START_INTERACT(source dialog:hint_offer) · 임시 도움 대사",
      s.phase === "showing" &&
        s.intent === "hint_offer" &&
        r.store.getState().current === "Interact" &&
        r.store.log.lastAccepted?.event?.source === "dialog:hint_offer" &&
        s.text === PLACEHOLDER_HELP_LINES[0] &&
        r.seen[0]?.intent === "hint_offer",
      `${s.phase} · ${s.intent} · ${r.store.log.lastAccepted?.event?.source} · ${s.text}`,
    );
    check(
      "12 연속 F: START_INTERACT 한 번 · 기다리는 중 F 는 무시(대사 한 칸만)",
      r.store.log.accepted === 1 && r.seen.length === 1,
      `수락 ${r.store.log.accepted} · 공급자 호출 ${r.seen.length}`,
    );
    check(
      "4 수락 성공 → 제안 소비(accepted)",
      consumed?.status === "accepted" && consumed.offerId === 1,
      `${consumed?.status}`,
    );
    r.dialog.close("finished");
    const again = r.offers.present(offered, 0); // 같은 결정(offer #1)을 다시 넣음
    r.evaluate(stuck);
    r.frame();
    check(
      "5 수락 뒤 같은 offer_id 는 다시 안 뜸 · 정책도 쿨다운(WAIT)",
      !again && r.prompt.get() === "talk" && r.policy.preview(at(stuck, r.now), ok).reasons.includes("COOLDOWN_ACTIVE"),
      `${again} · ${r.prompt.get()}`,
    );
  }
  // 6 명시적 거절 → 정책 쿨다운 · 중복 거절 무시
  {
    const r = rig();
    r.evaluate(stuck);
    r.frame();
    const first = r.pressG();
    const second = r.pressG();
    r.frame();
    r.advance(HELP_POLICY_CONFIG.offerCooldownSeconds + 1);
    const later = r.evaluate(stuck);
    r.frame();
    check(
      "6 G 거절 → 정책 거절 기록 1 · 같은 제안 두 번째 거절 무시 · 안내는 대화로",
      first && !second && r.policy.state().declines === 1 && r.offers.snapshot().current?.status === "declined",
      `${first} · ${second} · 거절 ${r.policy.state().declines}`,
    );
    check(
      `6 거절 뒤 제안 쿨다운이 끝나도 ${HELP_POLICY_CONFIG.declineCooldownSeconds} s 안은 WAIT (PLAYER_DECLINED)`,
      later.action === "WAIT" && later.reasons.includes("PLAYER_DECLINED") && r.prompt.get() === "talk",
      later.reasons.join(),
    );
    const r2 = rig();
    r2.evaluate(exploring);
    r2.frame(true, exploring);
    check("6 도움 안내가 없을 때 G → 아무 일 없음", !r2.pressG() && r2.policy.state().declines === 0);
  }
  // 7 · 8 숨김은 거절이 아니다
  {
    const r = rig();
    r.evaluate(stuck);
    r.frame();
    r.frame(false); // 멀어짐 · 컷 · 잠금 풀림 → 접근 판정 실패
    const hidden = r.prompt.get();
    const pressedWhileHidden = r.pressG();
    r.frame(true);
    check(
      "7 · 8 대화를 걸 수 없으면 안내 숨김 · 거절 기록 없음 · 제안은 pending",
      hidden === null &&
        !pressedWhileHidden &&
        r.policy.state().declines === 0 &&
        r.offers.snapshot().current?.status === "pending" &&
        r.prompt.get() === "help",
      `${hidden} → ${r.prompt.get()} · 거절 ${r.policy.state().declines}`,
    );
    const blocked = (patch: Partial<HelpContext>) => createHelpPolicy().preview(stuck, { ...ok, ...patch }).action;
    check(
      "8 컷 · 씬 멈춤 · 잠금 풀림 → 정책이 제안을 만들지 않음",
      blocked({ cutActive: true }) === "WAIT" &&
        blocked({ sceneActive: false }) === "WAIT" &&
        blocked({ pointerLocked: false }) === "WAIT",
    );
  }
  // 9 · 10 · 11 만료 · 초기화 · 추정 변화
  {
    const r = rig();
    r.evaluate(stuck);
    r.progress();
    r.frame();
    check(
      "9 새 진행 → 제안 만료(progress) · 안내는 대화로",
      r.offers.snapshot().current?.expiry === "progress" && r.prompt.get() === "talk",
      `${r.offers.snapshot().current?.expiry}`,
    );
    const t = rig();
    t.evaluate(stuck);
    t.advance(HELP_OFFER_CONFIG.offerTtlSeconds - 1);
    t.frame();
    const still = t.prompt.get();
    t.advance(1);
    t.frame();
    check(
      `10 유효 시간 ${HELP_OFFER_CONFIG.offerTtlSeconds} s(놀이 시간) 안 → 도움 · 지나면 만료(timeout)`,
      still === "help" && t.offers.snapshot().current?.expiry === "timeout" && t.prompt.get() === "talk",
      `${still} → ${t.prompt.get()} · ${t.offers.snapshot().current?.expiry}`,
    );
    const e = rig();
    e.evaluate(stuck);
    e.frame(true, assessPlayerByRules(scenarios.get("stall-repeat-then-idle")!.input));
    const idleKeep = e.offers.snapshot().current?.status;
    e.frame(true, exploring);
    check(
      "추정 변화: INSUFFICIENT_DATA(오래 서 있음)는 유지 · EXPLORING 이면 만료(assessment_changed)",
      idleKeep === "pending" && e.offers.snapshot().current?.expiry === "assessment_changed",
      `${idleKeep} → ${e.offers.snapshot().current?.expiry}`,
    );
    const z = rig();
    z.evaluate(stuck);
    z.frame();
    z.policy.reset();
    z.offers.reset();
    z.frame();
    const fresh = z.evaluate(stuck);
    z.frame();
    check(
      "11 세션 초기화 → 제안 · 거절 · 본 번호 모두 지움 · 새 제안 #1 이 다시 뜸",
      z.offers.snapshot().seen === 1 && fresh.offer_id === 1 && z.prompt.get() === "help",
      `${fresh.offer_id} · ${z.prompt.get()}`,
    );
    const s = createHelpOfferStore();
    const p = createHelpPolicy();
    const d1 = p.decide(stuck, ok);
    s.present(d1, 0);
    s.present(d1, 0); // 같은 결정을 두 번
    const d2 = p.decide(at(stuck, stuck.observed_at_s + HELP_POLICY_CONFIG.offerCooldownSeconds), ok);
    s.present(d2, 0);
    check(
      "제안은 하나만: 같은 offer_id 두 번 무시 · 새 제안이 오면 앞 pending 은 superseded",
      s.snapshot().current?.offerId === 2 &&
        s.snapshot().history.some((h) => h.offerId === 1 && h.expiry === "superseded"),
      JSON.stringify(s.snapshot().history.map((h) => `${h.offerId}:${h.status}:${h.expiry}`)),
    );
  }
  // 13 비동기 공급자 실패 · 취소 (도움 대사)
  {
    const fail = rig({
      open: async () => {
        throw new Error("도움 대사 실패");
      },
      next: async () => null,
    });
    fail.evaluate(stuck);
    fail.frame();
    fail.pressF();
    await wait(0);
    check(
      "13 도움 대사 공급자 실패 → 대화 닫힘(error) · FSM Follow · 제안은 소비됨(다시 안 뜸)",
      fail.dialog.getSnapshot().lastClose?.reason === "error" &&
        fail.store.getState().current === "Follow" &&
        fail.offers.snapshot().current?.status === "accepted",
      `${fail.dialog.getSnapshot().lastClose?.reason} · ${fsm(fail.store)}`,
    );
    let aborted = false;
    const slow = rig({
      open: (_c, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => (aborted = true));
          setTimeout(() => resolve({ text: "늦은 도움 대사" }), 80);
        }),
      next: async () => null,
    });
    slow.evaluate(stuck);
    slow.frame();
    slow.pressF();
    slow.dialog.close("distance");
    await wait(120);
    check(
      "13 기다리는 중 멀어져 닫힘 → 요청 취소 · 늦은 대사 무시 · 거절로 기록하지 않음",
      aborted &&
        slow.dialog.getSnapshot().text === null &&
        slow.policy.state().declines === 0 &&
        slow.store.getState().current === "Follow",
      `취소 ${aborted} · 거절 ${slow.policy.state().declines}`,
    );
  }
  // 하위 호환: open() 인자 없이 · 공급자가 intent 를 몰라도
  {
    const store = trackBehaviorStore(createNpcBehaviorStore());
    const captured: { intent: DialogIntent | undefined | "missing" } = { intent: "missing" };
    const legacy: DialogSession = createDialogSession({
      store,
      getProvider: () => ({
        open: async (c) => {
          captured.intent = c.intent;
          return { text: "옛 공급자", last: true };
        },
        next: async () => null,
      }),
      getSpeaker: () => "검사 NPC",
    });
    legacy.open();
    await wait(0);
    check(
      "하위 호환: open() 은 manual · START source 는 그대로 dialog · 옛 공급자도 그대로 동작",
      legacy.getSnapshot().intent === "manual" &&
        captured.intent === "manual" &&
        store.log.lastAccepted?.event?.source === "dialog" &&
        legacy.getSnapshot().text === "옛 공급자",
      `${legacy.getSnapshot().intent} · ${store.log.lastAccepted?.event?.source}`,
    );
    legacy.close("user");
  }
  // 키: G 는 대화 밖에서만 · E/V/T/W 는 대화 키 아님
  {
    const k = (code: string, open: boolean) => dialogKeyAction({ code }, open);
    check(
      "키: G = 대화 밖 decline · 대화 중 G 무시 · E·V·T·WASD·Space·Tab 은 대화 키 아님",
      k("KeyG", false) === "decline" &&
        k("KeyG", true) === null &&
        ["KeyE", "KeyV", "KeyT", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "Tab", "KeyH", "KeyO", "KeyN", "KeyC"].every(
          (c) => k(c, false) === null && k(c, true) === null,
        ),
    );
  }
  return out;
}
