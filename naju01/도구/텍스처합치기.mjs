// ═══════════════════════════════════════════════════════════════
//  텍스처합치기.mjs — 칸별로 따로 구운 텍스처를 아틀라스 한 장으로
// ═══════════════════════════════════════════════════════════════
// 쓰는 법
//   node naju01/도구/텍스처합치기.mjs 바닥=<받은바닥.glb> 절벽=<받은절벽.glb>
//
// [왜 필요한가 — 1·2차로 확인한 Meshy 의 성질]
//   Meshy 는 **한 모델에 재질 하나**를 입힌다. 절벽과 땅을 한 덩이로 넘겼더니
//   두 번 다 전부 같은 회색으로 뭉갰다(1차: 백색 / 2차: 회색 자갈).
//   Z1 다진 흙 · Z2 자갈 · Z4 풀능선 구분이 통째로 사라졌다.
//
//   그래서 **칸별로 따로 굽고, 합치는 건 우리가 한다.**
//   UV 는 칸마다 전체 아틀라스 자리를 그대로 쓰므로(아틀라스.js),
//   돌아온 그림에서 그 칸의 사각형만 오려 붙이면 끝이다 — 계산이 필요 없다.
//   결과는 여전히 **한 장 · 한 재질 · 드로우콜 하나**라서
//   「한 덩이로 굽는다」의 이점(이음매 없음)을 그대로 지킨다.
//
// [나오는 것] 에셋/지형/{바탕색,거칠기금속,법선}.jpg — 기존 자리 그대로 덮어쓴다
//
// [4K 로 자른다]
//   Meshy 가 8K 로 돌려줄 때가 있다. 8192² PBR 은 브라우저에서 GPU 268 MB/장이라
//   감당이 안 된다(맵 세 장이면 800 MB). 5,589 m² 를 4K 에 담으면 51 px/m,
//   절벽 칸은 98 px/m 이라 걷는 거리에서는 충분하다. 그래서 여기서 잘라 둔다.
const 최대해상도 = 4096;

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 나갈곳 = path.join(여기, "..", "에셋", "지형");
const 원본폴더 = path.join(여기, "..", "에셋", "원본");
const 주소 = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

// 아틀라스.js 의 `아틀라스배치` 와 **같은 값**이어야 한다.
//   ※ 구역(Z1~Z4)은 여기 안 적는다. 내보낼 때 GLB 옆에 .json 으로 적어 둔
//     **아틀라스 사각형을 읽는다.** 여기에 또 적으면 언젠가 어긋난다.
const 배치 = {
  바닥: { u: [0, 1], v: [0, 0.625] },
  절벽: { u: [0, 0.56], v: [0.63, 1] },
};

// 덮는 순서 — 바닥(전체)을 깔고, 절벽, 그 위에 구역들.
const 순서 = ["바닥", "절벽", "Z1", "Z2", "Z3", "Z4"];

// GLB 의 삼각형 수만 읽는다(자동 분류용 — 파일 이름은 안 믿는다)
async function 삼각형수(파일) {
  const 통 = await fs.readFile(파일);
  let 커서 = 12, 표 = null;
  while (커서 < 통.length) {
    const 길이 = 통.readUInt32LE(커서);
    const 종류 = 통.readUInt32LE(커서 + 4);
    if (종류 === 0x4e4f534a) {
      표 = JSON.parse(통.slice(커서 + 8, 커서 + 8 + 길이).toString("utf8"));
      break;
    }
    커서 += 8 + 길이;
  }
  const pr = 표?.meshes?.[0]?.primitives?.[0];
  if (!pr) return 0;
  const n =
    pr.indices !== undefined
      ? 표.accessors[pr.indices].count
      : 표.accessors[pr.attributes.POSITION].count;
  return Math.round(n / 3);
}

const 들어온것 = {};
const 인자들 = process.argv.slice(2);
const 자동 = 인자들.includes("--자동");

