import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { ToonOutline } from "@/engine/outline";
import { requestShadowUpdates } from "@/engine/rendering";
import type { OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { Highlight } from "@/lobby/Highlight";
import {
  lockControl,
  seedLock,
  startLockControl,
  useLock,
  useLockControl,
  type LockSubmitter,
} from "@/props/combinationLock";
import { rattleOffset } from "@/props/hingeState";
import ToonMaterial from "@/props/shared/ToonMaterial";
import { worldPositionOf } from "@/props/shared/worldPosition";

import LatchPlate, { type LatchSettings } from "./LatchPlate";
import LockCloseUpCamera from "./LockCloseUpCamera";
import { OPENING_MOTION, openingPose, openingPosition } from "./openingMotion";
import {
  bodyGeometry,
  computeBevel,
  computeLobeWidth,
  dialBandGeometry,
  dialBandTexture,
  dialCoreGeometry,
  dialDividerGeometry,
  dialSlotAngle,
  makeRowGlyphs,
  markerGeometry,
  shackleGeometry,
} from "./padlockGeometry";

interface DialProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  x: number;
  slot: number;
  slotCount: number;
  speed?: number;
}

/** 다이얼 한 칸. 칸이 바뀌면 가장 가까운 쪽으로 돈다(9 → 0 에서 한 바퀴 거꾸로 돌면 안 된다). */
function Dial({ geometry, material, x, slot, slotCount, speed = 10 }: DialProps) {
  const groupRef = useRef<THREE.Group>(null);
  const angle = useRef(dialSlotAngle(slot, slotCount));
  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group) return;
    const target = dialSlotAngle(slot, slotCount);
    const turn = Math.PI * 2;
    let diff = target - angle.current;
    diff = (((diff % turn) + turn * 1.5) % turn) - turn / 2;
    angle.current += diff * (1 - Math.exp(-dt * speed));
    group.rotation.x = angle.current;
  });
  return (
    <group ref={groupRef} position={[x, 0, 0]}>
      <mesh geometry={geometry} material={material} castShadow />
    </group>
  );
}

const DEFAULT_DIGITS = [0, 0, 0, 0, 0];

export interface CombinationPadlockProps {
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  /** 전체 크기 배수. 아래 치수들은 모양의 비율이고 실제 크기는 이 값 하나로 정한다. */
  size?: number;
  /** 크기 1 일 때 실척 4.7cm */
  width?: number;
  /** 폭의 0.43 — 원본은 이만큼 납작하다 */
  height?: number;
  /** 높이보다 조금 얇아 다이얼이 앞뒤로 살짝 나온다 */
  depth?: number;
  /** 다리가 좌우 덩이 위에 내려앉아야 한다 */
  shackleRadius?: number;
  shackleThickness?: number;
  /** 몸통 위로 올라간 정도 */
  shackleHeight?: number;
  /** 좌우 덩이 바깥 끝의 둥글기. 1 = 반원, 0 = 각진 네모. 너무 둥글면 알약처럼 보인다. */
  sideRoundness?: number;
  /** 다이얼 몇 개 */
  rowCount?: number;
  /** 다이얼이 차지하는 가로 — 폭 대비 */
  dialSpan?: number;
  /** 미끼를 뽑아 올 알파벳. 정답 글자는 줄마다 저절로 들어간다. */
  glyphPool?: string;
  glyphsPerRow?: number;
  /** 바꾸면 미끼 글자가 다시 섞인다(같으면 늘 같다) */
  glyphSeed?: number;
  /** 처음 보이는 글자 번호(씨앗). 그 뒤로는 플레이어가 돌린 값이 산다. */
  initialDigits?: number[];
  /** 주면 [E] 로 만지는 진짜 자물쇠가 된다. 문과 같은 id 라야 덜컹거릴 때 같이 흔들린다. */
  lockId?: string;
  /** 비워 두면 아무 번호로도 안 풀린다 */
  answer?: string;
  submit?: LockSubmitter;
  /** [E] 로 만질 때 카메라가 자물쇠에서 떨어져 서는 거리 */
  handleDistance?: number;
  /** 자물쇠만 옮기는 값. 걸쇠는 안 따라가서, 걸쇠를 먼저 맞추고 이 셋으로 구멍 속에 넣는다. */
  lockX?: number;
  lockY?: number;
  lockZ?: number;
  /** 자물쇠만 숨긴다. 걸쇠는 남는다. */
  lockVisible?: boolean;
  /** 숨겼을 때 쇠막대가 지날 길을 비쳐 준다 — 걸쇠 구멍을 어디에 맞출지 보인다 */
  showPath?: boolean;
  doorLatch?: LatchSettings;
  frameLatch?: LatchSettings;
  metalColor?: string;
  dialColor?: string;
  glyphColor?: string;
  /** 칸 사이 얇은 테 */
  dividers?: boolean;
  dividerColor?: string;
  /** 칸폭 대비 */
  dividerWidth?: number;
  /** 다이얼 반지름 대비 — 1 보다 크면 살짝 튀어나온다 */
  dividerHeight?: number;
  /** 왼쪽 덩이 앞면의 "→" — 맞춰야 하는 정면 줄을 가리킨다 */
  marker?: boolean;
  /** 다이얼 글자와 같은 계열의 짙은 색 — 새긴 것처럼 보인다 */
  markerColor?: string;
  /** 덩이 앞면 안에서 키우고 줄인다(넘치면 저절로 묶인다) */
  markerSize?: number;
  brightness?: number;
  outline?: OutlineValues | null;
}

