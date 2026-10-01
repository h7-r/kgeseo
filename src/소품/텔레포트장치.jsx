// 텔레포트장치.jsx — 기차 안에 놓는 '텔레포트 장치'(Meshy GLB) 소품.
//
// [무엇을 하나]
//   ① Meshy 에서 뽑은 teleport.glb(색·텍스처 있는 사실적 모델)를 불러와
//      **텍스처는 그대로 두고 셀 셰이딩(툰) + 외곽선**만 입혀 게임 화풍에 맞춘다.
//   ② 포털 코어에 **부드럽게 번지며 옅어지는 발광**을 얹는다.
//      → 하드 엣지 구/원 대신 **radial 그라데이션 스프라이트**(중심 밝고 가장자리
//        투명)를 겹쳐, 빛이 퍼지고 점점 연해지는 느낌을 낸다.
//   ③ 위치·가로/세로/깊이·회전·색조·발광색/세기/퍼짐/속도를 전부 Leva 에서
//      실시간으로 맞출 수 있게 useSavedControls 로 노출한다(새로고침해도 값 유지).
//
// [축척] 이 씬은 1 유닛 ≈ 0.30m. 모델 로컬 크기 ≈ 1.9×1.84×0.97.

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { TOON_GRADIENT, 만화선, useSavedControls } from "../공용.jsx";

useGLTF.preload("/models/teleport.glb");

const 라디안 = (도) => (도 * Math.PI) / 180;

// ── 부드러운 발광 텍스처 ────────────────────────────────────
//   중심은 하얗게 꽉 차고 가장자리로 갈수록 **투명해지는** 원.
//   이 한 장을 스프라이트에 씌우면 빛이 번지고 점점 연해지는 헤일로가 된다.
//   (색은 스프라이트 재질의 color 로 입힌다 — 텍스처는 흰색 그라데이션)
let _발광텍스처 = null;
function 발광텍스처() {
  if (_발광텍스처) return _발광텍스처;
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // 가운데는 진하게, 바깥으로 갈수록 빠르게 옅어졌다가 길게 사라진다(부드러운 번짐)
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.32, "rgba(255,255,255,0.42)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _발광텍스처 = t;
  return t;
}

// GLB → '텍스처를 살린 툰 재질' 조각 목록. (색조=map 위에 곱해지는 tint)
function useToon텍스처조각(경로, 색조) {
  const { scene } = useGLTF(경로);
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const 조각 = [];
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.matrixWorld.decompose(p, q, s);
      const mat = new THREE.MeshToonMaterial({
        map: o.material && o.material.map ? o.material.map : null, // 원본 색 유지
        color: 색조,
        gradientMap: TOON_GRADIENT,
      });
      조각.push({ geo: o.geometry, mat, p: p.toArray(), q: q.toArray(), s: s.toArray() });
    });
    return 조각;
  }, [scene, 색조]);
}

