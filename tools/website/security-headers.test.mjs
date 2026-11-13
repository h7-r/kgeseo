/**
 * 루트 vercel.json 의 보안 머리 — 웹(www)과 게임(play)이 같이 쓰는 파일이라 실수 하나가 두 앱을 같이 깬다.
 * - 운영 주소와 미리보기 주소 덩어리가 같은 머리를 갖는다(조건이 AND 라 덩어리를 둘로 나눠 적었다)
 * - 미리보기 조건이 실제 Vercel 주소 모양(고유 배포 · 브랜치 별칭)에 걸리고, 웹 · 게임이 서로 섞이지 않는다
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
  www: { live: "www.k-escape.com", preview: { pre: "k-escape-", suf: ".vercel.app" } },
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

// Vercel 의 host 조건 맞춤 — 문자열은 같아야 하고, { pre, suf } 는 앞 · 뒤가 맞아야 한다
const hostMatches = (value, host) =>
  typeof value === "string" ? value === host : host.startsWith(value.pre ?? "") && host.endsWith(value.suf ?? "");

// 실제 미리보기 주소 모양. 고유 배포 주소는 프로젝트 이름이 잘린다(k-escape-web → k-escape-)
const PREVIEW_HOSTS = {
  www: [
    "k-escape-ggzrnk9vd-h7-rs-projects.vercel.app", // 고유 배포 주소
    "k-escape-web-git-feat-1110-h7-rs-projects.vercel.app", // 브랜치 별칭
  ],
  play: ["kgeseo-h6rbioncr-h7-rs-projects.vercel.app", "kgeseo-git-feat-1110-h7-rs-projects.vercel.app"],
};

test("미리보기 조건이 실제 주소 모양에 걸리고, 웹 · 게임이 섞이지 않는다", () => {
  for (const [name, hosts] of Object.entries(PREVIEW_HOSTS)) {
    const other = name === "www" ? "play" : "www";
    for (const host of hosts) {
      assert.ok(hostMatches(SITES[name].preview, host), `${name} 미리보기 ${host}`);
      assert.ok(!hostMatches(SITES[other].preview, host), `${other} 조건이 ${host} 에 걸리면 안 됨`);
      assert.ok(!hostMatches(SITES[name].live, host) && !hostMatches(SITES[other].live, host), `운영 조건 ${host}`);
    }
  }
  for (const site of Object.values(SITES)) {
    for (const live of [SITES.www.live, SITES.play.live]) {
      assert.ok(!hostMatches(site.preview, live), `미리보기 조건이 운영 ${live} 에 걸리면 안 됨`);
    }
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

test("관리자 서버 상태가 재는 에셋 CDN 을 웹(www) connect-src 가 허용한다", () => {
  const health = read("website/src/admin/api/health.ts");
  const cdn = health.match(/PRODUCTION_CDN = "([^"]+)"/)?.[1];
  assert.ok(cdn, "health.ts PRODUCTION_CDN");
  const connect = (site) =>
    header(blockFor(site), "Content-Security-Policy-Report-Only")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("connect-src "));
  assert.ok(connect(SITES.www.live).split(" ").includes(cdn), "www connect-src");
  assert.ok(connect(SITES.play.live).split(" ").includes(cdn), "play 도 같은 CDN");
});
