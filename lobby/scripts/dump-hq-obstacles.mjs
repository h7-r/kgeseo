// 본부실 장애물 지도 뽑기(개발 전용) — preview-bots.mjs 의 가상 인원이 가구를 뚫고 다니지 않게 쓰는 지도.
//   cd lobby && node scripts/dump-hq-obstacles.mjs     → scripts/hq-obstacles.json
// 실행 중인 게임(기본 http://localhost:5173, 미리보기·평소 개발 서버 어느 쪽이든)을 열어 두 가지를 모은다.
//   1) 게임이 실제로 쓰는 충돌 박스(window.__game.staticColliders · colliders) — 내 캐릭터를 막는 것과 같다.
//   2) 박스가 없는데 높이가 있는 본부실 물체(바닥의 증거물 상자 같은 집는 물건, 벽 기둥) — 가상 인원만 피한다.
// 로그인은 개발 시드 계정으로 하고, 로비 입장권 요청은 막는다(지도를 뽑는 창이 방에 들어가지 않게).
// 가구 배치(Leva)를 바꿨으면 다시 뽑는다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const GAME = process.env.GAME_URL ?? "http://localhost:5173";
const OUT = resolve(here, "hq-obstacles.json");

const seed = readFileSync(resolve(repo, "backend/scripts/seed_test_account.py"), "utf8");
const email = /^EMAIL = "([^"]+)"/m.exec(seed)?.[1];
const password = /^PASSWORD = "([^"]+)"/m.exec(seed)?.[1];
if (!email || !password) throw new Error("개발 시드 계정을 읽지 못했다(backend/scripts/seed_test_account.py)");

const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--use-angle=metal"] });
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  await context.route("**/api/v1/lobby/ticket", (route) => route.abort());
  const login = await context.request.post(`${GAME}/api/v1/auth/login`, {
    headers: { Origin: GAME },
    data: { email, password },
  });
  if (!login.ok()) throw new Error(`개발 로그인 실패(${login.status()})`);
  const page = await context.newPage();
  await page.goto(`${GAME}/?input=always`);
  await page.waitForFunction(() => window.__game?.teleport && window.__game?.scene && window.__game?.colliders, null, {
    timeout: 90000,
  });
  await page.evaluate(() => window.__game.teleport(-14, 7));
  // AutoCollider 는 GLB 가 붙은 뒤 0.5초 간격으로 잰다 — 박스 수가 멈출 때까지 기다린다
  let last = -1;
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() => window.__game.colliders.size);
    if (count === last && count > 0) break;
    last = count;
  }

  const result = await page.evaluate(() => {
    const g = window.__game;
    const HQ = { minX: -20, maxX: 16, minZ: -14, maxZ: 12 };
    const inHq = (b) => b.maxX > HQ.minX && b.minX < HQ.maxX && b.maxZ > HQ.minZ && b.minZ < HQ.maxZ;
    const round = (v) => Math.round(v * 100) / 100;
    const flat = (id, b, source) => ({
      id,
      source,
      minX: round(b.minX),
      maxX: round(b.maxX),
      minZ: round(b.minZ),
      maxZ: round(b.maxZ),
    });
    const boxes = [
      ...g.staticColliders.map((b, i) => flat(`static${i}`, b, "collider")),
      ...[...g.colliders.entries()].map(([id, b]) => flat(id, b, "collider")),
    ].filter(inHq);

    // 박스가 없는 물체: 본부실 아래, 발 높이에서 시작해 0.8 이상 솟은 것. 벽·바닥·천장(8 넘게 넓은 것)과 사람(스킨 메시)은 뺀다
    const hq = g.scene.getObjectByName("headquarters");
    const extras = [];
    g.scene.updateMatrixWorld(true);
    hq?.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry || o.isSkinnedMesh) return;
      o.geometry.computeBoundingBox?.();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const b = { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z };
      if (bb.max.y - bb.min.y < 0.8 || bb.min.y > 1.2) return;
      if (b.maxX - b.minX > 8 || b.maxZ - b.minZ > 8 || !inHq(b)) return;
      const covered = boxes.some(
        (c) => b.minX >= c.minX - 0.05 && b.maxX <= c.maxX + 0.05 && b.minZ >= c.minZ - 0.05 && b.maxZ <= c.maxZ + 0.05,
      );
      // 외곽선 껍데기는 같은 자리에 한 벌 더 있다 — 같은 상자는 한 번만
      const box = flat(`mesh${extras.length}`, b, "mesh");
      const same = extras.some(
        (e) => e.minX === box.minX && e.maxX === box.maxX && e.minZ === box.minZ && e.maxZ === box.maxZ,
      );
      if (!covered && !same) extras.push(box);
    });
    return { boxes, extras };
  });

  const out = {
    note: "lobby/scripts/dump-hq-obstacles.mjs 가 만든다. 손으로 고치지 않는다.",
    generatedAt: new Date().toISOString(),
    hq: { minX: -20, maxX: 16, minZ: -14, maxZ: 12 },
    wallMolding: 0.36,
    obstacles: [...result.boxes, ...result.extras],
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`본부실 장애물 ${out.obstacles.length}개(충돌 박스 ${result.boxes.length} · 박스 없는 물체 ${result.extras.length}) → ${OUT}`);
} finally {
  await browser.close();
}
