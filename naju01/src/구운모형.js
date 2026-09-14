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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const 주소들 = {
  구렁이: new URL("../에셋/모형/구렁이-색.glb", import.meta.url).href,
};

const 곳간 = new Map(); // 주소 → Promise<BufferGeometry|null>

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
        let 찾음 = null;
        g.scene.traverse((o) => {
          if (!찾음 && o.isMesh) 찾음 = o.geometry;
        });
        if (찾음 && !찾음.attributes.color)
          console.warn("[구운모형] 색이 없는 GLB 다 — 텍스처를 정점 색으로 구웠는지 확인해라");
        풀기(찾음);
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
  const [것, 것설정] = useState({ 표본: null, 상태: "쉼" });

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
      것설정((앞) => (앞.상태 === "쉼" ? 앞 : { 표본: null, 상태: "쉼" }));
      return;
    }
    let 살아있나 = true;
    것설정({ 표본: null, 상태: "읽는중" });
    const 잰때 = performance.now();
    읽기(주소).then((지오) => {
      if (!살아있나) return;
      if (!지오) return 것설정({ 표본: null, 상태: "실패" });
      const 면 = (지오.index ? 지오.index.count : 지오.attributes.position.count) / 3;
      console.log(
        `[구운모형] ${이름} 준비됨 — ${면.toLocaleString()} 삼각형 · ` +
          `색 ${지오.attributes.color ? "있음" : "없음"} · ` +
          `${((performance.now() - 잰때) / 1000).toFixed(1)}초`,
      );
      것설정({ 표본: [지오], 상태: "됨" });
    });
    return () => {
      살아있나 = false;
    };
  }, [이름]);

  return 것;
}
