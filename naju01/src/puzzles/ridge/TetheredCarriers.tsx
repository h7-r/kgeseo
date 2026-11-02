/**
 * 묶인 지게 둘 — 능선의 지게 두 개는 한쪽 다리가 밧줄로 오른쪽 돌새 기둥에 묶여 있다.
 * 장막이 쳐지고 바람이 몸을 떠받치기 시작하면 지게도 떠오르지만, 밧줄에 매여 멀리 못 가고
 * 줄이 팽팽해진 채 기둥 위 하늘에서 둥둥 맴돈다(밧줄 2.2 m — 1스테이지 통발 줄보다 짧고, 장막 안 점프보다 낮다).
 *   기둥 매듭에서 E 세 번 — 밧줄을 당겨 지게 하나를 끌어 내리고 줄을 푼다 → E 「지게 지기」
 *   → 지게를 지면 무거운 궤를 등에 얹어 나를 수 있다(RidgeCart). 궤를 수레에 내려놓아도 빈 지게는 등에 남는다.
 *   빈 지게를 지고 빈손 [E] — 내려놓는 순간 줄이 없으니 바람이 채 가 머리 위를 맴돈다. 뛰어올라 [E] 로 붙잡으면 다시 멘다.
 * 한 번에 하나만 풀린다 — 나머지는 끌어 내린 지게가 날아가 버린 뒤에야 당길 수 있다.
 * 둘 다 날려 보내고 궤를 아직 못 옮겼으면, 잠시 뒤 바람이 하나를 기둥 곁에 도로 떨어뜨린다(막히지 않게).
 * 지게 모양은 화면에 이미 선 지게(공개 에셋 교체본 또는 원본)를 그대로 빌려 그린다. 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { releasePropColliders } from "../../movement/propColliders";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { M, groundY } from "../fishTrap/shared";
import { aimedId, registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { RIDGE_CENTER } from "./ridgeShape";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";

/** 지게 자리(edits.json 「씬2.지게」 고침 자리 · 씬2 표본 크기·방향) */
const CARRIERS = [
  { x: 72.02, z: 22.12 },
  { x: 73.36, z: 22.73 },
];
/** 오른쪽 돌새 기둥(edits.json 「씬2.솟대」 1 번) · 매듭 높이(땅 위 m) */
const POLE = { x: 74.38, z: 22.21, knot: 0.45 };
/** 밧줄 길이(m) — 1스테이지 통발 줄(≈3 m)보다 짧고, 떠 있는 지게가 장막 안 점프(≈3.2 m)보다 낮게 */
const ROPE = 2.2;
/** 장막이 내려와 바람이 몸을 떠받치기 시작하는 때(초, 단계 sealing 기준) — 수레바퀴와 같이 뜬다 */
const LIFT_AT = 6.5;
const RISE_SECONDS = 2.6;
const TUGS = 3;
/** 날아간 지게 — 떠오르는 시간(초) · 맴도는 높이(땅 위 m, 장막 안 점프로 닿게) · 맴도는 반지름(m) · 빠르기(rad/s) ·
 *  붙잡는 손 거리(눈에서, m) · 둘 다 날아갔을 때 하나가 도로 떨어지기까지(초) */
const FLY_SECONDS = 3.5;
const FLY_HEIGHT = 3.4;
const FLY_RADIUS = 3.5;
const FLY_SPEED = 0.22;
const GRAB_REACH = 1.6;
const RETURN_AFTER = 9;

type CarrierState = "ground" | "rising" | "floating" | "hauling" | "landed" | "carried" | "placed" | "flown";

interface Carrier {
  group: THREE.Group;
  rope: THREE.Mesh;
  state: CarrierState;
  /** 지금 밧줄 길이 · 당겨서 줄어들 목표 */
  ropeLength: number;
  ropeTarget: number;
  tugs: number;
  risenAt: number;
  /** 공중에 뜬 동안 몸을 막는 상자(위에 서지는 못한다) */
  solid: DynamicSolid;
  /** 날아간 때(초, −1 이면 다음 장면에서 적는다) · 날기 시작한 자리 */
  flownAt: number;
  flownFrom: THREE.Vector3;
  /** 땅에 있을 때 자리·방향 */
  rest: THREE.Vector3;
  restYaw: number;
  /** 밧줄 끝(지게 다리) — 매 프레임 */
  end: THREE.Vector3;
  /** 밧줄을 맨 다리 끝(지게 자기 좌표, 유닛) · 그 다리가 뻗은 쪽 — 모양을 빌려 올 때 잰다 */
  legTie: THREE.Vector3;
  legAxis: THREE.Vector3;
  interact: THREE.Vector3;
}

