/** 공기 기둥 — 거품이 솟는 원통. 켜져 있는 동안 그 안에 서면 숨이 찬다(caveState 에 등록). 미터 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { createRandom } from "@/engine/random";

import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { M } from "../units";
import { registerAirColumn, SURFACE_Y } from "./caveState";

/**
 * 숨이 차는 자리는 거품을 더 크고 많이 — 작은 방울이 드문드문 올라 숨 자리인 줄 몰랐다(미르 11/12 「물방울이 좀 더 크고 많이 나오게 해서
 * 숨쉬는 지점이라는 걸 직관적으로」). 숨을 못 채우는 장식 거품(바닥 숨구멍)은 그대로 둬 둘이 갈린다
 */
const BREATH_BOOST = {
  /** 방울 수 배율 */
  count: 2,
  /** 크기 배율 */
  size: 1.6,
  /** 큰 방울이 나오는 정도 — 작을수록 큰 방울이 잦다(장식 거품은 2.4) */
  bigness: 1.6,
  /** 진하기 */
  alpha: 0.92,
};

interface Props {
  x: number;
  z: number;
  /** 거품이 솟기 시작하는 높이 */
  floor: number;
  radius: number;
  on: boolean;
  /** 거품 수 — 가는 새어 나옴(20)부터 기둥(160)까지 */
  count?: number;
  /** 가늘게 새는 거품은 숨을 못 채운다 */
  breathable?: boolean;
  speed?: number;
  /** 방울 크기 배율 — 조개 틈처럼 좁은 데서 새는 공기는 작게 */
  bubbleScale?: number;
}

export default function AirColumn({
  x,
  z,
  floor,
  radius,
  on,
  count = 160,
  breathable = true,
  speed = 1,
  bubbleScale = 1,
}: Props) {
  const { gl, camera } = useThree();
  const onRef = useRef(on);
  useLayoutEffect(() => {
    onRef.current = on;
  }, [on]);

  const total = breathable ? Math.round(count * BREATH_BOOST.count) : count;
  const bubbles = useMemo(() => {
    const random = createRandom(Math.round(x * 131 + z * 17));
    const glow = makeGlowPoints(total, { additive: false, softness: 1.2 });
    const seeds = new Float32Array(total * 3);
    const sizeScale = bubbleScale * (breathable ? BREATH_BOOST.size : 1);
    for (let i = 0; i < total; i++) {
      seeds[i * 3] = random();
      seeds[i * 3 + 1] = random();
      seeds[i * 3 + 2] = random();
      // 잔 방울이 많고 큰 방울은 드물게 — 숨 자리는 큰 방울이 더 잦다
      const pick = Math.pow(random(), breathable ? BREATH_BOOST.bigness : 2.4);
      glow.size.setX(i, (count < 60 ? 0.016 + pick * 0.07 : 0.018 + pick * 0.152) * sizeScale);
      glow.color.setXYZ(i, 0.86, 0.96, 0.98);
    }
    glow.points.visible = false;
    return { glow, seeds };
  }, [total, count, x, z, bubbleScale, breathable]);
  useEffect(
    () => () => {
      bubbles.glow.points.geometry.dispose();
      bubbles.glow.material.dispose();
    },
    [bubbles],
  );

  useEffect(() => {
    if (!breathable) return undefined;
    return registerAirColumn({ x, z, radius, isOn: () => onRef.current });
  }, [x, z, radius, breathable]);

  useFrame(() => {
    const { glow, seeds } = bubbles;
    glow.points.visible = onRef.current;
    if (!glow.points.visible) return;
    const time = performance.now() / 1000;
    glow.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
    const height = SURFACE_Y - floor;
    const alpha = breathable ? BREATH_BOOST.alpha : count < 60 ? 0.55 : 0.8;
    for (let i = 0; i < total; i++) {
      const seedX = seeds[i * 3];
      const seedY = seeds[i * 3 + 1];
      const seedZ = seeds[i * 3 + 2];
      const angle = seedX * Math.PI * 2 + time * 0.6;
      const r = radius * 0.75 * Math.sqrt(seedZ);
      const y = floor + ((seedY * height + time * speed * (1.1 + seedZ * 0.8)) % height);
      glow.position.setXYZ(i, (x + Math.cos(angle) * r) * M, y * M, (z + Math.sin(angle) * r) * M);
      glow.alpha.setX(i, alpha * (1 - Math.pow((y - floor) / height, 3)));
    }
    glow.commit();
  });

  return <primitive object={bubbles.glow.points} />;
}