if (자동) {
  // ── 자동 분류 ───────────────────────────────────────────
  //   Meshy 가 돌려주는 파일 이름은 잘리고 뒤섞인다(`Meshy11_..._바_...`).
  //   **삼각형 수**로 대조하면 확실하다 — 리텍스처는 삼각형을 안 바꾸므로
  //   우리가 내보낸 `지형-<이름>-밑그림.glb` 와 정확히 같은 수가 돌아온다.
  const 기준 = {};
  for (const 이름 of 순서) {
    const f = path.join(원본폴더, `지형-${이름}-밑그림.glb`);
    try {
      기준[await 삼각형수(f)] = 이름;
    } catch {
      /* 안 뽑아 둔 것은 건너뛴다 */
    }
  }
  const 목록 = (await fs.readdir(원본폴더))
    .filter((f) => f.endsWith(".glb") && !f.startsWith("지형-"))
    .map((f) => path.join(원본폴더, f));
  console.log("── 자동 분류 (삼각형 수 대조) ──────────");
  for (const f of 목록) {
    const n = await 삼각형수(f);
    const 이름 = 기준[n];
    if (!이름) {
      console.log(`  ? ${path.basename(f)}  삼각 ${n.toLocaleString()} — 짝을 못 찾음`);
      continue;
    }
    // 같은 칸이 여럿이면 **최신 파일**을 쓴다
    const 이전 = 들어온것[이름];
    if (이전) {
      const [a, b2] = await Promise.all([fs.stat(이전), fs.stat(f)]);
      if (a.mtimeMs >= b2.mtimeMs) {
        console.log(`  · ${path.basename(f)}  → ${이름} (더 오래됨, 건너뜀)`);
        continue;
      }
    }
    들어온것[이름] = f;
    console.log(`  ✔ ${path.basename(f)}  삼각 ${n.toLocaleString()} → ${이름}`);
  }
} else {
  for (const 인자 of 인자들) {
    const i = 인자.indexOf("=");
    if (i < 0) continue;
    const 이름 = 인자.slice(0, i);
    const 파일 = 인자.slice(i + 1);
    if (순서.includes(이름) && 파일) 들어온것[이름] = 파일;
  }
}
if (!Object.keys(들어온것).length) {
  console.error(
    "쓰는 법: node naju01/도구/텍스처합치기.mjs --자동\n" +
      "     또는 node naju01/도구/텍스처합치기.mjs 바닥=<glb> 절벽=<glb> [Z1=<glb> ...]",
  );
  process.exit(1);
}

// 이름 → 아틀라스 사각형. 구역은 GLB 옆 .json 에서 읽는다.
async function 사각형찾기(이름, 파일) {
  if (배치[이름]) return 배치[이름];
  const 쪽지 = 파일.replace(/\.glb$/, ".json");
  try {
    return JSON.parse(await fs.readFile(쪽지, "utf8"));
  } catch {
    // 받은 파일 이름이 Meshy 것으로 바뀌었어도, 내보낸 원본 쪽지를 찾아본다
    const 원본 = path.join(
      path.dirname(파일),
      `지형-${이름}-밑그림.json`,
    );
    return JSON.parse(await fs.readFile(원본, "utf8"));
  }
}

// ── GLB 에서 그림 세 장 꺼내기 (텍스처뽑기.mjs 와 같은 규칙) ──
//   ※ 바이트를 **숫자 배열**로 페이지에 넘기면 안 된다. 4K JPEG 한 장이
//     11 MB 인데 배열 원소마다 8 바이트를 먹어 노드가 힙 초과로 죽는다
//     (실제로 죽었다). base64 문자열로 넘기고, **맵 한 종류씩** 처리한다.
async function 그림들(파일) {
  const 통 = await fs.readFile(파일);
  let 커서 = 12, 표 = null, 살 = null;
  while (커서 < 통.length) {
    const 길이 = 통.readUInt32LE(커서);
    const 종류 = 통.readUInt32LE(커서 + 4);
    if (종류 === 0x4e4f534a) 표 = JSON.parse(통.slice(커서 + 8, 커서 + 8 + 길이).toString("utf8"));
    if (종류 === 0x004e4942) 살 = 통.slice(커서 + 8, 커서 + 8 + 길이);
    커서 += 8 + 길이;
  }
  const 재질 = 표.materials?.[0];
  const pbr = 재질?.pbrMetallicRoughness ?? {};
  const 슬롯 = {
    바탕색: pbr.baseColorTexture?.index,
    거칠기금속: pbr.metallicRoughnessTexture?.index,
    법선: 재질?.normalTexture?.index,
  };
  const 결과 = {};
  for (const [쓰임, i] of Object.entries(슬롯)) {
    if (i === undefined) continue;
    const 그림 = 표.images[표.textures[i].source];
    const bv = 표.bufferViews[그림.bufferView];
    결과[쓰임] = {
      자료: 살
        .slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
        .toString("base64"),
      형식: 그림.mimeType,
    };
  }
  return 결과;
}

