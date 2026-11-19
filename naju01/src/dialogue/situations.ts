/**
 * 상황 판정 — 플레이어가 지금 어떤 처지인지 본다. 동행은 여기서 나온 상황에만 말을 건다.
 *
 * 0.5초마다 게임 상태를 한 장(Observation) 받아 지난 것과 견준다. 게임 상태에는 쓰지 않는다.
 *   breath   물속에서 숨이 얼마 안 남았다   sentBack 숨이 다해 되돌려졌다
 *   missing  필요한 물건 없이 그 목표 자리에 왔다
 *   dropped  필요한 물건을 버리고 간다      unpicked 나온 물건을 안 줍고 다음 구역으로 갔다
 *   wrong    틀리기를 되풀이한다            astray   목표에서 멀어지기만 한다
 *   stuck    진전 없이 오래 머문다          overtime 정해 둔 시간을 넘겼다
 *   idle     한참 아무것도 하지 않는다
 *   solved   풀었다                         arrive   그 목표 앞에 처음 섰다
 *   chatter  한동안 아무 말도 없었다 — 동행이 먼저 잡담을 건다
 *
 * 계약은 「상황이 생긴 순간에 하나만 보낸다」다. 여럿이 겹치면 가장 앞선 하나만 낸다. 차례(계약 v0.4.16 §9)는
 *   숨 부족 → 되돌려짐 → 물건 셋(없음 · 두고 감 · 안 주움) → 반복 실수 → 목표 이탈 → 진전 없음 → 풀림 · 도착 → 잡담
 * 이다. 풀림을 도착 앞에 둔다 — 맞장구가 다음 걸음 설명 뒤에 나오면 어색하다.
 * 밀린 것은 버리지 않는다 — 조건이 남아 있으면 다음 차례에 다시 잡히고, 그 순간에만 보이는 것(풀림 · 되돌려짐)은 적어 뒀다 낸다.
 * 급하지 않은 말(missing · wrong · astray · stuck · overtime · idle · chatter)은 사이를 띄운다 — 조건이 차도 간격이 지날 때까지 기다린다.
 * 숨이 모자란 동안은 숨 말고는 급한 것이 없다 — 그 말들과 잡담은 숨이 찬 뒤로 미룬다(물건 알림은 그대로 한다).
 * 물굴(숨이 줄어드는 구역) 안에서는 잡담을 내지 않는다(계약 v0.4.16 §10-5).
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { OBJECTIVES, stageOf, type ObjectiveId, type Stage } from "./objectives.ts";

export interface WorldItemSight {
  uid: number;
  kind: string;
  x: number;
  z: number;
  /** 플레이어가 내려놓은 것(true) · 퍼즐이 내놓고 아직 안 주운 것(false) */
  isDropped: boolean;
}

export interface Observation {
  /** 초 */
  now: number;
  objective: ObjectiveId | null;
  /** 끝낸 목표들 */
  completed: ReadonlySet<ObjectiveId>;
  /** 진행 상태를 한 줄로 적은 것 — 바뀌면 「뭔가 했다」로 본다 */
  progressKey: string;
  /** 조작의 흔적(알림이 떴다 · 손에 든 것이 바뀌었다) — 진전은 아니지만 가만히 있는 것도 아니다 */
  activityKey: string;
  /** 목표별 누적 실수 */
  mistakes: Readonly<Partial<Record<ObjectiveId, number>>>;
  x: number;
  z: number;
  /** 걷고 있는 중인가(마우스 잠금). 아니면 시간을 세지 않는다 */
  isPlaying: boolean;
  /** 연출 · 읽는 창 — 시간을 세지 않고 말도 걸지 않는다 */
  isBusy: boolean;
  worldItems: readonly WorldItemSight[];
  /** 물속이면 남은 숨(초), 아니면 null */
  breath: number | null;
  /** 숨이 다해 되돌려진 횟수(누적) — 늘면 방금 되돌려진 것이다 */
  sentBackCount: number;
  /** 지금 가진 물건 종류(소지품 + 손) */
  heldKinds: readonly string[];
}

