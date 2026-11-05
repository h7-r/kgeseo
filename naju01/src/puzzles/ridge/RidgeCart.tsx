/**
 * 증언 능선 수레 · 궤 — 무거운 궤는 맨손으로 못 든다.
 *   기둥에 묶인 지게를 끌어 내려 지고 궤를 얹어 수레에 싣고, 수레를 밀어(E 로 잡고 놓는다) 진부촌 문
 *   두 장승 사이 돌단까지 가져가 올린다 → 뚜껑이 열려 낡은 종이가 드러난다(GateAltar).
 * 수레와 궤는 걷기 충돌의 움직이는 상자(solidField.addDynamicSolid)라 밟고 설 수 있다. 잡고 미는 동안은 상자를 끈다.
 * 바퀴 자국이 진부촌 문에서 수레까지 이어져 「그날 밤 이 수레는 저 문으로 들어왔다」는 단서가 된다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { recall, track } from "../../save/puzzleMemory";
import { addDynamicSolid, solidQueries, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import {
  AXLE_Y,
  CART,
  CHEST,
  WHEEL_X,
  buildCartGeometry,
  buildChest,
  buildRuts,
  buildWheelGeometry,
} from "./cartModels";
import { ALTAR, CART_START, CHEST_START, GATE, RIDGE_CENTER, isInsideCurtain } from "./ridgeShape";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";
import { makeVertexColorMaterial } from "./vertexPaint";

/** 잡았을 때 손잡이 끝이 발 앞 이만큼 · 수레가 시선을 따라 도는 빠르기(rad/s) */
const GRIP_AHEAD = 0.45;
const TURN_RATE = 4.5;
/** 돌단에 오르면 뚜껑이 젖혀지는 시간(초) · 열린 각 */
const LID_OPEN_SECONDS = 1.6;
const LID_OPEN_ANGLE = THREE.MathUtils.degToRad(108);
/** 시공간 틈이 열리고(단계 rift) 이만큼 뒤에 궤가 빨려 든다(초) · 빨려 드는 시간 */
const SUCK_AT = 3.4;
const SUCK_SECONDS = 1.8;
/** 수레에 실린 궤 자리(수레 로컬) — 뒤쪽 반에 둬서 앞쪽 바닥을 딛고 오른다 */
const CHEST_ON_CART = new THREE.Vector3(0, CART.bedTop, -0.22);
const LOAD_SECONDS = 0.7;
/** 수레를 돌단에서 이만큼(m) 안에 대야 궤를 옮겨 올린다 */
const ALTAR_REACH = 2.6;
/** 빠진 바퀴가 바람에 떠 맴도는 자리 · 높이(땅 위 m) — 장막 안 높은 점프로만 닿는다 · 붙잡는 손 거리(눈에서, m) */
const WHEEL_ORBIT = { x: 68.6, z: 17.6, radius: 1.3, height: 3.9 };
const WHEEL_REACH = 1.5;
/** 수레가 한쪽 바퀴 없이 기운 각 */
const LEAN = -0.17;
/** E 를 같은 순간 두 곳이 받지 않게 */
const TOGGLE_GUARD_MS = 180;

/** 궤 — 땅 · 지게 등 · 수레로 미끄러지는 중 · 수레 위 · 돌단으로 · 돌단 위 · 틈에 빨려 들었다 */
type ChestPlace = "ground" | "carried" | "loading" | "cart" | "toAltar" | "altar" | "sucked";
/** 오른쪽 바퀴 — 붙어 있다 → 바람에 뜯겨 날아오른다 → 맴돈다 → 손에 들었다 → 다시 끼웠다 */
type WheelPlace = "on" | "flying" | "floating" | "held" | "fitted";

interface CartState {
  /** 수레 자리(m) · 바라보는 쪽(rotation.y) */
  x: number;
  z: number;
  yaw: number;
  isGrabbed: boolean;
  chest: ChestPlace;
  /** 궤가 움직이기 시작한 자리 · 진행 0~1 */
  loadFromX: number;
  loadFromZ: number;
  loadFromY: number;
  loadT: number;
  chestX: number;
  chestZ: number;
  chestYaw: number;
  /** 뚜껑 열림 0~1 */
  lidT: number;
  isLidTold: boolean;
  toggledAt: number;
  toldRuts: boolean;
  toldChest: boolean;
  wheel: WheelPlace;
  wheelT: number;
}