/** 번호(문자) 다이얼 맹꽁이 자물쇠와 걸쇠 두 장. */
export default function CombinationPadlock({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  size = 1.66,
  width = 0.155,
  height = 0.082,
  depth = 0.077,
  shackleRadius = 0.04,
  shackleThickness = 0.009,
  shackleHeight = 0.088,
  sideRoundness = 0.7,
  rowCount = 5,
  dialSpan = 0.37,
  glyphPool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  glyphsPerRow = 7,
  glyphSeed = 7,
  initialDigits = DEFAULT_DIGITS,
  lockId,
  answer = "",
  submit,
  handleDistance = 0.8,
  lockX = 0.015,
  lockY = -0.1171,
  lockZ = -0.03,
  lockVisible = true,
  showPath = true,
  doorLatch,
  frameLatch,
  metalColor = "#888f96",
  dialColor = "#b7b7b7",
  glyphColor = "#000000",
  dividers = true,
  dividerColor = "#6e7276",
  dividerWidth = 0.055,
  dividerHeight = 1.03,
  marker = true,
  markerColor = "#2f3338",
  markerSize = 1,
  brightness = 1,
  outline,
}: CombinationPadlockProps) {
  const dialWidth = width * dialSpan;
  const body = useMemo(
    () => bodyGeometry({ width, height, depth, dialWidth, sideRoundness }),
    [width, height, depth, dialWidth, sideRoundness],
  );

  // 다리 길이는 꼭대기 높이와 박히는 깊이에서 거꾸로 구한다 — 대충 주면 고리가 공중에 뜬다.
  const shackleY = height / 2 + shackleHeight - shackleRadius - shackleThickness;
  const embed = height * 0.35;
  const leg = Math.max(shackleThickness, shackleY + shackleThickness / 2 - (height / 2 - embed));
  // 짧은 다리도 잠긴 동안엔 몸통 속에 있어야 한다(아니면 처음부터 풀린 자물쇠로 보인다).
  // 긴 다리보다 얕게(45%) 물려 풀 때 이쪽이 먼저 빠진다.
  const shortLegRatio = Math.min(1, Math.max(0.5, 1 - (0.55 * embed) / leg));
  const shackle = useMemo(
    () =>
      shackleGeometry({
        radius: shackleRadius,
        thickness: shackleThickness,
        leg,
        longLegRatio: 1.7,
        shortLegRatio,
      }),
    [shackleRadius, shackleThickness, leg, shortLegRatio],
  );

  // 반지름을 두께로 잡으면 몸통보다 작아져 속에 묻힌다 — 몸통 높이로 잡는다.
  const dialRadius = height * 0.5;
  const slotWidth = dialWidth / rowCount;
  const rowGlyphs = useMemo(
    () => makeRowGlyphs({ answer, rowCount, glyphsPerRow, glyphPool, seed: glyphSeed }),
    [answer, rowCount, glyphsPerRow, glyphPool, glyphSeed],
  );
  const bands = useMemo(
    () =>
      rowGlyphs.map((row) => dialBandGeometry({ slotCount: row.length, radius: dialRadius, width: slotWidth * 0.9 })),
    [rowGlyphs, dialRadius, slotWidth],
  );
  const core = useMemo(() => dialCoreGeometry(rowCount, dialRadius, slotWidth), [rowCount, dialRadius, slotWidth]);
  const dividerRings = useMemo(
    () => (dividers ? dialDividerGeometry(rowCount, dialRadius, slotWidth, dividerWidth, dividerHeight) : null),
    [dividers, rowCount, dialRadius, slotWidth, dividerWidth, dividerHeight],
  );

  // 표식 자리는 몸통과 같은 식으로 구한다 — 따로 적으면 폭을 만질 때 표식만 엉뚱한 데 남는다.
  const lobeWidth = computeLobeWidth({ width, height, dialWidth });
  const bevel = computeBevel({ height, depth, lobeWidth });
  // 앞면의 평평한 자리. 베벨 위에 얹으면 떠 보인다.
  const flatWidth = Math.max(0.001, lobeWidth - bevel * 2);
  const flatHalfHeight = Math.max(0.001, height / 2 - bevel);
  const markerGap = flatWidth * 0.08; // 다이얼과 화살 끝 사이 — 붙으면 닿아 보인다
  const markerLength = Math.min(flatWidth * 0.52 * markerSize, flatWidth - markerGap);
  // 화살 끝(기준점)은 크기와 상관없다 — 줄여도 가리키는 자리가 흔들리면 안 된다.
  const markerX = -(dialWidth / 2 + bevel + markerGap);
  // 앞면과 같은 자리면 둘이 깜빡인다
  const markerZ = depth / 2 + Math.max(0.0004, depth * 0.012);
  const markerPlate = useMemo(
    () =>
      marker
        ? markerGeometry({
            length: markerLength,
            // 머리·꼬리를 길이에서 뺀다 — 높이로 재면 높이만 만졌을 때 비율이 찌그러진다.
            headLength: markerLength * 0.5,
            headHalf: Math.min(markerLength * 0.32, flatHalfHeight * 0.8),
            tailHalf: Math.min(markerLength * 0.115, flatHalfHeight * 0.3),
          })
        : null,
    [marker, markerLength, flatHalfHeight],
  );

  // 「맞춤N」은 씨앗이다. 만지면 다이얼이 그리로 옮겨 가고, 그 뒤로는 플레이어가 돌린 값이 산다.
  const seedDigits = Array.from({ length: rowCount }, (_, i) => initialDigits[i] ?? 0);
  const seedKey = seedDigits.join(",");
  useEffect(() => {
    if (!lockId) return;
    seedLock(lockId, {
      digits: seedKey.split(",").map(Number),
      answer,
      glyphs: rowGlyphs,
      submit,
    });
  }, [lockId, seedKey, answer, rowGlyphs, submit]);
  const lock = useLock(lockId);
  const control = useLockControl();
  const isHandling = !!control && control.id === lockId && control.phase === "active";
  const shownDigits = lock?.digits ?? seedDigits;
  const selectedRow = lock?.selectedRow ?? 0;
  const unlocked = !!lock?.unlocked;

  const lockRef = useRef<THREE.Group>(null);
  const shakeRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const progress = useRef(0);
  // 걸쇠에 꿰인 쇠막대를 축으로 흔들린다
  const shakeAxisY = shackleY;
  useFrame((_, dt) => {
    const shake = shakeRef.current;
    if (shake) {
      // 문과 같은 id 로 흔들려야 안 열리는 이유가 이 자물쇠라는 게 읽힌다
      const v = lockId ? rattleOffset(lockId) : 0;
      shake.rotation.z = v * 0.17;
      shake.rotation.x = v * 0.05;
    }
    progress.current = unlocked ? Math.min(1, progress.current + dt / OPENING_MOTION.duration) : 0;
    const t = progress.current;
    const pose = openingPose(t);
    if (t > 0 && t < 1) requestShadowUpdates(0.2);

    // 본체만 살짝 내려가 짧은 다리가 빠진다. 이후엔 전체와 함께 움직인다.
    bodyRef.current?.position.set(0, -pose.release, 0);

    // 전체: 쇠막대를 축으로 눕고 → 구멍 축(+x)으로 빠지고 → 떨어진다. 눕기만 하고 z·y 회전은 안 쓴다.
    const whole = lockRef.current;
    if (whole) {
      whole.rotation.set(pose.angle, 0, 0);
      const [x, y, z] = openingPosition(pose, { x: lockX, y: lockY, z: lockZ });
      whole.position.set(x, y, z);
      whole.visible = pose.visible;
    }
  });

  // 줄마다 글자가 달라 재질도 줄마다. 텍스처는 글자 조합별로 한 번만 만들어 둔다.
  const bandMaterials = useMemo(
    () =>
      rowGlyphs.map(
        (row) =>
          new THREE.MeshBasicMaterial({
            map: dialBandTexture(row, dialColor, glyphColor),
            toneMapped: false, // 어두운 복도에서도 글자가 읽혀야 한다
          }),
      ),
    [rowGlyphs, dialColor, glyphColor],
  );

  useEffect(() => () => body.dispose(), [body]);
  useEffect(() => () => shackle.dispose(), [shackle]);
  useEffect(() => () => core.dispose(), [core]);
  useEffect(() => () => dividerRings?.dispose(), [dividerRings]);
  useEffect(() => () => markerPlate?.dispose(), [markerPlate]);
  useEffect(() => () => bands.forEach((g) => g.dispose()), [bands]);
  useEffect(() => () => bandMaterials.forEach((m) => m.dispose()), [bandMaterials]);

  const highlightId = `padlock:${lockId ?? ""}`;

  return (
    <group position={position} rotation={rotation} scale={size}>
      {/* 확대는 안 준다 — 문에 매달려 함께 여닫히는데 강조가 position 을 만지면 자물쇠가 따로 논다. */}
      <Highlight id={highlightId} anchor={() => null} grow={0}>
        <group ref={lockRef} position={[lockX, lockY, lockZ]}>
          {/* 회전축을 쇠막대 높이로 올렸다가(바깥) 도로 내려온다(안쪽). 몸통 한가운데로 돌리면 걸쇠를 뚫는다. */}
          <group ref={shakeRef} position={[0, shakeAxisY, 0]}>
            <group position={[0, -shakeAxisY, 0]}>
              <group ref={bodyRef}>
                {lockVisible && (
                  <>
                    <mesh geometry={body} castShadow receiveShadow>
                      <ToonMaterial color={metalColor} brightness={brightness} />
                      <ToonOutline geometry={body} outline={outline} />
                    </mesh>
                    <mesh geometry={core} castShadow>
                      <ToonMaterial color={dialColor} brightness={brightness} />
                    </mesh>
                    {dividerRings && (
                      <mesh geometry={dividerRings} castShadow>
                        <ToonMaterial color={dividerColor} brightness={brightness} />
                      </mesh>
                    )}
                    {/* 판판한 조각이라 그림자는 지저분한 금만 만든다. 빛을 안 받아야 어두운 복도에서 읽힌다. */}
                    {markerPlate && (
                      <mesh geometry={markerPlate} position={[markerX, 0, markerZ]}>
                        <meshBasicMaterial color={markerColor} toneMapped={false} />
                      </mesh>
                    )}
                    {rowGlyphs.map((row, i) => (
                      <Dial
                        key={i}
                        geometry={bands[i]}
                        material={bandMaterials[i]}
                        x={(i - (rowCount - 1) / 2) * slotWidth}
                        slot={(((shownDigits[i] ?? 0) % row.length) + row.length) % row.length}
                        slotCount={row.length}
                      />
                    ))}
                    {isHandling && (
                      <mesh
                        position={[(selectedRow - (rowCount - 1) / 2) * slotWidth, dialRadius * 1.55, 0]}
                        rotation={[Math.PI, 0, 0]}
                      >
                        <coneGeometry args={[slotWidth * 0.34, slotWidth * 0.6, 4]} />
                        <meshBasicMaterial color="#ffd34d" toneMapped={false} />
                      </mesh>
                    )}
                  </>
                )}
              </group>
              {lockVisible && (
                <mesh geometry={shackle} position={[0, shackleY, 0]} castShadow>
                  <ToonMaterial color={metalColor} brightness={brightness * 1.05} />
                  <ToonOutline geometry={shackle} outline={outline} />
                </mesh>
              )}
              {!lockVisible && showPath && (
                <mesh geometry={shackle} position={[0, shackleY, 0]}>
                  <meshBasicMaterial color="#4fd2ff" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
                </mesh>
              )}
            </group>
          </group>
        </group>
      </Highlight>
      {lockId && (
        <>
          <Interactable
            id={highlightId}
            radius={0.3}
            reach={4}
            label=""
            position={() => worldPositionOf(lockRef)}
            run={() => startLockControl(lockId)}
            // 숨겼거나 이미 뭔가 만지는 중이면 겨냥 대상에서 뺀다
            disabled={() => !lockVisible || unlocked || !!lockControl()}
          />
          <LockCloseUpCamera lockId={lockId} targetRef={lockRef} distance={handleDistance} />
        </>
      )}
      {/* 걸쇠 두 장 — 문쪽 · 테두리쪽. 자물쇠 쇠막대가 둘을 함께 꿴다. */}
      {[doorLatch, frameLatch].map((settings, i) =>
        settings && settings.visible !== false ? (
          <LatchPlate
            key={i}
            settings={settings}
            shackleThickness={shackleThickness}
            shackleY={shackleY}
            shackleRadius={shackleRadius}
            brightness={brightness}
            outline={outline}
          />
        ) : null,
      )}
    </group>
  );
}
