// 로비를 실제로 띄워 걸음·벽·집기·시점 전환·프레임을 재는 자동 검사.
// 걸음 속도, 벽 뚫기, 물건이 튀는 것은 빌드·lint 로는 안 보이고 띄워 놓고 재야 안다.
//
//   1) 개발 서버:  npx vite --port 5173
//   2) 검사:       node tools/lobby-check.mjs [주소]
//   통과하면 종료 코드 0, 하나라도 실패하면 1, 페이지를 못 띄우면 2.
//
// · ?input=always — 포인터 잠금 없이 조작을 켠다. 자동화에서 잠금은 창 포커스에 달려 들쭉날쭉하다.
//   시점 회전은 안 되지만 걷기·E·V 는 된다.
// · vsync 를 끈다 — 켜 두면 프레임 시간이 16.7 / 33.3ms 로 양자화된다.
// · 속도는 막히지 않은 프레임의 중앙값, 프레임 시간은 같은 판 안에서만 견준다(맥은 열로 기준이 밀린다).

import { aimAt, heldItem, isThirdPerson, openGamePage, POINTER_LOCK } from "./gamePage.mjs";

// 기본 몸체(meshy)로 돌린다. chibi 몸체에는 주먹 모프가 없어 손 회귀가 안 보인다.
//   chibi 도 보려면: node tools/lobby-check.mjs "http://localhost:5173/?avatar=chibi&input=always"
const url = process.argv[2] ?? "http://localhost:5173/?input=always";
const METERS_PER_UNIT = 0.3;

