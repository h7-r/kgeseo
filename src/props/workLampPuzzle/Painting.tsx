import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { mergeBoxes, type MergeBox } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Highlight } from "@/lobby/Highlight";

import { createCurrentMaterial, FLOW_SECONDS } from "./currentFlow";
import { PAINTING_HEIGHT_PX, PAINTING_WIDTH_PX, roundedPolyline, startupBrightness } from "./geometry";
import { lastTrainBackgroundTexture, lastTrainWindowLightTexture } from "./paintingTextures";
import { nameplateTexture } from "./textures";
import { flowStartedAt, isBinComplete, useWindowSwitchKey } from "./workLampState";

/** 틀 폭 */
const FRAME = 0.24;
const WINDOW_LIGHT_COLOR = new THREE.Color(1.6, 1.45, 1.2);

/** 형광등이 붙듯 두어 번 껌뻑이다 선다(0~1) */
const windowStartup = (t: number) => (t < 0 ? 0 : startupBrightness(t));

/** 액자 틀 네 변 */
function framePieces(width: number, height: number, depthX: number, bar: number, margin: number): MergeBox[] {
  const halfW = width / 2 + margin,
    halfH = height / 2 + margin;
  return [
    { position: [0, halfH - bar / 2, 0], size: [depthX, bar, halfW * 2] },
    { position: [0, -halfH + bar / 2, 0], size: [depthX, bar, halfW * 2] },
    { position: [0, 0, halfW - bar / 2], size: [depthX, halfH * 2 - bar * 2, bar] },
    { position: [0, 0, -halfW + bar / 2], size: [depthX, halfH * 2 - bar * 2, bar] },
  ];
}

interface PaintingProps {
  position: [number, number, number];
  width?: number;
  /** −1 이면 −x 를 본다(안쪽벽) */
  direction?: number;
  brightness?: number;
  outline?: OutlineValues | null;
}

/**
 * 벽에 걸린 그림 「막차」. 두 통의 전류가 다 닿으면 테를 한 바퀴 돌고(1.2 초) 창에 불이 든다.
 * 창빛은 시험반 스위치를 그대로 따른다 — 젖히는 순간 그 창 불이 켜지고 꺼진다.
 */
