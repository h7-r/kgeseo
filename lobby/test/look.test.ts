// 외형 검사 — 설계 5절 + 미르 결정(색·체형). 허용 목록이 naju01 원본과 같은지도 본다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LOOK_MAX_BYTES, lookToStateString, replaceRetiredItem, validateLook } from "../src/look.js";
import { validLook } from "./helpers.js";

describe("외형 검사", () => {
  it("정상 외형은 색을 소문자로 맞춰 받는다", () => {
    const look = validateLook(validLook());
    assert.ok(look);
    assert.equal(look.colors.skin, "#f0d8c8");
    assert.ok(new TextEncoder().encode(lookToStateString(validLook())).length <= LOOK_MAX_BYTES);
  });
  const broken: [string, (look: ReturnType<typeof validLook>) => unknown][] = [
    ["객체가 아님", () => "look"],
    ["배열", () => []],
    ["카탈로그 버전이 다름", (l) => ({ ...l, catalog: "1999-01-01" })],
    ["모르는 성별", (l) => ({ ...l, gender: "other" })],
    ["그 성별에 없는 머리", (l) => ({ ...l, hair: "hair.m.crop" })],
    ["없는 아이템", (l) => ({ ...l, top: "top.hoodie" })],
    ["슬롯 null", (l) => ({ ...l, shoes: null })],
    ["필드 누락", (l) => ({ ...l, body: undefined })],
    ["모르는 최상위 키", (l) => ({ ...l, extra: 1 })],
    ["모르는 색 키", (l) => ({ ...l, colors: { ...l.colors, eyes: "#000000" } })],
    ["색 형식", (l) => ({ ...l, colors: { ...l.colors, skin: "red" } })],
    ["체형 범위 밖", (l) => ({ ...l, body: { ...l.body, heightScale: 5 } })],
    ["체형 숫자 문자열", (l) => ({ ...l, body: { ...l.body, heightScale: "1" } })],
    ["체형 모르는 키", (l) => ({ ...l, body: { ...l.body, wings: 1 } })],
    ["2KB 초과", (l) => ({ ...l, colors: { ...l.colors, skin: "#".padEnd(3000, "0") } })],
  ];
  for (const [name, mutate] of broken) {
    it(`${name} → 비운다`, () => {
      assert.equal(validateLook(mutate(validLook())), null);
      assert.equal(lookToStateString(mutate(validLook())), "");
    });
  }
});

describe("허용 목록이 naju01 원본과 같다", () => {
  it("scripts/extract-look-allowlist.mjs 결과 = src/generated/lookAllowlist.json", async () => {
    const { extractAllowlist } = (await import("../scripts/extract-look-allowlist.mjs")) as {
      extractAllowlist: () => Promise<unknown>;
    };
    const fresh = `${JSON.stringify(await extractAllowlist(), null, 2)}\n`;
    const committed = readFileSync(new URL("../src/generated/lookAllowlist.json", import.meta.url), "utf8");
    assert.equal(committed, fresh, "npm run extract-look 으로 다시 뽑는다");
  });

  it("없앤 긴 머리는 그 성별 기본 머리로 바꿔 받는다(허용 목록에서 빠진 뒤부터)", () => {
    // 지금 로비 브랜치 허용 목록에는 긴 머리가 아직 있다 — 합친 뒤의 목록을 흉내 낸다
    assert.equal(replaceRetiredItem("hair.f.long", ["hair.f.bob", "hair.buzz", "hair.none"]), "hair.f.bob");
    assert.equal(replaceRetiredItem("hair.m.long", ["hair.m.crop", "hair.buzz", "hair.none"]), "hair.m.crop");
    // 바꿀 머리가 그 성별 목록에 없으면(다른 성별 ID) 바꾸지 않는다 → 외형을 비운다
    assert.equal(replaceRetiredItem("hair.m.long", ["hair.f.bob"]), null);
    // 모르는 ID 는 그대로 거절
    assert.equal(replaceRetiredItem("top.hoodie", ["top.tee.white"]), null);
  });
});
