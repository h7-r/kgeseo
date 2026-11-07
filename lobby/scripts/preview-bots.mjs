// 가상 인원(개발 전용) — 실제 입장권 경로로 방에 들어와 본부실을 걸어 다니고 가끔 인사한다.
// 사람이 미리보기 화면(vite.lobby-preview.config.ts)에서 「방에 10명이 있을 때」를 눈으로 보려고 쓴다.
//
//   cd lobby
//   node scripts/preview-bots.mjs --setup     # 처음 한 번: 시험 계정 만들기 · 조사관명 · 로비 명단에 추가
//   node scripts/preview-bots.mjs             # 9명 입장(Ctrl+C 로 모두 퇴장). --count=4 처럼 수를 바꾼다
//   node scripts/preview-bots.mjs --cleanup   # 로비 명단에서 가상 인원 줄을 뺀다(계정은 시험 DB 에 남는다)
//
// - **로컬 주소(localhost·127.0.0.1·::1)가 아니면 멈춘다** — 운영 API·로비에 가입·입장 요청을 보내지 않게.
//   명단 파일도 이 저장소의 backend/data 아래만 쓴다. 명단에는 시험 계정 표시(loadtest:)로, 따로 묶어 넣는다.
// - **개발 백엔드(별도 시험 DB, WAEGOK_RUN_PROFILE=test)에서만** 쓴다. 계정은 lobby-bot-N@example.test,
//   비밀번호는 --setup 이 무작위로 만들어 lobby/.env.preview-bots(Git 무시)에 적고, 출력하지 않는다.
// - 입장권은 FastAPI 가 준다 — 머리 위 이름은 각 계정의 조사관명(캐릭터 이름).
// - 가구를 뚫지 않는다: src/generated/hq-obstacles.json(dump-hq-obstacles.mjs 가 게임에서 뽑은 충돌 박스 + 박스 없는 물체)을
//   사람 반지름만큼 부풀린 격자에서 길을 찾고, 직선으로 펴도 막힌 데를 지나지 않을 때만 편다.
// - 사람끼리도 뚫지 않는다: 다른 가상 인원·실제 사람 자리에서 1.3 유닛 안으로 파고드는 걸음은 하지 않고,
//   1초 넘게 막히면 그 사람들을 피해 길을 다시 찾는다. 실제 사람에게는 1.8 유닛(자리를 늦게 알아서 넉넉히). 목표도 사람이 서 있는 곳 근처는 고르지 않는다.
// - 서버 규칙 안에서 움직인다: 걷기 속도(3 유닛/초), 이동 메시지 초당 8번(상한 10), 인사 쿨다운 3초.
import { randomInt } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@colyseus/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const API = process.env.API_URL ?? "http://localhost:8000";
const LOBBY = process.env.LOBBY_URL ?? "http://localhost:2567";
const ORIGIN = process.env.GAME_ORIGIN ?? "http://localhost:5173";
const BETA_LIST = resolve(repo, process.env.LOBBY_BETA_LIST ?? "backend/data/lobby_beta_users.txt");
// 개발 전용 차단 — 주소를 바꿔도 로컬 서버가 아니면 아무 요청도 보내지 않는다
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
for (const [label, url] of [
  ["API_URL", API],
  ["LOBBY_URL", LOBBY],
  ["GAME_ORIGIN", ORIGIN],
]) {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    console.error(`${label}=${url} — 가상 인원은 로컬 개발 서버에서만 돈다. 멈춘다.`);
    process.exit(2);
  }
}
if (!BETA_LIST.startsWith(resolve(repo, "backend/data") + sep)) {
  console.error(`명단 파일 ${BETA_LIST} — 이 저장소의 backend/data 아래만 쓴다. 멈춘다.`);
  process.exit(2);
}
const args = new Map(
  process.argv.slice(2).map((arg) => [arg.replace(/=.*$/, ""), arg.includes("=") ? arg.replace(/^[^=]*=/, "") : "1"]),
);
const COUNT = Math.max(1, Math.min(9, Number(args.get("--count") ?? 9)));

