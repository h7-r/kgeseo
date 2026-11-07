// 본부실 로비 방 — 설계 v0.19 3절(입장)·5절(방·아바타·인사).
// 의존(인증·방 상한·시계·로그)을 받아 방 클래스를 만든다. 시험이 같은 코드를 따로 묶어 돌릴 수 있게.
import { Room, type Client } from "@colyseus/core";

import { type OnlineAccounts, pidFor } from "./accounts.js";
import type { Authenticator, AuthContextLike } from "./authenticate.js";
import { type ChatGuard, CHAT_REJECT_REASONS } from "./chat.js";
import { authError, lobbyFullError, REJECT } from "./errors.js";
import type { Logger } from "./log.js";
import { lookToStateString } from "./look.js";
import { GreetGate, MoveGate, parsePose } from "./movement.js";
import { isNpcSid, NPC_TICK_MS, TeamNpcCrew } from "./npc/teamNpcs.js";
import { type BodyAt, canHit, PunchGate } from "./punch.js";
import type { RoomCap, RoomSlot } from "./roomCap.js";
import { LobbyState, Player } from "./state.js";
import type { VerifiedTicket } from "./ticket.js";

export const ROOM_NAME = "lobby";
export const ROOM_CAPACITY = 10;
/** Colyseus 기본값은 15초 — 연결하지 않은 좌석을 5초 뒤 푼다(3절) */
export const SEAT_RESERVATION_SECONDS = 5;
/** 🟡 시작값 — 서버 패치·화면 보간 100ms(5절) */
export const PATCH_RATE_MS = 100;
/**
 * 연결당 초당 메시지 상한 — 넘으면 Colyseus 가 그 연결을 끊는다(검토 14회차 5). 정상 송신은 이동 10 + 주먹 약 3 + 인사·채팅 몇 개라
 * 넉넉히 30. 채팅 통은 비싼 판정을 줄이고, 이것은 받기·해석 폭주를 막는다.
 */
export const MAX_MESSAGES_PER_SECOND = 30;

export interface LobbyRoomDeps {
  authenticate: Authenticator;
  roomCap: RoomCap;
  log: Logger;
  /** Unix 초 */
  now?: () => number;
  /** 서버 수신 시각(ms) */
  nowMs?: () => number;
  /** 시험 장치 — 자리를 확보한 뒤 초기화가 실패하는 경우를 만든다 */
  failAfterAcquire?: () => boolean;
  /** 채팅 검사(계정 기준 — 서버 전체에서 하나) */
  chatGuard: ChatGuard;
  /** 지금 붙어 있는 계정(같은 계정 두 번 접속·명단 제재) — 서버 전체에서 하나 */
  online: OnlineAccounts<Client>;
  /** 숨기기용 가명 ID 를 만드는 키(입장권 서명 키를 쓴다) */
  pidSecret: Uint8Array;
  /** 방마다 팀 캐릭터 다섯 명을 둔다(검토 22회차). 서버는 켜고, 방 인원을 세는 시험은 끈다 */
  teamNpcs?: boolean;
}

