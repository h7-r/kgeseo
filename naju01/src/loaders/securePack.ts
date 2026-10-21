/**
 * securePack.ts — 장면 팩(.wgp)을 받으면서 덩이별로 메모리에서 풀고 GLB 를 꺼낸다 (10/21, 에셋보호 설계 v0 P1)
 *
 * [왜] 유니티 에셋스토어(KHS) 에셋은 단품 파일로 공개할 수 없다(claude/에셋보호_설계_v0_1021.md).
 *   장면에 필요한 에셋을 암호화한 묶음으로 받고, 브라우저 메모리 안에서만 풀어 바로 읽는다.
 *   - 파일로 저장하지 않는다 · blob URL 을 만들지 않는다 · 꺼낸 바이트는 읽은 뒤 버려진다.
 *   - 열쇠는 팩과 따로 받는다(packSource.ts 의 fetchPackKey — 개발 서버 /__packs, 나중에 백엔드).
 *
 * [v2 받기] 받는 도중 도착한 덩이부터 풀어, 그 덩이에 든 파일을 기다리던 쪽에 바로 넘긴다.
 *   그래서 다 받기 전에 읽기(형상·텍스처 풀기)가 시작된다. 구조는 tools/scene-pack/build-pack.mjs 참고.
 */
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface ChunkInfo { iv: string; size: number }
interface PackHeader { v: number; id: string; chunks: ChunkInfo[] }
interface IndexEntry { name: string; chunk: number; offset: number; size: number }

export interface OpenedPack {
  id: string;
  /** 목록(암호 안에 있던 이름) — 덩이 0 이 풀리면 채워진다 */
  names: Promise<string[]>;
  /** 이 이름의 파일이 팩에 있는가 */
  has(name: string): Promise<boolean>;
  /** 그 파일이 든 덩이가 도착해 풀리면 바이트(복사본)를 준다. 없으면 null */
  get(name: string): Promise<ArrayBuffer | null>;
  /** 다 받고 다 풀렸을 때 */
  done: Promise<void>;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 덩이를 모으는 작은 버퍼 — 받은 조각을 이어 붙이고 앞에서부터 잘라 쓴다 */
class ByteQueue {
  private parts: Uint8Array<ArrayBuffer>[] = [];
  length = 0;
  push(p: Uint8Array<ArrayBuffer>) { this.parts.push(p); this.length += p.length; }
  take(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(n); let k = 0;
    while (k < n) {
      const p = this.parts[0]; const need = n - k;
      if (p.length <= need) { out.set(p, k); k += p.length; this.parts.shift(); }
      else { out.set(p.subarray(0, need), k); this.parts[0] = p.subarray(need); k += need; }
    }
    this.length -= n;
    return out;
  }
}

/** 팩을 받기 시작한다. url 은 팩 주소(나중엔 짧은 수명 주소), keyB64 는 서버가 따로 준 열쇠 */
export function openPack(url: string, keyB64: string, init?: RequestInit): OpenedPack {
  let resolveIndex!: (v: IndexEntry[]) => void; let rejectAll!: (e: unknown) => void;
  const indexP = new Promise<IndexEntry[]>((res, rej) => { resolveIndex = res; rejectAll = rej; });
  const chunkWaiters = new Map<number, { p: Promise<Uint8Array<ArrayBuffer>>; res: (b: Uint8Array<ArrayBuffer>) => void; rej: (e: unknown) => void }>();
  const waiter = (i: number) => {
    let w = chunkWaiters.get(i);
    if (!w) {
      let res!: (b: Uint8Array<ArrayBuffer>) => void; let rej!: (e: unknown) => void;
      const p = new Promise<Uint8Array<ArrayBuffer>>((a, b) => { res = a; rej = b; });
      p.catch(() => {});
      w = { p, res, rej }; chunkWaiters.set(i, w);
    }
    return w;
  };
  indexP.catch(() => {});

  const done = (async () => {
    try {
      const resp = await fetch(url, init);
      if (!resp.ok || !resp.body) throw new Error(`장면 팩 받기 실패 (${resp.status})`);
      const reader = resp.body.getReader();
      const q = new ByteQueue();
      const pull = async (n: number) => {
        while (q.length < n) {
          const { value, done: end } = await reader.read();
          if (end) throw new Error("장면 팩이 중간에 끊겼습니다");
          q.push(new Uint8Array(value));
        }
        return q.take(n);
      };
      const magic = new TextDecoder().decode(await pull(4));
      if (magic !== "WGP2") throw new Error("장면 팩 형식이 아닙니다");
      const hl = new DataView((await pull(4)).buffer).getUint32(0, true);
      const header = JSON.parse(new TextDecoder().decode(await pull(hl))) as PackHeader;
      const key = await crypto.subtle.importKey("raw", b64(keyB64), "AES-GCM", false, ["decrypt"]);
      const open = async (c: ChunkInfo, bytes: Uint8Array<ArrayBuffer>) =>
        new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.iv) }, key, bytes));
      // 덩이 0 = 목록
      const index = JSON.parse(new TextDecoder().decode(await open(header.chunks[0], await pull(header.chunks[0].size)))) as IndexEntry[];
      resolveIndex(index);
      // 나머지 덩이 — 받는 대로 풀어서 기다리는 쪽에 넘긴다(받기와 풀기가 겹친다)
      const opens: Promise<void>[] = [];
      for (let i = 1; i < header.chunks.length; i++) {
        const bytes = await pull(header.chunks[i].size);
        const w = waiter(i);
        opens.push(open(header.chunks[i], bytes).then(w.res, (e) => { w.rej(e); throw e; }));
      }
      await Promise.all(opens);
    } catch (e) {
      rejectAll(e);
      for (const w of chunkWaiters.values()) w.rej(e);
      throw e;
    }
  })();
  done.catch(() => {});

  return {
    id: url,
    names: indexP.then((idx) => idx.map((e) => e.name)),
    has: (name) => indexP.then((idx) => idx.some((e) => e.name === name)),
    async get(name) {
      const idx = await indexP;
      const e = idx.find((x) => x.name === name);
      if (!e) return null;
      const chunk = await waiter(e.chunk).p;
      return chunk.slice(e.offset, e.offset + e.size).buffer;
    },
    done,
  };
}

/** 팩 안의 GLB 하나를 three 로 읽는다(압축 지원 로더 — loaders/compressedGlb.ts 의 createCompressedGltfLoader 를 넘길 것) */
export async function loadGltfFromPack(pack: OpenedPack, name: string, loader: GLTFLoader): Promise<GLTF> {
  const bytes = await pack.get(name);
  if (!bytes) throw new Error(`장면 팩에 없는 파일: ${name}`);
  return loader.parseAsync(bytes, "");
}
