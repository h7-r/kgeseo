/**
 * packSource.ts — 「팩에 있으면 팩에서, 없으면 원래 주소에서」 (10/21, 에셋보호 설계 v0 P1)
 *
 * manifest.json 에 「팩」: ["naju-z1", …] 이 있으면 그 장면 팩들을 미리 열어 두고,
 * publicAssetLoader 가 파일을 읽을 때 팩에 든 파일이면 팩에서 꺼내 읽는다(유니티 KHS 에셋은 팩으로만 들어온다).
 *
 * [열쇠·주소를 어디서 받나]
 *   - 개발 서버(npx vite naju01): vite/scenePackPlugin.ts 의 /__packs/key/<id>, /__packs/file/<id> (이 컴퓨터에서만)
 *   - 배포본: 백엔드 /api/v1/packs/<id> 가 플레이 세션을 확인하고 { url, key } 를 준다 — P2, 백엔드 담당자와 상의 중.
 *     아직 없으므로 배포본에서 팩을 쓰는 장면은 「팩 열쇠를 받지 못했습니다」로 실패한다(단품 파일로 되돌아가지 않음).
 */
import { openPack, type OpenedPack } from "./securePack";

interface PackTicket { url: string; key: string }

async function fetchTicket(id: string): Promise<PackTicket> {
  if (import.meta.env.DEV) {
    const r = await fetch(`/__packs/key/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`팩 열쇠를 받지 못했습니다 (${id}, ${r.status}) — .pack-keys.json·.packs/ 확인`);
    return { url: `/__packs/file/${encodeURIComponent(id)}`, key: ((await r.json()) as { key: string }).key };
  }
  // P2 — 백엔드가 세션 확인 뒤 내려줄 자리(주소·응답 모양은 백엔드 담당자와 정함)
  const r = await fetch(`/api/v1/packs/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`팩 열쇠를 받지 못했습니다 (${id}, ${r.status})`);
  return (await r.json()) as PackTicket;
}

const packs: OpenedPack[] = [];
/** 팩에서 꺼내 읽은 파일 수(확인용 — 콘솔 `[scenePack]` 에도 찍힘) */
export const scenePackStats = { fromPack: 0, fromUrl: 0, opened: [] as string[] };
// 개발 서버에서는 콘솔에서 바로 볼 수 있게(window.__scenePack)
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __scenePack: typeof scenePackStats }).__scenePack = scenePackStats;
/** 읽기가 잠잠해지면(1.5초) 누적 수를 한 줄로 알린다 — 「다 받음」 시점엔 아직 읽는 중이라 수가 작게 찍힌다 */
let summaryTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleSummary = () => {
  if (!scenePackStats.opened.length) return;
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryTimer = setTimeout(
    () => console.info(`[scenePack] 읽기 끝 — 팩에서 ${scenePackStats.fromPack}개 · 팩 밖(원래 주소)에서 ${scenePackStats.fromUrl}개`),
    1500,
  );
};

/** 시험용(개발 서버): 주소에 &pack=<id>[,<id>] 를 붙이면 manifest 를 고치지 않고 팩을 연다 */
const QUERY_PACKS = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("pack") || "").split(",").filter(Boolean) : [];

/** manifest 「팩」 목록(+ 주소의 &pack=)을 연다(받기는 뒤에서 이어짐 — 기다리지 않아도 된다) */
export async function openScenePacks(ids: string[] | undefined): Promise<void> {
  for (const id of [...(ids || []), ...QUERY_PACKS]) {
    if (packs.some((p) => p.id === id)) continue;
    try {
      const t = await fetchTicket(id);
      const p = openPack(t.url, t.key);
      packs.push(Object.assign(p, { id }));
      scenePackStats.opened.push(id);
      const t0 = performance.now();
      p.done.then(
        () => console.info(`[scenePack] ${id} 다 받음 · ${((performance.now() - t0) / 1000).toFixed(2)}초(읽기는 이어서 진행 — 끝나면 「읽기 끝」 줄이 따로 찍힘)`),
        (e) => console.warn(`[scenePack] ${id} 받기 실패`, e),
      );
    } catch (error) {
      console.warn("[scenePack]", error);
    }
  }
}

/** 이 파일이 열린 팩 중 하나에 있으면 그 바이트, 없으면 null(→ 원래 주소에서 읽음) */
export async function packedBytes(file: string): Promise<ArrayBuffer | null> {
  for (const p of packs) {
    try {
      if (await p.has(file)) {
        const bytes = await p.get(file);
        if (bytes) scenePackStats.fromPack++;
        scheduleSummary();
        return bytes;
      }
    } catch (error) {
      console.warn("[scenePack] 팩 읽기 실패:", p.id, error);
    }
  }
  if (packs.length) { scenePackStats.fromUrl++; scheduleSummary(); }
  return null;
}
