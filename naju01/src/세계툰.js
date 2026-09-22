// 게임공간 전체를 캐릭터와 같은 cel 질감으로 — 런타임에서만 바꾼다.
//
// [왜 씬 순회인가]
//   PBR 질감의 정체는 GLB 가 물고 오는 MeshStandardMaterial 이다(지형.glb,
//   모형·바위 소품). 소스에 없는 재질이라 컴포넌트를 고쳐서는 못 잡는다.
//   씬을 훑어 표준/물리/램버트/퐁 재질을 MeshToonMaterial 로 갈아 끼우고,
//   이미 툰인 재질은 **캐릭터와 같은 그라디언트 맵**으로 계단만 맞춘다.
//   원본은 남겨 두고 되돌리기를 돌려준다(?worldtoon=off 로 A/B).
//
// [건드리지 않는 것]
//   플레이어 캐릭터(툰재질.js 가 따로 맡는다)와 그 외곽선 껍데기,
//   MeshBasicMaterial(하늘돔·구름·라벨처럼 빛을 안 받는 것),
//   ShaderMaterial, 바닥결·물잔결이 걸린 재질(셰이더 훅이 재질에 붙어 있다).
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { 그라디언트맵 } from "./툰재질.js";

const 바꿀재질 = new Set(["MeshStandardMaterial", "MeshPhysicalMaterial", "MeshLambertMaterial", "MeshPhongMaterial"]);

// 플레이어 캐릭터는 툰재질.js 가 맡는다(재질에 툰유니폼 표식, 외곽선 껍데기).
// 그 밖의 SkinnedMesh(NPC 모형 — 아비사·어부 등)는 세계와 같이 바꿔야 질감이 맞는다.
function 건너뛸까(object) {
  if (!object.isMesh) return true;
  if (object.isPoints || object.isLine || object.isSprite) return true;
  if (object.name.includes("외곽선")) return true;
  const 목록 = Array.isArray(object.material) ? object.material : [object.material];
  return 목록.some((m) => m?.userData.툰유니폼 || m?.userData.세계툰램프 === "캐릭터");
}

function 재질복사(원본, gradientMap) {
  const material = new THREE.MeshToonMaterial({
    map: 원본.map ?? null,
    color: 원본.color ? 원본.color.clone() : new THREE.Color(0xffffff),
    vertexColors: 원본.vertexColors,
    transparent: 원본.transparent,
    opacity: 원본.opacity,
    alphaTest: 원본.alphaTest,
    alphaMap: 원본.alphaMap ?? null,
    side: 원본.side,
    emissive: 원본.emissive ? 원본.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: 원본.emissiveMap ?? null,
    emissiveIntensity: 원본.emissiveIntensity ?? 1,
    // 구운 그늘(AO·라이트맵)은 형태를 잡아 주므로 남긴다. 법선·거칠기·금속·환경맵은 버린다.
    aoMap: 원본.aoMap ?? null,
    aoMapIntensity: 원본.aoMapIntensity ?? 1,
    lightMap: 원본.lightMap ?? null,
    lightMapIntensity: 원본.lightMapIntensity ?? 1,
    fog: 원본.fog,
    depthWrite: 원본.depthWrite,
    depthTest: 원본.depthTest,
    toneMapped: 원본.toneMapped,
    gradientMap,
  });
  material.name = `${원본.name || "재질"}_세계툰`;
  material.userData.세계툰원본 = 원본;
  return material;
}

/**
 * 씬 전체를 툰으로. 여러 번 불러도 된다 — 나중에 들어온 메시만 추가로 바꾼다.
 * @returns {{갱신:Function, 되돌리기:Function, 통계:Function}}
 */
