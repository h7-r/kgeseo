#!/usr/bin/env node
/**
 * 공용 에셋 빌드 번호. 공용 폴더(asset-kinds.mjs SHARED_DIRS — models · lobby-music)의 파일 경로와 내용으로 해시 8자리를 만든다.
 * 게임 빌드와 CDN 업로드가 같은 값을 쓰므로 /shared/<해시>/ 경로가 어긋나지 않는다.
 *   출력: node tools/shared-asset-build.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { SHARED_DIRS } from "./asset-kinds.mjs";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function sharedAssetBuild() {
  const hash = createHash("sha256");
  const files = SHARED_DIRS.flatMap((dir) => (existsSync(join(PUBLIC_DIR, dir)) ? listFiles(join(PUBLIC_DIR, dir)) : []))
    .map((path) => ({ path, name: relative(PUBLIC_DIR, path).split(sep).join("/") }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const { path, name } of files) {
    hash.update(`${name}\0`);
    hash.update(createHash("sha256").update(readFileSync(path)).digest());
  }
  return hash.digest("hex").slice(0, 8);
}

/** 빌드할 때 VITE_SHARED_BUILD 를 이 해시로 채운다. */
export const sharedAssetBuildPlugin = () => ({
  name: "shared-asset-build",
  config: (_, { command }) =>
    command === "build"
      ? { define: { "import.meta.env.VITE_SHARED_BUILD": JSON.stringify(sharedAssetBuild()) } }
      : undefined,
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(sharedAssetBuild());
