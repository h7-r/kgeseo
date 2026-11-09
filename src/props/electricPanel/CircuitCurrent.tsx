import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { DEFAULT_FOV } from "@/engine/camera";
import { playerView } from "@/engine/playerView";
import { hoseAnchors } from "@/props/nozzleState";
import {
  CONDUIT_FLOW_SECONDS,
  HOSE_FLOW_SECONDS,
  VENDING_FRENZY_SECONDS,
  getHoseFlowStartedAt,
  getValveTurnedAt,
  getVendingDoorOpenedAt,
  isVendingFrenzy,
  updateHoseFlow,
  usePanelWiring,
} from "@/props/panelWiringState";
import { requestFlowFocus } from "@/props/shared/flowFocus";
import { buildLightningGeometry, createLightningMaterial } from "@/props/shared/lightning";

import { getConduitPaths, vendingFocus } from "./circuitPaths";

/** 다 닿은 뒤 번개가 잦아드는 시간(초) */
const FADE_SECONDS = 1.2;
/**
 * 소화전에 닿고 화면이 머무는 시간(초). 1초는 시선이 따라붙는 시간까지 들어가 밸브를 보기도 전에 끝났다
 * — 「돌아가서 밸브를 열어야 한다」를 몰랐다(미르 11/9, 튜토피드백 10회차).
 */
const HOSE_HOLD_SECONDS = 2.2;
/** 머무는 동안 이만큼(유닛) 높이가 화면에 차게 당긴다 — 소화전함이 화면 절반 남짓. 너무 당기면 어디인지 잃는다 */
const VALVE_VIEW_HEIGHT = 2.6;
const MIN_FOV_SCALE = 0.35;

const valvePoint = new THREE.Vector3();

/** 지금 선 자리에서 밸브 둘레가 화면에 차는 시야각 배율 — 가까우면 그대로(1) */
function fovScaleToValve(valve: THREE.Vector3) {
  if (!playerView.ready) return 1;
  const distance = playerView.eye.distanceTo(valve);
  const needed = THREE.MathUtils.radToDeg(2 * Math.atan(VALVE_VIEW_HEIGHT / 2 / Math.max(distance, 0.1)));
  return THREE.MathUtils.clamp(needed / DEFAULT_FOV, MIN_FOV_SCALE, 1);
}

interface StrikeProps {
  path: THREE.Curve<THREE.Vector3>;
  startedAt: number;
  seconds: number;
  /** 다 닿은 뒤 얼마나 더 치지직거리나 */
  lingerSeconds: number;
}

/** 길 하나를 타고 가는 번개 — 호스 · 전선관. 끝에 닿고 잠시 뒤 사라진다 */
function PathLightning({ path, startedAt, seconds, lingerSeconds }: StrikeProps) {
  const length = useMemo(() => path.getLength(), [path]);
  const geometry = useMemo(() => buildLightningGeometry(path, length), [path, length]);
  const material = useMemo(() => createLightningMaterial({ throughWalls: true }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const now = performance.now() / 1000;
    const since = now - startedAt;
    const { uniforms } = material;
    uniforms.uProg.value = THREE.MathUtils.clamp(since / seconds, 0, 1);
    uniforms.uTime.value = now;
    uniforms.uLen.value = length;
    uniforms.uSurge.value = since >= seconds ? 1 : 0;
    const fade = 1 - THREE.MathUtils.clamp((since - seconds - lingerSeconds) / FADE_SECONDS, 0, 1);
    uniforms.uTrail.value = 1;
    uniforms.uFade.value = fade;
    if (meshRef.current) meshRef.current.visible = fade > 0;
  });
  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

/**
 * 소화전 회로의 전류 연출. 선을 다 잇고 관창을 꽂으면 호스를 타고 소화전으로 가고(화면이 따라가 소화전에 머문다),
 * 핸들을 돌리면 전선관을 타고 자판기로 간다(화면이 따라가 자판기 불빛과 밀림까지 본다).
 */
export default function CircuitCurrent() {
  usePanelWiring();
  const hoseStartedAt = getHoseFlowStartedAt();
  const valveAt = getValveTurnedAt();
  const hasFocusedHose = useRef(false);
  const hasFocusedConduit = useRef(false);
  const [hosePath, setHosePath] = useState<THREE.Curve<THREE.Vector3> | null>(null);

  useFrame(() => updateHoseFlow(performance.now() / 1000));

  // 호스 모양은 꽂힌 뒤로 그대로라 출발 순간에 한 번만 뜬다. 길은 관창 → 함 → 핸들
  useEffect(() => {
    if (hoseStartedAt < 0 || hoseAnchors.line.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 관창을 뽑으면 전류도 끊긴다
      setHosePath(null);
      return;
    }
    const points = [...hoseAnchors.line].reverse().map((p) => p.clone());
    if (hoseAnchors.valve) points.push(hoseAnchors.valve.getWorldPosition(new THREE.Vector3()));
    const path = new THREE.CatmullRomCurve3(points, false, "centripetal");
    setHosePath(path);
    // 뽑았다 다시 꽂아도 전류는 다시 흐르지만, 화면이 따라가는 것은 처음 한 번뿐이다
    if (hasFocusedHose.current) return;
    hasFocusedHose.current = true;
    requestFlowFocus({
      path,
      startedAt: hoseStartedAt,
      seconds: HOSE_FLOW_SECONDS,
      finalTarget: () => (hoseAnchors.valve?.getWorldPosition(valvePoint) ?? points[points.length - 1]).toArray(),
      holdUntil: () => hoseStartedAt + HOSE_FLOW_SECONDS + HOSE_HOLD_SECONDS,
      // 카메라를 늦게 넘겨받아도 밸브는 이만큼 본다 · 멀면 당겨 본다(빛나는 밸브가 보이게)
      minHoldSeconds: HOSE_HOLD_SECONDS,
      fovScale: fovScaleToValve(points[points.length - 1]),
      expiresAt: hoseStartedAt + HOSE_FLOW_SECONDS + HOSE_HOLD_SECONDS,
    });
  }, [hoseStartedAt]);

  const conduitPaths = valveAt >= 0 ? getConduitPaths() : [];
  const firstConduit = conduitPaths[0];
  useEffect(() => {
    if (valveAt < 0 || !firstConduit || hasFocusedConduit.current) return;
    hasFocusedConduit.current = true;
    requestFlowFocus({
      path: firstConduit,
      startedAt: valveAt,
      seconds: CONDUIT_FLOW_SECONDS,
      finalTarget: () => vendingFocus.target,
      finalPosition: () => vendingFocus.position,
      holdUntil: getVendingDoorOpenedAt,
      shake: () => (isVendingFrenzy(performance.now() / 1000) ? 0.6 : 0),
    });
  }, [valveAt, firstConduit]);

  return (
    <>
      {hosePath && hoseStartedAt >= 0 && (
        <PathLightning
          path={hosePath}
          startedAt={hoseStartedAt}
          seconds={HOSE_FLOW_SECONDS}
          // 핸들을 돌릴 때까지 전기가 살아 있는 것이 보이게 천천히 잦아든다
          lingerSeconds={2.4}
        />
      )}
      {conduitPaths.map((path, i) => (
        <PathLightning
          key={i}
          path={path}
          startedAt={valveAt}
          seconds={CONDUIT_FLOW_SECONDS}
          lingerSeconds={VENDING_FRENZY_SECONDS}
        />
      ))}
    </>
  );
}