export default function Painting({ position, width = 2.6, direction = -1, brightness = 1, outline }: PaintingProps) {
  const d = direction;
  const height = width * (PAINTING_HEIGHT_PX / PAINTING_WIDTH_PX);
  const background = lastTrainBackgroundTexture();
  const windowLights = lastTrainWindowLightTexture(useWindowSwitchKey());
  const nameplate = nameplateTexture("막차", "— 왜곡역 개통 기념 · 1987 —");
  const faceRotation: [number, number, number] = [0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0];
  const windowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const lampMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const rimCurrentMaterial = useMemo(() => createCurrentMaterial(), []);
  // 테를 도는 길 — 위 가운데에서 출발해 양쪽으로 갈라져 아래에서 만난다
  const rimPaths = useMemo(() => {
    const x = d * 0.19,
      halfW = width / 2 + FRAME * 0.5,
      halfH = height / 2 + FRAME * 0.5;
    const side = (s: number) =>
      roundedPolyline(
        [
          [x, halfH, 0],
          [x, halfH, s * halfW],
          [x, -halfH, s * halfW],
          [x, -halfH, 0],
        ],
        0.08,
      );
    return [-1, 1].map((s) => new THREE.TubeGeometry(side(s), 80, 0.03, 6, false));
  }, [width, height, d]);
  useEffect(
    () => () => {
      rimPaths.forEach((g) => g.dispose());
      rimCurrentMaterial.dispose();
    },
    [rimPaths, rimCurrentMaterial],
  );
  useFrame(() => {
    // 두 선이 다 닿은 뒤부터 잰다 — 테를 도는 1.2 초, 그 뒤 창에 불
    const arrived =
      isBinComplete("general") && isBinComplete("plastic")
        ? Math.max(flowStartedAt("general"), flowStartedAt("plastic")) + FLOW_SECONDS
        : Infinity;
    const now = performance.now() / 1000;
    rimCurrentMaterial.uniforms.uProg.value = Math.min(1, Math.max(0, (now - arrived) / 1.2));
    rimCurrentMaterial.uniforms.uTime.value = now;
    rimCurrentMaterial.uniforms.uLen.value = width + height;
    const on = windowStartup(now - arrived - 1.2);
    // visible 은 끄지 않는다 — 처음 켤 때 셰이더 컴파일로 멈춘다
    if (windowMaterial.current) windowMaterial.current.opacity = on;
    if (lightRef.current) lightRef.current.intensity = on * 6;
    lampMaterial.current?.color.setScalar(0.25 + on * 2.2);
  });
  // 짙은 호두나무 바깥 + 금박 안쪽 턱 + 리넨 속틀
  const outerFrame = useMemo(() => mergeBoxes(framePieces(width, height, 0.14, FRAME, FRAME)), [width, height]);
  const gildedEdge = useMemo(() => mergeBoxes(framePieces(width, height, 0.18, 0.05, 0.05)), [width, height]);
  const linerFrame = useMemo(() => mergeBoxes(framePieces(width, height, 0.12, 0.06, 0.01)), [width, height]);
  useEffect(
    () => () => {
      outerFrame?.dispose();
      gildedEdge?.dispose();
      linerFrame?.dispose();
    },
    [outerFrame, gildedEdge, linerFrame],
  );
  return (
    <group position={position}>
      <Highlight id="painting:lastTrain" anchor={() => null} grow={0} strength={0.1}>
        {outerFrame && (
          <mesh geometry={outerFrame} position={[d * 0.07, 0, 0]} castShadow>
            <meshToonMaterial color={scaleColor("#3e2616", brightness)} gradientMap={TOON_GRADIENT} />
            <ToonOutline geometry={outerFrame} outline={outline} />
            <Outlines thickness={3} color="#0f0c09" />
          </mesh>
        )}
        {gildedEdge && (
          <mesh geometry={gildedEdge} position={[d * 0.09, 0, 0]}>
            <meshToonMaterial color={scaleColor("#b08a3e", brightness * 1.1)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )}
        {linerFrame && (
          <mesh geometry={linerFrame} position={[d * 0.06, 0, 0]}>
            <meshToonMaterial color={scaleColor("#cfc6ad", brightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
        )}
      </Highlight>
      {/* toon 재질에 복도 밝기를 곱한다 — basic 이면 어둠 속에서 그림만 환하게 뜬다 */}
      <mesh position={[d * 0.125, 0, 0]} rotation={faceRotation}>
        <planeGeometry args={[width, height]} />
        <meshToonMaterial
          map={background}
          color={scaleColor("#ffffff", brightness * 1.08)}
          gradientMap={TOON_GRADIENT}
        />
      </mesh>
      {/* 창빛 — 더하기 섞기라 어두운 바탕 위에서만 빛난다. 바탕에 붙어 있으면 멀리서 깊이 싸움에 져 띄우고 보정까지 건다. */}
      <mesh position={[d * 0.14, 0, 0]} rotation={faceRotation} renderOrder={2}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={windowMaterial}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
          map={windowLights}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          color={WINDOW_LIGHT_COLOR}
        />
      </mesh>
      {rimPaths.map((g, i) => (
        <mesh key={i} geometry={g} material={rimCurrentMaterial} />
      ))}
      {/* 액자 위 그림등 — 창에 불이 들면 같이 켜진다 */}
      <group position={[0, height / 2 + FRAME + 0.12, 0]}>
        <mesh position={[d * 0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.24, 8]} />
          <meshToonMaterial color={scaleColor("#8a6c34", brightness)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[d * 0.26, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, width * 0.5, 14]} />
          <meshToonMaterial color={scaleColor("#8a6c34", brightness)} gradientMap={TOON_GRADIENT} />
          <Outlines thickness={2} color="#0f0c09" />
        </mesh>
        <mesh position={[d * 0.26, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, width * 0.46, 10]} />
          <meshBasicMaterial ref={lampMaterial} color="#fff0c8" toneMapped={false} />
        </mesh>
      </group>
      {/* 처음부터 놓고 세기만 바꾼다 — 빛 개수가 바뀌면 셰이더가 통째로 다시 컴파일돼 화면이 멈춘다 */}
      <pointLight ref={lightRef} position={[d * 1.3, 0, 0]} color="#ffd79a" intensity={0} distance={9} decay={2} />
      <mesh position={[d * 0.02, -height / 2 - FRAME - 0.2, 0]} rotation={faceRotation}>
        <planeGeometry args={[1.0, 0.25]} />
        <meshToonMaterial map={nameplate} color={scaleColor("#ffffff", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
    </group>
  );
}
