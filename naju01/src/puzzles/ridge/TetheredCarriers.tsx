/**
 * 묶인 지게 둘 — 능선의 지게 두 개는 한쪽 다리가 밧줄로 오른쪽 돌새 기둥에 묶여 있다.
 * 장막이 쳐지고 바람이 몸을 떠받치기 시작하면 지게도 떠오르지만, 밧줄에 매여 멀리 못 가고
 * 줄이 팽팽해진 채 기둥 위 하늘에서 둥둥 맴돈다.
 *   기둥 매듭에서 E 세 번 — 밧줄을 당겨 지게 하나를 끌어 내리고 줄을 푼다 → E 「지게 지기」
 *   → 지게를 지면 무거운 궤를 등에 얹어 나를 수 있다(RidgeCart). 궤를 수레에 내려놓아도 빈 지게는 등에 남는다.
 *   빈 지게를 지고 빈손 [E] — 내려놓는 순간 줄이 없으니 바람이 채 가 머리 위를 맴돈다. 뛰어올라 [E] 로 붙잡으면 다시 멘다.
 * 한 번에 하나만 풀린다 — 나머지는 끌어 내린 지게가 날아가 버린 뒤에야 당길 수 있다.
 * 둘 다 날려 보내고 궤를 아직 못 옮겼으면, 잠시 뒤 바람이 하나를 기둥 곁에 도로 떨어뜨린다(막히지 않게).
 * 지게 모양은 화면에 이미 선 지게를 그대로 빌려 그린다. 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { recall, track } from "../../save/puzzleMemory";
import { releasePropColliders } from "../../movement/propColliders";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { aimedId, interactableFor, noticeFor } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import {
  LEG_WRAPS,
  POLE_WRAPS,
  ROPE_RADIUS,
  buildRopeCurve,
  buildRopeWraps,
  findLegTip,
  ropeMaterial,
} from "./carrierRope";
import { isPointerActive } from "@/engine/input/virtualLock";
import { RIDGE_CENTER } from "./ridgeShape";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";

/** 이 퍼즐(장면)의 글 · 물건 — 다른 퍼즐로 넘어가면 여기서 남긴 글은 내린다(interaction noticeFor · interactableFor) */
const showNotice = noticeFor("cart");
const registerInteractable = interactableFor("cart");

/** 빈 지게를 허공 E 로 내려놓으면 발 앞에 둔다(예전: 바람이 채 간다) */
const KEEPS_JIGE_ON_PUT_DOWN = true;

/** 지게 자리(씬2 지게 표본) */
const CARRIERS = [
  { x: 72.02, z: 22.12 },
  { x: 73.36, z: 22.73 },
];
/** 오른쪽 돌새 기둥(씬2 솟대 1 번) · 매듭 높이(땅 위 m) */
const POLE = { x: 74.38, z: 22.21, knot: 0.45 };
/** 밧줄 길이(m) — 떠 있는 지게가 장막 안 점프(≈3.2 m)보다 낮게 */
const ROPE = 2.2;
/** 장막이 내려와 바람이 몸을 떠받치기 시작하는 때(초, 단계 sealing 기준) — 수레바퀴와 같이 뜬다 */
const LIFT_AT = 6.5;
const RISE_SECONDS = 2.6;
const TUGS = 3;
/** 날아간 지게 — 떠오르는 시간(초) · 맴도는 높이(땅 위 m, 장막 안 점프로 닿게) · 맴도는 반지름(m) · 빠르기(rad/s) */
const FLY_SECONDS = 3.5;
const FLY_HEIGHT = 3.4;
const FLY_RADIUS = 3.5;
const FLY_SPEED = 0.22;
/** 붙잡는 손 거리(눈에서, m) — 장막 안 점프가 높아 지나치기 쉬우니 넉넉히 · 둘 다 날아갔을 때 하나가 도로 떨어지기까지(초) */
const GRAB_REACH = 2.6;
const RETURN_AFTER = 9;

const UP = new THREE.Vector3(0, 1, 0);

