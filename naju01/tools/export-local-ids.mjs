// 게시 게이트 LOCAL_IDS 용 나주 로컬 ID 목록을 실제 나주 화면에서 뽑는다.
//
// 배치 키(`<무리>#<번호>`)는 생성기가 지형 · 장면 · 손 편집을 보고 실행 중에 정한다 — 코드만 읽어서는 개수를 알 수 없다.
// 그래서 나주를 띄워 실제로 그려진 인스턴스 번호를 읽는다(`__game.naju.localIds()` → src/placement/localIds.ts).
// Zone · 길 · 차단물 · 장면은 도면 상수(src/plan/sitePlan.ts)의 값 그대로다.
// 진행 동기화 대응표(src/progress/najuIdTable.ts)의 왼쪽 열(cave-hall · clam-holes 등)도 들어간다 — 퍼즐 코드가 서버로 보내는 이름이다.
// 보고서의 progress_table 은 그 이름마다 게임 안에 실제로 받쳐 주는 것(도면 구역 · 퍼즐 코드가 보내는 값 · 상호작용 대상)이
// 있는지 적는다. 받쳐 주는 것이 없는 이름은 콘텐츠 쪽에서 고쳐야 한다.
//
// 쓰는 법 (나주 개발 서버가 떠 있어야 한다 — 예: npx vite naju01)
//   node naju01/tools/export-local-ids.mjs [주소] --out <local-ids.json> [--report <report.json>]
//     --out     게시 CLI `scripts.publish_case_content --local-ids` · `scripts.check_idmap_local_ids` 에 넘길 파일
//     --report  출처 · 무리별 개수 · 상호작용 id(참고) · 정적으로 확인하지 못한 id 보고
//     --channel 설치된 브라우저로 띄운다(예: msedge · chrome) — Playwright 브라우저를 받지 않은 PC
// 번호 충돌 · 빈 종류가 있으면 파일을 쓰지 않고 2 로 끝난다(목록을 믿을 수 없다 — fail closed).
// 편집 파일은 읽기만 한다 — 저장 요청은 막는다.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { NAJU_ID_TABLE_V1 } from "../src/progress/najuIdTable.ts";
import { NAJU_LOCAL } from "../src/progress/najuLocalIds.ts";
import { captureCanvas, logPageErrors, openHeadless, startGame, waitForBakedGround } from "./headlessPage.mjs";

const KINDS = ["zones", "navigation", "blockers", "objects", "scenes"];
// 구운 지형이 늦게 도착하면 자리가 한 번 더 바뀐다 — 값이 이만큼 그대로일 때까지 기다린다(check-edit-anchors 와 같다)
const STABLE_MS = 10000;
const TIMEOUT_MS = 240000;
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function parseArgs(argv) {
  const options = { url: "http://localhost:5174/", out: null, report: null, channel: null, screenshot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--report" || arg === "--channel" || arg === "--screenshot") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 에 값이 필요하다`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) throw new Error(`모르는 옵션: ${arg}`);
    else options.url = arg;
  }
  if (!options.out) throw new Error("--out 이 필요하다");
  return options;
}

/** 게이트가 받는 모양인지 — 다섯 종류 · 문자열 목록 · 중복 없음 · 빈 종류 없음 */
export function validateList(list) {
  const problems = [];
  if (!list || typeof list !== "object") return ["list:not_object"];
  const extra = Object.keys(list).filter((key) => !KINDS.includes(key));
  if (extra.length) problems.push(`list:unknown_kinds:${extra.join(",")}`);
  for (const kind of KINDS) {
    const values = list[kind];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.trim() === "")) {
      problems.push(`${kind}:not_string_list`);
      continue;
    }
    if (values.length === 0) problems.push(`${kind}:none`);
    if (new Set(values).size !== values.length) problems.push(`${kind}:duplicate`);
  }
  return problems;
}

