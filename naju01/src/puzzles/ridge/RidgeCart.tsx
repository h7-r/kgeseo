/**
 * 증언 능선 수레 · 궤 — 무거운 궤(미르 라이브러리 「궤」)는 맨손으로 못 든다.
 *   기둥에 묶인 지게를 끌어 내려 지고 궤를 얹어 수레에 싣고, 수레를 밀어(E 로 잡고 놓는다) 진부촌 문
 *   두 장승 사이 돌단까지 가져가 올린다 → 문 양옆 횃불에 불이 붙는다(GateAltar).
 * 수레와 궤는 걷기 충돌의 움직이는 상자(solidField.addDynamicSolid)라 밟고 설 수 있다. 잡고 미는 동안은 상자를 끈다.
 * 바퀴 자국이 진부촌 문에서 수레까지 이어져 「그날 밤 이 수레는 저 문으로 들어왔다」는 단서가 된다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { exposeDevHook } from "@/debug/devHooks";
import { TOON_GRADIENT } from "@/engine/toon";

import { addDynamicSolid, solidQueries, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { M, groundY } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { prewarmShaders } from "../prewarm";
import { ALTAR, CART_START, CHEST_START, GATE, RIDGE_CENTER, RUT_PATH, isInsideCurtain } from "./ridgeShape";
import { makeOldPaperTexture } from "./oldPaper";
import { ridge, ridgeCarry, ridgeQuest, useRidgeStage } from "./ridgeState";

/** 수레 — 앞(+z)이 손잡이. 바닥 윗면 높이 */
const BED_TOP = 0.55;
const BED = { halfX: 0.42, halfZ: 0.62 };
/** 수레 가운데에서 손잡이 끝까지 */
const HANDLE_REACH = 1.45;
/** 잡았을 때 손잡이 끝이 발 앞 이만큼 */
const GRIP_AHEAD = 0.45;
const TURN_RATE = 4.5;
/** 궤 높이(뚜껑까지, m) · 돌단에 오르면 뚜껑이 젖혀지는 시간(초) · 열린 각 */
const CHEST_HEIGHT = 0.42;
const LID_OPEN_SECONDS = 1.6;
const LID_OPEN_ANGLE = THREE.MathUtils.degToRad(108);
/** 시공간 틈이 열리고(단계 rift) 이만큼 뒤에 궤가 빨려 든다(초) · 빨려 드는 시간 */
const SUCK_AT = 3.4;
const SUCK_SECONDS = 1.8;
/** 수레에 실린 궤 자리(수레 로컬) — 뒤쪽 반에 둬서 앞쪽 바닥을 딛고 오른다 */
const CHEST_ON_CART = new THREE.Vector3(0, BED_TOP, -0.22);
const LOAD_SECONDS = 0.7;
/** 수레를 돌단에서 이만큼(m) 안에 대야 궤를 옮겨 올린다 */
const ALTAR_REACH = 2.6;
/** 바퀴 — 수레 가운데에서 옆으로 · 굴대 높이 */
const WHEEL_X = 0.5;
const AXLE_Y = 0.33;
/** 빠진 바퀴가 바람에 떠 맴도는 자리 · 높이(땅 위 m) — 장막 안 높은 점프로만 닿는다 */
const WHEEL_ORBIT = { x: 68.6, z: 17.6, radius: 1.3, height: 3.9 };
/** 공중에서 바퀴를 붙잡는 손 거리(눈에서, m) */
const WHEEL_REACH = 1.5;
/** 수레가 한쪽 바퀴 없이 기운 각 */
const LEAN = -0.17;
/** E 를 같은 순간 두 곳이 받지 않게 */
const TOGGLE_GUARD_MS = 180;

const wood = "#7A5C3E";
const woodDark = "#4E3A26";
const iron = "#3A3633";

function paint(geometry: THREE.BufferGeometry, color: string) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const colors = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** 바퀴 하나 — 쇠테 · 바큇살 여섯 · 바퀴통. 원점이 바퀴 가운데, 굴대는 x 축 */
function buildWheelGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(0.3, 0.035, 6, 20);
  rim.rotateY(Math.PI / 2);
  parts.push(paint(rim, iron));
  for (let k = 0; k < 6; k++) {
    const spoke = new THREE.BoxGeometry(0.03, 0.58, 0.03);
    spoke.rotateX((k / 6) * Math.PI);
    parts.push(paint(spoke, wood));
  }
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10);
  hub.rotateZ(Math.PI / 2);
  parts.push(paint(hub, woodDark));
  return mergeGeometries(parts.map((p) => (p.attributes.normal ? p : (p.computeVertexNormals(), p))), false)!;
}

