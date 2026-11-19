/**
 * 3D 화면을 못 열거나 도중에 그래픽 연결이 끊겼을 때의 안내(미르 11/12 베타 보고 — 내장 그래픽 · 8GB 노트북).
 * 메모리가 모자라 그래픽 프로세스가 여러 번 죽으면 크롬이 그래픽 가속을 꺼 버린다(GL_VENDOR = Disabled). 그 뒤로는
 * 새로고침 · 이어서 하기도 똑같이 실패하고 브라우저를 완전히 껐다 켜야 풀린다 — 검은 화면 · 끝까지 찬 로딩 막대 대신 이 안내를 낸다.
 * 리액트 나무가 죽어도 뜨도록 DOM 으로 직접 그린다. React · 게임 모듈을 쓰지 않는다(엔트리가 게임보다 먼저 부른다).
 */

export type GraphicsFailure =
  /** 그래픽 연결(WebGL)을 아예 만들지 못한다 */
  | "unavailable"
  /** 플레이 도중 끊겼다 */
  | "lost"
  /** 그 밖의 오류로 화면이 죽었다 */
  | "crashed";

const TEXT: Record<GraphicsFailure, { title: string; body: string }> = {
  unavailable: {
    title: "3D 화면을 열지 못했어요",
    body: "이 브라우저가 지금 그래픽 가속을 쓰지 못하고 있어요. 메모리가 부족해 그래픽이 여러 번 멈추면 브라우저가 스스로 꺼 두기도 해요.",
  },
  lost: {
    title: "그래픽 연결이 끊겼어요",
    body: "컴퓨터의 메모리가 부족해 브라우저가 3D 화면을 닫았어요. 저장된 진행은 그대로 남아 있어요.",
  },
  crashed: {
    title: "화면에 문제가 생겼어요",
    body: "게임 화면을 그리다가 멈췄어요. 저장된 진행은 그대로 남아 있어요.",
  },
};

const STEPS = [
  "브라우저를 완전히 종료한 뒤 다시 열어 주세요. 새로고침만으로는 풀리지 않을 수 있어요.",
  "다른 탭과 프로그램을 닫아 메모리를 비워 주세요.",
  "그래픽 드라이버가 오래됐다면 최신으로 올려 주세요.",
  "그래도 안 되면 아래 「저사양 모드로 열기」를 눌러 주세요.",
];

const HOST_ATTR = "data-graphics-failure";

/** 그래픽 연결을 만들 수 있나 — 임시 캔버스로 한 번 열어 보고 바로 놓는다. 게임(three)은 WebGL2 가 있어야 돈다 */
export function canCreateWebGl(doc: Document = document): boolean {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** 저사양 모드 저장 열쇠 — src/engine/quality.ts 의 QUALITY_KEY 와 같다(엔트리는 게임 모듈을 부르지 않는다) */
const QUALITY_KEY = "kgeseo.quality.v1";

/** 저사양 모드로 저장하고 다시 연다 — 저장을 못 하면 주소 옵션(?q=low)으로 */
function reopenLow() {
  const url = new URL(window.location.href);
  try {
    window.localStorage.setItem(QUALITY_KEY, "low");
    url.searchParams.delete("q");
  } catch {
    url.searchParams.set("q", "low");
  }
  window.location.href = url.toString();
}

/** 안내를 화면 맨 위에 띄운다. 이미 떠 있으면 그대로 둔다(먼저 뜬 까닭이 원인에 가깝다) */
export function showGraphicsFailure(kind: GraphicsFailure, doc: Document = document) {
  if (doc.querySelector(`[${HOST_ATTR}]`)) return;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string) => {
    const node = doc.createElement(tag);
    node.setAttribute("style", style);
    if (text) node.textContent = text;
    return node;
  };
  const page = el(
    "div",
    "position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:24px;" +
      "box-sizing:border-box;background:rgba(5,8,16,.94);color:#eef2fb;overflow:auto;" +
      "font-family:Pretendard,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif",
  );
  page.setAttribute(HOST_ATTR, kind);
  page.setAttribute("role", "alertdialog");
  page.setAttribute("aria-label", TEXT[kind].title);
  const card = el(
    "div",
    "width:min(520px,100%);box-sizing:border-box;padding:28px 26px 22px;border-radius:20px;" +
      "background:rgba(16,22,38,.96);border:1px solid rgba(134,166,240,.35);box-shadow:0 18px 48px rgba(0,0,0,.45)",
  );
  card.append(
    el("div", "font-size:21px;font-weight:700;line-height:1.4;margin-bottom:10px;word-break:keep-all", TEXT[kind].title),
    el("div", "font-size:15px;line-height:1.65;color:#b9c3d8;margin-bottom:16px;word-break:keep-all", TEXT[kind].body),
  );
  const list = el("ol", "margin:0 0 18px;padding-left:1.3em;font-size:15px;line-height:1.7;word-break:keep-all");
  for (const step of STEPS) list.append(el("li", "margin-bottom:4px", step));
  card.append(list);
  const button = (label: string, primary: boolean) =>
    el(
      "button",
      "display:block;width:100%;min-height:46px;margin-top:10px;border-radius:23px;font:600 16px/1 inherit;cursor:pointer;" +
        (primary
          ? "border:1px solid #86a6f0;background:#24345c;color:#eef2fb"
          : "border:1px solid rgba(255,255,255,.22);background:transparent;color:#eef2fb"),
      label,
    );
  const reload = button("다시 시도", true);
  reload.addEventListener("click", () => window.location.reload());
  const low = button("저사양 모드로 열기", false);
  low.addEventListener("click", reopenLow);
  const check = el(
    "a",
    "display:block;margin-top:14px;text-align:center;font-size:13px;color:#86a6f0;text-decoration:underline",
    "내 컴퓨터 진단하기",
  );
  check.setAttribute("href", "/check.html");
  check.setAttribute("target", "_blank");
  check.setAttribute("rel", "noopener");
  card.append(reload, low, check);
  page.append(card);
  // 마우스가 게임에 잠겨 있으면 단추를 누를 수 없다
  doc.exitPointerLock?.();
  (doc.body ?? doc.documentElement).append(page);
}

/**
 * 플레이 도중의 끊김 · 그래픽 연결 생성 실패를 지켜본다. 한 번만 건다.
 * webglcontextlost 는 거품이 오르지 않아 잡는 단계로 받는다 — 문서에 붙은 캔버스만 온다(지원 검사용 임시 캔버스는 오지 않는다).
 */
export function watchGraphicsFailure({ lost = true, doc = document }: { lost?: boolean; doc?: Document } = {}) {
  const view = doc.defaultView;
  if (!view) return;
  // 본편은 끊김을 자기 화면(CrashOverlays — 사고 직전 기록 · 기록 복사)이 맡는다. 덮지 않게 lost: false 로 건다(Codex 리뷰 8)
  if (lost) doc.addEventListener("webglcontextlost", () => showGraphicsFailure("lost", doc), true);
  const isWebGlError = (reason: unknown) =>
    /Error creating WebGL context|WebGL context could not be created/i.test(
      String((reason as { message?: unknown } | null)?.message ?? reason ?? ""),
    );
  view.addEventListener("error", (event) => {
    if (isWebGlError(event.error ?? event.message)) showGraphicsFailure("unavailable", doc);
  });
  view.addEventListener("unhandledrejection", (event) => {
    if (isWebGlError(event.reason)) showGraphicsFailure("unavailable", doc);
  });
}