export function createLobbyRoom({
  authenticate,
  roomCap,
  log,
  now = () => Date.now() / 1000,
  nowMs = () => Date.now(),
  failAfterAcquire,
  chatGuard,
  online,
  pidSecret,
  teamNpcs = false,
}: LobbyRoomDeps) {
  return class LobbyRoom extends Room<{ state: LobbyState }> {
    override maxClients = ROOM_CAPACITY;

    #slot: RoomSlot | null = null;
    readonly #moves = new Map<string, MoveGate>();
    readonly #greets = new Map<string, GreetGate>();
    readonly #punches = new Map<string, PunchGate>();
    /** 마지막 정상 위치를 받은 서버 시각(ms) — 때리기 판정이 낡은 자리로 맞히지 않게 */
    readonly #poseAt = new Map<string, number>();
    /** 연결 ID → 계정 ID. 서버 안에서만 쓰고 상태·방송·로그에는 넣지 않는다 */
    readonly #subs = new Map<string, string>();
    /** 팀 캐릭터 NPC(방 상태에 사람처럼 들어간다 — 키 npc-*) */
    #npcs: TeamNpcCrew | null = null;

    static override onAuth(token: string, options: unknown, context: AuthContextLike) {
      return authenticate(token, options, context);
    }

    override onCreate() {
      // 비동기 작업 전에 자리를 확보한다
      const slot = roomCap.tryAcquire();
      if (!slot) {
        log("room_create_rejected", { reason: REJECT.LOBBY_FULL, rooms: roomCap.used });
        throw lobbyFullError();
      }
      this.#slot = slot;
      try {
        if (failAfterAcquire?.()) throw new Error("test hook: room init failure");
        this.seatReservationTimeout = SEAT_RESERVATION_SECONDS;
        this.patchRate = PATCH_RATE_MS;
        this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
        this.state = new LobbyState();
        this.onMessage("move", (client: Client, message: unknown) => this.#onMove(client, message));
        this.onMessage("greet", (client: Client, message: unknown) => this.#onGreet(client, message));
        this.onMessage("punch", (client: Client, message: unknown) => this.#onPunch(client, message));
        this.onMessage("chat", (client: Client, message: unknown) => this.#onChat(client, message));
        // 정해진 세 가지 말고는 조용히 버린다
        this.onMessage("*", () => {});
        if (teamNpcs) {
          this.#npcs = new TeamNpcCrew(this.state.players, {
            nowMs,
            greet: (sid, id) => this.broadcast("greet", { sid, id }),
            // NPC 대사(검토 25회차) — 화면은 말풍선 + 동작만, 채팅 기록에는 넣지 않는다
            act: (sid, text, gesture) => this.broadcast("npcAct", { sid, text, gesture }),
            log,
          });
          this.#npcs.spawn();
          // 방 시계 — 방이 없어지면 같이 멈춘다
          this.clock.setInterval(() => this.#npcs?.step(), NPC_TICK_MS);
        }
      } catch (error) {
        this.#releaseSlot("create_failed");
        throw error;
      }
      log("room_created", { rooms: roomCap.used });
    }

    override onJoin(client: Client, options: unknown, auth: unknown) {
      const ticket = auth as Partial<VerifiedTicket> | undefined;
      if (!ticket || typeof ticket.exp !== "number" || typeof ticket.nickname !== "string" || !ticket.sub) {
        log("join_rejected", { reason: REJECT.AUTH_MISSING });
        throw authError(REJECT.AUTH_MISSING);
      }
      // 예약은 살아 있어도 티켓이 만료됐으면 들이지 않는다 — 아바타·메시지 권한을 만들지 않는다
      if (now() >= ticket.exp) {
        log("join_rejected", { reason: REJECT.TICKET_EXPIRED });
        throw authError(REJECT.TICKET_EXPIRED);
      }
      const joinOptions = (typeof options === "object" && options !== null ? options : {}) as Record<string, unknown>;
      const player = new Player();
      player.nickname = ticket.nickname;
      player.pid = pidFor(pidSecret, ticket.sub);
      player.look = lookToStateString(joinOptions.look);
      player.placed = false;
      player.gait = "idle";
      const moves = new MoveGate();
      const start = parsePose(joinOptions.pose);
      const joinedAt = nowMs();
      if (start && moves.accept(start, joinedAt)) {
        Object.assign(player, { x: start.x, y: start.y, z: start.z, ry: start.ry, gait: start.gait, placed: true });
        this.#poseAt.set(client.sessionId, joinedAt);
      }
      this.#moves.set(client.sessionId, moves);
      this.#greets.set(client.sessionId, new GreetGate());
      this.#punches.set(client.sessionId, new PunchGate());
      this.state.players.set(client.sessionId, player);
      this.#subs.set(client.sessionId, ticket.sub);
      // 같은 계정의 먼저 붙은 연결은 끊는다(나중 접속이 이긴다 — 미르 11/7 「표준대로」). 보통은 매칭 전에 이미 끊었다(server.ts)
      if (online.claim(ticket.sub, client, () => this.#revoke(client.sessionId)))
        log("join_replaced_previous", { rooms: roomCap.used });
      log("join", { clients: this.clients.length, look: player.look !== "", rooms: roomCap.used });
    }

    override onLeave(client: Client, code?: number) {
      const existed = this.state.players.delete(client.sessionId);
      this.#moves.delete(client.sessionId);
      this.#greets.delete(client.sessionId);
      this.#punches.delete(client.sessionId);
      this.#poseAt.delete(client.sessionId);
      const sub = this.#subs.get(client.sessionId);
      if (sub) online.release(sub, client);
      this.#subs.delete(client.sessionId);
      if (existed) log("leave", { code: code ?? null, clients: this.clients.length });
    }

    /**
     * 이 연결의 메시지 권한을 바로 거둔다 — 같은 계정 새 접속·명단 제재. 끊김 신호(leave)는 상대가 닫기에 응해야 끝나므로
     * 그 사이 채팅·이동·주먹이 들어와도 받지 않게 검사 상태와 아바타를 먼저 지운다(각 처리기가 검사기·아바타가 없으면
     * 그냥 돌아간다). 계정(#subs)은 남긴다 — onLeave 가 그것으로 online.release 를 불러야 새 접속의 기다림(evict)이 바로 끝난다.
     */
    #revoke(sid: string) {
      this.#moves.delete(sid);
      this.#greets.delete(sid);
      this.#punches.delete(sid);
      this.#poseAt.delete(sid);
      this.state.players.delete(sid);
    }

    override onDispose() {
      this.#npcs = null;
      this.#releaseSlot("disposed");
    }

    #releaseSlot(reason: string) {
      if (this.#slot?.release()) log("room_slot_released", { reason, rooms: roomCap.used });
    }

    #onMove(client: Client, message: unknown) {
      const gate = this.#moves.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!gate || !player) return;
      const at = nowMs();
      const pose = gate.accept(message, at);
      if (!pose) return;
      this.#poseAt.set(client.sessionId, at);
      player.x = pose.x;
      player.y = pose.y;
      player.z = pose.z;
      player.ry = pose.ry;
      player.gait = pose.gait;
      player.placed = true;
    }

    #onGreet(client: Client, message: unknown) {
      const gate = this.#greets.get(client.sessionId);
      if (!gate || !this.state.players.has(client.sessionId)) return;
      const id = gate.accept(message, nowMs());
      if (id === null) return;
      // 검사한 연결 ID 와 문구 번호만 보낸다. 화면이 목록에서 문구를 찾는다
      this.broadcast("greet", { sid: client.sessionId, id });
    }

    #onChat(client: Client, message: unknown) {
      const sub = this.#subs.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!sub || !player) return;
      const at = nowMs();
      const result = chatGuard.check(sub, message, at);
      const counts = chatGuard.takeRejectCounts(at);
      // 원문·계정은 남기지 않는다 — 사유별 개수만 1분에 한 줄
      if (counts)
        log("chat_rejected", Object.fromEntries(CHAT_REJECT_REASONS.map((reason) => [reason, counts[reason] ?? 0])));
      if (!result.ok) {
        if (result.reply) client.send("chatRejected", { reason: result.reason });
        return;
      }
      // 이름·가명 ID 를 서버가 확정해 함께 보낸다 — 방 상태보다 먼저 닿거나 보낸 사람이 나가도 화면이 이름을 안다(검토 14회차 4)
      this.broadcast("chat", { sid: client.sessionId, pid: player.pid, nickname: player.nickname, text: result.text });
    }

    #bodyOf(sid: string): BodyAt | null {
      const player = this.state.players.get(sid);
      if (!player) return null;
      const { placed, x, y, z, ry } = player;
      return { placed, x, y, z, ry, poseAt: this.#poseAt.get(sid) ?? -Infinity };
    }

    #onPunch(client: Client, message: unknown) {
      const gate = this.#punches.get(client.sessionId);
      const attacker = this.#bodyOf(client.sessionId);
      if (!gate || !attacker) return;
      const at = nowMs();
      const request = gate.accept(message, at);
      if (!request) return;
      // 보낸 사람은 연결에서 정한다. 상대는 같은 방에 있고, 자기 자신이 아니고, 서버가 아는 자리로 칠 수 있을 때만
      const target = request.target && request.target !== client.sessionId ? this.#bodyOf(request.target) : null;
      const hit = target && canHit(attacker, target, at) ? request.target : null;
      // NPC 는 화면이 아니라 서버가 밀어낸다(사람은 맞은 사람 화면이 자기 몸을 민다)
      if (hit && isNpcSid(hit)) this.#npcs?.hit(hit, attacker);
      this.broadcast(
        "punch",
        hit
          ? { sid: client.sessionId, motion: request.motion, hit }
          : { sid: client.sessionId, motion: request.motion },
      );
    }
  };
}