// ── 정적 보고: registerInteractable 의 id(코드로 만든 물건) ──
const REGISTER = /registerInteractable\(/g;
const ID_VALUE = /\bid:\s*(?:"([^"]+)"|`([^`]+)`)/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** `registerInteractable({ id })`의 id 를 소스에서 모은다. 템플릿(`${...}`)은 실행 중에만 확정된다 */
export function staticInteractableIds(sources) {
  const found = [];
  for (const [file, text] of sources) {
    for (const match of text.matchAll(REGISTER)) {
      // 함수 정의(`export function registerInteractable(`)는 부르는 곳이 아니다
      if (/function\s+$/.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
      const window = text.slice(match.index, match.index + 800);
      const id = window.match(ID_VALUE);
      if (!id) {
        found.push({ file, id: null, dynamic: true });
        continue;
      }
      const value = id[1] ?? id[2];
      found.push({ file, id: value, dynamic: /\$\{/.test(value) });
    }
  }
  return found;
}

/**
 * 대표 물건 하나가 묶는 상호작용 대상 — 여럿을 한 물건으로 세는 것만 적는다(najuLocalIds 의 설명과 같다).
 * 나머지 대표 물건은 상호작용 id 와 이름이 같다.
 */
const GROUPED_TARGETS = { "clam-holes": "clam-hole-", "jar-slots": "jar-slot-" };

/**
 * 대응표 이름마다 게임 안의 받침을 찾는다.
 *   zones   — 도면 구역(siteZones)이거나 퍼즐 코드가 보내는 구역(sentZones)
 *   objects — 상호작용 대상(소스의 registerInteractable · 실행 중 등록). 묶음 물건은 그 이름으로 시작하는 대상
 * 받침이 하나도 없으면 missing 에 넣는다.
 */
export function progressCoverage({ table, siteZones, sentZones, sentObjects, staticIds, runtimeIds }) {
  const zones = Object.entries(table.zones).map(([local, runtime]) => {
    const backing = [];
    if (siteZones.includes(local)) backing.push("도면 구역(sitePlan ZONES)");
    if (sentZones.includes(local)) backing.push("퍼즐 코드가 보내는 구역(NAJU_LOCAL.zones)");
    return { local, runtime, backing };
  });
  const objects = Object.entries(table.objects).map(([local, runtime]) => {
    const prefix = GROUPED_TARGETS[local];
    const matches = (id) => (prefix ? id.startsWith(prefix) : id === local);
    const staticHits = staticIds.filter((item) => {
      if (item.id === null) return false;
      if (!item.dynamic) return matches(item.id);
      return prefix ? item.id.startsWith(prefix) : templatePattern(item.id).test(local);
    });
    const runtimeHits = runtimeIds.filter(matches);
    const backing = [];
    if (sentObjects.includes(local)) backing.push("퍼즐 코드가 보내는 물건(NAJU_LOCAL.objects)");
    if (staticHits.length) backing.push(`상호작용 대상(${[...new Set(staticHits.map((item) => item.file))].join(" · ")})`);
    return {
      local,
      runtime,
      targets: prefix ? `${prefix}*` : local,
      backing,
      registered_at_load: runtimeHits,
    };
  });
  const missing = [...zones, ...objects].filter((item) => item.backing.length === 0).map((item) => item.local);
  return { zones, objects, missing };
}

const templatePattern = (template) =>
  new RegExp(`^${template.split(/\$\{[^}]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`);

/** 실행 중 등록된 id 와 정적 id 를 맞춰 본다 — 어느 쪽에만 있는 것은 확인 범위 밖이다 */
export function compareInteractables(staticIds, runtimeIds) {
  const unmatchedRuntime = new Set(runtimeIds);
  const notSeen = [];
  for (const item of staticIds) {
    if (item.id === null) {
      notSeen.push({ file: item.file, id: null, reason: "id 를 소스에서 읽지 못함(변수 · 함수)" });
      continue;
    }
    const pattern = item.dynamic ? templatePattern(item.id) : null;
    const matched = runtimeIds.filter((id) => (pattern ? pattern.test(id) : id === item.id));
    for (const id of matched) unmatchedRuntime.delete(id);
    if (!matched.length) notSeen.push({ file: item.file, id: item.id, reason: "실행 중 등록되지 않음(조건부 · 단계별 등록)" });
  }
  return { notSeen, runtimeOnly: [...unmatchedRuntime].sort() };
}

function feCommit() {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "naju01"], { cwd: REPO, encoding: "utf8" }).trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return null;
  }
}