// 조사관명(캐릭터 이름) — 머리 위에 뜬다
const NAMES = ["한서진", "유태오", "강도윤", "문채원", "백승호", "서하린", "오지후", "임나래", "정우진"];
const BOTS = NAMES.map((name, i) => ({
  index: i + 1,
  name,
  email: `lobby-bot-${i + 1}@example.test`,
  nickname: `로비봇${i + 1}`,
  cookie: "",
}));

// 가상 인원 계정 비밀번호 — Git 이 무시하는 lobby/.env.preview-bots 에 둔다(--setup 이 처음에 무작위로 만든다). 출력하지 않는다.
const SECRET_FILE = resolve(here, "../.env.preview-bots");
function readPassword() {
  if (process.env.LOBBY_BOT_PASSWORD) return process.env.LOBBY_BOT_PASSWORD;
  if (!existsSync(SECRET_FILE)) return null;
  return /^LOBBY_BOT_PASSWORD=(.+)$/m.exec(readFileSync(SECRET_FILE, "utf8"))?.[1]?.trim() ?? null;
}
function createPassword() {
  // 가입 규칙: 8자 이상 · 대문자·소문자·숫자 · 같은 글자 세 번 연속 없음
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let body = "";
  while (body.length < 20) {
    const next = chars[randomInt(chars.length)];
    if (!body.endsWith(next + next)) body += next;
  }
  const password = `Pb${body}7k`;
  writeFileSync(
    SECRET_FILE,
    `# 가상 인원(preview-bots) 계정 비밀번호 — 개발 시험 DB 전용, Git 무시\nLOBBY_BOT_PASSWORD=${password}\n`,
    {
      mode: 0o600,
    },
  );
  return password;
}
let PASSWORD = readPassword();

