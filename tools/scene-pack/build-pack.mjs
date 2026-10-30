#!/usr/bin/env node
/**
 * build-pack.mjs — 장면 팩(.wgp) 만들기 (10/21, 에셋보호 설계 v0 P1)
 *
 * [무엇] 여러 GLB 를 한 파일로 묶고 AES-256-GCM 으로 암호화한다.
 *   - 일반 3D 뷰어로 열리지 않는다. 파일 이름·목록도 암호 안에 있다.
 *   - 열쇠는 팩 옆에 두지 않는다 → 열쇠 파일(기본 .pack-keys.json, git 에 안 올림)에 따로 적는다.
 *     나중에는 백엔드 비밀 저장소로 옮긴다(P2).
 *
 * [v2 — 덩이로 나눔(10/21)] v1(통째로 암호화)은 다 받아야 풀 수 있어 인터넷 모의에서 따로 받기보다 4~9% 느렸다.
 *   → 약 2 MB 덩이로 나눠 덩이마다 따로 암호화. 받는 도중 도착한 덩이부터 풀고 읽는다.
 *
 * [파일 구조]
 *   "WGP2" | u32 머리 길이 | 머리 JSON {v:2, id, chunks:[{iv, size}]}  ← 이름 없음(덩이 크기·iv 만)
 *   | 덩이 0(목록) | 덩이 1 | 덩이 2 | …   (각 덩이 = AES-GCM 암호문 + 16바이트 꼬리표)
 *   덩이 0 을 풀면 목록 JSON [{name, chunk, offset, size}] — chunk 는 1부터
 *
 * [사용]
 *   node tools/scene-pack/build-pack.mjs --id naju-z1 --out .packs/naju-z1.wgp --root public/_sf_local --list files.json
 *   node tools/scene-pack/build-pack.mjs --id test --out t.wgp --root dir a.glb b.glb
 *   node tools/scene-pack/build-pack.mjs --id naju-z1 --out .packs/naju-z1.wgp --root public/_sf_local --from-manifest public/_sf_local/manifest.json
 *   --keys <파일>   열쇠 파일(기본: 지금 폴더 .pack-keys.json)
 *   --chunk <MB>    덩이 크기(기본 2)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const id = opt("--id");
const out = opt("--out");
const root = path.resolve(opt("--root", "."));
const listFile = opt("--list");
const keysFile = path.resolve(opt("--keys", ".pack-keys.json"));
const chunkBytes = Number(opt("--chunk", "2")) * 1024 * 1024;
if (!id || !out) { console.error("사용: --id <이름> --out <파일.wgp> [--root 폴더] [--list 목록.json | 파일...]"); process.exit(2); }
const manifestFile = opt("--from-manifest");
// --from-manifest: 나주맵 manifest.json 이 쓰는 파일(files·file·원경files·원경file)을 모두 모은다(시험용)
const fromManifest = (f) => {
  const out = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if ((k === "files" || k === "원경files") && Array.isArray(v)) v.forEach((n) => typeof n === "string" && out.add(n));
      else if ((k === "file" || k === "원경file") && typeof v === "string") out.add(v);
      else walk(v);
    }
  };
  walk(JSON.parse(fs.readFileSync(f, "utf8")));
  return [...out].filter((n) => fs.existsSync(path.join(root, n))).sort();
};
const names = manifestFile ? fromManifest(manifestFile) : listFile ? JSON.parse(fs.readFileSync(listFile, "utf8")) : argv;
if (!names.length) { console.error("묶을 파일이 없습니다"); process.exit(2); }

// 1) 파일을 순서대로 덩이에 담는다(파일 하나는 덩이를 넘지 않게 — 큰 파일은 혼자 한 덩이)
const groups = []; let cur = null;
const index = [];
let total = 0;
for (const n of names) {
  const b = fs.readFileSync(path.join(root, n));
  total += b.length;
  if (!cur || (cur.size > 0 && cur.size + b.length > chunkBytes)) { cur = { parts: [], size: 0 }; groups.push(cur); }
  index.push({ name: n.replace(/\\/g, "/"), chunk: groups.length, offset: cur.size, size: b.length });
  cur.parts.push(b); cur.size += b.length;
}

// 2) 덩이마다 암호화(같은 열쇠, 덩이마다 새 iv)
const key = crypto.randomBytes(32);
const seal = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return { iv: iv.toString("base64"), enc };
};
const sealed = [seal(Buffer.from(JSON.stringify(index), "utf8")), ...groups.map((g) => seal(Buffer.concat(g.parts)))];

// 3) 파일 쓰기
const head = Buffer.from(JSON.stringify({ v: 2, id, chunks: sealed.map((s) => ({ iv: s.iv, size: s.enc.length })) }), "utf8");
const hl = Buffer.alloc(4); hl.writeUInt32LE(head.length);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from("WGP2"), hl, head, ...sealed.map((s) => s.enc)]));

// 4) 열쇠는 따로
const keys = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : {};
keys[id] = { key: key.toString("base64"), file: path.basename(out), built: new Date().toISOString(), files: index.length };
fs.mkdirSync(path.dirname(keysFile), { recursive: true });
fs.writeFileSync(keysFile, JSON.stringify(keys, null, 1));
console.log(`팩 ${out} — 파일 ${index.length}개 · ${(total / 1e6).toFixed(1)} MB · 덩이 ${groups.length}개 · 열쇠 → ${keysFile} [${id}]`);
