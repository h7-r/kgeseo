// 로비 2단계 임시 시험 화면 — 상자 캐릭터로 입장·이동·인사·퇴장과 「혼자 둘러보는 중」을 본다.
// 본부실을 위에서 내려다본 평면에 나와 같은 방 사람들을 상자로 그린다. 실제 발급 경로(로그인 쿠키 → /api/v1/lobby/ticket)를 쓴다.
// 말풍선·인사창의 최종 모양은 3단계(해랑 님 톤)에서 정한다 — 여기는 동작만 본다.
import { useEffect, useRef, useState } from "react";

import { apiUrl, LOBBY_URL } from "@/config/env";
import { exposeDevHook } from "@/debug/devHooks";
import { RUN_SPEED_MULTIPLIER, WALK_SPEED } from "@/engine/movement/constants";
import { DEFAULT_CATALOG } from "@/naju";
import {
  createLobbyConnection,
  type GreetEvent,
  type LobbyLook,
  type LobbyPose,
  type LobbyStatus,
} from "@/net/colyseus";
import {
  HEADQUARTERS_MAX_X,
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_X,
  HEADQUARTERS_MIN_Z,
} from "@/station/layout/dimensions";

/** 설계 1절 인사 문구 6개(순서대로 1~6) */
const GREETINGS = ["안녕하세요", "반가워요", "나주 다녀올게요", "화이팅!", "고마워요", "잘 가요"] as const;
const BUBBLE_MS = 3000;
const GREET_COOLDOWN_MS = 3000;
const SCALE = 16; // 1 유닛 = 16px
const MAP_W = (HEADQUARTERS_MAX_X - HEADQUARTERS_MIN_X) * SCALE;
const MAP_H = (HEADQUARTERS_MAX_Z - HEADQUARTERS_MIN_Z) * SCALE;
// 개발 페이지 전용 — 빌드 값(VITE_LOBBY_URL)이 비어 있으면 로컬 로비(npm run dev)로 붙는다
const DEV_LOBBY_URL = LOBBY_URL || "http://localhost:2567";

const REASON_TEXT: Record<string, string> = {
  LOGIN_REQUIRED: "로그인 안 됨(401)",
  NOT_ALLOWED: "명단에 없음 또는 다른 출처(403)",
  RATE_LIMITED: "발급 한도(429)",
  UNAVAILABLE: "로비 중단·발급 불가(503·접속 실패)",
  TIMEOUT: "시간 초과(3초)",
  DISCONNECTED: "연결 끊김(비정상)",
  LOBBY_STOPPED: "로비 운영 중단(재시도 안 함)",
  LOBBY_FULL: "방 상한(LOBBY_FULL)",
  REJECTED: "로비 인증 거절",
  RETRYABLE_REJECT: "티켓 재사용·만료(새 티켓으로 재시도)",
};

/** 카탈로그 기본 착장으로 만든 시험용 외형 */
function devLook(gender: "masculine" | "feminine"): LobbyLook {
  const pick = (slot: "hair" | "top" | "bottom" | "shoes") =>
    DEFAULT_CATALOG.newDefaults?.[gender]?.[slot] ??
    DEFAULT_CATALOG.items.find((item) => item.slot === slot && item.genders.includes(gender))?.id ??
    "";
  return {
    catalog: DEFAULT_CATALOG.version,
    gender,
    hair: pick("hair"),
    top: pick("top"),
    bottom: pick("bottom"),
    shoes: pick("shoes"),
    colors: { skin: "#f0d8c8", hair: "#2e2a30", cloth: "#ffffff", bottom: "#ffffff", shoes: "#ffffff" },
    body: {
      heightScale: 1,
      headScale: 0.85,
      handScale: 0.9,
      footScale: 1,
      shoulderWidth: 1.1,
      hipWidth: 1,
      armLength: 0.9,
      legLength: 1,
      armThickness: 0.85,
      legThickness: 0.9,
      build: 0,
      buff: 0,
    },
  };
}

