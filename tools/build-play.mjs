#!/usr/bin/env node
/**
 * play.k-escape.com 배포본 — 본편과 나주를 한 산출물(dist/)로 묶는다.
 *   본편: dist/                나주: dist/naju01/index.html + dist/naju01/assets/
 *
 * 나주는 자기 설정(naju01/vite.config.ts)으로 빌드해야 손 배치(naju-edit.json)가 같이 나간다.
 * base 는 "/" 그대로 두고 JS 만 naju01/assets/ 에 넣는다 — 개발 서버(5173)가 나주를 /naju01/ 로 내주는 것과
 * 같은 모양이라 /fonts · /basis · /_sf_local 같은 공개 파일 주소가 본편과 한 뿌리를 쓴다.
 *   실행: npm run build:play
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

import { holdOf } from "./asset-hold.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const NAJU_OUT = join(ROOT, ".naju-play-build");

/** dist 기준 경로 목록 */
const listFiles = (dir, prefix = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );

const run = (command) => execSync(command, { cwd: ROOT, stdio: "inherit" });

// 1. 본편 — 라이선스 검사·타입 검사·빌드는 기존 build 그대로
run("npm run build");

// 2. 나주 — public/ 은 본편이 이미 복사했으니 다시 넣지 않는다. 환경값은 본편과 같은 저장소 뿌리에서 읽는다
run("npx tsc -p naju01/tsconfig.json --noEmit");
await build({
  configFile: join(ROOT, "naju01/vite.config.ts"),
  base: "/",
  publicDir: false,
  envDir: ROOT,
  build: { outDir: NAJU_OUT, emptyOutDir: true, assetsDir: "naju01/assets" },
});

// 3. 합치기 — index.html 은 naju01/ 아래로, naju01/assets 는 그대로, 나머지(naju-edit.json)는 뿌리에. 본편 파일과 겹치면 멈춘다
const moves = [{ from: join(NAJU_OUT, "index.html"), to: join(DIST, "naju01", "index.html") }];
for (const name of readdirSync(NAJU_OUT)) {
  if (name === "index.html") continue;
  if (name !== "naju01") moves.push({ from: join(NAJU_OUT, name), to: join(DIST, name) });
  else
    for (const child of readdirSync(join(NAJU_OUT, name)))
      moves.push({ from: join(NAJU_OUT, name, child), to: join(DIST, name, child) });
}
const clash = moves.filter(({ to }) => existsSync(to));
if (clash.length) throw new Error(`[build-play] 본편 산출물과 겹친다: ${clash.map(({ to }) => to).join(", ")}`);
mkdirSync(join(DIST, "naju01"), { recursive: true });
for (const { from, to } of moves) renameSync(from, to);
rmSync(NAJU_OUT, { recursive: true, force: true });

// 4. 배포본에도 남기면 안 되는 보류 파일(tools/asset-hold.mjs offDist)을 지운다
for (const rel of listFiles(DIST)) {
  if (!holdOf(rel)?.offDist) continue;
  rmSync(join(DIST, rel));
  console.log(`[build-play] 보류 — 배포본에서 뺌: ${rel}`);
}

run("node tools/license-guard.mjs dist");
console.log("[build-play] dist/ 에 본편 + 나주(/naju01/) 를 묶었다");
