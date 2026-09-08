// ═══════════════════════════════════════════════════════════════
//  구운지형.js — Meshy 가 구워 준 텍스처를 **원본 메시**에 입힌다
// ═══════════════════════════════════════════════════════════════
// [왜 Meshy 의 메시를 안 쓰고 텍스처만 쓰나]
//   Meshy 는 모델을 **단위 상자로 정규화**해서 돌려준다(우리 건 133.3333 배로
//   줄어서 왔다). 정점도 용접돼 278,730 → 100,199 개가 됐다.
//   그 메시를 씬에 넣으면 좌표를 되돌리는 동안 **판정과 어긋날 여지**가 생긴다.
//
//   그런데 잰 결과 **UV 가 우리가 넘긴 그대로** 돌아왔다
//   (u 0.0064~0.9936 · v 0.0040~0.9726 — 소수점까지 일치).
//   UV 가 같으면 그 텍스처는 **우리 원본 메시에 그대로 맞는다.**
//   그래서 기하는 통째로 버리고 그림 세 장만 가져다 붙인다.
//   → 판정(지형.js)은 한 점도 안 건드린다. 이게 이 파이프라인의 핵심이다.
//
// [flipY 를 끄는 이유]
//   glTF 는 UV 원점이 **왼쪽 위**, three.js 텍스처는 기본이 **왼쪽 아래**다.
//   Meshy 는 glTF 규약대로 칠했으므로, 우리가 그림을 직접 읽어 쓸 때는
//   `flipY = false` 로 맞춰야 위아래가 안 뒤집힌다.
//
// [되돌릴 수 있게 둔다]
//   원래 재질을 기억해 뒀다가 끄면 그대로 복구한다. Leva 에서 A/B 로 본다.

import * as THREE from "three";
import { 칸찾기, 칸UV얹기, 바위UV얹기, 바위대상 } from "./아틀라스.js";

const 주소 = {
  바탕색: new URL("../에셋/지형/바탕색.jpg", import.meta.url).href,
  거칠기금속: new URL("../에셋/지형/거칠기금속.jpg", import.meta.url).href,
  법선: new URL("../에셋/지형/법선.jpg", import.meta.url).href,
};

let 재질약속 = null;

function 재질만들기() {
  if (재질약속) return 재질약속;
  const 로더 = new THREE.TextureLoader();
  const 읽기 = (u, 색공간) =>
    new Promise((맞음, 틀림) =>
      로더.load(
        u,
        (t) => {
          t.flipY = false; // glTF 규약 — 위 주석 참고
          t.colorSpace = 색공간;
          t.anisotropy = 8;
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          맞음(t);
        },
        undefined,
        틀림,
      ),
    );
  재질약속 = Promise.all([
    읽기(주소.바탕색, THREE.SRGBColorSpace),
    읽기(주소.거칠기금속, THREE.NoColorSpace),
    읽기(주소.법선, THREE.NoColorSpace),
  ]).then(([바탕, 거칠, 법선]) => {
    return new THREE.MeshStandardMaterial({
      map: 바탕,
      // glTF 규약: 같은 그림의 G 채널이 거칠기, B 채널이 금속이다
      roughnessMap: 거칠,
      metalnessMap: 거칠,
      roughness: 1,
      metalness: 1,
      normalMap: 법선,
      // 정점색을 **그늘 계수로 바꿔서** 쓴다(위 `그늘로바꾸기` 참고).
      //   색조는 빼고 굴곡·접지 그늘만 곱한다 — 색은 안 물들고 입체감은 산다.
      vertexColors: true,
    });
  });
  return 재질약속;
}

const 기억 = new WeakMap();
const 색기억 = new WeakMap();

// ── 우리 그늘을 되살린다 ───────────────────────────────────
// [왜]
//   정점색을 끄면서 **접지 그늘·굴곡 그늘(가짜 AO)까지 같이 꺼졌다.**
//   그래서 절벽이 「평면 같다」는 말이 나온다 — 구운 그림에는 음영이 없고
//   (remove_lighting 으로 일부러 뺐다) 우리 음영도 껐으니 남는 게 없다.
//
// [어떻게]
//   정점색에서 **밝기만** 뽑아 평균으로 나눈다. 그러면 색조는 사라지고
//   「여기는 우묵해서 어둡다」는 정보만 남는 곱셈 계수가 된다.
//   구운 텍스처 × 이 계수 = 구운 색 + 우리 굴곡. 색은 안 물든다.
function 그늘로바꾸기(지오) {
  const c = 지오.attributes.color;
  if (!c) return false;
  const n = c.count;
  const 원본 = c.array.slice();
  let 합 = 0;
  const 밝기 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
    // 정점색에 NaN 이 섞이면 그늘 계수가 통째로 NaN 이 되고 그 면이 검게 죽는다
    // (실제로 절벽면에서 하나 나왔다 — 광선으로 찍어 확인)
    밝기[i] = Number.isFinite(l) ? l : 1;
    합 += 밝기[i];
  }
  const 평균 = 합 / Math.max(1, n) || 1;
  const 새 = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 0.62~1.25 로 묶는다 — 안 묶으면 어두운 정점이 새까맣게 죽는다
    const r = 밝기[i] / 평균;
    const g = Number.isFinite(r) ? Math.min(1.25, Math.max(0.62, r)) : 1;
    새[i * 3] = 새[i * 3 + 1] = 새[i * 3 + 2] = g;
  }
  지오.setAttribute("color", new THREE.BufferAttribute(새, 3));
  return 원본;
}

// 씬의 지형 메시들에 구운 재질을 입히거나(켬=true) 원래대로 되돌린다.
export async function 구운지형입히기(씬, 켬) {
  const 재질 = 켬 ? await 재질만들기() : null;
  let 손댄수 = 0;
  씬.traverse((o) => {
    if (!o.isMesh) return;
    const 칸 = 칸찾기(o.name);
    const 돌 = !칸 && 바위대상.includes(o.name);
    if (!칸 && !돌) return;
    if (켬) {
      if (!기억.has(o)) 기억.set(o, o.material);
      // 지형은 내보낼 때와 **같은 규칙**으로, 흩어진 돌은 상자 투영으로
      if (칸) {
        if (!o.geometry.userData.구움UV) {
          칸UV얹기(o.geometry, 칸);
          o.geometry.userData.구움UV = true;
        }
      } else if (!o.geometry.userData.구움UV) {
        바위UV얹기(o.geometry);
        o.geometry.userData.구움UV = true;
      }
      if (!색기억.has(o.geometry)) {
        const 원본 = 그늘로바꾸기(o.geometry);
        if (원본) 색기억.set(o.geometry, 원본);
      }
      o.material = 재질;
    } else if (기억.has(o)) {
      o.material = 기억.get(o);
      const 원본 = 색기억.get(o.geometry);
      if (원본) {
        o.geometry.setAttribute("color", new THREE.BufferAttribute(원본, 3));
        색기억.delete(o.geometry);
      }
    }
    손댄수++;
  });
  return 손댄수;
}