function createCart() {
  const chest = buildChest();
  const material = makeVertexColorMaterial();
  const body = new THREE.Mesh(buildCartGeometry(), material);
  body.castShadow = true;
  body.receiveShadow = true;
  body.scale.setScalar(M);
  const wheel = new THREE.Mesh(buildWheelGeometry(), material);
  wheel.castShadow = true;
  wheel.scale.setScalar(M);
  const cartSolid: DynamicSolid = {
    x: 0,
    z: 0,
    yaw: 0,
    halfX: CART.halfX,
    halfZ: CART.halfZ,
    bottom: 0,
    top: 0,
    enabled: false,
  };
  const chestSolid: DynamicSolid = { x: 0, z: 0, yaw: 0, halfX: 0.24, halfZ: 0.16, bottom: 0, top: 0, enabled: false };
  const state: CartState = {
    x: CART_START.x,
    z: CART_START.z,
    yaw: CART_START.yaw,
    isGrabbed: false,
    chest: "ground",
    loadFromX: 0,
    loadFromZ: 0,
    loadFromY: 0,
    loadT: 0,
    chestX: CHEST_START.x,
    chestZ: CHEST_START.z,
    chestYaw: CHEST_START.yaw,
    lidT: 0,
    isLidTold: false,
    toggledAt: -1e9,
    toldRuts: false,
    toldChest: false,
    wheel: "on",
    wheelT: 0,
  };
  return {
    body,
    wheel,
    chest: chest.group,
    chestLid: chest.lid,
    ruts: buildRuts(),
    cartSolid,
    chestSolid,
    state,
    /** 겨눌 자리(유닛) — 바퀴 · 바닥 · 궤 · 돌단 */
    wheelPosition: new THREE.Vector3(),
    bedPosition: new THREE.Vector3(),
    chestPosition: new THREE.Vector3(),
    altarPosition: new THREE.Vector3(ALTAR.x * M, (groundY(ALTAR.x, ALTAR.z) + ALTAR.top + 0.15) * M, ALTAR.z * M),
  };
}
type Cart = ReturnType<typeof createCart>;

const scratch = { forward: new THREE.Vector3(), local: new THREE.Vector3() };

/** 누르고 있는 이동키 — 수레 방향을 틀 때 본다 */
function useHeldKeys() {
  const keys = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => keys.add(event.code);
    const up = (event: KeyboardEvent) => keys.delete(event.code);
    const clear = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [keys]);
  return keys;
}

/**
 * 미는 중 — 수레는 바라보는 쪽으로 천천히 돈다(마우스로 돌리면 같이 돈다). 옆 키를 누르면 그쪽으로 더 틀고,
 * 뒤 키(S)만이면 방향을 그대로 둔 채 끌려 온다. 손잡이 끝은 발 앞, 수레는 그 앞으로. 막힌 쪽으로는 그냥 안 나간다
 */