/** falling 은 풀린 채 · fallingTied 는 밧줄에 매인 채 떨어지는 중. 매인 채 떨어져 줄이 땅에 늘어진 것이 dropped */
type CarrierState =
  | "ground"
  | "rising"
  | "floating"
  | "hauling"
  | "landed"
  | "carried"
  | "placed"
  | "flown"
  | "falling"
  | "fallingTied"
  | "dropped";

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
  /** 떨어지는 속도(m/s, 아래가 양수) */
  fallSpeed: number;
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

interface SavedCarrier {
  state: CarrierState;
  tugs: number;
  ropeLength: number;
  ropeTarget: number;
  rest: number[];
  restYaw: number;
}

function settledCarrierState(state: CarrierState): CarrierState {
  if (state === "falling") return "placed";
  if (state === "fallingTied") return "dropped";
  return state;
}

const isAirborne = (state: CarrierState) =>
  state === "rising" ||
  state === "floating" ||
  state === "hauling" ||
  state === "flown" ||
  state === "falling" ||
  state === "fallingTied";
/** 장막이 풀려 바람이 안 받쳐 주면 — 떠 있던 지게가 떨어진다. 매인 것은 밧줄째 떨어져 줄이 땅에 늘어진다 */
const FALL_GRAVITY = 9.8;
const isFalling = (state: CarrierState) => state === "falling" || state === "fallingTied";
const isTied = (state: CarrierState) =>
  state === "ground" ||
  state === "rising" ||
  state === "floating" ||
  state === "hauling" ||
  state === "fallingTied" ||
  state === "dropped";

function createCarrier(spot: { x: number; z: number }): Carrier {
  const rope = new THREE.Mesh(new THREE.BufferGeometry(), ropeMaterial);
  rope.castShadow = true;
  return {
    group: new THREE.Group(),
    rope,
    state: "ground",
    ropeLength: ROPE,
    ropeTarget: ROPE,
    tugs: 0,
    risenAt: 0,
    flownAt: 0,
    fallSpeed: 0,
    flownFrom: new THREE.Vector3(),
    solid: { x: 0, z: 0, yaw: 0, halfX: 0.35, halfZ: 0.35, bottom: 0, top: 0, enabled: false, walkable: false },
    rest: new THREE.Vector3(spot.x * M, groundY(spot.x, spot.z) * M, spot.z * M),
    restYaw: 0,
    end: new THREE.Vector3(),
    legTie: new THREE.Vector3(),
    legAxis: new THREE.Vector3(0, 1, 0),
    interact: new THREE.Vector3(),
  };
}

