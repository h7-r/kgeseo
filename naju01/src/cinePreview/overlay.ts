/**
 * cinePreview/overlay.ts — 나주 게임에 05b 장면 연출을 얹어 보는 미리보기 (10/27)
 *   본편 코드는 건드리지 않는다 — cine-preview.html 이 같은 게임(main.tsx)을 띄우고, 이 파일이 화면 위에 DOM 막과 3D 문을 얹는다.
 *
 * 10/27 미르(2): 「씬을 이동하다가 갑자기 시네마틱이나 씬을 비추는 연출이 나올 게 아니라, 다음 씬으로 가는 문·텔레포트·게이트가 있어야 한다」
 *               「씬마다 빙 둘러 비추는 연출(공간 훑기)과 시네마틱이 겹치지 않게 양자택일」
 *   흐름: 씬을 마친다(지금은 「씬 n 마치기」 단추 = 본편 개발 훅 endScene) → 그 자리 앞에 「왜곡의 문」이 열린다
 *        → 플레이어가 문으로 걸어 들어간다 → 화면이 어두워지고 다음 씬 자리로 옮겨진다
 *        → 다음 씬의 전환 방식(05b 가 정함) 하나만: cine = 이야기 컷(공간 훑기는 끔) / sweep = 공간 훑기 + 대본 자막(그림 컷 없음)
 *        → 🧭 「이 씬에서 무엇을 왜」
 * 10/27 미르(6): 「차단막을 넘어갈 때마다 스토리 이해를 돕는 시네마틱」 → 씬 사이 막을 걷으면 늘 이야기 컷. 공간 훑기는 그 씬의 다른 구역에 처음 들어설 때(본편 그대로).
 *               「시네마틱 음성」 → 컷마다 05b 가 만든 음성(voice_*.m4a)을 읽어 주고, 컷 넘김을 음성 길이에 맞춘다. 🔊/🔇 단추.
 *   씬 5 를 마치면 문 대신 결말 컷 → 새로 알게 된 것 · 아직 모르는 것 · 🔒 마지막 봉인(현장).
 */
import { INVESTIGATION_POINTS, PATHS, UNITS_PER_METER, ZONES } from "../plan/sitePlan";
import { settings, stage } from "../scene/immersion/state";

type Panel = { id: string; caption: string; img?: string; voice?: string };
type Intro = { scene_id: string; kind: "intro"; panels: Panel[]; goal: string; transition?: "cine" | "sweep"; sweep_line?: string };
type Ending = { kind: "ending"; panels: Panel[]; reveal: string; left_open?: string; field?: { place: string; seal: string; question?: string } };
type Doc = { cinematics: (Intro | Ending)[]; sceneTitles?: Record<string, string>; scriptReview?: { before: number; after: { target: string; fails?: string[]; why?: string }[] } | null };
type V3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => V3 };
type Naju = {
  endScene?: (n: number) => string;
  teleport?: { current: ((x: number, z: number, heading?: number) => void) | null };
  camera?: { position: V3 };
  scene?: { add: (o: unknown) => void; remove: (o: unknown) => void };
  terrain?: { groundAt: (x: number, z: number) => { y: number } };
  THREE?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  director?: { replayCut?: (code: string) => void };
};

