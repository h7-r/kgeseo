/**
 * 연기 화살표 — 흩어진 연기 글씨가 화살표로 뭉쳐 씬2 「바위 아래」까지 길을 이끈다.
 * 모인다 → 「따라가 보자」 → 플레이어가 가까이 오면 앞서 가고, 멀어지면 그 자리에서 기다린다 → 바위 아래에서 흩어진다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { showNotice } from "../interaction";
import { M, groundY } from "../units";
import { fishTrapPuzzle } from "./fishTrapState";
import { GUIDE_HEIGHT, GUIDE_PATH } from "./site";

/** 윤곽선 점 — 촘촘하고 작아야 모양이 또렷하다 */
const OUTLINE_POINTS = 170;
/** 안쪽을 옅게 채우는 점 */
const FILL_POINTS = 70;
/** 꼬리에서 풀려 나가는 연기 */
const TRAIL_POINTS = 40;
const ARROW_POINTS = OUTLINE_POINTS + FILL_POINTS + TRAIL_POINTS;
/** 화살표 크기(미터) — 꼬리 끝에서 촉 끝까지 */
const ARROW_LENGTH = 1.7;
/** 앞으로 기울여 세운 각 — 뒤따라가며 볼 때 「앞으로」가 위쪽으로 읽힌다 */
const ARROW_TILT = THREE.MathUtils.degToRad(40);
const GATHER_SECONDS = 1.4;
/** 플레이어가 이만큼 안에 오면 앞서 간다 · 이보다 멀면 기다린다(미터) */
const LEAD_NEAR = 6;
const WAIT_FAR = 8.5;
/** 앞서 가는 빠르기(m/s) — 플레이어가 달리면 그보다 조금 더 빨리 가서 늘 앞에 있다 · 너무 바짝 붙으면 더 내뺀다(미터) */
const SPEED = 2.6;
const LEAD_RATIO = 1.15;
const TOO_CLOSE = 3;
const FADE_SECONDS = 1.5;
const SMOKE = new THREE.Color(0.22, 0.22, 0.25);
const SMOKE_EDGE = new THREE.Color(0.46, 0.46, 0.5);

/** 화살표 윤곽 — [앞, 옆] 길이 비율. 가는 막대 + 뒤로 젖힌 미늘이 달린 촉 */
const ARROW_OUTLINE: [number, number][] = [
  [-0.5, -0.06],
  [0.12, -0.06],
  [0.02, -0.3],
  [0.5, 0],
  [0.02, 0.3],
  [0.12, 0.06],
  [-0.5, 0.06],
];

function isInsideOutline(a: number, b: number) {
  let inside = false;
  for (let i = 0, j = ARROW_OUTLINE.length - 1; i < ARROW_OUTLINE.length; j = i++) {
    const [ai, bi] = ARROW_OUTLINE[i];
    const [aj, bj] = ARROW_OUTLINE[j];
    if (bi > b !== bj > b && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

/** 윤곽선을 따라 고르게 + 안쪽에 듬성듬성 — [앞(+), 옆] 미터 */
function sampleArrow() {
  const edges = ARROW_OUTLINE.map((from, i) => {
    const to = ARROW_OUTLINE[(i + 1) % ARROW_OUTLINE.length];
    return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1]) };
  });
  const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
  const slots: [number, number][] = [];
  for (let k = 0; k < OUTLINE_POINTS; k++) {
    let d = (k / OUTLINE_POINTS) * perimeter;
    let edge = edges[0];
    for (edge of edges) {
      if (d <= edge.length) break;
      d -= edge.length;
    }
    const t = d / edge.length;
    slots.push([
      (edge.from[0] + (edge.to[0] - edge.from[0]) * t) * ARROW_LENGTH,
      (edge.from[1] + (edge.to[1] - edge.from[1]) * t) * ARROW_LENGTH,
    ]);
  }
  while (slots.length < OUTLINE_POINTS + FILL_POINTS) {
    const a = Math.random() - 0.5;
    const b = (Math.random() - 0.5) * 0.6;
    if (isInsideOutline(a, b)) slots.push([a * ARROW_LENGTH, b * ARROW_LENGTH]);
  }
  return slots;
}