const ropeMaterial = new THREE.MeshStandardMaterial({ color: "#B9A472", roughness: 0.9 });
const up = new THREE.Vector3(0, 1, 0);
/** 밧줄 굵기(반지름 m) · 다리와 기둥에 감은 바퀴 수 */
const ROPE_RADIUS = 0.012;
const LEG_WRAPS = 3;
const POLE_WRAPS = 4;

/** 감긴 밧줄 — axis 둘레로 radius 만큼 떨어져 도는 고리 count 개를 gap 간격으로. 매듭 혹 하나를 곁들인다(유닛) */
function buildWraps(radius: number, count: number, gap: number) {
  const pieces: THREE.Mesh[] = [];
  for (let k = 0; k < count; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * M, ROPE_RADIUS * M, 6, 18), ropeMaterial);
    // 고리는 xy 판 — 축(+z)을 따라 쌓고 조금씩 비스듬히 감는다
    ring.position.z = (k - (count - 1) / 2) * gap * M;
    ring.rotation.set((k % 2 ? 1 : -1) * 0.12, 0.08, 0);
    ring.castShadow = true;
    pieces.push(ring);
  }
  const knot = new THREE.Mesh(new THREE.IcosahedronGeometry(ROPE_RADIUS * 2.1 * M, 1), ropeMaterial);
  knot.position.set((radius + ROPE_RADIUS) * M, 0, 0);
  knot.scale.set(1, 0.8, 1.3);
  knot.castShadow = true;
  pieces.push(knot);
  const group = new THREE.Group();
  group.add(...pieces);
  return group;
}

/** 지게 다리 하나의 끝 — 가장 낮은 꼭짓점들 중 한쪽 무리, 그 다리가 위로 뻗는 쪽, 다리 굵기(유닛, 지게 자기 좌표) */
function findLegTip(parts: THREE.Mesh[]) {
  const points: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  for (const part of parts) {
    const position = part.geometry.attributes.position;
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step) points.push(v.fromBufferAttribute(position, i).multiply(part.scale).clone());
  }
  if (!points.length) return null;
  const box = new THREE.Box3().setFromPoints(points);
  // 다리 끝 — 바닥에서 5 cm 안의 꼭짓점 중 가장 왼쪽(−x) 것과 그 곁만. 받침 작대기 끝은 가운데 앞이라 섞이지 않는다
  const average = (list: THREE.Vector3[]) => list.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  const bottom = points.filter((p) => p.y < box.min.y + 0.05 * M);
  if (!bottom.length) return null;
  const leftmost = bottom.reduce((a, b) => (b.x < a.x ? b : a));
  const low = bottom.filter((p) => Math.hypot(p.x - leftmost.x, p.z - leftmost.z) < 0.07 * M);
  const tip = average(low);
  // 다리 결 — 20 cm 위의 같은 다리 단면
  const high = points.filter((p) => Math.abs(p.y - (box.min.y + 0.2 * M)) < 0.03 * M && Math.hypot(p.x - tip.x, p.z - tip.z) < 0.25 * M);
  const axis = high.length ? average(high).sub(tip).normalize() : up.clone();
  const thickness = low.reduce((r, p) => Math.max(r, Math.hypot(p.x - tip.x, p.z - tip.z)), 0) / M;
  return { tip, axis, radius: THREE.MathUtils.clamp(thickness, 0.018, 0.045) };
}