function statusText(status: LobbyStatus, players: number): string {
  switch (status.kind) {
    case "idle":
      return "본부실 밖";
    case "connecting":
      return `연결 중… (시도 ${status.attempt})`;
    case "connected":
      return `연결됨 · 같은 방 ${players}명`;
    case "solo": {
      const seconds = status.nextRetryAt ? Math.max(0, Math.ceil((status.nextRetryAt - Date.now()) / 1000)) : null;
      const retry = seconds === null ? "" : ` · ${seconds}초 뒤 재시도`;
      return `${REASON_TEXT[status.reason] ?? status.reason}${retry}`;
    }
  }
}

// 개발 페이지는 한 화면에 하나뿐이다 — 매 프레임 바뀌는 값은 React 상태가 아니라 이 객체에 둔다
const gender: "masculine" | "feminine" =
  new URLSearchParams(location.search).get("gender") === "masculine" ? "masculine" : "feminine";
const local = {
  pose: { x: -2, y: 0, z: 0, ry: 0, gait: "idle" } as LobbyPose,
  keys: new Set<string>(),
  bubbles: new Map<string, { text: string; until: number }>(),
  lastGreetAt: -Infinity,
};
const connection = createLobbyConnection({
  lobbyUrl: DEV_LOBBY_URL,
  apiUrl,
  getJoinOptions: () => ({ look: devLook(gender), pose: { ...local.pose } }),
});

// 자동 확인(Playwright)이 상태를 읽을 창구 — 이 개발 페이지에만 있다
exposeDevHook("lobbyNet", {
  status: () => connection.status(),
  players: () =>
    [...connection.players().entries()].map(([sid, p]) => ({
      sid,
      nickname: p.nickname,
      x: p.x,
      z: p.z,
      placed: p.placed,
    })),
  bubbles: () => [...local.bubbles.entries()].map(([sid, b]) => ({ sid, text: b.text })),
});

function greet(id: number) {
  const now = Date.now();
  if (now - local.lastGreetAt < GREET_COOLDOWN_MS) return;
  if (connection.sendGreet(id)) local.lastGreetAt = now;
}

async function fetchMe(): Promise<string> {
  try {
    const response = await fetch(apiUrl("/api/v1/me"), { credentials: "include" });
    if (!response.ok) return `로그인 안 됨(${response.status})`;
    const body = (await response.json()) as { nickname: string };
    return `로그인: ${body.nickname}`;
  } catch {
    return "API 접속 실패";
  }
}

