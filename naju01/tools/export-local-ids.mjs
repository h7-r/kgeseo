// 게시 게이트 LOCAL_IDS 용 나주 로컬 ID 목록을 실제 나주 화면에서 뽑는다.
//
// 배치 키(`<무리>#<번호>`)는 생성기가 지형 · 장면 · 손 편집을 보고 실행 중에 정한다 — 코드만 읽어서는 개수를 알 수 없다.
// 그래서 나주를 띄워 실제로 그려진 인스턴스 번호를 읽는다(`__game.naju.localIds()` → src/placement/localIds.ts).
// Zone · 길 · 차단물 · 장면은 도면 상수(src/plan/sitePlan.ts)의 값 그대로다.
//
// 쓰는 법 (나주 개발 서버가 떠 있어야 한다 — 예: npx vite naju01)
//   node naju01/tools/export-local-ids.mjs [주소] --out <local-ids.json> [--report <report.json>]
//     --out     게시 CLI `scripts.publish_case_content --local-ids` · `scripts.check_idmap_local_ids` 에 넘길 파일
//     --report  출처 · 무리별 개수 · 상호작용 id(참고) · 정적으로 확인하지 못한 id 보고
//     --channel 설치된 브라우저로 띄운다(예: msedge · chrome) — Playwright 브라우저를 받지 않은 PC
// 번호 충돌 · 빈 종류가 있으면 파일을 쓰지 않고 2 로 끝난다(목록을 믿을 수 없다 — fail closed).
// 편집 파일은 읽기만 한다 — 저장 요청은 막는다.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { logPageErrors, openHeadless, startGame, waitForBakedGround } from "./headlessPage.mjs";

const KINDS = ["zones", "navigation", "blockers", "objects", "scenes"];
// 구운 지형이 늦게 도착하면 자리가 한 번 더 바뀐다 — 값이 이만큼 그대로일 때까지 기다린다(check-edit-anchors 와 같다)
const STABLE_MS = 10000;
const TIMEOUT_MS = 240000;
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function parseArgs(argv) {
  const options = { url: "http://localhost:5174/", out: null, report: null, channel: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--report" || arg === "--channel") {
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
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value === "")) {
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
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "naju01"], { cwd: REPO, encoding: "utf8" }).trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return null;
  }
}

async function readFromGame(url, channel) {
  const { browser, page } = await openHeadless({ width: 960, height: 600 }, [], channel ? { channel } : {});
  logPageErrors(page);
  await page.route("**/__naju-edit*", (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort(),
  );
  try {
    await startGame(page, url);
    await waitForBakedGround(page, 30);
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
      } else if (current && Date.now() - stableSince >= STABLE_MS) return current;
      await page.waitForTimeout(1000);
    }
    return current ? { ...current, unstable: true } : null;
  } finally {
    await browser.close();
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exit(1);
  }
  const current = await readFromGame(options.url, options.channel);
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
    const report = {
      schema: "naju-local-ids-report/0.1",
      fe_commit: feCommit(),
      url: options.url,
      source: {
        zones: "src/plan/sitePlan.ts ZONES[].code",
        navigation: "src/plan/sitePlan.ts PATHS[].code",
        blockers: "src/plan/sitePlan.ts BLOCKERS[].code",
        scenes: "src/plan/sitePlan.ts SCENE_TITLES 열쇠",
        objects: "실행 중 InstanceGroup.batches[].ids — 손 편집(edits.json)을 얹은 뒤의 번호",
      },
      counts,
      object_counts: objectCounts,
      coverage: [
        "objects 는 이 주소 · 기본 설정(?쿼리 없음)으로 그린 무리만이다. 주소 스위치(?aihub · &base=empty 등)나 손 편집이 바뀌면 다시 뽑는다.",
        "registerInteractable id 는 idmap objects[].local 형식(배치 키)이 아니라 local-ids 에 넣지 않는다 — 아래는 참고다.",
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
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