function inputHashes() {
  const paths = [
    "naju01/assets/edits.json", "naju01/assets/edit-anchors.json",
    "naju01/src/plan/sitePlan.ts", "naju01/src/placement/localIds.ts",
    "naju01/src/scene/useNajuDevTools.ts", "naju01/tools/export-local-ids.mjs",
    "naju01/src/progress/najuIdTable.ts", "naju01/src/progress/najuLocalIds.ts",
    "naju01/tools/headlessPage.mjs",
  ];
  return Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(readFileSync(join(REPO, path))).digest("hex")]));
}

async function readFromGame(url, channel, screenshot) {
  const { browser, page } = await openHeadless({ width: 960, height: 600 }, [], channel ? { channel } : {});
  logPageErrors(page);
  page.setDefaultNavigationTimeout(180000); // Vite cold dependency optimization can exceed 30 s.
  const origin = new URL(url).origin;
  const blockedRequests = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (request.method() !== "GET" || target.origin !== origin || /^\/api(?:\/|$)/.test(target.pathname)) {
      blockedRequests.push({ method: request.method(), path: target.pathname });
      return route.abort();
    }
    return route.continue();
  });
  try {
    await startGame(page, url);
    await waitForBakedGround(page, 30);
    const runtime = await page.evaluate(() => {
      const ground = window.__game?.naju?.scene?.getObjectByName("ground");
      return {
        effective_url: location.href,
        viewport: { width: innerWidth, height: innerHeight },
        device_pixel_ratio: devicePixelRatio,
        renderer_pixel_ratio: window.__game?.naju?.gl?.getPixelRatio(),
        canvas: { width: window.__game?.naju?.gl?.domElement.width, height: window.__game?.naju?.gl?.domElement.height },
        baked_ground_triangles: (ground?.geometry?.index?.count ?? 0) / 3,
      };
    });
    if (runtime.baked_ground_triangles !== 128000) throw new Error("baked ground not ready; refusing export");
    const read = () =>
      page.evaluate(() => {
        const naju = window.__game?.naju;
        if (!naju?.localIds) return null;
        return { result: naju.localIds(), interactables: naju.interactableIds() };
      });
    let current = null;
    let lastText = "";
    let stableSince = Date.now();
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUT_MS) {
      current = await read();
      const text = JSON.stringify(current?.result ?? null);
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      } else if (current && Date.now() - stableSince >= STABLE_MS) {
        if (screenshot && !(await captureCanvas(page, screenshot))) throw new Error("scene capture failed");
        return { ...current, runtime, blockedRequests };
      }
      await page.waitForTimeout(1000);
    }
    return current ? { ...current, unstable: true } : null;
  } finally {
    await browser.close();
  }
}

