// NPC 실제 게임 연결 검사 — NajuScene 통합 패치(npc/naju-integration.patch)가 들어간 개발 서버에서만 돈다.
// 1·3인칭 같은 프레임 읽기 · 추적 · 정지 · 충돌 · 지형 · 순간 이동 · 행동 상태 · 게임 이벤트 · ?npc=z1 · ?npc 없음 · 계측(?npcprof)을 본다.
//
//   npx.cmd vite naju01                                    (통합 패치가 적용된 저장소에서)
//   node naju01/src/npc/checks/browser-follow.mjs [주소]    (기본 http://localhost:5174/)
//
// 통합 전(window.__game.npcFollow 가 없음)이면 그렇다고 알리고 종료 코드 2 로 끝낸다.
// 헤드리스라 FPS 절대값은 의미가 없다 — 상대 비교만 찍는다.
import { chromium } from "playwright";

const BASE = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "http://localhost:5174/";
const MAX_SPEED = 2.8;
const MIN_SEPARATION = 0.75;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "통과" : "실패"}  ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--hide-scrollbars"] });
  } catch {
    return chromium.launch({ headless: true, args: ["--mute-audio", "--hide-scrollbars"] });
  }
}
const browser = await launch();

// 통합 전이면 건너뛴다
{
  const page = await browser.newPage();
  await page.goto(BASE + "?npc", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__game?.naju, null, { timeout: 240000 });
  await page.waitForTimeout(3000);
  const integrated = await page.evaluate(() => !!window.__game?.npcFollow);
  await page.close();
  if (!integrated) {
    console.log(
      "NajuScene 통합 전이다 (window.__game.npcFollow 없음) — npc/INTEGRATION.md 의 패치를 적용한 서버에서 다시 돌린다.",
    );
    await browser.close();
    process.exit(2);
  }
}

async function open(query) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + query, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__game?.naju && !!window.__game?.propColliders, null, { timeout: 240000 });
  // 구운 모형·손 배치가 늦게 붙어 소품 목록이 바뀐다 — 개수가 6 초 동안 그대로일 때까지
  let last = -1;
  let since = Date.now();
  for (const end = Date.now() + 90000; Date.now() < end; await sleep(1000)) {
    const n = await page.evaluate(() => window.__game.propColliders.count);
    if (n !== last) {
      last = n;
      since = Date.now();
    } else if (Date.now() - since > 6000) break;
  }
  return { ctx, page, errors };
}

// 헤드리스 Chrome 은 키를 가끔 페이지에 주지 않는다(10/21 진단: 포인터 잠금 직후 첫 keydown 이 빠지고, 그 뒤에도 가끔 W·V 가
// 통째로 빠진다 — NPC 가 없는 판(?npc 없음 · 통합 전 서버)에서도 같은 비율). 빠지면 플레이어 이동 0 m · 3인칭 전환 안 됨으로 실패한다.
// 그래서 검사용 키는 페이지가 keydown 을 실제로 받았는지 확인하고, 못 받았을 때만 다시 누른다(재시도는 찍고 센다).
// 판정 기준(이동 거리 · 시점 등)은 그대로다 — 입력이 닿았는지만 보장한다.
let inputRetries = 0;
const keyCount = (page) => page.evaluate(() => window.__npcCheckKeys.length);
const keyArrived = (page, since, key) =>
  page.evaluate(({ since, key }) => window.__npcCheckKeys.slice(since).includes(key), { since, key });
async function keyDown(page, key) {
  for (let i = 0; i < 4; i++) {
    const since = await keyCount(page);
    await page.keyboard.down(key);
    await sleep(120);
    if (await keyArrived(page, since, key)) return;
    await page.keyboard.up(key);
    inputRetries++;
    console.log(`  참고: ${key} 가 페이지에 닿지 않아 다시 누름`);
  }
}
async function pressKey(page, key, { filler = false } = {}) {
  for (let i = 0; i < 6; i++) {
    const since = await keyCount(page);
    await page.keyboard.press(key);
    await sleep(150);
    if (await keyArrived(page, since, key)) return;
    if (filler) continue; // 채움 키는 빠지라고 누르는 것 — 세지 않는다
    inputRetries++;
    console.log(`  참고: ${key} 가 페이지에 닿지 않아 다시 누름`);
  }
}

async function start(page) {
  await page.evaluate(() => {
    window.__npcCheckKeys = [];
    window.addEventListener("keydown", (e) => window.__npcCheckKeys.push(e.code), true);
  });
  await page.keyboard.press("KeyT");
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 }).catch(() => {});
  // 잠금 직후 첫 keydown 은 빠진다 — 이동에 영향 없는 Shift 로 채운다(닿을 때까지)
  await pressKey(page, "ShiftLeft", { filler: true });
}

/** ms 동안 매 애니메이션 프레임 NPC·플레이어를 기록하고 페이지 안에서 판정값을 모은다 */
function sample(page, ms) {
  return page.evaluate(
    ({ ms, maxSpeed }) =>
      new Promise((resolve) => {
        const g = window.__game;
        const hook = g.npcFollow;
        const M = 0.3;
        const R = 0.35;
        const props = g.propColliders.colliders;
        const terrain = g.naju.terrain;
        const out = {
          frames: 0,
          movingFrames: 0,
          sameFrameMismatch: 0,
          maxMismatch: 0,
          maxDistance: 0,
          minDistance: Infinity,
          maxFrameMove: 0,
          overSpeedFrames: 0,
          penetrationMax: 0,
          unwalkable: 0,
          followingFrames: 0,
          first: null,
          last: null,
          teleportCount: 0,
          cameraIsPlayer: true,
          steps: [],
          slowFrames: [],
        };
        let prev = null;
        let prevT = performance.now();
        const t0 = prevT;
        const tick = () => {
          const now = performance.now();
          const dt = (now - prevT) / 1000;
          prevT = now;
          const r = hook.report;
          const link = hook.playerState.current;
          if (r && r.player) {
            out.frames++;
            const px = link.position.x * M;
            const pz = link.position.z * M;
            const py = link.footY * M;
            const mis = Math.max(Math.abs(r.player.x - px), Math.abs(r.player.z - pz), Math.abs(r.player.y - py));
            if (link.moving) out.movingFrames++;
            if (mis > 1e-6) {
              out.sameFrameMismatch++;
              out.maxMismatch = Math.max(out.maxMismatch, mis);
            }
            out.maxDistance = Math.max(out.maxDistance, r.distance);
            out.minDistance = Math.min(out.minDistance, r.distance);
            if (r.following) out.followingFrames++;
            const p = r.position;
            if (prev) {
              const move = Math.hypot(p.x - prev.x, p.z - prev.z);
              out.maxFrameMove = Math.max(out.maxFrameMove, move);
              // 코어 상한: 최대 속도 × 최대 걸음 시간(0.1 s). 페이지 rAF 간격은 R3F delta 와 어긋나 쓰지 않는다
              if (move > maxSpeed * 0.1 + 0.02) out.overSpeedFrames++;
            }
            prev = { x: p.x, z: p.z };
            out.origin ??= { x: p.x, z: p.z };
            out.maxFromOrigin = Math.max(out.maxFromOrigin ?? 0, Math.hypot(p.x - out.origin.x, p.z - out.origin.z));
            for (const c of props) {
              if (c.top <= p.y - R || c.bottom >= p.y + R) continue;
              out.penetrationMax = Math.max(out.penetrationMax, c.radius + R - Math.hypot(c.x - p.x, c.z - p.z));
            }
            const ground = terrain.groundAt(p.x, p.z);
            if (ground.isWater || ground.isFall) out.unwalkable++;
            const cam = g.naju.camera.position;
            if (Math.hypot(cam.x - link.position.x, cam.z - link.position.z) > 1e-6) out.cameraIsPlayer = false;
            out.teleportCount = r.teleportCount;
            out.steps.push(r.stepMs.last);
            if (r.stepMs.last > 4 && out.slowFrames.length < 5)
              out.slowFrames.push({
                ms: +r.stepMs.last.toFixed(2),
                frame: r.frame,
                following: r.following,
                waiting: r.waiting,
                path: r.pathStatus,
                distance: +r.distance.toFixed(2),
              });
            const snap = {
              x: +p.x.toFixed(2),
              z: +p.z.toFixed(2),
              player: [+px.toFixed(2), +pz.toFixed(2)],
              distance: +r.distance.toFixed(2),
              following: r.following,
              waiting: r.waiting,
              path: r.pathStatus,
            };
            if (!out.first) out.first = snap;
            out.last = snap;
          }
          if (now - t0 < ms) requestAnimationFrame(tick);
          else {
            const s = hook.report.stepMs;
            const sorted = [...out.steps].sort((a, b) => a - b);
            out.step = {
              avg: s.total / s.frames,
              max: s.max,
              frames: s.frames,
              planned: hook.report.plannedFrames,
              p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
              over4: out.steps.filter((v) => v > 4).length,
              sampled: out.steps.length,
            };
            delete out.steps;
            resolve(out);
          }
        };
        requestAnimationFrame(tick);
      }),
    { ms, maxSpeed: MAX_SPEED },
  );
}

