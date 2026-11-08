import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { playSound } from "@/audio/sound";
import { playerView } from "@/engine/playerView";
import { gameNow } from "@/engine/input/gameClock";
import { requestShadowUpdates } from "@/engine/shadowUpdates";
import { makeCachedCanvasTexture } from "@/engine/textures/canvas";
import { canVendingMove, getValveOpening } from "@/props/panelWiringState";
import {
  advancePush,
  hasSeenCutscene,
  isValveFaked,
  markCutsceneSeen,
  getPushOffset,
  getPushProgress,
  hasEnteredHeadquarters,
  markEnteredHeadquarters,
  getPushStage,
  setPush,
} from "@/props/vendingPushState";
import { HEADQUARTERS_MIN_X } from "@/station/layout/dimensions";
import { passage } from "@/station/layout/passage";

type Phase = "idle" | "push";

/** 컷신이 끝난 뒤 문을 여닫는 데 걸리는 시간(컷신 시간에 대한 몫) — 다가가는 걸음에 맞춘다 */
const DOOR_REPEAT_SPEED = 0.55;
/** 방 안으로 이만큼(유닛) 들어와야 「들어갔다」로 본다 */
const ENTERED_DEPTH = 1;
/** 문에서 이 거리 안이면 열고, 이보다 멀어지면 닫는다 — 경계에서 떨지 않게 둘을 벌린다 */
const DOOR_OPEN_RANGE = 5;
const DOOR_CLOSE_RANGE = 6;

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
    /** 살아 있는 알갱이 수 — 0 이면 프레임 계산을 건너뛴다 */
    alive: 0,
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
  /** 자판기를 담은 그룹(position.z 를 만진다) */
  targetRef?: RefObject<THREE.Object3D | null>;
  /** 먼지가 이는 자리(자판기 밑) */
  dustOrigin?: () => Vector3Tuple;
  dustCount?: number;
  dustColor?: string;
  dustSize?: number;
  dustStrength?: number;
  /** 자판기 밑 어디까지 넓게 일어날지 */
  dustSpread?: number;
}

/**
 * 전류가 자판기에 닿아 불빛이 한참 날뛰면 자판기가 밀려나 뒤의 문을 드러낸다(먼지 · 떨림).
 * 그동안 화면은 FlowFocusCamera 가 전류를 따라와 자판기를 보고 있다. 조작을 멈추는 것도 그쪽이 한다.
 */
