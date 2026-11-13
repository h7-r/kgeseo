// 회귀 경로를 어느 체크포인트까지 그대로 재생한 뒤, 실험 단계를 더 돌리며 월드 좌표·시선·경첩 상태를 읽는다.
//   node tools/regression/shared/probe.mjs <서버주소> <출력폴더> <멈출 체크포인트 이름> <실험 json>
// 실험 json: route 와 같은 step 배열. 추가 op "probe" {name, hinges:[id...]} 는 상태를 찍고 스크린샷을 남긴다.
import fs from "node:fs";
import path from "node:path";
import { exec } from "./steps.mjs";
import { goto, launch, newSession } from "./session.mjs";
import { loadSuite } from "./suite.mjs";

const [base, outDir, stopAt, experimentFile] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const suite = loadSuite("game");
const route = JSON.parse(fs.readFileSync(suite.routeFile, "utf8"));
const experiments = JSON.parse(fs.readFileSync(experimentFile, "utf8"));

const browser = await launch({ headless: true });
const session = await newSession(browser);

async function probe(step) {
  const state = await session.page.evaluate(
    ({ ids, prefixes }) => {
      const g = window.__game;
      const cam = g.camera;
      const all = typeof g.targets === "function" ? g.targets() : [];
      const targets = all.filter((t) => (prefixes ?? []).some((p) => String(t.id).startsWith(p)));
      return {
        eye: g.playerPosition?.eye?.toArray?.(),
        cam: cam
          ? {
              rot: [cam.rotation.x, cam.rotation.y, cam.rotation.z],
              order: cam.rotation.order,
              pos: cam.position.toArray(),
              fov: cam.fov,
            }
          : null,
        aimed: g.lobby?.aim?.get?.() ?? null,
        hinges: Object.fromEntries((ids ?? []).map((id) => [id, g.hinges?.isOpen?.(id)])),
        targets,
        targetCount: all.length,
        state: {
          fullPower: g.workLamp?.fullPower?.(),
          painting: g.workLamp?.paintingPowered?.(),
          sorting: g.workLamp?.sortingState?.()?.done,
          drink: g.drink?.state,
          coins: g.coins?.state,
          hintPaper: g.hintPaper?.state,
          hints: (() => {
            const h = g.hintBox?.hints;
            const list = Array.isArray(h)
              ? h
              : h instanceof Map
                ? [...h.values()]
                : h && typeof h === "object"
                  ? Object.values(h)
                  : [];
            return list.map((x) =>
              x && typeof x === "object" ? (x.title ?? x.id ?? JSON.stringify(x).slice(0, 40)) : String(x),
            );
          })(),
          nozzle: g.nozzle?.nozzleLocation?.(),
          vending: g.vendingMachine?.vendingMachineStore?.getState?.() ?? null,
          wiring: g.workLamp?.wiringState?.(),
          panelSwitches: (() => {
            const raw = g.panelWiring?.switchIds;
            const ids = typeof raw === "function" ? raw() : raw;
            const list = Array.isArray(ids) ? ids : ids && typeof ids === "object" ? Object.values(ids) : [];
            return list.map((id) => g.hinges?.isOpen?.(id));
          })(),
          door: (() => {
            const e = g.playerPosition?.eye;
            return e && g.trainDoors?.rightmost ? g.trainDoors.rightmost(e.x, e.z) : null;
          })(),
          url: location.pathname,
          panelWiringKeys: Object.keys(g.panelWiring ?? {}),
          panelPlugged: g.panelWiring?.plugged ?? g.panelWiring?.state?.plugged ?? null,
          panelDoor: g.panelDoorId ? g.hinges?.isOpen?.(g.panelDoorId) : null,
          hydrantDoor: g.hydrantDoorId ? g.hinges?.isOpen?.(g.hydrantDoorId) : null,
        },
        text: document.body.innerText.slice(0, 120),
      };
    },
    { ids: step.hinges ?? [], prefixes: step.targets ?? [] },
  );
  await session.page.screenshot({ path: path.join(outDir, `${step.name}.png`) });
  console.log(`PROBE ${step.name} ${JSON.stringify(state)}`);
}

