import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { scaleColor } from "@/engine/color";
import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { AimHighlight } from "@/lobby/AimHighlight";

import { requestFlowFocus } from "@/props/shared/flowFocus";
import { buildLightningGeometry, createLightningMaterial } from "@/props/shared/lightning";

import { computeSurge, FLOW_SECONDS, getFlowPath, getPaintingStruckAt, LIGHT_DELAY_SECONDS } from "./currentFlow";
import { PAINTING_HEIGHT_PX, PAINTING_WIDTH_PX, computeStartupBrightness } from "./puzzleGeometry";
import { makeLastTrainBackgroundTexture, makeLastTrainWindowLightTexture } from "./paintingTextures";
import { makeLongPlaqueTexture } from "./labelTextures";
import { getBinFlowStartedAt, isPaintingPowered, useWindowSwitchKey } from "./workLampState";

/** 틀 폭 */
const FRAME = 0.24;
const WINDOW_LIGHT_COLOR = new THREE.Color(1.6, 1.45, 1.2);

/** 그림 아래 명판 크기 · 글 — 스위치를 어떻게 맞출지 맨 아래 문장이 알려 준다 */
const PLAQUE = { width: 2.5, height: 1 };
const PLAQUE_BACK_COLOR = "#3e2616";
const PLAQUE_TEXT = {
  title: "막차",
  subtitle: "— 왜곡역 개통 기념 · 1987 —",
  body: "1987년 왜곡역이 문을 연 날 밤, 마지막 열차를 그린 그림이다. 그날 승무원은 손님이 앉은 자리마다 창등을 손수 밝히고, 빈자리는 어둠 속에 그대로 두었다고 한다.",
  hint: "사람이 앉은 창에만 불을 밝혀야 막차가 떠난다.",
};
/** 그림에 닿은 뒤 화면이 머무는 시간(초) */
const STRUCK_HOLD_SECONDS = 2;

/** 형광등이 붙듯 두어 번 껌뻑이다 선다(0~1) */
const computeWindowStartup = (t: number) => (t < 0 ? 0 : computeStartupBrightness(t));

