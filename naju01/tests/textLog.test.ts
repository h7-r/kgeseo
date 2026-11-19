import assert from "node:assert/strict";
import { test } from "node:test";

import { textLog } from "../src/dialogue/textLog.ts";

test("지난 글 — 굵게 표시를 걷고, 같은 글이 이어 뜨면 한 번만, 60개까지만 남긴다", () => {
  textLog.clear();
  textLog.add("아비사", "**아랑사**를 찾아 주게.");
  textLog.add("아비사", "아랑사를 찾아 주게.");
  textLog.add("알림", "  ");
  assert.deepEqual(textLog.entries(), [{ who: "아비사", text: "아랑사를 찾아 주게." }]);
  for (let i = 0; i < 70; i++) textLog.add("알림", `글 ${i}`);
  assert.equal(textLog.entries().length, 60);
  assert.equal(textLog.entries().at(-1)?.text, "글 69");
});
