const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
class ByteQueue {
  parts = [];
  length = 0;
  push(p) {
    this.parts.push(p);
    this.length += p.length;
  }
  take(n) {
    const out = new Uint8Array(n);
    let k = 0;
    while (k < n) {
      const p = this.parts[0];
      const need = n - k;
      if (p.length <= need) {
        out.set(p, k);
        k += p.length;
        this.parts.shift();
      } else {
        out.set(p.subarray(0, need), k);
        this.parts[0] = p.subarray(need);
        k += need;
      }
    }
    this.length -= n;
    return out;
  }
}
function openPack(url, keyB64, init) {
  let resolveIndex;
  let rejectAll;
  const indexP = new Promise((res, rej) => {
    resolveIndex = res;
    rejectAll = rej;
  });
  const chunkWaiters = /* @__PURE__ */ new Map();
  const waiter = (i) => {
    let w = chunkWaiters.get(i);
    if (!w) {
      let res;
      let rej;
      const p = new Promise((a, b) => {
        res = a;
        rej = b;
      });
      p.catch(() => {
      });
      w = { p, res, rej };
      chunkWaiters.set(i, w);
    }
    return w;
  };
  indexP.catch(() => {
  });
  const done = (async () => {
    try {
      const resp = await fetch(url, init);
      if (!resp.ok || !resp.body) throw new Error(`\uC7A5\uBA74 \uD329 \uBC1B\uAE30 \uC2E4\uD328 (${resp.status})`);
      const reader = resp.body.getReader();
      const q = new ByteQueue();
      const pull = async (n) => {
        while (q.length < n) {
          const { value, done: end } = await reader.read();
          if (end) throw new Error("\uC7A5\uBA74 \uD329\uC774 \uC911\uAC04\uC5D0 \uB04A\uACBC\uC2B5\uB2C8\uB2E4");
          q.push(new Uint8Array(value));
        }
        return q.take(n);
      };
      const magic = new TextDecoder().decode(await pull(4));
      if (magic !== "WGP2") throw new Error("\uC7A5\uBA74 \uD329 \uD615\uC2DD\uC774 \uC544\uB2D9\uB2C8\uB2E4");
      const hl = new DataView((await pull(4)).buffer).getUint32(0, true);
      const header = JSON.parse(new TextDecoder().decode(await pull(hl)));
      const key = await crypto.subtle.importKey("raw", b64(keyB64), "AES-GCM", false, ["decrypt"]);
      const open = async (c, bytes) => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.iv) }, key, bytes));
      const index = JSON.parse(new TextDecoder().decode(await open(header.chunks[0], await pull(header.chunks[0].size))));
      resolveIndex(index);
      const opens = [];
      for (let i = 1; i < header.chunks.length; i++) {
        const bytes = await pull(header.chunks[i].size);
        const w = waiter(i);
        opens.push(open(header.chunks[i], bytes).then(w.res, (e) => {
          w.rej(e);
          throw e;
        }));
      }
      await Promise.all(opens);
    } catch (e) {
      rejectAll(e);
      for (const w of chunkWaiters.values()) w.rej(e);
      throw e;
    }
  })();
  done.catch(() => {
  });
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
    done
  };
}
async function loadGltfFromPack(pack, name, loader) {
  const bytes = await pack.get(name);
  if (!bytes) throw new Error(`\uC7A5\uBA74 \uD329\uC5D0 \uC5C6\uB294 \uD30C\uC77C: ${name}`);
  return loader.parseAsync(bytes, "");
}
export {
  loadGltfFromPack,
  openPack
};