const U = UNITS_PER_METER;
const q = new URLSearchParams(location.search);
const BASE = `/cine-preview/${q.get("cine") || "angam"}/`;
const w = window as unknown as { __game?: { naju?: Naju } };
const naju = () => w.__game?.naju;

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
.cp-sub{position:fixed;left:50%;bottom:9%;transform:translateX(-50%);z-index:2147482500;max-width:min(980px,90vw);color:#fff;font-size:clamp(16px,2.1vw,26px);line-height:1.6;text-align:center;text-shadow:0 2px 8px #000,0 0 2px #000;word-break:keep-all;pointer-events:none;transition:opacity .6s}
.cp-fade{position:fixed;inset:0;z-index:2147482800;background:#000;opacity:0;pointer-events:none;transition:opacity .7s}
.cp-dev{position:fixed;left:12px;bottom:12px;z-index:2147482000;display:flex;gap:6px;align-items:center;background:#000a;padding:6px 8px;border-radius:10px;font-size:12px;color:#ddd}
@keyframes cppan{from{object-position:0% 45%}to{object-position:100% 45%}}
@media (max-aspect-ratio:1/1){.cp-ov img{object-fit:cover}.cp-ov img.on{animation:cppan 8s ease-in-out forwards}}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
/** 「으로/로」 — 받침이 없거나 ㄹ 받침이면 「로」 */
const ro = (w: string) => { const ch = w.trim().slice(-1); if (/[0-9]/.test(ch)) return "036".includes(ch) ? "으로" : "로"; const c = ch.charCodeAt(0) - 0xac00; if (c < 0 || c > 11171) return "로"; const j = c % 28; return j === 0 || j === 8 ? "로" : "으로"; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let muted = (() => { try { return localStorage.getItem("cp-mute") === "1"; } catch { return false; } })();
function playCine(panels: Panel[], title: string): Promise<void> {
  return new Promise((done) => {
    if (!panels.length) { done(); return; }
    document.exitPointerLock?.();
    const ov = el("div", "cp-ov"); document.body.appendChild(ov);
    let i = 0, timer = 0, typer = 0, audio: HTMLAudioElement | null = null;
    const stopAudio = () => { if (audio) { audio.pause(); audio.src = ""; audio = null; } };
    const end = () => { clearTimeout(timer); clearInterval(typer); stopAudio(); ov.remove(); done(); };
    const next = () => { i++; step(); };
    const step = () => {
      stopAudio();
      if (i >= panels.length) { end(); return; }
      const p = panels[i];
      ov.innerHTML = `${p.img ? `<img src="${BASE}${esc(p.img)}" alt="">` : '<div class="cp-ph"></div>'}<div class="cp-top">${esc(title)} · ${i + 1} / ${panels.length}</div><div class="cp-band"><div class="cp-cap"></div><button class="cp-btn" data-n>${i < panels.length - 1 ? "다음 ▶" : "계속 ▶"}</button><button class="cp-btn" data-s>건너뛰기</button>${p.voice ? `<button class="cp-btn" data-m title="음성 켜기/끄기">${muted ? "🔇" : "🔊"}</button>` : ""}</div>`;
      const im = ov.querySelector("img, .cp-ph") as HTMLElement; const on = () => im.classList.add("on");
      if (im instanceof HTMLImageElement) { im.onload = on; im.onerror = on; if (im.complete) on(); } else setTimeout(on, 30);
      const cap = ov.querySelector(".cp-cap") as HTMLElement, txt = p.caption || "";
      // 글자는 음성 속도에 맞춰 찍는다(음성이 없으면 45ms/자)
      let perChar = 45; const t0 = performance.now();
      clearInterval(typer); typer = window.setInterval(() => { const k = Math.min(txt.length, Math.floor((performance.now() - t0) / perChar) + 1); cap.textContent = txt.slice(0, k); if (k >= txt.length) clearInterval(typer); }, 30);
      const silentWait = () => Math.max(4500, txt.length * 45 + 2600);
      clearTimeout(timer); timer = window.setTimeout(next, silentWait());
      if (p.voice && !muted) {
        const a = new Audio(`${BASE}${p.voice}`); audio = a;
        a.onloadedmetadata = () => { if (audio !== a || !isFinite(a.duration)) return; perChar = Math.max(25, (a.duration * 1000 * 0.92) / Math.max(1, txt.length)); clearTimeout(timer); timer = window.setTimeout(next, a.duration * 1000 + 1400); };
        a.play().catch(() => { /* 자동 재생이 막히면 글만 — 🔊 를 누르면 다시 */ });
      }
      (ov.querySelector("[data-n]") as HTMLElement).onclick = next;
      (ov.querySelector("[data-s]") as HTMLElement).onclick = end;
      const mb = ov.querySelector("[data-m]") as HTMLElement | null;
      if (mb) mb.onclick = () => { muted = !muted; try { localStorage.setItem("cp-mute", muted ? "1" : "0"); } catch { /* 저장 못 해도 이번 판은 그대로 */ } if (muted) { stopAudio(); mb.textContent = "🔇"; } else { i += 0; step(); } };
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
function toast(text: string, ms = 4500) { const t = el("div", "cp-goal", esc(text)); t.style.top = "auto"; t.style.bottom = "22%"; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
const fadeEl = el("div", "cp-fade");
async function fade(to: 0 | 1) { fadeEl.style.opacity = String(to); await sleep(750); }

function endingCard(e: Ending) {
  const f = e.field;
  const c = el("div", "cp-card", `<div><div style="font-size:12px;color:#6b5a40">이 판의 이야기를 모두 풀었다</div><b style="font-size:17px">새로 알게 된 것</b><div>${esc(e.reveal)}</div>${e.left_open ? `<div style="font-size:13px;color:#6b5a40;margin-top:6px">아직 모르는 것 — ${esc(e.left_open)}</div>` : ""}${f ? `<div class="cp-seal"><b>🔒 마지막 봉인 — 현장에서만 풀린다</b><div><b>${esc(f.place)}</b></div><div>${esc(f.seal)}</div>${f.question ? `<div style="font-size:13px;color:#6b5a40">현장에서 답할 물음: ${esc(f.question)}</div>` : ""}<div style="font-size:13px;color:#6b5a40">완주 보상: 현장 봉인을 풀면 특별 소품·지역 혜택(지역 화폐·할인권)</div></div>` : ""}<div style="text-align:right;margin-top:10px"><button class="cp-btn" style="color:#2b2116;border-color:#b9a173">닫기</button></div></div>`);
  document.body.appendChild(c); (c.querySelector("button") as HTMLElement).onclick = () => c.remove();
}

/** 씬 n 의 도착 자리(m) — 그 씬 첫 조사점, 그 씬이 걸친 첫 구역 코드 */
function arrival(n: number): { x: number; z: number; zones: string[] } {
  const p = INVESTIGATION_POINTS.find((v) => v.scene === n)?.points[0] ?? [18, 38];
  const zones = ZONES.filter((z) => z.scenes.split(/\s*·\s*/).includes(`S${n}`)).map((z) => z.code);
  return { x: p[0], z: p[1], zones };
}
function zoneAt(x: number, z: number) { return ZONES.find((v) => x >= v.x[0] && x <= v.x[1] && z >= v.z[0] && z <= v.z[1])?.code; }

// ── 「왜곡의 막」(10/27 미르(4): 「원형 고리 말고, 다음 씬으로 넘어가는 길 입구를 다음 씬의 모습이 가려진 흐릿한 가림막으로 전부 막아 두고,
//     상호작용해야 할 것처럼 연출 — 상호작용하면 다음 씬 시작 지점으로 바로 이동」) ──
//   다음 씬으로 이어지는 통로 들머리마다 막을 처음부터 세워 둔다(흐릿하게 일렁이는 안개 막 — 건너편이 보이지 않는다).
//   씬을 마치기 전: 잿빛으로 탁하고, 다가가면 「🔒 왜곡의 막이 단단하다 — 씬 n 의 조사를 마쳐야 걷힌다」. 지나가려 하면 막 앞으로 밀려난다.
//   씬을 마치면: 그 막만 보랏빛으로 맥동하고 빛 알갱이가 오른다. 다가가면 「[E] 왜곡의 막을 걷어 낸다」 → 막이 흩어지고 → 다음 씬 시작 지점으로.
//   막 자리(통로 들머리): 씬1→2 T2 강변 우회 비탈(→진부촌 능선) · 씬2→3 T3 북측 스위치백(→바위 위) · 씬3→4 T4 서측 하강로(→나루터) · 씬4→5 T2 들머리(다시 막힌 자리).
//   T1 바위틈(Z1↔Z2)은 씬1·씬4 안에서 오가는 길 — 잠그지 않는 「이동막」(10/27 미르(5): 「나루터에서 바위 아래 자갈밭으로 갈 때에도 이동막」).
//     늘 열려 있고 양쪽에서 걷어 낼 수 있다. 앞(나루터 쪽) → 자갈밭 들머리, 뒤(자갈밭 쪽) → 나루터 들머리. 씬은 바뀌지 않는다.
type Veil = { group: any; plane: any; tex: any; label: any; motes: any; x: number; z: number; nx: number; nz: number; w: number; to: number; from: number; open: boolean; gone: boolean; link?: Link }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Link = { path: string; front: string; back: string; frontTo: [number, number]; backTo: [number, number] };
const LINKS: Link[] = [{ path: "T1", front: "나루터 · 시작 테라스", back: "바위 아래 · 자갈밭", frontTo: [37, 40], backTo: [25.5, 36.5] }];
const veils: Veil[] = [];
const VEIL_AT: { from: number; path: string }[] = [{ from: 1, path: "T2" }, { from: 2, path: "T3" }, { from: 3, path: "T4" }, { from: 4, path: "T2" }];
function labelTex(T: any, text: string, open: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128; const c = cv.getContext("2d")!;
  c.fillStyle = open ? "rgba(40,20,80,0.82)" : "rgba(30,30,30,0.62)"; c.beginPath(); c.roundRect(8, 16, 496, 96, 40); c.fill();
  c.fillStyle = open ? "#f1e8ff" : "#cfcfcf"; c.font = "bold 40px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, 256, 66);
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
}
function veilTex(T: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 흐릿한 안개 막 — 가운데가 짙고 가장자리로 갈수록 옅다. 반복 무늬라 결을 흘려 일렁이게 한다
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c = cv.getContext("2d")!;
  c.fillStyle = "rgba(214,211,228,0.9)"; c.fillRect(0, 0, 256, 256); for (let k = 0; k < 40; k++) { const x = Math.random() * 256; c.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`; c.fillRect(x, 0, 2 + Math.random() * 6, 256); } /* 늘어뜨린 천처럼 세로 결 */
  for (let k = 0; k < 160; k++) { const x = Math.random() * 256, y = Math.random() * 256, r = 18 + Math.random() * 46; const g = c.createRadialGradient(x, y, 0, x, y, r); const a = 0.08 + Math.random() * 0.16; g.addColorStop(0, `rgba(245,242,255,${a})`); g.addColorStop(1, "rgba(245,242,255,0)"); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
}
function maskTex(T: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128; const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(64, 70, 10, 64, 70, 70); g.addColorStop(0, "#fff"); g.addColorStop(0.75, "#f0f0f0"); g.addColorStop(1, "#111"); c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(cv);
}
function cloudMask(T: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 구름 덩어리 모양 — 가운데는 꽉 차고 가장자리는 들쭉날쭉한 안개 자락. 알파 0.45 를 넘는 곳만 「막」으로 남아 깊이를 쓴다
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c = cv.getContext("2d")!; c.fillStyle = "#000"; c.fillRect(0, 0, 256, 256);
  const core = c.createRadialGradient(128, 140, 20, 128, 140, 120); core.addColorStop(0, "rgba(255,255,255,1)"); core.addColorStop(0.7, "rgba(255,255,255,0.8)"); core.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = core; c.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 70; k++) { const a = Math.random() * Math.PI * 2, rr = 70 + Math.random() * 50; const x = 128 + Math.cos(a) * rr, y = 140 + Math.sin(a) * rr * 0.95; const r = 14 + Math.random() * 26; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${0.5 + Math.random() * 0.5})`); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
  return new T.CanvasTexture(cv);
}
function buildVeils(titleOf: (n: number) => string) {
  const g = naju(); const T = g?.THREE; if (!g || !T || !g.scene) return;
  const alpha = maskTex(T), cloud = cloudMask(T);
  const specs: { from: number; path: string; link?: Link }[] = [...VEIL_AT, ...LINKS.map((l) => ({ from: 0, path: l.path, link: l }))];
  for (const { from, path, link } of specs) {
    const P = PATHS.find((v) => v.code === path); if (!P) continue;
    const [a, b] = P.points; let nx = b[0] - a[0], nz = b[1] - a[1]; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
    const x = a[0] + nx * 0.8, z = a[1] + nz * 0.8; const y = g.terrain?.groundAt(x, z).y ?? 0; const w = P.width + 4, h = 7; // 오르막 길 너머 언덕까지 가리게 넉넉히
    const tex = veilTex(T); tex.repeat.set(1.5, 1);
    // 막 = 꽉 찬 안개 덩어리(알파 잘라 깊이를 씀 → 만화 외곽선이 막 너머 선을 덧그리지 않고, 덩어리 가장자리만 먹선처럼 그린다) + 둘레 옅은 안개 자락
    const plane = new T.Mesh(new T.PlaneGeometry(w * U, h * U), new T.MeshBasicMaterial({ map: tex, alphaMap: cloud, alphaTest: 0.45, transparent: false, depthWrite: true, fog: false, toneMapped: false, side: T.DoubleSide, color: link ? 0xb9d3e3 : 0xb4b2c0 }));
    plane.position.y = (h / 2 - 0.2) * U;
    const back = new T.Mesh(new T.PlaneGeometry(w * 1.25 * U, h * 1.15 * U), new T.MeshBasicMaterial({ map: tex, alphaMap: alpha, transparent: true, opacity: 0.55, depthWrite: false, fog: false, toneMapped: false, side: T.DoubleSide, color: 0xc8c6d4 })); back.position.set(0, (h / 2 - 0.2) * U, 0.3 * U); // 둘레 옅은 자락(앞쪽)
    const label = new T.Sprite(new T.SpriteMaterial({ map: link ? labelTex(T, `🌫 ${link.front.split(" ·")[0]} ↔ ${link.back.split(" ·")[0]}`, false) : labelTex(T, `🔒 씬 ${from + 1} · ${titleOf(from + 1)}`, false), fog: false, depthTest: false, toneMapped: false, transparent: true, opacity: 0.85 }));
    label.scale.set(4 * U, 1 * U, 1); label.position.y = (h + 0.5) * U; label.renderOrder = 999;
    const mg = new T.BufferGeometry(); const N = 60, pos = new Float32Array(N * 3); for (let k = 0; k < N; k++) { pos[k * 3] = (Math.random() - 0.5) * w * U; pos[k * 3 + 1] = Math.random() * h * U; pos[k * 3 + 2] = (Math.random() - 0.5) * 0.6 * U; }
    mg.setAttribute("position", new T.BufferAttribute(pos, 3));
    const motes = new T.Points(mg, new T.PointsMaterial({ map: (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d")!; const gg = x.createRadialGradient(16, 16, 0, 16, 16, 16); gg.addColorStop(0, "rgba(255,255,255,1)"); gg.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gg; x.fillRect(0, 0, 32, 32); return new T.CanvasTexture(c); })(), color: 0xd9c8ff, size: 0.18 * U, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false, blending: T.AdditiveBlending }));
    motes.visible = !!link; if (link) motes.material.color.set(0xd2f0ff);
    const group = new T.Group(); group.name = link ? `cinePreview.link.${path}` : `cinePreview.veil.${from}`; group.add(back, plane, motes, label);
    group.position.set(x * U, y * U, z * U); group.rotation.y = Math.atan2(nx, nz);
    group.visible = !!link || from === 1 || from === 2 || from === 3; // 씬4→5 막(T2 들머리)은 씬1→2 막을 지난 뒤 다시 세운다
    g.scene.add(group); veils.push({ group, plane, tex, label, motes, x, z, nx, nz, w, to: from + 1, from, open: !!link, gone: false, link });
  }
}
function openVeil(from: number, titleOf: (n: number) => string) {
  const v = veils.find((q) => !q.link && q.from === from && !q.gone); const T = naju()?.THREE; if (!v || !T) return;
  v.open = true; v.group.visible = true; v.motes.visible = true; v.plane.material.color.set(0xc9b6ff);
  v.label.material.map = labelTex(T, `🌀 씬 ${v.to} · ${titleOf(v.to)}`, true); v.label.material.needsUpdate = true;
  toast(`🌀 「씬 ${v.to}」${ro(String(v.to))} 가는 길을 가린 「왜곡의 막」이 흔들리기 시작했다 — 보랏빛으로 일렁이는 막에 다가가 걷어 내라`, 6500);
}
const prompt = el("div", "cp-goal"); prompt.style.top = "auto"; prompt.style.bottom = "16%"; prompt.style.display = "none";

async function main() {
  document.head.appendChild(el("style", "", css)); document.body.appendChild(fadeEl);
  let doc: Doc;
  try { doc = await (await fetch(BASE + "cinematics.json")).json(); } catch { console.warn("cine-preview: cinematics.json 없음", BASE); return; }
  const intros = doc.cinematics.filter((c): c is Intro => c.kind === "intro");
  const ending = doc.cinematics.find((c): c is Ending => c.kind === "ending");
  const title = (sid: string) => doc.sceneTitles?.[sid] || sid;
  const modeOf = (it?: Intro) => (it?.transition || ((it?.panels?.length || 0) ? "cine" : "sweep")) as "cine" | "sweep";

  for (let k = 0; k < 240 && !naju()?.endScene; k++) await sleep(500);
  await sleep(2500);

  /** 씬 n 들어가기 — 전환 방식 하나만 */
  const enterScene = async (n: number, first: boolean) => {
    const it = intros.find((c) => c.scene_id === `scene-0${n}`); const mode = modeOf(it); const a = arrival(n);
    if (mode === "cine") {
      // 이야기 컷이 이 씬 도착의 연출 — 도착 구역만 「이미 본 것」으로(공간 훑기와 겹치지 않게). 이 씬의 다른 구역은 처음 들어설 때 본편이 훑는다
      { const z0 = zoneAt(a.x, a.z) || a.zones[0]; if (z0) stage.visitedZones.add(z0); }
      if (!first) { naju()?.teleport?.current?.(a.x, a.z); await sleep(300); }
      if (it) await playCine(it.panels, `씬 ${n} · ${title(it.scene_id)}`);
      await fade(0);
    } else {
      // 공간 훑기가 이 씬의 연출 — 그림 컷 없이, 훑는 동안 대본 한 줄을 자막으로
      settings.시점컷 = true;
      const z0 = zoneAt(a.x, a.z) || a.zones[0];
      if (z0) stage.visitedZones.delete(z0);
      if (!first) { naju()?.teleport?.current?.(a.x, a.z); }
      await fade(0);
      const line = it?.sweep_line || it?.panels?.[0]?.caption || "";
      if (line) {
        // 공간 훑기는 플레이 중(마우스 잠금)일 때 그 구역 첫 진입에서 본편이 연다 — 열리면 그 동안, 안 열리면 4.5초 자막
        for (let k = 0; k < 30 && !stage.cut; k++) await sleep(100);
        const sub = el("div", "cp-sub", esc(line)); document.body.appendChild(sub);
        if (stage.cut) { for (let k = 0; k < 80 && stage.cut; k++) await sleep(100); await sleep(400); } else await sleep(4500);
        sub.style.opacity = "0"; setTimeout(() => sub.remove(), 700);
      }
    }
    if (it) showGoal(it.goal);
  };

  const titleOf = (n: number) => title(`scene-0${n}`);
  buildVeils(titleOf); document.body.appendChild(prompt);
  let current = 1;
  await enterScene(1, true);

  const dev = el("div", "cp-dev"); document.body.appendChild(dev);
  const render = () => {
    const nextMode = current < 5 ? modeOf(intros.find((c) => c.scene_id === `scene-0${current + 1}`)) : null;
    const gate = veils.find((v) => !v.link && v.open && !v.gone);
    dev.innerHTML = current <= 5
      ? `미리보기 · 지금 씬 ${current}${gate ? ` · 막이 흔들림 → 씬 ${gate.to}(${nextMode === "cine" ? "이야기 컷" : "공간 훑기"})` : ""} <button class="cp-btn">${gate ? "막 앞으로 옮기기" : `씬 ${current} 마치기 ▶`}</button><button class="cp-btn" data-look>막 자리 보기</button>`
      : `미리보기 · 완주 <button class="cp-btn">결말 다시 보기</button>`;
    const sr = doc.scriptReview; if (sr) { const left = sr.after?.length || 0; const b = el("span", "", ` · 대본 검수 ${sr.before}→${left}건`); b.style.cursor = "help"; b.title = (sr.after || []).map((x) => `${x.target} [${(x.fails || []).join(",")}] ${x.why || ""}`).join("\n") || "걸린 것 없음"; dev.appendChild(b); }
    const look = dev.querySelector("[data-look]") as HTMLElement | null; if (look) look.onclick = () => { const v = veils.find((q) => !q.link && q.from === current && !q.gone); if (v) naju()?.teleport?.current?.(v.x - v.nx * 6, v.z - v.nz * 6); };
    (dev.querySelector("button") as HTMLElement).onclick = async () => {
      if (current > 5) { if (ending) { await playCine(ending.panels, "이야기의 끝"); endingCard(ending); } return; }
      if (gate) { naju()?.teleport?.current?.(gate.x - gate.nx * 2.2, gate.z - gate.nz * 2.2); return; } // 시험용: 막 바로 앞으로
      try { naju()?.endScene?.(current); } catch (e) { console.warn(e); }
      if (current === 5) { current = 6; render(); goalEl?.remove(); if (ending) { await playCine(ending.panels, "이야기의 끝"); endingCard(ending); } return; }
      openVeil(current, titleOf); render();
    };
  };
  render();

  // 막 판정 — 앞(씬 쪽)에서 2.6 m 안이면 안내. 열린 막은 E(또는 안내 단추)로 걷는다. 막을 뚫고 지나가려 하면 앞으로 밀어낸다
  let near: Veil | null = null, nearBack = false, busy = false, promptKey = "", pushToast = 0;
  const lift = async (v: Veil, back = false) => {
    if (busy) return; busy = true; prompt.style.display = "none";
    const t0 = performance.now(); await new Promise<void>((res) => { const f = () => { const k = Math.min(1, (performance.now() - t0) / 900); v.plane.material.alphaTest = 0.45 + 0.55 * k; v.plane.material.needsUpdate = true; v.group.children[0].material.opacity = 0.55 * (1 - k); v.group.scale.set(1 + k * 0.3, 1 + k * 0.1, 1); if (k < 1) requestAnimationFrame(f); else res(); }; f(); });
    if (v.link) {
      // 이동막 — 건너편 들머리로 옮기고 막은 다시 선다(씬은 그대로)
      const L = v.link; const [tx, tz] = back ? L.backTo : L.frontTo;
      await fade(1); naju()?.teleport?.current?.(tx, tz);
      v.plane.material.alphaTest = 0.45; v.plane.material.needsUpdate = true; v.group.children[0].material.opacity = 0.55; v.group.scale.set(1, 1, 1);
      await sleep(250); await fade(0); toast(`🌫 ${back ? L.front : L.back}`, 2500); busy = false; return;
    }
    v.gone = true; v.group.visible = false;
    await fade(1); current = v.to; render(); goalEl?.remove();
    if (v.to === 4) { const v4 = veils.find((q) => !q.link && q.from === 4); if (v4) v4.group.visible = true; } // 씬4 에서 T2 들머리를 다시 막는다
    await enterScene(v.to, false); busy = false;
  };
  window.addEventListener("keydown", (e) => { if ((e.code === "KeyE" || e.key === "e" || e.key === "ㄷ") && near?.open && !busy) { e.preventDefault(); lift(near, nearBack); } });
  const tick = () => {
    const g = naju(); const t = performance.now() / 1000;
    near = null; nearBack = false;
    if (g?.camera) {
      const px = g.camera.position.x / U, pz = g.camera.position.z / U;
      for (const v of veils) {
        if (v.gone || !v.group.visible) continue;
        v.tex.offset.x = t * 0.03; v.tex.offset.y = Math.sin(t * 0.4) * 0.05;
        if (v.open) { const k = 0.5 + 0.5 * Math.sin(t * 2.2); if (!v.link) v.plane.material.color.setRGB(0.72 + 0.15 * k, 0.62 + 0.1 * k, 1); const ps = v.motes.geometry.attributes.position; for (let i = 0; i < ps.count; i++) { let y = ps.getY(i) + 0.02 * U; if (y > 7 * U) y = 0; ps.setY(i, y); } ps.needsUpdate = true; }
        // 막 기준 좌표 — 앞뒤(along: 씬 쪽이 음수) · 옆(side)
        const dx = px - v.x, dz = pz - v.z; const along = dx * v.nx + dz * v.nz, side = -dx * v.nz + dz * v.nx;
        if (v.link) {
          // 양쪽에서 오는 막 — 가로지르지 못하게 온 쪽으로 밀고, 앞뒤 어느 쪽에서든 걷어 낼 수 있다
          if (Math.abs(side) <= v.w / 2 + 0.3 && Math.abs(along) < 0.6 && !busy) { const s = along >= 0 ? 1 : -1; g.teleport?.current?.(v.x + v.nx * 1.2 * s, v.z + v.nz * 1.2 * s); }
          if (Math.abs(side) <= v.w / 2 + 0.6 && Math.abs(along) >= 0.6 && Math.abs(along) < 3.4) { near = v; nearBack = along > 0; }
          continue;
        }
        if (Math.abs(side) <= v.w / 2 + 0.3 && along > -0.4 && along < 1.5 && !busy) { g.teleport?.current?.(v.x - v.nx * 1.2 + -v.nz * side * 0, v.z - v.nz * 1.2); if (!v.open && performance.now() - pushToast > 4000) { pushToast = performance.now(); toast(`🔒 왜곡의 막이 단단하다 — 씬 ${v.from}의 조사를 마쳐야 걷힌다`, 2500); } } // 뚫고 지나가지 못하게
        if (Math.abs(side) <= v.w / 2 + 0.6 && along <= -0.4 && along > -3.4) near = v;
      }
    }
    const key = near && !busy ? `${near.link?.path || near.from}:${near.open}:${nearBack}` : "";
    if (key !== promptKey) { promptKey = key; if (near && !busy) { prompt.style.display = ""; prompt.innerHTML = near.link ? `🌫 <b>[E]</b> 안개 막을 지나 「${esc(nearBack ? near.link.front : near.link.back)}」${ro(nearBack ? near.link.front : near.link.back)} <button class="cp-btn" data-lift>지나가기</button>` : near.open ? `🌀 <b>[E]</b> 왜곡의 막을 걷어 낸다 — 씬 ${near.to}${ro(String(near.to))} <button class="cp-btn" data-lift>걷어 내기</button>` : `🔒 왜곡의 막이 단단하다 — 씬 ${near.from}의 조사를 마쳐야 걷힌다`; const bt = prompt.querySelector("[data-lift]") as HTMLElement | null; const nv = near, nb = nearBack; if (bt) bt.onclick = () => lift(nv, nb); }
    else prompt.style.display = "none"; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
main();
