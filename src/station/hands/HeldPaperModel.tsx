import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";

import { hintPaperTexture } from "./hintPaperTexture";

interface HeldPaperModelProps {
  outline?: OutlineValues | null;
}

/** 손에 든 밸브 힌트 쪽지 — 텍스처를 입힌 얇은 판. */
export default function HeldPaperModel({ outline }: HeldPaperModelProps) {
  const texture = useMemo(() => hintPaperTexture(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.24, 0.3), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
      {/* 같이 드는 캔·컵·관창이 전부 선을 두르고 있어 여기만 빠지면 배경에 붙어 떠 보인다. */}
      <ToonOutline geometry={geometry} outline={outline} />
    </mesh>
  );
}
