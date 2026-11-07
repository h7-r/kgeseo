// 팀 캐릭터 다섯 명을 방마다 상시 NPC 로 둔다(미르 11/8, 검토 22회차). 계정 · 입장권 없이 서버가 방 상태(players)에 넣고
// 움직인다 — 화면은 사람과 똑같이 그린다(이름 · 외형 · 걷기 · 인사 · 맞으면 밀림). 접속 정원(ROOM_CAPACITY)은 연결 수라
// NPC 는 세지 않는다. 방이 사라지면(마지막 사람이 나가면) 같이 사라진다.
// 걷기는 가상 인원 스크립트(scripts/preview-bots.mjs)와 같다: 빈칸을 골라 길을 찾아 걷고, 사람 사이로 파고들지 않고,
// 막히면 피해 다시 찾고, 서서 쉬고, 가끔 근처 사람에게 인사한다. 맞으면 0.2초 뒤 지수 감쇠로 1.2 유닛 밀린다.
// 모습 · 이름은 lobby/data/team-npcs.json(팀 꾸미기 창이 쓴다) — 2초마다 바뀌었는지 보고 바뀌면 바로 갈아입힌다.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { MapSchema } from "@colyseus/schema";

import type { Logger } from "../log.js";
import { LOOK_CATALOG_VERSION, lookToStateString } from "../look.js";
import { GREET_IDS } from "../movement.js";
import { Player } from "../state.js";
import { cellCenter, cellIndex, clearance, findPath, isFree, nearPerson, type Person, REACHABLE } from "./hqMap.js";
import {
  parseTeamFile,
  TEAM_LOOK_ITEMS,
  TEAM_SLOTS,
  type TeamEntry,
  type TeamFile,
  type TeamSlot,
} from "./teamRoster.js";

/** 방 상태 키 · 가명 ID 앞머리 — 연결 ID(무작위 9자)와 겹치지 않는다 */
export const NPC_SID_PREFIX = "npc-";
export const isNpcSid = (sid: string) => sid.startsWith(NPC_SID_PREFIX);
export const NPC_TICK_MS = 125;

const TEAM_FILE = process.env.TEAM_NPC_FILE ?? fileURLToPath(new URL("../../data/team-npcs.json", import.meta.url));
const FILE_CHECK_MS = 2000;

const WALK_SPEED = 3.0;
/** NPC 끼리 중심 사이 최소 거리 */
const PERSON_GAP = 1.3;
/** 사람에게는 더 넉넉히 — 사람 자리는 화면이 0.1초마다 보내 늦게 안다 */
const HUMAN_GAP = 1.8;
/** 이 거리 안에 사람이 있을 때만 인사한다(허공에 인사하지 않게) */
const GREET_NEAR = 6;
// 맞으면 밀림 — 게임 화면 · 가상 인원과 같은 값(src/dev/lobbyPreview/previewState.ts HIT_PUSH_DISTANCE · engine/movement/push.ts)
const PUSH_DISTANCE = 1.2;
const PUSH_DECAY = 7;
const PUSH_SPEED_LIMIT = WALK_SPEED * 2.58 * 1.2;
const PUSH_IMPACT_MS = 200;
const PUSH_CHECK = 0.05;

