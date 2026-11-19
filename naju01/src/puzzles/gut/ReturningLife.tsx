/**
 * 되살아난 것들 — 굿이 풀려 날이 개면 바람이 잦아들며 나뭇잎이 흩날려 내려앉고, 오리들이 날아들어 앉았다 날고,
 * 강에서 물고기가 뛰어오른다. 나뭇잎은 평소에도 가끔 한두 장 내린다.
 */
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";

import { M } from "../units";
import { usePrewarm } from "../usePrewarm";
import { useGroundReady } from "../cliff/useGroundReady";
import { buildDucks, buildLeapers, buildLeaves, updateDucks, updateLeapers, updateLeaves } from "./dawnCreatures";
import { gut } from "./gutState";

/** 평소 1초에 내리는 잎 수 · 날이 갠 직후 흩날리는 잎 수 · 그 뒤 잔잔히 내리는 잎 수 */
const LEAF_RATE = { usual: 0.3, burst: 7, calm: 1.2 };
/** 날이 갠 뒤 바람이 잦아드는 데 걸리는 시간(초) · 그동안의 바람 세기 · 그 뒤 남는 산들바람 */
const SETTLE = { seconds: 14, gust: 0.6, breeze: 0.14 };
/** 눈이 이보다 낮으면(미터) 물속 · 굴속이다 — 잎이 내리지 않는다 */
const OPEN_AIR_FROM = 0.2;

export default function ReturningLife() {
  const ground = useGroundReady();
  return ground ? <ReturningLifeScene key={ground} /> : null;
}

function ReturningLifeScene() {
  const { scene, gl, camera } = useThree();
  const leaves = useMemo(() => buildLeaves(), []);
  const ducks = useMemo(() => buildDucks(), []);
  const leapers = useMemo(() => buildLeapers(), []);

  usePrewarm(leaves.mesh, ducks.root, leapers.root);

  useEffect(() => {
    scene.add(leaves.mesh, ducks.root, leapers.root);
    return () => {
      scene.remove(leaves.mesh, ducks.root, leapers.root);
    };
  }, [scene, leaves, ducks, leapers]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const isDawn = gut.stage() === "dawn";
    // 날이 갠 직후에는 바람이 세게 한 번 쓸고, 차츰 잦아든다
    const settled = isDawn ? Math.min(1, gut.elapsed() / SETTLE.seconds) : 1;
    const isOpenAir = camera.position.y / M > OPEN_AIR_FROM;
    updateLeaves(leaves, dt, camera, {
      rate: !isOpenAir ? 0 : !isDawn ? LEAF_RATE.usual : settled < 1 ? LEAF_RATE.burst : LEAF_RATE.calm,
      wind: isDawn ? SETTLE.gust * (1 - settled) + SETTLE.breeze : 0.08 + gut.wind() * 0.5,
      isBright: isDawn,
    });
    updateDucks(ducks, dt, clock.elapsedTime, isDawn, camera);
    updateLeapers(leapers, dt, isDawn, gl, camera);
  });

  return null;
}