const log = (bot, text) => console.log(`[${bot ? `${bot.index} ${bot.name}` : "봇"}] ${text}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);

// ---------- FastAPI(쿠키 세션) ----------
async function api(bot, method, path, body) {
  const headers = { Origin: ORIGIN, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bot.cookie) headers.Cookie = bot.cookie;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const jar = new Map(bot.cookie ? bot.cookie.split("; ").map((pair) => pair.split(/=(.*)/s).slice(0, 2)) : []);
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const [key, value = ""] = pair.split(/=(.*)/s);
    if (key) jar.set(key.trim(), value);
  }
  bot.cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  return response;
}

async function login(bot) {
  bot.cookie = "";
  const response = await api(bot, "POST", "/api/v1/auth/login", { email: bot.email, password: PASSWORD });
  if (!response.ok) throw new Error(`로그인 실패(${response.status})`);
}

// 명단 파일: 가상 인원 줄은 아래 두 주석 사이에 시험 계정 표시(loadtest:)로만 둔다
const BLOCK_START = "# preview-bots 시작 — 가상 인원(개발 전용). 정리: node scripts/preview-bots.mjs --cleanup";
const BLOCK_END = "# preview-bots 끝";
function rewriteList(botIds) {
  const lines = existsSync(BETA_LIST) ? readFileSync(BETA_LIST, "utf8").split(/\r?\n/) : [];
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    const text = line.trim();
    if (text === BLOCK_START) inBlock = true;
    else if (text === BLOCK_END) inBlock = false;
    // 블록 안 줄과, 예전 방식으로 블록 밖에 넣은 가상 인원 ID 는 뺀다
    else if (!inBlock && !botIds.has(text.replace(/^loadtest:/, ""))) kept.push(line);
  }
  while (kept.length && kept.at(-1).trim() === "") kept.pop();
  const ids = [...botIds];
  const block = ids.length ? ["", BLOCK_START, ...ids.map((id) => `loadtest:${id}`), BLOCK_END] : [];
  // 운영자 방식: 같은 폴더 임시 파일에 쓰고 한 번에 바꿔 끼운다(로비가 반쯤 쓴 파일을 읽지 않게)
  const temp = `${BETA_LIST}.tmp`;
  writeFileSync(temp, `${[...kept, ...block].join("\n")}\n`);
  renameSync(temp, BETA_LIST);
}

async function setup() {
  if (!PASSWORD) {
    PASSWORD = createPassword();
    log(null, `계정 비밀번호를 새로 만들어 ${SECRET_FILE} 에 적었다(Git 무시)`);
  }
  const botIds = new Set();
  for (const bot of BOTS) {
    const register = await api(bot, "POST", "/api/v1/auth/register", {
      email: bot.email,
      password: PASSWORD,
      nickname: bot.nickname,
      consent: { terms: true, privacy: true, age: true },
    });
    if (!register.ok && register.status !== 409) {
      // 오류 본문에는 비밀번호가 없다(필드 이름·사유만)
      const detail = await register.text();
      throw new Error(`${bot.email} 가입 실패(${register.status}) ${detail.slice(0, 300)}`);
    }
    await login(bot);
    // 조사관명만 있으면 된다 — 가상 인원의 외형은 입장 때 이 스크립트가 고른다
    const character = await api(bot, "PUT", "/api/v1/me/character", {
      display_name: bot.name,
      appearance: { previewBot: true },
    });
    if (!character.ok) throw new Error(`${bot.email} 조사관명 저장 실패(${character.status})`);
    const me = await api(bot, "GET", "/api/v1/me");
    const { user_id: id } = await me.json();
    if (typeof id !== "string" || !id) throw new Error(`${bot.email} 계정 ID 를 읽지 못했다`);
    botIds.add(id);
    log(bot, `${register.status === 409 ? "있던 계정" : "새 계정"} · 조사관명 저장`);
  }
  rewriteList(botIds);
  log(null, `로비 명단에 시험 계정 ${botIds.size}개(loadtest:)를 묶어 넣었다: ${BETA_LIST}`);
}

function cleanup() {
  // 블록만 지운다 — 계정 ID 를 몰라도 되게(백엔드가 꺼져 있어도)
  rewriteList(new Set());
  log(null, `로비 명단에서 가상 인원 줄을 뺐다: ${BETA_LIST} (계정은 시험 DB 에 남아 있다)`);
}

// ---------- 외형(로비 허용 목록 안에서 고른다) ----------
const ALLOW = JSON.parse(readFileSync(resolve(here, "../src/generated/lookAllowlist.json"), "utf8"));
const PALETTE = {
  skin: ["#f0d8c8", "#e0b79c", "#c9926f", "#a06b4a", "#ffffff"],
  hair: ["#2e2a30", "#4a3628", "#6b4a33", "#9a6b44", "#b0805a", "#9aa3ad", "#8d4a52", "#5c6f8f"],
  cloth: ["#ffffff", "#e9e4d8", "#cfd8e6", "#8fa6c4", "#5b7aa6", "#6f8f7a", "#c2a46b", "#9c5b5b", "#5a5f6b", "#2d3036"],
  bottom: ["#ffffff", "#c9ccd2", "#8fa6c4", "#7d8c6f", "#a08070", "#5a5f6b"],
  shoes: ["#ffffff", "#e9e4d8", "#cfd8e6", "#c2a46b", "#9c5b5b", "#5a5f6b", "#2d3036"],
};

function randomLook() {
  const gender = Math.random() < 0.5 ? "masculine" : "feminine";
  const items = (slot, avoid) => ALLOW.items[slot][gender].filter((id) => !avoid.test(id));
  const body = {};
  for (const { key, min, max } of ALLOW.bodyFields) {
    // 가운데 근처에서만 — 극단 체형은 피한다
    const mid = (min + max) / 2;
    body[key] =
      Math.round(Math.min(max, Math.max(min, mid + (Math.random() - 0.5) * 0.35 * (max - min))) * 1000) / 1000;
  }
  return {
    catalog: ALLOW.catalogVersion,
    gender,
    // 긴 머리는 없애기로 했다(2026-11-06) — 남은 머리 중에서. 민머리는 뺀다
    hair: pick(items("hair", /\.long$|\.none$/)),
    top: pick(items("top", /\.none$/)),
    bottom: pick(items("bottom", /\.none$/)),
    shoes: pick(items("shoes", /\.none$/)),
    colors: Object.fromEntries(ALLOW.colorKeys.map((key) => [key, pick(PALETTE[key])])),
    body,
  };
}

// ---------- 길찾기(가구를 뚫지 않는다) ----------
const MAP = JSON.parse(readFileSync(resolve(here, "../src/generated/hq-obstacles.json"), "utf8"));
const RADIUS = 0.6 + 0.15; // 사람 반지름(PLAYER_RADIUS) + 여유
const WALL = MAP.wallMolding + RADIUS;
const CELL = 0.25;
const { hq } = MAP;
const NX = Math.round((hq.maxX - hq.minX) / CELL);
const NZ = Math.round((hq.maxZ - hq.minZ) / CELL);

function isFree(x, z) {
  if (x < hq.minX + WALL || x > hq.maxX - WALL || z < hq.minZ + WALL || z > hq.maxZ - WALL) return false;
  for (const o of MAP.obstacles) {
    if (x > o.minX - RADIUS && x < o.maxX + RADIUS && z > o.minZ - RADIUS && z < o.maxZ + RADIUS) return false;
  }
  return true;
}
const cellX = (i) => hq.minX + (i + 0.5) * CELL;
const cellZ = (j) => hq.minZ + (j + 0.5) * CELL;
const toCell = (x, z) => [
  Math.max(0, Math.min(NX - 1, Math.floor((x - hq.minX) / CELL))),
  Math.max(0, Math.min(NZ - 1, Math.floor((z - hq.minZ) / CELL))),
];
const open = new Uint8Array(NX * NZ);
for (let i = 0; i < NX; i += 1) for (let j = 0; j < NZ; j += 1) open[i * NZ + j] = isFree(cellX(i), cellZ(j)) ? 1 : 0;
const freeCells = [];
for (let k = 0; k < open.length; k += 1) if (open[k]) freeCells.push(k);

/** 가장 큰 연결 영역만 쓴다(구석에 갇힌 빈칸에서 시작하지 않게) */
const reachable = (() => {
  const seen = new Int32Array(open.length).fill(-1);
  let best = { id: -1, size: 0 };
  let id = 0;
  for (const start of freeCells) {
    if (seen[start] >= 0) continue;
    const stack = [start];
    seen[start] = id;
    let size = 0;
    while (stack.length) {
      const k = stack.pop();
      size += 1;
      const i = Math.floor(k / NZ);
      const j = k % NZ;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const nk = ni * NZ + nj;
        if (open[nk] && seen[nk] < 0) {
          seen[nk] = id;
          stack.push(nk);
        }
      }
    }
    if (size > best.size) best = { id, size };
    id += 1;
  }
  return freeCells.filter((k) => seen[k] === best.id);
})();

// ---------- 사람끼리 뚫지 않기 ----------
/**
 * 다른 사람과 중심 사이 최소 거리(유닛). 화면에서 다른 사람 몸통 상자(반폭 0.6)에 내 반지름(0.6)을 더한 만큼이
 * 사람이 다가갈 수 있는 거리라, 가상 인원도 그보다 조금 넉넉히 둔다.
 */
const PERSON_GAP = 1.3;
/** 실제 사람에게는 더 넉넉히 — 사람 자리는 방 상태로 0.1~0.2초 늦게 알아, 마주 걸어오면 그만큼 파고든다 */
const HUMAN_GAP = 1.8;
/** 다른 사람과의 여유(거리 − 그 사람에게 둘 간격) 중 가장 작은 값. 음수면 너무 가깝다. others: [x, z, gap] */
const clearance = (x, z, others) =>
  others.reduce((best, [ox, oz, gap]) => Math.min(best, Math.hypot(x - ox, z - oz) - gap), Infinity);
const nearPerson = (x, z, others, extra = 0) => clearance(x, z, others) < extra;

function lineIsFree(ax, az, bx, bz, avoid = []) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (!isFree(x, z) || nearPerson(x, z, avoid, 0.2)) return false;
  }
  return true;
}

/** A*(8방향, 모서리 가로지르기 없음) → 보이는 데까지 직선으로 편다. avoid: 이번에 피해 갈 사람 자리 */
function findPath(fromX, fromZ, toK, avoid = []) {
  const [si, sj] = toCell(fromX, fromZ);
  const start = si * NZ + sj;
  const goal = toK;
  const gi = Math.floor(goal / NZ);
  const gj = goal % NZ;
  const h = (k) => {
    const dx = Math.abs(Math.floor(k / NZ) - gi);
    const dz = Math.abs((k % NZ) - gj);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  const g = new Float64Array(open.length).fill(Infinity);
  const came = new Int32Array(open.length).fill(-1);
  const closed = new Uint8Array(open.length);
  const heap = [[h(start), start]];
  g[start] = 0;
  while (heap.length) {
    // 작은 격자라 단순 최솟값 찾기로 충분하다
    let best = 0;
    for (let n = 1; n < heap.length; n += 1) if (heap[n][0] < heap[best][0]) best = n;
    const [, k] = heap.splice(best, 1)[0];
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = Math.floor(k / NZ);
    const j = k % NZ;
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const nk = ni * NZ + nj;
        if (!open[nk] || closed[nk]) continue;
        if (di && dj && (!open[i * NZ + nj] || !open[ni * NZ + j])) continue;
        if (avoid.length && nearPerson(cellX(ni), cellZ(nj), avoid, 0.2)) continue;
        const cost = g[k] + (di && dj ? 1.414 : 1);
        if (cost < g[nk]) {
          g[nk] = cost;
          came[nk] = k;
          heap.push([cost + h(nk), nk]);
        }
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const cells = [];
  for (let k = goal; k >= 0 && k !== start; k = came[k]) cells.unshift(k);
  const points = cells.map((k) => [cellX(Math.floor(k / NZ)), cellZ(k % NZ)]);
  const smooth = [];
  let [cx, cz] = [fromX, fromZ];
  let n = 0;
  while (n < points.length) {
    let far = n;
    for (let m = points.length - 1; m > n; m -= 1) {
      if (lineIsFree(cx, cz, points[m][0], points[m][1], avoid)) {
        far = m;
        break;
      }
    }
    smooth.push(points[far]);
    [cx, cz] = points[far];
    n = far + 1;
  }
  return smooth;
}

// ---------- 한 명 ----------
const WALK_SPEED = 3.0;
const TICK_MS = 125;
const GREET_COUNT = 6;
/** 화면 확인용 채팅 — 가끔(25~60초) 정해진 착한 말 하나. 서버가 금칙어·빈도·반복을 다시 본다 */
const CHAT_LINES = [
  "안녕하세요!",
  "오늘 사건 같이 풀어요",
  "자물쇠 번호 찾으신 분?",
  "출동 언제 해요?",
  "여기 처음 와 봤어요",
  "ㅋㅋ 반가워요",
  "작업등 어디 있어요?",
  "기차 타러 갈게요",
  "조사관님들 화이팅!",
  "잠깐 자리 비울게요",
  "이 그림 수상한데요",
  "엇 방금 뭐 지나갔어요?",
];
const bots = [];

/** 이 가상 인원 말고 방에 있는 모두의 자리 — 다른 가상 인원은 이 스크립트의 최신 값, 사람은 방 상태 */
function othersOf(self) {
  const list = [];
  const botSids = new Set();
  for (const other of bots) {
    if (other === self || !other.room) continue;
    list.push([other.x, other.z, PERSON_GAP]);
    botSids.add(other.room.sessionId);
  }
  // 사람 자리는 방 상태에서 — 아직 안 들어온 가상 인원은 먼저 들어온 다른 가상 인원의 방 상태를 본다
  const room = self.room ?? bots.find((other) => other.room)?.room;
  const mine = self.room?.sessionId;
  room?.state?.players?.forEach((player, sid) => {
    if (sid !== mine && !botSids.has(sid)) list.push([player.x, player.z, HUMAN_GAP]);
  });
  return list;
}

function chooseTarget(self, others) {
  for (let tries = 0; tries < 50; tries += 1) {
    const k = pick(reachable);
    const x = cellX(Math.floor(k / NZ));
    const z = cellZ(k % NZ);
    const far = Math.hypot(x - self.x, z - self.z) > 3;
    const alone =
      bots.every((other) => other === self || Math.hypot(x - other.goalX, z - other.goalZ) > 2.5) &&
      !nearPerson(x, z, others, 1);
    if (far && alone) return { k, x, z };
  }
  return null;
}

/** 입장 실패 — 다시 할지(몇 ms 뒤), 이 사람은 그만둘지 */
class EnterError extends Error {
  constructor(message, { retryMs = 10000, fatal = false } = {}) {
    super(message);
    this.retryMs = retryMs;
    this.fatal = fatal;
  }
}
const MAX_FAILURES = 6;

async function enter(bot) {
  try {
    await login(bot);
  } catch (error) {
    throw new EnterError(error.message, { fatal: true });
  }
  const ticketResponse = await api(bot, "POST", "/api/v1/lobby/ticket");
  if (!ticketResponse.ok) {
    const status = ticketResponse.status;
    if (status === 403) throw new EnterError("로비 명단에 없음(403) — --setup 먼저", { fatal: true });
    if (status === 429) {
      const seconds = Number(ticketResponse.headers.get("retry-after")) || 60;
      throw new EnterError(`발급 한도(429)`, { retryMs: (seconds + 1) * 1000 });
    }
    throw new EnterError(`입장권 실패(${status})`, { retryMs: status === 503 ? 30000 : 10000 });
  }
  const { ticket } = await ticketResponse.json();
  const others = othersOf(bot);
  const start = (() => {
    for (;;) {
      const k = pick(reachable);
      const x = cellX(Math.floor(k / NZ));
      const z = cellZ(k % NZ);
      if (!nearPerson(x, z, others, 0.7)) return { x, z };
    }
  })();
  // 지난 방에서 받은 밀림은 버린다(다시 들어오면 새 자리 — Codex 리뷰 c43ccb2)
  Object.assign(bot, {
    x: start.x,
    z: start.z,
    ry: between(-Math.PI, Math.PI),
    goalX: start.x,
    goalZ: start.z,
    pendingPushes: [],
    push: null,
  });
  const client = new Client(LOBBY, { headers: { Origin: ORIGIN, Authorization: `Bearer ${ticket}` } });
  let room;
  try {
    room = await client.joinOrCreate("lobby", {
      look: randomLook(),
      pose: { x: bot.x, y: 0, z: bot.z, ry: bot.ry, gait: "idle" },
    });
  } catch (error) {
    // 인증 거절(출처·형식)은 다시 해도 같다. 방 상한은 길게 기다린다
    const text = String(error?.message ?? error);
    if (/ORIGIN|INVALID|AUTH_MISSING/.test(text)) throw new EnterError(`로비 인증 거절: ${text}`, { fatal: true });
    throw new EnterError(`매칭 실패: ${text}`, { retryMs: /LOBBY_FULL/.test(text) ? 30000 : 10000 });
  }
  room.reconnection.enabled = false;
  // 다른 사람 인사·서버 되맞춤은 가상 인원이 쓸 일이 없다 — 받기만 한다(안 받으면 SDK 가 경고를 찍는다)
  room.onMessage("punch", (event) => onBotPunch(bot, room, event));
  room.onMessage("*", () => {});
  bot.room = room;
  bot.path = [];
  bot.idleUntil = Date.now() + between(500, 4000);
  bot.nextGreetAt = Date.now() + between(6000, 30000);
  bot.nextChatAt = Date.now() + between(8000, 40000);
  room.onLeave((code) => {
    if (bot.room !== room) return;
    bot.room = null;
    bot.pendingPushes = [];
    bot.push = null;
    if (stopping) return;
    log(bot, `방에서 나감(${code}) — 5초 뒤 다시 들어간다`);
    setTimeout(() => void enterWithRetry(bot), 5000);
  });
  bot.failures = 0;
  log(bot, `입장(${room.roomId}) · 자리 ${bot.x.toFixed(1)}, ${bot.z.toFixed(1)}`);
}

async function enterWithRetry(bot) {
  try {
    await enter(bot);
  } catch (error) {
    bot.failures = (bot.failures ?? 0) + 1;
    const retryMs = error instanceof EnterError ? error.retryMs : 10000;
    if (error?.fatal || bot.failures >= MAX_FAILURES) {
      log(bot, `입장 실패: ${error.message} — 이 사람은 멈춘다`);
      return;
    }
    log(bot, `입장 실패: ${error.message} — ${Math.round(retryMs / 1000)}초 뒤 다시(${bot.failures}/${MAX_FAILURES})`);
    if (!stopping) setTimeout(() => void enterWithRetry(bot), retryMs);
  }
}

// 맞으면 뒤로 밀린다(미르 11/7, 검토 19회차) — 게임 화면과 같은 값: src/dev/lobbyPreview/previewState.ts HIT_PUSH_DISTANCE ·
// src/engine/movement/push.ts. 주먹이 닿는 0.2초 뒤에 밀리기 시작해 지수 감쇠로 1.2 유닛(약 36cm). 걷던 길은 버리고 잠깐 선다.
const PUSH_DISTANCE = 1.2;
const PUSH_DECAY = 7;
const PUSH_SPEED_LIMIT = WALK_SPEED * 2.58 * 1.2;
const PUSH_IMPACT_MS = 200;
/** 막힘 검사 간격(유닛) — 한 틱(0.125초)에 최대 1유닛쯤 가므로 잘게 나눠 본다 */
const PUSH_CHECK = 0.05;

function onBotPunch(bot, room, event) {
  if (bot.room !== room || !event || event.hit !== room.sessionId || event.sid === room.sessionId) return;
  const attacker = room.state?.players?.get(event.sid);
  if (!attacker) return;
  // 방향은 받은 순간의 자리로 — 붙어 있으면 때린 사람 몸 방향(앞 = (sin ry, cos ry))
  let dx = bot.x - attacker.x;
  let dz = bot.z - attacker.z;
  if (Math.hypot(dx, dz) < 0.3) {
    dx = Math.sin(attacker.ry);
    dz = Math.cos(attacker.ry);
  }
  const length = Math.hypot(dx, dz) || 1;
  (bot.pendingPushes ??= []).push({ at: Date.now() + PUSH_IMPACT_MS, x: dx / length, z: dz / length });
}

/** 밀림을 이번 틱만큼 적용한다. 밀리는 중이면 true */
function applyPush(bot, now, dt) {
  const due = bot.pendingPushes?.filter((push) => push.at <= now) ?? [];
  if (due.length) {
    bot.pendingPushes = bot.pendingPushes.filter((push) => push.at > now);
    bot.push ??= { x: 0, z: 0 };
    for (const push of due) {
      bot.push.x += push.x * PUSH_DISTANCE * PUSH_DECAY;
      bot.push.z += push.z * PUSH_DISTANCE * PUSH_DECAY;
    }
    const speed = Math.hypot(bot.push.x, bot.push.z);
    if (speed > PUSH_SPEED_LIMIT) {
      bot.push.x *= PUSH_SPEED_LIMIT / speed;
      bot.push.z *= PUSH_SPEED_LIMIT / speed;
    }
    bot.path = [];
    bot.blockedSince = undefined;
    bot.idleUntil = Math.max(bot.idleUntil, now + between(800, 1500));
  }
  if (!bot.push) return false;
  // 한 틱의 밀림을 정확히 적분(게임과 같은 거리) → 잘게 나눠 축마다 막힘 검사, 막힌 축은 멈춘다
  const decay = Math.exp(-PUSH_DECAY * dt);
  const share = (1 - decay) / PUSH_DECAY;
  const moveX = bot.push.x * share;
  const moveZ = bot.push.z * share;
  bot.push.x *= decay;
  bot.push.z *= decay;
  // 사람도 막는다 — 걸을 때와 같은 기준(이미 겹쳐 있으면 멀어지는 쪽만, Codex 리뷰 c43ccb2)
  const others = othersOf(bot);
  const canGo = (x, z) => isFree(x, z) && (clearance(x, z, others) >= 0 || clearance(x, z, others) >= clearance(bot.x, bot.z, others));
  const pieces = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) / PUSH_CHECK));
  for (let i = 0; i < pieces; i += 1) {
    if (bot.push.x !== 0) {
      if (canGo(bot.x + moveX / pieces, bot.z)) bot.x += moveX / pieces;
      else bot.push.x = 0;
    }
    if (bot.push.z !== 0) {
      if (canGo(bot.x, bot.z + moveZ / pieces)) bot.z += moveZ / pieces;
      else bot.push.z = 0;
    }
  }
  if (Math.hypot(bot.push.x, bot.push.z) < 0.05) bot.push = null;
  return true;
}

function step(bot, dt) {
  const room = bot.room;
  if (!room) return;
  const now = Date.now();
  applyPush(bot, now, dt);
  const others = othersOf(bot);
  if (!bot.path.length && now >= bot.idleUntil) {
    const target = chooseTarget(bot, others);
    const path = target && findPath(bot.x, bot.z, target.k, others);
    if (path?.length) {
      bot.path = path;
      bot.goalX = target.x;
      bot.goalZ = target.z;
      bot.speed = WALK_SPEED * between(0.75, 1);
    } else {
      bot.idleUntil = now + 1000;
    }
  }
  let gait = "idle";
  if (bot.path.length) {
    let budget = bot.speed * dt;
    let blocked = false;
    while (budget > 0 && bot.path.length) {
      const [tx, tz] = bot.path[0];
      const dx = tx - bot.x;
      const dz = tz - bot.z;
      const distance = Math.hypot(dx, dz);
      const move = Math.min(distance, budget);
      const nx = distance > 1e-6 ? bot.x + (dx / distance) * move : tx;
      const nz = distance > 1e-6 ? bot.z + (dz / distance) * move : tz;
      // 사람 사이로 파고드는 걸음은 하지 않는다(이미 가까우면 멀어지는 걸음만)
      const next = clearance(nx, nz, others);
      if (next < 0 && next < clearance(bot.x, bot.z, others)) {
        blocked = true;
        break;
      }
      bot.x = nx;
      bot.z = nz;
      budget -= move;
      if (move >= distance) bot.path.shift();
      // 몸 방향 규약: 앞 = (sin f, cos f)
      if (distance > 1e-3) bot.ry = Math.atan2(dx, dz);
    }
    if (blocked) {
      bot.blockedSince ??= now;
      if (now - bot.blockedSince > 1000) {
        // 막은 사람들을 피해 같은 목표로 다시 — 길이 없으면 잠깐 서 있다가 다른 곳으로
        const goal = toCell(bot.goalX, bot.goalZ);
        const path = findPath(bot.x, bot.z, goal[0] * NZ + goal[1], others);
        bot.path = path?.length ? path : [];
        if (!bot.path.length) bot.idleUntil = now + between(1000, 3000);
        bot.blockedSince = undefined;
      }
    } else {
      bot.blockedSince = undefined;
    }
    gait = bot.path.length && !blocked ? "walk" : "idle";
    if (!bot.path.length) bot.idleUntil = Math.max(bot.idleUntil, now + between(1500, 7000));
    room.send("move", { x: bot.x, y: 0, z: bot.z, ry: bot.ry, gait });
  } else {
    // 서 있어도 실제 사람처럼 계속 보낸다(0.125초마다) — 안 보내면 서버가 「낡은 자리」로 보고 때리기 판정에서 뺐다
    room.send("move", { x: bot.x, y: 0, z: bot.z, ry: bot.ry, gait: "idle" });
  }
  bot.lastGait = gait;
  if (now >= bot.nextGreetAt) {
    room.send("greet", { id: 1 + Math.floor(Math.random() * GREET_COUNT) });
    bot.nextGreetAt = now + between(15000, 45000);
  }
  if (now >= (bot.nextChatAt ?? Infinity)) {
    room.send("chat", { text: pick(CHAT_LINES) });
    bot.nextChatAt = now + between(25000, 60000);
  }
}

let stopping = false;
async function run() {
  if (!PASSWORD) throw new Error("가상 인원 비밀번호가 없다 — node scripts/preview-bots.mjs --setup 먼저");
  if (!existsSync(resolve(here, "../src/generated/hq-obstacles.json")))
    throw new Error("src/generated/hq-obstacles.json 이 없다 — dump-hq-obstacles.mjs 먼저");
  log(null, `빈칸 ${reachable.length}개 · 장애물 ${MAP.obstacles.length}개(${MAP.generatedAt}) · ${COUNT}명 입장`);
  for (const bot of BOTS.slice(0, COUNT)) {
    bots.push(bot);
    await enterWithRetry(bot);
    await sleep(400);
  }
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    for (const bot of bots) step(bot, dt);
  }, TICK_MS);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    log(null, "모두 퇴장");
    await Promise.allSettled(bots.map((bot) => bot.room?.leave(true)));
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (args.has("--setup")) await setup();
else if (args.has("--cleanup")) cleanup();
else await run();