/** 액자 틀 네 변 */
function buildFramePieces(width: number, height: number, depthX: number, bar: number, margin: number): BoxPiece[] {
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
 * 벽에 걸린 그림 「막차」. 두 통의 전류가 다 닿으면 번개가 그림을 때리고 잠시 뒤 창에 불이 든다.
 * 창빛은 시험반 스위치를 그대로 따른다 — 젖히는 순간 그 창 불이 켜지고 꺼진다.
 */
export default function Painting({ position, width = 2.6, direction = -1, brightness = 1, outline }: PaintingProps) {
  const d = direction;
  const height = width * (PAINTING_HEIGHT_PX / PAINTING_WIDTH_PX);
  const background = makeLastTrainBackgroundTexture();
  const windowLights = makeLastTrainWindowLightTexture(useWindowSwitchKey());
  const plaque = makeLongPlaqueTexture(PLAQUE_TEXT);
  const faceRotation: [number, number, number] = [0, d > 0 ? Math.PI / 2 : -Math.PI / 2, 0];
  const windowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const strikesRef = useRef<THREE.Group>(null);
  const lampMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const plaqueMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const strikeMaterial = useMemo(() => createLightningMaterial(), []);
  // 전선이 닿는 액자 위 두 곳에서 그림 가운데로 때리는 번개
  const strikes = useMemo(() => {
    const x = d * 0.2;
    return [-1, 1].map((s) => {
      const path = new THREE.LineCurve3(
        new THREE.Vector3(x, height / 2 + FRAME, s * (width / 2 - 0.1)),
        new THREE.Vector3(x, 0, s * 0.08),
      );
      return buildLightningGeometry(path, path.getLength());
    });
  }, [width, height, d]);
  useEffect(
    () => () => {
      strikes.forEach((g) => g.dispose());
      strikeMaterial.dispose();
    },
    [strikes, strikeMaterial],
  );
  const hasFocused = useRef(false);
  useFrame(() => {
    const now = performance.now() / 1000;
    if (!hasFocused.current && isPaintingPowered()) {
      hasFocused.current = true;
      // 나중에 찬 통의 전류를 화면이 따라간다
      const lastBin = getBinFlowStartedAt("general") > getBinFlowStartedAt("plastic") ? "general" : "plastic";
      const path = getFlowPath(lastBin);
      if (path)
        requestFlowFocus({
          path,
          startedAt: getBinFlowStartedAt(lastBin),
          seconds: FLOW_SECONDS,
          finalTarget: () => position,
          holdUntil: () => getPaintingStruckAt() + LIGHT_DELAY_SECONDS + STRUCK_HOLD_SECONDS,
          shake: () => computeSurge(performance.now() / 1000),
        });
    }
    const surge = computeSurge(now);
    const { uniforms } = strikeMaterial;
    uniforms.uProg.value = surge > 0 ? 1 : 0;
    uniforms.uTime.value = now;
    uniforms.uLen.value = width;
    uniforms.uSurge.value = 1;
    uniforms.uFade.value = surge;
    // 번개가 치는 동안만 그린다. 셰이더는 예열이 안 보이는 메시까지 구워 둔다.
    if (strikesRef.current) strikesRef.current.visible = surge > 0;
    const on = computeWindowStartup(now - getPaintingStruckAt() - LIGHT_DELAY_SECONDS);
    // visible 은 끄지 않는다 — 처음 켤 때 셰이더 컴파일로 멈춘다
    if (windowMaterial.current) windowMaterial.current.opacity = on;
    // 번개가 치는 동안은 빛이 번쩍이고, 그 뒤로는 창빛이 은은하게 남는다
    if (lightRef.current) lightRef.current.intensity = on * 6 + surge * Math.random() * 14;
    lampMaterial.current?.color.setScalar(0.25 + on * 2.2);
    plaqueMaterial.current?.color.setScalar(on);
  });
  // 짙은 호두나무 바깥 + 금박 안쪽 턱 + 리넨 속틀
  const outerFrame = useMemo(
    () => buildMergedBoxes(buildFramePieces(width, height, 0.14, FRAME, FRAME)),
    [width, height],
  );
  const gildedEdge = useMemo(
    () => buildMergedBoxes(buildFramePieces(width, height, 0.18, 0.05, 0.05)),
    [width, height],
  );
  const linerFrame = useMemo(
    () => buildMergedBoxes(buildFramePieces(width, height, 0.12, 0.06, 0.01)),
    [width, height],
  );
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
      <AimHighlight id="painting:lastTrain" anchor={() => null} grow={0} strength={0.1}>
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
      </AimHighlight>
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
      <group ref={strikesRef} visible={false}>
        {strikes.map((g, i) => (
          <mesh key={i} geometry={g} material={strikeMaterial} frustumCulled={false} renderOrder={4} />
        ))}
      </group>
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
      <pointLight ref={lightRef} position={[d * 1.3, 0, 0]} color="#fff4e2" intensity={0} distance={9} decay={2} />
      {/* 긴 황동 명판 — 제목 · 설명 · 힌트. 쓰레기 퍼즐을 풀어 그림에 불이 들기 전엔 까맣게 가려 읽히지 않는다.
          빛과 그림자를 받지 않아 불이 든 뒤로는 어느 조명에서든 글이 읽힌다 */}
      <group position={[0, -height / 2 - FRAME - 0.12 - PLAQUE.height / 2, 0]}>
        <mesh position={[d * 0.01, 0, 0]}>
          <boxGeometry args={[0.022, PLAQUE.height + 0.05, PLAQUE.width + 0.05]} />
          <meshBasicMaterial color={PLAQUE_BACK_COLOR} toneMapped={false} />
        </mesh>
        <mesh position={[d * 0.03, 0, 0]} rotation={faceRotation}>
          <planeGeometry args={[PLAQUE.width, PLAQUE.height]} />
          <meshBasicMaterial ref={plaqueMaterial} map={plaque} color="#000000" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
