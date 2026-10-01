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
//
// [★ 미리 읽기 — 무리가 다섯 번 다시 만들어지지 않게]
//   다섯 모형이 제각각 도착할 때마다 씬의 `무리들` memo 가 **전부** 다시
//   돌았다(의존성에 다섯 표본이 다 들어 있다). 이제 `구운모형미리읽기()` 로
//   씬 전에 받아 두면(미리읽기.js) 훅이 첫 렌더부터 「됨」이라 한 번에 선다.

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
  어부: new URL("../에셋/모형/어부.glb", import.meta.url).href,
  // 어부 둘째 — 밧줄을 진 사람. 척도용 회색 사람 (40, 36) 과 맞바꿨다.
  어부2: new URL("../에셋/모형/어부2.glb", import.meta.url).href,
  // 어부 셋째 — 그물을 인 승려풍. 척도용 회색 사람 (45, 33) 과 맞바꿨다.
  어부3: new URL("../에셋/모형/어부3.glb", import.meta.url).href,
};

/** 미리읽기.js 가 전부 돌며 받는다 */
export const 구운모형이름들 = Object.keys(주소들);

const 곳간 = new Map(); // 주소 → Promise<{지오, 재질}|null>
const 곳간값 = new Map(); // 주소 → 끝난 결과({지오, 재질}|null) — 동기로 꺼내 쓴다

function 읽기(주소, 이름 = "") {
  if (곳간.has(주소)) return 곳간.get(주소);
  const 잰때 = performance.now();
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
  약속.then((v) => {
    곳간값.set(주소, v);
    if (v?.지오) {
      const 지오 = v.지오;
      const 면 = (지오.index ? 지오.index.count : 지오.attributes.position.count) / 3;
      console.log(
        `[구운모형] ${이름} 준비됨 — ${면.toLocaleString()} 삼각형 · ` +
          `${지오.attributes.color ? "정점색" : v.재질?.map ? "텍스처" : "색 없음"} · ` +
          `${((performance.now() - 잰때) / 1000).toFixed(1)}초`,
      );
    }
  });
  return 약속;
}

/** 씬 전에 미리 받아 둔다(미리읽기.js). 절대 거절하지 않는다. */
export function 구운모형미리읽기(이름) {
  const 주소 = 주소들[이름];
  return 주소 ? 읽기(주소, 이름) : Promise.resolve(null);
}

const 쉼 = () => ({ 표본: null, 지오: null, 재질: null, 상태: "쉼" });
const 읽는중 = () => ({ 표본: null, 지오: null, 재질: null, 상태: "읽는중" });
const 값으로 = (v) =>
  v?.지오
    ? { 표본: [v.지오], 지오: v.지오, 재질: v.재질, 상태: "됨" }
    : { 표본: null, 지오: null, 재질: null, 상태: "실패" };

/**
 * 구운 모형을 읽어 **표본 배열**로 내준다.
 *   이름  `주소들` 의 키(예: "구렁이")
 *   돌려주는 것 { 표본, 지오, 재질, 상태 } — 표본은 `[지오]` 또는 null
 *
 * ※ 표본이 `null` 인 동안은 부르는 쪽이 옛 표본을 쓴다. 도착하면 바뀐다.
 */
export function 구운모형쓰기(이름) {
  // ★ 이미 받아 둔 것이 있으면 **첫 렌더부터** 「됨」이다 — 머리말 [미리 읽기].
  const [것, 것설정] = useState(() => {
    const 주소 = 주소들[이름];
    if (!주소) return 쉼();
    if (곳간값.has(주소)) return 값으로(곳간값.get(주소));
    return 읽는중();
  });

  // ★ 의존성은 **이름 하나**다. 예전에는 `켬`(= Leva 의 `모형자연`)도 넣었는데,
  //   Leva 는 저장값을 뒤늦게 올린다. 그때 값이 한 번 바뀌면 이펙트가
  //   정리되면서 `살아있나` 가 false 가 되고, 마침 도착한 결과가 버려졌다.
  useEffect(() => {
    const 주소 = 주소들[이름];
    if (!주소) {
      것설정((앞) => (앞.상태 === "쉼" ? 앞 : 쉼()));
      return;
    }
    if (곳간값.has(주소)) {
      // 같은 결과면 **같은 객체**를 지킨다 — 새 객체(새 `표본` 배열)를 주면
      //   씬의 `표본`·`무리들` memo 가 「바뀌었다」고 보고 무리를 도로 다시 만든다.
      const 다음 = 값으로(곳간값.get(주소));
      것설정((앞) => (앞.지오 === 다음.지오 && 앞.상태 === 다음.상태 ? 앞 : 다음));
      return;
    }
    let 살아있나 = true;
    것설정((앞) => (앞.상태 === "읽는중" ? 앞 : 읽는중()));
    읽기(주소, 이름).then((v) => {
      if (살아있나) 것설정(값으로(v));
    });
    return () => {
      살아있나 = false;
    };
  }, [이름]);

  return 것;
}
