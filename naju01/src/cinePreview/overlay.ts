/**
 * cinePreview/overlay.ts — 나주 게임에 05b 장면 연출(이야기 컷·결말·현장 봉인)을 얹어 보는 미리보기 (10/27 미르: 「나주 게임에도 적용이 가능하다면 어떤 식일지 보고 싶다」)
 *   본편 코드는 건드리지 않는다 — cine-preview.html 이 같은 게임(main.tsx)을 띄우고, 이 파일이 화면 위에 DOM 막을 얹는다.
 *   · 게임을 켜면: 씬 1 이야기 컷 → 「이 씬에서 무엇을 왜」
 *   · 씬을 마치면(개발 훅 __game.naju.endScene(n) — 씬 진행 장치가 아직 없어 화면 아래 「씬 n 마치기」 단추로 부른다): 다음 씬 이야기 컷
 *   · 씬 5 를 마치면: 결말 컷 → 새로 알게 된 것 · 아직 모르는 것 · 🔒 마지막 봉인(현장)
 *   자료: /cine-preview/cinematics.json (05b 결과) + 같은 폴더의 그림. 주소 ?cine=<폴더> 로 다른 결과를 고를 수 있다.
 */
type Panel = { id: string; caption: string; img?: string };
type Intro = { scene_id: string; kind: "intro"; panels: Panel[]; goal: string };
type Ending = { kind: "ending"; panels: Panel[]; reveal: string; left_open?: string; field?: { place: string; seal: string; question?: string } };
type Doc = { cinematics: (Intro | Ending)[]; sceneTitles?: Record<string, string> };

const q = new URLSearchParams(location.search);
const BASE = `/cine-preview/${q.get("cine") || "angam"}/`;