async function holdWhileSampling(page, key, ms) {
  const result = sample(page, ms + 600);
  await sleep(100);
  await keyDown(page, key);
  await sleep(ms);
  await page.keyboard.up(key);
  return result;
}

const safety = (label, s) => {
  check(`${label}: 소품 관통 없음`, s.penetrationMax <= 0.01, `최대 ${s.penetrationMax.toFixed(3)} m`);
  check(`${label}: 물·벼랑에 서지 않음`, s.unwalkable === 0, `${s.unwalkable}프레임`);
  check(
    `${label}: 순간이동 없음 (프레임당 ≤ 2.8 m/s × 0.1 s)`,
    s.overSpeedFrames === 0,
    `최대 ${s.maxFrameMove.toFixed(3)} m · 초과 ${s.overSpeedFrames}프레임`,
  );
};

// ═════ 1. ?npc — 1인칭 ═════
console.log("\n[1] ?npc · 1인칭");
{
  const { ctx, page, errors } = await open("?npc&npcprof");
  const setup = await page.evaluate(() => ({
    ...window.__game.npcFollow.setup,
    playerProps: window.__game.propColliders.count,
    marker: !!window.__game.naju.scene.getObjectByName("npc-test-marker"),
  }));
  check("NPC 훅·메시가 붙음", setup.marker, JSON.stringify(setup));
  check(
    "소품 충돌이 플레이어와 같은 목록",
    setup.propCount === setup.playerProps,
    `NPC ${setup.propCount} · 플레이어 ${setup.playerProps}`,
  );
  await start(page);

  const idle = await sample(page, 6000);
  console.log(`  정지 ${idle.frames}프레임 · 처음 ${JSON.stringify(idle.first)} · 끝 ${JSON.stringify(idle.last)}`);
  check("정지: 같은 프레임 플레이어를 읽음", idle.sameFrameMismatch === 0, `불일치 ${idle.sameFrameMismatch}프레임`);
  check(
    "정지: 플레이어 곁으로 와서 멈춤",
    !idle.last.following && idle.last.distance >= MIN_SEPARATION - 0.05 && idle.last.distance <= 2,
    `거리 ${idle.last.distance} m · following=${idle.last.following}`,
  );
  check("1인칭: 플레이어 자리 = 카메라 자리", idle.cameraIsPlayer);
  safety("정지", idle);

  const walkW = await holdWhileSampling(page, "KeyW", 4000);
  console.log(
    `  걷기 W ${walkW.frames}프레임 (이동 중 ${walkW.movingFrames}) · 거리 ${walkW.minDistance.toFixed(2)}~${walkW.maxDistance.toFixed(2)} · 끝 ${JSON.stringify(walkW.last)}`,
  );
  check("걷기: 플레이어가 실제로 움직임", walkW.movingFrames > 60, `${walkW.movingFrames}프레임`);
  check(
    "걷기: 같은 프레임 플레이어를 읽음 (움직이는 동안)",
    walkW.sameFrameMismatch === 0,
    `불일치 ${walkW.sameFrameMismatch}프레임 · 최대 ${walkW.maxMismatch}`,
  );
  check(
    "걷기: 따라옴 (거리 ≤ 3 m)",
    walkW.maxDistance <= 3,
    `최대 ${walkW.maxDistance.toFixed(2)} m · 추적 ${walkW.followingFrames}프레임`,
  );
  safety("걷기", walkW);

  const after = await sample(page, 4000);
  check("멈춘 뒤: NPC 도 멈춤", !after.last.following && after.last.distance <= 2, `${JSON.stringify(after.last)}`);

  const strafe = await holdWhileSampling(page, "KeyA", 3000);
  check("옆걸음 A: 따라옴 (거리 ≤ 3 m)", strafe.maxDistance <= 3, `최대 ${strafe.maxDistance.toFixed(2)} m`);
  safety("옆걸음", strafe);
  for (const [name, r] of [
    ["정지", idle],
    ["걷기", walkW],
    ["멈춘 뒤", after],
    ["옆걸음", strafe],
  ]) {
    console.log(
      `  걸음 비용(${name}): 이 구간 ${r.step.sampled}프레임 · 상위1% ${r.step.p99.toFixed(2)} ms · 4 ms 초과 ${r.step.over4}프레임 ${JSON.stringify(r.slowFrames)}`,
    );
  }
  console.log(
    `  걸음 비용(누적): 평균 ${strafe.step.avg.toFixed(3)} ms · 최대 ${strafe.step.max.toFixed(2)} ms · ${strafe.step.frames}프레임 · 우회 ${strafe.step.planned}프레임`,
  );
  const sampled = idle.step.sampled + walkW.step.sampled + after.step.sampled + strafe.step.sampled;
  const over4 = idle.step.over4 + walkW.step.over4 + after.step.over4 + strafe.step.over4;
  check(
    "걸음 비용: 4 ms 초과 ≤ 1% (브라우저 · 헤드리스)",
    over4 <= sampled * 0.01,
    `${over4}/${sampled}프레임 · 누적 평균 ${strafe.step.avg.toFixed(3)} ms · 최대 ${strafe.step.max.toFixed(2)} ms`,
  );

  // 순간 이동 — 시점 이동(개발 훅 teleport)과 같은 경로로 V2 로 옮긴다
  const before = await page.evaluate(() => window.__game.npcFollow.report.teleportCount);
  const tp = sample(page, 4000);
  await sleep(200);
  await page.evaluate(() => window.__game.naju.teleport.current(45, 25.4));
  const tpr = await tp;
  console.log(`  순간 이동 뒤 끝 ${JSON.stringify(tpr.last)}`);
  check("순간 이동: 감지 1회", tpr.teleportCount === before + 1, `${before} → ${tpr.teleportCount}`);
  check(
    "순간 이동: NPC 는 따라 순간이동하지 않음",
    tpr.overSpeedFrames === 0,
    `프레임당 최대 ${tpr.maxFrameMove.toFixed(3)} m`,
  );
  check(
    "순간 이동: 멀어지면 제자리 대기 (경로 탐색 안 함)",
    tpr.last.distance > 12 && (tpr.last.waiting || tpr.last.path === "blocked" || !tpr.last.following),
    JSON.stringify(tpr.last),
  );
  const prof = await page.evaluate(() => window.__game.npcFollow.profile.report);
  if (prof) {
    console.log(
      `  계측(?npcprof): ${prof.frames}프레임 · 4 ms 초과 ${prof.over4ms} · 16.7 ms 초과 ${prof.over16ms} · 경로 ${prof.counts.pathPlans}회(그래프 ${prof.counts.graphSolves}) · 후보 검사 ${prof.counts.slotProbes} · 지형 표본 ${prof.counts.terrainSamples}`,
    );
    for (const f of prof.slowest.slice(0, 3))
      console.log(
        `    느린 프레임 #${f.frame} (+${(f.sinceStartMs / 1000).toFixed(1)} s): ${f.totalMs.toFixed(2)} ms = 충돌 ${f.collisionMs.toFixed(2)} + 추적 ${f.followMs.toFixed(2)} (그래프 ${f.graphMs.toFixed(2)} · 후보 ${f.probeMs.toFixed(2)}) · 그래프 ${f.graphSolves} · 후보 ${f.slotProbes} · 표본 ${f.terrainSamples} · ${f.following ? "추적" : "정지"}${f.waiting ? "·대기" : ""}·${f.pathStatus}`,
      );
  }
  check("계측(?npcprof) 기록이 쌓임", !!prof && prof.frames > 0, prof ? `${prof.frames}프레임` : "없음");
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2. ?npc — 3인칭 (V) ═════
console.log("\n[2] ?npc · 3인칭");
{
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000); // 3인칭 캐릭터(큰 GLB)가 붙을 때까지
  await sample(page, 3000);
  const w = await holdWhileSampling(page, "KeyW", 4000);
  console.log(
    `  3인칭 걷기 ${w.frames}프레임 (이동 중 ${w.movingFrames}) · 거리 ${w.minDistance.toFixed(2)}~${w.maxDistance.toFixed(2)}`,
  );
  check("3인칭: 카메라와 플레이어 자리가 다름 (playerState 를 읽어야 함)", !w.cameraIsPlayer);
  check("3인칭: 플레이어가 움직임", w.movingFrames > 60, `${w.movingFrames}프레임`);
  check("3인칭: 같은 프레임 플레이어를 읽음", w.sameFrameMismatch === 0, `불일치 ${w.sameFrameMismatch}`);
  check("3인칭: 따라옴 (거리 ≤ 3 m)", w.maxDistance <= 3, `최대 ${w.maxDistance.toFixed(2)} m`);
  safety("3인칭", w);
  const stop = await sample(page, 4000);
  check("3인칭: 멈추면 NPC 도 멈춤", !stop.last.following && stop.last.distance <= 2, JSON.stringify(stop.last));
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2b. ?npc — 행동 상태(FSM) — 개발 훅으로 보낸 대화 시작·종료가 실제 게임 루프에 반영되는가 ═════
console.log("\n[2b] ?npc · 행동 상태");
{
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await sample(page, 5000); // 곁으로 와서 선다
  const dispatch = (event) => page.evaluate((e) => window.__game.npcFollow.behavior.dispatch(e), event);
  const summary = () => page.evaluate(() => window.__game.npcFollow.summary);
  const initial = await summary();
  check(
    "초기 행동 상태 Follow · 씬 active",
    initial.behavior === "Follow" && initial.sceneActive === true,
    JSON.stringify(initial),
  );

  const talk = await dispatch({ type: "START_INTERACT" });
  check("대화 시작 수락", talk.accepted && (await summary()).behavior === "Interact");
  const walkTalking = await holdWhileSampling(page, "KeyW", 3000);
  check(
    "대화 중: 플레이어가 걸어도 NPC 이동 0",
    walkTalking.movingFrames > 30 && (walkTalking.maxFromOrigin ?? 0) < 1e-6,
    `플레이어 이동 ${walkTalking.movingFrames}프레임 · NPC ${(walkTalking.maxFromOrigin ?? 0).toFixed(4)} m`,
  );
  const reject = await dispatch({ type: "STOP_FOLLOW" });
  const log = await page.evaluate(() => window.__game.npcFollow.behavior.log);
  check(
    "대화 중 STOP_FOLLOW 거부 · 디버그 기록에 남음",
    !reject.accepted &&
      log?.lastRejected?.reason === "busy-interacting" &&
      log.lastRejected.event?.type === "STOP_FOLLOW",
    JSON.stringify(log?.lastRejected ?? null),
  );
  const end = await dispatch({ type: "END_INTERACT" });
  const resumed = await sample(page, 5000);
  const after = await summary();
  check("대화 종료 → Follow 복귀", end.accepted && after.behavior === "Follow", JSON.stringify(after));
  check(
    "재개: 순간이동 없이 따라와 곁에 섬",
    resumed.overSpeedFrames === 0 && after.distance <= 2,
    `최대 ${resumed.maxFrameMove.toFixed(3)} m · 거리 ${after.distance} m`,
  );
  safety("재개", resumed);

  await dispatch({ type: "STOP_FOLLOW" });
  const idleWalk = await holdWhileSampling(page, "KeyW", 2500);
  check(
    "Idle: 플레이어가 걸어도 NPC 이동 0",
    (idleWalk.maxFromOrigin ?? 0) < 1e-6,
    `${(idleWalk.maxFromOrigin ?? 0).toFixed(4)} m`,
  );
  await dispatch({ type: "START_FOLLOW" });
  const back = await sample(page, 5000);
  check(
    "Idle → Follow: 다시 따라옴",
    back.overSpeedFrames === 0 && back.last.distance <= 2,
    `거리 ${back.last.distance} m`,
  );
  const debug = await page.evaluate(() => ({
    summary: window.__game.npcFollow.summary,
    accepted: window.__game.npcFollow.behavior.log?.accepted,
    profileApi: typeof window.__game.npcFollow.profile.enable,
  }));
  check(
    "개발 훅: 행동·거리·대기·경로 상태·계측 창구",
    ["behavior", "distance", "waiting", "pathStatus"].every((k) => k in debug.summary) &&
      debug.profileApi === "function",
    JSON.stringify(debug),
  );
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2c. ?npc — 게임 이벤트 (실제 게임 상태 관측 · 1·3인칭) ═════
// 키 입력 없이 개발 훅(endScene · teleport)으로만 게임 상태를 바꾼다 — 헤드리스 키 입력 흔들림과 무관하다.
for (const view of ["1인칭", "3인칭"]) {
  console.log(`\n[2c] ?npc · 게임 이벤트 · ${view}`);
  const { ctx, page, errors } = await open("?npc&npcprof");
  await start(page);
  if (view === "3인칭") {
    await pressKey(page, "KeyV");
    await sleep(4000);
  }
  await sleep(2000);
  // 처리 기록은 최근 20개만 남는다 — 부를 때마다 seq 로 모아 둔다
  const seen = new Map();
  const read = async () => {
    const e = await page.evaluate(() => {
      const f = window.__game.npcFollow;
      const ev = f.events;
      return {
        log: ev.log.map((l) => ({
          seq: l.seq,
          id: l.event?.event_id ?? null,
          type: l.event?.event_type ?? null,
          target: l.event?.target_id ?? null,
          status: l.status,
          reason: l.reason ?? null,
        })),
        pending: ev.pending.length,
        notes: ev.notes.map((n) => n.note),
        state: ev.state,
        game: ev.game,
        stats: ev.stats,
        behavior: f.summary.behavior,
        teleportCount: f.report?.teleportCount ?? null,
      };
    });
    for (const l of e.log) seen.set(l.seq, l);
    return e;
  };
  const ofType = (type) => [...seen.values()].filter((l) => l.type === type);
  const e0 = await read();
  check(
    `${view}: 기준을 잡고 매 프레임 읽음`,
    !!e0.state?.hasBaseline && e0.stats.polls > 30,
    `읽기 ${e0.stats.polls}회 · 구역 ${e0.game?.zone} · 단서 ${e0.game?.seenClues.length} · 씬 ${e0.game?.clearedScenes}`,
  );
  // 도움 제안 판단: 읽기 전용으로 돌고, 시작 직후(놀이 시간 < 120 s)라 근거 부족 → WAIT · FSM 그대로
  const help0 = await page.evaluate(() => ({
    assessment: window.__game.npcFollow.help.assessment,
    decision: window.__game.npcFollow.help.decision,
    behavior: window.__game.npcFollow.behavior.state.current,
  }));
  check(
    `${view}: 도움 판단 — 시작 직후 INSUFFICIENT_DATA · WAIT · FSM Follow 그대로`,
    help0.assessment?.state === "INSUFFICIENT_DATA" &&
      help0.decision?.action === "WAIT" &&
      help0.decision.reasons.includes("INSUFFICIENT_DATA") &&
      help0.behavior === "Follow",
    `${help0.assessment?.state} · ${help0.decision?.action} [${help0.decision?.reasons}]`,
  );
  const clueAtStart = ofType("clue_discovered");
  if (clueAtStart.length) console.log(`  참고: 시작 뒤 단서 발견 ${clueAtStart.map((l) => l.target).join(", ")}`);

  const msg = await page.evaluate(() => window.__game.naju.endScene(2));
  await sleep(600);
  const e1 = await read();
  const scene = ofType("scene_cleared");
  check(
    `${view}: endScene(2) → scene_cleared 2 한 번 · 규칙 없음이라 기록만`,
    scene.length === 1 && scene[0].target === "2" && scene[0].status === "ignored" && scene[0].reason === "no-rule",
    `${msg} · ${JSON.stringify(scene)}`,
  );
  check(`${view}: 이벤트로 행동 상태가 바뀌지 않음 (Follow)`, e1.behavior === "Follow", e1.behavior);
  await sleep(4000); // 무너짐 연출(≈2.9 초)이 끝나야 차단물이 치워진다
  const e2 = await read();
  const blockerEvents = ofType("blocker_cleared");
  check(
    `${view}: 무너짐 뒤 치운 차단물 B2 → blocker_cleared 한 번 · 규칙 없음이라 기록만`,
    e2.game.clearedBlockers.includes("B2") &&
      blockerEvents.length === 1 &&
      blockerEvents[0].target === "B2" &&
      blockerEvents[0].reason === "no-rule",
    `차단물 ${e2.game.clearedBlockers.join() || "없음"} · ${JSON.stringify(blockerEvents)}`,
  );
  // AI 입력: 씬 2 · B2 두 번의 진행, 진행 직후라 정체 시간이 짧다
  const ai1 = await page.evaluate(() => window.__game.npcFollow.ai.input);
  check(
    `${view}: AI 입력 — 진행 2(scene 2 · B2) · 마지막 진행 B2 · 퍼즐/백엔드 null · JSON 그대로`,
    ai1.schema === "npc_ai_input/0.1" &&
      ai1.progress.progress_count === 2 &&
      ai1.progress.cleared_scenes.join() === "2" &&
      ai1.progress.cleared_blockers.join() === "B2" &&
      ai1.progress.last_progress?.target === "B2" &&
      ai1.progress.since_last_progress_s < 5 &&
      ai1.puzzle === null &&
      ai1.backend === null &&
      JSON.stringify(JSON.parse(JSON.stringify(ai1))) === JSON.stringify(ai1),
    `진행 ${ai1.progress.progress_count} · 마지막 ${JSON.stringify(ai1.progress.last_progress)} · 정체 ${ai1.progress.since_last_progress_s} s · 건너뜀 ${ai1.progress.skipped_scene_numbers}`,
  );
  const again = await page.evaluate(() => window.__game.naju.endScene(2));
  await sleep(600);
  await read();
  check(`${view}: endScene(2) 다시 → 추가 이벤트 0`, ofType("scene_cleared").length === 1, again);

  // 구역: V1(Z1) → V2(Z3) → V1. 옮긴 뒤 머무는 동안은 추가 이벤트가 없어야 한다
  const zonesBefore = ofType("zone_entered").length;
  await page.evaluate(() => window.__game.naju.teleport.current(45, 25.4));
  await sleep(800);
  await read();
  const toZ3 = ofType("zone_entered").slice(zonesBefore);
  check(
    `${view}: V2 로 옮김 → zone_entered Z3 한 번`,
    toZ3.length === 1 && toZ3[0].target === "Z3" && toZ3[0].reason === "no-rule",
    JSON.stringify(toZ3),
  );
  await sleep(2500);
  const stay = await read();
  check(
    `${view}: Z3 에 머무는 동안 추가 구역 이벤트 0`,
    ofType("zone_entered").length === zonesBefore + 1,
    `${stay.game.zone}`,
  );
  await page.evaluate(() => window.__game.naju.teleport.current(11, 38.5));
  await sleep(800);
  const back = await read();
  const toZ1 = ofType("zone_entered").slice(zonesBefore + 1);
  check(
    `${view}: V1 로 돌아옴 → zone_entered Z1 한 번`,
    toZ1.length === 1 && toZ1[0].target === "Z1",
    JSON.stringify(toZ1),
  );
  const ids = [...seen.values()].map((l) => l.id).filter(Boolean);
  check(`${view}: event_id 겹침 없음`, new Set(ids).size === ids.length, `${ids.length}건`);
  check(`${view}: 보류 없음 (대화 아님)`, back.pending === 0);
  const ai2 = await page.evaluate(() => window.__game.npcFollow.ai.input);
  check(
    `${view}: AI 입력 — 구역 방문 Z1 2 · Z3 1 · 다시 들어선 구역 [Z1] · 구역 이동은 진행 아님 · 서 있으니 유휴 증가`,
    ai2.player.zone === "Z1" &&
      ai2.progress.zone_visits.Z1 === 2 &&
      ai2.progress.zone_visits.Z3 === 1 &&
      ai2.progress.repeated_zones.join() === "Z1" &&
      ai2.progress.progress_count === 2 &&
      ai2.progress.since_last_progress_s > ai1.progress.since_last_progress_s &&
      ai2.player.idle_seconds > 1,
    `방문 ${JSON.stringify(ai2.progress.zone_visits)} · 진행 ${ai2.progress.progress_count} · 정체 ${ai2.progress.since_last_progress_s} s · 유휴 ${ai2.player.idle_seconds} s`,
  );
  console.log(
    `  읽기 비용: ${back.stats.polls}회 · 이벤트 ${back.stats.emitted}건 · 평균 ${back.stats.avgMs?.toFixed(4)} ms · 최대 ${back.stats.maxMs.toFixed(3)} ms (계측 ${back.stats.timed}회)`,
  );
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2d. ?npc — 대화 (F · Enter · Esc · 자동 종료 · KeyE 충돌 없음 · 1·3인칭) ═════
// 1인칭: NPC 는 평소 오른쪽 뒤라 화면 밖이다 → Idle 로 세워 두고, 그 1.5 m 옆으로 옮겨 NPC 쪽을 보게 한다(순간이동 방향은 ±X·±Z 만).
// 3인칭: 카메라가 4.2 m 뒤라 오른쪽 뒤의 NPC 가 화면 안 → Follow 그대로 대화한다.
const dialogState = (page) =>
  page.evaluate(() => {
    const f = window.__game.npcFollow;
    const box = document.querySelector("[data-npc-dialog]");
    return {
      phase: f.dialog.snapshot.phase,
      lastClose: f.dialog.snapshot.lastClose?.reason ?? null,
      canTalk: f.dialog.canTalk,
      check: f.dialog.check.reason,
      behavior: f.behavior.state.current,
      resumeTo: f.behavior.state.resumeTo,
      prompt: !!document.querySelector("[data-npc-prompt]"),
      box: !!box,
      speaker: document.querySelector("[data-npc-dialog-speaker]")?.textContent ?? null,
      text: document.querySelector("[data-npc-dialog-text]")?.textContent ?? null,
      layers: document.querySelectorAll("[data-npc-dialog-layer]").length,
      locked: !!document.pointerLockElement,
      distance: f.report ? +f.report.distance.toFixed(2) : null,
    };
  });
/** NPC 1.5 m 옆 걸을 수 있는 자리 중 NPC 를 보는 쪽으로 옮긴다 */
async function faceNpc(page) {
  const spot = await page.evaluate(() => {
    const f = window.__game.npcFollow;
    const t = window.__game.naju.terrain;
    const n = f.report.position;
    for (const [dx, dz, heading] of [
      [-1.5, 0, "+X"],
      [1.5, 0, "-X"],
      [0, -1.5, "+Z"],
      [0, 1.5, "-Z"],
    ]) {
      const x = n.x + dx;
      const z = n.z + dz;
      const g = t.groundAt(x, z);
      if (g.isWater || g.isFall || t.blockedAt(x, z, g.y, 0.3)) continue;
      if (window.__game.propColliders.blockedAt(x, z, g.y, 0.3)) continue;
      return { x, z, heading };
    }
    return null;
  });
  if (spot) await page.evaluate((s) => window.__game.naju.teleport.current(s.x, s.z, s.heading), spot);
  await sleep(800);
  return spot;
}

{
  console.log("\n[2d] ?npc · 대화 · 1인칭 (Idle)");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await sample(page, 5000);
  await page.evaluate(() => window.__game.npcFollow.behavior.dispatch({ type: "STOP_FOLLOW" }));
  const awayTalk = await dialogState(page);
  check("1인칭: NPC 가 등 뒤면 안내 없음", !awayTalk.canTalk && !awayTalk.prompt, `판정 ${awayTalk.check}`);
  const spot = await faceNpc(page);
  const ready = await dialogState(page);
  check(
    "1인칭: NPC 를 보고 곁에 서면 [F] 대화 안내",
    !!spot && ready.canTalk && ready.prompt && ready.layers === 1,
    `${JSON.stringify(spot)} · 판정 ${ready.check} · 거리 ${ready.distance} · 컨테이너 ${ready.layers}`,
  );

  await pressKey(page, "KeyE"); // 편집 모드 토글 — 대화와 무관해야 한다
  await sleep(300);
  const afterE = await dialogState(page);
  await pressKey(page, "KeyE"); // 편집 모드 되돌림
  await sleep(300);
  check(
    "KeyE: 대화를 열지 않음 · 편집 모드는 포인터 잠금을 풀어 안내도 사라짐",
    afterE.phase === "closed" && !afterE.box && !afterE.prompt && afterE.check === "unlocked",
    `${afterE.phase} · 판정 ${afterE.check} · 잠금 ${afterE.locked}`,
  );
  // 편집 모드가 잠금을 풀었다 — 플레이어처럼 T 로 다시 잠근다
  await start(page);
  await sleep(500);
  const relocked = await dialogState(page);
  check("T 로 다시 잠그면 안내가 돌아옴", relocked.canTalk && relocked.prompt, `판정 ${relocked.check}`);

  await pressKey(page, "KeyF");
  await sleep(400);
  const opened = await dialogState(page);
  check(
    "1인칭: F → 대화창(이름 · 대사) · FSM Interact · 안내 숨김 · 포인터 잠금 유지",
    opened.phase === "showing" &&
      opened.box &&
      !!opened.speaker &&
      !!opened.text &&
      opened.behavior === "Interact" &&
      opened.resumeTo === "Idle" &&
      !opened.prompt &&
      opened.locked,
    JSON.stringify(opened),
  );
  const still = await sample(page, 1500);
  check("1인칭: 대화 중 NPC 이동 0", (still.maxFromOrigin ?? 0) < 1e-6, `${(still.maxFromOrigin ?? 0).toFixed(4)} m`);
  const helpTalking = await page.evaluate(() => window.__game.npcFollow.help.decision);
  check(
    "1인칭: 대화 중 도움 판단 → WAIT (DIALOG_ACTIVE)",
    helpTalking?.action === "WAIT" && helpTalking.reasons.includes("DIALOG_ACTIVE"),
    `${helpTalking?.action} [${helpTalking?.reasons}]`,
  );
  await pressKey(page, "Enter");
  await sleep(400);
  const second = await dialogState(page);
  check(
    "1인칭: Enter → 다음 대사",
    second.phase === "showing" && second.text !== opened.text,
    `${opened.text} → ${second.text}`,
  );
  await pressKey(page, "KeyF");
  await sleep(400);
  const closed = await dialogState(page);
  check(
    "1인칭: 마지막 대사 뒤 F → 닫힘(finished) · 대화창 사라짐 · Idle 복귀",
    closed.phase === "closed" && !closed.box && closed.lastClose === "finished" && closed.behavior === "Idle",
    JSON.stringify(closed),
  );

  // 거리 초과 자동 종료: 다시 열고 6 m 옮김
  await sleep(300);
  await pressKey(page, "KeyF");
  await sleep(400);
  const reopened = await dialogState(page);
  const n = await page.evaluate(() => window.__game.npcFollow.report.position);
  await page.evaluate((n) => window.__game.naju.teleport.current(n.x - 6, n.z, "+X"), n);
  await sleep(800);
  const far = await dialogState(page);
  check(
    "1인칭: 대화 중 4 m 넘게 멀어지면 자동 종료(distance) · Idle 복귀",
    reopened.phase === "showing" && far.phase === "closed" && far.lastClose === "distance" && far.behavior === "Idle",
    `${reopened.phase} → ${far.phase} · ${far.lastClose} · ${far.behavior} · 거리 ${far.distance}`,
  );

  // Esc (보조): 포인터 잠금 중 Esc 는 브라우저가 잠금 풀기에 쓴다 — 어느 쪽이든 대화는 닫혀야 한다
  await faceNpc(page);
  await pressKey(page, "KeyF");
  await sleep(400);
  const beforeEsc = await dialogState(page);
  await page.keyboard.press("Escape");
  await sleep(600);
  const esc = await dialogState(page);
  check(
    "Esc: 대화 닫힘 · Idle 복귀 (escape 또는 잠금 풀림)",
    beforeEsc.phase === "showing" &&
      esc.phase === "closed" &&
      ["escape", "unlocked", "inactive"].includes(esc.lastClose) &&
      esc.behavior === "Idle",
    `${beforeEsc.phase} → ${esc.phase} · ${esc.lastClose} · 잠금 ${esc.locked}`,
  );
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  console.log("\n[2d] ?npc · 대화 · 3인칭 (Follow)");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000);
  await sample(page, 4000);
  const ready = await dialogState(page);
  check(
    "3인칭: 곁의 NPC 가 화면 안 → [F] 대화 안내",
    ready.canTalk && ready.prompt && ready.behavior === "Follow",
    `판정 ${ready.check} · 거리 ${ready.distance}`,
  );
  await pressKey(page, "KeyF");
  await sleep(400);
  const opened = await dialogState(page);
  check(
    "3인칭: F → 대화창 · FSM Interact(복귀 Follow)",
    opened.phase === "showing" && opened.box && opened.behavior === "Interact" && opened.resumeTo === "Follow",
    JSON.stringify(opened),
  );
  const walk = await holdWhileSampling(page, "KeyW", 1500);
  const mid = await dialogState(page);
  check(
    "3인칭: 대화 중 플레이어가 걸어도 NPC 이동 0 (4 m 안이면 대화 유지)",
    walk.movingFrames > 20 && (walk.maxFromOrigin ?? 0) < 1e-6 && mid.phase === "showing",
    `플레이어 이동 ${walk.movingFrames}프레임 · NPC ${(walk.maxFromOrigin ?? 0).toFixed(4)} m · 거리 ${mid.distance} · ${mid.phase}`,
  );
  await pressKey(page, "KeyF");
  await sleep(400);
  await pressKey(page, "KeyF");
  await sleep(400);
  const closed = await dialogState(page);
  check(
    "3인칭: 끝까지 넘기면 닫힘 · Follow 복귀",
    closed.phase === "closed" && !closed.box && closed.behavior === "Follow",
    JSON.stringify(closed),
  );
  const back = await sample(page, 5000);
  check(
    "3인칭: 대화 뒤 순간이동 없이 다시 곁으로",
    back.overSpeedFrames === 0 && back.last.distance <= 2,
    `프레임당 최대 ${back.maxFrameMove.toFixed(3)} m · 거리 ${back.last.distance} m`,
  );
  safety("대화 뒤", back);
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2e. ?npc — 도움 제안 (안내 · G 거절 · F 수락 · 숨김은 거절 아님 · 진행 만료) · 3인칭 ═════
// 실제 기준(정체 300 s 등)으로는 몇 분을 기다려야 한다 — 개발 훅 help.configure 로 이 페이지에서만 임계값을 줄인다.
// (게임 · 검사 기준값은 그대로. 이 절은 「판단 → 제안 → 입력」 연결만 본다)
{
  console.log("\n[2e] ?npc · 도움 제안 · 3인칭");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000);
  await sample(page, 4000);
  const help = () =>
    page.evaluate(() => {
      const f = window.__game.npcFollow;
      const offer = f.help.offer?.current ?? null;
      return {
        prompt: f.dialog.prompt,
        promptDom: document.querySelector("[data-npc-prompt]")?.getAttribute("data-npc-prompt") ?? null,
        promptText: document.querySelector("[data-npc-prompt]")?.textContent ?? null,
        action: f.help.decision?.action ?? null,
        reasons: f.help.decision?.reasons ?? [],
        offer: offer && { id: offer.offerId, status: offer.status, expiry: offer.expiry },
        declines: f.help.policy?.declines ?? null,
        phase: f.dialog.snapshot.phase,
        intent: f.dialog.snapshot.intent,
        text: f.dialog.snapshot.text,
        behavior: f.behavior.state.current,
        locked: !!document.pointerLockElement,
      };
    });
  const waitFor = async (pred, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
      const h = await help();
      if (pred(h)) return h;
    }
    return help();
  };
  const h0 = await help();
  check(
    "1 WAIT(근거 부족) → [F] 대화",
    h0.prompt === "talk" && h0.promptDom === "talk" && h0.action === "WAIT",
    JSON.stringify(h0),
  );

  await page.evaluate(() =>
    window.__game.npcFollow.help.configure({
      assessment: {
        minObservationSeconds: 1,
        stallSeconds: 3,
        minWindowRevisits: 0,
        newAreaGraceSeconds: 0,
        idleLongSeconds: 1e9,
      },
      policy: { offerCooldownSeconds: 4, declineCooldownSeconds: 10 },
      offer: { offerTtlSeconds: 30 },
    }),
  );
  const offered = await waitFor((h) => h.prompt === "help", 10000);
  check(
    "2 OFFER_HELP → [F] 도움 · [G] 괜찮아 표시",
    offered.prompt === "help" &&
      offered.promptDom === "help" &&
      /\[F\] 도움/.test(offered.promptText ?? "") &&
      offered.offer?.status === "pending",
    `${offered.promptText} · 제안 ${JSON.stringify(offered.offer)}`,
  );
  check(
    "3 대화를 저절로 열지 않음 · FSM Follow · 포인터 잠금 그대로",
    offered.phase === "closed" && offered.behavior === "Follow" && offered.locked,
    JSON.stringify(offered),
  );

  await pressKey(page, "KeyG");
  await sleep(500);
  const declined = await help();
  check(
    "6 G 거절 → 제안 declined · 정책 거절 1 · 안내는 [F] 대화로",
    declined.offer?.status === "declined" && declined.declines === 1 && declined.prompt === "talk",
    JSON.stringify(declined),
  );
  const coolingDown = await waitFor((h) => h.reasons.includes("PLAYER_DECLINED"), 3000);
  check(
    "6 거절 쿨다운 동안 WAIT (PLAYER_DECLINED)",
    coolingDown.action === "WAIT" && coolingDown.reasons.includes("PLAYER_DECLINED"),
    coolingDown.reasons.join(),
  );

  const second = await waitFor((h) => h.prompt === "help", 20000);
  await pressKey(page, "KeyF");
  await sleep(500);
  const accepted = await help();
  check(
    "4 F 수락 → 대화(hint_offer) · FSM Interact · 임시 도움 대사 · 제안 소비",
    second.prompt === "help" &&
      accepted.phase === "showing" &&
      accepted.intent === "hint_offer" &&
      accepted.behavior === "Interact" &&
      /임시 도움 대사/.test(accepted.text ?? "") &&
      accepted.offer?.status === "accepted" &&
      accepted.offer.id === second.offer?.id &&
      accepted.locked,
    JSON.stringify(accepted),
  );
  await pressKey(page, "KeyF");
  await sleep(400);
  await pressKey(page, "KeyF");
  await sleep(400);
  const closed = await help();
  check(
    "4 대사를 넘겨 닫으면 Follow 복귀",
    closed.phase === "closed" && closed.behavior === "Follow",
    JSON.stringify(closed),
  );
  const third = await waitFor((h) => h.prompt === "help", 15000);
  check(
    "5 수락한 제안은 다시 안 뜸 — 다음 안내는 새 제안 번호",
    third.prompt === "help" && (third.offer?.id ?? 0) > (accepted.offer?.id ?? 0),
    `수락 #${accepted.offer?.id} → 다음 #${third.offer?.id}`,
  );

  // 7 거절 없이 멀어짐 → 숨김 · 거절 아님
  const p = await page.evaluate(() => window.__game.npcFollow.report.player);
  await page.evaluate((p) => window.__game.naju.teleport.current(p.x + 6, p.z), p);
  await sleep(300);
  const away = await help();
  check(
    "7 멀어지면 안내 숨김 · 제안은 pending · 거절 기록 그대로",
    away.prompt === null && away.offer?.status === "pending" && away.declines === 1,
    JSON.stringify(away),
  );
  await page.evaluate((p) => window.__game.naju.teleport.current(p.x, p.z), p);
  await sleep(2500);

  // 8 편집 모드(E)는 포인터 잠금을 푼다 → 안내 숨김 · 거절 아님
  await pressKey(page, "KeyE");
  await sleep(400);
  const editing = await help();
  await pressKey(page, "KeyE");
  await sleep(300);
  check(
    "8 포인터 잠금 풀림 → 안내 숨김 · 거절 기록 그대로",
    !editing.locked && editing.prompt === null && editing.declines === 1,
    JSON.stringify(editing),
  );
  await start(page);
  await sleep(500);

  // 9 새 진행 → 제안 만료
  const pending = await waitFor((h) => h.offer?.status === "pending", 15000);
  await page.evaluate(() => window.__game.naju.endScene(2));
  await sleep(600);
  const progressed = await help();
  check(
    "9 새 진행(scene_cleared) → 제안 만료(progress)",
    pending.offer?.status === "pending" &&
      progressed.offer?.id === pending.offer.id &&
      progressed.offer.expiry === "progress",
    `${JSON.stringify(pending.offer)} → ${JSON.stringify(progressed.offer)}`,
  );
  await page.evaluate(() => window.__game.npcFollow.events.rebaseline("검사"));
  await sleep(300);
  const reset = await help();
  check(
    "11 세션 초기화(rebaseline) → 제안 · 정책 기록 지움",
    reset.offer === null && reset.declines === 0,
    JSON.stringify(reset),
  );
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2f. ?npc — AI 대사 공급자 (가짜 전송: ok · invalid · slow · error) · 3인칭 ═════
// 실제 모델 · 백엔드가 아니다 — 개발 훅 dialog.useMockAi 로 가짜 전송을 끼워 검증 · 시간 초과 · fallback 길을 실제 게임 루프에서 본다.
{
  console.log("\n[2f] ?npc · AI 대사 공급자(가짜 전송) · 3인칭");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000);
  await sample(page, 4000);
  const state = () =>
    page.evaluate(() => {
      const f = window.__game.npcFollow;
      return {
        phase: f.dialog.snapshot.phase,
        text: f.dialog.snapshot.text,
        lastClose: f.dialog.snapshot.lastClose?.reason ?? null,
        behavior: f.behavior.state.current,
        record: f.dialog.aiRecords.at(-1) ?? null,
        canTalk: f.dialog.canTalk,
      };
    });
  const talk = async (mode, waitMs) => {
    await page.evaluate((m) => window.__game.npcFollow.dialog.useMockAi(m, { contentPolicy: "off" }), mode);
    for (let i = 0; i < 20 && !(await state()).canTalk; i++) await sleep(250);
    await pressKey(page, "KeyF");
    await sleep(waitMs);
    const s = await state();
    await page.evaluate(() => window.__game.npcFollow.dialog.close("user"));
    await sleep(300);
    return s;
  };
  const ok = await talk("ok", 500);
  check(
    "AI 정상 → 가짜 AI 대사 · 기록 source ai · FSM Interact",
    ok.phase === "showing" &&
      /^\(가짜 AI\)/.test(ok.text ?? "") &&
      ok.record?.source === "ai" &&
      ok.behavior === "Interact",
    JSON.stringify(ok),
  );
  const invalid = await talk("invalid", 500);
  check(
    "AI 잘못된 응답 → 검증 실패 · 고정 대사(fallback · invalid_response)",
    invalid.phase === "showing" &&
      /임시 대사/.test(invalid.text ?? "") &&
      invalid.record?.reason === "invalid_response",
    JSON.stringify(invalid),
  );
  const error = await talk("error", 500);
  check(
    "AI 전송 실패 → 고정 대사(fallback · transport_error)",
    error.phase === "showing" && /임시 대사/.test(error.text ?? "") && error.record?.reason === "transport_error",
    JSON.stringify(error),
  );
  const slow = await talk("slow", 3300);
  check(
    "AI 응답 늦음 → 2.5 s 에 시간 초과 · 대화 세션(5 s) 안에 고정 대사 · 대화 유지",
    slow.phase === "showing" &&
      /임시 대사/.test(slow.text ?? "") &&
      slow.record?.reason === "timeout" &&
      slow.behavior === "Interact",
    JSON.stringify(slow),
  );
  const back = await state();
  check(
    "닫으면 Follow 복귀 (AI 경로와 상관없이)",
    back.phase === "closed" && back.behavior === "Follow",
    JSON.stringify(back),
  );
  await page.evaluate(() => window.__game.npcFollow.dialog.useMockAi(null));
  const plain = await talk(null, 500);
  check(
    "가짜 AI 를 빼면 원래 고정 대사 공급자",
    /임시 대사/.test(plain.text ?? "") && plain.record === null,
    JSON.stringify(plain),
  );
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2g. ?npc — HTTP AI 전송 (같은 출처 /api/v1/npc/dialogue · 모의 응답은 Playwright 가 네트워크에서 가로챈다) · 3인칭 ═════
// 서버 · 모델 없음. 진짜 fetch 가 브라우저 네트워크 층까지 가고, page.route 가 모의 응답을 준다(개발 서버 · FastAPI 는 그대로).
{
  console.log("\n[2g] ?npc · HTTP AI 전송(모의 응답) · 3인칭");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000);
  await sample(page, 4000);
  let routeMode = null; // null = 가로채지 않음(개발 서버가 그대로 받음)
  const seenRequests = [];
  await page.route("**/api/v1/npc/dialogue", async (route) => {
    if (routeMode === null) return route.fallback();
    const req = route.request();
    const body = JSON.parse(req.postData() ?? "{}");
    seenRequests.push({ method: req.method(), headers: req.headers(), body });
    const envelope = {
      schema: "npc_dialogue_response/0.1",
      session_id: body.session_id,
      turn: body.turn,
      response_id: `b-${seenRequests.length}`,
      text: `(모의 HTTP) 브라우저 ${body.turn + 1}번째 대사`,
      last: body.turn >= 1,
    };
    const json = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) }).catch(() => {});
    switch (routeMode) {
      case "ok":
        return json(envelope);
      case "503":
        return json({ detail: "모의 오류" }, 503);
      case "network":
        return route.abort("failed").catch(() => {});
      case "bad_json":
        return route.fulfill({ status: 200, contentType: "application/json", body: "{ JSON 아님" }).catch(() => {});
      case "stale_turn":
        return json({ ...envelope, turn: body.turn + 5 });
      case "slow":
        await sleep(3500);
        return json(envelope);
    }
  });
  const state = () =>
    page.evaluate(() => {
      const f = window.__game.npcFollow;
      return {
        phase: f.dialog.snapshot.phase,
        text: f.dialog.snapshot.text,
        behavior: f.behavior.state.current,
        record: f.dialog.aiRecords.at(-1) ?? null,
        canTalk: f.dialog.canTalk,
      };
    });
  const mode = await page.evaluate(() => window.__game.npcFollow.dialog.useHttpAi(undefined, { contentPolicy: "off" }));
  const talk = async (m, waitMs) => {
    routeMode = m;
    for (let i = 0; i < 20 && !(await state()).canTalk; i++) await sleep(250);
    await pressKey(page, "KeyF");
    await sleep(waitMs);
    const s = await state();
    await page.evaluate(() => window.__game.npcFollow.dialog.close("user"));
    await sleep(300);
    return s;
  };
  const noServer = await talk(null, 800);
  check(
    "서버 없음(개발 서버가 404 등) → fallback(transport_error) · 고정 대사 · 대화 유지",
    mode.startsWith("http:/api/v1/npc/dialogue") &&
      noServer.phase === "showing" &&
      /임시 대사/.test(noServer.text ?? "") &&
      noServer.record?.reason === "transport_error",
    `${mode} · ${noServer.record?.detail} · ${noServer.text}`,
  );
  const ok = await talk("ok", 800);
  const req = seenRequests.at(-1);
  check(
    "200 → 모의 HTTP 대사 · source ai",
    ok.phase === "showing" && /^\(모의 HTTP\)/.test(ok.text ?? "") && ok.record?.source === "ai",
    JSON.stringify(ok),
  );
  check(
    "실제 요청: POST · application/json · npc_dialogue_request/0.1 · Authorization 없음",
    req?.method === "POST" &&
      /application\/json/.test(req.headers["content-type"] ?? "") &&
      req.body.schema === "npc_dialogue_request/0.1" &&
      req.body.ai_input?.schema === "npc_ai_input/0.1" &&
      !("authorization" in req.headers),
    `${req?.method} · ${req?.headers["content-type"]} · ${req?.body.schema}`,
  );
  const results = [];
  for (const [m, reason] of [
    ["503", "transport_error"],
    ["network", "transport_error"],
    ["bad_json", "invalid_response"],
    ["stale_turn", "invalid_response"],
  ]) {
    const s = await talk(m, 800);
    results.push({
      m,
      ok: s.phase === "showing" && /임시 대사/.test(s.text ?? "") && s.record?.reason === reason,
      detail: s.record?.detail,
    });
  }
  check(
    "503 · 네트워크 실패 · 잘못된 JSON · 다른 차례 응답 → 출력 안 함 · fallback",
    results.every((r) => r.ok),
    results.map((r) => `${r.m}:${r.ok ? r.detail : "실패"}`).join(" | "),
  );
  const slow = await talk("slow", 3200);
  check(
    "응답 3.5 s 지연 → 2.5 s 에 fetch 끊음 · fallback(timeout) · 대화 유지",
    slow.phase === "showing" &&
      /임시 대사/.test(slow.text ?? "") &&
      slow.record?.reason === "timeout" &&
      slow.behavior === "Interact",
    JSON.stringify(slow),
  );
  await sleep(600);
  const back = await state();
  check("닫으면 Follow 복귀", back.phase === "closed" && back.behavior === "Follow", JSON.stringify(back));
  await page.evaluate(() => window.__game.npcFollow.dialog.useHttpAi(null));
  routeMode = null;
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 2h. ?npc — AI 대사 콘텐츠 안전성 (게임 기본 = 정책 켬) · 3인칭 ═════
// 가짜 전송만(모델 없음). 「catalog」 는 ⚠ 검사 전용 가상 목록(TEST_DIALOGUE_CATALOG) — 실제 나주 데이터가 아니다.
{
  console.log("\n[2h] ?npc · AI 대사 콘텐츠 안전성 · 3인칭");
  const { ctx, page, errors } = await open("?npc");
  await start(page);
  await pressKey(page, "KeyV");
  await sleep(4000);
  await sample(page, 4000);
  const state = () =>
    page.evaluate(() => {
      const f = window.__game.npcFollow;
      return {
        phase: f.dialog.snapshot.phase,
        text: f.dialog.snapshot.text,
        dom: document.querySelector("[data-npc-dialog-text]")?.textContent ?? null,
        behavior: f.behavior.state.current,
        record: f.dialog.aiRecords.at(-1) ?? null,
        canTalk: f.dialog.canTalk,
      };
    });
  const talk = async (mode, opts) => {
    const label = await page.evaluate(({ mode, opts }) => window.__game.npcFollow.dialog.useMockAi(mode, opts), {
      mode,
      opts,
    });
    for (let i = 0; i < 20 && !(await state()).canTalk; i++) await sleep(250);
    await pressKey(page, "KeyF");
    await sleep(600);
    const s = await state();
    await page.evaluate(() => window.__game.npcFollow.dialog.close("user"));
    await sleep(300);
    return { ...s, label };
  };
  // 게임 목록은 비어 있어(비밀 목록 없음) 반전 · 정답을 「알아볼」 수는 없다 — 자유 문장이라 막힌다(FREE_TEXT_NOT_APPROVED)
  const spoiler = await talk("spoiler", {});
  check(
    "게임 기본: 스포일러 자유 문장 → 화면에 안 나감 · 임시 고정 대사 · content_rejected(FREE_TEXT_NOT_APPROVED)",
    spoiler.phase === "showing" &&
      /임시 대사/.test(spoiler.dom ?? "") &&
      !/범인|4721/.test(spoiler.dom ?? "") &&
      spoiler.record?.reason === "content_rejected" &&
      /FREE_TEXT_NOT_APPROVED/.test(spoiler.record.detail ?? ""),
    `${spoiler.label} · ${spoiler.dom} · ${spoiler.record?.detail}`,
  );
  // 가상 목록(비밀 표현이 있음)에서는 같은 문장의 반전 · 정답을 알아보고 기록한다
  const spoilerTest = await talk("spoiler", { catalog: "test" });
  check(
    "가상 목록: 같은 스포일러 → 안 나감 · 검수된 가상 대사로 · 반전 · 정답 표현을 기록(TWIST_LEAK · ANSWER_LEAK)",
    spoilerTest.dom === "(가상) 여기 바람이 차네." &&
      !/범인|4721/.test(spoilerTest.dom ?? "") &&
      /TWIST_LEAK/.test(spoilerTest.record?.detail ?? "") &&
      /ANSWER_LEAK/.test(spoilerTest.record?.detail ?? ""),
    `${spoilerTest.dom} · ${spoilerTest.record?.detail}`,
  );
  const plain = await talk("ok", {});
  check(
    "게임 기본: 평범한 AI 자유 문장도 승인 전이라 안 나감 (FREE_TEXT_NOT_APPROVED)",
    /임시 대사/.test(plain.dom ?? "") &&
      !/가짜 AI/.test(plain.dom ?? "") &&
      /FREE_TEXT_NOT_APPROVED/.test(plain.record?.detail ?? ""),
    `${plain.dom} · ${plain.record?.detail}`,
  );
  const approved = await talk("catalog", { catalog: "test" });
  check(
    "가상 목록: 승인 대사 id → 목록 문장만 화면에 (AI 가 덧붙인 문장은 안 나감)",
    approved.dom === "(가상) 여기 바람이 차네." &&
      approved.record?.lineId === "v.ambient.wind" &&
      !/나가면 안 된다/.test(approved.dom ?? ""),
    `${approved.label} · ${approved.dom}`,
  );
  const back = await state();
  check("닫으면 Follow 복귀", back.phase === "closed" && back.behavior === "Follow", JSON.stringify(back));
  await page.evaluate(() => window.__game.npcFollow.dialog.useMockAi(null));
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 3. ?npc=z1 — 허용 구역 ═════
console.log("\n[3] ?npc=z1 · 허용 구역");
{
  const { ctx, page, errors } = await open("?npc=z1");
  const area = await page.evaluate(() => window.__game.npcFollow.setup.area);
  check("허용 구역 Z1 로 읽힘", area === "Z1", String(area));
  await start(page);
  // V1 → 동쪽 직진은 아비사 모형(22, 38.5)에 막힌다. Z1 동쪽 끝 근처(26, 36.5)로 옮긴 뒤 +X 로 걷는다
  // 한 번에 12 m(탐색 최대 거리) 넘게 옮기면 NPC 는 대기한다 — 8 m · 7 m 두 번에 나눠 옮기고 따라오게 둔다
  await page.evaluate(() => window.__game.naju.teleport.current(19, 36.5, "+X"));
  await sleep(6000);
  await page.evaluate(() => window.__game.naju.teleport.current(26, 36.5, "+X"));
  await sleep(6000);
  const caught = await page.evaluate(() => window.__game.npcFollow.report.distance);
  check("허용 구역: 옮긴 뒤 NPC 가 걸어서 따라옴", caught <= 2.5, `${caught.toFixed(2)} m`);
  const result = sample(page, 14000);
  await sleep(100);
  await keyDown(page, "KeyW");
  await sleep(12000);
  await page.keyboard.up("KeyW");
  const s = await result;
  const out = await page.evaluate(() => ({
    npc: window.__game.npcFollow.report.position,
    player: window.__game.npcFollow.report.player,
  }));
  console.log(
    `  끝: NPC (${out.npc.x.toFixed(2)}, ${out.npc.z.toFixed(2)}) · 플레이어 (${out.player.x.toFixed(2)}, ${out.player.z.toFixed(2)})`,
  );
  check("플레이어는 Z1 밖으로 나감", out.player.x > 28, `${out.player.x.toFixed(2)}`);
  check(
    "NPC 는 Z1 안에 남음",
    out.npc.x >= 8 && out.npc.x <= 28 && out.npc.z >= 30 && out.npc.z <= 44,
    `(${out.npc.x.toFixed(2)}, ${out.npc.z.toFixed(2)})`,
  );
  safety("허용 구역", s);
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 4. ?npc 없음 — 기존 게임 그대로 ═════
console.log("\n[4] ?npc 없음");
{
  const { ctx, page, errors } = await open("");
  const st = await page.evaluate(() => ({
    hook: !!window.__game.npcFollow,
    marker: !!window.__game.naju.scene.getObjectByName("npc-test-marker"),
    dialogLayer: !!document.querySelector("[data-npc-dialog-layer]"),
  }));
  check("NPC 훅·메시·대화 화면 없음", !st.hook && !st.marker && !st.dialogLayer, JSON.stringify(st));
  await start(page);
  const c0 = await page.evaluate(() => window.__game.naju.camera.position.toArray());
  await keyDown(page, "KeyW");
  await sleep(1500);
  await page.keyboard.up("KeyW");
  await sleep(300);
  const c1 = await page.evaluate(() => window.__game.naju.camera.position.toArray());
  const moved = Math.hypot(c1[0] - c0[0], c1[2] - c0[2]) * 0.3;
  check("플레이어 이동 그대로", moved > 1, `${moved.toFixed(2)} m / 1.5 s`);
  check("페이지 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ═════ 5. FPS (헤드리스 — 상대 비교만) ═════
console.log("\n[5] 프레임 (헤드리스 SwiftShader 일 수 있어 절대값은 의미 없음)");
for (const query of ["", "?npc"]) {
  const { ctx, page } = await open(query);
  await start(page);
  const walkP = page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 5000) requestAnimationFrame(f);
          else r(n / 5);
        };
        requestAnimationFrame(f);
      }),
  );
  await keyDown(page, "KeyW");
  const fps = await walkP;
  await page.keyboard.up("KeyW");
  console.log(`  ${query || "(일반)"}: 걷는 동안 ${fps.toFixed(1)} fps`);
  await ctx.close();
}

await browser.close();
console.log(`
입력 재시도(페이지에 닿지 않은 키를 다시 누른 수): ${inputRetries}`);
console.log(failures === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failures}건`);
process.exitCode = failures === 0 ? 0 : 1;