const RAD_PER_PX = route.radPerPx ?? 0.002;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

async function look() {
  return session.page.evaluate(() => {
    const g = window.__game;
    const d = g.camera.getWorldDirection(new g.camera.position.constructor());
    // 자리는 플레이어 눈(컷신 중엔 카메라가 딴 데 있다), 방향은 카메라
    const eye = g.playerPosition?.eye?.toArray?.() ?? g.camera.position.toArray();
    return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(d.y), eye, cam: g.camera.position.toArray() };
  });
}

// 대상 id 를 겨누도록 마우스를 움직인다 — 월드 좌표로 필요한 각도를 구하고, 부호는 그 자리에서 보정한다
// 겨냥 판정은 카메라 광선이다. 3인칭이면 마우스를 돌릴 때 카메라가 사람 주위를 돌아 광선 시작점이 바뀌므로
// 계산 → 움직임 → 다시 재기를 겨눠질 때까지(최대 4번) 반복한다. 1인칭에선 한 번에 끝난다.
async function aimToward(pointOf, id, check) {
  const moves = [];
  let aimed = null;
  for (let i = 0; i < 4; i++) {
    const a = await look();
    const [tx, ty, tz] = await pointOf();
    const from = a.cam ?? a.eye;
    const dx = tx - from[0],
      dy = ty - from[1],
      dz = tz - from[2];
    const mdx = Math.round((-1 * wrap(Math.atan2(dx, dz) - a.yaw)) / RAD_PER_PX);
    const mdy = Math.round((-1 * (Math.atan2(dy, Math.hypot(dx, dz)) - a.pitch)) / RAD_PER_PX);
    await exec(session, { op: "mouse", dx: mdx, dy: mdy, after: 50 });
    await exec(session, { op: "run", ms: 100 });
    moves.push([mdx, mdy]);
    aimed = await session.page.evaluate(() => window.__game.lobby?.aim?.get?.() ?? null);
    if (!check || aimed === id) break;
    if (Math.abs(mdx) <= 1 && Math.abs(mdy) <= 1) break; // 더 움직일 게 없다 — 겨눠지지 않는 자리
  }
  return { moves, aimed };
}

async function aimAt(step) {
  let target = null;
  let waited = 0;
  for (let i = 0; i < (step.retries ?? 8); i++) {
    target = await session.page.evaluate((id) => {
      const t = window.__game.targets().find((x) => x.id === id);
      return t ? { position: t.position, disabled: t.disabled } : null;
    }, step.id);
    if (target && Array.isArray(target.position)) break;
    await exec(session, { op: "run", ms: 300 });
    waited += 1;
  }
  if (!target || !Array.isArray(target.position)) throw new Error(`대상 없음: ${step.id} ${JSON.stringify(target)}`);
  const pointOf = () =>
    session.page.evaluate((id) => window.__game.targets().find((x) => x.id === id)?.position, step.id);
  const { moves, aimed } = await aimToward(pointOf, step.id, true);
  const a = await look();
  console.log(
    `AIM ${step.id} → moves=${JSON.stringify(moves)} waited=${waited} aimed=${aimed} ${aimed === step.id ? "OK" : "MISS"} disabled=${target.disabled} pos=${target.position.map((v) => v.toFixed(2))} eye=${a.eye.map((v) => v.toFixed(2))}`,
  );
}

// 월드 좌표 한 점을 겨눈다(targets 에 없는 것 — 기차 안내판 홀로그램)
async function aimPoint(step) {
  const { moves } = await aimToward(async () => step.at, null, false);
  const a = await look();
  console.log(
    `AIM point → moves=${JSON.stringify(moves)} waited=0 at=${step.at} eye=${a.eye.map((v) => v.toFixed(2))}`,
  );
}

