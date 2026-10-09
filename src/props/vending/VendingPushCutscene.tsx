import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { playSound } from "@/audio/sound";
import { claimCamera, releaseCamera } from "@/engine/camera";
import { requestShadowUpdates } from "@/engine/rendering";
import { makeCachedCanvasTexture } from "@/engine/textures/canvas";
import { getValveOpening } from "@/props/panelWiringState";
import {
  advancePush,
  endCutscene,
  hasSeenCutscene,
  isValveFaked,
  markCutsceneSeen,
  getPushOffset,
  getPushStage,
  setPush,
  startCutscene,
} from "@/props/vendingPushState";

const CAMERA_OWNER = "vendingPushCutscene";

type Phase = "idle" | "goIn" | "push" | "return";

// 네모난 점은 픽셀로 보인다. 가운데가 밝고 가장자리로 스러지는 동그라미여야 먼지로 읽힌다.
const makeDustTexture = () =>
  makeCachedCanvasTexture(
    "vendingDust",
    (g) => {
      const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,0.95)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.45)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gradient;
      g.fillRect(0, 0, 64, 64);
    },
    { width: 64, willReadFrequently: false, anisotropy: null },
  );

// 알갱이 상태는 배열 하나에 몰아 둔다 — 프레임마다 새로 안 만든다.
function createDustPool(count: number) {
  return {
    position: new Float32Array(count * 3),
    velocity: new Float32Array(count * 3),
    /** 0 이면 죽은 것(안 그린다) */
    remaining: new Float32Array(count),
    lifetime: new Float32Array(count),
  };
}

interface VendingPushCutsceneProps {
  enabled?: boolean;
  /** 컷신 없이 그냥 밀린 자리를 본다(자리 맞출 때 쓰는 스위치) */
  preview?: boolean;
  /** 자판기가 밀릴 z 거리 */
  distance?: number;
  /** 미는 데 걸리는 시간 */
  duration?: number;
  /** 화면이 넘어가고 돌아오는 시간 */
  transitionTime?: number;
  /** 자판기를 담은 그룹(position.z 를 만진다) */
  targetRef?: RefObject<THREE.Object3D | null>;
  /** 카메라가 설 자리 */
  viewPoint?: () => Vector3Tuple;
  /** 바라볼 곳 */
  lookAt?: () => Vector3Tuple;
  /** 먼지가 이는 자리(자판기 밑) */
  dustOrigin?: () => Vector3Tuple;
  dustCount?: number;
  dustColor?: string;
  dustSize?: number;
  dustStrength?: number;
  /** 자판기 밑 어디까지 넓게 일어날지 */
  dustSpread?: number;
  shake?: number;
}

const targetPoint = new THREE.Vector3();
const lookPoint = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const lookRotation = new THREE.Quaternion();
const currentRotation = new THREE.Quaternion();

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * 밸브가 돌면 화면이 자판기로 넘어가 밀리는 걸 보여 준다 — 밸브 자리에서는 자판기가 등 뒤라 열린 걸 못 본다.
 * ① 넘어감 → ② 밀림(먼지·떨림) → ③ 들어갈 때의 자리·시선으로 정확히 돌아옴.
 * 조금이라도 다른 자리로 돌아오면 순간이동당한 느낌이라 들어갈 때 자리를 적어 둔다.
 * 연출 동안 조작을 멈추는 판단은 App 이 `isCutscenePlaying`/`useIsCutscenePlaying`(@/props/vendingPushState) 으로 한다.
 */
