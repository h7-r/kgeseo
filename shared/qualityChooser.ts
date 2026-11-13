/**
 * 처음 열 때의 그래픽 품질 고르기(미르 11/12) — 베타 참가자 대부분이 내장 그래픽 노트북이라, 3D 를 받기 전에 화면 가운데서 묻는다.
 * 고른 값은 저장돼 다시 묻지 않고 로비 · 나주에 똑같이 적용된다(설정 창 「그래픽 품질」에서 언제든 바꾼다).
 * 게임보다 먼저 묻는 까닭: 고르기도 전에 메모리가 모자라 멈추지 않게, 그리고 다시 열 필요 없이 바로 적용되게.
 * 두 화질이 다 준비돼 있다는 것, 끊기면 낮추면 된다는 것을 같이 알린다. DOM 으로 직접 그린다(게임 모듈 · React 없음).
 */
import { detectQuality, hasQualityChoice, readGpuName, saveQualityChoice, type QualityMode } from "./qualityChoice";

const TEXT = {
  title: "그래픽 품질을 골라 주세요",
  lead: "두 가지 화질을 준비했어요. 지금 쓰는 컴퓨터에 맞는 쪽을 골라 주세요.",
  recommended: "이 컴퓨터 추천",
  foot: "플레이 중 화면이 끊기거나 멈추면 저사양으로 낮춰 주세요. 설정(P) → 그래픽 품질에서 언제든 바꿀 수 있어요.",
  cards: {
    low: {
      name: "저사양",
      who: "인사교 노트북 · 내장 그래픽 노트북 권장",
      what: "그림체는 그대로 두고, 해상도와 빛 효과를 낮춰 가볍게 돌아가요.",
    },
    standard: {
      name: "보통",
      who: "일반 PC(외장 그래픽) 권장",
      what: "선명한 화면과 빛 효과를 모두 켠 화질이에요.",
    },
  } satisfies Record<QualityMode, { name: string; who: string; what: string }>,
};

const ORDER: readonly QualityMode[] = ["low", "standard"];

/**
 * 고른 적이 없으면 묻고, 고르면(저장한 뒤) 끝난다. 이미 골랐거나 주소로 정했으면(?q=) 바로 끝난다.
 * 개발 서버는 묻지 않는다 — 검사 스크립트가 멈추지 않게. 팝업을 보려면 주소에 ?quality=ask.
 */
export function askQualityOnce({ dev = false, doc = document }: { dev?: boolean; doc?: Document } = {}): Promise<void> {
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(doc.defaultView?.location.search ?? "");
  } catch {
    return Promise.resolve();
  }
  const isForced = query.get("quality") === "ask";
  if (!isForced && (query.has("q") || hasQualityChoice() || dev)) return Promise.resolve();

  const memory = (doc.defaultView?.navigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  const suggested = detectQuality(readGpuName(), memory);

  return new Promise((resolve) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string) => {
      const node = doc.createElement(tag);
      node.setAttribute("style", style);
      if (text) node.textContent = text;
      return node;
    };
    const page = el(
      "div",
      "position:fixed;inset:0;z-index:2147483630;display:flex;align-items:center;justify-content:center;padding:24px;" +
        "box-sizing:border-box;background:radial-gradient(120% 80% at 50% 20%,#18233d 0%,#070b16 70%);color:#eef2fb;overflow:auto;" +
        "font-family:Pretendard,'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif",
    );
    page.setAttribute("data-quality-chooser", "");
    page.setAttribute("role", "dialog");
    page.setAttribute("aria-label", TEXT.title);
    const box = el("div", "width:min(760px,100%);box-sizing:border-box;text-align:center");
    box.append(
      el("div", "font-size:28px;font-weight:700;line-height:1.35;margin-bottom:8px;word-break:keep-all", TEXT.title),
      el("div", "font-size:16px;line-height:1.6;color:#b9c3d8;margin-bottom:22px;word-break:keep-all", TEXT.lead),
    );
    const row = el("div", "display:flex;gap:16px;flex-wrap:wrap;justify-content:center");
    const choose = (mode: QualityMode) => {
      // 못 적어도 이번 판은 주소 옵션으로 적용한다(다음에 다시 묻는다)
      if (!saveQualityChoice(mode)) {
        const view = doc.defaultView;
        if (view) {
          const url = new URL(view.location.href);
          url.searchParams.set("q", mode);
          url.searchParams.delete("quality");
          view.location.replace(url.toString());
          return;
        }
      }
      page.remove();
      resolve();
    };
    for (const mode of ORDER) {
      const card = TEXT.cards[mode];
      const isSuggested = mode === suggested;
      const button = el(
        "button",
        "flex:1 1 300px;max-width:360px;min-height:210px;box-sizing:border-box;padding:22px 20px;border-radius:18px;cursor:pointer;" +
          "text-align:center;color:#eef2fb;font:inherit;background:rgba(16,22,38,.92);" +
          (isSuggested
            ? "border:2px solid #86a6f0;box-shadow:0 0 0 4px rgba(134,166,240,.16),0 18px 48px rgba(0,0,0,.45)"
            : "border:1px solid rgba(255,255,255,.22);box-shadow:0 18px 48px rgba(0,0,0,.35)"),
      );
      button.setAttribute("data-quality", mode);
      button.append(
        el(
          "div",
          "display:inline-block;min-height:22px;margin-bottom:10px;padding:2px 12px;border-radius:999px;font-size:13px;font-weight:600;" +
            (isSuggested ? "background:#86a6f0;color:#0b1020" : "visibility:hidden"),
          TEXT.recommended,
        ),
        el("div", "font-size:30px;font-weight:800;line-height:1.2;margin-bottom:10px", card.name),
        el("div", "font-size:16px;font-weight:600;line-height:1.5;color:#cdd8f3;margin-bottom:10px;word-break:keep-all", card.who),
        el("div", "font-size:14px;line-height:1.6;color:#b9c3d8;word-break:keep-all", card.what),
      );
      button.addEventListener("click", () => choose(mode));
      row.append(button);
    }
    box.append(row, el("div", "margin-top:22px;font-size:14px;line-height:1.7;color:#b9c3d8;word-break:keep-all", TEXT.foot));
    page.append(box);
    (doc.body ?? doc.documentElement).append(page);
  });
}
