#!/usr/bin/env node
/**
 * 배포본이 실제로 읽는 public/ 파일 목록 — CDN 업로드·라이선스 확인용.
 *   근거 두 가지: ① 나주 manifest(_sf_local/manifest.json) ② 코드 안 주소 문자열(src · naju01/src · shared · index.html)
 *   구분: 케이스(_sf_local → /c/<케이스>/<판>/…) · 공용(models → /shared/<빌드 번호>/…) · 배포본(그 밖, 사이트에 남음)
 *   GLB 표지(asset.extras)의 라이선스·저자·출처를 같이 적는다.
 *
 *   실행: npm run assets:list [-- --out 폴더] [-- --case-path /c/naju-angam-01/v1]
 *   결과: <폴더>/asset-list.csv (엑셀용 BOM) · asset-list.json. 기본 폴더 .local/asset-list
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedAssetBuild } from "./shared-asset-build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = join(ROOT, arg("--out", ".local/asset-list"));
const CASE_PATH = arg("--case-path", "/c/naju-angam-01/v1");
const SHARED_PATH = `/shared/${sharedAssetBuild()}`;

// 배포본에 넣지 않는 폴더(dropLocalOnlyPlugin) — 목록에서도 뺀다
const LOCAL_ONLY = ["_aihub_local"];
const SOURCE_DIRS = ["src", "naju01/src", "shared"];
const SOURCE_FILES = ["index.html", "naju01/index.html"];
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|css|html)$/;
const ASSET_EXT =
  /\.(glb|gltf|bin|ktx2|png|jpe?g|webp|avif|svg|mp3|ogg|wav|m4a|mp4|webm|json|woff2?|ttf|otf|wasm|js)$/i;

const toPosix = (path) => path.split(sep).join("/");
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// ── public 파일 전체 ──
const publicFiles = new Map(); // public 기준 경로 → 바이트
for (const path of walk(PUBLIC)) {
  const rel = toPosix(relative(PUBLIC, path));
  if (LOCAL_ONLY.some((dir) => rel.startsWith(`${dir}/`))) continue;
  publicFiles.set(rel, statSync(path).size);
}
const kindOf = (rel) => (rel.startsWith("_sf_local/") ? "케이스" : rel.startsWith("models/") ? "공용" : "배포본");

/** 경로 → 근거 목록 */
const refs = new Map();
const missing = new Map(); // 코드·manifest 가 가리키는데 public 에 없는 것 → 근거
function addRef(rel, reason) {
  if (!publicFiles.has(rel)) {
    if (!missing.has(rel)) missing.set(rel, new Set());
    missing.get(rel).add(reason);
    return false;
  }
  if (!refs.has(rel)) refs.set(rel, new Set());
  refs.get(rel).add(reason);
  return true;
}

