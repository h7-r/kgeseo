import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { Html, Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";

import { savedTrainPose } from "@/save/mainGameSave";
import { scaleColor } from "@/engine/color";
import { pickOutlineValues } from "@/engine/leva/savedControls";
import { PLAYER_RADIUS } from "@/engine/movement/constants";
import { useMovement } from "@/engine/movement/useMovement";
import { TOON_GRADIENT } from "@/engine/toon";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";

import {
  ATLAS_GRID,
  makeBrokenLampTexture,
  makeCrackTexture,
  makeDarkOutsideTexture,
  makeSeatFabricTexture,
} from "./atlasTextures";
import {
  CAR_CROUCH_EYE,
  CAR_EYE,
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  DOOR_X,
  DOOR_Z,
  WINDOW_BOTTOM,
  WINDOW_GLASS_COLOR,
  WINDOW_TOP,
} from "./dimensions";
import FluorescentLamp from "./FluorescentLamp";
import HologramScreen from "./HologramScreen";
import {
  buildGlass,
  buildPillars,
  buildPlanks,
  buildSeats,
  buildShelf,
  buildWindowFrames,
  computeLampSpots,
  computeSeatSpots,
  pickBoardedWindows,
  computeSeatColliders,
} from "./layout";
import { makeTrainFloorTexture, makeTrainWallTexture } from "./surfaceTextures";
import TeleportDevice from "./TeleportDevice";
import { useTrainInteriorControls } from "./useTrainInteriorControls";

const OUTSIDE_IMAGE_URL = "/textures/train-window-hq.jpg";
/** 들어온 문 안쪽 한 걸음 */
const START: [number, number | undefined, number] = [DOOR_X, undefined, DOOR_Z + 2.6];
/** 객차는 x 로 길다. 기본 시선(-z)이면 옆벽을 코앞에서 마주 본다. */
const START_FACING = -Math.PI / 2;
const EXIT_DISTANCE = 4.5;
/**
 * 문 폭 안에서 벽까지 이만큼 다가가면 걸어서 내린다. 사람이 벽에 붙는 끝은 1.0 이지만 비스듬히 걸으면 이동 경계가 어깨 몫(0.31,
 * useMovement SHOULDER_REACH)만큼 더 좁혀 1.31 까지 밀려난다 — 어느 각도로 와도 닿게 그보다 넉넉히(Codex 리뷰 64a8cc4)
 */
const AUTO_EXIT_DEPTH = 1.45;
/** 걸어서 내리기는 문 벽에서 이만큼 한 번 떨어진 뒤에만 — 들어온 자리(2.6) · 문 앞에 저장된 자리에서 곧바로 내리지 않게 */
const EXIT_ARM_DEPTH = 2.2;
/** 내리는 문 표시 색 — 튜토리얼 바닥 동그라미와 같은 색(같은 「여기로 가라」로 읽힌다) */
const EXIT_MARK_COLOR = "#86a6f0";
const SIDES = [-1, 1] as const;

const bounds = () => ({
  minX: -CAR_LENGTH / 2 + PLAYER_RADIUS + 0.4,
  maxX: CAR_LENGTH / 2 - PLAYER_RADIUS - 0.4,
  minZ: -CAR_WIDTH / 2 + PLAYER_RADIUS + 0.4,
  maxZ: CAR_WIDTH / 2 - PLAYER_RADIUS - 0.4,
});

interface TrainInteriorSceneProps {
  active: boolean;
  /** 지금 기차 씬인가. 역과 둘 다 마운트해 두고 보임만 바꾼다. */
  enabled?: boolean;
  onNear: (target: NearTarget) => void;
}

/** 버려진 객차 안(`/train`). 텔레포트 장치와 목적지 홀로그램이 있다. */
export default function TrainInteriorScene({ active, enabled = true, onNear }: TrainInteriorSceneProps) {
  const controls = useTrainInteriorControls();
  const outline = pickOutlineValues(controls);
  const outlineShell = outline.outline ? (
    <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />
  ) : null;
  const shade = (color: string) => scaleColor(color, controls.brightness);

  const wallTexture = makeTrainWallTexture(controls.wallSeed, controls.wallWear);
  const floorTexture = makeTrainFloorTexture(controls.floorSeed);
  const outsideMap = useMemo(() => {
    const texture = new THREE.TextureLoader().load(OUTSIDE_IMAGE_URL);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.RepeatWrapping; // 좌우 뒤집기(repeat.x = -1)용
    return texture;
  }, []);
  useEffect(() => () => outsideMap.dispose(), [outsideMap]);
  useEffect(() => {
    outsideMap.repeat.x = controls.flipOutside ? -1 : 1;
    outsideMap.offset.x = controls.flipOutside ? 1 : 0;
    outsideMap.needsUpdate = true;
  }, [outsideMap, controls.flipOutside]);
  const darkOutsideMap = useMemo(() => makeDarkOutsideTexture(), []);
  useEffect(() => () => darkOutsideMap.dispose(), [darkOutsideMap]);
  const seatFabricMap = useMemo(() => makeSeatFabricTexture(), []);
  useEffect(() => () => seatFabricMap.dispose(), [seatFabricMap]);
  const crackMap = useMemo(() => makeCrackTexture(), []);
  useEffect(() => () => crackMap.dispose(), [crackMap]);
  const brokenLampMap = useMemo(() => makeBrokenLampTexture(), []);
  useEffect(() => () => brokenLampMap.dispose(), [brokenLampMap]);

  // 한 장이 약 8 유닛(바닥은 6)을 덮게 반복해야 무늬가 늘어나거나 뭉개지지 않는다.
  const wallRepeat = useMemo(() => {
    const texture = wallTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(CAR_LENGTH / 8, CAR_HEIGHT / 8);
    texture.needsUpdate = true;
    return texture;
  }, [wallTexture]);
  const floorRepeat = useMemo(() => {
    const texture = floorTexture.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(CAR_LENGTH / 6, CAR_WIDTH / 6);
    texture.needsUpdate = true;
    return texture;
  }, [floorTexture]);
  useEffect(
    () => () => {
      wallRepeat.dispose();
      floorRepeat.dispose();
    },
    [wallRepeat, floorRepeat],
  );

  const lamps = useMemo(
    () =>
      computeLampSpots(
        controls.lampSeed,
        controls.lampCount,
        controls.deadLampRatio,
        controls.flickerLampRatio,
        controls.flickerPeriod,
      ),
    [controls.lampCount, controls.lampSeed, controls.deadLampRatio, controls.flickerLampRatio, controls.flickerPeriod],
  );

  const boardedWindows = useMemo(
    () => pickBoardedWindows(controls.windowSeed, controls.boardedWindowRatio),
    [controls.windowSeed, controls.boardedWindowRatio],
  );
  const windowFrames = useMemo(() => buildWindowFrames(), []);
  const pillars = useMemo(() => buildPillars(), []);
  const entranceGlass = useMemo(() => buildGlass(-1), []);
  const farGlass = useMemo(() => buildGlass(1), []);
  const planks = useMemo(
    () => buildPlanks(boardedWindows, controls.plankCount, controls.plankThickness, controls.windowSeed),
    [boardedWindows, controls.plankCount, controls.plankThickness, controls.windowSeed],
  );
  const shelf = useMemo(() => buildShelf(), []);

  const seatSpots = useMemo(
    () =>
      computeSeatSpots({
        groupCount: controls.seatGroupCount,
        groupSpacing: controls.groupSpacing,
        facingGap: controls.facingGap,
        start: controls.seatStart,
        wallGap: controls.seatWallGap,
      }),
    [controls.seatGroupCount, controls.groupSpacing, controls.facingGap, controls.seatStart, controls.seatWallGap],
  );
  const seats = useMemo(() => buildSeats(seatSpots, controls.seatScale), [seatSpots, controls.seatScale]);
  const seatBoxes = useMemo(() => computeSeatColliders(seatSpots, controls.seatScale), [seatSpots, controls.seatScale]);
  const isBlocked = useCallback(
    (x: number, z: number) =>
      seatBoxes.some(
        (c) =>
          x > c.minX - PLAYER_RADIUS &&
          x < c.maxX + PLAYER_RADIUS &&
          z > c.minZ - PLAYER_RADIUS &&
          z < c.maxZ + PLAYER_RADIUS,
      ),
    [seatBoxes],
  );

  const onNearRef = useRef(onNear);
  useLayoutEffect(() => {
    onNearRef.current = onNear;
  });
  // 들어온 그 문 앞에 오면 내리기 안내를 띄우고, 문 안으로 걸어 들어가면 내린다(탈 때와 같게 — 미르 플레이 시험 11/8)
  const exitArmed = useRef(false);
  useEffect(() => {
    if (enabled) exitArmed.current = false;
  }, [enabled]);
  const nearby = useCallback((p: THREE.Vector3) => {
    const distance = Math.hypot(p.x - DOOR_X, p.z - DOOR_Z);
    const fromWall = p.z - DOOR_Z;
    const alongDoor = Math.abs(p.x - DOOR_X);
    if (fromWall > EXIT_ARM_DEPTH || alongDoor > DOOR_WIDTH / 2) exitArmed.current = true;
    const inDoorway = alongDoor < DOOR_WIDTH / 2 - 0.4 && fromWall < AUTO_EXIT_DEPTH;
    const target =
      exitArmed.current && inDoorway
        ? NEAR_TARGET.trainExitDoor
        : distance < EXIT_DISTANCE
          ? NEAR_TARGET.trainExit
          : NEAR_TARGET.none;
    onNearRef.current(target);
    return target;
  }, []);

  useMovement(active, {
    enabled,
    bounds,
    isBlocked,
    nearby,
    start: savedTrainPose()?.position ?? START,
    facing: START_FACING,
    eyeHeight: CAR_EYE,
    crouchEyeHeight: CAR_CROUCH_EYE,
    // 3인칭 카메라가 지붕을 뚫지 않게 — 바닥을 내려다볼 때 특히
    ceiling: CAR_HEIGHT,
  });

  // userData.baseColor = 밝기를 곱하기 전 팀 색 — 만화 팔레트가 어느 물건인지 알아보는 표식(engine/manga/palette)
  const toon = (color: string) => (
    <meshToonMaterial color={shade(color)} gradientMap={TOON_GRADIENT} userData={{ baseColor: color }} />
  );
  const wallMaterial = (color: string) => (
    <meshToonMaterial
      map={wallRepeat}
      color={shade(color)}
      gradientMap={TOON_GRADIENT}
      userData={{ baseColor: color }}
    />
  );
  const glassMaterial = (
    <meshBasicMaterial
      color={WINDOW_GLASS_COLOR}
      transparent
      opacity={0.12}
      side={THREE.DoubleSide}
      depthWrite={false}
      toneMapped={false}
    />
  );

  return (
    <>
      {/* 배경·안개는 켜진 씬만 낸다(나중에 그린 쪽이 이긴다). 반드시 <group> 바깥 —
          attach 는 바로 위 부모에 꽂히고, 렌더러는 scene.background/fog 만 읽는다. */}
      {enabled && <color attach="background" args={["#0e1116"]} />}
      {enabled && <fog attach="fog" args={[controls.fogColor, controls.fogNear, controls.fogFar]} />}

      {/* 이름은 만화 팔레트가 구역을 찾는 표식(engine/manga) */}
      <group visible={enabled} name="trainInterior">
        <ambientLight intensity={controls.ambient * controls.brightness} color="#b9c4d4" />
        {/* 천장·바닥이 같은 톤이면 공간이 납작해 보인다 */}
        <hemisphereLight args={["#aab6c6", "#2f343b", 0.35 * controls.brightness]} />

        <TeleportDevice outline={outline} />
        <HologramScreen enabled={enabled} />

        {lamps.map((lamp, i) => (
          <FluorescentLamp
            key={`lamp${i}`}
            x={lamp.x}
            state={lamp.state}
            intensity={controls.ceilingLightIntensity * 70}
            color={controls.lampColor}
            offColor={controls.lampOffColor}
            brightness={controls.brightness}
            brokenMap={brokenLampMap}
            uvCell={[i % ATLAS_GRID, ((i / ATLAS_GRID) | 0) % ATLAS_GRID]}
          />
        ))}

        <mesh position={[0, -0.1, 0]} receiveShadow>
          <boxGeometry args={[CAR_LENGTH, 0.2, CAR_WIDTH]} />
          <meshToonMaterial
            map={floorRepeat}
            color={shade(controls.floorColor)}
            gradientMap={TOON_GRADIENT}
            userData={{ baseColor: controls.floorColor }}
          />
        </mesh>

        <mesh position={[0, CAR_HEIGHT + 0.1, 0]}>
          <boxGeometry args={[CAR_LENGTH, 0.2, CAR_WIDTH]} />
          {wallMaterial(controls.ceilingColor)}
        </mesh>

        {/* 옆벽 — 창 띠만 비운다. 창 아래를 한 톤 어둡게 해야 공간이 바닥에 붙어 안정된다. */}
        {SIDES.map((side) => (
          <group key={`wall${side}`}>
            <mesh position={[0, WINDOW_BOTTOM / 2, side * (CAR_WIDTH / 2 + 0.1)]} receiveShadow>
              <boxGeometry args={[CAR_LENGTH, WINDOW_BOTTOM, 0.2]} />
              {wallMaterial(controls.lowerWallColor)}
            </mesh>
            <mesh position={[0, (WINDOW_TOP + CAR_HEIGHT) / 2, side * (CAR_WIDTH / 2 + 0.1)]} receiveShadow>
              <boxGeometry args={[CAR_LENGTH, CAR_HEIGHT - WINDOW_TOP, 0.2]} />
              {wallMaterial(controls.bodyColor)}
            </mesh>
          </group>
        ))}

        <mesh geometry={pillars ?? undefined} receiveShadow>
          {wallMaterial(controls.bodyColor)}
        </mesh>

        {/* 창밖 배경판 — 조명과 무관하게 늘 같은 밝기. 기둥이 가려 창 자리에서만 보인다.
            입구(-z) 쪽만 본부실 파노라마, 반대편은 어둠. */}
        {controls.showOutside &&
          SIDES.map((side) => {
            const isEntranceSide = side === -1;
            return (
              <mesh
                key={`outside${side}`}
                position={[0, (WINDOW_TOP + WINDOW_BOTTOM) / 2, side * (CAR_WIDTH / 2 + 1.6)]}
                rotation={[0, side === 1 ? Math.PI : 0, 0]}
              >
                <planeGeometry args={[CAR_LENGTH + 6, WINDOW_TOP - WINDOW_BOTTOM + 2.4]} />
                <meshBasicMaterial
                  map={isEntranceSide ? outsideMap : darkOutsideMap}
                  color={scaleColor("#ffffff", isEntranceSide ? controls.outsideBrightness : 1)}
                  toneMapped={false}
                />
              </mesh>
            );
          })}

        {/* 아무것도 안 그린 맑은 유리막. 외곽선은 두르지 않는다 — 테두리가 생기면 판때기로 보인다. */}
        {entranceGlass && <mesh geometry={entranceGlass}>{glassMaterial}</mesh>}
        {farGlass && <mesh geometry={farGlass}>{glassMaterial}</mesh>}

        {planks && (
          <mesh geometry={planks} castShadow receiveShadow>
            {toon(controls.plankColor)}
            {outlineShell}
          </mesh>
        )}

        {/* 양 끝은 그냥 막힌 벽. 연결통로 문을 그렸더니 진짜 출입문처럼 보여 헷갈렸다. */}
        {SIDES.map((sx) => (
          <mesh key={`end${sx}`} position={[sx * (CAR_LENGTH / 2 + 0.1), CAR_HEIGHT / 2, 0]} receiveShadow>
            <boxGeometry args={[0.2, CAR_HEIGHT, CAR_WIDTH]} />
            {wallMaterial(controls.bodyColor)}
          </mesh>
        ))}

        {/* 출입문 — 실제 객차처럼 벽이 이어지다 그 구간만 뚫리고 얇은 마감선만 있다. 굵으면 실내 문틀로 보인다. */}
        <group position={[DOOR_X, 0, DOOR_Z]}>
          <ExitDoorMarker visible={enabled} />
          {SIDES.map((side) => (
            <mesh key={`edge${side}`} position={[side * (DOOR_WIDTH / 2 + 0.07), DOOR_HEIGHT / 2, 0.06]} castShadow>
              <boxGeometry args={[0.14, DOOR_HEIGHT, 0.34]} />
              {toon(controls.bodyColor)}
              {outlineShell}
            </mesh>
          ))}
          <mesh position={[0, DOOR_HEIGHT + 0.07, 0.06]} castShadow>
            <boxGeometry args={[DOOR_WIDTH + 0.28, 0.14, 0.34]} />
            {toon(controls.bodyColor)}
            {outlineShell}
          </mesh>

          {/* 문턱이 나가는 곳을 알려 준다 */}
          <mesh position={[0, 0.09, -0.05]} receiveShadow>
            <boxGeometry args={[DOOR_WIDTH, 0.18, 0.9]} />
            {toon(controls.doorColor)}
            {outlineShell}
          </mesh>

          {/* 문 밖을 캄캄하게 막는다. 뚫어 두면 객차 바깥의 빈 공간이 보인다. */}
          <mesh position={[0, DOOR_HEIGHT / 2, -0.55]}>
            <boxGeometry args={[DOOR_WIDTH - 0.1, DOOR_HEIGHT - 0.1, 0.2]} />
            <meshBasicMaterial color="#0a0d12" toneMapped={false} />
          </mesh>
        </group>

        <mesh geometry={windowFrames ?? undefined} castShadow receiveShadow>
          {toon(controls.windowFrameColor)}
          {outlineShell}
        </mesh>
        <mesh geometry={shelf ?? undefined} castShadow>
          {toon(controls.shelfColor)}
          {outlineShell}
        </mesh>
        {seats.fabric && (
          <mesh geometry={seats.fabric} castShadow receiveShadow>
            <meshToonMaterial
              map={seatFabricMap}
              color={shade(controls.seatFabricColor)}
              gradientMap={TOON_GRADIENT}
              userData={{ baseColor: controls.seatFabricColor }}
            />
            {outlineShell}
          </mesh>
        )}
        {seats.frame && (
          <mesh geometry={seats.frame} castShadow receiveShadow>
            <meshToonMaterial
              map={crackMap}
              color={shade(controls.seatFrameColor)}
              gradientMap={TOON_GRADIENT}
              userData={{ baseColor: controls.seatFrameColor }}
            />
            {outlineShell}
          </mesh>
        )}
        {seats.armrest && (
          <mesh geometry={seats.armrest} castShadow receiveShadow>
            {toon(controls.armrestColor)}
            {outlineShell}
          </mesh>
        )}
      </group>
    </>
  );
}

/**
 * 내리는 문 표시 — 문 앞 바닥에 튜토리얼 색 고리(천천히 깜빡) + 문 위 「내리는 문」 표지. 기차에 탄 뒤 내리는 법을 헤매거나
 * 내릴 수 없는 줄 아는 사람이 있었다(미르 플레이 시험 11/8, 튜토피드백 01회차). 출입문 그룹(문 벽 = z 0, 안쪽 = +z) 안에 둔다.
 */
function ExitDoorMarker({ visible }: { visible: boolean }) {
  const ringRef = useRef<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>(null);
  useFrame(({ clock }) => {
    const ring = ringRef.current;
    if (ring) ring.material.opacity = 0.45 + 0.3 * Math.sin(clock.elapsedTime * 2.4);
  });
  if (!visible) return null;
  return (
    <>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 1.5]}>
        <ringGeometry args={[0.95, 1.2, 48]} />
        <meshBasicMaterial color={EXIT_MARK_COLOR} transparent opacity={0.6} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* 화면 창(목적지 등)보다 아래에 깔리게 낮은 층 */}
      <Html position={[0, DOOR_HEIGHT - 0.6, 0.5]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div style={exitSignStyle}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>내리는 문</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>문으로 걸어 나가거나 [E]</div>
        </div>
      </Html>
    </>
  );
}

const exitSignStyle: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 12,
  border: `2px solid ${EXIT_MARK_COLOR}`,
  background: "rgba(5,11,26,0.82)",
  color: "#f1f1fc",
  textAlign: "center",
  whiteSpace: "nowrap",
  font: "14px/1.35 system-ui, sans-serif",
};