function createGuide() {
  return {
    points: makeGlowPoints(ARROW_POINTS, { additive: false, softness: 1.6 }),
    slots: sampleArrow(),
    /** 모이기 전 흩어져 있던 자리 — 글씨에서 풀려 온 연기 구름 */
    scatter: Array.from({ length: ARROW_POINTS }, () =>
      new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(1.6 * M),
    ),
    seeds: Float32Array.from({ length: ARROW_POINTS }, () => Math.random()),
  };
}

/** 길 위 거리 → 자리와 방향(미터) */
function createGuidePath() {
  const points = GUIDE_PATH.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lengths[lengths.length - 1];
  const at = (distance: number, out: THREE.Vector3, direction: THREE.Vector3) => {
    const d = THREE.MathUtils.clamp(distance, 0, total);
    let i = 1;
    while (i < points.length - 1 && lengths[i] < d) i++;
    const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
    out.lerpVectors(points[i - 1], points[i], t);
    direction.subVectors(points[i], points[i - 1]).normalize();
  };
  return { total, at };
}

type Phase = "idle" | "gather" | "lead" | "fade" | "done";

const UP = new THREE.Vector3(0, 1, 0);
const scratch = {
  spot: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  side: new THREE.Vector3(),
  lift: new THREE.Vector3(),
  toCamera: new THREE.Vector3(),
  center: new THREE.Vector3(),
};

