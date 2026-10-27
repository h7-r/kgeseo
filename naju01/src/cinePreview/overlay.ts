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
 *   씬 5 를 마치면 문 대신 결말 컷 → 새로 알게 된 것 · 아직 모르는 것 · 🔒 마지막 봉인(현장).
 */
import { INVESTIGATION_POINTS, UNITS_PER_METER, ZONES } from "../plan/sitePlan";
import { settings, stage } from "../scene/immersion/state";

type Panel = { id: string; caption: string; img?: string };
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ── 「왜곡의 문」(10/27 미르(3): 「씬과 씬 사이에 문 같은 게 안 보인다」) ──
//   씬 1~4 의 끝자리마다 문을 처음부터 세워 둔다. 씬을 마치기 전에는 잿빛으로 닫혀 있고(가까이 가면 「아직 잠겨 있다」),
//   씬을 마치면 보라빛으로 열리며 하늘로 빛기둥이 솟아 멀리서도 보인다. 열린 문으로 걸어 들어가면 다음 씬으로.
//   자리 = 그 씬 마지막 조사점에서 다음 씬 쪽으로 2.5 m. 문 위에 「씬 n · 이름」 표지.
type Gate = { group: any; ring: any; disc: any; beam: any; label: any; x: number; z: number; to: number; open: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any
const gates: Gate[] = [];
function labelTex(T: any, text: string, open: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128; const c = cv.getContext("2d")!;
  c.fillStyle = open ? "rgba(40,20,80,0.82)" : "rgba(30,30,30,0.7)"; c.beginPath(); c.roundRect(8, 16, 496, 96, 40); c.fill();
  c.fillStyle = open ? "#f1e8ff" : "#cfcfcf"; c.font = "bold 44px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, 256, 66);
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
}
function buildGates(titleOf: (n: number) => string) {
  const g = naju(); const T = g?.THREE; if (!g || !T || !g.scene) return;
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c2 = cv.getContext("2d")!;
  const gr = c2.createRadialGradient(128, 128, 8, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.35, "rgba(170,140,255,0.6)"); gr.addColorStop(1, "rgba(60,30,120,0)");
  c2.fillStyle = gr; c2.fillRect(0, 0, 256, 256); c2.strokeStyle = "rgba(255,255,255,0.35)"; c2.lineWidth = 3;
  for (let a = 0; a < 6; a++) { c2.beginPath(); for (let t = 0; t < 1; t += 0.02) { const r = 120 * t, ang = a * 1.047 + t * 5; c2.lineTo(128 + Math.cos(ang) * r, 128 + Math.sin(ang) * r); } c2.stroke(); }
  const swirl = new T.CanvasTexture(cv);
  for (let n = 1; n <= 4; n++) {
    const pts = INVESTIGATION_POINTS.find((v) => v.scene === n)?.points || []; const last = pts[pts.length - 1] || [18, 38];
    const next = INVESTIGATION_POINTS.find((v) => v.scene === n + 1)?.points[0] || last;
    let dx = next[0] - last[0], dz = next[1] - last[1]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const x = last[0] + dx * 2.5, z = last[1] + dz * 2.5; const y = g.terrain?.groundAt(x, z).y ?? 0;
    const group = new T.Group(); group.name = `cinePreview.gate.${n}`;
    const ring = new T.Mesh(new T.TorusGeometry(1.2 * U, 0.08 * U, 10, 64), new T.MeshBasicMaterial({ color: 0x8a8a8a, fog: false, toneMapped: false }));
    const disc = new T.Mesh(new T.CircleGeometry(1.15 * U, 48), new T.MeshBasicMaterial({ map: swirl, transparent: true, opacity: 0.12, depthWrite: false, fog: false, toneMapped: false, side: T.DoubleSide, blending: T.AdditiveBlending }));
    const beam = new T.Mesh(new T.CylinderGeometry(0.35 * U, 0.6 * U, 40 * U, 16, 1, true), new T.MeshBasicMaterial({ color: 0xb59cff, transparent: true, opacity: 0.28, depthWrite: false, fog: false, toneMapped: false, side: T.DoubleSide, blending: T.AdditiveBlending }));
    beam.position.y = 20 * U; beam.visible = false;
    const label = new T.Sprite(new T.SpriteMaterial({ map: labelTex(T, `🔒 씬 ${n + 1} · ${titleOf(n + 1)}`, false), fog: false, depthTest: false, toneMapped: false }));
    label.scale.set(4 * U, 1 * U, 1); label.position.y = 2.1 * U; label.renderOrder = 999;
    group.add(ring, disc, beam, label); group.position.set(x * U, (y + 1.3) * U, z * U); group.rotation.y = Math.atan2(dx, dz);
    g.scene.add(group); gates.push({ group, ring, disc, beam, label, x, z, to: n + 1, open: false });
  }
}
function openGate(to: number, titleOf: (n: number) => string) {
  const gt = gates.find((v) => v.to === to); const T = naju()?.THREE; if (!gt || !T) return;
  gt.open = true; gt.ring.material.color.set(0xb59cff); gt.disc.material.opacity = 1; gt.beam.visible = true;
  gt.label.material.map = labelTex(T, `🌀 씬 ${to} · ${titleOf(to)}`, true); gt.label.material.needsUpdate = true;
  toast(`🌀 「씬 ${to}」으로 가는 「왜곡의 문」이 열렸다 — 하늘로 솟은 보라빛 기둥을 따라가 문으로 들어가라`, 6500);
}
function closeGate(gt: Gate) { naju()?.scene?.remove(gt.group); gates.splice(gates.indexOf(gt), 1); }

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
      // 이야기 컷이 이 씬의 연출 — 공간 훑기는 이 씬 구역에서 나오지 않게(이미 본 것으로 둔다)
      for (const z of a.zones) stage.visitedZones.add(z);
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
  buildGates(titleOf);
  let current = 1;
  await enterScene(1, true);

  const dev = el("div", "cp-dev"); document.body.appendChild(dev);
  const render = () => {
    const nextMode = current < 5 ? modeOf(intros.find((c) => c.scene_id === `scene-0${current + 1}`)) : null;
    const gate = gates.find((v) => v.open);
    dev.innerHTML = current <= 5
      ? `미리보기 · 지금 씬 ${current}${gate ? ` · 문이 열림 → 씬 ${gate.to}(${nextMode === "cine" ? "이야기 컷" : "공간 훑기"})` : ""} <button class="cp-btn">${gate ? "문 앞으로 옮기기" : `씬 ${current} 마치기 ▶`}</button><button class="cp-btn" data-look>문 자리 보기</button>`
      : `미리보기 · 완주 <button class="cp-btn">결말 다시 보기</button>`;
    const sr = doc.scriptReview; if (sr) { const left = sr.after?.length || 0; const b = el("span", "", ` · 대본 검수 ${sr.before}→${left}건`); b.style.cursor = "help"; b.title = (sr.after || []).map((x) => `${x.target} [${(x.fails || []).join(",")}] ${x.why || ""}`).join("\n") || "걸린 것 없음"; dev.appendChild(b); }
    const look = dev.querySelector("[data-look]") as HTMLElement | null; if (look) look.onclick = () => { const gt = gates.find((v) => v.to === current + 1); if (gt) naju()?.teleport?.current?.(gt.x - Math.sin(gt.group.rotation.y) * 6, gt.z - Math.cos(gt.group.rotation.y) * 6); };
    (dev.querySelector("button") as HTMLElement).onclick = async () => {
      if (current > 5) { if (ending) { await playCine(ending.panels, "이야기의 끝"); endingCard(ending); } return; }
      if (gate) { naju()?.teleport?.current?.(gate.x - Math.sin(gate.group.rotation.y) * 3, gate.z - Math.cos(gate.group.rotation.y) * 3); return; } // 시험용: 문 바로 앞으로
      try { naju()?.endScene?.(current); } catch (e) { console.warn(e); }
      if (current === 5) { current = 6; render(); goalEl?.remove(); if (ending) { await playCine(ending.panels, "이야기의 끝"); endingCard(ending); } return; }
      openGate(current + 1, titleOf); render();
    };
  };
  render();

  // 문 들어가기 판정 — 플레이어(카메라)가 문 고리 안 1.3 m. 닫힌 문은 안내만
  let lockedToast = 0;
  const tick = async () => {
    const g = naju();
    if (g?.camera) {
      const px = g.camera.position.x / U, pz = g.camera.position.z / U;
      for (const gt of gates) {
        if (gt.open) gt.disc.rotation.z += 0.02;
        if (Math.hypot(px - gt.x, pz - gt.z) >= 1.3) continue;
        if (!gt.open) { if (performance.now() - lockedToast > 5000) { lockedToast = performance.now(); toast(`🔒 아직 잠겨 있다 — 씬 ${gt.to - 1}의 조사를 마쳐야 열린다`); } continue; }
        const to = gt.to; closeGate(gt); // 마우스 잠금은 그대로 — 공간 훑기는 플레이 중일 때만 열린다(이야기 컷은 playCine 이 푼다)
        await fade(1); current = to; render(); goalEl?.remove();
        await enterScene(to, false);
        break;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
main();
