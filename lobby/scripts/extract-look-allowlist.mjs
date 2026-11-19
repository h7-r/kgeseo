// 외형(look) 서버 검사용 허용 목록을 naju01 원본에서 뽑는다.
//   node scripts/extract-look-allowlist.mjs           → src/generated/lookAllowlist.json 을 다시 쓴다
//   node scripts/extract-look-allowlist.mjs --check   → 다시 쓰지 않고 원본과 다르면 실패(종료 코드 1)
//
// 원본(DEFAULT_CATALOG · BODY_FIELDS)은 @/config/env → import.meta.env 를 끌고 와 Node 에서 바로 못 읽는다.
// 저장소 루트의 Vite 로 SSR 모듈을 불러 읽는다. 로비 서버는 실행 때 이 JSON 만 읽는다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outPath = resolve(here, "../src/generated/lookAllowlist.json");

export async function extractAllowlist() {
  const require = createRequire(resolve(repoRoot, "package.json"));
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const server = await createServer({
    configFile: false,
    root: repoRoot,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { "@": resolve(repoRoot, "src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const catalogModule = await server.ssrLoadModule("/naju01/src/characterCreation/catalog.ts");
    const appearanceModule = await server.ssrLoadModule("/naju01/src/characterCreation/appearanceData.ts");
    const { DEFAULT_CATALOG, isKnownVariant } = catalogModule;
    const { BODY_FIELDS } = appearanceModule;
    const genders = ["masculine", "feminine"];
    const slots = ["hair", "top", "bottom", "shoes"];
    // 캐릭터 생성 화면(normalizeAppearance)과 같은 조건: 그 슬롯·그 성별에 있고 렌더러가 아는 파츠 번호
    const items = Object.fromEntries(
      slots.map((slot) => [
        slot,
        Object.fromEntries(
          genders.map((gender) => [
            gender,
            DEFAULT_CATALOG.items
              .filter((item) => item.slot === slot && item.genders.includes(gender) && isKnownVariant(slot, gender, item.variant))
              .map((item) => item.id)
              .sort(),
          ]),
        ),
      ]),
    );
    return {
      catalogVersion: DEFAULT_CATALOG.version,
      genders,
      items,
      colorKeys: Object.keys(DEFAULT_CATALOG.palettes).sort(),
      bodyFields: BODY_FIELDS.map((field) => ({ key: field.key, min: field.min, max: field.max })).sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
    };
  } finally {
    await server.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const allowlist = await extractAllowlist();
  const text = `${JSON.stringify(allowlist, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.error("✖ src/generated/lookAllowlist.json 이 naju01 원본과 다르다 — npm run extract-look 으로 다시 뽑는다");
      process.exit(1);
    }
    console.log("✔ 외형 허용 목록이 원본과 같다");
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    console.log(`✔ ${outPath}`);
  }
}
