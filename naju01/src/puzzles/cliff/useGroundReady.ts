/**
 * 걷는 지형이 준비됐나 — 구운 지형의 높이표는 게임이 뜬 뒤에 늦게 붙는다. 그 전에 물건을 깔면 해석식 지형
 * (실제보다 몇 cm 낮거나 높다)에 맞춰져 땅에 묻히거나 뜬다. 4스테이지 부품은 높이표가 붙은 뒤에 만든다.
 */
import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

import { walkTerrain } from "../../movement/playerPose";
import { groundY } from "../units";

/** 높이표가 붙었는지 보는 자리(미터) — 바위 위에서 해석식과 실제가 어긋나는 곳들 */
const PROBES: [number, number][] = [
  [41.9, 11.6],
  [44.7, 16.7],
  [50.5, 25.6],
];
/** 높이표를 안 쓰는 설정이면 어긋나지 않는다 — 이만큼 기다리고 해석식 지형 그대로 깐다(초) */
const GIVE_UP_SECONDS = 8;
/** 땅의 판 — 아직(0) · 기다리다 해석식 지형에 깔았다(1) · 높이표가 붙었다(2) */
type GroundVersion = 0 | 1 | 2;

const isHeightTableAttached = () => {
  const terrain = walkTerrain.current;
  return !!terrain && PROBES.some(([x, z]) => Math.abs(terrain.groundAt(x, z).y - groundY(x, z)) > 0.001);
};

/**
 * 땅의 판을 돌려준다. 0 이면 아직 깔지 않는다. 기다리다 먼저 깐 뒤(1)에 높이표가 늦게 붙으면 2 로 바뀐다 —
 * 부품에 이 값을 key 로 주면 그때 새 높이로 다시 깔린다.
 */
export function useGroundReady(): GroundVersion {
  const [version, setVersion] = useState<GroundVersion>(() => (isHeightTableAttached() ? 2 : 0));
  const waited = useRef(0);
  useFrame((_, dt) => {
    if (version === 2 || !walkTerrain.current) return;
    if (isHeightTableAttached()) setVersion(2);
    else if (version === 0 && (waited.current += dt) > GIVE_UP_SECONDS) setVersion(1);
  });
  return version;
}
