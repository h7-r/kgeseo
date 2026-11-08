// 공유한 금칙어 판정기(검토 14회차 6) — 원본과 같은지(drift), 생성본이 실제로 도는지, 빌드한 JS 가 Node 에서 도는지.
// 생성본은 @ts-nocheck 라 타입 검사가 없다 — 그래서 실행으로 확인한다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findProfanity } from "../src/generated/profanity/nicknamePolicy.js";
// @ts-expect-error — 생성 스크립트(.mjs)는 타입 선언이 없다
import { staleProfanityFiles } from "../scripts/extract-profanity.mjs";

const lobbyDir = fileURLToPath(new URL("..", import.meta.url));

describe("금칙어 판정기 공유", () => {
  it("생성본이 원본(website · shared)과 같다 — 다르면 node scripts/extract-profanity.mjs", () => {
    assert.deepEqual(staleProfanityFiles(), []);
  });

  it("생성본이 실제로 판정한다", () => {
    assert.equal(findProfanity("시 발", { freeText: true })?.category, "abuse");
    assert.equal(findProfanity("반가워요", { freeText: true }), null);
  });

  it("빌드한 JS 가 Node 에서 돈다(JSON import 속성 포함)", { timeout: 120_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), "lobby-build-"));
    try {
      const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--outDir", out], {
        cwd: lobbyDir,
        encoding: "utf8",
      });
      assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
      const entry = pathToFileURL(join(out, "chat.js")).href;
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const m = await import(${JSON.stringify(entry)}); console.log(JSON.stringify([m.findChatProfanity("ㅅㅂ"), m.findChatProfanity("안녕")]));`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim(), "[true,false]");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
