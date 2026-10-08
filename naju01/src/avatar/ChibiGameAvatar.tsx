// 치비·Meshy 몸체 런타임 아바타. Sidekick 뼈 이름·축으로 묶은 몸 GLB 에 Quaternius 43개 모션(과
// 우리 몸체에 맞춰 만든 Tripo 걷기·대기·달리기)을 리타게팅하고, 보정·접지 IK·팔 IK·쥠을 얹는다.
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import { UNITS_PER_METER } from "../plan/sitePlan";
import { alignWrists, solveArms } from "./armIk";
import { registerDiagnostics } from "./avatarDiagnostics";
import { attachClipPlanes, CLIPPING, updateClipPlane } from "./firstPersonClipping";
import { applyFootContact, createFootContactState, lowestSoleY } from "./footContactIk";
import { DEFAULT_MESH_CONFIG, type MeshAppearanceConfig, meshBodyUrl, meshShoesUrl } from "./meshAppearance";
import {
  type CorrectionOverrides,
  type CorrectionValues,
  DEFAULT_CORRECTION,
  GENDER_CORRECTION,
  LOCOMOTION_CLIPS,
  readCorrectionOverrides,
  TRIPO_CORRECTION,
  TRIPO_GENDER_CORRECTION,
} from "./motionCorrection";
import {
  CHIBI_BODY_URLS,
  type ChibiAvatarConfig,
  type ChibiBody,
  DEFAULT_CHIBI_CONFIG,
  type FistMorph,
  type Gender,
  MOTION_LIBRARY_URL,
  prepareBody,
  type PreparedBody,
  STATIONARY_CLIPS,
  TRIPO_MOTION_URLS,
} from "./preparedBody";
import { DEFAULT_TOON, type ToonConfig } from "./toonMaterial";
import { DEFAULT_OUTLINE, type OutlineConfig } from "./toonOutline";
import { chooseMotion, type MotionTimers, useMotionPlayer } from "./useChibiMotion";
import { useAppearancePaint, useDeferredDisposal, useToonAndOutline } from "./useChibiMaterials";

export type { ChibiAvatarConfig, ChibiBody } from "./preparedBody";

// 주먹을 감았다 펴는 속도(1/초). 물건이 손에 붙는 순간 이미 쥐어져 있게 집는 동작보다 조금 빠르게.
const GRIP_CLOSE_SPEED = 12;

/**
 * 주먹 쥐기 — 이 리그는 손가락 뼈가 없어 fistHands 모프가 유일한 손잡이다. 게임이 안 보내면 섞기 0 → 옷장 값(resting).
 * gripAmount 는 지난 프레임 값 — 모프는 믹서 블렌드를 못 타서 시간으로 직접 푼다(안 그러면 손 모양이 툭 바뀐다).
 */
function applyGrip(
  fistMorphs: FistMorph[],
  state: AvatarLink,
  resting: number,
  gripAmount: RefObject<number>,
  delta: number,
) {
  if (!fistMorphs.length) return;
  const blend = Math.max(0, Math.min(1, state.gripBlend ?? 0));
  gripAmount.current += (blend - gripAmount.current) * (1 - Math.exp(-delta * GRIP_CLOSE_SPEED));
  // 쥘 때 값은 절대값 — 상자를 받치는 펴진 손(쥠세기 < 평소)을 만들 수 있어야 한다.
  const gripping = Math.max(0, Math.min(1, state.gripStrength ?? resting));
  const fist = resting + (gripping - resting) * gripAmount.current;
  fistMorphs.forEach(({ mesh, index }) => {
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = fist;
  });
}

// 팔·다리 길이, 어깨 폭, 발 크기는 뼈 배율로 덮는다. 믹서가 쓴 뒤에 불러야 한다(클립에 위치·배율 트랙이 있을 수 있다).

/** 팔·다리 뿌리 뼈 배율. 손은 팔 배율을 물려받아 되돌린다(손 크기는 모프로). 다리 배율을 돌려준다. */
function applyLimbLengths(prepared: PreparedBody, config: ChibiAvatarConfig): number {
  const armLength = config.armLength ?? 1;
  const legLength = config.legLength ?? 1;
  prepared.armRoots.forEach((bone) => bone.scale.setScalar(armLength));
  prepared.legRoots.forEach((bone) => bone.scale.setScalar(legLength));
  prepared.handBones.forEach((bone) => bone.scale.setScalar(1 / armLength));
  return legLength;
}