/** 손수레 — 두 바퀴 · 널 바닥 · 낮은 난간 · 손잡이 두 대 · 앞 받침다리. 원점은 바닥 가운데 땅 위 */
function buildCartGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // 널 바닥 — 널 다섯 장. 틈이 보여야 수레다
  for (let k = 0; k < 5; k++) parts.push(box(0.15, 0.05, BED.halfZ * 2, -0.34 + k * 0.17, BED_TOP - 0.025, 0, k % 2 ? wood : woodDark));
  parts.push(box(0.06, 0.08, BED.halfZ * 2, -BED.halfX + 0.03, BED_TOP - 0.09, 0, woodDark));
  parts.push(box(0.06, 0.08, BED.halfZ * 2, BED.halfX - 0.03, BED_TOP - 0.09, 0, woodDark));
  // 낮은 난간
  for (const side of [-1, 1]) {
    parts.push(box(0.04, 0.04, BED.halfZ * 2, side * (BED.halfX - 0.02), BED_TOP + 0.12, 0, wood));
    for (const z of [-0.5, 0, 0.5]) parts.push(box(0.04, 0.12, 0.04, side * (BED.halfX - 0.02), BED_TOP + 0.06, z, woodDark));
  }
  // 손잡이 — 바닥 틀에서 앞으로 뻗는다
  for (const side of [-1, 1]) {
    const shaft = new THREE.BoxGeometry(0.05, 0.05, 1.5);
    shaft.rotateX(-0.08);
    shaft.translate(side * 0.3, BED_TOP - 0.02, 0.62);
    parts.push(paint(shaft, wood));
  }
  parts.push(box(0.64, 0.04, 0.04, 0, BED_TOP + 0.04, HANDLE_REACH - 0.08, woodDark));
  // 앞 받침다리 — 놓아두면 이걸로 선다
  for (const side of [-1, 1]) parts.push(box(0.04, BED_TOP, 0.04, side * 0.3, BED_TOP / 2 - 0.04, BED.halfZ - 0.04, woodDark));
  // 왼쪽 바퀴 — 오른쪽 바퀴는 따로 그린다(장막 바람에 빠져 날아간다)
  parts.push(buildWheelGeometry().translate(-WHEEL_X, AXLE_Y, 0));
  const axleY = AXLE_Y;
  const axle = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8);
  axle.rotateZ(Math.PI / 2);
  axle.translate(0, axleY, 0);
  parts.push(paint(axle, iron));
  return mergeGeometries(parts.map((p) => (p.attributes.normal ? p : (p.computeVertexNormals(), p))), false)!;
}