const 모음 = {};
const 사각형 = {};
for (const 이름 of 순서) {
  if (!들어온것[이름]) continue;
  모음[이름] = await 그림들(들어온것[이름]);
  사각형[이름] = await 사각형찾기(이름, 들어온것[이름]);
  const r = 사각형[이름];
  console.log(
    `  ${이름.padEnd(4)} ← ${path.basename(들어온것[이름])}` +
      `  (u ${r.u[0].toFixed(3)}~${r.u[1].toFixed(3)} · v ${r.v[0].toFixed(3)}~${r.v[1].toFixed(3)})`,
  );
}

await fs.mkdir(나갈곳, { recursive: true });
const 브라우저 = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const 쪽 = await 브라우저.newPage({ viewport: { width: 400, height: 240 } });

try {
  await 쪽.goto(주소, { waitUntil: "load" });
  await 쪽.waitForSelector("canvas", { timeout: 30000 });

  console.log("── 합침 ────────────────────────────────");
  for (const 쓰임 of ["바탕색", "거칠기금속", "법선"]) {
    const 조각 = {};
    for (const 칸 of Object.keys(모음)) if (모음[칸][쓰임]) 조각[칸] = 모음[칸][쓰임];
    if (!Object.keys(조각).length) continue;

    const 나온것 = await 쪽.evaluate(
      async ([조각, 배치, 쓰임, 최대, 순서]) => {
        const 읽기 = (b64, 형식) =>
          new Promise((ok, no) => {
            const im = new Image();
            im.onload = () => ok(im);
            im.onerror = no;
            im.src = `data:${형식};base64,${b64}`;
          });
        const 그림 = {};
        let 크기 = 0;
        for (const k of Object.keys(조각)) {
          그림[k] = await 읽기(조각[k].자료, 조각[k].형식);
          크기 = Math.max(크기, 그림[k].width);
        }
        크기 = Math.min(크기, 최대);
        const 천 = document.createElement("canvas");
        천.width = 천.height = 크기;
        const 붓 = 천.getContext("2d");
        // 법선의 빈 칸은 '평평함'(128,128,255), 나머지는 중간 흙색
        붓.fillStyle = 쓰임 === "법선" ? "rgb(128,128,255)" : "rgb(138,124,99)";
        붓.fillRect(0, 0, 크기, 크기);
        // 바닥(전체) → 절벽 → 구역들 순서로 덮는다
        for (const k of 순서) {
          if (!그림[k]) continue;
          const r = 배치[k];
          // `채움` = 돌아온 그림 **전체**가 이 사각형이다(구역 굽기).
          //   구역 UV 를 0~1 로 펴서 넘겼기 때문이다 — 안 그러면 Meshy 가
          //   「UV 커버리지가 너무 작다」로 파일을 안 받는다.
          const sx = r.채움 ? 0 : r.u[0] * 그림[k].width;
          const sy = r.채움 ? 0 : r.v[0] * 그림[k].height;
          const sw = r.채움 ? 그림[k].width : (r.u[1] - r.u[0]) * 그림[k].width;
          const sh = r.채움 ? 그림[k].height : (r.v[1] - r.v[0]) * 그림[k].height;
          붓.drawImage(
            그림[k], sx, sy, sw, sh,
            r.u[0] * 크기, r.v[0] * 크기,
            (r.u[1] - r.u[0]) * 크기, (r.v[1] - r.v[0]) * 크기,
          );
        }
        return { 자료: 천.toDataURL("image/jpeg", 0.92).split(",")[1], 크기 };
      },
      [조각, 사각형, 쓰임, 최대해상도, 순서],
    );

    const 파일 = path.join(나갈곳, `${쓰임}.jpg`);
    const 자료 = Buffer.from(나온것.자료, "base64");
    await fs.writeFile(파일, 자료);
    console.log(
      `  ${쓰임.padEnd(6)} ${나온것.크기}² · ${(자료.length / 1048576).toFixed(2)} MB → 에셋/지형/${쓰임}.jpg`,
    );
  }
} finally {
  await 브라우저.close();
}
