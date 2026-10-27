// 나주 게임 상태 → NPC 게임 이벤트. 게임 모듈을 읽는 곳은 이 파일 하나다(비교 규칙은 gameEventDiff.ts — 순수 로직).
// 나주 게임에는 이벤트 발행·구독 장치가 없어 매 프레임 상태를 읽어 지난 관측과 비교한다. 게임 상태에는 절대 쓰지 않는다.
//
// [읽는 것]  (모두 게임이 이미 들고 있는 값 — 공식 API 가 아니라 모듈 내부 필드다. PM 협의 사항: npc/INTEGRATION.md)
//   구역        terrain.groundAt(플레이어 발 자리).zone — 플레이어 실제 자리와 지형으로 직접 잰다.
//               focusFog 의 currentZone()·stage.zone 은 구역 초점이 꺼지면(?초점=끔) 갱신되지 않고, 이 훅보다 늦게 돌아
//               한 프레임 늦다 — 쓰지 않는다. 통로·연결로는 null(gameEventDiff 가 직전 구역을 유지한다).
//   단서        stage.seenClues (scene/immersion/state.ts) — director 의 임시 「단서발견」(씬 물체 2.5 m 근접)
//   씬 완료     focus.clearedScenes (scene/immersion/focusFog.ts) — endScene → scenePassed, 최댓값만 올라감
//   치운 차단물 terrain.clearedBlockers — useBlockerCollapse 가 무너짐이 끝난 뒤 채운다
//   연출 중     stage.cut !== null — 구역 진입 시점 컷. 차단물 무너짐 연출(collapseRef)은 NajuScene 안에 있어 여기서 못 본다.
//               구역 초점이 꺼지면 ImmersionLayer 가 붙지 않아 늘 false.
// [한계] 공식 세션 식별자가 없다. 게임 상태가 줄어들어도 세션 재시작으로 단정하지 않는다(gameEventDiff 참고).
import type { AvatarLink } from "@/engine/avatarLink";

import { UNITS_PER_METER } from "../plan/sitePlan";
import { focus } from "../scene/immersion/focusFog";
import { stage } from "../scene/immersion/state";
import type { Terrain } from "../terrain/terrain";
import type { GameEvent } from "./gameEvents";
import {
  createGameEventDiffer,
  type GameEventDiffer,
  type GameEventDifferOptions,
  type NajuGameSnapshot,
} from "./gameEventDiff";

/** 읽는 데 필요한 지형 부분 */
export type NajuGameTerrain = Pick<Terrain, "groundAt" | "clearedBlockers">;

const EMPTY: ReadonlySet<string> = new Set();

/** 구역 진입 시점 컷 연출 중 (stage.cut) — 게임 이벤트와 대화 접근 판정이 같이 쓴다 */
export const isEntryCutActive = (): boolean => stage.cut !== null;

/**
 * 지금 게임 상태를 읽는다. Set 은 게임이 들고 있는 것을 그대로 가리킨다(읽기 전용 타입) — 복사는 비교하는 쪽이 한다.
 * out 을 넘기면 그 객체를 고쳐 쓴다(프레임마다 새 객체를 만들지 않으려고).
 */
export function readNajuGameSnapshot(
  player: AvatarLink | null,
  terrain: NajuGameTerrain,
  out: NajuGameSnapshot = { zone: null, seenClues: EMPTY, clearedScenes: 0, clearedBlockers: EMPTY, cutActive: false },
): NajuGameSnapshot {
  out.zone = player
    ? terrain.groundAt(player.position.x / UNITS_PER_METER, player.position.z / UNITS_PER_METER).zone
    : null;
  out.seenClues = stage.seenClues;
  out.clearedScenes = focus.clearedScenes;
  out.clearedBlockers = terrain.clearedBlockers;
  out.cutActive = isEntryCutActive();
  return out;
}

export interface NajuGameEventSource {
  /** 지금 상태를 읽어 지난 관측과 비교한다. 처음 부르면 기준만 잡고 빈 배열 */
  poll(player: AvatarLink | null, terrain: NajuGameTerrain): GameEvent[];
  /** 기준을 다시 잡는다 (다음 poll 은 이벤트 없음) */
  rebaseline(reason: string): void;
  readonly differ: GameEventDiffer;
  /** 마지막으로 읽은 상태 (게임 Set 을 가리킨다 — 디버그 표시에만) */
  readonly last: Readonly<NajuGameSnapshot> | null;
}

export function createNajuGameEventSource(options?: GameEventDifferOptions): NajuGameEventSource {
  const differ = createGameEventDiffer(options);
  const snapshot: NajuGameSnapshot = {
    zone: null,
    seenClues: EMPTY,
    clearedScenes: 0,
    clearedBlockers: EMPTY,
    cutActive: false,
  };
  let read = false;
  return {
    poll(player, terrain) {
      readNajuGameSnapshot(player, terrain, snapshot);
      read = true;
      return differ.observe(snapshot);
    },
    rebaseline: (reason) => differ.rebaseline(reason),
    differ,
    get last() {
      return read ? snapshot : null;
    },
  };
}

/** 이벤트 읽기 비용 — 계측이 켜졌을 때만 시간을 잰다 */
export interface GameEventPollStats {
  polls: number;
  emitted: number;
  /** 계측(npcProfile.enabled)이 켜진 동안 잰 poll 수 · 합 · 최대 (ms, 컨트롤러 처리 포함) */
  timed: number;
  totalMs: number;
  maxMs: number;
}

export function createGameEventPollStats(): GameEventPollStats {
  return { polls: 0, emitted: 0, timed: 0, totalMs: 0, maxMs: 0 };
}