/** 바퀴 자국 두 줄 — 문에서 수레 처음 자리까지 땅에 붙인 띠 */
function buildRuts() {
  const positions: number[] = [];
  const indices: number[] = [];
  const points = new THREE.CatmullRomCurve3(RUT_PATH.map(([x, z]) => new THREE.Vector3(x, 0, z))).getPoints(60);
  for (const side of [-0.5, 0.5]) {
    const start = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length;
      const nz = dx / length;
      for (const w of [-0.06, 0.06]) {
        const x = points[i].x + nx * (side + w);
        const z = points[i].z + nz * (side + w);
        positions.push(x * M, (groundY(x, z) + 0.025) * M, z * M);
      }
      if (i > 0) {
        const k = start + i * 2;
        indices.push(k - 2, k, k - 1, k, k + 1, k - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: "#3B2E22",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

/** 궤 — 나무 함에 청동 띠. 뚜껑은 뒤 윗모서리를 축으로 뒤로 젖혀 열린다(몸통 위가 트여 있어 어디에도 안 걸린다). 안에 낡은 종이 */
const CHEST = { width: 0.48, depth: 0.32, wall: 0.025, lidThickness: 0.035 };
function buildChest() {
  const group = new THREE.Group();
  const { width: w, depth: d, wall: t } = CHEST;
  const bodyHeight = CHEST_HEIGHT - CHEST.lidThickness;
  const parts: THREE.BufferGeometry[] = [];
  const woodChest = "#6B4A2E";
  const woodChestDark = "#4A3220";
  const bronze = "#8C6B3A";
  // 바닥 · 네 벽(위는 트여 있다)
  parts.push(box(w, t, d, 0, t / 2, 0, woodChestDark));
  parts.push(box(w, bodyHeight, t, 0, bodyHeight / 2, -d / 2 + t / 2, woodChest));
  parts.push(box(w, bodyHeight, t, 0, bodyHeight / 2, d / 2 - t / 2, woodChest));
  parts.push(box(t, bodyHeight, d, -w / 2 + t / 2, bodyHeight / 2, 0, woodChest));
  parts.push(box(t, bodyHeight, d, w / 2 - t / 2, bodyHeight / 2, 0, woodChest));
  // 청동 띠 둘 · 모서리 쇠
  for (const x of [-w * 0.3, w * 0.3]) {
    parts.push(box(0.03, bodyHeight + 0.004, d + 0.006, x, bodyHeight / 2, 0, bronze));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.03, bodyHeight * 0.45, 0.03, sx * (w / 2 - 0.012), bodyHeight * 0.22, sz * (d / 2 - 0.012), bronze));
  // 받침 발
  for (const sx of [-1, 1]) parts.push(box(0.04, 0.012, d * 0.9, sx * (w / 2 - 0.035), -0.006, 0, woodChestDark));
  const body = new THREE.Mesh(mergeGeometries(parts.map((p) => (p.attributes.normal ? p : (p.computeVertexNormals(), p))), false)!, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT }));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // 뚜껑 — 경첩이 원점(뒤 윗모서리), 앞으로 뻗는다
  const lid = new THREE.Group();
  lid.position.set(0, bodyHeight, -d / 2);
  const lidParts: THREE.BufferGeometry[] = [box(w + 0.012, CHEST.lidThickness, d + 0.012, 0, CHEST.lidThickness / 2, d / 2, woodChest)];
  for (const x of [-w * 0.3, w * 0.3]) lidParts.push(box(0.03, 0.005, d + 0.016, x, CHEST.lidThickness + 0.002, d / 2, bronze));
  // 앞 걸쇠
  lidParts.push(box(0.03, 0.05, 0.006, 0, -0.012, d + 0.006, bronze));
  const lidMesh = new THREE.Mesh(mergeGeometries(lidParts.map((p) => (p.attributes.normal ? p : (p.computeVertexNormals(), p))), false)!, body.material);
  lidMesh.castShadow = true;
  lid.add(lidMesh);
  group.add(lid);
  // 낡은 종이 — 바닥에 비스듬히 놓여 있다
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.07, (w - 0.07) * (1024 / 1536)),
    new THREE.MeshToonMaterial({ map: makeOldPaperTexture(), gradientMap: TOON_GRADIENT, side: THREE.DoubleSide }),
  );
  paper.rotation.set(-Math.PI / 2, 0, 0.12);
  paper.position.set(0.01, t + 0.012, 0.01);
  group.add(paper);
  group.scale.setScalar(M);
  return { group, lid, paper };
}

function createRig() {
  const chest = buildChest();
  const cart = new THREE.Mesh(
    buildCartGeometry(),
    new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT }),
  );
  cart.castShadow = true;
  cart.receiveShadow = true;
  cart.scale.setScalar(M);
  const cartSolid: DynamicSolid = { x: 0, z: 0, yaw: 0, halfX: BED.halfX, halfZ: BED.halfZ, bottom: 0, top: 0, enabled: false };
  const chestSolid: DynamicSolid = { x: 0, z: 0, yaw: 0, halfX: 0.24, halfZ: 0.16, bottom: 0, top: 0, enabled: false };
  const wheel = new THREE.Mesh(buildWheelGeometry(), cart.material);
  wheel.castShadow = true;
  wheel.scale.setScalar(M);
  return {
    cart,
    wheel,
    wheelPosition: new THREE.Vector3(),
    chest: chest.group,
    chestLid: chest.lid,
    ruts: buildRuts(),
    cartSolid,
    chestSolid,
    /** 수레 자리(m) · 바라보는 쪽(rotation.y) */
    state: {
      x: CART_START.x,
      z: CART_START.z,
      yaw: CART_START.yaw,
      grabbed: false,
      chest: "ground" as "ground" | "carried" | "loading" | "cart" | "toAltar" | "altar" | "sucked",
      loadFromX: 0,
      loadFromZ: 0,
      loadFromY: 0,
      chestX: CHEST_START.x,
      chestZ: CHEST_START.z,
      chestYaw: CHEST_START.yaw,
      loadT: 0,
      lidT: 0,
      lidTold: false,
      toggledAt: -1e9,
      toldRuts: false,
      toldChest: false,
      /** 오른쪽 바퀴 — 붙어 있다 → 바람에 뜯겨 날아오른다 → 맴돈다 → 손에 들었다 → 다시 끼웠다 */
      wheel: "on" as "on" | "flying" | "floating" | "held" | "fitted",
      wheelT: 0,
    },
    interactPosition: new THREE.Vector3(),
    bedPosition: new THREE.Vector3(),
    chestPosition: new THREE.Vector3(),
    altarPosition: new THREE.Vector3(),
  };
}

