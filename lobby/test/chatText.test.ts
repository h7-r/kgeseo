// 화면(src/net/chatText.ts)과 서버(lobby/src/chat.ts)의 다듬기·글자 수가 같은지 — 검토 14회차 7
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as screen from "../../src/net/chatText.ts";
import * as server from "../src/chat.js";

const SAMPLES = [
  "",
  "   ",
  "안녕하세요",
  "  ＡＢＣ１２\t안녕\n하세요\u0000​  ",
  "가 나 다\u0085라",
  "‮거꾸로 ‍ 이모지👨‍👩‍👧",
  "😀".repeat(41),
  "ㅋ".repeat(45),
  "Ｈｅｌｌｏ　Ｗｏｒｌｄ",
  "é café",
];

describe("화면·서버 채팅 다듬기", () => {
  it("상한이 같다", () => assert.equal(screen.CHAT_MAX_CHARS, server.CHAT_MAX_CHARS));
  for (const sample of SAMPLES) {
    it(JSON.stringify(sample).slice(0, 40), () => {
      assert.equal(screen.normalizeChatText(sample), server.normalizeChatText(sample));
      assert.equal(screen.chatLength(sample), server.chatLength(sample));
    });
  }
});