export default function VendingPushCutscene({
  enabled = true,
  preview = false,
  distance = 3.4,
  duration = 2.2,
  targetRef,
  dustOrigin,
  dustCount = 90,
  dustColor = "#cfc7b6",
  dustSize = 0.22,
  dustStrength = 1,
  dustSpread = 2.2,
}: VendingPushCutsceneProps) {
  const phase = useRef<Phase>("idle");
  // 벽시계 시각. dt 를 쌓으면 카메라가 옮겨 갈 때 구역이 새로 올라오며 끊긴 만큼 연출이 늘어난다.
  const phaseStart = useRef(0);
  const shouldDoorStayOpen = () => {
    if (!playerView.ready) return true;
    const { x, z } = playerView.eye;
    if (!hasEnteredHeadquarters() && x > HEADQUARTERS_MIN_X + ENTERED_DEPTH) markEnteredHeadquarters();
    // 처음 들어가기 전에는 열어 둔다 — 문을 연 사람이 돌아올 때까지 닫으면 안 된다
    if (!hasEnteredHeadquarters()) return true;
    // 복도는 폭이 좁아 가운데로 걸어도 문까지 멀다 — 복도 쪽에서는 따라 걸은 거리만 본다
    const alongCorridor = Math.abs(z - passage.get().doorZ);
    const distanceToDoor = x < HEADQUARTERS_MIN_X ? alongCorridor : Math.hypot(x - HEADQUARTERS_MIN_X, alongCorridor);
    return distanceToDoor < (getPushProgress() > 0.5 ? DOOR_CLOSE_RANGE : DOOR_OPEN_RANGE);
  };
  // 마지막으로 힘이 실린 단계 — 단계가 바뀔 때 먼지를 터뜨린다
  const lastStage = useRef(-1);

  const pool = useMemo(() => createDustPool(dustCount), [dustCount]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
    g.setDrawRange(0, 0);
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
  const pointsRef = useRef<THREE.Points>(null);

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt); // 창을 잠깐 떠났다 오면 dt 가 크다
    const elapsed = () => (gameNow() - phaseStart.current) / 1000;
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
        pool.alive++;
        emitted++;
      }
    };

    // 미리보기는 컷신 없이 밀린다 — 고칠 때마다 컷신이 돌면 성가시다.
    const isReady = getValveOpening() && canVendingMove();
    const isWanted = preview || isValveFaked() || (isReady && shouldDoorStayOpen());
    const open = enabled && isWanted ? 1 : 0;

    // 먼지는 연출이 끝난 뒤에도 남은 것이 계속 뜬다
    if (pool.alive > 0) {
      const positions = geometry.attributes.position;
      let drawn = 0;
      for (let i = 0; i < dustCount; i++) {
        if (pool.remaining[i] <= 0) continue;
        const k = i * 3;
        pool.remaining[i] -= d;
        if (pool.remaining[i] <= 0) {
          pool.alive--;
          continue;
        }
        // 확 퍼졌다가 이내 느려지며, 가라앉지 않고 살짝 뜬다
        pool.velocity[k] *= 1 - d * 1.6;
        pool.velocity[k + 2] *= 1 - d * 1.6;
        pool.velocity[k + 1] += d * 0.12;
        pool.position[k] += pool.velocity[k] * d;
        pool.position[k + 1] += pool.velocity[k + 1] * d;
        pool.position[k + 2] += pool.velocity[k + 2] * d;
        positions.setXYZ(drawn, pool.position[k], pool.position[k + 1], pool.position[k + 2]);
        drawn++;
      }
      geometry.setDrawRange(0, drawn);
      positions.needsUpdate = true;
      if (pointsRef.current) pointsRef.current.visible = drawn > 0;
    }

    // 처음 열릴 때 한 번만 민다. 전류가 닿고 불빛이 다 날뛴 뒤다(isReady).
    if (!preview && open && !hasSeenCutscene() && phase.current === "idle") {
      phase.current = "push";
      phaseStart.current = gameNow();
      lastStage.current = -1;
      playSound("vendingOff", { volume: 0.9 }); // 밀려나기 시작 — 전원 끄는 소리
    }
    // 열렸으면 '봤다' 로 못 박는다 — 닫혔다 다시 열려도, 씬이 다시 떠도 컷신은 또 돌지 않는다. 미리보기로 연 것도 건너뛴 셈이다.
    if (open) markCutsceneSeen();

    const target = targetRef?.current;
    if (phase.current === "idle") {
      // 컷신이 아닐 때(미리보기 · 들어간 뒤 닫힘 · 다가가면 열림)도 자판기는 제자리로 간다
      const before = getPushProgress();
      advancePush(open, d, duration * DOOR_REPEAT_SPEED, distance);
      if (before === (open ? 0 : 1) && getPushProgress() !== before) playSound("vendingOff", { volume: 0.45 });
      const z = getPushOffset();
      if (target && Math.abs(target.position.z - z) > 1e-5) target.position.z = z;
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
          // 그림자 한 번이 화면 한 장보다 비싸다. 미는 내내 켜면 렉처럼 보여 힘이 실리는 순간에만 따라오게 한다.
          requestShadowUpdates(0.1);
        }
      }
      if (progress >= 1) {
        phase.current = "idle";
        requestShadowUpdates(0.3); // 다 밀린 자리에서 그림자를 한 번 맞춘다
      }
    }
  });

  // 방·복도 그룹 밖에 둔다 — 구역 최적화에 잘리면 컷신 카메라가 복도를 벗어나는 순간 먼지만 사라진다.
  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} visible={false} />;
}
