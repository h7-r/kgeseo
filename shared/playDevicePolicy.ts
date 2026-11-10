/**
 * 플레이 가능한 기기 판정 — 지금은 PC(키보드 · 마우스)에서만 게임을 연다(미르 11/11 「모바일로는 게임 실행 못하게」, 나주입장 02회차).
 * 본편 직접 접속 · /naju01/ 직접 접속(게임 주소를 바로 연 경우)을 막는다 — 웹사이트 「게임 시작」은 MobilePlayNotice 가 따로 막는다(11/10).
 * 부작용 · 별칭 · import.meta 가 없다 — 웹사이트 · 본편 · 나주가 상대 경로로 가져다 쓴다. 터치 플레이 코드는 지우지 않았다(다시 켜기 쉽게).
 *
 * 막는 것: 주 입력이 손가락(pointer: coarse — 휴대폰 · 태블릿 · 큰 터치 화면) · 주 입력이 없음(pointer: none) ·
 *          마우스 잠금이 아예 없는 브라우저(아이폰 · 아이패드 Safari).
 * 통과: 주 입력이 마우스인 터치 노트북. 창 폭 · any-pointer · 게임 안에서 바뀌는 터치 모드(isTouchMode)는 보지 않는다.
 * ?touch=0 · ?layout=desktop 은 이 판정을 바꾸지 않는다. 검수 · 개발용 우회 ?device=any 는 부르는 쪽이 허락할 때만(개발 서버 등).
 */

/** 검수 · 개발용 우회 질의 — 허락된 환경에서만 듣고, 복사해 주는 주소에서는 뺀다 */
export const DEVICE_OVERRIDE_PARAM = "device";
const DEVICE_OVERRIDE_VALUE = "any";

/** 문구 — 웹사이트 「게임 시작」의 「모바일 버전 준비 중」 시트(website/src/mobile/MobilePlayNotice, 미르 11/10)와 같게 */
export const PC_ONLY_TEXT = {
  title: "모바일 버전 준비 중입니다",
  body: "지금은 PC에서만 플레이할 수 있습니다. PC 브라우저에서 같은 계정으로 로그인하면 바로 이어 할 수 있습니다.",
  copy: "PC에서 열 주소 복사",
  copied: "주소를 복사했습니다",
  copyFailed: "아래 주소를 길게 눌러 복사해 주세요",
  home: "홈페이지로",
} as const;

type DeviceWindow = Pick<Window, "matchMedia" | "location">;

/** 이 기기에서 게임을 열면 안 되나 — allowOverride 면 ?device=any 로 통과(검수 · 개발) */
export function isPlayDeviceBlocked(options: { allowOverride?: boolean; win?: DeviceWindow } = {}): boolean {
  const win = options.win ?? (typeof window === "undefined" ? null : window);
  if (!win) return false;
  if (options.allowOverride && hasDeviceOverride(win.location.search)) return false;
  const matches = (query: string) => win.matchMedia?.(query).matches ?? false;
  if (matches("(pointer: coarse)") || matches("(pointer: none)")) return true;
  return typeof Element === "undefined" || !("requestPointerLock" in Element.prototype);
}

export const hasDeviceOverride = (search: string) =>
  new URLSearchParams(search).get(DEVICE_OVERRIDE_PARAM) === DEVICE_OVERRIDE_VALUE;

/** 복사 · 공유할 주소에서 우회 질의를 뺀다 */
export function stripDeviceOverride(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(DEVICE_OVERRIDE_PARAM);
  return url.href;
}

/** 클립보드에 쓴다 — 실제 클릭 안에서 불러야 한다. 성공하면 true */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 게임 문서(본편 · 나주)를 직접 열었을 때 — 게임 모듈을 받기 전에 이 화면만 그린다(React · 에셋 없이, 데이터 낭비 없이).
 * homeUrl: 「홈페이지로」 · 복사할 주소(웹사이트 첫 화면)
 */
export function renderPcOnlyNotice(container: HTMLElement, homeUrl: string) {
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
  page.setAttribute("aria-label", PC_ONLY_TEXT.title);
  const card = el(
    "div",
    "width:min(420px,100%);box-sizing:border-box;padding:28px 24px 22px;border-radius:20px;text-align:center;" +
      "background:rgba(16,22,38,.92);border:1px solid rgba(134,166,240,.35);box-shadow:0 18px 48px rgba(0,0,0,.45)",
  );
  card.append(
    el("div", "font-size:40px;line-height:1;margin-bottom:14px", "🖥️"),
    el("div", "font-size:20px;font-weight:700;line-height:1.4;margin-bottom:10px;word-break:keep-all", PC_ONLY_TEXT.title),
    el("div", "font-size:15px;line-height:1.6;color:#b9c3d8;margin-bottom:20px;word-break:keep-all", PC_ONLY_TEXT.body),
  );
  const status = el("div", "min-height:20px;font-size:13px;color:#86a6f0;margin-bottom:10px;word-break:break-all");
  const button = (label: string, primary: boolean) =>
    el(
      "button",
      "display:block;width:100%;min-height:48px;margin-top:10px;border-radius:24px;font:600 16px/1 inherit;cursor:pointer;" +
        (primary
          ? "border:1px solid #86a6f0;background:#24345c;color:#eef2fb"
          : "border:1px solid rgba(255,255,255,.22);background:transparent;color:#eef2fb"),
      label,
    );
  const copy = button(PC_ONLY_TEXT.copy, true);
  const home = button(PC_ONLY_TEXT.home, false);
  const shareUrl = stripDeviceOverride(homeUrl);
  copy.addEventListener("click", () => {
    void copyText(shareUrl).then((isCopied) => {
      status.textContent = isCopied ? PC_ONLY_TEXT.copied : `${PC_ONLY_TEXT.copyFailed}\n${shareUrl}`;
      status.style.whiteSpace = "pre-line";
    });
  });
  home.addEventListener("click", () => {
    container.ownerDocument.defaultView?.location.assign(homeUrl);
  });
  card.append(status, copy, home);
  page.append(card);
  container.replaceChildren(page);
}