const forward = new THREE.Vector3();
const local = new THREE.Vector3();

export default function RidgeCart() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => createRig(), []);
  const stage = useRidgeStage();
  const isActive = stage === "sealed";
  const activeRef = useRef(isActive);

  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    scene.add(rig.cart, rig.chest, rig.ruts, rig.wheel);
    const warm = window.setTimeout(() => prewarmShaders(gl, scene, camera, [rig.cart, rig.chest, rig.ruts, rig.wheel]), 3100);
    const removeCart = addDynamicSolid(rig.cartSolid);
    const removeChest = addDynamicSolid(rig.chestSolid);
    return () => {
      window.clearTimeout(warm);
      scene.remove(rig.cart, rig.chest, rig.ruts, rig.wheel);
      removeCart();
      removeChest();
    };
  }, [scene, rig, gl, camera]);

  // 누르고 있는 이동키 — 수레 방향을 틀 때 본다
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

  // E — 수레 잡기·놓기, 궤 싣기
  useEffect(() => {
    const s = rig.state;
    const toggleGrab = () => {
      const now = performance.now();
      if (now - s.toggledAt < TOGGLE_GUARD_MS) return;
      s.toggledAt = now;
      if (s.grabbed) {
        s.grabbed = false;
        return;
      }
      if (ridgeCarry.load === "jigeChest") {
        showNotice("궤를 진 채로는 수레를 밀 수 없다. 먼저 수레에 내려놓자.", 3);
        return;
      }
      if (s.wheel !== "on" && s.wheel !== "fitted") {
        showNotice("바퀴 하나가 빠져 수레가 기울어 있다. 빠진 바퀴는… 바람에 떠올라 머리 위에서 맴돌고 있다.", 4.5);
        return;
      }
      const foot = camera.position.y / M - 1.6;
      if (foot > groundY(camera.position.x / M, camera.position.z / M) + 0.3) {
        showNotice("수레 위에서는 수레를 밀 수 없다. 내려서 밀자.", 3);
        return;
      }
      s.grabbed = true;
      audio.play("똑");
      if (s.chest === "cart") showNotice("궤를 실은 수레가 묵직하게 구른다.", 2.5);
    };
    // 수레 어디를 겨눠도 E 로 바로 잡는다(궤를 지고 있으면 내려놓기가 먼저다)
    const removeCart = registerInteractable({
      id: "ridge-cart",
      position: rig.bedPosition,
      label: "수레 밀기",
      highlight: () => rig.cart,
      radius: 1.3 * M,
      reach: 3 * M,
      enabled: () => activeRef.current && !s.grabbed && s.wheel !== "held" && ridgeCarry.load !== "jigeChest",
      use: toggleGrab,
    });
    const removeWheel = registerInteractable({
      id: "ridge-wheel",
      position: rig.wheelPosition,
      label: "바퀴 붙잡기",
      radius: 0.6 * M,
      reach: 7 * M,
      enabled: () => activeRef.current && s.wheel === "floating",
      use: () => {
        if (camera.position.distanceTo(rig.wheelPosition) / M > WHEEL_REACH) {
          showNotice("손이 닿지 않는다. 몸이 가벼우니 바퀴 밑에서 힘껏 뛰어올라 붙잡자.", 3.5);
          return;
        }
        s.wheel = "held";
        audio.play("단서");
        showNotice("공중에서 바퀴를 붙잡았다! 수레에 끼우자.", 3.5);
      },
    });
    // 바퀴를 들었으면 수레 어디를 겨눠도 바로 끼운다 — 수레 전체가 빛난다
    const removeFit = registerInteractable({
      id: "ridge-cart-fit",
      position: rig.bedPosition,
      label: "바퀴 끼우기",
      highlight: () => rig.cart,
      radius: 1.5 * M,
      reach: 3.4 * M,
      enabled: () => activeRef.current && s.wheel === "held",
      use: () => {
        s.wheel = "fitted";
        audio.play("똑");
        showNotice("바퀴를 굴대에 끼웠다. 이제 수레가 구른다.", 3.5);
      },
    });
    // 궤 — 맨몸으로는 못 든다. 지게를 지고 와야 등에 얹는다
    const removeChest = registerInteractable({
      id: "ridge-chest",
      position: rig.chestPosition,
      label: "궤",
      radius: 0.5 * M,
      reach: 2.2 * M,
      enabled: () => activeRef.current && s.chest === "ground" && ridgeCarry.load !== "jige",
      use: () =>
        showNotice("궤가 너무 무거워 맨손으로는 들 수 없다. 등에 질 것이 있으면… 기둥에 묶인 지게가 떠오른다.", 4.5),
    });
    const removeChestOnBack = registerInteractable({
      id: "ridge-chest-jige",
      position: rig.chestPosition,
      label: "지게에 궤 얹기",
      radius: 0.5 * M,
      reach: 2.2 * M,
      enabled: () => activeRef.current && s.chest === "ground" && ridgeCarry.load === "jige",
      use: () => {
        s.chest = "carried";
        ridgeCarry.load = "jigeChest";
        audio.play("우르릉");
        showNotice("궤를 지게에 얹어 졌다. 묵직하다 — 수레에 내려놓자.", 4);
      },
    });
    const removeUnload = registerInteractable({
      id: "ridge-cart-unload",
      position: rig.bedPosition,
      label: "궤를 수레에 내려놓기",
      highlight: () => rig.cart,
      radius: 0.8 * M,
      reach: 2.4 * M,
      enabled: () => activeRef.current && s.chest === "carried" && !s.grabbed,
      use: () => {
        s.loadFromX = camera.position.x / M;
        s.loadFromZ = camera.position.z / M;
        s.loadFromY = camera.position.y / M - 1.0;
        s.chest = "loading";
        s.loadT = 0;
        // 빈 지게는 등에 남는다 — 빈손 [E] 로 내려놓는다(TetheredCarriers)
        ridgeCarry.load = "jige";
        audio.play("똑");
      },
    });
    // 돌단 — 수레를 곁에 대거나 지게에 지고 오면 궤를 올린다
    const removeAltar = registerInteractable({
      id: "ridge-altar",
      position: rig.altarPosition,
      label: "궤를 올릴 돌단",
      radius: 1.2 * M,
      reach: 4 * M,
      enabled: () => activeRef.current && s.chest !== "altar" && s.chest !== "toAltar",
      use: () => {
        const cartNear = s.chest === "cart" && Math.hypot(s.x - ALTAR.x, s.z - ALTAR.z) < ALTAR_REACH;
        if (!cartNear && s.chest !== "carried") {
          showNotice(
            s.chest === "cart"
              ? "수레를 돌단 곁까지 바짝 밀어 대자."
              : "두 장승 사이에 반듯한 돌단이 있다. 무언가 올려놓으라는 듯하다 — 무거운 궤가 꼭 맞겠다.",
            4,
          );
          return;
        }
        if (s.grabbed) s.grabbed = false;
        s.loadFromX = s.chestX;
        s.loadFromZ = s.chestZ;
        s.loadFromY = s.chest === "carried" ? camera.position.y / M - 1.05 : groundY(s.x, s.z) + BED_TOP;
        if (s.chest === "carried") ridgeCarry.load = "jige";
        s.chest = "toAltar";
        s.loadT = 0;
        audio.play("똑");
      },
    });
    exposeDevHook("najuRidgeCart", {
      state: () => ({ ...s }),
      /** 개발용 — 수레를 그 자리에 놓고 궤를 싣는다 */
      place: (x: number, z: number, yaw: number, withChest = true) => {
        Object.assign(s, { x, z, yaw, grabbed: false });
        if (withChest) s.chest = "cart";
      },
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyE" && !event.repeat && s.grabbed) toggleGrab();
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
  }, [rig, camera]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    const s = rig.state;
    const px = camera.position.x / M;
    const pz = camera.position.z / M;

    // 처음 다가갈 때 단서
    if (activeRef.current && !s.toldRuts && Math.hypot(px - s.x, pz - s.z) < 3) {
      s.toldRuts = true;
      showNotice("낡은 수레 한 대. 바퀴 자국이 진부촌 문에서 여기까지 이어져 있다 — 그날 밤 이 수레는 저 문으로 들어왔다.", 5);
    }
    if (activeRef.current && !s.toldChest && s.chest === "ground" && Math.hypot(px - s.chestX, pz - s.chestZ) < 2.2) {
      s.toldChest = true;
      showNotice("무거운 궤. 맨손으로는 들 수 없다 — 등에 질 것이 있으면 몰라도.", 4);
    }

    // 미는 중 — 수레는 바라보는 쪽으로 천천히 돈다(마우스로 돌리면 같이 돈다). 옆 키를 누르면 그쪽으로 더 틀고,
    //   뒤 키(S)만이면 방향을 그대로 둔 채 끌려 온다. 손잡이 끝은 발 앞, 수레는 그 앞으로
    if (s.grabbed) {
      if (!activeRef.current) s.grabbed = false;
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const forwardKey = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const side = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      let yaw = s.yaw;
      if (forwardKey >= 0) {
        // 시선 + 옆 키 — 오른쪽은 (−앞z, 앞x)
        const mx = forward.x - forward.z * side * 0.6;
        const mz = forward.z + forward.x * side * 0.6;
        let turn = Math.atan2(-mx, -mz) - s.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        yaw = s.yaw + THREE.MathUtils.clamp(turn, -TURN_RATE * dt, TURN_RATE * dt);
      }
      // 수레가 놓인 쪽(플레이어 → 수레)
      const pushX = -Math.sin(yaw);
      const pushZ = -Math.cos(yaw);
      const gripX = px + pushX * GRIP_AHEAD;
      const gripZ = pz + pushZ * GRIP_AHEAD;
      const nx = gripX - Math.sin(yaw) * HANDLE_REACH;
      const nz = gripZ - Math.cos(yaw) * HANDLE_REACH;
      const solid = solidQueries.current;
      const ground = groundY(nx, nz);
      const blocked = (x: number, z: number) => !!solid?.blockedAt(x, z, ground, 0.42);
      const ahead = { x: nx - Math.sin(yaw) * 0.4, z: nz - Math.cos(yaw) * 0.4 };
      const fits =
        isInsideCurtain(nx, nz, 0.9) && !blocked(nx, nz) && !blocked(ahead.x, ahead.z) && Math.abs(ground - groundY(s.x, s.z)) < 0.4;
      // 막힌 쪽으로는 그냥 안 나간다 — 손은 놓지 않는다
      if (fits) {
        s.x = nx;
        s.z = nz;
        s.yaw = yaw;
      }
    }

    // 궤 싣기 — 수레 위로 미끄러져 오른다
    const cartGround = groundY(s.x, s.z);
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const onCartX = s.x + CHEST_ON_CART.x * cos + CHEST_ON_CART.z * sin;
    const onCartZ = s.z - CHEST_ON_CART.x * sin + CHEST_ON_CART.z * cos;
    let chestY = groundY(s.chestX, s.chestZ);
    if (s.chest === "loading") {
      s.loadT = Math.min(1, s.loadT + dt / LOAD_SECONDS);
      const e = THREE.MathUtils.smootherstep(s.loadT, 0, 1);
      chestY = THREE.MathUtils.lerp(s.loadFromY, cartGround + BED_TOP, e) + Math.sin(e * Math.PI) * 0.25;
      rig.chest.position.set(
        THREE.MathUtils.lerp(s.loadFromX, onCartX, e) * M,
        chestY * M,
        THREE.MathUtils.lerp(s.loadFromZ, onCartZ, e) * M,
      );
      rig.chest.rotation.y = THREE.MathUtils.lerp(s.chestYaw, s.yaw, e);
      if (s.loadT >= 1) {
        s.chest = "cart";
        audio.play("우르릉");
        showNotice("궤를 수레에 실었다. 바퀴 자국이 난 진부촌 문 쪽 — 두 장승 사이 돌단으로 밀고 가자. (빈 지게는 빈손 [E] 로 내려놓는다)", 5);
      }
    } else if (s.chest === "sucked") {
      // 시공간 틈이 열리면 궤가 빨려 들어간다 — 돌며 작아지며 틈 가운데로
      s.loadT = Math.min(1, s.loadT + dt / SUCK_SECONDS);
      const e = THREE.MathUtils.smootherstep(s.loadT, 0, 1);
      const gateY = groundY(GATE.center.x, GATE.center.z) + 1.3;
      chestY = THREE.MathUtils.lerp(s.loadFromY, gateY, e) + Math.sin(e * Math.PI) * 0.4;
      s.chestX = THREE.MathUtils.lerp(s.loadFromX, GATE.center.x, e);
      s.chestZ = THREE.MathUtils.lerp(s.loadFromZ, GATE.center.z, e);
      rig.chest.position.set(s.chestX * M, chestY * M, s.chestZ * M);
      rig.chest.rotation.set(e * 6, s.chestYaw + e * 9, e * 3);
      rig.chest.scale.setScalar(M * Math.max(0.0001, 1 - e * e));
      rig.chest.visible = s.loadT < 1;
    } else if (s.chest === "toAltar" || s.chest === "altar") {
      const altarY = groundY(ALTAR.x, ALTAR.z) + ALTAR.top;
      const altarYaw = Math.atan2(RIDGE_CENTER.x - ALTAR.x, RIDGE_CENTER.z - ALTAR.z);
      // 틈이 열리면 빨려 든다
      if (s.chest === "altar" && ridge.stage() === "rift" && ridge.elapsed() > SUCK_AT) {
        s.chest = "sucked";
        s.loadT = 0;
        s.loadFromX = s.chestX;
        s.loadFromZ = s.chestZ;
        s.loadFromY = altarY;
        audio.play("전환");
        showNotice("열린 틈이 돌단의 궤를 빨아들인다 — 그날 밤의 것이 그날 밤으로 돌아간다.", 4.5);
      }
      if (s.chest === "toAltar") {
        s.loadT = Math.min(1, s.loadT + dt / (LOAD_SECONDS * 1.6));
        const e = THREE.MathUtils.smootherstep(s.loadT, 0, 1);
        chestY = THREE.MathUtils.lerp(s.loadFromY, altarY, e) + Math.sin(e * Math.PI) * 0.35;
        s.chestX = THREE.MathUtils.lerp(s.loadFromX, ALTAR.x, e);
        s.chestZ = THREE.MathUtils.lerp(s.loadFromZ, ALTAR.z, e);
        rig.chest.rotation.y = THREE.MathUtils.lerp(s.chestYaw, altarYaw, e);
        if (s.loadT >= 1) {
          s.chest = "altar";
          s.chestYaw = altarYaw;
          s.lidT = 0;
          audio.play("우르릉");
          ridgeQuest.set("chestOnAltar");
        }
      } else {
        chestY = altarY;
        s.chestX = ALTAR.x;
        s.chestZ = ALTAR.z;
        rig.chest.rotation.y = altarYaw;
        // 뚜껑이 삐걱 천천히 뒤로 젖혀진다 — 끝에서 살짝 되튀며 멈춘다
        s.lidT = Math.min(1, s.lidT + dt / LID_OPEN_SECONDS);
        const e = THREE.MathUtils.smootherstep(s.lidT, 0, 1);
        rig.chestLid.rotation.x = -LID_OPEN_ANGLE * e + Math.sin(s.lidT * Math.PI) * 0.06 * (1 - e);
        if (s.lidT >= 1 && !s.lidTold) {
          s.lidTold = true;
          audio.play("똑");
        }
      }
      rig.chest.position.set(s.chestX * M, chestY * M, s.chestZ * M);
    } else if (s.chest === "carried") {
      // 지게에 얹혀 등 뒤에 — 1인칭에서는 그림자와 고개를 돌릴 때 끝자락만 보인다
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      chestY = camera.position.y / M - 1.05;
      s.chestX = camera.position.x / M - forward.x * 0.42;
      s.chestZ = camera.position.z / M - forward.z * 0.42;
      s.chestYaw = Math.atan2(forward.x, forward.z);
      rig.chest.position.set(s.chestX * M, chestY * M, s.chestZ * M);
      rig.chest.rotation.y = s.chestYaw;
    } else if (s.chest === "cart") {
      s.chestX = onCartX;
      s.chestZ = onCartZ;
      s.chestYaw = s.yaw;
      chestY = cartGround + BED_TOP;
      rig.chest.position.set(onCartX * M, chestY * M, onCartZ * M);
      rig.chest.rotation.y = s.yaw;
    } else {
      rig.chest.position.set(s.chestX * M, chestY * M, s.chestZ * M);
      rig.chest.rotation.y = s.chestYaw;
    }

    // 오른쪽 바퀴 — 장막이 내려오면 뜯겨 날아올라 맴돌고, 붙잡으면 손에 들리고, 끼우면 제자리
    const wheelOn = s.wheel === "on" || s.wheel === "fitted";
    const hubX = s.x + WHEEL_X * cos;
    const hubZ = s.z - WHEEL_X * sin;
    if (s.wheel === "on" && ridge.stage() === "sealing" && ridge.elapsed() > 6.5) {
      s.wheel = "flying";
      s.wheelT = 0;
      audio.play("우르릉");
      showNotice("바람이 수레바퀴를 뜯어 하늘로 들어 올린다!", 3.5);
    }
    const orbitAngle = time * 0.35;
    const orbitX = WHEEL_ORBIT.x + Math.cos(orbitAngle) * WHEEL_ORBIT.radius;
    const orbitZ = WHEEL_ORBIT.z + Math.sin(orbitAngle) * WHEEL_ORBIT.radius;
    const orbitY = groundY(orbitX, orbitZ) + WHEEL_ORBIT.height + Math.sin(time * 1.1) * 0.25;
    if (wheelOn) {
      rig.wheel.position.set(hubX * M, (cartGround + AXLE_Y) * M, hubZ * M);
      rig.wheel.rotation.set(0, s.yaw, 0);
    } else if (s.wheel === "flying") {
      s.wheelT = Math.min(1, s.wheelT + dt / 2.2);
      const e = THREE.MathUtils.smootherstep(s.wheelT, 0, 1);
      rig.wheel.position.set(
        THREE.MathUtils.lerp(hubX, orbitX, e) * M,
        (THREE.MathUtils.lerp(cartGround + AXLE_Y, orbitY, e) + Math.sin(e * Math.PI) * 1.5) * M,
        THREE.MathUtils.lerp(hubZ, orbitZ, e) * M,
      );
      rig.wheel.rotation.set(time * 3, time * 2, 0);
      if (s.wheelT >= 1) s.wheel = "floating";
    } else if (s.wheel === "floating") {
      rig.wheel.position.set(orbitX * M, orbitY * M, orbitZ * M);
      rig.wheel.rotation.set(Math.sin(time * 0.7) * 0.5, time * 0.8, 0.3);
    } else {
      // 손에 들었다 — 화면 오른쪽 아래
      local.set(0.32, -0.42, -0.75).applyQuaternion(camera.quaternion);
      rig.wheel.position.copy(camera.position).addScaledVector(local, M);
      rig.wheel.quaternion.copy(camera.quaternion);
      rig.wheel.rotateY(Math.PI / 2);
    }
    rig.wheelPosition.copy(rig.wheel.position);

    rig.cart.position.set(s.x * M, (cartGround - (wheelOn ? 0 : 0.06)) * M, s.z * M);
    rig.cart.rotation.set(0, s.yaw, wheelOn ? 0 : LEAN, "YXZ");
    // 손잡이 끝 — 겨눌 자리
    local.set(0, BED_TOP + 0.05, HANDLE_REACH - 0.1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
    rig.interactPosition.set((s.x + local.x) * M, (cartGround + local.y) * M, (s.z + local.z) * M);
    rig.chestPosition.set(s.chestX * M, (chestY + CHEST_HEIGHT / 2) * M, s.chestZ * M);
    rig.bedPosition.set(s.x * M, (cartGround + BED_TOP + 0.1) * M, s.z * M);
    rig.altarPosition.set(ALTAR.x * M, (groundY(ALTAR.x, ALTAR.z) + ALTAR.top + 0.15) * M, ALTAR.z * M);

    // 밟고 서는 상자 — 미는 동안은 끈다(제 몸에 걸리지 않게)
    Object.assign(rig.cartSolid, { x: s.x, z: s.z, yaw: s.yaw, bottom: cartGround - 0.5, top: cartGround + BED_TOP, enabled: !s.grabbed });
    Object.assign(rig.chestSolid, {
      x: s.chestX,
      z: s.chestZ,
      yaw: s.chestYaw,
      bottom: chestY - 0.05,
      top: chestY + CHEST_HEIGHT,
      enabled: s.chest !== "loading" && s.chest !== "carried" && s.chest !== "toAltar" && s.chest !== "sucked" && !s.grabbed,
    });
  });

  return null;
}
