// 브라우저 한 탭을 「같은 입력이면 같은 화면」이 나오게 묶어 두는 층.
//
// 시간: Playwright 가짜 시계를 페이지가 뜨기 전에 멈춘 채 설치한다. rAF·performance.now·Date·setTimeout 이
//   전부 가짜 시간을 따르고, advance() 로 민 만큼만 흐른다. 그래서 같은 입력이면 프레임 수·dt·애니메이션 위상이 같다.
// 네트워크: 에셋 로딩은 진짜 시간이라, 시간을 밀기 전마다 진행 중 요청이 0 이 될 때까지 기다리고
//   시간을 미는 동안 도착한 응답은 붙잡아 두었다가 덩어리 사이에만 넘긴다.
// 게임 내부(window 전역·식별자)는 읽지 않는다. 입력은 키보드·마우스·화면 글자·주소·저장소뿐이다.
import { chromium } from "playwright";
import { createRequire } from "node:module";
import path from "node:path";

export const VIEWPORT = { width: 1600, height: 900 };
const CLOCK_START = new Date("2026-01-01T09:00:00Z").getTime();
const CHUNK_MS = 100;

const isExternal = (url) =>
  !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && !url.startsWith("data:") && !url.startsWith("blob:");
const isApi = (url) => /^https?:\/\/[^/]+\/api\//.test(url);
const isReadMethod = (method) => method === "GET" || method === "HEAD" || method === "OPTIONS";

// drei useGLTF 는 Draco 디코더를 gstatic CDN 에서 받는다. 오프라인에서도 같은 결과가 나오게 three 에 든 디코더로 대신 준다.
const DRACO_URL = /^https:\/\/www\.gstatic\.com\/draco\/versioned\/decoders\/[\d.]+\/(draco_[a-z_]+\.(?:js|wasm))$/;
const DRACO_DIR = path.dirname(
  createRequire(import.meta.url).resolve("three/examples/jsm/libs/draco/draco_decoder.wasm"),
);

// 시간을 미는 동안 쌓이는 진짜 작업이 아니므로 「진행 중 요청」으로 세지 않는다
const UNTRACKED_REQUESTS = new Set(["media", "websocket", "eventsource"]);

export function launch({ headless = true } = {}) {
  return chromium.launch({
    channel: "chrome",
    headless,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--mute-audio"],
  });
}

/** 새 컨텍스트(빈 저장소)와 멈춘 가짜 시계, 네트워크 관문·로그 수집기를 붙인 탭을 만든다. */
export async function newSession(browser) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await ctx.newPage();
  const session = {
    ctx,
    page,
    logs: [],
    pending: new Map(),
    blocked: [],
    writeAttempts: [],
    inRun: false,
    lastNet: 0,
    mouse: { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 },
    fakeMs: 0,
  };

  // 응답을 덩어리 경계에서만 넘겨야 에셋이 가짜 시간의 같은 프레임에 붙는다
  const releaseGate = async () => {
    while (session.inRun) await new Promise((resolve) => setTimeout(resolve, 3));
    session.lastNet = Date.now();
  };

  await ctx.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const draco = url.match(DRACO_URL);
    if (draco) {
      await releaseGate();
      return route.fulfill({
        status: 200,
        path: path.join(DRACO_DIR, draco[1]),
        contentType: draco[1].endsWith(".wasm") ? "application/wasm" : "text/javascript",
        headers: { "access-control-allow-origin": "*" },
      });
    }
    if (isExternal(url)) {
      session.blocked.push(url.slice(0, 200));
      return route.abort("blockedbyclient");
    }
    // 저장소를 심을 같은 출처 빈 페이지 — 무거운 앱을 미리 띄우지 않으려고
    if (/^https?:\/\/[^/]+\/__harness\/blank/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>blank</title><body></body>",
      });
    }
    // 편집기 저장(POST /__naju-edit) 같은 개발 서버 쓰기가 저장소 파일을 덮지 못하게 한다
    const method = request.method();
    if (!isReadMethod(method) && !isApi(url)) {
      session.writeAttempts.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
      session.logs.push({ fakeMs: session.fakeMs, kind: "harness.blockedWrite", text: `${method} ${url}` });
      return route.abort("blockedbyclient");
    }
    // 백엔드는 늘 「꺼짐」으로 고정해 프록시 응답 시간에 따른 차이를 없앤다
    if (isApi(url)) {
      await releaseGate();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"detail":"harness: backend off"}',
      });
    }
    let response;
    try {
      response = await route.fetch({ timeout: 120000 });
    } catch {
      await releaseGate();
      return route.abort("failed").catch(() => {});
    }
    await releaseGate();
    return route.fulfill({ response }).catch(() => {});
  });

  page.on("request", (r) => {
    if (!UNTRACKED_REQUESTS.has(r.resourceType())) session.pending.set(r, Date.now());
  });
  page.on("requestfinished", (r) => session.pending.delete(r));
  page.on("requestfailed", (r) => session.pending.delete(r));
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning" || type === "assert")
      session.logs.push({ fakeMs: session.fakeMs, kind: `console.${type}`, text: message.text().slice(0, 600) });
  });
  page.on("pageerror", (error) =>
    session.logs.push({
      fakeMs: session.fakeMs,
      kind: "pageerror",
      text: String(error.stack || error.message).slice(0, 1200),
    }),
  );
  page.on("crash", () => session.logs.push({ fakeMs: session.fakeMs, kind: "crash", text: "page crashed" }));

  // Playwright 는 install 과 pauseAt 사이의 진짜 경과(1~3ms)만큼 performance.now 를 밀어 둔다.
  // 그 몇 ms 로 rAF 위상이 판마다 달라져 걸음·카메라가 어긋나므로, 두 호출 동안 Node 의 시계를 멈춘다.
  const realNow = Date.now;
  Date.now = () => CLOCK_START;
  try {
    await page.clock.install({ time: CLOCK_START });
    await page.clock.pauseAt(CLOCK_START + 1000);
  } finally {
    Date.now = realNow;
  }
  return session;
}