function applyShoulderAndFeet(prepared: PreparedBody, config: ChibiAvatarConfig, isMeshy: boolean, legLength: number) {
  const shoulderWidth = config.shoulderWidth ?? 1;
  prepared.shoulderBones.forEach(({ bone, rest }) => bone.position.copy(rest).multiplyScalar(shoulderWidth));
  const wearsShoes = isMeshy && (config.shoes ?? -1) >= 0;
  // 신발 GLB 엔 모프가 없어, 신었을 때는 발뼈 배율로 신발째 키운다(그때 몸 모프는 0). 다리 배율도 되돌린다.
  prepared.footBones.forEach((bone) =>
    bone.scale.setScalar((wearsShoes ? prepared.shoeShrink * (config.footScale ?? 1) : 1) / legLength),
  );
  // 발볼은 신발 안에서 접히기만 하면 된다.
  prepared.ballBones.forEach((bone) => bone.scale.setScalar(wearsShoes ? 0.02 : 1));
}

const chibiDebugByGender: Partial<Record<Gender, { motion: string; current: string | null }>> = {};

interface ChibiGameAvatarProps {
  /** false 면 그리지 않는다(1인칭 「몸만」은 따로) */
  visible: boolean;
  /** 1인칭에서 몸만 그릴지(Leva 「1인칭 몸」) */
  firstPersonBody?: boolean;
  playerRef: RefObject<AvatarLink | null>;
  config?: ChibiAvatarConfig;
  /** 인게임 미터 배율 */
  scale?: number;
  /** QA 캡처용: 모션을 이 시각(초)에 고정 */
  fixedTime?: number | null;
  body?: ChibiBody;
  toon?: ToonConfig;
  outline?: OutlineConfig;
  /** 기본·성별 보정 위에 덮어쓸 것만 */
  correction?: CorrectionOverrides | null;
  /**
   * useFrame 순서(작을수록 먼저). 손목표(−30) 뒤, 든 물건(−10) 앞이어야 물건이 직전 프레임 손을 따라
   * 헤엄치지 않는다. 음수라 R3F 자동 렌더는 그대로 돈다. 본편은 FRAME_PRIORITY.avatar 를 넘긴다.
   */
  framePriority?: number;
}