/** 저장값이 없을 때의 기본 모습(화면 src/net/lobbyLook.ts 의 기본 착장 · 체형과 같다) */
const DEFAULT_BODY: Record<string, number> = {
  heightScale: 1,
  headScale: 0.8,
  handScale: 1,
  footScale: 1,
  shoulderWidth: 1.2,
  hipWidth: 1,
  armLength: 0.88,
  legLength: 1,
  armThickness: 0.85,
  legThickness: 0.85,
  build: -0.2,
  buff: 0,
};
const DEFAULT_COLORS = { skin: "#f0d8c8", hair: "#2e2a30", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" };

function defaultLook(gender: TeamSlot["gender"]) {
  return {
    catalog: LOOK_CATALOG_VERSION,
    gender,
    hair: gender === "feminine" ? "hair.f.bob" : "hair.m.crop",
    top: "top.tee.white",
    bottom: "bottom.shorts.black",
    shoes: "shoes.sneaker.white",
    colors: { ...DEFAULT_COLORS },
    body: { ...DEFAULT_BODY },
  };
}

/** 저장값 → 방 상태 look 문자열. 사람과 같은 검사(+ 팀 전용 옷)를 지나야 하고, 틀리면 기본 모습 */
function lookStringOf(slot: TeamSlot, entry: TeamEntry | undefined): { look: string; valid: boolean } {
  if (entry) {
    const { appearance } = entry;
    const look = lookToStateString(
      {
        catalog: LOOK_CATALOG_VERSION,
        gender: appearance.gender,
        hair: appearance.hairId ?? "hair.none",
        top: appearance.equipmentIds.top ?? "top.none",
        bottom: appearance.equipmentIds.bottom ?? "bottom.none",
        shoes: appearance.equipmentIds.shoes ?? "shoes.none",
        colors: appearance.colors,
        body: appearance.bodyParameters,
      },
      TEAM_LOOK_ITEMS,
    );
    if (look) return { look, valid: true };
  }
  return { look: lookToStateString(defaultLook(entry?.appearance.gender ?? slot.gender)), valid: !entry };
}

// 파일은 서버 전체에서 하나 — 방마다 따로 읽지 않는다
let cachedFile: { mtimeMs: number; file: TeamFile } | null = null;
let checkedAt = -Infinity;
function teamFile(nowMs: number): TeamFile {
  // 시계가 뒤로 가도(시각 조정) 다시 본다
  if (cachedFile && Math.abs(nowMs - checkedAt) < FILE_CHECK_MS) return cachedFile.file;
  checkedAt = nowMs;
  try {
    const { mtimeMs } = statSync(TEAM_FILE);
    if (cachedFile?.mtimeMs !== mtimeMs) {
      cachedFile = { mtimeMs, file: parseTeamFile(JSON.parse(readFileSync(TEAM_FILE, "utf8"))) };
    }
  } catch {
    // 파일이 없거나 깨졌다 — 다섯 명은 기본 모습으로 그대로 돌아다닌다
    cachedFile = { mtimeMs: -1, file: { version: 1, npcs: {} } };
  }
  return cachedFile.file;
}

interface PendingPush {
  at: number;
  x: number;
  z: number;
}

interface Walker {
  sid: string;
  slot: TeamSlot;
  player: Player;
  x: number;
  z: number;
  ry: number;
  path: Array<[number, number]>;
  goalX: number;
  goalZ: number;
  speed: number;
  idleUntil: number;
  blockedSince: number | undefined;
  nextGreetAt: number;
  pendingPushes: PendingPush[];
  push: { x: number; z: number } | null;
  /** 지금 입은 모습(바뀌었는지 견준다) */
  appliedLook: string;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export interface TeamNpcCrewOptions {
  nowMs: () => number;
  /** 인사 방송 — 사람 인사와 같은 메시지 */
  greet: (sid: string, id: number) => void;
  log: Logger;
}

/** 한 방의 팀 NPC 다섯 명 */
export class TeamNpcCrew {
  readonly #players: MapSchema<Player>;
  readonly #options: TeamNpcCrewOptions;
  readonly #walkers = new Map<string, Walker>();
  #lastStepAt: number;

  constructor(players: MapSchema<Player>, options: TeamNpcCrewOptions) {
    this.#players = players;
    this.#options = options;
    this.#lastStepAt = options.nowMs();
  }

  has(sid: string) {
    return this.#walkers.has(sid);
  }

  /** 방이 생길 때 한 번 — 다섯 명을 서로 · 사람과 떨어진 빈칸에 세운다 */
  spawn() {
    const now = this.#options.nowMs();
    const file = teamFile(now);
    let invalid = 0;
    for (const slot of TEAM_SLOTS) {
      const sid = `${NPC_SID_PREFIX}${slot.key}`;
      const entry = file.npcs[slot.key];
      const { look, valid } = lookStringOf(slot, entry);
      if (!valid) invalid += 1;
      const others = this.#othersOf(sid);
      const [x, z] = this.#freeSpot(others);
      const player = new Player();
      player.nickname = entry?.displayName ?? slot.name;
      player.pid = sid;
      player.look = look;
      player.npc = true;
      Object.assign(player, { x, y: 0, z, ry: between(-Math.PI, Math.PI), gait: "idle", placed: true });
      this.#players.set(sid, player);
      this.#walkers.set(sid, {
        sid,
        slot,
        player,
        x,
        z,
        ry: player.ry,
        path: [],
        goalX: x,
        goalZ: z,
        speed: WALK_SPEED,
        idleUntil: now + between(500, 4000),
        blockedSince: undefined,
        nextGreetAt: now + between(8000, 30000),
        pendingPushes: [],
        push: null,
        appliedLook: `${player.nickname}\n${look}`,
      });
    }
    this.#options.log("npc_spawned", { count: this.#walkers.size, invalid });
  }

  /** 서버 판정으로 맞았다 — 때린 사람 반대쪽으로(붙어 있으면 때린 사람 몸 방향으로) 주먹이 닿는 순간부터 민다 */
  hit(sid: string, attacker: { x: number; z: number; ry: number }) {
    const walker = this.#walkers.get(sid);
    if (!walker) return;
    let dx = walker.x - attacker.x;
    let dz = walker.z - attacker.z;
    if (Math.hypot(dx, dz) < 0.3) {
      dx = Math.sin(attacker.ry);
      dz = Math.cos(attacker.ry);
    }
    const length = Math.hypot(dx, dz) || 1;
    walker.pendingPushes.push({ at: this.#options.nowMs() + PUSH_IMPACT_MS, x: dx / length, z: dz / length });
  }

  step() {
    const now = this.#options.nowMs();
    const dt = Math.min(0.5, Math.max(0, (now - this.#lastStepAt) / 1000));
    this.#lastStepAt = now;
    this.#refreshLooks(now);
    for (const walker of this.#walkers.values()) this.#stepWalker(walker, now, dt);
  }

  /** 꾸미기 창이 저장하면 지금 방의 다섯 명도 바로 갈아입는다 */
  #refreshLooks(now: number) {
    const file = teamFile(now);
    for (const walker of this.#walkers.values()) {
      const entry = file.npcs[walker.slot.key];
      const { look } = lookStringOf(walker.slot, entry);
      const nickname = entry?.displayName ?? walker.slot.name;
      const key = `${nickname}\n${look}`;
      if (key === walker.appliedLook) continue;
      walker.appliedLook = key;
      walker.player.look = look;
      walker.player.nickname = nickname;
      this.#options.log("npc_look_changed", { npc: walker.slot.key });
    }
  }

  /** 이 NPC 말고 방에 있는 모두의 자리 */
  #othersOf(selfSid: string): Person[] {
    const list: Person[] = [];
    this.#players.forEach((player, sid) => {
      if (sid === selfSid || !player.placed) return;
      const walker = this.#walkers.get(sid);
      if (walker) list.push([walker.x, walker.z, PERSON_GAP]);
      else list.push([player.x, player.z, HUMAN_GAP]);
    });
    return list;
  }

  #freeSpot(others: readonly Person[]): [number, number] {
    for (let tries = 0; tries < 200; tries += 1) {
      const [x, z] = cellCenter(pick(REACHABLE));
      if (!nearPerson(x, z, others, 0.7)) return [x, z];
    }
    return cellCenter(pick(REACHABLE));
  }

  #chooseTarget(self: Walker, others: readonly Person[]) {
    for (let tries = 0; tries < 50; tries += 1) {
      const k = pick(REACHABLE);
      const [x, z] = cellCenter(k);
      const far = Math.hypot(x - self.x, z - self.z) > 3;
      const alone =
        [...this.#walkers.values()].every(
          (other) => other === self || Math.hypot(x - other.goalX, z - other.goalZ) > 2.5,
        ) && !nearPerson(x, z, others, 1);
      if (far && alone) return { k, x, z };
    }
    return null;
  }

  /** 밀림을 이번 틱만큼 적용한다 */
  #applyPush(walker: Walker, now: number, dt: number) {
    const due = walker.pendingPushes.filter((push) => push.at <= now);
    if (due.length) {
      walker.pendingPushes = walker.pendingPushes.filter((push) => push.at > now);
      walker.push ??= { x: 0, z: 0 };
      for (const push of due) {
        walker.push.x += push.x * PUSH_DISTANCE * PUSH_DECAY;
        walker.push.z += push.z * PUSH_DISTANCE * PUSH_DECAY;
      }
      const speed = Math.hypot(walker.push.x, walker.push.z);
      if (speed > PUSH_SPEED_LIMIT) {
        walker.push.x *= PUSH_SPEED_LIMIT / speed;
        walker.push.z *= PUSH_SPEED_LIMIT / speed;
      }
      walker.path = [];
      walker.blockedSince = undefined;
      walker.idleUntil = Math.max(walker.idleUntil, now + between(800, 1500));
    }
    if (!walker.push) return;
    // 한 틱의 밀림을 정확히 적분(게임과 같은 거리) → 잘게 나눠 축마다 막힘 검사, 막힌 축은 멈춘다
    const decay = Math.exp(-PUSH_DECAY * dt);
    const share = (1 - decay) / PUSH_DECAY;
    const moveX = walker.push.x * share;
    const moveZ = walker.push.z * share;
    walker.push.x *= decay;
    walker.push.z *= decay;
    // 사람도 막는다 — 이미 겹쳐 있으면 멀어지는 쪽만
    const others = this.#othersOf(walker.sid);
    const canGo = (x: number, z: number) =>
      isFree(x, z) &&
      (clearance(x, z, others) >= 0 || clearance(x, z, others) >= clearance(walker.x, walker.z, others));
    const pieces = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) / PUSH_CHECK));
    for (let i = 0; i < pieces; i += 1) {
      if (walker.push.x !== 0) {
        if (canGo(walker.x + moveX / pieces, walker.z)) walker.x += moveX / pieces;
        else walker.push.x = 0;
      }
      if (walker.push.z !== 0) {
        if (canGo(walker.x, walker.z + moveZ / pieces)) walker.z += moveZ / pieces;
        else walker.push.z = 0;
      }
    }
    if (Math.hypot(walker.push.x, walker.push.z) < 0.05) walker.push = null;
  }

  #stepWalker(walker: Walker, now: number, dt: number) {
    this.#applyPush(walker, now, dt);
    const others = this.#othersOf(walker.sid);
    if (!walker.path.length && !walker.push && now >= walker.idleUntil) {
      const target = this.#chooseTarget(walker, others);
      const path = target && findPath(walker.x, walker.z, target.k, others);
      if (target && path?.length) {
        walker.path = path;
        walker.goalX = target.x;
        walker.goalZ = target.z;
        walker.speed = WALK_SPEED * between(0.75, 1);
      } else {
        walker.idleUntil = now + 1000;
      }
    }
    let gait = "idle";
    if (walker.path.length) {
      let budget = walker.speed * dt;
      let blocked = false;
      while (budget > 0 && walker.path.length) {
        const [tx, tz] = walker.path[0]!;
        const dx = tx - walker.x;
        const dz = tz - walker.z;
        const distance = Math.hypot(dx, dz);
        const move = Math.min(distance, budget);
        const nx = distance > 1e-6 ? walker.x + (dx / distance) * move : tx;
        const nz = distance > 1e-6 ? walker.z + (dz / distance) * move : tz;
        // 막힌 자리로는 안 간다(길이 어긋났을 때의 마지막 방어) · 사람 사이로 파고드는 걸음은 하지 않는다(이미 가까우면 멀어지는 걸음만)
        const next = clearance(nx, nz, others);
        if (!isFree(nx, nz) || (next < 0 && next < clearance(walker.x, walker.z, others))) {
          blocked = true;
          break;
        }
        walker.x = nx;
        walker.z = nz;
        budget -= move;
        if (move >= distance) walker.path.shift();
        // 몸 방향 규약: 앞 = (sin ry, cos ry)
        if (distance > 1e-3) walker.ry = Math.atan2(dx, dz);
      }
      if (blocked) {
        walker.blockedSince ??= now;
        if (now - walker.blockedSince > 1000) {
          // 막은 사람들을 피해 같은 목표로 다시 — 길이 없으면 잠깐 서 있다가 다른 곳으로
          const path = findPath(walker.x, walker.z, cellIndex(walker.goalX, walker.goalZ), others);
          walker.path = path?.length ? path : [];
          if (!walker.path.length) walker.idleUntil = now + between(1000, 3000);
          walker.blockedSince = undefined;
        }
      } else {
        walker.blockedSince = undefined;
      }
      gait = walker.path.length && !blocked ? "walk" : "idle";
      if (!walker.path.length) walker.idleUntil = Math.max(walker.idleUntil, now + between(1500, 7000));
    }
    // 가끔 근처 사람에게 인사한다 — 서 있으면 그 사람 쪽을 본다
    if (now >= walker.nextGreetAt) {
      walker.nextGreetAt = now + between(20000, 50000);
      const human = this.#nearestHuman(walker);
      if (human && human.distance <= GREET_NEAR) {
        if (gait === "idle") walker.ry = Math.atan2(human.x - walker.x, human.z - walker.z);
        this.#options.greet(walker.sid, pick(GREET_IDS));
      }
    }
    const { player } = walker;
    player.x = walker.x;
    player.y = 0;
    player.z = walker.z;
    player.ry = walker.ry;
    player.gait = gait;
  }

  #nearestHuman(walker: Walker) {
    let best: { x: number; z: number; distance: number } | null = null;
    this.#players.forEach((player, sid) => {
      if (!player.placed || this.#walkers.has(sid)) return;
      const distance = Math.hypot(player.x - walker.x, player.z - walker.z);
      if (!best || distance < best.distance) best = { x: player.x, z: player.z, distance };
    });
    return best as { x: number; z: number; distance: number } | null;
  }
}
