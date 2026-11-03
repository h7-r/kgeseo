/**
 * 물레 고리문 — 큰 방 뒷벽 앞에 선 큰 돌바퀴. 얼굴에 고리 셋이 겹쳐 있고 고리마다 틈이 하나씩 있다. 틈 셋이 위 눈금에 모이면
 * 바퀴가 옆으로 굴러가고 뒤의 아치 통로가 드러난다.
 *   돌 물레(다이얼) — 넓적한 돌판에 뜬 돌 모양 홈 넷이 파여 있다. 뜬 돌 넷을 다 끼워야 돌아간다. [E] 를 꾹 누르면 한 눈금씩
 *   톱니돌 홈 셋 — 톱니돌을 끼운 고리만 물레를 따라 한 눈금씩 돈다. 빈손으로 [E] 하면 도로 뺀다
 *   숫자판은 하나 — 고리마다 틈에 화살이 있어 바깥 숫자를 가리킨다. 그 수만큼 물레를 돌리면 틈이 위(0)에 선다
 * 치수와 모양은 ringDoorShape, 비석 · 새김 그림은 ringDoorArt. 규칙·상태는 가까이 가면 안내판에 뜬다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { toRadians } from "@/engine/math";

import { audio } from "../../scene/immersion/audio";
import { focusCamera } from "../../scene/cameraFocus";
import { director } from "../../scene/immersion/director";
import { aimedId, registerInteractable, setKeyInterceptor, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { buildFloatStoneGeometry, buildGearStoneGeometry } from "../itemLooks";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import {
  DOOR,
  FLOOR_Y,
  WHEEL_DEPTH,
  WHEEL_RADIUS,
  registerCaveObstacles,
  setDoorOpen,
  stirSand,
  useCaveShown,
} from "./caveState";
import { buildHintStele, buildStele, makeDialFaceTexture, makeWheelFaceTexture } from "./ringDoorArt";
import { DialWheel, GearPost, Steles } from "./ringDoorParts";
import {
  DARK,
  DIAL,
  FLOAT_SLOTS,
  GAP_DEGREES,
  GEAR_POST,
  GEAR_Y,
  GLOW,
  LIGHT_X,
  LIGHT_Y,
  NOTCH_DEGREES,
  NOTCH_SECONDS,
  PANEL_RANGE,
  RATTLE_SECONDS,
  RIM_RADIUS,
  RING_COLOR,
  RING_LIT,
  RINGS,
  ROLL,
  ROLL_SECONDS,
  TABLET,
  WHEEL_CENTER,
  buildDialStone,
  buildGearSocketGeometry,
  buildRing,
  notchesLeft,
  wrapDegrees,
} from "./ringDoorShape";

const FLOAT_SLOT_NAMES = ["위", "오른쪽", "아래", "왼쪽"];

function createDoorAssets() {
  const wheelFaceTexture = makeWheelFaceTexture();
  const dialFaceTexture = makeDialFaceTexture();
  return {
    rings: RINGS.map((ring) => buildRing(ring.radius, ring.tube)),
    // 고리 — 밝은 맨 돌
    ringMaterials: RINGS.map(() => makeToonMaterial(RING_COLOR, { vertexColors: true, emissive: DARK.clone() })),
    wheelFaceTexture,
    dialFaceTexture,
    stele: buildStele(),
    hintStele: buildHintStele(),
    gearSocket: buildGearSocketGeometry(),
    dialStone: buildDialStone(),
    floatGeometry: buildFloatStoneGeometry(),
    gearGeometry: buildGearStoneGeometry(),
    materials: {
      wheelFace: makeToonMaterial("#FFFFFF", {
        map: wheelFaceTexture,
        emissive: DARK.clone(),
        emissiveMap: wheelFaceTexture,
      }),
      cap: makeToonMaterial(RING_COLOR),
      // 톱니 홈 옆 번호 점 — 돌에 얕게 박힌 옅은 돌알
      dot: makeToonMaterial("#7C8480"),
      frame: makeToonMaterial("#5B6360"),
      wheel: makeToonMaterial("#666E6A"),
      dial: makeToonMaterial("#6D7169"),
      spoke: makeToonMaterial("#6B4E33"),
      rope: makeToonMaterial("#8A7A58"),
      dialFace: makeToonMaterial("#FFFFFF", { map: dialFaceTexture }),
      post: makeToonMaterial("#4C5552"),
      hollow: makeToonMaterial("#1A2022"),
      floatStone: makeToonMaterial("#E2DCCD"),
      gearStone: makeToonMaterial("#6A6E68"),
    },
  };
}

function disposeDoorAssets(assets: ReturnType<typeof createDoorAssets>) {
  for (const stele of [assets.stele, assets.hintStele]) {
    stele.geometry.dispose();
    stele.texture.dispose();
    stele.textMaterial.dispose();
    stele.sideMaterial.dispose();
  }
  [
    ...assets.rings,
    assets.gearSocket.plate,
    assets.gearSocket.floor,
    assets.dialStone,
    assets.floatGeometry,
    assets.gearGeometry,
  ].forEach((geometry) => geometry.dispose());
  [...assets.ringMaterials, ...Object.values(assets.materials)].forEach((material) => material.dispose());
  assets.wheelFaceTexture.dispose();
  assets.dialFaceTexture.dispose();
}

/** 안내판 그림 — 사람이 보는 대로(문을 마주 보고). 틈은 위 눈금에서 왼쪽으로 angle 만큼 */
function RingDiagram({ angles, engaged }: { angles: number[]; engaged: boolean[] }) {
  const radii = [40, 31, 22];
  const widths = [7, 6, 5];
  const arc = (r: number, angle: number) => {
    const from = toRadians(-angle + GAP_DEGREES / 2);
    const to = toRadians(-angle + GAP_DEGREES / 2 + 360 - GAP_DEGREES);
    const point = (a: number) => `${(50 + r * Math.sin(a)).toFixed(2)} ${(50 - r * Math.cos(a)).toFixed(2)}`;
    return `M ${point(from)} A ${r} ${r} 0 1 1 ${point(to)}`;
  };
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,2 46,9 54,9" fill="#F2EAC8" />
      {RINGS.map((_, k) => {
        const isAligned = wrapDegrees(angles[k]) === 0;
        return (
          <path
            key={k}
            d={arc(radii[k], angles[k])}
            fill="none"
            stroke={isAligned ? "#F2E3B8" : engaged[k] ? "#D8DED9" : "#5A6664"}
            strokeWidth={widths[k]}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx="50" cy="50" r="12" fill="#3B4542" />
    </svg>
  );
}

export default function RingDoor() {
  const isShown = useCaveShown();
  const { camera } = useThree();
  const [floats, setFloats] = useState<boolean[]>(() => Array(FLOAT_SLOTS).fill(false));
  const [gears, setGears] = useState<boolean[]>([false, false, false]);
  const [isOpen, setIsOpen] = useState(false);
  /** 안내판에 적는 각 — 눈금이 넘어갈 때만 바뀐다 */
  const [shownAngles, setShownAngles] = useState(() => RINGS.map((ring) => ring.start));
  // 가로채기·회전은 매 프레임 최신 끼움 상태를 봐야 해서 ref 에 비춰 둔다
  const floatsRef = useRef(floats);
  const gearsRef = useRef(gears);
  useLayoutEffect(() => {
    floatsRef.current = floats;
    gearsRef.current = gears;
  }, [floats, gears]);
  const angles = useRef(RINGS.map((ring) => ring.start));
  const dialAngle = useRef(0);
  const shownDial = useRef(0);
  const isHolding = useRef(false);
  const holdTime = useRef(0);
  const aligned = useRef([false, false, false]);
  const openedAt = useRef(-1);
  const wobble = useRef(0);

  const assets = useMemo(() => createDoorAssets(), []);
  useEffect(() => () => disposeDoorAssets(assets), [assets]);

  const ringMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const capMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const dialGroup = useRef<THREE.Group>(null);
  const tabletGroup = useRef<THREE.Group>(null);
  const wheelGroup = useRef<THREE.Group>(null);
  /** 화면 고정이 매 프레임 읽는 바퀴 자리(유닛) */
  const wheelSpot = useMemo(() => new THREE.Vector3(), []);

  // 겨누는 자리(유닛) — 다이얼 홈 넷은 돌판과 같이 돌지만 판정은 처음 자리로 넉넉히 잡는다
  const spots = useMemo(() => {
    const dialFront = (DIAL.z - DIAL.depth / 2) * M;
    return {
      floats: Array.from({ length: FLOAT_SLOTS }, (_, k) => {
        const a = (k * Math.PI) / 2;
        return new THREE.Vector3(
          (DIAL.x + Math.sin(a) * DIAL.socketRadius) * M,
          (DIAL.y + Math.cos(a) * DIAL.socketRadius) * M,
          dialFront,
        );
      }),
      dial: new THREE.Vector3(DIAL.x * M, DIAL.y * M, dialFront),
      // 물레 둘레 — 어디를 겨눠도 잡고 돌릴 수 있게 둘레를 따라 여럿
      rim: Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return new THREE.Vector3(
          (DIAL.x + Math.cos(a) * (DIAL.radius - 0.05)) * M,
          (DIAL.y + Math.sin(a) * (DIAL.radius - 0.05)) * M,
          dialFront,
        );
      }),
      gears: GEAR_Y.map((y) => new THREE.Vector3(GEAR_POST.x * M, y * M, (GEAR_POST.z - 0.15) * M)),
      tablet: new THREE.Vector3(TABLET.x * M, TABLET.y * M, TABLET.z * M),
      door: new THREE.Vector3(WHEEL_CENTER.x * M, WHEEL_CENTER.y * M, WHEEL_CENTER.z * M),
    };
  }, []);

  const insertFloat = (k: number) => {
    if (floatsRef.current[k]) return;
    setFloats((previous) => previous.map((filled, i) => (i === k ? true : filled)));
    audio.play("똑");
    const count = floatsRef.current.filter(Boolean).length + 1;
    if (count === FLOAT_SLOTS) showNotice("뜬 돌 넷이 홈에 꼭 맞게 들어갔다. 물레가 묵직하게 걸린다.", 4);
  };
  const insertGear = (k: number) => {
    if (gearsRef.current[k]) return;
    setGears((previous) => previous.map((filled, i) => (i === k ? true : filled)));
    audio.play("단서");
    showNotice(`${RINGS[k].name}가 물레에 물렸다. 이제 물레를 돌리면 같이 돈다.`, 3.5);
  };
  const removeGear = (k: number) => {
    if (!gearsRef.current[k]) return;
    if (!inventory.add("gearStone")) {
      showNotice("소지품이 가득 찼다.");
      return;
    }
    setGears((previous) => previous.map((filled, i) => (i === k ? false : filled)));
    audio.play("똑");
    showNotice(`${RINGS[k].name}에서 톱니돌을 뺐다. 그 고리는 지금 자리에 멈춘다.`, 3);
  };
  /** 다이얼을 눈금만큼 돌린다 — 물린 고리가 제 비율로 따라 돈다 */
  const turn = (notches: number) => {
    dialAngle.current += NOTCH_DEGREES * notches;
    RINGS.forEach((ring, k) => {
      if (gearsRef.current[k]) angles.current[k] += ring.perNotch * notches;
    });
    setShownAngles([...angles.current]);
    audio.play("똑");
  };

  useEffect(() => {
    if (!isShown) return undefined;
    const disposers = [
      ...spots.floats.map((spot, k) =>
        registerInteractable({
          id: `cave-float-${k}`,
          position: spot,
          label: `물레 ${FLOAT_SLOT_NAMES[k]} 홈 — 뜬 돌 모양으로 파여 있다`,
          radius: 0.2 * M,
          reach: 2.8 * M,
          // 한 번 끼운 뜬 돌은 꽉 물려 빠지지 않는다 — 끼운 홈은 겨눠지지 않고, 그 자리 [E] 는 물레 돌리기로 넘어간다
          enabled: () => !isOpen && !floats[k],
          use: () =>
            showNotice(
              "뜬 돌이 꼭 맞을 홈이다. 뜬 돌을 가지고 있으면 [E] 로 바로 끼울 수 있다. 한 번 끼우면 빠지지 않는다.",
              3.5,
            ),
          handLabel: (kind) => (kind === "floatStone" && !floats[k] ? "뜬 돌 끼우기" : null),
          receive: () => insertFloat(k),
        }),
      ),
      // 물레 돌리기는 [E] 를 누르고 있는 동안 가로채기가 맡는다 — use 는 비워 둔다
      registerInteractable({
        id: "cave-valve",
        position: spots.dial,
        label: "물레 돌리기 (E 꾹)",
        highlight: () => dialGroup.current,
        // 뜬 돌을 다 끼우면 홈이 겨눠지지 않으니 물레 앞면 어디를 겨눠도 돌린다. 그 전엔 가운데만(홈과 겹치지 않게)
        radius: (floats.filter(Boolean).length >= FLOAT_SLOTS ? DIAL.radius : 0.24) * M,
        reach: 2.8 * M,
        enabled: () => !isOpen,
        use: () => {},
      }),
      ...spots.rim.map((spot, i) =>
        registerInteractable({
          id: `cave-valve-rim-${i}`,
          position: spot,
          label: "물레 돌리기 (E 꾹)",
          highlight: () => dialGroup.current,
          radius: 0.22 * M,
          reach: 2.8 * M,
          enabled: () => !isOpen,
          use: () => {},
        }),
      ),
      ...spots.gears.map((spot, k) =>
        registerInteractable({
          id: `cave-gear-${k}`,
          position: spot,
          label: gears[k] ? `${RINGS[k].name} 홈 — 톱니돌 빼기` : `${RINGS[k].name} 홈 — 비었음`,
          radius: 0.2 * M,
          reach: 2.8 * M,
          enabled: () => !isOpen,
          use: () =>
            gears[k]
              ? removeGear(k)
              : showNotice("톱니돌이 들어갈 홈이다. 큰 방 세 곳(독 · 조개밭 · 숨구멍)에서 톱니돌을 찾을 수 있다.", 4),
          handLabel: (kind) => (kind === "gearStone" && !gears[k] ? "톱니돌 끼우기" : null),
          receive: () => insertGear(k),
        }),
      ),
      registerInteractable({
        id: "cave-tablet",
        position: spots.tablet,
        label: "비석 읽기",
        highlight: () => tabletGroup.current,
        radius: 0.4 * M,
        reach: 3 * M,
        use: () => showNotice("비석에 수수께끼가 새겨져 있다 — 「갈라진 입」은 무엇이고 「하늘」은 어디일까.", 6),
      }),
      registerInteractable({
        id: "cave-door",
        position: spots.door,
        label: isOpen ? "열린 고리문" : "고리문 살펴보기",
        radius: 1.1 * M,
        reach: 5 * M,
        enabled: () => !isOpen,
        use: () =>
          showNotice(
            "큰 돌바퀴 얼굴에 붉은 고리 셋이 겹쳐 있고, 고리마다 갈라진 틈이 하나씩 있다. 오른쪽에 비석 둘과 돌 물레, 톱니돌 홈이 있다.",
            6,
          ),
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [isShown, floats, gears, isOpen, spots]);

  // 몸이 뚫고 지나가지 않게 — 비석 둘 · 물레 굴대 · 톱니돌 기둥
  useEffect(() => {
    if (!isShown) return undefined;
    return registerCaveObstacles([
      { x: TABLET.x, z: TABLET.z - 0.08, radius: 0.55, top: FLOOR_Y + 1.72, name: "비석" },
      { x: TABLET.x + 0.92, z: TABLET.z - 0.42, radius: 0.36, top: FLOOR_Y + 0.97, name: "비석" },
      { x: DIAL.x, z: DIAL.z + 0.1, radius: 0.32, top: DIAL.y + DIAL.radius, name: "물레" },
      { x: GEAR_POST.x, z: GEAR_POST.z + 0.05, radius: 0.3, top: FLOOR_Y + 2.3, name: "돌기둥" },
    ]);
  }, [isShown]);

  // 다이얼은 [E] 를 꾹 누르는 동안 돈다 — keydown 을 가로채고 keyup 에서 놓는다
  useEffect(() => {
    if (!isShown) return undefined;
    setKeyInterceptor(() => {
      if (!aimedId()?.startsWith("cave-valve") || inventory.hand()) return false;
      const filled = floatsRef.current.filter(Boolean).length;
      if (filled < FLOAT_SLOTS) {
        showNotice(`물레가 헛돈다 — 뜬 돌 넷을 가운데 홈에 다 끼워야 걸린다. (지금 ${filled}/${FLOAT_SLOTS})`, 3.5);
        wobble.current = 1;
        return true;
      }
      if (!gearsRef.current.some(Boolean)) showNotice("물린 고리가 없다 — 물레만 돈다. 톱니돌을 홈에 끼우자.", 3);
      isHolding.current = true;
      holdTime.current = NOTCH_SECONDS; // 누르자마자 한 눈금
      return true;
    });
    const release = (event: KeyboardEvent) => {
      if (event.code === "KeyE") isHolding.current = false;
    };
    const blur = () => {
      isHolding.current = false;
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    return () => {
      setKeyInterceptor(null);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, [isShown]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuDoorDev", {
      insertFloat: (k: number) => {
        if (inventory.consume("floatStone")) insertFloat(k);
      },
      fillValve: () => {
        for (let k = 0; k < FLOAT_SLOTS; k++) if (inventory.consume("floatStone")) insertFloat(k);
      },
      insertGear: (k: number) => {
        if (inventory.consume("gearStone")) insertGear(k);
      },
      removeGear,
      turn: (notches: number) => turn(notches),
      angles: () => angles.current.map(wrapDegrees),
      left: () => RINGS.map((ring, k) => notchesLeft(angles.current[k], ring.perNotch)),
      filled: () => ({ floats: floatsRef.current, gears: gearsRef.current }),
      isOpen: () => openedAt.current >= 0,
    });
  }, []);

  useEffect(() => () => setPuzzlePanel("cave-door", null), []);

  useFrame((_, dt) => {
    if (!isShown) return;
    const time = performance.now() / 1000;
    if (isHolding.current && openedAt.current < 0) {
      if (!document.pointerLockElement) isHolding.current = false;
      else {
        holdTime.current += dt;
        while (holdTime.current >= NOTCH_SECONDS) {
          holdTime.current -= NOTCH_SECONDS;
          turn(1);
        }
      }
    }
    wobble.current = Math.max(0, wobble.current - dt * 3);
    const shake = Math.sin(time * 40) * wobble.current * 0.04;
    // 고리 · 틈 끝 구슬 · 빛
    let alignedCount = 0;
    RINGS.forEach((ring, k) => {
      const angle = angles.current[k];
      const mesh = ringMeshes.current[k];
      if (mesh) mesh.rotation.z += (-toRadians(angle) + shake - mesh.rotation.z) * Math.min(1, dt * 9);
      const isAligned = wrapDegrees(angle) === 0;
      if (isAligned && !aligned.current[k]) audio.play("단서");
      aligned.current[k] = isAligned;
      if (isAligned) alignedCount++;
      assets.ringMaterials[k].emissive.lerp(isAligned ? RING_LIT : DARK, Math.min(1, dt * 4));
      const shown = mesh ? -mesh.rotation.z : toRadians(angle);
      for (let end = 0; end < 2; end++) {
        const cap = capMeshes.current[k * 2 + end];
        if (!cap) continue;
        const a = Math.PI / 2 + (end === 0 ? -1 : 1) * (toRadians(GAP_DEGREES) / 2) - shown;
        cap.position.set(Math.cos(a) * ring.radius, Math.sin(a) * ring.radius, 0);
      }
    });
    // 바퀴 얼굴 새김 — 다 맞으면 새긴 홈마다 따뜻한 흰빛이 스민다
    const faceGlow = alignedCount === RINGS.length ? 0.35 + 0.05 * Math.sin(time * 4) : 0;
    assets.materials.wheelFace.emissive.lerp(GLOW.clone().multiplyScalar(faceGlow), Math.min(1, dt * 5));
    if (alignedCount === RINGS.length && openedAt.current < 0) {
      openedAt.current = time;
      isHolding.current = false;
      setIsOpen(true);
      // 바퀴가 다 굴러간 뒤에야 지나갈 수 있다
      window.setTimeout(() => setDoorOpen(true), (RATTLE_SECONDS + ROLL_SECONDS * 0.8) * 1000);
      // 물속이 쿵 울린다 — 처음 덜컹에 크게, 구르는 동안은 매 프레임 잔떨림
      director.cue({ 카메라: "흔들림", 세기: 0.9 });
      stirSand(0.9);
      focusCamera({
        id: "ring-door-open",
        target: () => wheelGroup.current?.getWorldPosition(wheelSpot) ?? wheelSpot,
        hold: RATTLE_SECONDS + 1.4,
        turnIn: 0.6,
        turnOut: 0.6,
        zoom: 0.9,
      });
      audio.play("우르릉");
      audio.play("징");
      showNotice("틈 셋이 한 줄로 섰다. 돌바퀴가 무겁게 굴러간다 — 석실로 가는 길이 열렸다.", 5);
    }
    shownDial.current += (dialAngle.current - shownDial.current) * Math.min(1, dt * 9);
    if (dialGroup.current) dialGroup.current.rotation.z = -toRadians(shownDial.current) + shake * 2;
    // 열리면 바퀴가 통째로 왼쪽(+x)으로 굴러간다 — 구른 만큼 돈다(미끄러지지 않게)
    if (wheelGroup.current && openedAt.current >= 0) {
      const since = time - openedAt.current;
      // 먼저 제자리에서 덜컹덜컹 떨고, 그 뒤 구른다. 구르는 동안 바닥이 울려 화면이 잘게 흔들린다
      const rattle = since < RATTLE_SECONDS ? (1 - since / RATTLE_SECONDS) * 0.5 + 0.5 : 0;
      if (since < RATTLE_SECONDS + ROLL_SECONDS) {
        director.cue({ 카메라: "흔들림", 세기: dt * (rattle > 0 ? 2.2 : 1.1) });
        stirSand(dt * 0.45);
      }
      const t = THREE.MathUtils.smootherstep((since - RATTLE_SECONDS) / ROLL_SECONDS, 0, 1);
      const rolled = ROLL * t;
      // 덜컹 — 바퀴가 제자리에서 좌우로 떨고 들썩인다
      const jolt = rattle * (Math.sin(time * 47) * 0.025 + Math.sin(time * 31) * 0.015);
      wheelGroup.current.position.x = WHEEL_CENTER.x + rolled + jolt;
      wheelGroup.current.position.y = WHEEL_CENTER.y + Math.abs(Math.sin(time * 23)) * rattle * 0.03;
      wheelGroup.current.rotation.z = -rolled / WHEEL_RADIUS + jolt * 0.6;
    }
    // 안내판
    const distance = Math.hypot(camera.position.x / M - WHEEL_CENTER.x, camera.position.z / M - WHEEL_CENTER.z);
    if (distance > PANEL_RANGE || isOpen) setPuzzlePanel("cave-door", null);
    else {
      const filled = floatsRef.current.filter(Boolean).length;
      setPuzzlePanel("cave-door", {
        distance,
        title: "물레 고리문",
        rule: "여는 법은 큰 비석에 수수께끼로 새겨져 있다. 검게 지워진 말은 왼쪽 작은 비석의 초성과 뜻풀이로 채운다.\n물레는 둘레를 겨눠 [E] 를 꾹, 톱니돌은 빈손 [E] 로 도로 뺀다.",
        diagram: <RingDiagram angles={shownAngles} engaged={gearsRef.current} />,
        rows: [
          { label: "물레", value: `뜬 돌 ${filled}/${FLOAT_SLOTS}`, ok: filled === FLOAT_SLOTS },
          ...RINGS.map((ring, k) => {
            const left = notchesLeft(shownAngles[k], ring.perNotch);
            // 돌릴 수는 알려 주지 않는다 — 비석을 풀어 바퀴의 숫자를 읽어야 한다
            return {
              label: ring.name,
              value: `${gearsRef.current[k] ? "물림" : "비었음"}${left === 0 ? " · 하늘을 본다" : ""}`,
              ok: left === 0,
            };
          }),
        ],
      });
    }
  });

  if (!isShown) return null;
  const { materials } = assets;
  return (
    <group scale={M}>
      {/* 돌바퀴 — 단 위에 서 있다. 얼굴(−z)에 고리·숫자판·허브. 풀리면 통째로 굴러간다 */}
      <group ref={wheelGroup} position={[WHEEL_CENTER.x, WHEEL_CENTER.y, WHEEL_CENTER.z]}>
        <mesh material={materials.wheel} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_DEPTH, 72]} />
        </mesh>
        {/* 둘레 돌테 */}
        <mesh material={materials.frame} position={[0, 0, -WHEEL_DEPTH / 2 + 0.02]}>
          <torusGeometry args={[RIM_RADIUS, 0.11, 10, 72]} />
        </mesh>
        {/* 바퀴 얼굴 — 숫자 · 눈금 · 고리 홈 · 가운데 물고기 한 쌍을 돌에 새긴 한 장 */}
        <mesh material={materials.wheelFace} position={[0, 0, -WHEEL_DEPTH / 2 - 0.006]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[RIM_RADIUS - 0.06, 96]} />
        </mesh>
        {/* 고리 셋 — 얼굴에서 조금 나와 있다 */}
        {RINGS.map((_, k) => (
          <group key={k} position={[0, 0, -WHEEL_DEPTH / 2]}>
            <mesh
              ref={(mesh) => {
                ringMeshes.current[k] = mesh;
              }}
              geometry={assets.rings[k]}
              material={assets.ringMaterials[k]}
              castShadow
            />
          </group>
        ))}
        {/* 틈 끝 구슬 — 틈이 어디 있는지 멀리서도 읽힌다 */}
        <group position={[0, 0, -WHEEL_DEPTH / 2]}>
          {RINGS.map((_, k) =>
            [0, 1].map((end) => (
              <mesh
                key={`${k}-${end}`}
                ref={(mesh) => {
                  capMeshes.current[k * 2 + end] = mesh;
                }}
                material={materials.cap}
              >
                <sphereGeometry args={[0.055, 10, 8]} />
              </mesh>
            )),
          )}
        </group>
      </group>
      <DialWheel assets={assets} floats={floats} dialRef={dialGroup} />
      <GearPost assets={assets} gears={gears} />
      <Steles assets={assets} tabletRef={tabletGroup} />
      {/* 문 앞 은은한 빛 — 등불 모형 없이 빛만 */}
      {LIGHT_X.map((x) => (
        <pointLight
          key={x}
          color="#FFE6C4"
          intensity={0.9}
          distance={7 * M}
          decay={1.6}
          position={[x, LIGHT_Y, DOOR.z - 1.2]}
        />
      ))}
    </group>
  );
}