export default function LobbyNetTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<LobbyStatus>(() => connection.status());
  const [me, setMe] = useState("확인 중");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    void fetchMe().then(setMe);
    const unsubscribe = connection.subscribe(setStatus);
    const offGreet = connection.onGreet((event: GreetEvent) => {
      local.bubbles.set(event.sid, { text: GREETINGS[event.id - 1] ?? "?", until: Date.now() + BUBBLE_MS });
    });
    // 페이지 이탈 때 퇴장(닫혀서 못 보내면 서버가 연결 종료로 정리한다)
    const onPageHide = () => connection.exit();
    addEventListener("pagehide", onPageHide);
    // 키: WASD·방향키 이동(Shift 달리기), 1~6 인사
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "INPUT") return;
      local.keys.add(event.code);
      const digit = /^Digit([1-6])$/.exec(event.code);
      if (digit) greet(Number(digit[1]));
    };
    const up = (event: KeyboardEvent) => local.keys.delete(event.code);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      unsubscribe();
      offGreet();
      removeEventListener("pagehide", onPageHide);
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      connection.exit();
    };
  }, []);

  // 이동·송신·그리기
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const toPx = (x: number, z: number) =>
      [(x - HEADQUARTERS_MIN_X) * SCALE, (z - HEADQUARTERS_MIN_Z) * SCALE] as const;
    const draw = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#23272f";
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      ctx.strokeStyle = "#596070";
      ctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1);
      const current = connection.status();
      const mySid = current.kind === "connected" ? current.sessionId : null;
      const now = Date.now();
      const drawBox = (x: number, z: number, color: string, label: string, sid: string | null) => {
        const [px, pz] = toPx(x, z);
        ctx.fillStyle = color;
        ctx.fillRect(px - 8, pz - 8, 16, 16);
        ctx.fillStyle = "#e8e8e8";
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(label, px, pz + 22);
        const bubble = sid ? local.bubbles.get(sid) : undefined;
        if (bubble && bubble.until > now) {
          const width = ctx.measureText(bubble.text).width + 12;
          ctx.fillStyle = "#fff6d5";
          ctx.fillRect(px - width / 2, pz - 34, width, 18);
          ctx.fillStyle = "#222";
          ctx.fillText(bubble.text, px, pz - 21);
        }
      };
      for (const [sid, player] of connection.players()) {
        if (sid === mySid || !player.placed) continue;
        drawBox(player.x, player.z, "#5aa9e6", player.nickname, sid);
      }
      drawBox(local.pose.x, local.pose.z, "#f2b134", "나", mySid);
    };
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = local.keys;
      const ix = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      const iz = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
      const running = k.has("ShiftLeft") || k.has("ShiftRight");
      const p = local.pose;
      if (ix || iz) {
        const length = Math.hypot(ix, iz);
        const speed = WALK_SPEED * (running ? RUN_SPEED_MULTIPLIER : 1);
        p.x = Math.min(HEADQUARTERS_MAX_X - 0.6, Math.max(HEADQUARTERS_MIN_X + 0.6, p.x + (ix / length) * speed * dt));
        p.z = Math.min(HEADQUARTERS_MAX_Z - 0.6, Math.max(HEADQUARTERS_MIN_Z + 0.6, p.z + (iz / length) * speed * dt));
        p.ry = Math.atan2(ix, iz);
        p.gait = running ? "run" : "walk";
      } else {
        p.gait = "idle";
      }
      connection.sendMove({ ...p });
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const ticker = setInterval(() => setTick((t) => t + 1), 500);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ticker);
    };
  }, []);

  const login = async () => {
    const response = await fetch(apiUrl("/api/v1/auth/login"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setPassword("");
    setMe(response.ok ? await fetchMe() : `로그인 실패(${response.status})`);
  };

  const players = connection.players().size;
  return (
    <div style={{ font: "14px system-ui, sans-serif", padding: 16, maxWidth: MAP_W + 32 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>로비 연결 시험 · 개발용</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span data-testid="me">{me}</span>
        <button type="button" onClick={() => connection.enter()} data-testid="enter">
          본부실 들어가기
        </button>
        <button type="button" onClick={() => connection.exit()} data-testid="exit">
          본부실 나가기
        </button>
        <span style={{ opacity: 0.7 }}>
          로비: {DEV_LOBBY_URL} · 외형 {gender}
        </span>
      </div>
      <div
        data-testid="status"
        data-kind={status.kind}
        style={{ position: "relative", padding: "6px 10px", background: "#1d2128", borderRadius: 6, marginBottom: 8 }}
      >
        {statusText(status, players)}
        {status.kind === "solo" && (
          <span data-testid="solo-badge" style={{ position: "absolute", right: 10, top: 6, fontSize: 12 }}>
            혼자 둘러보는 중
          </span>
        )}
      </div>
      <canvas ref={canvasRef} width={MAP_W} height={MAP_H} style={{ display: "block", borderRadius: 6 }} />
      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {GREETINGS.map((text, index) => (
          <button key={text} type="button" onClick={() => greet(index + 1)} data-testid={`greet-${index + 1}`}>
            {index + 1}. {text}
          </button>
        ))}
      </div>
      <p style={{ opacity: 0.7 }}>WASD·방향키 이동(Shift 달리기), 숫자 1~6 인사(3초 쿨다운).</p>
      <details style={{ marginTop: 8 }}>
        <summary>개발용 로그인(로컬 시험 계정)</summary>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <input
            placeholder="비밀번호"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
          <button type="button" onClick={() => void login()}>
            로그인
          </button>
        </div>
      </details>
    </div>
  );
}