export default function SmokeGuide() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const guide = useMemo(() => createGuide(), []);
  const path = useMemo(() => createGuidePath(), []);
  const phaseRef = useRef<Phase>("idle");
  /** 지금 단계에 들어선 뒤 흐른 시간(초) */
  const clockRef = useRef(0);
  /** 길 위에서 나아간 거리(미터) */
  const travelledRef = useRef(0);
  /** 지난 프레임의 플레이어 자리(유닛) — 빠르기를 재려고 */
  const lastPlayerRef = useRef(new THREE.Vector3(Infinity, 0, 0));
  /** 화살표가 보는 쪽(yaw) — 모퉁이에서 부드럽게 돈다 */
  const headingRef = useRef<number | null>(null);

  useEffect(() => {
    scene.add(guide.points.points);
    return () => {
      scene.remove(guide.points.points);
    };
  }, [scene, guide]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    const camera = state.camera;
    const { points, slots, scatter, seeds } = guide;
    const { spot, direction, side, lift, toCamera } = scratch;

    if (phaseRef.current === "idle") {
      if (fishTrapPuzzle.stage() !== "told") return;
      phaseRef.current = "gather";
      clockRef.current = 0;
    }
    if (phaseRef.current === "done") return;
    clockRef.current += dt;

    // 길 위 자리 — 플레이어가 따라오면 앞서 가고, 처지면 기다린다
    path.at(travelledRef.current, spot, direction);
    const playerDistance = Math.hypot(camera.position.x / M - spot.x, camera.position.z / M - spot.z);
    if (lastPlayerRef.current.x === Infinity) lastPlayerRef.current.copy(camera.position);
    const playerNow = camera.position.clone();
    let isWaiting = false;
    if (phaseRef.current === "gather" && clockRef.current >= GATHER_SECONDS) {
      phaseRef.current = "lead";
      showNotice("연기가 화살표로 모였다. 따라가 보자.", 4);
    } else if (phaseRef.current === "lead") {
      if (playerDistance < LEAD_NEAR) {
        // 플레이어 빠르기를 재서 — 달리면 그만큼 더 빨리, 바짝 붙으면 더 내뺀다
        const playerSpeed =
          Math.hypot(camera.position.x - lastPlayerRef.current.x, camera.position.z - lastPlayerRef.current.z) /
          M /
          Math.max(dt, 1e-3);
        const chase = playerDistance < TOO_CLOSE ? 1.6 : 1;
        travelledRef.current += Math.max(SPEED, playerSpeed * LEAD_RATIO) * chase * dt;
      } else isWaiting = playerDistance > WAIT_FAR;
      if (travelledRef.current >= path.total) {
        phaseRef.current = "fade";
        clockRef.current = 0;
        showNotice("연기가 바위 아래에서 흩어진다.", 4);
      }
    } else if (phaseRef.current === "fade" && clockRef.current >= FADE_SECONDS) {
      phaseRef.current = "done";
      points.alpha.array.fill(0);
      points.commit();
      return;
    }
    lastPlayerRef.current.copy(playerNow);

    const targetYaw = Math.atan2(direction.x, direction.z);
    if (headingRef.current === null) headingRef.current = targetYaw;
    let turn = targetYaw - headingRef.current;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    headingRef.current += turn * Math.min(1, dt * 3);
    direction.set(Math.sin(headingRef.current), 0, Math.cos(headingRef.current));
    // 앞으로 기울인 화살표 축 — 꼬리→촉
    lift.copy(direction).multiplyScalar(Math.cos(ARROW_TILT)).addScaledVector(UP, Math.sin(ARROW_TILT));

    const ground = groundY(spot.x, spot.z);
    // 기다릴 때는 앞으로 콕콕 찌르듯 — 「이쪽」
    const nudge = isWaiting ? Math.max(0, Math.sin(time * 4)) * 0.3 : Math.sin(time * 2) * 0.05;
    const bob = Math.sin(time * 1.6) * 0.06;
    const center = scratch.center.set(spot.x * M, (ground + GUIDE_HEIGHT + bob) * M, spot.z * M);
    center.addScaledVector(direction, nudge * M);
    // 판은 축을 둘레로 돌아 늘 카메라를 본다 — 옆에서 봐도 납작해지지 않는다
    toCamera.subVectors(camera.position, center);
    side.crossVectors(lift, toCamera);
    if (side.lengthSq() < 1e-6) side.crossVectors(UP, direction);
    side.normalize();
    const gather =
      phaseRef.current === "gather" ? THREE.MathUtils.smootherstep(clockRef.current / GATHER_SECONDS, 0, 1) : 1;
    const fade = phaseRef.current === "fade" ? clockRef.current / FADE_SECONDS : 0;

    for (let k = 0; k < ARROW_POINTS; k++) {
      const seed = seeds[k];
      // 모일 때는 흩어진 구름에서 제자리로 — 점마다 늦게 출발하는 것이 섞여 뭉글하게 모인다
      const gathered = THREE.MathUtils.clamp((gather - seed * 0.35) / 0.65, 0, 1);
      let a: number;
      let b: number;
      let rise = 0;
      let size: number;
      let alpha: number;
      let tone = SMOKE;
      if (k < OUTLINE_POINTS + FILL_POINTS) {
        [a, b] = slots[k];
        const isOutline = k < OUTLINE_POINTS;
        b += Math.sin(time * 1.3 + seed * 9) * 0.012;
        size = isOutline ? 0.085 + seed * 0.03 : 0.14 + seed * 0.06;
        alpha = isOutline ? 0.3 + 0.5 * gathered : 0.12 + 0.18 * gathered;
        if (isOutline) tone = SMOKE_EDGE;
      } else {
        // 꼬리 연기 — 꼬리 끝에서 뒤로 풀리며 흐려진다
        const life = (time * 0.6 + seed) % 1;
        a = -ARROW_LENGTH * (0.5 + life * 0.55);
        b = Math.sin(seed * 40 + time) * 0.05 * (1 + life * 2);
        rise = life * 0.15;
        size = 0.1 + life * 0.22;
        alpha = 0.32 * (1 - life) * gathered;
      }
      const x = center.x + (lift.x * a + side.x * b) * M;
      const y = center.y + (lift.y * a + side.y * b + rise) * M + fade * (0.6 + seed) * M;
      const z = center.z + (lift.z * a + side.z * b) * M;
      points.position.setXYZ(
        k,
        THREE.MathUtils.lerp(center.x + scatter[k].x, x, gathered),
        THREE.MathUtils.lerp(center.y + scatter[k].y, y, gathered),
        THREE.MathUtils.lerp(center.z + scatter[k].z, z, gathered),
      );
      // 모이기 전에는 굵은 연기 덩이 — 모일수록 가늘어져 선이 된다
      points.size.setX(k, (THREE.MathUtils.lerp(0.3, size, gathered) + fade * 0.4) * M);
      points.alpha.setX(k, (gathered < 1 ? Math.max(alpha, 0.22 * (1 - gathered)) : alpha) * (1 - fade));
      points.color.setXYZ(k, tone.r, tone.g, tone.b);
    }
    points.commit();
    points.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  });

  return null;
}
