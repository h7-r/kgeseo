// ═══════════════════════════════════════════════════════════════
//  지형표.js — 블렌더가 구운 **판정용 높이 격자**를 읽는다
// ═══════════════════════════════════════════════════════════════
// [왜 생겼나]
//   지금까지 이 공간은 바닥의 진실이 **셋**으로 갈려 있었다 —
//     ① 걷기 판정  `지형.지면(x,z).y`   (해석식)
//     ② 그림용 높이 `지표.높이(x,z)`     (①에 요철을 더한 해석식)
//     ③ 실제 삼각형 `땅` 메시            (②를 격자로 떠서 만든 것)
//   셋이 어긋나는 자리마다 물건이 묻히고 길에 구멍이 났다(한 세션에 네 번).
//   `도구/지형짓기.py` 는 **한 배열 h** 에서 `지형.glb`(그림)와
//   `지형높이.bin`(판정)을 같은 순간에 내보낸다. 이 파일은 그중 판정 쪽을
//   읽는다. 둘은 다른 코드가 아니라 **같은 숫자**라 어긋날 수가 없다.
//
// [왜 레이캐스트가 아닌가]
//   격자가 0.25 m 로 고른 **정규 격자**다. 정규 격자는 이중선형 보간으로
//   O(1) 에 높이가 나온다 — BVH 를 얹는 것보다 빠르고, 저장소 루트
//   `package.json` 에 의존성을 더할 필요도 없다(그 파일은 건드리면 안 된다).
//
// [단위]  x·z·높이 전부 **도면 미터**다(구역 고도 0 · 8 · 14 와 같은 자).
//   유닛으로 바꾸는 것은 쓰는 쪽 몫이다 — `배치.js` 가 `a.y * 미터` 하듯이.
//
// [파일 형식]  머리말 36 바이트 + 두 판
//   "NJTH" · 판(u16) · 예비(u16) · nx(u16) · nz(u16)
//          · x0 · z0 · 칸x · 칸z (f32 ×4) · 낮 · 높 (f32 ×2)
//   ① 높이  Uint16 × nz × nx   — 높이 = 낮 + v/65535 × (높−낮)
//   ② 노면  Uint8  × nz × nx   — 0 맨땅 · 255 노면 한복판

// ※ `"../에셋/지형높이.bin?url"` 로 쓰지 않는다. `?url` 은 **Vite 전용**
//   문법이라 그 밖에서 묶으면(도구·검산 스크립트) 못 읽는다.
//   `new URL(..., import.meta.url)` 은 표준 ESM 이고 Vite 도 그대로 처리한다.
const 표주소 = new URL("../에셋/지형높이.bin", import.meta.url).href;

const 머리길이 = 36;
const 표식 = 0x4854_4a4e; // "NJTH" 를 little-endian 으로 읽은 값

/**
 * 높이표를 읽어 조회기를 만든다.
 *   돌려주는 것 { 높이, 노면, 안에, nx, nz, 칸, 낮, 높, 격자, 길격자 }
 *   ※ 실패하면 **예외를 던지지 않고 null** 을 돌려준다.
 *     표가 없거나 깨져도 게임은 예전 해석식으로 그대로 돌아야 한다 —
 *     바닥이 사라지는 것보다 옛 바닥이 낫다.
 */
export async function 높이표불러오기(주소 = 표주소) {
  let 버퍼;
  try {
    const 답 = await fetch(주소);
    if (!답.ok) throw new Error(`${답.status}`);
    버퍼 = await 답.arrayBuffer();
  } catch (e) {
    console.warn("[지형표] 못 읽었다 — 옛 해석식으로 간다:", e.message);
    return null;
  }
  return 높이표만들기(버퍼);
}

