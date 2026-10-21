#!/usr/bin/env node
/**
 * 장면 팩 로딩 비교 — 내 컴퓨터 브라우저로 재기 (10/21, 에셋보호 설계 v0 P1)
 *   지금 방식(파일 따로) vs 장면 팩(덩이 받으며 풀기)을 같은 브라우저에서 번갈아 3번씩 잰다.
 *   「인터넷 모의」는 이 서버가 전체 대역폭·지연을 흉내 낸다(연결 여러 개가 대역폭을 나눠 씀 — 실제 회선처럼).
 *
 * 준비: 팩이 있어야 한다 — node tools/scene-pack/build-pack.mjs --id <id> --out .packs/<id>.wgp --root public/_sf_local --list <목록.json>
 *   (securePack.js 는 naju01/src/loaders/securePack.ts 를 JS 로 옮긴 사본 — ts 를 고치면 다시 만들 것: npx esbuild naju01/src/loaders/securePack.ts --format=esm --outfile=tools/scene-pack/bench/securePack.js)
 * 실행: node tools/scene-pack/bench/serve.mjs <팩 id>  → 브라우저로 http://localhost:5190 열기
 * 이 컴퓨터에서 온 요청만 받는다. 팩 열쇠는 .pack-keys.json 에서 읽는다(시험용 — 배포본은 백엔드가 줌).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const id = process.argv[2];
if (!id) { console.error("사용: node tools/scene-pack/bench/serve.mjs <팩 id>"); process.exit(2); }
const keys = JSON.parse(fs.readFileSync(path.join(ROOT, ".pack-keys.json"), "utf8"));
if (!keys[id]) { console.error(`.pack-keys.json 에 ${id} 가 없습니다`); process.exit(2); }

// 비교용 파일 목록 — 팩의 덩이 0(목록)을 열쇠로 풀어 얻는다(목록 파일을 따로 두지 않음)
import crypto from "node:crypto";
const packFile = path.join(ROOT, ".packs", path.basename(keys[id].file));
const packBuf = fs.readFileSync(packFile);
const hl = packBuf.readUInt32LE(4);
const head = JSON.parse(packBuf.subarray(8, 8 + hl).toString("utf8"));
const c0 = packBuf.subarray(8 + hl, 8 + hl + head.chunks[0].size);
const dec = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keys[id].key, "base64"), Buffer.from(head.chunks[0].iv, "base64"));
dec.setAuthTag(c0.subarray(c0.length - 16));
const fileList = JSON.parse(Buffer.concat([dec.update(c0.subarray(0, c0.length - 16)), dec.final()]).toString("utf8")).map((e) => e.name);

// 전체 대역폭 공유 — 모의 조건(지연 ms, bps). 0 이면 제한 없음
let sim = { latency: 0, bps: 0 };
let budget = 0; let last = Date.now();
const take = async (n) => {
  if (!sim.bps) return;
  for (;;) {
    const now = Date.now(); budget = Math.min(sim.bps / 8 * 0.05, budget + (now - last) / 1000 * sim.bps / 8); last = now;
    if (budget >= n) { budget -= n; return; }
    await new Promise((r) => setTimeout(r, 5));
  }
};
const sendFile = async (res, file, type) => {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  if (sim.latency) await new Promise((r) => setTimeout(r, sim.latency));
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": fs.statSync(file).size });
  const s = fs.createReadStream(file, { highWaterMark: 16 * 1024 });
  for await (const chunk of s) { await take(chunk.length); if (!res.write(chunk)) await new Promise((r) => res.once("drain", r)); }
  res.end();
};
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json" };

http.createServer(async (req, res) => {
  if (!/^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || "")) { res.writeHead(403); return res.end(); }
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const q = new URL(req.url, "http://x").searchParams;
  if (url === "/sim") { sim = { latency: Number(q.get("latency") || 0), bps: Number(q.get("bps") || 0) }; budget = 0; res.writeHead(200); return res.end("ok"); }
  if (url === "/" || url === "/bench.html") return sendFile(res, path.join(HERE, "bench.html"), "text/html");
  if (url === "/securePack.js") return sendFile(res, path.join(HERE, "securePack.js"), "text/javascript");
  if (url === "/files.json") { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify(fileList)); }
  if (url === "/key") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ key: keys[id].key })); }
  if (url === "/pack") return sendFile(res, packFile, "application/octet-stream");
  if (url.startsWith("/assets/")) return sendFile(res, path.join(ROOT, "public/_sf_local", path.normalize(url.slice(8)).replace(/^(\.\.[/\\])+/, "")), "application/octet-stream");
  if (url.startsWith("/three/")) return sendFile(res, path.join(ROOT, "node_modules/three", path.normalize(url.slice(7)).replace(/^(\.\.[/\\])+/, "")), TYPES[path.extname(url)] || "application/octet-stream");
  res.writeHead(404); res.end();
}).listen(5190, "127.0.0.1", () => console.log(`장면 팩 비교: http://localhost:5190  (팩 ${id})`));