let failures = 0;
const measurements = [];
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "✔" : "✖"} ${name} — ${detail}`);
}

const { browser, page } = await openGamePage(["--disable-gpu-vsync", "--disable-frame-rate-limit"]);

// 백엔드가 꺼져 있으면 /api 가 502 를 찍는다. 로비 검사와는 무관하다.
const errors = [];
const BACKEND_DOWN = /Backend|Play Session|502 \(Bad Gateway\)/;
page.on("pageerror", (e) => {
  if (!POINTER_LOCK.test(e.message)) errors.push(`pageerror: ${e.message}`);
});
page.on("console", (m) => {
  if (m.type() === "error" && !POINTER_LOCK.test(m.text()) && !BACKEND_DOWN.test(m.text()))
    errors.push(`console: ${m.text().slice(0, 200)}`);
});

console.log(`▶ ${url}`);
// 누가 소스를 고치는 중이면 HMR 이 페이지를 새로 고쳐 goto 가 죽는다. 몇 번 다시 시도한다.
let loaded = false;
for (let attempt = 1; attempt <= 5 && !loaded; attempt += 1) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("canvas", { state: "attached", timeout: 60000 });
    await page.waitForTimeout(18000); // 에셋·GLB 가 다 붙을 때까지
    loaded = await page.evaluate(() => {
      const g = window.__game;
      return !!(g?.view && g.camera && g.lobby && g.movementDebug && g.teleport);
    });
  } catch (e) {
    console.log(`  못 떴다 — 다시 시도 ${attempt}/5 (${String(e.message).slice(0, 50)})`);
  }
  if (!loaded) await page.waitForTimeout(3000);
}
if (!loaded) {
  console.log("✖ 페이지를 안정적으로 못 띄웠다 — 개발 서버나 소스가 바뀌는 중인지 보라");
  await browser.close();
  process.exit(2);
}
await page.bringToFront();
const startPath = await page.evaluate(() => location.pathname);

/** 시점이 원하는 쪽이 아니면 V 로 바꾼다 */
async function setThirdPerson(third) {
  if ((await isThirdPerson(page)) === third) return;
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(1300);
}

// 걷기 전에 시선을 −z(본부실 책상 쪽)로 맞춘다. 그대로 두면 WASD 방향이 뒤집혀 기차 문에 닿는다.
const faceForward = () =>
  page.evaluate(() => {
    const camera = window.__game.camera;
    camera.rotation.set(0, 0, 0, "YXZ");
    camera.updateMatrixWorld(true);
  });

/** 키를 누른 채 걸으며 프레임마다 [시각, x, z] 를 적는다 */
async function walk(keys, seconds, start = [0, 0]) {
  await page.evaluate(([x, z]) => window.__game.teleport(x, z), start);
  await faceForward();
  await page.waitForTimeout(500);
  for (const k of keys) await page.keyboard.down(k);
  const samples = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const rows = [];
        const t0 = performance.now();
        (function tick(now) {
          const eye = window.__game.view.eye;
          rows.push([now - t0, eye.x, eye.z]);
          if (now - t0 < ms) requestAnimationFrame(tick);
          else resolve(rows);
        })(performance.now());
      }),
    seconds * 1000,
  );
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(300);
  return samples;
}

/**
 * 게임 안에서 잰 걸음 속도. 바깥에서 눈 자리를 훑으면 한 프레임 늦게 적혀 3인칭에서 절반 가까이 낮게 나온다.
 * movementDebug 는 이동 적분 자리에서 명령 속력과 실제 이동을 함께 잰다.
 * 출발점 (−18, 11) 은 −z 로 13 유닛 넘게 비어 있다 — (0, 0) 은 바로 앞이 책상이다.
 */
async function measureSpeed(keys, seconds = 1.5, start = [-18, 11]) {
  await page.evaluate(() => {
    window.__game.movementDebug.enabled = true;
  });
  await page.evaluate(([x, z]) => window.__game.teleport(x, z), start);
  await faceForward();
  await page.waitForTimeout(600);
  for (const k of keys) await page.keyboard.down(k);
  const rows = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        const t0 = performance.now();
        (function tick(now) {
          const d = window.__game.movementDebug;
          if (d.commandedSpeed > 0) out.push([d.commandedSpeed, d.actualSpeed ?? 0, d.blockedX ?? 0, d.blockedZ ?? 0]);
          if (now - t0 < ms) requestAnimationFrame(tick);
          else resolve(out);
        })(performance.now());
      }),
    seconds * 1000,
  );
  for (const k of keys) await page.keyboard.up(k);
  await page.evaluate(() => {
    window.__game.movementDebug.enabled = false;
  });
  await page.waitForTimeout(300);
  if (!rows.length) return { commanded: 0, actual: 0, blockedRatio: 1 };
  // 막히지 않은 프레임만 본다. 가구에 긁히는 건 정상이고, 보려는 건 「안 막혔을 때 명령대로 나오나」다.
  const free = rows.filter((r) => r[2] === 0 && r[3] === 0);
  const actual = (free.length ? free : rows).map((r) => r[1]).sort((a, b) => a - b);
  return {
    commanded: rows[rows.length >> 1][0],
    actual: actual[actual.length >> 1],
    blockedRatio: rows.filter((r) => r[2] > 0 || r[3] > 0).length / rows.length,
  };
}

const medianFrameMs = (samples) => {
  const frames = [];
  for (let i = 1; i < samples.length; i += 1) frames.push(samples[i][0] - samples[i - 1][0]);
  frames.sort((a, b) => a - b);
  return frames[Math.floor(frames.length / 2)] ?? 0;
};

const toMps = (unitsPerSecond) => (unitsPerSecond * METERS_PER_UNIT).toFixed(2);

// ① 1인칭 걷기·달리기
await setThirdPerson(false);
const fpWalk = await measureSpeed(["KeyW"]);
const fpRun = await measureSpeed(["KeyW", "ShiftLeft"]);
const walkSpeed = fpWalk.commanded;
const runSpeed = fpRun.commanded;
measurements.push([
  "1인칭 걷기",
  `명령 ${walkSpeed.toFixed(2)} · 실제 ${fpWalk.actual.toFixed(2)} 유닛/초 = ${toMps(fpWalk.actual)} m/s`,
]);
measurements.push([
  "1인칭 달리기",
  `명령 ${runSpeed.toFixed(2)} · 실제 ${fpRun.actual.toFixed(2)} 유닛/초 = ${toMps(fpRun.actual)} m/s`,
]);
// 사람 보통 걸음 1.4 m/s 언저리를 벗어나면 조작감이 달라진다.
check("1인칭 걷기 속도", walkSpeed > 2.8 && walkSpeed < 5.5, `${toMps(walkSpeed)} m/s (0.84~1.65 m/s 여야 함)`);
check(
  "1인칭 달리기 속도",
  runSpeed > walkSpeed * 1.3,
  `걷기의 ${(runSpeed / walkSpeed).toFixed(2)}배 (1.3배 이상이어야 함)`,
);
check(
  "1인칭 명령대로 움직인다",
  fpWalk.actual > walkSpeed * 0.9,
  `명령 ${walkSpeed.toFixed(2)} → 실제 ${fpWalk.actual.toFixed(2)} 유닛/초 (막힌 프레임 ${(fpWalk.blockedRatio * 100).toFixed(0)}%)`,
);

// ①-2 3인칭 걷기
await setThirdPerson(true);
const tpWalk = await measureSpeed(["KeyW"]);
const tpSpeed = tpWalk.commanded;
measurements.push([
  "3인칭 걷기",
  `명령 ${tpSpeed.toFixed(2)} · 실제 ${tpWalk.actual.toFixed(2)} 유닛/초 = ${toMps(tpWalk.actual)} m/s`,
]);
check("3인칭 걷기 속도", tpSpeed > 2.8 && tpSpeed < 7, `${toMps(tpSpeed)} m/s (0.84~2.1 m/s 여야 함)`);
check(
  "3인칭 명령대로 움직인다",
  tpWalk.actual > tpSpeed * 0.9,
  `명령 ${tpSpeed.toFixed(2)} → 실제 ${tpWalk.actual.toFixed(2)} 유닛/초 (막힌 프레임 ${(tpWalk.blockedRatio * 100).toFixed(0)}%)`,
);
// 클립 배속이 상한(2.2)을 넘으면 발이 미끄러진다. 계기(__game.chibiDebug)가 없는 몸체는 건너뛴다.
const timeScale = await page.evaluate(() => window.__game.chibiDebug?.timeScale ?? null);
check(
  "아바타 클립 배속이 상한 안",
  timeScale === null || timeScale <= 2.2,
  timeScale === null ? "이 몸체엔 계기가 없다(건너뜀)" : `${timeScale.toFixed(2)} (상한 2.2)`,
);
// 두 시점은 같은 걸음 속도 값을 쓴다 — 기차 안·로비·비밀복도 어디서나 같아야 한다.
check(
  "두 시점 걸음이 같다",
  Math.abs(tpSpeed - walkSpeed) < 0.05,
  `1인칭 ${walkSpeed.toFixed(2)} · 3인칭 ${tpSpeed.toFixed(2)} 유닛/초`,
);
check(
  "두 시점 차이가 과하지 않다",
  tpSpeed < walkSpeed * 1.6,
  `3인칭 / 1인칭 = ${(tpSpeed / walkSpeed).toFixed(2)}배 (1.6배 미만이어야 함)`,
);
await setThirdPerson(false);

// ② 벽 뚫기 — 여덟 방향 전력질주
// (−14, 6) 에서 1.8초. 둘레가 비어 있고 가장 가까운 기차 문까지 25 유닛이라 벽에는 닿고 문에는 못 간다.
const directions = [
  ["KeyW"],
  ["KeyS"],
  ["KeyA"],
  ["KeyD"],
  ["KeyW", "KeyA"],
  ["KeyW", "KeyD"],
  ["KeyS", "KeyA"],
  ["KeyS", "KeyD"],
];
const escapes = [];
for (const keys of directions) {
  const last = (await walk([...keys, "ShiftLeft"], 1.8, [-14, 6])).at(-1);
  const path = await page.evaluate(() => location.pathname);
  if (path !== startPath) escapes.push(`${keys.join("+")} → 기차에 탔다(경로 ${path})`);
  // 역은 x −24~24 · z −18~18, 복도는 −x 쪽으로 더 뻗는다. 넉넉히 잡는다.
  if (last[1] > 26 || last[1] < -64 || Math.abs(last[2]) > 26)
    escapes.push(`${keys.join("+")} → (${last[1].toFixed(1)}, ${last[2].toFixed(1)})`);
}
check("벽 뚫기(8방향 전력질주 1.8초)", escapes.length === 0, escapes.length ? escapes.join(" · ") : "전부 방 안");

// ③ 물건 집기·놓기
// 한 손 물건만 보면 안 된다. 두 손 물건(노트북)은 가슴 앵커·양팔 IK 라는 다른 경로를 탄다.
const pickupIds = ["pickup:mug0", "pickup:laptop0"];

const findTarget = (id) => page.evaluate((targetId) => window.__game.targets().find((t) => t.id === targetId), id);
const aimedId = () => page.evaluate(() => window.__game.lobby.aim.get());

let held = null;
let lastItem = null;
for (const id of pickupIds) {
  const item = await findTarget(id);
  if (!item) {
    check(`${id} 등록`, false, "대상 목록에 없다");
    continue;
  }
  await setThirdPerson(false);
  await aimAt(page, item.position);
  const aimed = await aimedId();
  check(`겨냥(${id})`, aimed === id, `겨냥된 것 = ${aimed}`);
  if (aimed !== id) continue;
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(900);
  const picked = await heldItem(page);
  check(`집기(${id})`, picked !== null, `heldItem = ${picked}`);
  if (!picked) continue;

  // 3인칭에서 놓는다 — 양팔 IK·가슴 앵커가 실제로 도는 곳이다.
  await setThirdPerson(true);
  const errorsBefore = errors.length;
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(1200);
  check(`3인칭에서 놓기(${id})`, (await heldItem(page)) === null, `heldItem = ${await heldItem(page)}`);
  check(
    `놓는 동안 예외 없음(${id})`,
    errors.length === errorsBefore,
    errors.length === errorsBefore ? "0건" : `${errors.length - errorsBefore}건`,
  );
  lastItem = item;
}

// ④⑤ 에서 쓸 물건을 다시 집어 둔다
if (lastItem) {
  await setThirdPerson(false);
  await aimAt(page, lastItem.position);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(900);
  held = await heldItem(page);
}

// ④ 시점 전환 때 든 물건이 튀지 않는가
if (held) {
  const trail = page.evaluate(
    () =>
      new Promise((resolve) => {
        const rows = [];
        const t0 = performance.now();
        (function tick() {
          const o = window.__game.scene.getObjectByName("heldItem");
          if (o) rows.push([o.position.x, o.position.y, o.position.z]);
          if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
          else resolve(rows);
        })();
      }),
  );
  await page.waitForTimeout(250);
  await page.keyboard.press("KeyV"); // 1인칭 → 3인칭
  const rows = await trail;
  let maxJump = 0;
  for (let i = 1; i < rows.length; i += 1)
    maxJump = Math.max(
      maxJump,
      Math.hypot(rows[i][0] - rows[i - 1][0], rows[i][1] - rows[i - 1][1], rows[i][2] - rows[i - 1][2]),
    );
  measurements.push(["시점 전환 때 물건 튐", `${maxJump.toFixed(3)} 유닛/프레임`]);
  // 0.3 유닛 ≈ 9cm. 이보다 크면 따라온다기보다 순간이동으로 보인다.
  check("시점 전환 때 물건이 안 튄다", maxJump < 0.3, `한 프레임 최대 ${maxJump.toFixed(3)} 유닛`);
  await page.waitForTimeout(900);

  // ⑤ 3인칭에서 놓을 때 팔 IK 가 서서히 꺼지는가
  await setThirdPerson(true);
  // 시각도 같이 적는다. 프레임당 변화량만 보면 긴 프레임 하나에 거짓 경보가 난다. 보려는 건 초당 속도다.
  const ikTrail = page.evaluate(
    () =>
      new Promise((resolve) => {
        const rows = [];
        const t0 = performance.now();
        (function tick() {
          rows.push([performance.now() - t0, window.__game.armIK?.weight ?? 0]);
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
          else resolve(rows);
        })();
      }),
  );
  await page.waitForTimeout(150);
  await page.keyboard.press("KeyE"); // 놓기
  const ik = await ikTrail;
  let ikRate = 0; // 초당 변화량
  let ikStep = 0; // 한 프레임 변화량(참고용)
  for (let i = 1; i < ik.length; i += 1) {
    const dt = (ik[i][0] - ik[i - 1][0]) / 1000;
    const d = Math.abs(ik[i][1] - ik[i - 1][1]);
    ikStep = Math.max(ikStep, d);
    if (dt > 0.004) ikRate = Math.max(ikRate, d / dt);
  }
  measurements.push(["팔 IK 세기 변화 속도", `${ikRate.toFixed(1)}/초 (한 프레임 최대 ${ikStep.toFixed(3)})`]);
  // 한 프레임에 꺼지면 60fps 에서 51/초가 나온다. 정상이면 가장 빠른 축이 뻗기 램프(6.3/초) 언저리다.
  check("팔 IK 가 서서히 꺼진다", ikRate < 15, `${ikRate.toFixed(1)}/초 (한 프레임에 꺼지면 51/초)`);
  check("물건 놓기", (await heldItem(page)) === null, `heldItem = ${await heldItem(page)}`);
}

// ⑥ 의자 끌기 — 손 모양과 놓은 뒤 빈손 헛자세
// 의자는 heldItem 이 null 인데 손은 쥐고 있는 유일한 경우라, 든 물건 기준 조건에서 조용히 어긋난다.
const fistMorph = () =>
  page.evaluate(() => {
    let value = null;
    window.__game.scene.traverse((o) => {
      const i = o.morphTargetDictionary?.fistHands;
      if (i != null && o.morphTargetInfluences) value = o.morphTargetInfluences[i];
    });
    return value;
  });

const chair = await findTarget("chair0");
if (chair) {
  await setThirdPerson(false);
  await aimAt(page, chair.position);
  const aimed = await aimedId();
  if (aimed !== "chair0") check("의자 겨냥", false, `겨냥된 것 = ${aimed}`);
  else {
    await page.keyboard.press("KeyE"); // 잡기
    await page.waitForTimeout(900);
    await setThirdPerson(true);
    await page.waitForTimeout(600);
    const fist = await fistMorph();
    // 평소 손 0.6 · 쥔 손 0.7. meshy 몸체에만 모프가 있다.
    check(
      "의자 끄는 동안 손이 쥐어져 있다",
      fist === null || fist > 0.65,
      fist === null ? "이 몸체엔 주먹 모프가 없다(건너뜀)" : `모프 ${fist.toFixed(3)} (평소 0.6 · 쥔 손 0.7)`,
    );

    // 아무것도 안 겨냥한 채 놓으면 팔이 클립 자세로 돌아가야 한다
    await page.evaluate(() => {
      const camera = window.__game.camera;
      camera.lookAt(camera.position.x, camera.position.y + 20, camera.position.z);
      camera.updateMatrixWorld(true);
    });
    await page.waitForTimeout(300);
    await page.keyboard.press("KeyE"); // 놓기
    await page.waitForTimeout(700); // 뻗기(0.6초)가 끝난 뒤
    const after = await page.evaluate(() => ({
      hasTarget: window.__game.armIK?.hasTarget ?? null,
      weight: window.__game.armIK?.weight ?? null,
    }));
    check(
      "의자 놓은 뒤 빈손 헛자세가 없다",
      after.hasTarget === false || (after.weight ?? 1) < 0.02,
      `armIK hasTarget=${after.hasTarget} weight=${(after.weight ?? 0).toFixed(3)}`,
    );
  }
}

// ⑦ 두 시점 프레임 시간
for (const third of [false, true]) {
  await setThirdPerson(third);
  const ms = medianFrameMs(await walk(["KeyW"], 2));
  measurements.push([
    `${third ? "3인칭" : "1인칭"} 걷는 중 프레임`,
    `${ms.toFixed(2)} ms (${(1000 / ms).toFixed(0)} fps)`,
  ]);
}

// ⑧ 콘솔 오류
check(
  "콘솔 오류",
  errors.length === 0,
  errors.length ? `${errors.length}건\n    ${errors.slice(0, 6).join("\n    ")}` : "없음",
);

console.log("\n── 잰 값 ──");
for (const [name, value] of measurements) console.log(`   ${name}: ${value}`);
console.log(failures ? `\n✖ ${failures}건 실패` : "\n✔ 전부 통과");

await browser.close();
process.exit(failures ? 1 : 0);