/** 이미 읽어 둔 ArrayBuffer 로 만든다(테스트·도구에서 쓴다). */
export function 높이표만들기(버퍼) {
  if (!버퍼 || 버퍼.byteLength < 머리길이) {
    console.warn("[지형표] 파일이 너무 짧다");
    return null;
  }
  const 뷰 = new DataView(버퍼);
  if (뷰.getUint32(0, true) !== 표식) {
    console.warn("[지형표] 머리말이 NJTH 가 아니다");
    return null;
  }
  const 판 = 뷰.getUint16(4, true);
  const nx = 뷰.getUint16(8, true);
  const nz = 뷰.getUint16(10, true);
  const x0 = 뷰.getFloat32(12, true);
  const z0 = 뷰.getFloat32(16, true);
  const 칸x = 뷰.getFloat32(20, true);
  const 칸z = 뷰.getFloat32(24, true);
  const 낮 = 뷰.getFloat32(28, true);
  const 높 = 뷰.getFloat32(32, true);

  const 칸수 = nx * nz;
  const 있어야 = 머리길이 + 칸수 * 2 + 칸수;
  if (버퍼.byteLength < 있어야) {
    console.warn(`[지형표] 크기가 안 맞는다 — ${버퍼.byteLength} < ${있어야}`);
    return null;
  }
  // ※ `Uint16Array(버퍼, 36)` 은 **못 쓴다.** 36 은 2 의 배수지만 브라우저에
  //   따라 정렬을 깐깐하게 보는 경우가 있고, 무엇보다 이 표는 한 번 읽고
  //   내내 쓰므로 복사 한 번(129 KB)이 싸다. 복사해서 정렬 걱정을 없앤다.
  const 격자 = new Uint16Array(버퍼.slice(머리길이, 머리길이 + 칸수 * 2));
  const 길격자 = new Uint8Array(버퍼.slice(머리길이 + 칸수 * 2, 있어야));

  const 폭 = 높 - 낮;
  const x1 = x0 + (nx - 1) * 칸x;
  const z1 = z0 + (nz - 1) * 칸z;

  function 안에(x, z) {
    return x >= x0 && x <= x1 && z >= z0 && z <= z1;
  }

  // ── 이중선형 ────────────────────────────────────────────────
  //   ★ 최근접이 아니라 **이중선형**이어야 한다.
  //     최근접이면 0.25 m 마다 높이가 계단으로 튀어, 걸을 때 발이 칸마다
  //     덜컥거린다. 그림(GLB)은 삼각형이라 이미 선형 보간이므로,
  //     판정도 선형이어야 둘이 같은 면을 가리킨다.
  //     ※ 사각형을 두 삼각형으로 나눈 것과 미세하게 다르지만(≤ 수 mm),
  //       미세결이 ±6 cm 인 땅에서 그 차이는 의미가 없다.
  function 높이(x, z) {
    if (!안에(x, z)) return null;
    const u = (x - x0) / 칸x;
    const v = (z - z0) / 칸z;
    let i = Math.floor(u);
    let j = Math.floor(v);
    if (i >= nx - 1) i = nx - 2;
    if (j >= nz - 1) j = nz - 2;
    const fu = u - i;
    const fv = v - j;
    const k = j * nx + i;
    const a = 격자[k];
    const b = 격자[k + 1];
    const c = 격자[k + nx];
    const d = 격자[k + nx + 1];
    const 위 = a + (b - a) * fu;
    const 아래 = c + (d - c) * fu;
    return 낮 + ((위 + (아래 - 위) * fv) / 65535) * 폭;
  }

  /** 이 자리가 노면인 정도 0~1. 길 질감·발소리·「길 위인가」 판정에 쓴다. */
  function 노면(x, z) {
    if (!안에(x, z)) return 0;
    const u = (x - x0) / 칸x;
    const v = (z - z0) / 칸z;
    let i = Math.floor(u);
    let j = Math.floor(v);
    if (i >= nx - 1) i = nx - 2;
    if (j >= nz - 1) j = nz - 2;
    const fu = u - i;
    const fv = v - j;
    const k = j * nx + i;
    const 위 = 길격자[k] + (길격자[k + 1] - 길격자[k]) * fu;
    const 아래 = 길격자[k + nx] + (길격자[k + nx + 1] - 길격자[k + nx]) * fu;
    return (위 + (아래 - 위) * fv) / 255;
  }

  return { 판, 높이, 노면, 안에, nx, nz, 칸: 칸x, 낮, 높, 격자, 길격자, x0, z0 };
}
