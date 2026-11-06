// 시험 장치 — 설계 v0.19 7.5절. LOBBY_TEST_HOOKS=1 이고 test 프로필일 때만 만든다(운영 프로필이면 시작 검사에서 막힌다).
// 꺼져 있으면 이 파일의 코드는 아예 타지 않는다.
//   · 마지막 자리 경합: 두 요청의 첫 방 조회(driver.findOne)를 붙잡았다가 둘이 모이면 함께 풀어 같은 방을 고르게 한다.
//   · 인증 기록: 서버가 정한 요청 번호로 「첫 인증 / 같은 요청의 재인증 / 거절 사유」를 남긴다. 티켓 원문은 남기지 않는다.
import { createServer, type Server as HttpServer } from "node:http";

import { LocalDriver } from "@colyseus/core";

export interface TraceEntry {
  request: number;
  event: string;
  at: number;
}

const TRACE_LIMIT = 500;

export class AuthTrace {
  readonly #ids = new WeakMap<object, number>();
  #next = 1;
  readonly entries: TraceEntry[] = [];

  idFor(context: object): number {
    let id = this.#ids.get(context);
    if (id === undefined) {
      id = this.#next;
      this.#next += 1;
      this.#ids.set(context, id);
    }
    return id;
  }

  record(context: object, event: string): void {
    this.entries.push({ request: this.idFor(context), event, at: Date.now() });
    if (this.entries.length > TRACE_LIMIT) this.entries.splice(0, this.entries.length - TRACE_LIMIT);
  }
}

type FindOneArgs = Parameters<LocalDriver["findOne"]>;

/** 첫 경합만 붙잡는 매칭 드라이버. 패한 요청의 다음 방 조회는 그대로 진행한다 */
export class RaceDriver extends LocalDriver {
  #armed = false;
  #waiting: Array<() => void> = [];
  #timer: NodeJS.Timeout | null = null;
  /** 마지막 경합의 결과 — "paired" | "timeout" */
  lastRace: string | null = null;

  arm(timeoutMs = 5000): void {
    this.#armed = true;
    this.lastRace = null;
    this.#timer = setTimeout(() => {
      // 한 요청만 도착하면 시험 실패로 보고 대기를 정리한다
      this.lastRace = "timeout";
      this.#releaseAll();
    }, timeoutMs);
    this.#timer.unref();
  }

  #releaseAll(): void {
    this.#armed = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const waiting = this.#waiting;
    this.#waiting = [];
    waiting.forEach((resume) => resume());
  }

  override findOne(...args: FindOneArgs): ReturnType<LocalDriver["findOne"]> {
    const [conditions] = args;
    // 「들어갈 수 있는 방 찾기」(locked: false 조건)만 붙잡는다 — roomId 로 찾는 조회는 그대로
    if (!this.#armed || !conditions || !("locked" in conditions)) return super.findOne(...args);
    return new Promise((resolve) => {
      this.#waiting.push(() => resolve(super.findOne(...args)));
      if (this.#waiting.length >= 2) {
        this.lastRace = "paired";
        this.#releaseAll();
      }
    }) as unknown as ReturnType<LocalDriver["findOne"]>;
  }
}

export interface TestHooks {
  trace: AuthTrace;
  driver: RaceDriver;
  /** 다음 방 생성 한 번을 초기화 실패로 만든다 */
  failNextRoomInit: boolean;
}

export function createTestHooks(): TestHooks {
  return { trace: new AuthTrace(), driver: new RaceDriver(), failNextRoomInit: false };
}

/**
 * 격리된 시험 환경에서 원격으로 장치를 다루는 창구. 127.0.0.1 에만 붙는다.
 *   POST /race/arm · POST /room-init/fail-next · GET /trace · GET /race
 */
export function startTestHookServer(hooks: TestHooks, port: number): Promise<HttpServer> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/race/arm") {
      hooks.driver.arm();
      send(200, { armed: true });
    } else if (req.method === "POST" && req.url === "/room-init/fail-next") {
      hooks.failNextRoomInit = true;
      send(200, { failNextRoomInit: true });
    } else if (req.method === "GET" && req.url === "/trace") {
      send(200, { entries: hooks.trace.entries });
    } else if (req.method === "GET" && req.url === "/race") {
      send(200, { lastRace: hooks.driver.lastRace });
    } else {
      send(404, { error: "not_found" });
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