export type Situation =
  | {
      kind: "arrive" | "stuck" | "wrong" | "overtime" | "astray" | "idle" | "breath" | "sentBack" | "solved";
      objective: ObjectiveId | null;
      /** 같은 상황이 몇 번째인가(0부터) — 대사 사다리의 칸 */
      step: number;
    }
  /** 잡담은 지금 있는 구역의 말을 고른다 — 목표가 비는 사이(연출 · 이동)에는 마지막으로 있던 구역 */
  | { kind: "chatter"; objective: ObjectiveId | null; step: number; zone: Stage }
  | { kind: "dropped" | "unpicked"; objective: ObjectiveId | null; step: number; item: string; uid: number }
  /** 필요한 물건 없이 그 자리에 왔다 */
  | { kind: "missing"; objective: ObjectiveId; step: number; item: string };

export const SITUATION_RULES = {
  /** 진전 없이 머문 시간(초) → stuck 1 · 2 · 3번째 */
  stuckSec: [80, 170, 280],
  /** 누적 실수 → wrong 1 · 2 · 3번째. 6 은 백엔드 자동 개입 기준(연속 오답 6회)과 맞췄다 */
  wrongCount: [2, 4, 6],
  /** 목표 반경 밖을 걸어 다니는데 가까워지지 않은 시간(초) → astray. 두 번까지만 말한다 */
  astraySec: [18, 45],
  /** 이보다 느리면(초속 미터) 서 있는 것이다 — 서서 쉬거나 구경하는 시간은 벗어남으로 세지 않는다 */
  strollSpeed: 0.2,
  /** 이만큼(미터) 다가오면 「돌아오는 중」으로 보고 다시 센다 */
  approachMeters: 3,
  /** 내려놓은 물건에서 이만큼(미터) 멀어지면 알려 준다 */
  leftBehindMeters: 9,
  /** 내려놓은 물건에 이만큼(미터) 다가왔다가 또 두고 가면 다시 알린다 */
  noticedMeters: 4,
  /** 움직임도 진전도 없는 시간(초) → idle 1 · 2번째 */
  idleSec: [150, 330],
  /** 이보다 적게 움직인 것은 서 있는 것으로 본다(미터) */
  idleMoveMeters: 0.6,
  /** 필요한 물건 없이 목표 자리에 이만큼(초) 있으면 알려 준다 — 지나가는 길은 치지 않는다 */
  missingSec: 6,
  /** 숨이 이 아래로 떨어지면 알리고, 다시 이 위로 차야 또 알린다(초) */
  breathLowSec: 20,
  breathRearmSec: 40,
  /** 숨 경고를 다시 낼 수 있는 최소 간격(초) — BREATH_LOW 쿨다운 45초(계약 v0.4.16 §10-6)와 같게. 서버로 보내기 전 FE 임시 간격 */
  breathGapSec: 45,
  /** 급하지 않은 말 사이 최소 간격(초) */
  softGapSec: 35,
  /** 동행이 이만큼(초) 말이 없었으면 먼저 잡담을 건다 */
  chatterGapSec: 90,
  /** 한 번에 건너뛸 수 있는 최대 시간(초) — 탭을 떠났다 돌아오면 그 사이는 세지 않는다 */
  maxStepSec: 2,
} as const;

/**
 * 두고 가면 뒤에서 막히는 물건 — 이것만 알려 준다.
 * 청동 열쇠는 없다: 새가 떨어뜨린 열쇠가 「내려놓은 물건」으로 놓여, 한 번도 줍지 않았는데 버리고 간다고 읽힌다.
 * 함도 없다: 내려놓으면 열 수 있는 함으로 바뀌어 놓이고, 다음 구역으로 넘어갈 때 저절로 따라온다 — 두고 갈 수가 없다.
 */
export const KEY_ITEMS = new Set(["lightFish", "rice", "makgeolli", "floatStone", "gearStone", "bigPearl", "scale"]);

interface ObjectiveRecord {
  /** 이 목표를 붙들고 있던 시간 */
  activeSec: number;
  sinceProgressSec: number;
  stuckStep: number;
  wrongStep: number;
  astrayStep: number;
  isOvertimeTold: boolean;
  /** 목표 자리 안에 머문 시간 */
  nearSec: number;
  /** 없다고 이미 알린 물건 */
  missingTold: Set<string>;
  awaySec: number;
  /** 반경 밖에서 가장 멀리 갔던 거리 — 여기서 얼마나 되돌아왔는지로 「돌아오는 중」을 가른다 */
  awayFar: number;
}

const newRecord = (): ObjectiveRecord => ({
  activeSec: 0,
  sinceProgressSec: 0,
  stuckStep: 0,
  wrongStep: 0,
  astrayStep: 0,
  isOvertimeTold: false,
  nearSec: 0,
  missingTold: new Set(),
  awaySec: 0,
  awayFar: 0,
});

