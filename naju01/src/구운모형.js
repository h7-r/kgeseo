// ═══════════════════════════════════════════════════════════════
//  구운모형.js — **색까지 입혀진 GLB** 를 런타임에 읽어 표본으로 쓴다
// ═══════════════════════════════════════════════════════════════
// [왜 JS 모듈로 안 굽나]
//   `도구/모형굽기.mjs` 는 지오메트리를 base64 로 **JS 파일에 박는다.**
//   작은 모형에는 그게 편하다 — 번들에 딸려 오고 로딩이 없다. 그런데
//   구렁이를 텍스처까지 살려 구우니 30 만 면 · 17 만 꼭짓점이고, base64 는
//   덩치를 34 % 더 불려서 **모듈 하나가 7.9 MB** 가 된다(지금 1.4 MB).
//   같은 것을 GLB 로 두면 8.8 MB 바이너리 한 개이고, 번들과 따로 캐시된다.
//   게다가 모듈 쪽은 인덱스가 Uint16 이라 **꼭짓점 65,535 이 천장**인데,
//   GLB 는 그 제한이 없다.
//
// [무엇을 싣고 오나]
//   POSITION · NORMAL · COLOR_0. 색이 이미 정점에 구워져 있으므로
//   재질은 `vertexColors` 로 그대로 받으면 된다(무리가 쓰는 그 재질이다).
//   ※ 그래서 **배치의 `색` 은 흰색이어야 한다.** 안 그러면 구운 색에
//     그 색이 곱해져 통째로 물든다(`에셋목록.js` 의 `색구움` 참고).
//
// [실패하면]
//   조용히 `null` 을 돌려준다. 부르는 쪽이 옛 표본으로 돌아가면 된다 —
//   8.8 MB 가 안 왔다고 씬 전체가 안 뜨는 것보다 낫다(`새지형.js` 와 같은 원칙).

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const 주소들 = {
  구렁이: new URL("../에셋/모형/구렁이-색.glb", import.meta.url).href,
  // 아비사 — Z1 의 NPC(§163 대화). **텍스처째** 쓴다(정점 색이 아니라).
  //   한 사람뿐이라 인스턴스 제약이 없고, 텍스처를 그대로 물리면 Meshy 에서
  //   본 그대로 나온다(노멀맵이 살아 옷 주름·얼굴 요철이 빛을 받는다).
  아비사: new URL("../에셋/모형/아비사.glb", import.meta.url).href,
  // 어부(아랑사) — 그물을 진 사람. 아비사와 같은 방식(텍스처째)이다.
  //   §57 이 Z1 을 「아랑사 = 택촌 어부」로 적어 두었는데 정작 사람이
  //   없었다. 척도용 회색 사람 셋 중 물가에 가장 가까운 하나와 맞바꾼다.
  어부: new URL("../에셋/모형/어부.glb", import.meta.url).href,
  // 어부 둘째 — 밧줄을 진 사람. 척도용 회색 사람 (40, 36) 과 맞바꿨다.
  어부2: new URL("../에셋/모형/어부2.glb", import.meta.url).href,
  // 어부 셋째 — 그물을 인 승려풍. 척도용 회색 사람 (45, 33) 과 맞바꿨다.
  //   이로써 §3 의 「사람 자」 셋이 모두 진짜 인물로 채워졌다.
  어부3: new URL("../에셋/모형/어부3.glb", import.meta.url).href,
};

const 곳간 = new Map(); // 주소 → Promise<{지오, 재질}|null>

function 읽기(주소) {
  if (곳간.has(주소)) return 곳간.get(주소);
  const 약속 = new Promise((풀기) => {
    let 로더;
    try {
      로더 = new GLTFLoader();
    } catch (e) {
      console.warn("[구운모형] 로더를 못 만들었다:", e);
      return 풀기(null);
    }
    로더.load(
      주소,
      (g) => {
        let 메시 = null;
        g.scene.traverse((o) => {
          if (!메시 && o.isMesh) 메시 = o;
        });
        if (!메시) return 풀기(null);
        const 지오 = 메시.geometry;
        // ★ 재질도 같이 내준다. 텍스처가 붙은 모형은 **그 재질을 그대로**
        //   써야 한다 — 씬의 `바닥재질` 은 정점 색 전용이라 텍스처를 안 본다.
        const 재질 = Array.isArray(메시.material) ? 메시.material[0] : 메시.material;
        if (재질?.map) 재질.map.colorSpace = THREE.SRGBColorSpace;
        if (!지오.attributes.color && !재질?.map)
          console.warn("[구운모형] 색도 텍스처도 없는 GLB 다 — 굽기 설정을 확인해라");
        풀기({ 지오, 재질: 재질 ?? null });
      },
      undefined,
      (e) => {
        console.warn("[구운모형] 못 읽었다 — 옛 표본으로 간다:", 주소, e);
        풀기(null);
      },
    );
  });
  곳간.set(주소, 약속);
  return 약속;
}

/**
 * 구운 모형을 읽어 **표본 배열**로 내준다.
 *   이름  `주소들` 의 키(예: "구렁이")
 *   돌려주는 것 { 표본, 상태 } — 표본은 `[지오]` 또는 null
 *
 * ※ 표본이 `null` 인 동안은 부르는 쪽이 옛 표본을 쓴다. 도착하면 바뀐다.
 */
export function 구운모형쓰기(이름) {
  const [것, 것설정] = useState({ 표본: null, 지오: null, 재질: null, 상태: "쉼" });

  // ★ 의존성은 **이름 하나**다. 예전에는 `켬`(= Leva 의 `모형자연`)도 넣었는데,
  //   Leva 는 저장값을 뒤늦게 올린다. 그때 값이 한 번 바뀌면 **이펙트가
  //   정리되면서 `살아있나` 가 false 가 되고**, 마침 도착한 결과가 버려진다.
  //   실제로 그렇게 됐다 — 로그상 모형은 읽혔는데(299,999 삼각형) 상태는
  //   끝까지 「쉼」이었고, 표본이 옛것(89,994)에 머물렀다.
  //   읽는 것은 한 번이면 되고(`곳간` 이 캐시한다), **쓸지 말지는 부르는
  //   쪽이 정하면 된다.** 그러면 이 경합이 아예 없어진다.
  useEffect(() => {
    const 주소 = 주소들[이름];
    if (!주소) {
      것설정((앞) => (앞.상태 === "쉼" ? 앞 : { 표본: null, 지오: null, 재질: null, 상태: "쉼" }));
      return;
    }
    let 살아있나 = true;
    것설정({ 표본: null, 지오: null, 재질: null, 상태: "읽는중" });
    const 잰때 = performance.now();
    읽기(주소).then((것2) => {
      if (!살아있나) return;
      if (!것2?.지오) return 것설정({ 표본: null, 지오: null, 재질: null, 상태: "실패" });
      const { 지오, 재질 } = 것2;
      const 면 = (지오.index ? 지오.index.count : 지오.attributes.position.count) / 3;
      console.log(
        `[구운모형] ${이름} 준비됨 — ${면.toLocaleString()} 삼각형 · ` +
          `${지오.attributes.color ? "정점색" : 재질?.map ? "텍스처" : "색 없음"} · ` +
          `${((performance.now() - 잰때) / 1000).toFixed(1)}초`,
      );
      것설정({ 표본: [지오], 지오, 재질, 상태: "됨" });
    });
    return () => {
      살아있나 = false;
    };
  }, [이름]);

  return 것;
}