/** 늘어진 밧줄 — 가운데가 sag(m)만큼 처지되 땅을 파고들지 않고 땅 위에 눕는다(유닛) */
function ropeCurve(from: THREE.Vector3, to: THREE.Vector3, sag: number) {
  const points: THREE.Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = from.clone().lerp(to, t);
    p.y -= sag * 4 * t * (1 - t) * M;
    p.y = Math.max(p.y, (groundY(p.x / M, p.z / M) + ROPE_RADIUS) * M);
    points.push(p);
  }
  return new THREE.CatmullRomCurve3(points);
}

export default function TetheredCarriers() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const stage = useRidgeStage();
  const stageRef = useRef(stage);
  const knot = useMemo(() => new THREE.Vector3(POLE.x * M, (groundY(POLE.x, POLE.z) + POLE.knot) * M, POLE.z * M), []);
  const carriers = useMemo<Carrier[]>(
    () =>
      CARRIERS.map((c) => {
        const rope = new THREE.Mesh(new THREE.BufferGeometry(), ropeMaterial);
        rope.castShadow = true;
        return {
          group: new THREE.Group(),
          rope,
          state: "ground" as CarrierState,
          ropeLength: ROPE,
          ropeTarget: ROPE,
          tugs: 0,
          risenAt: 0,
          flownAt: 0,
          flownFrom: new THREE.Vector3(),
          solid: { x: 0, z: 0, yaw: 0, halfX: 0.35, halfZ: 0.35, bottom: 0, top: 0, enabled: false, walkable: false },
          rest: new THREE.Vector3(c.x * M, groundY(c.x, c.z) * M, c.z * M),
          restYaw: 0,
          end: new THREE.Vector3(),
          legTie: new THREE.Vector3(),
          legAxis: new THREE.Vector3(0, 1, 0),
          interact: new THREE.Vector3(),
        };
      }),
    [],
  );
  const borrowed = useRef<THREE.Mesh[]>([]);
  const lastSearch = useRef(-99);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    for (const c of carriers) scene.add(c.group, c.rope);
    const removeSolids = carriers.map((c) => addDynamicSolid(c.solid));
    return () => {
      for (const c of carriers) scene.remove(c.group, c.rope);
      removeSolids.forEach((remove) => remove());
    };
  }, [scene, carriers]);

  /**
   * 화면의 지게를 찾아 지게마다 그 모양을 빌려 온다. 교체본(공개 에셋)은 수십 초 뒤에 서므로 1 초마다 다시 보고,
   * 교체본이 나타나면 원본 모양 대신 그것으로 갈아 끼운다. 찾은 것은 전부 숨길 대상이다.
   */
  const lookSource = useRef<"aihub" | "original" | null>(null);
  const borrowLooks = (time: number) => {
    if (lookSource.current === "aihub" || time - lastSearch.current < 1) return;
    lastSearch.current = time;
    const replacements: THREE.InstancedMesh[] = [];
    const originals: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      if (!(o as THREE.InstancedMesh).isInstancedMesh) return;
      // 원근 나눔(·원경) 메시까지 — 하나라도 남기면 묶인 지게 곁에 빈 지게가 하나 더 서 있다
      if (o.name.startsWith("AI허브:씬2.지게")) replacements.push(o as THREE.InstancedMesh);
      else if (o.name.startsWith("씬2.지게")) originals.push(o as THREE.InstancedMesh);
    });
    borrowed.current = [...replacements, ...originals];
    // 모양은 가까운 쪽(·원경 아닌 것)에서만 빌린다
    const near = (list: THREE.InstancedMesh[]) => list.filter((m) => !m.name.endsWith("·원경"));
    const source = replacements.length ? near(replacements) : lookSource.current ? [] : near(originals);
    if (!source.length) return;
    lookSource.current = replacements.length ? "aihub" : "original";
    for (const c of carriers) c.group.clear();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const mesh of source) {
      mesh.updateMatrixWorld(true);
      // 구역 초점이 먼 자리를 빼 두었으면 원래 목록(fullSet)에서 읽는다
      const full = mesh.userData.fullSet as { matrices: Float32Array; n: number } | undefined;
      const count = full ? full.n : mesh.count;
      for (let i = 0; i < count; i++) {
        if (full) matrix.fromArray(full.matrices, i * 16);
        else mesh.getMatrixAt(i, matrix);
        matrix.premultiply(mesh.matrixWorld).decompose(position, quaternion, scale);
        const k = position.distanceTo(carriers[0].rest) < position.distanceTo(carriers[1].rest) ? 0 : 1;
        const c = carriers[k];
        const part = new THREE.Mesh(mesh.geometry, mesh.material);
        part.scale.copy(scale);
        part.castShadow = true;
        c.group.add(part);
        if (c.state === "ground") {
          c.rest.copy(position);
          c.restYaw = new THREE.Euler().setFromQuaternion(quaternion, "YXZ").y;
          // 원래 지게 자리의 걷기 막이 — 지게가 떠나면 빈 자리에 걸리지 않게
          releasePropColliders("지게", position.x / M, position.z / M, 0.6);
        }
      }
    }
    // 밧줄을 맨 다리 끝 — 그 다리에 밧줄을 몇 바퀴 감아 매듭짓는다(지게와 같이 움직인다)
    for (const c of carriers) {
      const leg = findLegTip(c.group.children as THREE.Mesh[]);
      if (!leg) continue;
      c.legAxis.copy(leg.axis);
      c.legTie.copy(leg.tip).addScaledVector(leg.axis, 0.07 * M);
      const wraps = buildWraps(leg.radius + ROPE_RADIUS * 0.6, LEG_WRAPS, ROPE_RADIUS * 2.1);
      wraps.position.copy(c.legTie);
      wraps.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), leg.axis);
      wraps.userData.ropeWraps = true;
      c.group.add(wraps);
    }
    prewarmShaders(gl, scene, camera, carriers.flatMap((c) => [c.group, c.rope]));
  };

  /**
   * 기둥 — 매듭 높이에서 좌우로 쏴 본 돌기둥의 실제 가운데 · 굵기. 그 둘레에 밧줄을 감는다.
   * 돌새(RidgeBirds)가 기둥을 세운 뒤에야 잡히므로 1 초마다 다시 본다
   */
  const pole = useRef<{ wraps: THREE.Group; radius: number } | null>(null);
  const lastPoleTry = useRef(-99);
  const wrapPole = (time: number) => {
    if (pole.current || time - lastPoleTry.current < 1) return;
    lastPoleTry.current = time;
    const ray = new THREE.Raycaster();
    ray.camera = camera; // 장면의 그림 조각(Sprite)도 맞혀 보려면 있어야 한다
    const ours = new Set<THREE.Object3D>(carriers.flatMap((c) => [c.rope, c.group]));
    // 기둥 곁에 선 것만(돌새 기둥 무리) — 장면 전체에 쏘면 프레임이 끊긴다
    const targets = scene.children.filter((o) => !ours.has(o) && o.position.distanceTo(knot) < 2 * M);
    const sides: number[] = [];
    for (const sign of [1, -1]) {
      const origin = knot.clone().add(new THREE.Vector3(sign * 0.6 * M, 0, 0));
      ray.set(origin, new THREE.Vector3(-sign, 0, 0));
      ray.far = 0.6 * M;
      const hit = ray.intersectObjects(targets, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
      if (!hit) return;
      sides.push(hit.point.x);
    }
    const radius = Math.abs(sides[0] - sides[1]) / 2 / M;
    if (radius < 0.02 || radius > 0.3) return;
    knot.x = (sides[0] + sides[1]) / 2;
    const wraps = buildWraps(radius + ROPE_RADIUS * 0.6, POLE_WRAPS, ROPE_RADIUS * 2.1);
    wraps.position.copy(knot);
    // 고리 축(+z)을 기둥 결(위)로
    wraps.rotation.x = -Math.PI / 2;
    scene.add(wraps);
    pole.current = { wraps, radius };
  };
  useEffect(
    () => () => {
      if (pole.current) scene.remove(pole.current.wraps);
      pole.current = null;
    },
    [scene],
  );

  // E — 매듭에서 밧줄 당기기 · 내려온 지게 지기
  useEffect(() => {
    const removeKnot = registerInteractable({
      id: "ridge-knot",
      position: knot,
      label: "밧줄 당겨 지게 끌어 내리기",
      radius: 0.5 * M,
      reach: 2.2 * M,
      // 한 번에 하나 — 끌어 내린 지게가 있으면(땅에 있거나 지고 있으면) 다른 줄은 안 당겨진다
      enabled: () =>
        carriers.some((c) => c.state === "floating" || c.state === "hauling") &&
        !carriers.some((c) => c.state === "landed" || c.state === "carried" || c.state === "placed") &&
        ridgeCarry.load === "none",
      use: () => {
        const c = carriers.find((entry) => entry.state === "hauling") ?? carriers.find((entry) => entry.state === "floating");
        if (!c) return;
        c.state = "hauling";
        c.tugs++;
        c.ropeTarget = ROPE * (1 - c.tugs / TUGS);
        audio.play("똑");
        director.cue({ 카메라: "흔들림", 세기: 0.12 });
        if (c.tugs === 1) showNotice("밧줄을 당긴다 — 바람이 지게를 붙들고 버틴다. 몇 번 더!", 3);
        if (c.tugs >= TUGS) {
          c.state = "landed";
          audio.play("우르릉");
          showNotice("지게를 끌어 내려 줄을 풀었다. 바람에 들썩이는 걸 꽉 붙들었다 — 지게를 지면 무거운 것도 나를 수 있다.", 5);
        }
      },
    });
    const removers = carriers.map((c, k) =>
      registerInteractable({
        id: `ridge-jige-${k}`,
        position: c.interact,
        label: "지게 지기",
        radius: 0.6 * M,
        reach: 2.2 * M,
        enabled: () => (c.state === "landed" || c.state === "placed") && ridgeCarry.load === "none",
        use: () => {
          c.state = "carried";
          ridgeCarry.load = "jige";
          audio.play("똑");
          showNotice("지게를 졌다. 등에 얹으면 혼자서 못 드는 것도 나를 수 있다. (등짐을 지면 걸음이 무겁고 덜 뛴다 · 빈손 [E] 로 내려놓기)", 5);
        },
      }),
    );
    // 날아간 지게 — 뛰어올라 손이 닿으면 붙잡아 다시 멘다
    const grabbers = carriers.map((c, k) =>
      registerInteractable({
        id: `ridge-jige-grab-${k}`,
        position: c.interact,
        label: "날아다니는 지게 붙잡기",
        highlight: () => c.group,
        radius: 0.8 * M,
        reach: 6 * M,
        enabled: () => c.state === "flown" && ridgeCarry.load === "none",
        use: () => {
          if (camera.position.distanceTo(c.interact) / M > GRAB_REACH) {
            showNotice("손이 닿지 않는다. 지게 밑에서 힘껏 뛰어올라 붙잡자.", 3);
            return;
          }
          c.state = "carried";
          ridgeCarry.load = "jige";
          audio.play("단서");
          showNotice("허공에서 지게를 붙잡아 다시 멨다.", 3);
        },
      }),
    );
    // 빈 지게 내려놓기 — 겨눈 것이 없을 때의 [E]. 줄이 없으니 바람이 채 간다
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || event.repeat || !document.pointerLockElement) return;
      if (ridgeCarry.load !== "jige" || aimedId()) return;
      const c = carriers.find((entry) => entry.state === "carried");
      if (!c) return;
      c.state = "flown";
      c.flownAt = -1;
      c.flownFrom.copy(c.group.position);
      ridgeCarry.load = "none";
      audio.play("우르릉");
      showNotice("지게를 내려놓자마자 바람이 채 간다 — 묶을 줄이 없으니 머리 위를 맴돈다. (뛰어올라 [E] 로 다시 붙잡을 수 있다)", 5);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      removeKnot();
      removers.forEach((remove) => remove());
      grabbers.forEach((remove) => remove());
      window.removeEventListener("keydown", onKey);
    };
  }, [carriers, knot, camera]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    borrowLooks(time);
    if (!lookSource.current) return;
    // 기둥은 가까이 왔을 때만 재 본다 — 장면 전체에 쏘는 광선이라
    if (camera.position.distanceTo(knot) < 30 * M) wrapPole(time);
    const now = stageRef.current;
    const lifting = now === "sealing" ? ridge.elapsed() > LIFT_AT : ridge.isAtLeast("sealed");

    // 지게를 수레 곁에 내려놓았다(궤를 수레에 옮긴 뒤)
    if (ridgeCarry.putDown) {
      const c = carriers.find((entry) => entry.state === "carried");
      if (c) {
        c.state = "placed";
        c.rest.set(ridgeCarry.putDown.x * M, groundY(ridgeCarry.putDown.x, ridgeCarry.putDown.z) * M, ridgeCarry.putDown.z * M);
      }
      ridgeCarry.putDown = null;
    }

    // 원래 화면의 지게는 숨기고 우리가 대신 그린다 — 다리에 감은 밧줄 매듭이 땅에 있을 때부터 보이게
    for (const mesh of borrowed.current) mesh.visible = false;

    carriers.forEach((c, k) => {
      if (c.state === "ground" && lifting) {
        c.state = "rising";
        c.risenAt = time;
        if (k === 0) showNotice("기둥에 묶인 지게 둘이 바람에 들려 떠오른다 — 밧줄이 팽팽하게 당겨진다.", 4);
      }
      // 밧줄 방향 — 위로, 바람 따라 기울며 맴돈다
      const phi = 0.9 + k * 1.6 + Math.sin(time * 0.37 + k * 2) * 0.55;
      const theta = THREE.MathUtils.degToRad(58 + Math.sin(time * 0.6 + k) * 9);
      const dir = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
      c.ropeLength += (c.ropeTarget - c.ropeLength) * Math.min(1, dt * 5);
      const floatAt = knot.clone().addScaledVector(dir, c.ropeLength * M);
      const tumble = (g: THREE.Group) =>
        g.rotation.set(Math.sin(time * 0.5 + k) * 0.6, c.restYaw + time * 0.25 + k, Math.cos(time * 0.43 + k) * 0.5);

      if (c.state === "rising") {
        const e = THREE.MathUtils.smootherstep(time - c.risenAt, 0, RISE_SECONDS);
        c.group.position.lerpVectors(c.rest, floatAt, e);
        tumble(c.group);
        c.group.rotation.x *= e;
        c.group.rotation.z *= e;
        if (e >= 1) c.state = "floating";
      } else if (c.state === "floating" || c.state === "hauling") {
        c.group.position.copy(floatAt);
        tumble(c.group);
        // 줄을 다 당기면 매듭 곁에 내려선다
        if (c.state === "hauling" && c.ropeLength < 0.35) c.group.position.y = Math.max(c.group.position.y, knot.y - POLE.knot * M);
      } else if (c.state === "landed" || c.state === "placed") {
        if (c.state === "landed") {
          const side = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi)).multiplyScalar(0.9 * M);
          c.rest.set(knot.x + side.x, groundY(knot.x / M + side.x / M, knot.z / M + side.z / M) * M, knot.z + side.z);
        }
        c.group.position.lerp(c.rest, Math.min(1, dt * 6));
        c.group.rotation.set(0, c.restYaw, 0);
      } else if (c.state === "flown") {
        // 바람에 실려 빙글빙글 떠올라 능선 하늘을 맴돈다
        if (c.flownAt < 0) c.flownAt = time;
        const age = time - c.flownAt;
        const angle = FLY_SPEED * age + k * 3;
        const ox = RIDGE_CENTER.x + Math.cos(angle) * FLY_RADIUS;
        const oz = RIDGE_CENTER.z + Math.sin(angle) * FLY_RADIUS;
        const orbit = new THREE.Vector3(ox * M, (groundY(ox, oz) + FLY_HEIGHT + Math.sin(age * 0.8 + k) * 0.3) * M, oz * M);
        const e = THREE.MathUtils.smootherstep(age, 0, FLY_SECONDS);
        c.group.position.lerpVectors(c.flownFrom, orbit, e);
        c.group.position.y += Math.sin(e * Math.PI) * 1.5 * M;
        c.group.rotation.set(Math.sin(time * 0.7 + k) * 0.8, time * 0.5 + k, Math.cos(time * 0.6 + k) * 0.6);
        // 둘 다 날아가고 궤를 아직 못 옮겼으면 — 바람이 잠깐 잦아든 틈에 기둥 곁으로 도로 떨어뜨린다
        const lastFlown = carriers.every((other) => other.state === "flown") && carriers.every((other) => other.flownAt <= c.flownAt);
        if (lastFlown && age > RETURN_AFTER && !ridgeQuest.chestOnAltar && ridgeCarry.load === "none") {
          c.state = "landed";
          c.flownAt = 0;
          showNotice("바람이 잠깐 숨을 고른 사이, 날아갔던 지게 하나가 기둥 곁에 툭 떨어졌다.", 4);
        }
      } else if (c.state === "carried") {
        // 등에 진다 — 눈 뒤 아래. 1인칭에서는 그림자로만 보인다
        const back = new THREE.Vector3();
        camera.getWorldDirection(back);
        back.y = 0;
        back.normalize().multiplyScalar(-0.35 * M);
        c.group.position.copy(camera.position).add(back).addScaledVector(up, -1.25 * M);
        c.group.rotation.set(0, Math.atan2(back.x, back.z) + Math.PI, 0);
      } else {
        c.group.position.copy(c.rest);
        c.group.rotation.set(0, c.restYaw, 0);
      }

      // 공중에 뜬 지게는 몸을 뚫고 지나가지 않는다 — 겹치면 옆으로 비켜 서고, 상자로 막는다
      const airborne = c.state === "rising" || c.state === "floating" || c.state === "hauling" || c.state === "flown";
      if (airborne) {
        const gx = c.group.position.x / M;
        const gy = c.group.position.y / M;
        const gz = c.group.position.z / M;
        const eye = camera.position.y / M;
        const dx = gx - camera.position.x / M;
        const dz = gz - camera.position.z / M;
        const d = Math.hypot(dx, dz);
        const need = 0.9;
        if (gy < eye + 0.15 && gy + 1.3 > eye - 1.25 && d < need) {
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          c.group.position.x = (camera.position.x / M + nx * need) * M;
          c.group.position.z = (camera.position.z / M + nz * need) * M;
        }
      }
      Object.assign(c.solid, {
        x: c.group.position.x / M,
        z: c.group.position.z / M,
        bottom: c.group.position.y / M,
        top: c.group.position.y / M + 1.3,
        enabled: airborne,
      });

      // 밧줄 — 땅에 늘어진 줄 · 팽팽한 줄 · 풀린 뒤에는 없다. 다리에 감은 매듭에서 기둥에 감은 바퀴까지 잇는다
      c.group.updateMatrixWorld(true);
      c.end.copy(c.legTie).applyMatrix4(c.group.matrixWorld);
      const tied = c.state === "ground" || c.state === "rising" || c.state === "floating" || c.state === "hauling";
      c.rope.visible = tied && c.group.children.length > 0;
      for (const child of c.group.children) if (child.userData.ropeWraps) child.visible = tied;
      if (c.rope.visible) {
        const slack = c.state === "ground" ? 0.45 : c.state === "rising" ? 0.45 * (1 - THREE.MathUtils.clamp((time - c.risenAt) / RISE_SECONDS, 0, 1)) + 0.08 : 0.08;
        // 기둥 쪽 끝 — 기둥 가운데가 아니라 감긴 바퀴 겉, 지게 쪽 면에서 나온다
        const start = knot.clone();
        if (pole.current) {
          const toward = new THREE.Vector3(c.end.x - knot.x, 0, c.end.z - knot.z).normalize();
          start.addScaledVector(toward, (pole.current.radius + ROPE_RADIUS) * M);
        }
        const curve = ropeCurve(start, c.end, slack);
        c.rope.geometry.dispose();
        c.rope.geometry = new THREE.TubeGeometry(curve, 28, ROPE_RADIUS * M, 5, false);
      }
      c.interact.copy(c.group.position).addScaledVector(up, 0.6 * M);
    });
    // 기둥에 감은 밧줄 — 매인 지게가 하나라도 남아 있는 동안
    if (pole.current) pole.current.wraps.visible = carriers.some((c) => c.rope.visible);
  });

  return null;
}
