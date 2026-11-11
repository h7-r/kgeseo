/**
 * 로그인 필수 — 로그인하지 않았으면 게임을 열지 않는다(미르 11/11 「로그인 안 한 채로 게임 실행 안 되게」).
 * 웹사이트 「게임 시작」은 이미 로그인 화면으로 보낸다(website navigation/routes useSiteNavigate). 여기서는 게임 주소(본편 · /naju01/)를
 * 직접 연 경우를 막는다 — 게임 모듈 · 에셋을 받기 전에 /me 로 확인하고, 로그인하지 않았으면 안내만 그린다.
 *
 * - 운영 빌드에서만 켠다. 개발 서버 · 검수 작업대는 게스트로 시험하므로 끈다. VITE_REQUIRE_LOGIN=1 이면 개발 서버에서도 켠다(시험용),
 *   VITE_ALLOW_GUEST_PLAY=1 이면 운영 빌드에서도 끈다(되돌리기 스위치).
 * - /me 가 401 · 403 이면 로그인 안 함 → 안내. 200 이면 통과. 그 밖(서버 오류 · 연결 실패 · 시간 초과)은 통과시킨다 —
 *   서버가 잠깐 아플 때 로그인한 사람까지 막지 않게(그 경우 게임 안의 로그인 기능도 같은 서버를 쓴다).
 * 부작용 · 별칭 · import.meta 가 없다 — 본편 · 나주 엔트리가 상대 경로로 가져다 쓴다(playDevicePolicy 와 같은 방식).
 */

export const LOGIN_REQUIRED_TEXT = {
  title: "로그인이 필요합니다",
  body: "「왜곡」은 회원만 플레이할 수 있어요. 홈페이지에서 로그인하면 바로 게임으로 이어집니다.",
  login: "로그인하러 가기",
  home: "홈페이지로",
} as const;

export type LoginState = "in" | "out" | "unknown";

/** 켜야 하나 — 운영 빌드(PROD)면 켜고, 되돌리기 스위치가 있으면 끈다. 개발 서버는 시험용 스위치가 있을 때만 */
export function isLoginGateEnabled(env: { prod: boolean; requireLogin?: string; allowGuestPlay?: string }): boolean {
  if (env.requireLogin === "1") return true;
  if (env.allowGuestPlay === "1") return false;
  return env.prod;
}

/** 웹사이트 로그인 화면 — 로그인을 마치면 /play 로 가서 게임을 연다 */
export function loginPageUrl(siteUrl: string): string {
  const url = new URL("/login", siteUrl);
  url.searchParams.set("next", "/play");
  return url.href;
}

/** /me 로 로그인했는지 본다. 401 · 403 = out, 200 = in, 그 밖 · 시간 초과 = unknown */
export async function checkLogin(apiOrigin: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<LoginState> {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${apiOrigin}/api/v1/me`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller?.signal,
    });
    if (response.status === 401 || response.status === 403) return "out";
    return response.ok ? "in" : "unknown";
  } catch {
    return "unknown";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 로그인하지 않았으면 안내를 그리고 false, 아니면 true(게임을 연다).
 * 꺼져 있으면 묻지 않고 true.
 */
export async function passLoginGate(
  container: HTMLElement,
  options: { enabled: boolean; apiOrigin: string; siteUrl: string; fetchImpl?: typeof fetch },
): Promise<boolean> {
  if (!options.enabled) return true;
  // 확인이 늦으면(0.4초 넘게) 빈 화면 대신 조용한 「불러오는 중」 — 보통은 그 전에 끝나 깜빡이지 않는다(Codex 리뷰).
  // 게임의 로딩 막(영상)과 같은 바탕색. #root 밖(body)에 두고, 끝나면 바로 걷는다
  const doc = container.ownerDocument;
  let waiting: HTMLElement | null = null;
  const timer = doc
    ? setTimeout(() => {
        waiting = doc.createElement("div");
        waiting.setAttribute(
          "style",
          "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#01040a;" +
            "color:rgba(242,238,228,.6);font:500 14px/1.4 Pretendard,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif",
        );
        waiting.setAttribute("role", "status");
        waiting.textContent = "불러오는 중…";
        doc.body?.append(waiting);
      }, 400)
    : null;
  const state = await checkLogin(options.apiOrigin, options.fetchImpl);
  if (timer) clearTimeout(timer);
  (waiting as HTMLElement | null)?.remove();
  if (state !== "out") return true;
  renderLoginRequiredNotice(container, options.siteUrl);
  return false;
}

/** 로그인 안내 — 게임 모듈을 받기 전에 이 화면만 그린다(React · 에셋 없이). PC 전용 안내(renderPcOnlyNotice)와 같은 모양 */
export function renderLoginRequiredNotice(container: HTMLElement, siteUrl: string) {
  const doc = container.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string) => {
    const node = doc.createElement(tag);
    node.setAttribute("style", style);
    if (text) node.textContent = text;
    return node;
  };
  const page = el(
    "div",
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;" +
      "background:radial-gradient(120% 80% at 50% 20%,#18233d 0%,#070b16 70%);color:#eef2fb;" +
      "font-family:Pretendard,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif;overflow:auto",
  );
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-label", LOGIN_REQUIRED_TEXT.title);
  const card = el(
    "div",
    "width:min(420px,100%);box-sizing:border-box;padding:28px 24px 22px;border-radius:20px;text-align:center;" +
      "background:rgba(16,22,38,.92);border:1px solid rgba(134,166,240,.35);box-shadow:0 18px 48px rgba(0,0,0,.45)",
  );
  card.append(
    el("div", "font-size:40px;line-height:1;margin-bottom:14px", "🔐"),
    el("div", "font-size:20px;font-weight:700;line-height:1.4;margin-bottom:10px;word-break:keep-all", LOGIN_REQUIRED_TEXT.title),
    el("div", "font-size:15px;line-height:1.6;color:#b9c3d8;margin-bottom:20px;word-break:keep-all", LOGIN_REQUIRED_TEXT.body),
  );
  const button = (label: string, primary: boolean) =>
    el(
      "button",
      "display:block;width:100%;min-height:48px;margin-top:10px;border-radius:24px;font:600 16px/1 inherit;cursor:pointer;" +
        (primary
          ? "border:1px solid #86a6f0;background:#24345c;color:#eef2fb"
          : "border:1px solid rgba(255,255,255,.22);background:transparent;color:#eef2fb"),
      label,
    );
  const login = button(LOGIN_REQUIRED_TEXT.login, true);
  const home = button(LOGIN_REQUIRED_TEXT.home, false);
  login.addEventListener("click", () => doc.defaultView?.location.assign(loginPageUrl(siteUrl)));
  home.addEventListener("click", () => doc.defaultView?.location.assign(siteUrl));
  card.append(login, home);
  page.append(card);
  container.replaceChildren(page);
  login.focus();
}