// 부드러운 발광 스프라이트 한 장(항상 카메라를 바라봄 → 늘 동그란 빛).
function 빛덩이({ 색, refCb }) {
  const 맵 = useMemo(() => 발광텍스처(), []);
  return (
    <sprite ref={refCb}>
      <spriteMaterial
        map={맵}
        color={색}
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

export default function 텔레포트장치({ 선 }) {
  const C = useSavedControls("텔레포트 장치", {
    보이기: true,
    // 위치 (기차: x −26~26 · z −5~5 · 바닥 y=0)
    X: { value: -22.5, min: -26, max: 26, step: 0.1 },
    Y: { value: 4.4, min: -2, max: 10, step: 0.1 },
    Z: { value: -0.2, min: -5, max: 5, step: 0.1 },
    // 크기 (축마다 따로 — 가로/세로/깊이)
    가로: { value: 4.0, min: 0.3, max: 10, step: 0.05 },
    세로: { value: 4.75, min: 0.3, max: 10, step: 0.05 },
    깊이: { value: 8.3, min: 0.3, max: 12, step: 0.05 },
    // 회전(도)
    회전X: { value: 0, min: -180, max: 180, step: 1 },
    회전Y: { value: 90, min: -180, max: 180, step: 1 },
    회전Z: { value: 0, min: -180, max: 180, step: 1 },
    // 색
    색조: "#ffffff",
    // ── 발광 (부드러운 번짐) ──
    발광보이기: true,
    포털색: "#5ba4e8", // 파란 헤일로(바깥으로 번지는 빛)
    코어색: "#407651", // 초록 코어(가운데 밝은 빛)
    코어크기: { value: 1.35, min: 0.1, max: 6, step: 0.05 }, // 가운데 밝은 빛 크기
    헤일로크기: { value: 2.1, min: 0.2, max: 12, step: 0.1 }, // 바깥으로 번지는 정도
    코어세기: { value: 0.6, min: 0, max: 3, step: 0.05 }, // 코어 밝기(투명도)
    헤일로세기: { value: 0.65, min: 0, max: 3, step: 0.05 }, // 번짐 밝기(투명도)
    맥동속도: { value: 3.9, min: 0, max: 8, step: 0.1 }, // 숨쉬듯 밝아졌다 어두워지는 속도
    빛세기: { value: 1.65, min: 0, max: 8, step: 0.05 }, // 주변을 물들이는 점광원
    // 발광 위치(로컬, 배율 적용 전) — 포털 코어 한가운데로 맞춘다
    발광X: { value: 0.0, min: -1.5, max: 1.5, step: 0.02 },
    발광Y: { value: 0.0, min: -1.5, max: 1.5, step: 0.02 },
    발광Z: { value: 0.02, min: -1.0, max: 1.5, step: 0.02 },
  });

  const 조각 = useToon텍스처조각("/models/teleport.glb", C.색조);
  const 코어ref = useRef(null);
  const 헤일로ref = useRef(null);
  const 빛ref = useRef(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const 맥 = 0.5 + 0.5 * Math.sin(t * C.맥동속도); // 0~1 숨쉬기
    const 코 = 코어ref.current;
    if (코) {
      const s = C.코어크기 * (0.88 + 0.24 * 맥);
      코.scale.set(s, s, 1);
      코.material.opacity = Math.min(1, C.코어세기 * (0.65 + 0.35 * 맥));
    }
    const 헤 = 헤일로ref.current;
    if (헤) {
      const s = C.헤일로크기 * (0.94 + 0.12 * 맥);
      헤.scale.set(s, s, 1);
      헤.material.opacity = Math.min(1, C.헤일로세기 * (0.55 + 0.3 * 맥));
    }
    if (빛ref.current) 빛ref.current.intensity = C.빛세기 * (0.7 + 0.5 * 맥);
  });

  if (!C.보이기) return null;

  return (
    <group
      position={[C.X, C.Y, C.Z]}
      rotation={[라디안(C.회전X), 라디안(C.회전Y), 라디안(C.회전Z)]}
      scale={[C.가로, C.세로, C.깊이]}
    >
      {/* 본체 — 텍스처 살린 툰 + 외곽선 */}
      {조각.map((c, i) => (
        <mesh
          key={i}
          geometry={c.geo}
          material={c.mat}
          position={c.p}
          quaternion={c.q}
          scale={c.s}
          castShadow
          receiveShadow
        >
          <만화선 geo={c.geo} 선={선} />
        </mesh>
      ))}

      {/* 발광 — 바깥으로 번지며 옅어지는 헤일로 + 가운데 밝은 코어 */}
      {C.발광보이기 && (
        <group position={[C.발광X, C.발광Y, C.발광Z]}>
          {/* 넓게 번지는 빛(파랑) — 뒤에 깔린다 */}
          <빛덩이 색={C.포털색} refCb={헤일로ref} />
          {/* 가운데 밝은 코어(초록) — 위에 얹힌다 */}
          <빛덩이 색={C.코어색} refCb={코어ref} />
          {/* 주변을 물들이는 점광원 */}
          <pointLight ref={빛ref} color={C.포털색} intensity={C.빛세기} distance={10} decay={2} />
        </group>
      )}
    </group>
  );
}
