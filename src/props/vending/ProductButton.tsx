import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { aim } from "@/lobby/interactions";
import { heldCoin } from "@/props/coinState";
import { buttonLight, pressDepth, type VendingId } from "@/props/vendingMachineState";

import { worldPositionOf } from "@/props/shared/worldPosition";
import ToonMaterial from "@/props/shared/ToonMaterial";

type Corner = [number, number, number];

/**
 * 앞이 좁고 뒤가 넓은 사다리꼴 버튼 캡.
 * 납작한 상자는 정면에서 색칠한 사각형과 구별이 안 된다 — '눌리는 물건' 으로 읽히는 건 치마처럼 벌어진 경사면이다.
 * 자체발광 재질이라 조명이 음영을 안 만들어, 위 경사는 밝게·아래 경사는 어둡게 면마다 재질을 나눠 색으로 넣는다.
 * 재질 순서: 앞(0) · 위 경사(1) · 아래 경사(2) · 옆과 뒤(3)
 */
function buttonCapGeometry(width: number, height: number, depth: number, flare: number) {
  const fw = width / 2;
  const fh = height / 2;
  const hd = depth / 2;
  const bw = fw + flare;
  const bh = fh + flare;
  const back: Corner[] = [
    [-bw, -bh, -hd],
    [bw, -bh, -hd],
    [bw, bh, -hd],
    [-bw, bh, -hd],
  ];
  const front: Corner[] = [
    [-fw, -fh, hd],
    [fw, -fh, hd],
    [fw, fh, hd],
    [-fw, fh, hd],
  ];
  const quad = (a: Corner, b: Corner, c: Corner, d: Corner) => [...a, ...b, ...c, ...a, ...c, ...d];
  const positions = [
    ...quad(front[0], front[1], front[2], front[3]), // 0  앞
    ...quad(back[3], back[2], back[1], back[0]), // 6  뒤
    ...quad(back[0], back[1], front[1], front[0]), // 12 아래 경사
    ...quad(back[1], back[2], front[2], front[1]), // 18 오른 경사
    ...quad(back[2], back[3], front[3], front[2]), // 24 위 경사
    ...quad(back[3], back[0], front[0], front[3]), // 30 왼 경사
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // 앞면에만 UV — 커피 자판기는 여기에 이름표 그림이 붙는다
  const uv = new Float32Array(36 * 2);
  [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1].forEach((v, i) => (uv[i] = v));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(24, 6, 1);
  geometry.addGroup(12, 6, 2);
  geometry.addGroup(18, 6, 3);
  geometry.addGroup(30, 6, 3);
  geometry.addGroup(6, 6, 3); // 뒤 — 안 보이지만 재질이 있어야 한다
  return geometry;
}

const basicColor = (material: THREE.Material | undefined) =>
  material instanceof THREE.MeshBasicMaterial ? material.color : null;

interface ProductButtonProps {
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  labelTexture?: THREE.Texture;
  frameColor?: string;
  faceColor?: string;
  /** 장식용 자판기에서만 쓴다 — 만질 수 있는 자판기는 상태가 불빛을 정한다 */
  lit?: boolean;
  brightness?: number;
  outline?: OutlineValues | null;
  /** 없으면 그냥 장식 */
  vendingId?: VendingId;
  index?: number;
  /** 겨냥 판정 반경 — 이웃 버튼과 안 겹칠 만큼만 */
  radius?: number;
  onPress?: () => void;
}

/**
 * 이름표 달린 작은 상품 버튼. 음료 자판기(색 버튼)와 커피 자판기(이름표 버튼)가 같이 쓴다.
 * 홈(패널에 파인 어두운 자리) 위에 그보다 작은 캡을 얹어 둘레에 테가 남게 한다 — 그 테가 '떠 있음'을 만든다.
 */
export default function ProductButton({
  x,
  y,
  z,
  width = 0.52,
  height = 0.2,
  labelTexture,
  frameColor = "#3a4652",
  faceColor = "#c9d0d8",
  lit = false,
  brightness = 1,
  outline,
  vendingId,
  index = 0,
  radius = 0.22,
  onPress,
}: ProductButtonProps) {
  // 만질 수 있는 자판기는 누른 하나만 깜빡이고 나머지는 바로 꺼진다. 바탕색까지 밝히면 안 누른 버튼이 밝게 남는다.
  const alwaysLit = vendingId ? false : lit;
  const faceBrightness = brightness * (alwaysLit ? 1.55 : 0.9);
  // 치마 폭 — 커피 자판기는 버튼 사이가 0.511 밖에 안 돼 이웃과 부딪히지 않게 줄인다
  const flare = Math.min(0.035, width * 0.09, height * 0.13);
  const capDepth = 0.075;
  const cap = useMemo(() => buttonCapGeometry(width, height, capDepth, flare), [width, height, flare]);
  useEffect(() => () => cap.dispose(), [cap]);

  // 이름표 버튼은 틀 색을, 색 버튼은 제 색을 경사면 기준으로 삼는다.
  const face = scaleColor(faceColor, alwaysLit ? 1 : Math.min(1, 0.62 + brightness * 0.45));
  const sideBase = labelTexture ? scaleColor(frameColor, brightness) : face;

  // 불빛·눌림은 매 프레임 바뀐다. props 로 넘기면 초당 60번 다시 그려서 재질 색을 손으로 곱한다.
  const base = useMemo(
    () => ({
      face: new THREE.Color(labelTexture ? "#ffffff" : face),
      top: new THREE.Color(scaleColor(sideBase, 1.4)),
      bottom: new THREE.Color(scaleColor(sideBase, 0.5)),
      side: new THREE.Color(scaleColor(sideBase, 0.8)),
      // 경사면까지 버튼 색으로 물들어야 테만 하얘지지 않고 버튼이 통째로 빛난다
      glow: new THREE.Color(faceColor),
    }),
    [labelTexture, face, sideBase, faceColor],
  );

  const rootRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Mesh>(null);
  const aimId = vendingId ? `vendingButton:${vendingId}:${index}` : null;

  useFrame(() => {
    const mesh = capRef.current;
    if (!mesh) return;
    const now = performance.now();
    const pressed = vendingId ? pressDepth(vendingId, index, now) : 0;
    const light = vendingId ? buttonLight(vendingId, index, now) : alwaysLit ? 1 : 0;
    const isAimed = aimId && aim.get() === aimId ? 1 : 0;

    mesh.position.z = 0.02 + capDepth / 2 - pressed * (capDepth * 0.6);

    // 겨냥 중에는 아주 살짝만 밝혀 글자 없이 '누를 수 있다' 를 알린다.
    const k = 1 + light * 1.35 + isAimed * 0.22;
    const mix = Math.min(1, light * 0.8);
    const materials = mesh.material;
    if (!Array.isArray(materials) || materials.length < 4) return;
    const faceTint = basicColor(materials[0]);
    const topTint = basicColor(materials[1]);
    const bottomTint = basicColor(materials[2]);
    const sideTint = basicColor(materials[3]);
    if (!faceTint || !topTint || !bottomTint || !sideTint) return;
    faceTint.copy(base.face).multiplyScalar(labelTexture ? faceBrightness * k : k);
    topTint.copy(base.top).lerp(base.glow, mix).multiplyScalar(k);
    bottomTint
      .copy(base.bottom)
      .lerp(base.glow, mix)
      .multiplyScalar(k * 0.8);
    sideTint
      .copy(base.side)
      .lerp(base.glow, mix)
      .multiplyScalar(k * 0.9);
  });

  return (
    <group position={[x, y, z]} ref={rootRef}>
      {aimId && vendingId && (
        <Interactable
          id={aimId}
          radius={radius}
          reach={5}
          position={() => worldPositionOf(rootRef)}
          label=""
          // 동전을 든 동안은 겨냥이 버튼에 안 뺏기고 투입구로 가야 한다
          disabled={() => !!heldCoin()}
          run={() => onPress?.()}
        />
      )}
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[width + flare * 2 + 0.01, height + flare * 2 + 0.01, 0.07]} />
        <ToonMaterial color={scaleColor(frameColor, brightness * 0.55)} />
        <ToonOutline outline={outline} />
      </mesh>

      <mesh ref={capRef} geometry={cap} position={[0, 0, 0.02 + capDepth / 2]} castShadow>
        {labelTexture ? (
          <meshBasicMaterial
            attach="material-0"
            map={labelTexture}
            toneMapped={false}
            color={new THREE.Color(faceBrightness, faceBrightness, faceBrightness)}
          />
        ) : (
          <meshBasicMaterial attach="material-0" color={face} toneMapped={false} />
        )}
        <meshBasicMaterial attach="material-1" color={scaleColor(sideBase, 1.4)} toneMapped={false} />
        <meshBasicMaterial attach="material-2" color={scaleColor(sideBase, 0.5)} toneMapped={false} />
        <meshBasicMaterial attach="material-3" color={scaleColor(sideBase, 0.8)} toneMapped={false} />
        <ToonOutline geometry={cap} outline={outline} />
      </mesh>
    </group>
  );
}
