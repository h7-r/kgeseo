import assert from "node:assert/strict";
import test from "node:test";
import { apiOrigin, gameEntry } from "../../shared/deploymentUrls.ts";

test("same-origin API and exact production HTTPS origins", () => {
  assert.equal(apiOrigin(undefined, true), "");
  assert.equal(apiOrigin("https://api.example.invalid", true), "https://api.example.invalid");
  for (const url of [
    "http://api.example.invalid",
    "https://u:p@api.example.invalid",
    "https://api.example.invalid/api",
    "https://api.example.invalid?token=x",
    "//evil.invalid",
  ]) {
    assert.throws(() => apiOrigin(url, true));
  }
});
test("Naju entry preserves explicit query without redirecting off configured origin", () => {
  assert.equal(gameEntry("https://game.example.invalid", "/?npc=off", true), "https://game.example.invalid/?npc=off");
  assert.equal(
    gameEntry("https://game.example.invalid", "/character-creation", true),
    "https://game.example.invalid/character-creation",
  );
  for (const path of ["//evil.invalid", "/\\evil.invalid", "relative", "/ bad"])
    assert.throws(() => gameEntry("https://game.example.invalid", path, true));
});
