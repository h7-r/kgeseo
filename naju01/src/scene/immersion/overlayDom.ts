/**
 * overlayDom.ts — DOM: 레터박스 · 설정판(O) · 첫 안내 (옛 몰입연출.jsx 이식)
 *
 * [옛 이름 → 새 이름]
 *   레터박스 → setLetterbox · 설정판토글 → toggleSettingsPanel · 첫안내 → showFirstNotice
 *   띠위/띠아래 → barTop/barBottom · 설정판 → panel · window.__연출안내 → noticeShown(모듈 변수)
 */
import { audio } from "./audio";
import { saveSettings, settings, type ImmersionSettings } from "./state";

let barTop: HTMLDivElement | null = null;
let barBottom: HTMLDivElement | null = null;
let barTimer = 0;
/** 위아래 검은 띠(9vh). offMs 를 주면 그 뒤 저절로 걷힌다. */
export function setLetterbox(on: boolean, offMs?: number) {
  if (typeof document === "undefined") return;
  if (!barTop || !barBottom) {
    const bar = (top: boolean) => {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;left:0;right:0;${top ? "top" : "bottom"}:0;height:0;background:#000;z-index:30;pointer-events:none;transition:height .45s ease`;
      document.body.appendChild(d);
      return d;
    };
    barTop = bar(true);
    barBottom = bar(false);
  }
  barTop.style.height = barBottom.style.height = on ? "9vh" : "0";
  clearTimeout(barTimer);
  if (on && offMs) barTimer = window.setTimeout(() => setLetterbox(false), offMs);
}

let panel: HTMLDivElement | null = null;
/** 연출 설정판 (O 키) — 소리 크기 · 흔들림 · 진입 컷 · 바람 · 날씨 */
export function toggleSettingsPanel() {
  if (!panel) {
    panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;right:16px;top:56px;z-index:40;background:rgba(18,18,26,.92);color:#e8e6f0;font:13px/1.6 'Noto Sans KR',sans-serif;padding:12px 14px;border-radius:10px;border:1px solid #3a3550;min-width:230px;display:none";
    const row = (label: string, input: HTMLInputElement) => {
      const l = document.createElement("label");
      l.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;margin:4px 0";
      l.append(label, input);
      panel!.appendChild(l);
    };
    const title = document.createElement("div");
    title.textContent = "연출 설정 (O)";
    title.style.cssText = "font-weight:700;margin-bottom:4px";
    panel.appendChild(title);
    const range = (key: "볼륨" | "흔들림", after?: () => void) => {
      const i = document.createElement("input");
      i.type = "range";
      i.min = "0";
      i.max = "1";
      i.step = "0.05";
      i.value = String(settings[key]);
      i.oninput = () => {
        settings[key] = +i.value;
        saveSettings();
        after?.();
      };
      return i;
    };
    const check = (key: keyof Pick<ImmersionSettings, "시점컷" | "바람" | "날씨">) => {
      const i = document.createElement("input");
      i.type = "checkbox";
      i.checked = !!settings[key];
      i.onchange = () => {
        settings[key] = i.checked;
        saveSettings();
      };
      return i;
    };
    row("소리 크기", range("볼륨", () => audio.applyVolume()));
    row("화면 흔들림", range("흔들림"));
    row("구역 진입 컷", check("시점컷"));
    row("바람 흔들림", check("바람"));
    row("날씨 효과", check("날씨"));
    const note = document.createElement("div");
    note.style.cssText = "opacity:.65;font-size:11px;margin-top:6px";
    note.textContent = "흔들림 0 이면 돌리줌도 꺼진다 · 화면을 한 번 누르면 소리가 켜진다";
    panel.appendChild(note);
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(panel);
  }
  panel.style.display = panel.style.display === "none" ? "block" : "none";
}

let noticeShown = false;
/** 「화면을 누르면 소리가 켜집니다 · O 연출 설정」 — 한 번만 */
export function showFirstNotice() {
  if (typeof document === "undefined" || noticeShown) return;
  noticeShown = true;
  const d = document.createElement("div");
  d.textContent = "화면을 누르면 소리가 켜집니다 · O 연출 설정";
  d.style.cssText =
    "position:fixed;left:50%;bottom:12%;transform:translateX(-50%);color:#e8e2ff;font:500 13px 'Noto Sans KR',sans-serif;background:rgba(20,18,30,.6);padding:6px 12px;border-radius:14px;z-index:25;pointer-events:none;transition:opacity 1s";
  document.body.appendChild(d);
  setTimeout(() => (d.style.opacity = "0"), 6000);
  setTimeout(() => d.remove(), 7200);
}