// ── ① 나주 manifest ──
const SF = "_sf_local/";
const manifestPath = join(PUBLIC, SF, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const readJson = (rel) => (existsSync(join(PUBLIC, rel)) ? JSON.parse(readFileSync(join(PUBLIC, rel), "utf8")) : null);
addRef(`${SF}manifest.json`, "manifest");

const entryFiles = (entry) => [
  ...(entry.files ?? (entry.file ? [entry.file] : [])),
  ...(entry.원경files ?? []),
  ...(entry.원경file ? [entry.원경file] : []),
];
const groups = [
  ["바꿔치기", manifest.바꿔치기 ?? [], false],
  ["덮기", manifest.덮기 ?? [], true],
  ["놓기", manifest.놓기 ?? [], false],
];
// 변환판(&애니판 주소에서만) — publicAssetManifest.ts 의 animePath · animeCoverPath 와 같은 규칙
const animeBake = new Set(readJson(`${SF}anime_bake/목록.json`) ?? []);
const anime = new Set(readJson(`${SF}anime/목록.json`) ?? []);
const substitutes = readJson(`${SF}anime/대체.json`) ?? {};
for (const rel of ["anime_bake/목록.json", "anime/목록.json", "anime/대체.json"]) addRef(SF + rel, "애니판 목록");

for (const [group, entries, forCover] of groups) {
  for (const entry of entries) {
    const animeOnly = group === "놓기" && entry.애니판;
    for (const file of entryFiles(entry)) {
      addRef(SF + file, animeOnly ? `manifest ${group}(애니판 전용)` : `manifest ${group}`);
      const sub = substitutes[file];
      const variants = [];
      if (sub?.일반) variants.push(`anime/${sub.일반}`);
      if (forCover && sub?.덮기) variants.push(`anime/${sub.덮기}`);
      if (!sub?.일반 && animeBake.has(file)) variants.push(`anime_bake/${file}`);
      if (forCover && !sub?.덮기 && animeBake.has(file)) variants.push(`anime_bake/덮기/${file}`);
      if (!sub?.일반 && !animeBake.has(file) && anime.has(file)) variants.push(`anime/${file}`);
      for (const variant of variants) addRef(SF + variant, `애니판 ${group}`);
    }
  }
}

// ── ② 코드 안 주소 ──
const sourceFiles = [
  ...SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir))).filter((path) => SOURCE_EXT.test(path)),
  ...SOURCE_FILES.map((file) => join(ROOT, file)).filter(existsSync),
];
const topDirs = new Set([...publicFiles.keys()].map((rel) => rel.split("/")[0]));
const STRING = /(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1|url\(\s*([^)"'\s]+)\s*\)/g;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const codeWarnings = [];

// 폴더 상수(`"/transitions/"` · `"/thumbs/character-creation"`) — 파일 이름을 붙여 주소를 만드는 곳이 있다.
// 먼저 모아 두고, 이름만 있는 문자열과 `${폴더}/…` 템플릿을 이 폴더들 아래에서도 찾는다
const publicDirs = new Set(
  [...publicFiles.keys()].flatMap((rel) => {
    const parts = rel.split("/");
    return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
  }),
);
const STRING_LITERALS = /(["'`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
const sourceTexts = new Map(sourceFiles.map((path) => [path, readFileSync(path, "utf8")]));
const folderConstants = new Set();
for (const text of sourceTexts.values())
  for (const match of text.matchAll(STRING_LITERALS)) {
    const literal = match[2].replace(/^\$\{import\.meta\.env\.BASE_URL\}/, "/");
    const dir = literal.replace(/^\//, "").replace(/\/$/, "");
    if (literal.startsWith("/") && publicDirs.has(dir)) folderConstants.add(dir);
  }
const templateRe = (template) =>
  template
    .split(/\$\{[^}]*\}/)
    .map(escapeRe)
    .join("[^/]*");

/** 문자열 하나 → 가리키는 public 경로들 */
function resolveString(raw) {
  // `${import.meta.env.BASE_URL}fonts/…` 는 배포본에서 "/fonts/…" 다(base "/")
  const value = raw.replace(/\$\{import\.meta\.env\.BASE_URL\}/g, "/").split(/[?#]/)[0];
  if (!value || value.length > 300) return [];
  // `url(/fonts/a.woff2)` 처럼 문자열 가운데 든 주소 — `../models/…` 같은 소스 import 는 번들에 들어가므로 뺀다
  if (!value.startsWith("/") && !value.startsWith("${") && !value.startsWith("."))
    for (const match of value.matchAll(/(?<=[(\s=,])\/([\w-]+)\/[^\s"'`()]+/g))
      if (topDirs.has(match[1])) return resolveString(match[0]);
  if (value.startsWith("${") && value.includes("}")) {
    // `${폴더}/${name}.png` — 폴더 상수 아래에서 찾는다. 고정 글자(확장자 등)가 없으면 뺀다
    const tail = value.slice(value.indexOf("}") + 1).replace(/^\//, "");
    if (!tail.replace(/\$\{[^}]*\}/g, "") || !ASSET_EXT.test(tail)) return [];
    const patterns = [...folderConstants].map((dir) => new RegExp(`^${escapeRe(dir)}/${templateRe(tail)}$`));
    return [...publicFiles.keys()].filter((rel) => patterns.some((pattern) => pattern.test(rel)));
  }
  if (value.includes("${")) {
    // 템플릿 — `/models/shoes-${a}-${b}.glb` 처럼 고정 글자가 남는 것만 본다(`/_sf_local/${x}` 는 통로라 뺀다)
    if (!value.startsWith("/")) return [];
    const [top, ...rest] = value.slice(1).split("/");
    const tail = rest.join("/");
    if (!topDirs.has(top) || !tail.replace(/\$\{[^}]*\}/g, "")) return [];
    if (/^\$\{[^}]*\}$/.test(tail)) return [];
    const pattern = new RegExp(`^${escapeRe(top)}/${templateRe(tail)}$`);
    return [...publicFiles.keys()].filter((rel) => pattern.test(rel));
  }
  if (value.startsWith("/")) {
    const rel = value.slice(1).replace(/\/$/, "");
    if (publicDirs.has(rel)) return []; // 폴더 상수는 위에서 따로 쓴다
    return topDirs.has(rel.split("/")[0]) || publicFiles.has(rel) ? [rel] : [];
  }
  // 상대 경로(manifest 이름·codeprops/… 처럼 _sf_local 아래를 가리키는 것)
  if (!ASSET_EXT.test(value) || value.includes(" ") || value.startsWith(".")) return [];
  return [value, SF + value, ...[...folderConstants].map((dir) => `${dir}/${value}`)].filter((rel) =>
    publicFiles.has(rel),
  );
}

for (const [path, text] of sourceTexts) {
  const file = toPosix(relative(ROOT, path));
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(STRING)) {
      const raw = match[2] ?? match[3];
      if (!raw) continue;
      const rels = resolveString(raw);
      const isPathLike = raw.startsWith("/") && !raw.includes("${") && ASSET_EXT.test(raw.split(/[?#]/)[0]);
      if (
        !rels.length &&
        isPathLike &&
        topDirs.has(raw.slice(1).split("/")[0]) &&
        !publicDirs.has(raw.slice(1).split(/[?#]/)[0])
      )
        addRef(raw.slice(1).split(/[?#]/)[0], `${file}:${index + 1}`);
      for (const rel of rels) {
        addRef(rel, `${file}:${index + 1}`);
        // CDN 으로 가는 파일은 주소 함수를 거쳐야 한다 — 파일 안에 그 함수가 안 보이면 적어 둔다
        const kind = kindOf(rel);
        const fn = kind === "케이스" ? /\b(assetUrl|publicAssetUrl)\(/ : kind === "공용" ? /\bsharedAssetUrl\(/ : null;
        if (fn && !fn.test(text))
          codeWarnings.push(`${file}:${index + 1} ${rel} — ${kind} 파일인데 주소 함수가 안 보인다`);
      }
    }
  });
}

// 라이브러리가 폴더 주소에 파일 이름을 직접 붙이는 폴더 — 통째로 쓴다
const WHOLE_FOLDERS = { basis: "KTX2 해독기 폴더(three 가 파일 이름을 붙인다)" };
for (const [dir, reason] of Object.entries(WHOLE_FOLDERS))
  if (folderConstants.has(dir))
    for (const rel of publicFiles.keys()) if (rel.startsWith(`${dir}/`)) addRef(rel, reason);

// ── GLB · glTF 가 따로 부르는 파일(외부 buffer · image) ──
function gltfJson(rel) {
  const path = join(PUBLIC, rel);
  try {
    if (rel.endsWith(".gltf")) return JSON.parse(readFileSync(path, "utf8"));
    const bytes = readFileSync(path);
    if (bytes.toString("ascii", 0, 4) !== "glTF") return null;
    return JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  } catch {
    return null;
  }
}
const meta = new Map();
for (const rel of [...refs.keys()]) {
  if (!/\.(glb|gltf)$/i.test(rel)) continue;
  const json = gltfJson(rel);
  if (!json) continue;
  meta.set(rel, json.asset?.extras ?? {});
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (item.uri && !item.uri.startsWith("data:"))
      addRef(posix.normalize(posix.join(posix.dirname(rel), decodeURIComponent(item.uri))), `${rel} 안에서 부름`);
  }
}

// ── 결과 ──
const cdnPath = (rel) => {
  const kind = kindOf(rel);
  return kind === "케이스" ? `${CASE_PATH}/${rel}` : kind === "공용" ? `${SHARED_PATH}/${rel}` : `(배포본) /${rel}`;
};
const rows = [...refs.entries()]
  .map(([rel, reasons]) => {
    const extras = meta.get(rel) ?? {};
    return {
      구분: kindOf(rel),
      경로: `public/${rel}`,
      CDN경로: cdnPath(rel),
      바이트: publicFiles.get(rel),
      라이선스: extras.license ?? "",
      저자: extras.author ?? "",
      출처: extras.source ?? "",
      제목: extras.title ?? "",
      근거: [...reasons].sort().join(" | "),
    };
  })
  .sort((a, b) => a.구분.localeCompare(b.구분) || a.경로.localeCompare(b.경로));

mkdirSync(OUT, { recursive: true });
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const columns = Object.keys(rows[0]);
writeFileSync(
  join(OUT, "asset-list.csv"),
  "﻿" + [columns.join(","), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\n") + "\n",
);
const totals = {};
for (const [rel, size] of publicFiles) {
  const kind = kindOf(rel);
  totals[kind] ??= { 참조: 0, 참조바이트: 0, 안씀: 0, 안씀바이트: 0 };
  if (refs.has(rel)) {
    totals[kind].참조++;
    totals[kind].참조바이트 += size;
  } else {
    totals[kind].안씀++;
    totals[kind].안씀바이트 += size;
  }
}
const unknownLicense = rows.filter((row) => row.구분 !== "배포본" && /\.(glb|gltf)$/i.test(row.경로) && !row.라이선스);
writeFileSync(
  join(OUT, "asset-list.json"),
  JSON.stringify(
    {
      만든때: new Date().toISOString(),
      케이스경로: CASE_PATH,
      공용경로: SHARED_PATH,
      합계: totals,
      manifest팩: manifest.팩 ?? [],
      파일: rows,
      없는파일: Object.fromEntries([...missing].map(([rel, reasons]) => [rel, [...reasons]])),
      주소함수확인: codeWarnings,
    },
    null,
    2,
  ),
);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
console.log(`케이스 경로 ${CASE_PATH} · 공용 경로 ${SHARED_PATH}`);
for (const [kind, total] of Object.entries(totals))
  console.log(
    `${kind}: 읽는 파일 ${total.참조}개 ${mb(total.참조바이트)} · 안 읽는 파일 ${total.안씀}개 ${mb(total.안씀바이트)}`,
  );
console.log(`라이선스 표지 없는 모형 ${unknownLicense.length}개`);
if (manifest.팩?.length)
  console.log(`manifest 팩 ${manifest.팩.join(", ")} — 팩 파일은 public 밖(.packs)이라 목록에 없다`);
if (missing.size) {
  console.log(`가리키는데 public 에 없는 파일 ${missing.size}개:`);
  for (const [rel, reasons] of missing) console.log(`  ${rel} ← ${[...reasons].slice(0, 3).join(", ")}`);
}
if (codeWarnings.length) {
  console.log(`주소 함수 확인 ${codeWarnings.length}건:`);
  for (const warning of codeWarnings) console.log(`  ${warning}`);
}
console.log(`→ ${toPosix(relative(ROOT, OUT))}/asset-list.csv · asset-list.json`);
