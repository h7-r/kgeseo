/**
 * 크레딧(/credits) 데이터 — 국가유산청 소품은 CC BY 4.0 이라 하나도 빠짐없이 출처를 보여야 한다.
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCredits, serialize } from "./build-credits.mjs";

const generated = readFileSync(new URL("../../website/src/data/credits.generated.json", import.meta.url), "utf8");

test("화면에 싣는 크레딧 파일이 원본(소품 대장 · package.json)과 같다", () => {
  assert.equal(generated, serialize(buildCredits()), "node tools/website/build-credits.mjs 로 다시 만든다");
});

test("국가유산청 소품 105개가 모두 이름 · 원제 · Sketchfab 원본 주소를 가진다", () => {
  const { heritage } = buildCredits();
  assert.equal(heritage.length, 105);
  for (const item of heritage) {
    assert.ok(item.name && item.title, JSON.stringify(item));
    assert.match(item.url, /^https:\/\/sketchfab\.com\/3d-models\/[0-9a-f]{32}$/);
  }
  assert.equal(new Set(heritage.map((item) => item.url)).size, 105, "같은 원본이 두 번 실렸다");
});

test("오픈소스 · 글꼴은 라이선스를 빠짐없이 적는다", () => {
  const { openSource, fonts } = buildCredits();
  assert.ok(openSource.length > 0 && fonts.length > 0);
  for (const item of [...openSource, ...fonts]) assert.ok(item.license && item.url.startsWith("https://"), item.name);
});
