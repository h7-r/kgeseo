import { useMemo, useRef, type Ref } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { useSavedControls } from "@/engine/leva/savedControls";
import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

// Meshy 에서 뽑은 사실적 모델. 텍스처는 살리고 툰 + 외곽선만 입혀 화풍에 맞춘다. 모델 로컬 크기 ≈ 1.9×1.84×0.97.
const MODEL_URL = "/models/teleport.glb";
useGLTF.preload(MODEL_URL);

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

let glowTexture: THREE.CanvasTexture | null = null;

/** 가운데가 꽉 차고 바깥으로 투명해지는 흰 원. 색은 스프라이트 재질이 입힌다. */
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D 캔버스를 만들 수 없습니다.");
  const gradient = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // 빠르게 옅어졌다가 길게 사라져야 부드럽게 번진다.
  gradient.addColorStop(0.0, "rgba(255,255,255,1.0)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.42)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, s, s);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glowTexture = texture;
  return texture;
}

interface ToonPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshToonMaterial;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

function textureOf(material: THREE.Material | THREE.Material[]): THREE.Texture | null {
  if (Array.isArray(material)) return null;
  return "map" in material && material.map instanceof THREE.Texture ? material.map : null;
}

/** GLB 를 원본 색 텍스처를 살린 툰 재질 조각으로 편다. tint 는 텍스처 위에 곱해진다. */
function useTexturedToonParts(url: string, tint: string): ToonPart[] {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const parts: ToonPart[] = [];
    const position = new THREE.Vector3(),
      quaternion = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.matrixWorld.decompose(position, quaternion, scale);
      const material = new THREE.MeshToonMaterial({
        map: textureOf(object.material),
        color: tint,
        gradientMap: TOON_GRADIENT,
      });
      parts.push({
        geometry: object.geometry,
        material,
        position: position.toArray(),
        quaternion: quaternion.toArray() as [number, number, number, number],
        scale: scale.toArray(),
      });
    });
    return parts;
  }, [scene, tint]);
}

interface GlowSpriteProps {
  color: string;
  spriteRef: Ref<THREE.Sprite>;
}

/** 늘 카메라를 보는 부드러운 빛 한 장 */
function GlowSprite({ color, spriteRef }: GlowSpriteProps) {
  const map = useMemo(() => getGlowTexture(), []);
  return (
    <sprite ref={spriteRef}>
      <spriteMaterial
        map={map}
        color={color}
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

interface TeleportDeviceProps {
  outline: OutlineValues;
}

/** 기차 안 텔레포트 장치. 포털 코어에 맥동하는 발광(헤일로 + 코어 + 점광원)을 얹는다. */
export default function TeleportDevice({ outline }: TeleportDeviceProps) {
  const controls = useSavedControls("텔레포트 장치", {
    visible: { value: true, label: "보이기" },
    // 기차: x −26~26 · z −5~5 · 바닥 y=0
    x: { value: -22.5, min: -26, max: 26, step: 0.1, label: "X" },
    y: { value: 4.4, min: -2, max: 10, step: 0.1, label: "Y" },
    z: { value: -0.2, min: -5, max: 5, step: 0.1, label: "Z" },
    width: { value: 4.0, min: 0.3, max: 10, step: 0.05, label: "가로" },
    height: { value: 4.75, min: 0.3, max: 10, step: 0.05, label: "세로" },
    depth: { value: 8.3, min: 0.3, max: 12, step: 0.05, label: "깊이" },
    rotationX: { value: 0, min: -180, max: 180, step: 1, label: "회전X" },
    rotationY: { value: 90, min: -180, max: 180, step: 1, label: "회전Y" },
    rotationZ: { value: 0, min: -180, max: 180, step: 1, label: "회전Z" },
    tint: { value: "#ffffff", label: "색조" },
    showGlow: { value: true, label: "발광보이기" },
    /** 바깥으로 번지는 파란 헤일로 */
    portalColor: { value: "#5ba4e8", label: "포털색" },
    /** 가운데 밝은 초록 코어 */
    coreColor: { value: "#407651", label: "코어색" },
    coreSize: { value: 1.35, min: 0.1, max: 6, step: 0.05, label: "코어크기" },
    haloSize: { value: 2.1, min: 0.2, max: 12, step: 0.1, label: "헤일로크기" },
    coreIntensity: { value: 0.6, min: 0, max: 3, step: 0.05, label: "코어세기" },
    haloIntensity: { value: 0.65, min: 0, max: 3, step: 0.05, label: "헤일로세기" },
    pulseSpeed: { value: 3.9, min: 0, max: 8, step: 0.1, label: "맥동속도" },
    /** 주변을 물들이는 점광원 */
    lightIntensity: { value: 1.65, min: 0, max: 8, step: 0.05, label: "빛세기" },
    // 배율 적용 전 로컬 좌표 — 포털 코어 한가운데
    glowX: { value: 0.0, min: -1.5, max: 1.5, step: 0.02, label: "발광X" },
    glowY: { value: 0.0, min: -1.5, max: 1.5, step: 0.02, label: "발광Y" },
    glowZ: { value: 0.02, min: -1.0, max: 1.5, step: 0.02, label: "발광Z" },
  });

  const parts = useTexturedToonParts(MODEL_URL, controls.tint);
  const coreRef = useRef<THREE.Sprite>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * controls.pulseSpeed);
    const core = coreRef.current;
    if (core) {
      const s = controls.coreSize * (0.88 + 0.24 * pulse);
      core.scale.set(s, s, 1);
      core.material.opacity = Math.min(1, controls.coreIntensity * (0.65 + 0.35 * pulse));
    }
    const halo = haloRef.current;
    if (halo) {
      const s = controls.haloSize * (0.94 + 0.12 * pulse);
      halo.scale.set(s, s, 1);
      halo.material.opacity = Math.min(1, controls.haloIntensity * (0.55 + 0.3 * pulse));
    }
    if (lightRef.current) lightRef.current.intensity = controls.lightIntensity * (0.7 + 0.5 * pulse);
  });

  if (!controls.visible) return null;

  return (
    <group
      position={[controls.x, controls.y, controls.z]}
      rotation={[toRadians(controls.rotationX), toRadians(controls.rotationY), toRadians(controls.rotationZ)]}
      scale={[controls.width, controls.height, controls.depth]}
    >
      {parts.map((part, i) => (
        <mesh
          key={i}
          geometry={part.geometry}
          material={part.material}
          position={part.position}
          quaternion={part.quaternion}
          scale={part.scale}
          castShadow
          receiveShadow
        >
          <ToonOutline geometry={part.geometry} outline={outline} />
        </mesh>
      ))}

      {controls.showGlow && (
        <group position={[controls.glowX, controls.glowY, controls.glowZ]}>
          {/* 헤일로가 뒤에 깔리고 코어가 위에 얹힌다 */}
          <GlowSprite color={controls.portalColor} spriteRef={haloRef} />
          <GlowSprite color={controls.coreColor} spriteRef={coreRef} />
          <pointLight
            ref={lightRef}
            color={controls.portalColor}
            intensity={controls.lightIntensity}
            distance={10}
            decay={2}
          />
        </group>
      )}
    </group>
  );
}