function ChibiGameAvatar({
  visible,
  firstPersonBody = false,
  playerRef,
  config = DEFAULT_CHIBI_CONFIG,
  scale = UNITS_PER_METER,
  fixedTime = null,
  body = "chibi",
  toon = DEFAULT_TOON,
  outline = DEFAULT_OUTLINE,
  correction = DEFAULT_CORRECTION,
  framePriority = -20,
}: ChibiGameAvatarProps) {
  const root = useRef<THREE.Group>(null);
  // 1인칭 잘림면은 세계 좌표라 카메라가 필요하고, localClippingEnabled 를 켜야 clippingPlanes 를 본다.
  const { gl, camera } = useThree();
  const isMeshy = body === "meshy";
  const appearanceBase = useMemo<MeshAppearanceConfig>(() => ({ ...DEFAULT_MESH_CONFIG, ...config }), [config]);
  const modelUrl = isMeshy ? meshBodyUrl(appearanceBase) : null;
  const maleGltf = useGLTF(modelUrl ?? CHIBI_BODY_URLS.masculine);
  const femaleGltf = useGLTF(modelUrl ?? CHIBI_BODY_URLS.feminine);
  const motionGltf = useGLTF(MOTION_LIBRARY_URL);
  const shoesGltf = useGLTF(isMeshy ? meshShoesUrl(appearanceBase) : CHIBI_BODY_URLS.masculine);
  const tripoGltfs = useGLTF(TRIPO_MOTION_URLS);
  const usesTripo = (config.motionSource ?? DEFAULT_MESH_CONFIG.motionSource) === "tripo";
  const gender: Gender = config.gender === "feminine" ? "feminine" : "masculine";
  // 기본 → 성별 → 호출자 덧값 순으로 합친다.
  const correctionValues = useMemo<CorrectionValues>(
    () => ({ ...DEFAULT_CORRECTION, ...(GENDER_CORRECTION[gender] ?? {}), ...(correction ?? {}) }),
    [gender, correction],
  );
  const tripoValues = useMemo<CorrectionValues>(() => {
    const values: CorrectionValues = { ...TRIPO_CORRECTION, ...(TRIPO_GENDER_CORRECTION[gender] ?? {}) };
    // DEV 덧값 — gait.html?walk=…&fold=…&idle=…. 주소로 넘어온 열쇠만 덮어쓴다.
    Object.assign(values, readCorrectionOverrides("walk") ?? {});
    const fold = readCorrectionOverrides("fold");
    if (fold) values.foldOverrides = { ...(values.foldOverrides ?? {}), ...fold };
    const idle = readCorrectionOverrides("idle");
    if (idle) values.idleOverrides = { ...(values.idleOverrides ?? {}), ...idle };
    return values;
  }, [gender]);
  // 옷이 바뀌어도 값이 같은 것(리타깃·보폭·접지)을 찾을 열쇠. 몸 GLB 경로는 일부러 안 넣는다.
  const rigKey = useMemo(
    () =>
      `${body}|${gender}|${usesTripo ? "t" : "s"}|${JSON.stringify(correctionValues)}|${JSON.stringify(tripoValues)}`,
    [body, gender, usesTripo, correctionValues, tripoValues],
  );
  const prepared = useMemo(
    () =>
      prepareBody(
        !isMeshy && gender === "feminine" ? femaleGltf : maleGltf,
        motionGltf,
        correctionValues,
        isMeshy ? shoesGltf : null,
        usesTripo ? tripoGltfs : null,
        tripoValues,
        rigKey,
      ),
    [
      isMeshy,
      gender,
      maleGltf,
      femaleGltf,
      motionGltf,
      correctionValues,
      shoesGltf,
      tripoGltfs,
      usesTripo,
      tripoValues,
      rigKey,
    ],
  );

  const defer = useDeferredDisposal(prepared);

  // 잘림면은 화면에 실제로 그려지는 재질(그려진 그룹)에 첫 프레임 한 번만 붙인다.
  const clipAttached = useRef(false);
  const wasBodyOnly = useRef(false);
  useEffect(() => {
    gl.localClippingEnabled = true;
    clipAttached.current = false;
  }, [gl, prepared, config, body]);

  const { toonHandle, outlineHandle } = useToonAndOutline(prepared, toon, outline, defer);
  useEffect(() => {
    registerDiagnostics(prepared, { clipNames: [...LOCOMOTION_CLIPS, "Idle_Loop", "Jump_Loop", "Punch_Cross"] });
  }, [prepared]);
  const appearance = useAppearancePaint({
    prepared,
    config,
    body,
    toonEnabled: toon.enabled,
    toonHandle,
    outlineHandle,
  });

  const { mixer, actions, currentMotion, play } = useMotionPlayer(prepared);
  const timers = useRef<MotionTimers>({
    airborneSince: null,
    wasAirborne: false,
    jumpStartEnd: 0,
    landingEnd: 0,
    lastAttack: 0,
    attackEnd: 0,
  });
  const inverseModel = useMemo(() => new THREE.Matrix4(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const footContact = useMemo(() => createFootContactState(), []);
  // 발바닥 최저점 캐시 — 정점 7731 개를 매 프레임 훑는 값이 아바타당 3.0ms 다.
  const soleHeightCache = useRef<number | null>(null);
  const soleFingerprint = useRef("");
  const fadeEnd = useRef(0);
  // 주먹 쥠의 지난 프레임 값(applyGrip 참고).
  const gripAmount = useRef(0);

  // playerRef.current 는 일부러 양방향으로 쓰는 상자다(avatarLink.ts). 프레임마다 바뀌는 런타임 상태라
  // state 로 올리면 매 프레임 리렌더가 난다.
  useFrame(({ clock }, delta) => {
    const group = root.current;
    const state = playerRef.current;
    if (!group || !state) return;
    // 잘림면 붙이기 — 마운트 뒤 한 프레임만.
    if (!clipAttached.current) {
      clipAttached.current = true;
      attachClipPlanes(group);
    }
    // 게임이 프레임마다 내려 주는 「몸만 그려라」(물건을 들거나 [E] 로 뻗는 동안). prop 이면 집을 때마다 리렌더가 난다.
    // firstPersonBody prop 으로 켠 경우는 showBody 와 상관없이 그린다.
    const bodyOnly = firstPersonBody || (CLIPPING.showBody && !visible && !!state.firstPersonHands);
    // 몸만 켜지는 순간 한 번 더 붙인다 — 첫 프레임 뒤에 생긴 외곽선 껍데기가 안 잘린 채 목 단면을 비췄다.
    if (bodyOnly && !wasBodyOnly.current) attachClipPlanes(group);
    wasBodyOnly.current = bodyOnly;
    const shouldDraw = visible || bodyOnly;
    group.visible = shouldDraw;
    // 손뼈·주먹 중심·소켓을 상자에 얹는다. 쓰는 쪽은 본편이 정한다(이 파일은 본편을 모른다).
    // 몸을 안 그릴 때는 비운다 — 아래에서 바로 빠져나가 뼈가 멈추므로, 든 물건이 안 보이는 몸 속에 박힌다.
    // 뼈가 없으면 쓰는 쪽이 카메라 기준 자리(1인칭 갈래)로 그린다.
    const exportHands = shouldDraw;
    state.rightHand = exportHands ? (prepared.handBones[1] ?? prepared.handBones[0] ?? null) : null;
    state.leftHand = exportHands ? (prepared.handBones[0] ?? null) : null;
    state.rightPalm = exportHands ? (prepared.palms.hand_r ?? null) : null;
    state.leftPalm = exportHands ? (prepared.palms.hand_l ?? null) : null;
    state.rightGripSocket = exportHands ? (prepared.gripSockets.hand_r ?? null) : null;
    state.leftGripSocket = exportHands ? (prepared.gripSockets.hand_l ?? null) : null;
    if (!shouldDraw) return;
    const avatarScale = scale * (config.heightScale ?? 1);

    const now = clock.elapsedTime;
    const next = chooseMotion(prepared, state, config, timers.current, now, avatarScale);
    // 대기는 남녀 같은 클립(Tripo Idle_Loop — 허리에 손). 팔짱 클립(Idle_Fold_Loop)은 어깨가 넓은 Tripo 리그로
    // 만든 자세라 손이 반대팔을 뚫거나 떠서 쓰지 않는다. 남성은 대기 덧값으로 다리를 벌린다.
    const previousMotion = currentMotion.current;
    play(next);
    // 크로스페이드(0.16초) 중에는 두 클립이 섞여 발이 옮겨 간다 — 그동안은 캐시를 안 쓴다.
    if (currentMotion.current !== previousMotion) fadeEnd.current = now + 0.2;
    const action = currentMotion.current ? actions.current.get(currentMotion.current) : undefined;
    // 발이 안 미끄러지게 걷기·달리기 재생 속도를 실제 이동 속도에 맞춘다.
    if (action && fixedTime === null && LOCOMOTION_CLIPS.has(next)) {
      const own = prepared.strideFor(next) * avatarScale;
      const groundSpeed = state.speed ?? 0;
      action.setEffectiveTimeScale(own > 1e-4 ? THREE.MathUtils.clamp(groundSpeed / own, 0.45, 2.2) : 1);
    }
    if (fixedTime !== null && action) {
      actions.current.forEach((other) => {
        if (other !== action) other.stop();
      });
      action.stopFading().setEffectiveWeight(1).play();
      action.time = fixedTime % Math.max(0.001, action.getClip().duration);
      mixer.update(0);
    } else mixer.update(delta);

    // 1인칭이면 머리를 없앤다 — 카메라가 머리 안에 있다. 0 은 행렬이 뒤집혀 아주 작은 값으로 접는다.
    prepared.headBone?.scale.setScalar(bodyOnly ? 1e-4 : (config.headScale ?? 1));
    // 머리만 접으면 목 기둥이 남아 잘린 단면이 비쳤다. 목째 접으면 쇄골 사이 한 점으로 모인다.
    if (prepared.neckBone) prepared.neckBone.scale.setScalar(bodyOnly ? 1e-4 : 1);
    updateClipPlane(camera, bodyOnly, state.crouching, scale);
    const legLength = applyLimbLengths(prepared, config);
    applyGrip(prepared.fistMorphs, state, appearance.fistHands ?? 0, gripAmount, delta);
    applyShoulderAndFeet(prepared, config, isMeshy, legLength);

    group.position.set(state.position.x, state.footY, state.position.z);
    group.rotation.set(0, state.facing, 0);
    // 1인칭 「몸만」: 몸을 뒤로 물려 카메라가 눈 자리에 오게 한다. facing 규약: 앞 = (sin f, cos f).
    if (bodyOnly && CLIPPING.bodyBack) {
      const back = CLIPPING.bodyBack * scale;
      group.position.x -= Math.sin(state.facing) * back;
      group.position.z -= Math.cos(state.facing) * back;
    }
    group.scale.setScalar(avatarScale);
    group.updateMatrixWorld(true);

    const armRequests = solveArms(prepared, state, group);
    alignWrists(prepared.arms, state, armRequests);

    // 접지 IK 와 지면 맞추기가 모델 좌표로 밑창을 잰다.
    inverseModel.copy(prepared.model.matrixWorld).invert();
    applyFootContact(footContact, { prepared, group, action, next, delta, avatarScale, inverseModel, point });

    // 발바닥 정점 중 가장 낮은 점을 지면에 맞춘다(발끝을 세우는 동작 포함).
    //   캐시 기준은 이동 플래그가 아니라 클립과 설정이다 — 생성 화면은 moving=false 로 걷기 클립을 돌려
    //   최저점이 38mm 움직인다. 제자리 클립 + 크로스페이드 끝 + 외형 그대로일 때만 쓴다.
    //   외형은 항목을 고르지 않고 설정 전체를 지문으로 쓴다 — 항목을 늘릴 때 여기를 잊으면 조용히 틀린다.
    const fingerprint = `${next}|${body}|${JSON.stringify(config)}`;
    const canUseCache =
      STATIONARY_CLIPS.has(next) &&
      next === currentMotion.current &&
      now >= fadeEnd.current &&
      now >= timers.current.attackEnd &&
      state.grounded &&
      fingerprint === soleFingerprint.current &&
      soleHeightCache.current !== null;
    soleFingerprint.current = fingerprint;
    if (!canUseCache) {
      // 전부 본다 — 넷 중 하나만 보면 최저점을 놓쳐 몇 mm 씩 묻히고 깜빡인다.
      const soleY = lowestSoleY(prepared.soles, (sole) => sole.indices, 1, inverseModel, point);
      soleHeightCache.current = Number.isFinite(soleY) ? soleY : null;
    }
    if (soleHeightCache.current !== null) group.position.y = state.footY - soleHeightCache.current * avatarScale;

    if (import.meta.env.DEV) {
      chibiDebugByGender[gender] = { motion: next, current: currentMotion.current };
      exposeDevHook("chibiDebugByGender", chibiDebugByGender);
      exposeDevHook("chibiDebug", {
        visible: true,
        motion: next,
        motionCount: prepared.clipCount,
        mappedBones: prepared.mappedBones,
        gender,
        stride: Object.fromEntries([...LOCOMOTION_CLIPS].map((name) => [name, prepared.strideFor(name)])),
        contact: prepared.contactTimeFor(next),
        ik: footContact.debug,
        timeScale: action?.getEffectiveTimeScale?.() ?? 1,
        speed: state.speed ?? 0,
      });
    }
  }, framePriority);

  return (
    <group name="NAJU-chibi-avatar" ref={root} visible={visible || firstPersonBody}>
      <primitive object={prepared.model} />
    </group>
  );
}

// 모듈 예열은 늘 쓰는 것만 — 나주·로비는 meshy 라 chibi 몸체(6.5MB)는 쓸 때 읽는다.
useGLTF.preload(MOTION_LIBRARY_URL);
useGLTF.preload(TRIPO_MOTION_URLS);

export default ChibiGameAvatar;
