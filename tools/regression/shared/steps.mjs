// 경로 파일(route.json)의 입력 한 단계를 실행한다.
// 입력 뒤마다 flushTasks 를 부르는 것은, 리액트가 키·마우스 이벤트로 미룬 렌더를 다음 시간 밀기 전에 끝내 두기 위해서다.
import { advance, bodyText, centerMouse, flushTasks, settle, waitText, warm } from "./session.mjs";

const SAVE_KEYS = /^(Control|Meta)\+S$/i;

async function finish(session, step) {
  await flushTasks(session);
  if (step.after) await advance(session, step.after);
}

async function findVisible(session, locator, describe) {
  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(`${describe} 화면: ${JSON.stringify((await bodyText(session)).slice(0, 300))}`);
  }
  return locator;
}

const handlers = {
  async key(session, step) {
    const { keyboard } = session.page;
    await keyboard.down(step.code);
    await flushTasks(session);
    if (step.hold) await advance(session, step.hold);
    await keyboard.up(step.code);
    await finish(session, step);
  },

  async hold(session, step) {
    // 편집기 저장 조합은 경로에 들어와도 누르지 않는다(저장소 파일이 덮인다)
    if (step.codes.some((code) => /^(Control|Meta)/.test(code)) && step.codes.includes("KeyS"))
      throw new Error("[hold] 저장 조합키(Ctrl/⌘+S)는 하네스가 거부한다");
    const { keyboard } = session.page;
    for (const code of step.codes) await keyboard.down(code);
    await flushTasks(session);
    await advance(session, step.ms);
    for (const code of [...step.codes].reverse()) await keyboard.up(code);
    await finish(session, step);
  },

  async run(session, step) {
    await advance(session, step.ms);
  },

  // 포인터 잠금 중에는 상대 이동이 그대로 movementX/Y, 곧 시점 회전이 된다
  async mouse(session, step) {
    session.mouse.x += step.dx ?? 0;
    session.mouse.y += step.dy ?? 0;
    await session.page.mouse.move(session.mouse.x, session.mouse.y, { steps: 1 });
    await finish(session, step);
  },

  async mouseAbs(session, step) {
    session.mouse = { x: step.x, y: step.y };
    await session.page.mouse.move(step.x, step.y, { steps: 1 });
    await flushTasks(session);
  },

  async click(session, step) {
    const { mouse } = session.page;
    session.mouse = { x: step.x, y: step.y };
    await mouse.move(step.x, step.y);
    await mouse.down();
    await mouse.up();
    await finish(session, step);
  },

  // 제자리 클릭 — 움직이지 않아야 포인터 잠금 중 시점이 튀지 않는다
  async mclick(session, step) {
    const { mouse } = session.page;
    await mouse.down({ button: step.button ?? "left" });
    await flushTasks(session);
    if (step.hold) await advance(session, step.hold);
    await mouse.up({ button: step.button ?? "left" });
    await finish(session, step);
  },

  async wheel(session, step) {
    await session.page.mouse.wheel(0, step.dy);
    await finish(session, step);
  },

  async clickText(session, step) {
    const locator = await findVisible(
      session,
      session.page.getByText(step.text, { exact: !!step.exact }).first(),
      `[clickText] ${JSON.stringify(step.text)} 를 화면에서 못 찾았다.`,
    );
    await locator.click({ timeout: 5000 });
    await finish(session, step);
  },

  // 단추 글자·aria-label 로 찾는다 — 좌표보다 레이아웃 변화에 덜 흔들린다
  async clickRole(session, step) {
    const locator = await findVisible(
      session,
      session.page.getByRole(step.role, { name: step.name, exact: !!step.exact }).nth(step.nth ?? 0),
      `[clickRole] ${step.role} ${JSON.stringify(step.name)} 를 못 찾았다.`,
    );
    await locator.click({ timeout: 5000, force: !!step.force });
    await finish(session, step);
  },

  async fill(session, step) {
    const { page } = session;
    const field = step.label
      ? page.getByLabel(step.label, { exact: !!step.exact })
      : page.getByPlaceholder(step.placeholder, { exact: !!step.exact });
    const locator = field.first();
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      throw new Error(`[fill] 입력칸 ${JSON.stringify(step.label ?? step.placeholder)} 를 못 찾았다`);
    }
    await locator.fill(step.text, { timeout: 5000 });
    await finish(session, step);
  },

  async press(session, step) {
    if (SAVE_KEYS.test(step.keys)) throw new Error("[press] 저장 조합키는 하네스가 거부한다");
    await session.page.keyboard.press(step.keys);
    await finish(session, step);
  },

  // 오른쪽 버튼 끌기(편집기 시점 돌리기)
  async rclickDrag(session, step) {
    const { mouse } = session.page;
    const dy = step.dy ?? 0;
    const steps = step.steps ?? 8;
    session.mouse = { x: step.x, y: step.y };
    await mouse.move(step.x, step.y);
    await mouse.down({ button: "right" });
    await flushTasks(session);
    for (let i = 1; i <= steps; i++) {
      await mouse.move(step.x + (step.dx * i) / steps, step.y + (dy * i) / steps);
      await flushTasks(session, 1);
    }
    await mouse.up({ button: "right" });
    session.mouse = { x: step.x + step.dx, y: step.y + dy };
    await finish(session, step);
  },

  // 마우스를 풀어야 화면 UI 를 절대 좌표로 누를 수 있다
  async exitPointerLock(session, step) {
    await session.page.evaluate(() => document.exitPointerLock?.()).catch(() => {});
    await finish(session, step);
  },

  // 게임이 스스로 주소를 바꿀 때 — 새 문서가 뜨고 가라앉을 때까지
  async waitUrl(session, step) {
    const { page } = session;
    const pattern = new RegExp(step.pattern);
    for (let t = 0; t <= (step.maxMs ?? 10000) && !pattern.test(page.url()); t += 100) await advance(session, 100);
    try {
      await page.waitForURL(pattern, { timeout: 60000, waitUntil: "load" });
    } catch {
      throw new Error(`[waitUrl] 주소가 /${step.pattern}/ 로 안 바뀌었다. 지금 ${page.url()}`);
    }
    await settle(session, { maxMs: 90000, quietMs: 500 });
    await centerMouse(session);
    await warm(session, step.warmMs ?? 3000);
  },

  async waitText(session, step) {
    await waitText(session, step.text, { maxMs: step.maxMs ?? 15000, absent: !!step.absent });
  },

  // 값 안의 {{now}} 는 페이지의 Date.now(), 곧 가짜 시계로 바꿔 심는다
  async storage(session, step) {
    await session.page.evaluate((s) => {
      const now = Date.now();
      const fill = (value) =>
        typeof value === "string"
          ? value.replaceAll("{{now}}", String(now))
          : JSON.stringify(value).replaceAll('"{{now}}"', String(now));
      for (const [k, v] of Object.entries(s.local ?? {}))
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, fill(v));
      for (const [k, v] of Object.entries(s.session ?? {}))
        if (v === null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, fill(v));
      if (s.clear) {
        localStorage.clear();
        sessionStorage.clear();
      }
    }, step);
  },
};

export async function exec(session, step) {
  const handler = handlers[step.op];
  if (!handler) throw new Error(`알 수 없는 op: ${step.op}`);
  await handler(session, step);
}