export default function VendingPushCutscene({
  enabled = true,
  preview = false,
  distance = 3.4,
  duration = 2.2,
  transitionTime = 0.9,
  targetRef,
  viewPoint,
  lookAt,
  dustOrigin,
  dustCount = 90,
  dustColor = "#cfc7b6",
  dustSize = 0.22,
  dustStrength = 1,
  dustSpread = 2.2,
  shake = 0.04,
}: VendingPushCutsceneProps) {
  const camera = useThree((state) => state.camera);
  const phase = useRef<Phase>("idle");
  // 벽시계 시각. dt 를 쌓으면 카메라가 옮겨 갈 때 구역이 새로 올라오며 끊긴 만큼 연출이 늘어난다.
  const phaseStart = useRef(0);
  const lastShoveAt = useRef(0);
  const saved = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  // '밸브가 막 돌았다' 는 판정은 vendingPushState 모듈이 기억한다. 여기 ref 로 두면 씬이 다시 뜰 때 컷신이 또 돈다.
  const lastStage = useRef(-1);

  const pool = useMemo(() => createDustPool(dustCount), [dustCount]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(dustCount), 1));
    return g;
  }, [dustCount]);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: dustColor,
        size: dustSize,
        map: makeDustTexture(),
        transparent: true,
        opacity: 0.42,
        // 알갱이끼리 깊이 순서를 다투면 깜빡인다
        depthWrite: false,
        sizeAttenuation: true,
        // 끄면 Bloom 이 먼지를 빛으로 봐 불티처럼 반짝인다
        toneMapped: true,
      }),
    [dustColor, dustSize],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  // 컷신 도중 사라지면(씬 전환·Leva 끄기) 잡은 카메라를 아무도 안 놓아 화면이 굳는다.
  useEffect(() => () => releaseCamera(CAMERA_OWNER), []);

  const pointsRef = useRef<THREE.Points>(null);

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt); // 창을 잠깐 떠났다 오면 dt 가 크다
    const elapsed = () => (performance.now() - phaseStart.current) / 1000;
    const emit = (count: number, origin: Vector3Tuple) => {
      let emitted = 0;
      for (let i = 0; i < dustCount && emitted < count; i++) {
        if (pool.remaining[i] > 0) continue;
        const k = i * 3;
        // 자판기 밑을 따라 길게 — 한 점에서 터지면 폭발처럼 보인다
        pool.position[k] = origin[0] + (Math.random() - 0.5) * 0.5;
        pool.position[k + 1] = origin[1] + Math.random() * 0.25;
        pool.position[k + 2] = origin[2] + (Math.random() - 0.5) * dustSpread;
        pool.velocity[k] = (Math.random() - 0.2) * 0.9; // 복도 쪽으로 더 많이
        pool.velocity[k + 1] = 0.35 + Math.random() * 0.8;
        pool.velocity[k + 2] = (Math.random() - 0.5) * 1.1;
        pool.lifetime[i] = 0.9 + Math.random() * 1.1;
        pool.remaining[i] = pool.lifetime[i];
        emitted++;
      }
    };

    // 미리보기는 컷신 없이 밀린다 — 고칠 때마다 컷신이 돌면 성가시다.
    const open = enabled ? (preview || isValveFaked() || getValveOpening() ? 1 : 0) : 0;

    // 먼지는 연출이 끝난 뒤에도 남은 것이 계속 뜬다
    for (let i = 0; i < dustCount; i++) {
      if (pool.remaining[i] <= 0) continue;
      const k = i * 3;
      pool.remaining[i] -= d;
      if (pool.remaining[i] <= 0) continue;
      // 확 퍼졌다가 이내 느려지며, 가라앉지 않고 살짝 뜬다
      pool.velocity[k] *= 1 - d * 1.6;
      pool.velocity[k + 2] *= 1 - d * 1.6;
      pool.velocity[k + 1] += d * 0.12;
      pool.position[k] += pool.velocity[k] * d;
      pool.position[k + 1] += pool.velocity[k + 1] * d;
      pool.position[k + 2] += pool.velocity[k + 2] * d;
    }
    const positions = geometry.attributes.position;
    let drawn = 0;
    for (let i = 0; i < dustCount; i++) {
      if (pool.remaining[i] <= 0) continue;
      const k = i * 3;
      positions.setXYZ(drawn, pool.position[k], pool.position[k + 1], pool.position[k + 2]);
      drawn++;
    }
    geometry.setDrawRange(0, drawn);
    positions.needsUpdate = true;
    if (pointsRef.current) pointsRef.current.visible = drawn > 0;

    // 밸브가 돌아간 그 순간(올라가는 모서리) 한 번만
    if (!preview && open && !hasSeenCutscene() && phase.current === "idle" && startCutscene()) {
      // 카메라를 넘겨받지 않으면 3인칭 붐이 매 프레임 되돌려 컷신이 목표에 못 닿고 진동한다.
      claimCamera(CAMERA_OWNER);
      saved.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
      phase.current = "goIn";
      phaseStart.current = performance.now();
      lastStage.current = -1;
    }
    // 열렸으면 '봤다' 로 못 박는다 — 씬이 다시 떠도 두 번 돌지 않는다. 미리보기로 연 것도 건너뛴 셈이다.
    markCutsceneSeen(!!open);

    const target = targetRef?.current;
    if (phase.current === "idle") {
      // 컷신이 아닐 때(미리보기·되돌리기)도 자판기는 제자리로 간다
      advancePush(open, d, duration, distance);
      const z = getPushOffset();
      if (target && Math.abs(target.position.z - z) > 1e-5) target.position.z = z;
      return;
    }

    if (phase.current === "goIn") {
      const t = Math.min(1, elapsed() / Math.max(0.05, transitionTime));
      const s = smoothstep(t);
      const p = viewPoint?.();
      const q = lookAt?.();
      if (p && q && saved.current) {
        camera.position.lerpVectors(saved.current.position, targetPoint.set(p[0], p[1], p[2]), s);
        lookMatrix.lookAt(camera.position, lookPoint.set(q[0], q[1], q[2]), camera.up);
        lookRotation.setFromRotationMatrix(lookMatrix);
        camera.quaternion.slerpQuaternions(saved.current.quaternion, lookRotation, s);
      }
      if (t >= 1) {
        phase.current = "push";
        phaseStart.current = performance.now();
        playSound("vendingOff", { volume: 0.9 }); // 밀려나기 시작 — 전원 끄는 소리
      }
      return;
    }

    if (phase.current === "push") {
      // 벽시계로 진행도를 정한다 — 「시간」 초에 정확히 끝난다
      const progress = setPush(elapsed() / Math.max(0.1, duration), distance);
      if (target) target.position.z = getPushOffset();
      // 미는 내내 조금씩 일고, 꾹 밀리는 순간 확 터진다
      const origin = dustOrigin?.();
      const stage = getPushStage(progress);
      if (origin) {
        const trickle = Math.max(0, Math.round(dustStrength * (1 - progress * 0.6) * 2));
        if (trickle > 0) emit(trickle, origin);
        if (stage !== lastStage.current) {
          lastStage.current = stage;
          emit(Math.round(dustStrength * 14), origin);
          lastShoveAt.current = performance.now();
          // 그림자 한 번이 화면 한 장보다 비싸다. 미는 내내 켜면 렉처럼 보여 힘이 실리는 순간에만 따라오게 한다.
          requestShadowUpdates(0.1);
        }
      }
      // 무거운 것이 바닥을 긁는 떨림 — 꾹 밀린 직후 0.18초만. 내내 떨면 카메라가 고장 난 것 같다.
      const p = viewPoint?.();
      const q = lookAt?.();
      if (p && q) {
        const sinceShove = (performance.now() - lastShoveAt.current) / 1000;
        const kick = Math.max(0, 1 - sinceShove / 0.18);
        const offset = shake * kick * Math.sin(sinceShove * 90);
        camera.position.set(p[0] + offset * 0.6, p[1] + offset, p[2] + offset * 0.3);
        lookMatrix.lookAt(camera.position, lookPoint.set(q[0], q[1], q[2]), camera.up);
        camera.quaternion.setFromRotationMatrix(lookMatrix);
      }
      if (progress >= 1) {
        phase.current = "return";
        phaseStart.current = performance.now();
        requestShadowUpdates(0.3); // 다 밀린 자리에서 그림자를 한 번 맞춘다
      }
      return;
    }

    // return
    const t = Math.min(1, elapsed() / Math.max(0.05, transitionTime));
    const s = smoothstep(t);
    if (saved.current) {
      const p = viewPoint?.();
      if (p) camera.position.lerpVectors(targetPoint.set(p[0], p[1], p[2]), saved.current.position, s);
      camera.quaternion.slerpQuaternions(currentRotation.copy(camera.quaternion), saved.current.quaternion, s);
    }
    if (t >= 1) {
      if (saved.current) {
        camera.position.copy(saved.current.position);
        camera.quaternion.copy(saved.current.quaternion);
      }
      saved.current = null;
      phase.current = "idle";
      releaseCamera(CAMERA_OWNER);
      endCutscene(); // 다 돌아온 뒤에야 조작을 돌려준다
    }
  });

  // 방·복도 그룹 밖에 둔다 — 구역 최적화에 잘리면 컷신 카메라가 복도를 벗어나는 순간 먼지만 사라진다.
  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