/** 진행 중 요청이 없어질 때까지 진짜 시간으로 기다린다. 가짜 시계는 멈춰 있다. */
export async function settle(session, { maxMs = 30000, quietMs = 120, decodeMs = 400 } = {}) {
  const start = Date.now();
  let quietSince = null;
  while (Date.now() - start < maxMs) {
    // 스트리밍처럼 끝나지 않는 요청 하나가 검사 전체를 붙잡지 않게
    for (const [request, at] of session.pending) if (Date.now() - at > 20000) session.pending.delete(request);
    if (session.pending.size === 0) {
      quietSince ??= Date.now();
      // 막 도착한 응답은 디코딩(Draco 워커·이미지·오디오)이 진짜 시간으로 돌아야 끝난다
      if (Date.now() - quietSince >= quietMs && Date.now() - session.lastNet >= decodeMs) break;
    } else quietSince = null;
    await session.page.waitForTimeout(20);
  }
  await flushTasks(session);
}

/** 리액트 스케줄러가 MessageChannel 로 미뤄 둔 일을 비운다. 가짜 시계와 무관한 진짜 매크로태스크다. */
export async function flushTasks(session, rounds = 3) {
  for (let i = 0; i < rounds; i++)
    await session.page
      .evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => resolve();
            channel.port2.postMessage(0);
          }),
      )
      .catch(() => {});
}

/** 가짜 시간을 ms 만큼 민다. 덩어리마다 네트워크를 가라앉혀야 에셋이 같은 시점에 붙는다. */
export async function advance(session, ms) {
  let left = Math.round(ms);
  while (left > 0) {
    const chunk = Math.min(CHUNK_MS, left);
    await settle(session);
    session.inRun = true;
    try {
      await session.page.clock.runFor(chunk);
    } finally {
      session.inRun = false;
    }
    session.fakeMs += chunk;
    left -= chunk;
  }
  await settle(session);
}

export function bodyText(session) {
  return session.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
}

/** 글자가 보일(absent 면 사라질) 때까지 가짜 시간을 조금씩 민다. */
export async function waitText(session, text, { maxMs = 15000, step = 100, absent = false } = {}) {
  for (let t = 0; t <= maxMs; t += step) {
    const has = (await bodyText(session)).includes(text);
    if (has !== absent) return t;
    await advance(session, step);
  }
  const body = await bodyText(session);
  throw new Error(
    `[waitText] ${absent ? "사라지길" : "나타나길"} 기다린 글자 ${JSON.stringify(String(text))} — ` +
      `가짜 ${maxMs}ms 안에 ${absent ? "안 사라짐" : "안 보임"}.\n  지금 화면 글자: ${JSON.stringify(body.slice(0, 400))}`,
  );
}

export async function centerMouse(session) {
  session.mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  await session.page.mouse.move(session.mouse.x, session.mouse.y);
}

/** 멈춘 시계로 주소를 열고, 준비 글자를 기다린 뒤 warmMs 만큼 데운다. */
export async function goto(session, url, { readyText = null, warmMs = 2000 } = {}) {
  await session.page.goto(url, { waitUntil: "load", timeout: 120000 });
  // Playwright 마우스는 (0,0) 에서 시작해 첫 상대 이동이 포인터 잠금 중이면 시점이 크게 튄다
  await centerMouse(session);
  await settle(session, { maxMs: 60000, quietMs: 400 });
  if (readyText) {
    // 로딩은 네트워크가 먼저라 진짜 시간으로 기다려 보고, 그래도 없으면 페이드·지연 마운트 타이머를 가짜 시간으로 민다
    let seen = await session.page
      .getByText(readyText, { exact: false })
      .first()
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    for (let t = 0; !seen && t < 20000; t += 200) {
      await advance(session, 200);
      seen = (await bodyText(session)).includes(readyText);
    }
    if (!seen)
      throw new Error(
        `[goto] ${url} 에서 준비 글자 ${JSON.stringify(readyText)} 가 안 보였다(진짜 15초 + 가짜 20초). ` +
          `화면: ${JSON.stringify((await bodyText(session)).slice(0, 300))}`,
      );
    await settle(session, { maxMs: 60000, quietMs: 400 });
  }
  // 첫 몇 프레임이 lazy import·텍스처를 부르므로 조금씩 밀며 가라앉힌다
  await warm(session, warmMs);
}

export async function warm(session, warmMs, { stepMs = 500, quietMs = 300 } = {}) {
  for (let t = 0; t < warmMs; t += stepMs) {
    await advance(session, stepMs);
    await settle(session, { maxMs: 60000, quietMs });
  }
}
