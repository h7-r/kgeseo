// ═══════════════════════════════════════════════════════════════
//  새지형.js — 블렌더가 구운 땅 한 벌(GLB + 높이표)을 읽어 온다
// ═══════════════════════════════════════════════════════════════
// [무엇을 바꾸나]
//   `도구/지형짓기.py` 가 한 배열에서 둘을 낸다 —
//     `에셋/지형.glb`      그림용 메시 (128,000 삼각형, 길이 **땅에 파여** 있다)
//     `에셋/지형높이.bin`  판정용 격자 (0.25 m, `지형표.js` 가 읽는다)
//   이 훅은 둘을 같이 읽어, 씬이 한 번에 갈아끼울 수 있게 내준다.
//
// [★ 왜 서스펜스(useGLTF)가 아닌가]
//   drei 의 `useGLTF` 는 로딩 중 컴포넌트를 **던진다**(suspend). 그러면
//   지형이 도착할 때까지 씬 전체가 안 그려지고, 실패하면 에러 경계로 튄다.
//   여기서는 실패해도 **옛 지형으로 그냥 돌아야** 한다 — 8.9 MB 가 안 와도
//   게임은 돌아가는 게 맞다. 그래서 직접 읽고 상태로 들고 있는다.
//
// [되돌리기]
//   이 훅을 안 쓰거나 `켬=false` 면 아무것도 안 읽는다. 옛 지형 코드
//   (`지표.js`·`바닥.js`·`통로.js`·`절벽.js`)는 **그대로 살아 있다.**

import { useEffect, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { 높이표불러오기 } from "./지형표.js";

const 글b주소 = new URL("../에셋/지형.glb", import.meta.url).href;

/**
 * 새 지형을 읽는다.
 *   켬  false 면 아무것도 안 읽는다(옛 지형 그대로).
 *   돌려주는 것 { 지오, 표, 상태 }
 *     지오  THREE.BufferGeometry — 단위는 **도면 미터**다.
 *           씬에서 `scale={미터}` 로 올려야 월드 유닛이 된다.
 *     표    `지형표.js` 의 조회기 — `지형.높이표설정(표)` 에 끼운다.
 *     상태  "쉼" | "읽는중" | "됨" | "실패"
 */
export function 새지형쓰기(켬) {
  const [것, 것설정] = useState({ 지오: null, 표: null, 상태: "쉼" });

  useEffect(() => {
    if (!켬) {
      것설정((앞) => (앞.상태 === "쉼" ? 앞 : { 지오: null, 표: null, 상태: "쉼" }));
      return;
    }
    let 살아있나 = true;
    것설정({ 지오: null, 표: null, 상태: "읽는중" });

    const 읽기 = async () => {
      const 잰때 = performance.now();
      const 표 = await 높이표불러오기();
      const 지오 = await new Promise((풀기) => {
        let 로더;
        try {
          로더 = new GLTFLoader();
        } catch (e) {
          console.warn("[새지형] 로더를 못 만들었다:", e);
          return 풀기(null);
        }
        try {
          로더.load(
            글b주소,
            (g) => {
              let 찾음 = null;
              g.scene.traverse((o) => {
                if (!찾음 && o.isMesh) 찾음 = o.geometry;
              });
              풀기(찾음);
            },
            undefined,
            (e) => {
              console.warn("[새지형] GLB 를 못 읽었다 — 옛 지형으로 간다:", e);
              풀기(null);
            },
          );
        } catch (e) {
          console.warn("[새지형] GLB 읽기가 던졌다:", e);
          풀기(null);
        }
      });
      if (!살아있나) return;
      if (!지오 || !표) {
        것설정({ 지오: null, 표: null, 상태: "실패" });
        return;
      }
      // 한 줄만 남긴다 — 8.9 MB 라 느린 회선에서 「왜 안 켜지지」가 생기고,
      //   조용히 실패하면 옛 지형으로 돌아가 티가 안 난다.
      //   ※ 헤드리스(SwiftShader)에서는 이게 20 초 넘게 걸린다. 검사 스크립트가
      //     10 초만 기다리다 「죽었다」고 잘못 판단한 적이 있다.
      console.log(
        `[새지형] 준비됨 — ${표.nx}×${표.nz} 격자 · ` +
          `${(지오.index ? 지오.index.count : 지오.attributes.position.count) / 3} 삼각형 · ` +
          `${((performance.now() - 잰때) / 1000).toFixed(1)}초`,
      );
      // ★ 법선을 다시 계산하지 않는다.
      //   GLB 가 이미 싣고 왔고, 다시 계산하면 6.4 만 꼭짓점을 훑느라
      //   전환할 때 한 박자 멈춘다. 굽는 쪽에서 이미 맞춰 놨다.
      것설정({ 지오, 표, 상태: "됨" });
    };
    읽기();
    return () => {
      살아있나 = false;
    };
  }, [켬]);

  return 것;
}