interface ItemMemo {
  /** 이 물건을 처음 본 구역. 퍼즐이 내놓은 물건은 이 구역을 떠날 때 「안 줍고 갔다」가 된다. 구역을 아직 모르면 null */
  zone: Stage | null;
  isTold: boolean;
}

type Rules = {
  [Key in keyof typeof SITUATION_RULES]: (typeof SITUATION_RULES)[Key] extends number ? number : readonly number[];
};

export function createSituationWatcher(overrides: Partial<Rules> = {}) {
  const rules: Rules = { ...SITUATION_RULES, ...overrides };
  const records = new Map<ObjectiveId, ObjectiveRecord>();
  const arrived = new Set<ObjectiveId>();
  /** 물건마다 — 처음 본 구역 · 이미 알렸나 */
  const items = new Map<number, ItemMemo>();

  let lastNow: number | null = null;
  let known: ReadonlySet<ObjectiveId> | null = null;
  /** 풀렸는데 아직 말하지 못한 목표들 — 풀리는 순간은 한 번뿐이라 적어 둔다 */
  const owedSolved: ObjectiveId[] = [];
  let sentBackSeen = 0;
  /** 되돌려졌는데 아직 말하지 못했다 — 몇 번째인지(0부터) */
  let owedSentBack: number | null = null;
  let lastProgressKey = "";
  let lastActivityKey = "";
  let lastSoftAt = -Infinity;
  /** 동행이 마지막으로 말한 때 — 잡담은 여기서부터 센다 */
  let lastSpokeAt: number | null = null;
  let chatterStep = 0;
  let idleSec = 0;
  let idleStep = 0;
  let idleFrom = { x: 0, z: 0 };
  let isBreathTold = false;
  let lastBreathAt = -Infinity;
  let lastSpot: { x: number; z: number } | null = null;
  /** 지금 구역 — 목표로 안다. 목표가 비는 사이(연출 · 이동)는 마지막 구역 그대로이고, 목표를 한 번도 못 봤으면 null */
  let zone: Stage | null = null;

  const recordOf = (id: ObjectiveId) => {
    let record = records.get(id);
    if (!record) records.set(id, (record = newRecord()));
    return record;
  };

  /** 지금 내야 할 상황 하나. 없으면 null */
  function observe(seen: Observation): Situation | null {
    const dt = lastNow === null ? 0 : Math.min(rules.maxStepSec, Math.max(0, seen.now - lastNow));
    lastNow = seen.now;
    const walked = lastSpot ? Math.hypot(seen.x - lastSpot.x, seen.z - lastSpot.z) : 0;
    lastSpot = { x: seen.x, z: seen.z };
    const isWalking = dt > 0 && walked >= rules.strollSpeed * dt;

    // 풀림 — 처음 본 상태는 기준일 뿐이다(이어 하기로 이미 풀려 있던 것에 「잘했어요」 하지 않게)
    if (known) for (const id of seen.completed) if (!known.has(id)) owedSolved.push(id);
    known = new Set(seen.completed);
    if (seen.sentBackCount > sentBackSeen) owedSentBack = seen.sentBackCount - 1;
    sentBackSeen = seen.sentBackCount;

    const hasProgress = seen.progressKey !== lastProgressKey;
    lastProgressKey = seen.progressKey;

    // 연출이 도는 동안은 말하지 않는다 — 적어 둔 풀림 · 되돌려짐도 끝난 뒤에 낸다
    if (!seen.isPlaying || seen.isBusy) return null;

    // ── 시간 세기 — 이번에 무엇을 말하든 시간은 흐른다. 고르기 전에 다 센다 ──

    const isBreathShort = seen.breath !== null && seen.breath < rules.breathLowSec;
    if (seen.breath === null || seen.breath > rules.breathRearmSec) isBreathTold = false;

    const id = seen.objective;
    if (id) zone = stageOf(id);

    // 두고 가는 물건 — 알릴 것을 찾기만 한다. 알렸다는 표시는 실제로 낼 때 붙인다
    let leftBehind: { item: WorldItemSight; memo: ItemMemo } | null = null;
    const present = new Set<number>();
    for (const item of seen.worldItems) {
      present.add(item.uid);
      if (!KEY_ITEMS.has(item.kind)) continue;
      let memo = items.get(item.uid);
      if (!memo) items.set(item.uid, (memo = { zone, isTold: false }));
      memo.zone ??= zone;
      let isLeft: boolean;
      if (item.isDropped) {
        const distance = Math.hypot(item.x - seen.x, item.z - seen.z);
        if (distance <= rules.noticedMeters) memo.isTold = false;
        isLeft = !memo.isTold && distance > rules.leftBehindMeters;
      } else {
        // 퍼즐이 내놓은 물건은 거리로 재지 않는다 — 같은 구역 안에서는 언제든 주우러 올 수 있다. 다음 구역으로 넘어갔을 때 한 번만 알린다.
        // 이어 하기로 이미 다른 구역에 남아 있던 것은 지금 구역이 기준이 되어 알리지 않는다
        isLeft = !memo.isTold && memo.zone !== null && zone !== memo.zone;
      }
      // 내려놓고 가는 것이 안 줍고 가는 것보다 앞선다
      if (isLeft && (!leftBehind || (item.isDropped && !leftBehind.item.isDropped))) leftBehind = { item, memo };
    }
    for (const uid of items.keys()) if (!present.has(uid)) items.delete(uid);

    // 가만히 있음 — 움직이거나 뭔가 하면 처음부터 다시 센다
    const moved = Math.hypot(seen.x - idleFrom.x, seen.z - idleFrom.z);
    const hasActivity = seen.activityKey !== lastActivityKey;
    lastActivityKey = seen.activityKey;
    if (hasProgress || hasActivity || moved > rules.idleMoveMeters) {
      idleSec = 0;
      idleFrom = { x: seen.x, z: seen.z };
      if (hasProgress) idleStep = 0;
    } else idleSec += dt;

    lastSpokeAt ??= seen.now;
    const record = id ? recordOf(id) : null;
    if (id && record) {
      record.activeSec += dt;
      record.sinceProgressSec = hasProgress ? 0 : record.sinceProgressSec + dt;
      record.nearSec = isOutside(id, seen) ? 0 : record.nearSec + dt;

      // 벗어남 — 반경 밖을 걸어 다니는데 가까워지지 않을 때만 센다. 목표로 걸어오는 중이면 다시 세고,
      // 멀리서 서 있기만 하는 시간은 세지 않는다(그쪽이 아니라고 할 일이 아니다 — 「가만히 있음」이 맡는다)
      const { anchor } = OBJECTIVES[id];
      if (anchor) {
        const distance = Math.hypot(seen.x - anchor.x, seen.z - anchor.z);
        if (distance <= anchor.radius) {
          record.awaySec = 0;
          record.awayFar = 0;
        } else if (distance < record.awayFar - rules.approachMeters) {
          record.awaySec = 0;
          record.awayFar = distance;
        } else {
          record.awayFar = Math.max(record.awayFar, distance);
          if (isWalking) record.awaySec += dt;
        }
      }
    }

    // ── 고르기 — 차례대로 보고 가장 앞선 하나만 낸다 ──

    const canSpeakSoft = seen.now - lastSoftAt >= rules.softGapSec;
    const soft = (situation: Situation) => {
      lastSoftAt = seen.now;
      lastSpokeAt = seen.now;
      return situation;
    };

    // 숨 · 되돌려짐 — 급하다. 다른 말과의 간격은 따지지 않고, 숨 경고끼리만 45초를 띄운다(올라왔다 바로 다시 들어가도 되풀이하지 않게)
    if (isBreathShort && !isBreathTold && seen.now - lastBreathAt >= rules.breathGapSec) {
      isBreathTold = true;
      lastBreathAt = seen.now;
      return { kind: "breath", objective: id, step: 0 };
    }
    if (owedSentBack !== null) {
      const step = owedSentBack;
      owedSentBack = null;
      return { kind: "sentBack", objective: id, step };
    }

    // 필요한 물건 없이 왔다 — 목표 자리 안에 잠깐 머문 뒤에, 물건마다 한 번
    if (id && record && canSpeakSoft && record.nearSec >= rules.missingSec) {
      const lacking = OBJECTIVES[id].needs.find(
        (kind) => !seen.heldKinds.includes(kind) && !record.missingTold.has(kind),
      );
      if (lacking) {
        record.missingTold.add(lacking);
        return soft({ kind: "missing", objective: id, step: 0, item: lacking });
      }
    }

    // 두고 가는 물건 — 물건마다 한 번. 여럿이면 한 번에 하나씩, 나머지는 다음 차례에 다시 잡힌다
    if (leftBehind) {
      const { item, memo } = leftBehind;
      memo.isTold = true;
      return { kind: item.isDropped ? "dropped" : "unpicked", objective: id, step: 0, item: item.kind, uid: item.uid };
    }

    // 숨이 모자란 동안은 아래 말들을 건너뛴다 — 센 것은 그대로 남아 숨이 찬 뒤에 말한다. 틀림도 물음으로 나가 숨 경고를 덮으므로 함께 미룬다
    const stuckNeed = record ? rules.stuckSec[record.stuckStep] : undefined;
    if (id && record && canSpeakSoft && !isBreathShort) {
      const wrongNeed = rules.wrongCount[record.wrongStep];
      if (wrongNeed !== undefined && (seen.mistakes[id] ?? 0) >= wrongNeed) {
        // 틀린 직후엔 「오래 걸린다」를 겹쳐 말하지 않는다
        record.sinceProgressSec = 0;
        return soft({ kind: "wrong", objective: id, step: record.wrongStep++ });
      }
      const astrayNeed = rules.astraySec[record.astrayStep];
      if (astrayNeed !== undefined && record.awaySec >= astrayNeed) {
        record.awaySec = 0;
        return soft({ kind: "astray", objective: id, step: record.astrayStep++ });
      }
      // 목표 자리 밖에 있으면 「막혔다」가 아니라 「딴 데 있다」다
      if (stuckNeed !== undefined && record.sinceProgressSec >= stuckNeed && !isOutside(id, seen)) {
        return soft({ kind: "stuck", objective: id, step: record.stuckStep++ });
      }
      if (!record.isOvertimeTold && record.activeSec >= OBJECTIVES[id].limitSec) {
        record.isOvertimeTold = true;
        return soft({ kind: "overtime", objective: id, step: 0 });
      }
    }
    const idleNeed = rules.idleSec[idleStep];
    if (idleNeed !== undefined && idleSec >= idleNeed && canSpeakSoft && !isBreathShort) {
      return soft({ kind: "idle", objective: id, step: idleStep++ });
    }

    // 풀림 · 도착 — 놓치면 안 되는 말이라 간격을 따지지 않는다. 도착은 그 목표가 아직 지금 목표일 때만 뜻이 있다
    const solved = owedSolved.shift();
    if (solved) return { kind: "solved", objective: solved, step: 0 };
    if (id && !arrived.has(id)) {
      arrived.add(id);
      return { kind: "arrive", objective: id, step: 0 };
    }

    // 잡담 — 다른 말이 없고 숨이 급하지 않을 때만. 곧 「막혔나요?」를 물을 참이면 그 직전에 끼어들지 않는다.
    // 물굴 안에서는 하지 않는다(§10-5 — 숨을 세는 곳이라 말을 줄인다)
    const isCalm = zone !== "cave" && (seen.breath === null || seen.breath > rules.breathRearmSec);
    const isStuckSoon = !!record && stuckNeed !== undefined && record.sinceProgressSec >= stuckNeed - rules.softGapSec;
    if (isCalm && !isStuckSoon && seen.now - lastSpokeAt >= rules.chatterGapSec) {
      // 목표를 한 번도 못 봤으면 아직 시작 자리다
      return soft({ kind: "chatter", objective: id, step: chatterStep++, zone: zone ?? "dock" });
    }
    return null;
  }

  /** 목표 자리 밖에 있나. 자리가 없는 목표(갇힌 곳)는 늘 안이다 */
  function isOutside(id: ObjectiveId, seen: Observation) {
    const { anchor } = OBJECTIVES[id];
    return !!anchor && Math.hypot(seen.x - anchor.x, seen.z - anchor.z) > anchor.radius;
  }

  return {
    observe,
    /** 플레이어가 먼저 물었거나 동행이 방금 말했다 — 한동안 먼저 말 걸지 않는다 */
    noteSpoken(now: number) {
      lastSoftAt = now;
      lastSpokeAt = now;
    },
    /** 게임이 알림을 띄웠다(뭔가 일어났다) — 잡담만 미룬다 */
    noteEvent(now: number) {
      lastSpokeAt = now;
    },
    recordOf: (id: ObjectiveId) => ({ ...recordOf(id) }),
  };
}

export type SituationWatcher = ReturnType<typeof createSituationWatcher>;
