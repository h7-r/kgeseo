/**
 * 루트 vercel.json 의 보안 머리 — 웹(www)과 게임(play)이 같이 쓰는 파일이라 실수 하나가 두 앱을 같이 깬다.
 * - 운영 주소와 미리보기 주소 덩어리가 같은 머리를 갖는다(조건이 AND 라 덩어리를 둘로 나눠 적었다)
 * - CSP 는 Report-Only 로만 — 막는 CSP 는 아직 넣지 않는다
 * - 인라인 스크립트 해시가 지금 index.html 과 맞는다(index.html 을 고치면 여기서 먼저 걸린다)
 *
 *   npm run web:test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const config = JSON.parse(read("vercel.json"));

const blockFor = (value) =>
  config.headers.find(
    (rule) => rule.source === "/(.*)" && JSON.stringify(rule.has?.[0]?.value) === JSON.stringify(value),
  );
const header = (rule, key) => rule?.headers.find((h) => h.key === key)?.value;
const sha = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const inlineScripts = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => sha(m[1]));
const inlineHandlers = (html) => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map((m) => sha(m[1]));

const SITES = {
  www: { live: "www.k-escape.com", preview: { pre: "k-escape-web-", suf: ".vercel.app" } },
  play: { live: "play.k-escape.com", preview: { pre: "kgeseo-", suf: ".vercel.app" } },
};

test("기존 내용 — SPA rewrites 와 관리자 X-Robots-Tag 는 그대로", () => {
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
  const admin = config.headers.find((rule) => rule.source === "/admin(.*)");
  assert.deepEqual(admin, {
    source: "/admin(.*)",
    has: [{ type: "host", value: "www.k-escape.com" }],
    headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
  });
});

test("운영 · 미리보기 덩어리는 같은 머리", () => {
  for (const [name, site] of Object.entries(SITES)) {
    const live = blockFor(site.live);
    const preview = blockFor(site.preview);
    assert.ok(live && preview, `${name} 덩어리 둘`);
    assert.deepEqual(preview.headers, live.headers, `${name} 운영 · 미리보기`);
  }
});

test("CSP 는 Report-Only 로만 · 필수 지시어", () => {
  for (const rule of config.headers) {
    assert.ok(!rule.headers.some((h) => h.key.toLowerCase() === "content-security-policy"), "막는 CSP 없음");
  }
  for (const site of Object.values(SITES)) {
    const csp = header(blockFor(site.live), "Content-Security-Policy-Report-Only");
    for (const directive of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "default-src 'self'"]) {
      assert.ok(csp.includes(directive), directive);
    }
  }
});

test("바로 효과 나는 머리 — 게임이 쓰는 전체 화면 · 자동 재생은 열어 둔다", () => {
  for (const site of Object.values(SITES)) {
    const rule = blockFor(site.live);
    assert.equal(header(rule, "X-Content-Type-Options"), "nosniff");
    assert.equal(header(rule, "X-Frame-Options"), "DENY");
    assert.equal(header(rule, "Referrer-Policy"), "strict-origin-when-cross-origin");
    const policy = header(rule, "Permissions-Policy");
    assert.match(policy, /fullscreen=\(self\)/);
    assert.match(policy, /autoplay=\(self\)/);
    assert.doesNotMatch(policy, /gamepad/);
  }
});

test("인라인 스크립트 해시가 지금 index.html 과 맞는다", () => {
  const www = header(blockFor(SITES.www.live), "Content-Security-Policy-Report-Only");
  const play = header(blockFor(SITES.play.live), "Content-Security-Policy-Report-Only");
  const web = read("website/index.html");
  for (const hash of [...inlineScripts(web), ...inlineHandlers(web)]) assert.ok(www.includes(hash), `웹 ${hash}`);
  for (const file of ["index.html", "naju01/index.html"]) {
    for (const hash of inlineScripts(read(file))) assert.ok(play.includes(hash), `${file} ${hash}`);
  }
});
