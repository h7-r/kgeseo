// 본부실 로비 방 — 설계 v0.19 3절(입장)·5절(방·아바타·인사).
// 의존(인증·방 상한·시계·로그)을 받아 방 클래스를 만든다. 시험이 같은 코드를 따로 묶어 돌릴 수 있게.
import { Room, type Client } from "@colyseus/core";

import type { Authenticator, AuthContextLike } from "./authenticate.js";
import { authError, lobbyFullError, REJECT } from "./errors.js";
import type { Logger } from "./log.js";
import { lookToStateString } from "./look.js";
import { GreetGate, MoveGate, parsePose } from "./movement.js";
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
}

export function createLobbyRoom({
  authenticate,
  roomCap,
  log,
  now = () => Date.now() / 1000,
  nowMs = () => Date.now(),
  failAfterAcquire,
}: LobbyRoomDeps) {
  return class LobbyRoom extends Room<{ state: LobbyState }> {
    override maxClients = ROOM_CAPACITY;

    #slot: RoomSlot | null = null;
    readonly #moves = new Map<string, MoveGate>();
    readonly #greets = new Map<string, GreetGate>();
    readonly #punches = new Map<string, PunchGate>();
    /** 마지막 정상 위치를 받은 서버 시각(ms) — 때리기 판정이 낡은 자리로 맞히지 않게 */
    readonly #poseAt = new Map<string, number>();

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
        this.state = new LobbyState();
        this.onMessage("move", (client: Client, message: unknown) => this.#onMove(client, message));
        this.onMessage("greet", (client: Client, message: unknown) => this.#onGreet(client, message));
        this.onMessage("punch", (client: Client, message: unknown) => this.#onPunch(client, message));
        // 정해진 세 가지 말고는 조용히 버린다
        this.onMessage("*", () => {});
      } catch (error) {
        this.#releaseSlot("create_failed");
        throw error;
      }
      log("room_created", { rooms: roomCap.used });
    }

    override onJoin(client: Client, options: unknown, auth: unknown) {
      const ticket = auth as Partial<VerifiedTicket> | undefined;
      if (!ticket || typeof ticket.exp !== "number" || typeof ticket.nickname !== "string") {
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
      log("join", { clients: this.clients.length, look: player.look !== "", rooms: roomCap.used });
    }

    override onLeave(client: Client, code?: number) {
      const existed = this.state.players.delete(client.sessionId);
      this.#moves.delete(client.sessionId);
      this.#greets.delete(client.sessionId);
      this.#punches.delete(client.sessionId);
      this.#poseAt.delete(client.sessionId);
      if (existed) log("leave", { code: code ?? null, clients: this.clients.length });
    }

    override onDispose() {
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
      this.broadcast(
        "punch",
        hit
          ? { sid: client.sessionId, motion: request.motion, hit }
          : { sid: client.sessionId, motion: request.motion },
      );
    }
  };
}