export function 세계툰적용(scene, 설정) {
  const gradientMap = 그라디언트맵(설정.단계, 설정.경계);
  const 변환 = new Map(); // 원본 재질 → 툰 재질 (같은 재질을 나눠 쓰는 메시는 하나로)
  const 바꾼메시 = []; // { object, 원래 }
  const 램프바꾼 = []; // 이미 툰이던 재질 { material, 원래맵 }

  const 갱신 = () => {
    scene.traverse((object) => {
      if (건너뛸까(object)) return;
      const 목록 = Array.isArray(object.material) ? object.material : [object.material];
      let 바뀜 = false;
      const 새것 = 목록.map((m) => {
        if (!m) return m;
        if (m.userData.세계툰원본) return m; // 이미 우리가 바꾼 것
        if (m.userData.툰유니폼) return m; // 캐릭터 툰 재질(툰재질.js)
        if (m.isMeshToonMaterial) {
          if (m.gradientMap !== gradientMap && !m.userData.세계툰램프) {
            램프바꾼.push({ material: m, 원래맵: m.gradientMap });
            m.userData.세계툰램프 = true;
            m.gradientMap = gradientMap;
            m.needsUpdate = true;
          }
          return m;
        }
        if (!바꿀재질.has(m.type)) return m; // Basic·Shader 등
        if (m.userData.바닥결걸림 || m.userData.잔결걸림) return m; // 셰이더 훅이 붙은 재질
        let toon = 변환.get(m);
        if (!toon) {
          toon = 재질복사(m, gradientMap);
          변환.set(m, toon);
        }
        바뀜 = true;
        return toon;
      });
      if (!바뀜) return;
      바꾼메시.push({ object, 원래: object.material });
      object.material = Array.isArray(object.material) ? 새것 : 새것[0];
    });
  };

  const 되돌리기 = () => {
    바꾼메시.forEach(({ object, 원래 }) => {
      // 그 사이 다른 코드(구운지형 스위치 등)가 재질을 바꿨으면 그쪽을 존중한다.
      const 지금 = Array.isArray(object.material) ? object.material : [object.material];
      if (지금.every((m) => m?.userData.세계툰원본)) object.material = 원래;
    });
    바꾼메시.length = 0;
    변환.forEach((toon) => toon.dispose());
    변환.clear();
    램프바꾼.forEach(({ material, 원래맵 }) => {
      material.gradientMap = 원래맵;
      delete material.userData.세계툰램프;
      material.needsUpdate = true;
    });
    램프바꾼.length = 0;
  };

  const 통계 = () => ({ 바꾼메시: 바꾼메시.length, 바꾼재질: 변환.size, 램프맞춘재질: 램프바꾼.length });

  갱신();
  return { 갱신, 되돌리기, 통계 };
}

// 씬 안에 두면 알아서 돈다. 소품·지형·NPC 가 나중에 로드되므로 주기적으로 다시 훑는다.
//   ※ useFrame 에 걸었더니 처음 한 번만 돌고 뒤에 들어온 NPC 모형 4개가 PBR 로 남았다.
//     렌더 루프에 기대지 않는 타이머로 훑고, 바뀐 게 있으면 invalidate 로 한 장 더 그린다.
export function TOON세계({ 켬 = true, 단계 = 3, 경계 = 0.5, 주기ms = 500 }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const 핸들 = useRef(null);
  useEffect(() => {
    if (!켬) return undefined;
    const 손잡이 = 세계툰적용(scene, { 단계, 경계 });
    핸들.current = 손잡이;
    // 콘솔에서 __세계툰.통계() 로 몇 개를 바꿨는지, scene 으로 남은 재질을 훑어볼 수 있다.
    if (import.meta.env.DEV && typeof window !== "undefined") window.__세계툰 = { ...손잡이, scene };
    const 타이머 = setInterval(() => {
      const 전 = 손잡이.통계();
      손잡이.갱신();
      const 후 = 손잡이.통계();
      if (후.바꾼메시 !== 전.바꾼메시 || 후.램프맞춘재질 !== 전.램프맞춘재질) invalidate();
    }, 주기ms);
    return () => {
      clearInterval(타이머);
      손잡이.되돌리기();
      핸들.current = null;
      invalidate();
    };
  }, [scene, invalidate, 켬, 단계, 경계, 주기ms]);
  return null;
}