export default function TetheredCarriers() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const stage = useRidgeStage();
  const stageRef = useRef(stage);
  const knot = useMemo(() => new THREE.Vector3(POLE.x * M, (groundY(POLE.x, POLE.z) + POLE.knot) * M, POLE.z * M), []);
  const carriers = useMemo<Carrier[]>(() => {
    const created = CARRIERS.map(createCarrier);
    const saved = recall<SavedCarrier[]>("ridge.carriers", []);
    created.forEach((carrier, k) => {
      const entry = saved[k];
      if (!entry) return;
      carrier.state = entry.state;
      carrier.tugs = entry.tugs;
      carrier.ropeLength = entry.ropeLength;
      carrier.ropeTarget = entry.ropeTarget;
      carrier.rest.fromArray(entry.rest);
      carrier.restYaw = entry.restYaw;
      carrier.flownAt = -1;
      carrier.flownFrom.fromArray(entry.rest);
    });
    return created;
  }, []);
  useEffect(
    () =>
      track("ridge.carriers", (): SavedCarrier[] =>
        carriers.map((carrier) => ({
          // 떨어지던 것은 내려앉은 자리로 친다.
          state: settledCarrierState(carrier.state),
          tugs: carrier.tugs,
          ropeLength: carrier.ropeLength,
          ropeTarget: carrier.ropeTarget,
          rest: carrier.rest.toArray(),
          restYaw: carrier.restYaw,
        })),
      ),
    [carriers],
  );
  /** 화면에서 빌려 온 지게 메시 — 전부 숨긴다 */
  const borrowedRef = useRef<THREE.Mesh[]>([]);
  const lastSearchRef = useRef(-99);
  /** 어느 모양을 빌렸나 — 교체본(공개 에셋)이 서면 그것으로 갈아 끼운다 */
  const lookSourceRef = useRef<"aihub" | "original" | null>(null);
  const poleRef = useRef<{ wraps: THREE.Group; radius: number } | null>(null);
  const lastPoleTryRef = useRef(-99);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    for (const carrier of carriers) scene.add(carrier.group, carrier.rope);
    const removeSolids = carriers.map((carrier) => addDynamicSolid(carrier.solid));
    return () => {
      for (const carrier of carriers) scene.remove(carrier.group, carrier.rope);
      removeSolids.forEach((remove) => remove());
      if (poleRef.current) scene.remove(poleRef.current.wraps);
      poleRef.current = null;
    };
  }, [scene, carriers]);

  /**
   * 화면의 지게를 찾아 지게마다 그 모양을 빌려 온다. 교체본은 수십 초 뒤에 서므로 1 초마다 다시 보고,
   * 교체본이 나타나면 원본 모양 대신 그것으로 갈아 끼운다. 찾은 것은 전부 숨길 대상이다.
   */
  const borrowLooks = (time: number) => {
    if (lookSourceRef.current === "aihub" || time - lastSearchRef.current < 1) return;
    lastSearchRef.current = time;
    const replacements: THREE.InstancedMesh[] = [];
    const originals: THREE.InstancedMesh[] = [];
    scene.traverse((object) => {
      if (!(object as THREE.InstancedMesh).isInstancedMesh) return;
      // 원근 나눔(·원경) 메시까지 — 하나라도 남기면 묶인 지게 곁에 빈 지게가 하나 더 서 있다
      if (object.name.startsWith("AI허브:씬2.지게")) replacements.push(object as THREE.InstancedMesh);
      else if (object.name.startsWith("씬2.지게")) originals.push(object as THREE.InstancedMesh);
    });
    borrowedRef.current = [...replacements, ...originals];
    // 모양은 가까운 쪽(·원경 아닌 것)에서만 빌린다
    const near = (list: THREE.InstancedMesh[]) => list.filter((mesh) => !mesh.name.endsWith("·원경"));
    const source = replacements.length ? near(replacements) : lookSourceRef.current ? [] : near(originals);
    if (!source.length) return;
    lookSourceRef.current = replacements.length ? "aihub" : "original";
    for (const carrier of carriers) carrier.group.clear();
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
        const nearest = position.distanceTo(carriers[0].rest) < position.distanceTo(carriers[1].rest) ? 0 : 1;
        const carrier = carriers[nearest];
        const part = new THREE.Mesh(mesh.geometry, mesh.material);
        part.scale.copy(scale);
        part.castShadow = true;
        carrier.group.add(part);
        if (carrier.state === "ground") {
          carrier.rest.copy(position);
          carrier.restYaw = new THREE.Euler().setFromQuaternion(quaternion, "YXZ").y;
          // 원래 지게 자리의 걷기 막이 — 지게가 떠나면 빈 자리에 걸리지 않게
          releasePropColliders("지게", position.x / M, position.z / M, 0.6);
        }
      }
    }
    // 밧줄을 맨 다리 끝 — 그 다리에 밧줄을 몇 바퀴 감아 매듭짓는다(지게와 같이 움직인다)
    for (const carrier of carriers) {
      const leg = findLegTip(carrier.group.children as THREE.Mesh[]);
      if (!leg) continue;
      carrier.legAxis.copy(leg.axis);
      carrier.legTie.copy(leg.tip).addScaledVector(leg.axis, 0.07 * M);
      const wraps = buildRopeWraps(leg.radius + ROPE_RADIUS * 0.6, LEG_WRAPS, ROPE_RADIUS * 2.1);
      wraps.position.copy(carrier.legTie);
      wraps.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), leg.axis);
      wraps.userData.ropeWraps = true;
      carrier.group.add(wraps);
    }
    prewarmShaders(
      gl,
      scene,
      camera,
      carriers.flatMap((carrier) => [carrier.group, carrier.rope]),
    );
  };

  /**
   * 기둥 — 매듭 높이에서 좌우로 쏴 본 돌기둥의 실제 가운데 · 굵기. 그 둘레에 밧줄을 감는다.
   * 돌새(RidgeBirds)가 기둥을 세운 뒤에야 잡히므로 1 초마다 다시 본다
   */
  const wrapPole = (time: number) => {
    if (poleRef.current || time - lastPoleTryRef.current < 1) return;
    lastPoleTryRef.current = time;
    const ray = new THREE.Raycaster();
    ray.camera = camera; // 장면의 그림 조각(Sprite)도 맞혀 보려면 있어야 한다
    const ours = new Set<THREE.Object3D>(carriers.flatMap((carrier) => [carrier.rope, carrier.group]));
    // 기둥 곁에 선 것만(돌새 기둥 무리) — 장면 전체에 쏘면 프레임이 끊긴다
    const targets = scene.children.filter((object) => !ours.has(object) && object.position.distanceTo(knot) < 2 * M);
    const sides: number[] = [];
    for (const sign of [1, -1]) {
      const origin = knot.clone().add(new THREE.Vector3(sign * 0.6 * M, 0, 0));
      ray.set(origin, new THREE.Vector3(-sign, 0, 0));
      ray.far = 0.6 * M;
      const hit = ray
        .intersectObjects(targets, true)
        .find((entry) => (entry.object as THREE.Mesh).isMesh && entry.object.visible);
      if (!hit) return;
      sides.push(hit.point.x);
    }
    const radius = Math.abs(sides[0] - sides[1]) / 2 / M;
    if (radius < 0.02 || radius > 0.3) return;
    knot.x = (sides[0] + sides[1]) / 2;
    const wraps = buildRopeWraps(radius + ROPE_RADIUS * 0.6, POLE_WRAPS, ROPE_RADIUS * 2.1);
    wraps.position.copy(knot);
    // 고리 축(+z)을 기둥 결(위)로
    wraps.rotation.x = -Math.PI / 2;
    scene.add(wraps);
    poleRef.current = { wraps, radius };
  };

  // E — 매듭에서 밧줄 당기기 · 내려온 지게 지기 · 날아간 지게 붙잡기 · 빈 지게 내려놓기
  useEffect(() => {
    const removeKnot = registerInteractable({
      id: "ridge-knot",
      position: knot,
      label: "밧줄 당겨 지게 끌어 내리기",
      radius: 0.5 * M,
      reach: 2.2 * M,
      // 한 번에 하나 — 끌어 내린 지게가 있으면(땅에 있거나 지고 있으면) 다른 줄은 안 당겨진다
      enabled: () =>
        carriers.some(
          (carrier) => carrier.state === "floating" || carrier.state === "hauling" || carrier.state === "dropped",
        ) &&
        !carriers.some(
          (carrier) => carrier.state === "landed" || carrier.state === "carried" || carrier.state === "placed",
        ) &&
        ridgeCarry.load === "none",
      use: () => {
        const carrier =
          carriers.find((entry) => entry.state === "hauling") ??
          carriers.find((entry) => entry.state === "floating") ??
          carriers.find((entry) => entry.state === "dropped");
        if (!carrier) return;
        // 땅에 떨어진 채 매인 지게는 줄만 푼다 — 당길 것이 없다
        if (carrier.state === "dropped") {
          carrier.state = "landed";
          audio.play("똑");
          showNotice("땅에 늘어진 밧줄을 풀었다 — 지게를 지면 무거운 것도 나를 수 있다.", 4);
          return;
        }
        carrier.state = "hauling";
        carrier.tugs++;
        carrier.ropeTarget = ROPE * (1 - carrier.tugs / TUGS);
        audio.play("똑");
        director.cue({ 카메라: "흔들림", 세기: 0.12 });
        if (carrier.tugs === 1) showNotice("밧줄을 당긴다 — 바람이 지게를 붙들고 버틴다. 몇 번 더!", 3);
        if (carrier.tugs >= TUGS) {
          carrier.state = "landed";
          audio.play("우르릉");
          showNotice(
            "지게를 끌어 내려 줄을 풀었다. 바람에 들썩이는 걸 꽉 붙들었다 — 지게를 지면 무거운 것도 나를 수 있다.",
            5,
          );
        }
      },
    });
    const removers = carriers.map((carrier, k) =>
      registerInteractable({
        id: `ridge-jige-${k}`,
        position: carrier.interact,
        label: "지게 지기",
        radius: 0.6 * M,
        reach: 2.2 * M,
        enabled: () =>
          !ridge.isAtLeast("done") &&
          (carrier.state === "landed" || carrier.state === "placed") &&
          ridgeCarry.load === "none",
        use: () => {
          carrier.state = "carried";
          ridgeCarry.load = "jige";
          audio.play("똑");
          showNotice(
            "지게를 졌다. 등에 얹으면 혼자서 못 드는 것도 나를 수 있다. (등짐을 지면 걸음이 무겁고 덜 뛴다 · 빈손 [E] 로 내려놓기)",
            5,
          );
        },
      }),
    );
    const grabbers = carriers.map((carrier, k) =>
      registerInteractable({
        id: `ridge-jige-grab-${k}`,
        position: carrier.interact,
        label: "날아다니는 지게 붙잡기",
        highlight: () => carrier.group,
        radius: 1.3 * M,
        reach: 7 * M,
        enabled: () => carrier.state === "flown" && ridgeCarry.load === "none",
        use: () => {
          if (camera.position.distanceTo(carrier.interact) / M > GRAB_REACH) {
            showNotice("손이 닿지 않는다. 지게 밑에서 힘껏 뛰어올라 붙잡자.", 3);
            return;
          }
          carrier.state = "carried";
          ridgeCarry.load = "jige";
          audio.play("단서");
          showNotice("허공에서 지게를 붙잡아 다시 멨다.", 3);
        },
      }),
    );
    // 빈 지게 내려놓기 — 겨눈 것이 없을 때의 [E]. 줄이 없으니 바람이 채 간다
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || event.repeat || !isPointerActive()) return;
      if (ridgeCarry.load !== "jige" || aimedId() || ridgeCarry.isCartGrabbed) return;
      const carrier = carriers.find((entry) => entry.state === "carried");
      if (!carrier) return;
      // 날려 보내지 않고 발 앞에 내려놓는다 — E 를 마구 누르다 지게를 잃고 뛰어 붙잡느라 헤매지 않게(박람회판 정리 · 미르 11/8).
      // 발밑 자리는 선 자리라 막힘 · 턱이 없다. 아래 바람에 날리는 분기는 이제 쓰지 않지만 저장본 · 개발 훅을 위해 남긴다
      if (KEEPS_JIGE_ON_PUT_DOWN) {
        ridgeCarry.putDown = { x: camera.position.x / M, z: camera.position.z / M };
        ridgeCarry.load = "none";
        audio.play("똑");
        showNotice("지게를 발 앞에 내려놓았다. 겨누고 E 로 다시 진다.", 3);
        return;
      }
      carrier.state = "flown";
      carrier.flownAt = -1;
      carrier.flownFrom.copy(carrier.group.position);
      ridgeCarry.load = "none";
      audio.play("우르릉");
      showNotice(
        "지게를 내려놓자마자 바람이 채 간다 — 묶을 줄이 없으니 머리 위를 맴돈다. (뛰어올라 [E] 로 다시 붙잡을 수 있다)",
        5,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => {
      removeKnot();
      removers.forEach((remove) => remove());
      grabbers.forEach((remove) => remove());
      window.removeEventListener("keydown", onKey);
    };
  }, [carriers, knot, camera]);

  /** 지게 한 짝의 자리 — 상태마다 */
  const placeCarrier = (carrier: Carrier, k: number, time: number, dt: number, lifting: boolean) => {
    // 장막이 풀렸다 — 바람이 사라지니 떠 있던 것은 그 자리에서 툭 떨어진다. 매인 것은 밧줄을 단 채로
    if (
      ridge.releaseFrom() !== null &&
      ridge.curtainClosed() < 0.5 &&
      (carrier.state === "rising" ||
        carrier.state === "floating" ||
        carrier.state === "hauling" ||
        carrier.state === "flown")
    ) {
      carrier.state = carrier.state === "flown" ? "falling" : "fallingTied";
      carrier.fallSpeed = 0;
      carrier.restYaw = carrier.group.rotation.y;
    }
    if (isFalling(carrier.state)) {
      carrier.fallSpeed += FALL_GRAVITY * dt;
      carrier.group.position.y -= carrier.fallSpeed * dt * M;
      // 떨어지며 몸이 바로 선다
      carrier.group.rotation.x *= 1 - Math.min(1, dt * 4);
      carrier.group.rotation.z *= 1 - Math.min(1, dt * 4);
      const floor = groundY(carrier.group.position.x / M, carrier.group.position.z / M) * M;
      if (carrier.group.position.y <= floor) {
        carrier.group.position.y = floor;
        carrier.rest.copy(carrier.group.position);
        carrier.state = carrier.state === "fallingTied" ? "dropped" : "placed";
        audio.play("똑");
        director.cue({ 카메라: "흔들림", 세기: 0.18 });
        if (k === 0) showNotice("바람이 걷히자 떠 있던 지게가 땅에 툭 떨어진다.", 3);
      }
      return;
    }
    if (carrier.state === "ground" && lifting) {
      carrier.state = "rising";
      carrier.risenAt = time;
      if (k === 0)
        showNotice("기둥에 묶인 지게 둘이 바람에 들려 떠오른다 — 밧줄이 팽팽하게 당겨진다.", 4, { fleeting: true });
    }
    // 밧줄 방향 — 위로, 바람 따라 기울며 맴돈다
    const phi = 0.9 + k * 1.6 + Math.sin(time * 0.37 + k * 2) * 0.55;
    const theta = THREE.MathUtils.degToRad(58 + Math.sin(time * 0.6 + k) * 9);
    const direction = new THREE.Vector3(
      Math.cos(theta) * Math.cos(phi),
      Math.sin(theta),
      Math.cos(theta) * Math.sin(phi),
    );
    carrier.ropeLength += (carrier.ropeTarget - carrier.ropeLength) * Math.min(1, dt * 5);
    const floatAt = knot.clone().addScaledVector(direction, carrier.ropeLength * M);
    const tumble = (group: THREE.Group) =>
      group.rotation.set(
        Math.sin(time * 0.5 + k) * 0.6,
        carrier.restYaw + time * 0.25 + k,
        Math.cos(time * 0.43 + k) * 0.5,
      );

    if (carrier.state === "rising") {
      const eased = THREE.MathUtils.smootherstep(time - carrier.risenAt, 0, RISE_SECONDS);
      carrier.group.position.lerpVectors(carrier.rest, floatAt, eased);
      tumble(carrier.group);
      carrier.group.rotation.x *= eased;
      carrier.group.rotation.z *= eased;
      if (eased >= 1) carrier.state = "floating";
    } else if (carrier.state === "floating" || carrier.state === "hauling") {
      carrier.group.position.copy(floatAt);
      tumble(carrier.group);
      // 줄을 다 당기면 매듭 곁에 내려선다
      if (carrier.state === "hauling" && carrier.ropeLength < 0.35)
        carrier.group.position.y = Math.max(carrier.group.position.y, knot.y - POLE.knot * M);
    } else if (carrier.state === "landed" || carrier.state === "placed" || carrier.state === "dropped") {
      if (carrier.state === "landed") {
        const side = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi)).multiplyScalar(0.9 * M);
        carrier.rest.set(
          knot.x + side.x,
          groundY(knot.x / M + side.x / M, knot.z / M + side.z / M) * M,
          knot.z + side.z,
        );
      }
      carrier.group.position.lerp(carrier.rest, Math.min(1, dt * 6));
      carrier.group.rotation.set(0, carrier.restYaw, 0);
    } else if (carrier.state === "flown") {
      // 바람에 실려 빙글빙글 떠올라 능선 하늘을 맴돈다
      if (carrier.flownAt < 0) carrier.flownAt = time;
      const age = time - carrier.flownAt;
      const angle = FLY_SPEED * age + k * 3;
      const orbitX = RIDGE_CENTER.x + Math.cos(angle) * FLY_RADIUS;
      const orbitZ = RIDGE_CENTER.z + Math.sin(angle) * FLY_RADIUS;
      const orbit = new THREE.Vector3(
        orbitX * M,
        (groundY(orbitX, orbitZ) + FLY_HEIGHT + Math.sin(age * 0.8 + k) * 0.3) * M,
        orbitZ * M,
      );
      const eased = THREE.MathUtils.smootherstep(age, 0, FLY_SECONDS);
      carrier.group.position.lerpVectors(carrier.flownFrom, orbit, eased);
      carrier.group.position.y += Math.sin(eased * Math.PI) * 1.5 * M;
      carrier.group.rotation.set(Math.sin(time * 0.7 + k) * 0.8, time * 0.5 + k, Math.cos(time * 0.6 + k) * 0.6);
      // 둘 다 날아가고 궤를 아직 못 옮겼으면 — 바람이 잠깐 잦아든 틈에 기둥 곁으로 도로 떨어뜨린다
      const isLastFlown =
        carriers.every((other) => other.state === "flown") &&
        carriers.every((other) => other.flownAt <= carrier.flownAt);
      if (isLastFlown && age > RETURN_AFTER && !ridgeQuest.chestOnAltar && ridgeCarry.load === "none") {
        carrier.state = "landed";
        carrier.flownAt = 0;
        showNotice("바람이 잠깐 숨을 고른 사이, 날아갔던 지게 하나가 기둥 곁에 툭 떨어졌다.", 4);
      }
    } else if (carrier.state === "carried") {
      // 등에 진다 — 눈 뒤 아래. 1인칭에서는 그림자로만 보인다
      const back = new THREE.Vector3();
      camera.getWorldDirection(back);
      back.y = 0;
      back.normalize().multiplyScalar(-0.35 * M);
      carrier.group.position
        .copy(camera.position)
        .add(back)
        .addScaledVector(UP, -1.25 * M);
      carrier.group.rotation.set(0, Math.atan2(back.x, back.z) + Math.PI, 0);
    } else {
      carrier.group.position.copy(carrier.rest);
      carrier.group.rotation.set(0, carrier.restYaw, 0);
    }
  };

  /** 공중에 뜬 지게는 몸을 뚫고 지나가지 않는다 — 겹치면 옆으로 비켜 서고, 상자로 막는다 */
  const keepOffPlayer = (carrier: Carrier) => {
    const airborne = isAirborne(carrier.state);
    if (airborne) {
      const x = carrier.group.position.x / M;
      const y = carrier.group.position.y / M;
      const z = carrier.group.position.z / M;
      const eye = camera.position.y / M;
      const dx = x - camera.position.x / M;
      const dz = z - camera.position.z / M;
      const distance = Math.hypot(dx, dz);
      const need = 0.9;
      if (y < eye + 0.15 && y + 1.3 > eye - 1.25 && distance < need) {
        const nx = distance > 1e-4 ? dx / distance : 1;
        const nz = distance > 1e-4 ? dz / distance : 0;
        carrier.group.position.x = (camera.position.x / M + nx * need) * M;
        carrier.group.position.z = (camera.position.z / M + nz * need) * M;
      }
    }
    Object.assign(carrier.solid, {
      x: carrier.group.position.x / M,
      z: carrier.group.position.z / M,
      bottom: carrier.group.position.y / M,
      top: carrier.group.position.y / M + 1.3,
      enabled: airborne,
    });
  };

  /** 밧줄 — 땅에 늘어진 줄 · 팽팽한 줄 · 매인 채 떨어진 줄 · 풀린 뒤에는 없다. 다리에 감은 매듭에서 기둥에 감은 바퀴까지 잇는다 */
  const drawRope = (carrier: Carrier, time: number) => {
    carrier.group.updateMatrixWorld(true);
    carrier.end.copy(carrier.legTie).applyMatrix4(carrier.group.matrixWorld);
    const tied = isTied(carrier.state);
    carrier.rope.visible = tied && carrier.group.children.length > 0;
    for (const child of carrier.group.children) if (child.userData.ropeWraps) child.visible = tied;
    if (!carrier.rope.visible) return;
    const slack =
      carrier.state === "ground" || carrier.state === "dropped"
        ? 0.45
        : carrier.state === "rising"
          ? 0.45 * (1 - THREE.MathUtils.clamp((time - carrier.risenAt) / RISE_SECONDS, 0, 1)) + 0.08
          : carrier.state === "fallingTied"
            ? 0.25
            : 0.08;
    // 기둥 쪽 끝 — 기둥 가운데가 아니라 감긴 바퀴 겉, 지게 쪽 면에서 나온다
    const start = knot.clone();
    if (poleRef.current) {
      const toward = new THREE.Vector3(carrier.end.x - knot.x, 0, carrier.end.z - knot.z).normalize();
      start.addScaledVector(toward, (poleRef.current.radius + ROPE_RADIUS) * M);
    }
    const curve = buildRopeCurve(start, carrier.end, slack);
    carrier.rope.geometry.dispose();
    carrier.rope.geometry = new THREE.TubeGeometry(curve, 28, ROPE_RADIUS * M, 5, false);
  };

  useFrame((frame, rawDt) => {
    // 틈을 지나면 빈 지게는 두고 온다 — 안 비우면 다음 맵에서도 느리고 E 에 지게가 날아간다
    if (ridge.isAtLeast("done") && ridgeCarry.load !== "none") {
      ridgeCarry.load = "none";
      for (const carrier of carriers) if (carrier.state === "carried") carrier.state = "landed";
    }
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    borrowLooks(time);
    if (!lookSourceRef.current) return;
    // 기둥은 가까이 왔을 때만 재 본다
    if (camera.position.distanceTo(knot) < 30 * M) wrapPole(time);
    const now = stageRef.current;
    const lifting = now === "sealing" ? ridge.elapsed() > LIFT_AT : ridge.isAtLeast("sealed");

    // 지게를 수레 곁에 내려놓았다(궤를 수레에 옮긴 뒤)
    if (ridgeCarry.putDown) {
      const carrier = carriers.find((entry) => entry.state === "carried");
      if (carrier) {
        carrier.state = "placed";
        carrier.rest.set(
          ridgeCarry.putDown.x * M,
          groundY(ridgeCarry.putDown.x, ridgeCarry.putDown.z) * M,
          ridgeCarry.putDown.z * M,
        );
      }
      ridgeCarry.putDown = null;
    }

    // 원래 화면의 지게는 숨기고 우리가 대신 그린다 — 다리에 감은 밧줄 매듭이 땅에 있을 때부터 보이게
    for (const mesh of borrowedRef.current) mesh.visible = false;

    carriers.forEach((carrier, k) => {
      placeCarrier(carrier, k, time, dt, lifting);
      keepOffPlayer(carrier);
      drawRope(carrier, time);
      carrier.interact.copy(carrier.group.position).addScaledVector(UP, 0.6 * M);
    });
    // 기둥에 감은 밧줄 — 매인 지게가 하나라도 남아 있는 동안
    if (poleRef.current) poleRef.current.wraps.visible = carriers.some((carrier) => carrier.rope.visible);
  });

  return null;
}
