// 체크포인트 한 장 = 스크린샷 + 화면 글자·주소·저장소·오류 기록.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { advance, bodyText } from "./session.mjs";

// Leva 값 저장소는 수십 KB 라 체크포인트에는 해시만 남긴다(전체는 leva-dump 가 따로 뜬다)
const LARGE_KEY = /^kgeseo\.leva\./;
const sha1 = (text) =>
  crypto
    .createHash("sha1")
    .update(text ?? "")
    .digest("hex")
    .slice(0, 12);

/** 페이지 이름표 → 실제 주소. 파일 이름이 바뀌어도 같은 경로·같은 체크포인트로 견주려고 쓴다. */
export function logicalUrl(rawUrl, pages) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const pathname = decodeURIComponent(url.pathname);
  for (const [name, target] of Object.entries(pages)) {
    const targetPath = decodeURIComponent(target.split("?")[0]);
    const isIndexDir = targetPath.endsWith("/index.html") && pathname === targetPath.slice(0, -"index.html".length);
    if (pathname === targetPath || isIndexDir) return `{${name}}${url.search}${url.hash}`;
  }
  return pathname + url.search + url.hash;
}

async function readStorage(page) {
  return page
    .evaluate(() => {
      const dump = (store) => {
        const out = {};
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          out[key] = store.getItem(key);
        }
        return out;
      };
      try {
        return { local: dump(localStorage), session: dump(sessionStorage) };
      } catch (error) {
        return { error: String(error) };
      }
    })
    .catch((error) => ({ error: String(error) }));
}

function summarizeStorage(state) {
  if (!state || state.error) return state;
  const local = {};
  for (const [key, value] of Object.entries(state.local ?? {}))
    local[key] = LARGE_KEY.test(key) ? { sha1: sha1(value), length: value.length } : value;
  return { local, session: { ...(state.session ?? {}) } };
}

async function screenshot(session, file) {
  // 영상 막이 걷히는 순간 스크린샷이 새 프레임을 못 받아 멈출 때가 있다 — 가짜 100ms 를 밀어 프레임을 만든 뒤 다시 찍는다
  for (let retry = 0; ; retry++) {
    try {
      await session.page.screenshot({ path: file, animations: "disabled", caret: "hide", timeout: 15000 });
      return retry;
    } catch (error) {
      if (retry >= 2) throw error;
      await advance(session, 100);
    }
  }
}

export async function checkpoint(session, outDir, name, { expect = [], desc = "", warnOnly = false, pages = {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const { page } = session;
  const shotRetry = await screenshot(session, path.join(outDir, `${name}.png`));
  const text = await bodyText(session);
  const storage = summarizeStorage(await readStorage(page));
  const url = page.url();
  const title = await page.title().catch(() => "");
  const pointerLocked = await page.evaluate(() => !!document.pointerLockElement).catch(() => null);
  const logs = session.logs.splice(0);
  const missing = expect.filter((t) => !text.includes(t));
  const record = {
    name,
    desc,
    url: logicalUrl(url, pages),
    rawUrl: url.replace(/^https?:\/\/[^/]+/, ""),
    title,
    fakeMs: session.fakeMs,
    warnOnly,
    shotRetry,
    pointerLocked,
    text,
    storage,
    logs,
    expect,
    missing,
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(record, null, 2));
  return record;
}