// 대상 쪽으로 걷는다 — 300ms 씩 걷고 매번 다시 향한다. 바뀐 마우스·걷기 단계를 그대로 경로에 옮겨 적을 수 있게 전부 찍는다
async function goTo(step) {
  const stop = step.stop ?? 1.6;
  const baked = [];
  for (let i = 0; i < (step.maxChunks ?? 60); i++) {
    const target = step.door
      ? await session.page.evaluate(() => {
          const g = window.__game;
          const e = g.playerPosition.eye;
          const d = g.trainDoors.rightmost(e.x, e.z);
          return d ? [d.x, 0, d.z] : null;
        })
      : step.to
        ? [step.to[0], 0, step.to[1]]
        : await session.page.evaluate((id) => {
            const t = window.__game.targets().find((x) => x.id === id);
            return t ? t.position : null;
          }, step.id);
    if (!Array.isArray(target)) throw new Error(`대상 없음: ${step.id}`);
    const a = await look();
    const dx = target[0] - a.eye[0],
      dz = target[2] - a.eye[2];
    const dist = Math.hypot(dx, dz);
    if (dist <= stop) break;
    const yawT = Math.atan2(dx, dz);
    const mdx = Math.round((-1 * wrap(yawT - a.yaw)) / RAD_PER_PX);
    const ms = step.chunkMs ?? 300;
    if (mdx) await exec(session, { op: "mouse", dx: mdx, dy: 0, after: 50 });
    await exec(session, { op: "hold", codes: step.run ? ["KeyW", "ShiftLeft"] : ["KeyW"], ms, after: 100 });
    baked.push([mdx, ms]);
    const b = await look();
    if (Math.hypot(b.eye[0] - a.eye[0], b.eye[2] - a.eye[2]) < 0.02 && i > 2) {
      console.log(
        `GOTO ${step.door ? "door" : (step.id ?? JSON.stringify(step.to))} 막힘 at ${b.eye.map((v) => v.toFixed(2))} dist=${dist.toFixed(2)}`,
      );
      break;
    }
  }
  const end = await look();
  console.log(
    `GOTO ${step.door ? "door" : (step.id ?? JSON.stringify(step.to))} stop=${stop} steps=${JSON.stringify(baked)} eye=${end.eye.map((v) => v.toFixed(2))}`,
  );
}

// 벽함 문이 닫혀 있을 때만 연다(이미 열린 문을 E 로 도로 닫지 않게). 두 문 상태를 전후로 찍어 훅 이름이 맞는지도 본다
async function ensureOpen(step) {
  const read = () =>
    session.page.evaluate(() => {
      const g = window.__game;
      return { h: g.hinges.isOpen(g.hydrantDoorId), p: g.hinges.isOpen(g.panelDoorId) };
    });
  const before = await read();
  const pick = (v) => (step.door === "hydrant" ? v.h : v.p);
  let tries = 0;
  while (!pick(await read()) && tries < 3) {
    await aimAt({ id: step.cabinet });
    await exec(session, { op: "key", code: "KeyE", after: 800 });
    await exec(session, { op: "run", ms: 800 });
    tries += 1;
  }
  const after = await read();
  console.log(
    `ENSURE ${step.door} ${tries ? "OPENED" : "ALREADY"} tries=${tries} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
}

async function runStep(step) {
  if (step.op === "aimPoint") {
    await aimPoint(step);
  } else if (step.op === "ensureOpen") {
    await ensureOpen(step);
  } else if (step.op === "goTo") {
    await goTo(step);
  } else if (step.op === "aimAt") {
    await aimAt(step);
  } else if (step.op === "goto") {
    await goto(session, base + step.path, { readyText: step.readyText, warmMs: step.warmMs ?? 2000 });
  } else if (step.op === "checkpoint") {
    console.log(`· ${step.name}`);
  } else if (step.op === "probe") {
    await probe(step);
  } else await exec(session, step);
}

for (const step of route.steps) {
  await runStep(step);
  if (step.op === "checkpoint" && step.name === stopAt) break;
}
console.log("== 실험 시작");
for (const step of experiments) {
  try {
    await runStep(step);
  } catch (error) {
    console.log(`✖ ${JSON.stringify(step).slice(0, 120)}: ${error.message}`);
    break;
  }
}
await browser.close();