export function executionConditions(requestedUrl, runtime) {
  const effectiveUrl = runtime?.effective_url ?? requestedUrl;
  return {
    requested_url: requestedUrl,
    requested_query: Object.fromEntries(new URL(requestedUrl).searchParams),
    effective_url: effectiveUrl,
    query: Object.fromEntries(new URL(effectiveUrl).searchParams),
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  }
  const current = await readFromGame(options.url, options.channel, options.screenshot);
  if (!current) {
    console.error("✖ __game.naju.localIds 가 없다 — 나주 개발 서버 주소가 맞는지 보라");
    process.exit(2);
  }
  const { list, objectCounts, problems } = current.result;
  const allProblems = [...problems, ...validateList(list)];
  if (current.unstable) allProblems.push("list:not_stable_within_timeout");
  if (allProblems.length) {
    console.error("✖ 목록을 믿을 수 없어 쓰지 않는다:");
    for (const problem of allProblems) console.error(`  - ${problem}`);
    process.exit(2);
  }
  writeFileSync(options.out, JSON.stringify(list, null, 1) + "\n");
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, list[kind].length]));
  console.log(`로컬 ID 를 적었다 → ${options.out}`);
  console.log(`  ${KINDS.map((kind) => `${kind} ${counts[kind]}`).join(" · ")} (배치 무리 ${Object.keys(objectCounts).length}개)`);

  if (options.report) {
    const sources = sourceFiles(SRC).map((file) => [relative(SRC, file).replaceAll("\\", "/"), readFileSync(file, "utf8")]);
    const staticIds = staticInteractableIds(sources);
    const comparison = compareInteractables(staticIds, current.interactables);
    const sitePlan = sources.find(([file]) => file === "plan/sitePlan.ts")?.[1] ?? "";
    const coverage = progressCoverage({
      table: NAJU_ID_TABLE_V1,
      siteZones: [...sitePlan.matchAll(/\bcode:\s*"(Z\d+)"/g)].map((match) => match[1]),
      sentZones: Object.values(NAJU_LOCAL.zones),
      sentObjects: Object.values(NAJU_LOCAL.objects),
      staticIds,
      runtimeIds: current.interactables,
    });
    const report = {
      schema: "naju-local-ids-report/0.1",
      fe_commit: feCommit(),
      url: options.url,
      ...executionConditions(options.url, current.runtime),
      channel: options.channel ?? "playwright-chromium",
      runtime: current.runtime,
      blocked_requests: current.blockedRequests,
      input_sha256: inputHashes(),
      backend_content_version: null,
      source: {
        zones: "src/plan/sitePlan.ts ZONES[].code",
        navigation: "src/plan/sitePlan.ts PATHS[].code",
        blockers: "src/plan/sitePlan.ts BLOCKERS[].code",
        scenes: "src/plan/sitePlan.ts SCENE_TITLES 열쇠",
        objects: "실행 중 InstanceGroup.batches[].ids — 손 편집(edits.json)을 얹은 뒤의 번호",
        progress: "src/progress/najuIdTable.ts NAJU_ID_TABLE_V1 의 열쇠(zones · objects) — 도면 · 배치와 같은 이름은 한 번만",
      },
      progress_table: coverage,
      counts,
      object_counts: objectCounts,
      coverage: [
        "objects 는 보고된 URL·쿼리·입력 해시·초기 실행 상태에서 그린 무리만이다. 다른 옵션·편집·콘텐츠 버전에는 재사용하지 않고 다시 추출한다.",
        "registerInteractable id 는 idmap objects[].local 형식(배치 키)이 아니라 local-ids 에 넣지 않는다 — 아래는 초기 화면의 참고 자료다.",
        "정적 검색은 정규식 기반이며 초기 미등록·조건부·진행 단계별 ID 전체의 존재를 보장하지 않는다. backend 콘텐츠 버전과의 연결도 이 추출만으로 입증되지 않는다.",
      ],
      interactables: {
        runtime_registered: current.interactables,
        static_not_seen_at_load: comparison.notSeen,
        runtime_without_static_source: comparison.runtimeOnly,
      },
    };
    writeFileSync(options.report, JSON.stringify(report, null, 1) + "\n");
    console.log(`보고를 적었다 → ${options.report}`);
    console.log(
      `  상호작용 id: 실행 중 ${current.interactables.length}개 · 처음 화면에서 등록 안 된 정적 id ${comparison.notSeen.length}개`,
    );
    console.log(
      `  대응표 이름: 구역 ${coverage.zones.length} · 물건 ${coverage.objects.length} — 게임 안에 받침이 없는 것 ${
        coverage.missing.length ? coverage.missing.join(", ") : "없음"
      }`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