const css = `
.cp-ov{position:fixed;inset:0;z-index:2147483000;background:#000;color:#f3ead6;font-family:"Pretendard","Apple SD Gothic Neo",system-ui,sans-serif}
.cp-ov img,.cp-ov .cp-ph{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 1.2s}.cp-ov .on{opacity:1}
.cp-top{position:absolute;top:0;left:0;right:0;padding:14px 22px;font-size:13px;letter-spacing:.08em;color:#bfb29a;background:linear-gradient(#000c,#0000)}
.cp-band{position:absolute;left:0;right:0;bottom:0;padding:48px 6vw 22px;background:linear-gradient(#0000,#000d 38%,#000f);text-align:center}
.cp-cap{min-height:3.4em;margin:0 auto 12px;max-width:1100px;font-size:clamp(16px,2.3vw,28px);line-height:1.6;text-shadow:0 2px 6px #000;word-break:keep-all}
.cp-btn{background:#ffffff1f;color:#f3ead6;border:1px solid #ffffff40;border-radius:999px;padding:6px 16px;font-size:14px;cursor:pointer;margin:0 5px}
.cp-card{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#000a}
.cp-card>div{width:min(560px,92vw);background:#f4ead2;color:#2b2116;border:1px solid #b9a173;border-radius:12px;padding:18px 20px;font-size:15px;line-height:1.6}
.cp-seal{margin-top:12px;border:1px solid #8a6a3a;background:#fbf4e4;border-radius:10px;padding:10px 12px}
.cp-goal{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147482000;max-width:min(720px,92vw);background:#1b1610e6;color:#f3ead6;border:1px solid #b9a17366;border-radius:10px;padding:10px 16px;font-size:15px;line-height:1.5;transition:opacity .8s}
.cp-dev{position:fixed;left:12px;bottom:12px;z-index:2147482000;display:flex;gap:6px;align-items:center;background:#000a;padding:6px 8px;border-radius:10px;font-size:12px;color:#ddd}
@keyframes cppan{from{object-position:0% 45%}to{object-position:100% 45%}}
@media (max-aspect-ratio:1/1){.cp-ov img{object-fit:cover}.cp-ov img.on{animation:cppan 8s ease-in-out forwards}}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function playCine(panels: Panel[], title: string): Promise<void> {
  return new Promise((done) => {
    if (!panels.length) { done(); return; }
    document.exitPointerLock?.();
    const ov = el("div", "cp-ov"); document.body.appendChild(ov);
    let i = 0, timer = 0, typer = 0;
    const end = () => { clearTimeout(timer); clearInterval(typer); ov.remove(); done(); };
    const step = () => {
      if (i >= panels.length) { end(); return; }
      const p = panels[i];
      ov.innerHTML = `${p.img ? `<img src="${BASE}${esc(p.img)}" alt="">` : '<div class="cp-ph"></div>'}<div class="cp-top">${esc(title)} · ${i + 1} / ${panels.length}</div><div class="cp-band"><div class="cp-cap"></div><button class="cp-btn" data-n>${i < panels.length - 1 ? "다음 ▶" : "계속 ▶"}</button><button class="cp-btn" data-s>건너뛰기</button></div>`;
      const im = ov.querySelector("img, .cp-ph") as HTMLElement; const on = () => im.classList.add("on");
      if (im instanceof HTMLImageElement) { im.onload = on; im.onerror = on; if (im.complete) on(); } else setTimeout(on, 30);
      const cap = ov.querySelector(".cp-cap") as HTMLElement, txt = p.caption || ""; let k = 0;
      clearInterval(typer); typer = window.setInterval(() => { k++; cap.textContent = txt.slice(0, k); if (k >= txt.length) clearInterval(typer); }, 45);
      (ov.querySelector("[data-n]") as HTMLElement).onclick = () => { i++; step(); };
      (ov.querySelector("[data-s]") as HTMLElement).onclick = end;
      clearTimeout(timer); timer = window.setTimeout(() => { i++; step(); }, Math.max(4500, txt.length * 45 + 2600));
    };
    step();
  });
}

let goalEl: HTMLElement | null = null;
function showGoal(text: string) {
  goalEl?.remove(); if (!text) return;
  goalEl = el("div", "cp-goal", `🧭 ${esc(text)}`); document.body.appendChild(goalEl);
  const g = goalEl; setTimeout(() => { g.style.opacity = "0.55"; }, 9000);
}

function endingCard(e: Ending) {
  const f = e.field;
  const c = el("div", "cp-card", `<div><div style="font-size:12px;color:#6b5a40">이 판의 이야기를 모두 풀었다</div><b style="font-size:17px">새로 알게 된 것</b><div>${esc(e.reveal)}</div>${e.left_open ? `<div style="font-size:13px;color:#6b5a40;margin-top:6px">아직 모르는 것 — ${esc(e.left_open)}</div>` : ""}${f ? `<div class="cp-seal"><b>🔒 마지막 봉인 — 현장에서만 풀린다</b><div><b>${esc(f.place)}</b></div><div>${esc(f.seal)}</div>${f.question ? `<div style="font-size:13px;color:#6b5a40">현장에서 답할 물음: ${esc(f.question)}</div>` : ""}<div style="font-size:13px;color:#6b5a40">완주 보상: 현장 봉인을 풀면 특별 소품·지역 혜택(지역 화폐·할인권)</div></div>` : ""}<div style="text-align:right;margin-top:10px"><button class="cp-btn" style="color:#2b2116;border-color:#b9a173">닫기</button></div></div>`);
  document.body.appendChild(c); (c.querySelector("button") as HTMLElement).onclick = () => c.remove();
}

async function main() {
  document.head.appendChild(el("style", "", css));
  let doc: Doc;
  try { doc = await (await fetch(BASE + "cinematics.json")).json(); } catch { console.warn("cine-preview: cinematics.json 없음", BASE); return; }
  const intros = doc.cinematics.filter((c): c is Intro => c.kind === "intro");
  const ending = doc.cinematics.find((c): c is Ending => c.kind === "ending");
  const title = (sid: string) => doc.sceneTitles?.[sid] || sid;
  const playScene = async (n: number) => {
    const it = intros.find((c) => c.scene_id === `scene-0${n}`);
    if (!it) return;
    await playCine(it.panels, `씬 ${n} · ${title(it.scene_id)}`);
    showGoal(it.goal);
  };
  // 게임이 서고(개발 훅이 생기고) 로딩 막이 걷힐 때까지 기다린다
  const w = window as unknown as { __game?: { naju?: { endScene?: (n: number) => string } } };
  for (let k = 0; k < 240 && !w.__game?.naju?.endScene; k++) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 2500));
  let current = 1;
  await playScene(1);
  // 씬 진행 장치가 아직 없어 개발 단추로 씬을 마친다(본편의 endScene 그대로 — 막힌 길이 무너져 열린다)
  const dev = el("div", "cp-dev"); document.body.appendChild(dev);
  const render = () => {
    dev.innerHTML = current <= 5 ? `미리보기 · 지금 씬 ${current} <button class="cp-btn">씬 ${current} 마치기 ▶</button>` : `미리보기 · 완주 <button class="cp-btn">결말 다시 보기</button>`;
    (dev.querySelector("button") as HTMLElement).onclick = async () => {
      if (current > 5) { if (ending) { await playCine(ending.panels, "이야기의 끝"); endingCard(ending); } return; }
      try { w.__game?.naju?.endScene?.(current); } catch (e) { console.warn(e); }
      current++;
      render();
      if (current <= 5) await playScene(current);
      else if (ending) { goalEl?.remove(); await playCine(ending.panels, "이야기의 끝"); endingCard(ending); }
    };
  };
  render();
}
main();
