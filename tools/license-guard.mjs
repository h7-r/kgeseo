#!/usr/bin/env node
/**
 * license-guard.mjs — 「밖으로 나가면 안 되는 3D 에셋」이 공개 폴더·배포본·커밋에 섞였는지 검사한다 (10/21, 에셋보호 설계 v0 P0)
 *
 * [왜]
 *   유니티 에셋스토어(국가유산청 KHS) 에셋은 약관상 「이용자가 따로 꺼내 받을 수 있는 형태」로 넣으면 안 된다.
 *   우리 게임은 웹이라 public/ 에 든 파일은 배포 사이트 주소로 누구나 받을 수 있다 → 단품 GLB 가 public/·dist/ 에 있으면 안 된다.
 *   이 에셋은 「장면 팩」(암호화 묶음)으로만 게임에 들어간다. 설계: claude/에셋보호_설계_v0_1021.md
 *
 * [무엇을 막나] .glb 파일 중
 *   ① asset.extras.license 가 Unity-Asset-Store-EULA 인 것(경량본에 찍어 둔 표지)
 *   ② asset.generator 에 glTFast 가 든 것(유니티에서 바로 내보낸 원본)
 *   ③ tools/license/eula_sha256.txt 에 지문(sha256)이 있는 것(표지가 지워졌어도 잡는다)
 *
 * [사용]
 *   node tools/license-guard.mjs public dist     폴더 검사(빌드 앞뒤에 자동으로 돈다 — package.json)
 *   node tools/license-guard.mjs --staged        커밋하려는 파일만 검사(.githooks/pre-commit)
 *   문제가 있으면 목록을 보여 주고 종료 코드 1 로 멈춘다.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST = path.join(ROOT, "tools/license/eula_sha256.txt");
// 한 줄 = "sha256 바이트수 경로". 바이트수가 같은 파일만 지문을 계산한다(빌드가 느려지지 않게)
const blocked = new Set();
const blockedSizes = new Set();
if (fs.existsSync(LIST)) {
  for (const l of fs.readFileSync(LIST, "utf8").split("\n")) {
    const [h, size] = l.trim().split(/\s+/);
    if (/^[0-9a-f]{64}$/.test(h ?? "")) { blocked.add(h); if (/^\d+$/.test(size ?? "")) blockedSizes.add(Number(size)); }
  }
}

function glbJson(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20 || head.toString("ascii", 0, 4) !== "glTF") return null;
    const len = head.readUInt32LE(12);
    if (len > 64 * 1024 * 1024) return null;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function check(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".glb" && ext !== ".gltf") return null;
  const j = ext === ".glb" ? glbJson(file) : (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } })();
  const lic = String(j?.asset?.extras?.license ?? "");
  if (/Unity-Asset-Store-EULA/i.test(lic)) return "표지: Unity Asset Store EULA";
  if (/glTFast/i.test(String(j?.asset?.generator ?? ""))) return "유니티에서 바로 내보낸 원본(glTFast)";
  if (blocked.size && (!blockedSizes.size || blockedSizes.has(fs.statSync(file).size)) && blocked.has(sha256(file))) return "지문 일치: Unity Asset Store EULA 에셋";
  return null;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(glb|gltf)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
let files = [];
if (args.includes("--staged")) {
  const names = execSync("git diff --cached --name-only --diff-filter=ACMR -z", { cwd: ROOT }).toString().split("\0").filter(Boolean);
  files = names.map((n) => path.join(ROOT, n)).filter((p) => /\.(glb|gltf)$/i.test(p) && fs.existsSync(p));
} else {
  for (const d of args.length ? args : ["public"]) walk(path.resolve(ROOT, d), files);
}

const bad = [];
for (const f of files) {
  const why = check(f);
  if (why) bad.push([path.relative(ROOT, f), why]);
}
if (bad.length) {
  console.error(`\n✗ 밖으로 나가면 안 되는 에셋 ${bad.length}개 — 유니티 에셋스토어(KHS) 에셋은 장면 팩으로만 게임에 넣습니다(claude/에셋보호_설계_v0_1021.md)`);
  for (const [f, why] of bad.slice(0, 30)) console.error(`  ${f}  — ${why}`);
  if (bad.length > 30) console.error(`  … 외 ${bad.length - 30}개`);
  process.exit(1);
}
console.log(`✓ 라이선스 검사 통과 — 3D 파일 ${files.length}개 (지문 ${blocked.size}개 기준)`);