function pushCart(cart: Cart, camera: THREE.Camera, keys: Set<string>, dt: number) {
  const { state } = cart;
  const px = camera.position.x / M;
  const pz = camera.position.z / M;
  const { forward } = scratch;
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const forwardKey =
    (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const sideKey =
    (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  let yaw = state.yaw;
  if (forwardKey >= 0) {
    // 시선 + 옆 키 — 오른쪽은 (−앞z, 앞x)
    const mx = forward.x - forward.z * sideKey * 0.6;
    const mz = forward.z + forward.x * sideKey * 0.6;
    let turn = Math.atan2(-mx, -mz) - state.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    yaw = state.yaw + THREE.MathUtils.clamp(turn, -TURN_RATE * dt, TURN_RATE * dt);
  }
  // 수레가 놓인 쪽(플레이어 → 수레)
  const pushX = -Math.sin(yaw);
  const pushZ = -Math.cos(yaw);
  const gripX = px + pushX * GRIP_AHEAD;
  const gripZ = pz + pushZ * GRIP_AHEAD;
  const nextX = gripX - Math.sin(yaw) * CART.handleReach;
  const nextZ = gripZ - Math.cos(yaw) * CART.handleReach;
  const solid = solidQueries.current;
  const ground = groundY(nextX, nextZ);
  const isBlocked = (x: number, z: number) => !!solid?.blockedAt(x, z, ground, 0.42);
  const ahead = { x: nextX - Math.sin(yaw) * 0.4, z: nextZ - Math.cos(yaw) * 0.4 };
  const fits =
    isInsideCurtain(nextX, nextZ, 0.9) &&
    !isBlocked(nextX, nextZ) &&
    !isBlocked(ahead.x, ahead.z) &&
    Math.abs(ground - groundY(state.x, state.z)) < 0.4;
  if (fits) {
    state.x = nextX;
    state.z = nextZ;
    state.yaw = yaw;
  }
}

/** 궤 자리 — 땅 · 지게 등 · 수레 위 · 돌단, 그 사이를 미끄러지는 움직임. 궤 바닥 높이(m)를 돌려준다 */
function placeChest(cart: Cart, camera: THREE.Camera, dt: number) {
  const { state, chest } = cart;
  const cartGround = groundY(state.x, state.z);
  const cos = Math.cos(state.yaw);
  const sin = Math.sin(state.yaw);
  const onCartX = state.x + CHEST_ON_CART.x * cos + CHEST_ON_CART.z * sin;
  const onCartZ = state.z - CHEST_ON_CART.x * sin + CHEST_ON_CART.z * cos;
  let chestY = groundY(state.chestX, state.chestZ);
  if (state.chest === "loading") {
    // 수레 위로 미끄러져 오른다
    state.loadT = Math.min(1, state.loadT + dt / LOAD_SECONDS);
    const eased = THREE.MathUtils.smootherstep(state.loadT, 0, 1);
    chestY = THREE.MathUtils.lerp(state.loadFromY, cartGround + CART.bedTop, eased) + Math.sin(eased * Math.PI) * 0.25;
    chest.position.set(
      THREE.MathUtils.lerp(state.loadFromX, onCartX, eased) * M,
      chestY * M,
      THREE.MathUtils.lerp(state.loadFromZ, onCartZ, eased) * M,
    );
    chest.rotation.y = THREE.MathUtils.lerp(state.chestYaw, state.yaw, eased);
    if (state.loadT >= 1) {
      state.chest = "cart";
      audio.play("우르릉");
      showNotice(
        "궤를 수레에 실었다. 바퀴 자국이 난 진부촌 문 쪽 — 두 장승 사이 돌단으로 밀고 가자. (빈 지게는 빈손 [E] 로 내려놓는다)",
        5,
      );
    }
  } else if (state.chest === "sucked") {
    // 시공간 틈이 열리면 궤가 빨려 들어간다 — 돌며 작아지며 틈 가운데로
    state.loadT = Math.min(1, state.loadT + dt / SUCK_SECONDS);
    const eased = THREE.MathUtils.smootherstep(state.loadT, 0, 1);
    const gateY = groundY(GATE.center.x, GATE.center.z) + 1.3;
    chestY = THREE.MathUtils.lerp(state.loadFromY, gateY, eased) + Math.sin(eased * Math.PI) * 0.4;
    state.chestX = THREE.MathUtils.lerp(state.loadFromX, GATE.center.x, eased);
    state.chestZ = THREE.MathUtils.lerp(state.loadFromZ, GATE.center.z, eased);
    chest.position.set(state.chestX * M, chestY * M, state.chestZ * M);
    chest.rotation.set(eased * 6, state.chestYaw + eased * 9, eased * 3);
    chest.scale.setScalar(M * Math.max(0.0001, 1 - eased * eased));
    chest.visible = state.loadT < 1;
  } else if (state.chest === "toAltar" || state.chest === "altar") {
    const altarY = groundY(ALTAR.x, ALTAR.z) + ALTAR.top;
    const altarYaw = Math.atan2(RIDGE_CENTER.x - ALTAR.x, RIDGE_CENTER.z - ALTAR.z);
    // 틈이 열리면 빨려 든다
    if (state.chest === "altar" && ridge.stage() === "rift" && ridge.elapsed() > SUCK_AT) {
      state.chest = "sucked";
      state.loadT = 0;
      state.loadFromX = state.chestX;
      state.loadFromZ = state.chestZ;
      state.loadFromY = altarY;
      audio.play("전환");
      showNotice("열린 틈이 돌단의 궤를 빨아들인다 — 그날 밤의 것이 그날 밤으로 돌아간다.", 4.5);
    }
    if (state.chest === "toAltar") {
      state.loadT = Math.min(1, state.loadT + dt / (LOAD_SECONDS * 1.6));
      const eased = THREE.MathUtils.smootherstep(state.loadT, 0, 1);
      chestY = THREE.MathUtils.lerp(state.loadFromY, altarY, eased) + Math.sin(eased * Math.PI) * 0.35;
      state.chestX = THREE.MathUtils.lerp(state.loadFromX, ALTAR.x, eased);
      state.chestZ = THREE.MathUtils.lerp(state.loadFromZ, ALTAR.z, eased);
      chest.rotation.y = THREE.MathUtils.lerp(state.chestYaw, altarYaw, eased);
      if (state.loadT >= 1) {
        state.chest = "altar";
        state.chestYaw = altarYaw;
        state.lidT = 0;
        audio.play("우르릉");
        ridgeQuest.set("chestOnAltar");
      }
    } else {
      chestY = altarY;
      state.chestX = ALTAR.x;
      state.chestZ = ALTAR.z;
      chest.rotation.y = altarYaw;
      // 뚜껑이 삐걱 천천히 뒤로 젖혀진다 — 끝에서 살짝 되튀며 멈춘다
      state.lidT = Math.min(1, state.lidT + dt / LID_OPEN_SECONDS);
      const eased = THREE.MathUtils.smootherstep(state.lidT, 0, 1);
      cart.chestLid.rotation.x = -LID_OPEN_ANGLE * eased + Math.sin(state.lidT * Math.PI) * 0.06 * (1 - eased);
      if (state.lidT >= 1 && !state.isLidTold) {
        state.isLidTold = true;
        audio.play("똑");
      }
    }
    chest.position.set(state.chestX * M, chestY * M, state.chestZ * M);
  } else if (state.chest === "carried") {
    // 지게에 얹혀 등 뒤에 — 1인칭에서는 그림자와 고개를 돌릴 때 끝자락만 보인다
    const { forward } = scratch;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    chestY = camera.position.y / M - 1.05;
    state.chestX = camera.position.x / M - forward.x * 0.42;
    state.chestZ = camera.position.z / M - forward.z * 0.42;
    state.chestYaw = Math.atan2(forward.x, forward.z);
    chest.position.set(state.chestX * M, chestY * M, state.chestZ * M);
    chest.rotation.y = state.chestYaw;
  } else if (state.chest === "cart") {
    state.chestX = onCartX;
    state.chestZ = onCartZ;
    state.chestYaw = state.yaw;
    chestY = cartGround + CART.bedTop;
    chest.position.set(onCartX * M, chestY * M, onCartZ * M);
    chest.rotation.y = state.yaw;
  } else {
    chest.position.set(state.chestX * M, chestY * M, state.chestZ * M);
    chest.rotation.y = state.chestYaw;
  }
  return chestY;
}

/** 오른쪽 바퀴 — 장막이 내려오면 뜯겨 날아올라 맴돌고, 붙잡으면 손에 들리고, 끼우면 제자리 */
function placeWheel(cart: Cart, camera: THREE.Camera, time: number, dt: number) {
  const { state, wheel } = cart;
  const cartGround = groundY(state.x, state.z);
  const isOn = state.wheel === "on" || state.wheel === "fitted";
  const hubX = state.x + WHEEL_X * Math.cos(state.yaw);
  const hubZ = state.z - WHEEL_X * Math.sin(state.yaw);
  if (state.wheel === "on" && ridge.stage() === "sealing" && ridge.elapsed() > 6.5) {
    state.wheel = "flying";
    state.wheelT = 0;
    audio.play("우르릉");
    showNotice("바람이 수레바퀴를 뜯어 하늘로 들어 올린다!", 3.5);
  }
  const orbitAngle = time * 0.35;
  const orbitX = WHEEL_ORBIT.x + Math.cos(orbitAngle) * WHEEL_ORBIT.radius;
  const orbitZ = WHEEL_ORBIT.z + Math.sin(orbitAngle) * WHEEL_ORBIT.radius;
  const orbitY = groundY(orbitX, orbitZ) + WHEEL_ORBIT.height + Math.sin(time * 1.1) * 0.25;
  if (isOn) {
    wheel.position.set(hubX * M, (cartGround + AXLE_Y) * M, hubZ * M);
    wheel.rotation.set(0, state.yaw, 0);
  } else if (state.wheel === "flying") {
    state.wheelT = Math.min(1, state.wheelT + dt / 2.2);
    const eased = THREE.MathUtils.smootherstep(state.wheelT, 0, 1);
    wheel.position.set(
      THREE.MathUtils.lerp(hubX, orbitX, eased) * M,
      (THREE.MathUtils.lerp(cartGround + AXLE_Y, orbitY, eased) + Math.sin(eased * Math.PI) * 1.5) * M,
      THREE.MathUtils.lerp(hubZ, orbitZ, eased) * M,
    );
    wheel.rotation.set(time * 3, time * 2, 0);
    if (state.wheelT >= 1) state.wheel = "floating";
  } else if (state.wheel === "floating") {
    wheel.position.set(orbitX * M, orbitY * M, orbitZ * M);
    wheel.rotation.set(Math.sin(time * 0.7) * 0.5, time * 0.8, 0.3);
  } else {
    // 손에 들었다 — 화면 오른쪽 아래
    const { local } = scratch;
    local.set(0.32, -0.42, -0.75).applyQuaternion(camera.quaternion);
    wheel.position.copy(camera.position).addScaledVector(local, M);
    wheel.quaternion.copy(camera.quaternion);
    wheel.rotateY(Math.PI / 2);
  }
  cart.wheelPosition.copy(wheel.position);
  return isOn;
}

export default function RidgeCart() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const cart = useMemo(() => {
    const created = createCart();
    const saved = recall<Partial<typeof created.state> | null>("ridge.cart", null);
    if (saved) Object.assign(created.state, saved);
    return created;
  }, []);
  useEffect(
    () =>
      track("ridge.cart", () => {
        const { x, z, yaw, chest, chestX, chestZ, chestYaw, wheel } = cart.state;
        return {
          x,
          z,
          yaw,
          chestX,
          chestZ,
          chestYaw,
          // 움직이는 중이던 것은 도착한 자리로 친다.
          chest: chest === "loading" ? "cart" : chest === "toAltar" ? "altar" : chest,
          wheel: wheel === "flying" ? "floating" : wheel,
        };
      }),
    [cart],
  );
  const stage = useRidgeStage();
  const isActive = stage === "sealed";
  const activeRef = useRef(isActive);
  const keys = useHeldKeys();

  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    scene.add(cart.body, cart.chest, cart.ruts, cart.wheel);
    const warm = window.setTimeout(
      () => prewarmShaders(gl, scene, camera, [cart.body, cart.chest, cart.ruts, cart.wheel]),
      3100,
    );
    const removeCart = addDynamicSolid(cart.cartSolid);
    const removeChest = addDynamicSolid(cart.chestSolid);
    return () => {
      window.clearTimeout(warm);
      scene.remove(cart.body, cart.chest, cart.ruts, cart.wheel);
      removeCart();
      removeChest();
    };
  }, [scene, cart, gl, camera]);

  // E — 수레 잡기·놓기, 바퀴 붙잡기·끼우기, 궤 싣기, 돌단에 올리기
  useEffect(() => {
    const { state } = cart;
    const toggleGrab = () => {
      const now = performance.now();
      if (now - state.toggledAt < TOGGLE_GUARD_MS) return;
      state.toggledAt = now;
      if (state.isGrabbed) {
        state.isGrabbed = false;
        return;
      }
      if (ridgeCarry.load === "jigeChest") {
        showNotice("궤를 진 채로는 수레를 밀 수 없다. 먼저 수레에 내려놓자.", 3);
        return;
      }
      if (state.wheel !== "on" && state.wheel !== "fitted") {
        showNotice("바퀴 하나가 빠져 수레가 기울어 있다. 빠진 바퀴는… 바람에 떠올라 머리 위에서 맴돌고 있다.", 4.5);
        return;
      }
      const foot = camera.position.y / M - 1.6;
      if (foot > groundY(camera.position.x / M, camera.position.z / M) + 0.3) {
        showNotice("수레 위에서는 수레를 밀 수 없다. 내려서 밀자.", 3);
        return;
      }
      state.isGrabbed = true;
      audio.play("똑");
      if (state.chest === "cart") showNotice("궤를 실은 수레가 묵직하게 구른다.", 2.5);
    };
    // 수레 어디를 겨눠도 E 로 바로 잡는다(궤를 지고 있으면 내려놓기가 먼저다)
    const removeCart = registerInteractable({
      id: "ridge-cart",
      position: cart.bedPosition,
      label: "수레 밀기",
      highlight: () => cart.body,
      radius: 1.3 * M,
      reach: 3 * M,
      enabled: () => activeRef.current && !state.isGrabbed && state.wheel !== "held" && ridgeCarry.load !== "jigeChest",
      use: toggleGrab,
    });
    const removeWheel = registerInteractable({
      id: "ridge-wheel",
      position: cart.wheelPosition,
      label: "바퀴 붙잡기",
      radius: 0.6 * M,
      reach: 7 * M,
      enabled: () => activeRef.current && state.wheel === "floating",
      use: () => {
        if (camera.position.distanceTo(cart.wheelPosition) / M > WHEEL_REACH) {
          showNotice("손이 닿지 않는다. 몸이 가벼우니 바퀴 밑에서 힘껏 뛰어올라 붙잡자.", 3.5);
          return;
        }
        state.wheel = "held";
        audio.play("단서");
        showNotice("공중에서 바퀴를 붙잡았다! 수레에 끼우자.", 3.5);
      },
    });
    // 바퀴를 들었으면 수레 어디를 겨눠도 바로 끼운다 — 수레 전체가 빛난다
    const removeFit = registerInteractable({
      id: "ridge-cart-fit",
      position: cart.bedPosition,
      label: "바퀴 끼우기",
      highlight: () => cart.body,
      radius: 1.5 * M,
      reach: 3.4 * M,
      enabled: () => activeRef.current && state.wheel === "held",
      use: () => {
        state.wheel = "fitted";
        audio.play("똑");
        showNotice("바퀴를 굴대에 끼웠다. 이제 수레가 구른다.", 3.5);
      },
    });
    // 궤 — 맨몸으로는 못 든다. 지게를 지고 와야 등에 얹는다
    const removeChest = registerInteractable({
      id: "ridge-chest",
      position: cart.chestPosition,
      label: "궤",
      radius: 0.5 * M,
      reach: 2.2 * M,
      enabled: () => activeRef.current && state.chest === "ground" && ridgeCarry.load !== "jige",
      use: () =>
        showNotice("궤가 너무 무거워 맨손으로는 들 수 없다. 등에 질 것이 있으면… 기둥에 묶인 지게가 떠오른다.", 4.5),
    });
    const removeChestOnBack = registerInteractable({
      id: "ridge-chest-jige",
      position: cart.chestPosition,
      label: "지게에 궤 얹기",
      radius: 0.5 * M,
      reach: 2.2 * M,
      enabled: () => activeRef.current && state.chest === "ground" && ridgeCarry.load === "jige",
      use: () => {
        state.chest = "carried";
        ridgeCarry.load = "jigeChest";
        audio.play("우르릉");
        showNotice("궤를 지게에 얹어 졌다. 묵직하다 — 수레에 내려놓자.", 4);
      },
    });
    const removeUnload = registerInteractable({
      id: "ridge-cart-unload",
      position: cart.bedPosition,
      label: "궤를 수레에 내려놓기",
      highlight: () => cart.body,
      radius: 0.8 * M,
      reach: 2.4 * M,
      enabled: () => activeRef.current && state.chest === "carried" && !state.isGrabbed,
      use: () => {
        state.loadFromX = camera.position.x / M;
        state.loadFromZ = camera.position.z / M;
        state.loadFromY = camera.position.y / M - 1.0;
        state.chest = "loading";
        state.loadT = 0;
        // 빈 지게는 등에 남는다 — 빈손 [E] 로 내려놓는다(TetheredCarriers)
        ridgeCarry.load = "jige";
        audio.play("똑");
      },
    });
    // 돌단 — 수레를 곁에 대거나 지게에 지고 오면 궤를 올린다
    const removeAltar = registerInteractable({
      id: "ridge-altar",
      position: cart.altarPosition,
      label: "궤를 올릴 돌단",
      radius: 1.2 * M,
      reach: 4 * M,
      enabled: () => activeRef.current && state.chest !== "altar" && state.chest !== "toAltar",
      use: () => {
        const isCartNear = state.chest === "cart" && Math.hypot(state.x - ALTAR.x, state.z - ALTAR.z) < ALTAR_REACH;
        if (!isCartNear && state.chest !== "carried") {
          showNotice(
            state.chest === "cart"
              ? "수레를 돌단 곁까지 바짝 밀어 대자."
              : "두 장승 사이에 반듯한 돌단이 있다. 무언가 올려놓으라는 듯하다 — 무거운 궤가 꼭 맞겠다.",
            4,
          );
          return;
        }
        if (state.isGrabbed) state.isGrabbed = false;
        state.loadFromX = state.chestX;
        state.loadFromZ = state.chestZ;
        state.loadFromY =
          state.chest === "carried" ? camera.position.y / M - 1.05 : groundY(state.x, state.z) + CART.bedTop;
        if (state.chest === "carried") ridgeCarry.load = "jige";
        state.chest = "toAltar";
        state.loadT = 0;
        audio.play("똑");
      },
    });
    if (import.meta.env.DEV)
      exposeDevHook("najuRidgeCart", {
        state: () => ({ ...state }),
        /** 수레를 그 자리에 놓고 궤를 싣는다 */
        place: (x: number, z: number, yaw: number, withChest = true) => {
          Object.assign(state, { x, z, yaw, isGrabbed: false });
          if (withChest) state.chest = "cart";
        },
      });
    // 잡은 채로는 어디를 겨눠도 E 가 놓기다
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyE" && !event.repeat && state.isGrabbed) toggleGrab();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      removeCart();
      removeChest();
      removeChestOnBack();
      removeUnload();
      removeAltar();
      removeWheel();
      removeFit();
      window.removeEventListener("keydown", onKey);
    };
  }, [cart, camera]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    const { state } = cart;
    ridgeCarry.isCartGrabbed = state.isGrabbed;
    // 바퀴를 들고 끝까지 풀면 끼울 자리가 꺼져 영영 손에 남는다 — 끝나면 수레로 돌려놓는다
    if (!activeRef.current && state.wheel === "held") state.wheel = "fitted";
    const px = camera.position.x / M;
    const pz = camera.position.z / M;

    // 처음 다가갈 때 단서
    if (activeRef.current && !state.toldRuts && Math.hypot(px - state.x, pz - state.z) < 3) {
      state.toldRuts = true;
      showNotice(
        "낡은 수레 한 대. 바퀴 자국이 진부촌 문에서 여기까지 이어져 있다 — 그날 밤 이 수레는 저 문으로 들어왔다.",
        5,
      );
    }
    if (
      activeRef.current &&
      !state.toldChest &&
      state.chest === "ground" &&
      Math.hypot(px - state.chestX, pz - state.chestZ) < 2.2
    ) {
      state.toldChest = true;
      showNotice("무거운 궤. 맨손으로는 들 수 없다 — 등에 질 것이 있으면 몰라도.", 4);
    }

    if (state.isGrabbed) {
      if (!activeRef.current) state.isGrabbed = false;
      pushCart(cart, camera, keys, dt);
    }
    const chestY = placeChest(cart, camera, dt);
    const isWheelOn = placeWheel(cart, camera, time, dt);

    const cartGround = groundY(state.x, state.z);
    cart.body.position.set(state.x * M, (cartGround - (isWheelOn ? 0 : 0.06)) * M, state.z * M);
    cart.body.rotation.set(0, state.yaw, isWheelOn ? 0 : LEAN, "YXZ");
    cart.chestPosition.set(state.chestX * M, (chestY + CHEST.height / 2) * M, state.chestZ * M);
    cart.bedPosition.set(state.x * M, (cartGround + CART.bedTop + 0.1) * M, state.z * M);

    // 밟고 서는 상자 — 미는 동안은 끈다(제 몸에 걸리지 않게)
    Object.assign(cart.cartSolid, {
      x: state.x,
      z: state.z,
      yaw: state.yaw,
      bottom: cartGround - 0.5,
      top: cartGround + CART.bedTop,
      enabled: !state.isGrabbed,
    });
    Object.assign(cart.chestSolid, {
      x: state.chestX,
      z: state.chestZ,
      yaw: state.chestYaw,
      bottom: chestY - 0.05,
      top: chestY + CHEST.height,
      enabled:
        state.chest !== "loading" &&
        state.chest !== "carried" &&
        state.chest !== "toAltar" &&
        state.chest !== "sucked" &&
        !state.isGrabbed,
    });
  });

  return null;
}
