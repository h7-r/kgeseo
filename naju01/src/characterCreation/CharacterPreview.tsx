// 캐릭터 생성 화면의 3D 무대.
// 캔버스는 투명하고 배경은 그 아래 CSS 가 화면 끝까지 그린다 — 헤더·패널 뒤로도 같은 공간이 이어진다.
// 게임과 같은 렌더러(ChibiGameAvatar)·모델·툰 재질을 쓰고, 여기서는 관찰용 카메라·빛·모델 교체 대기만 얹는다.
import {
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import type { PlayerMotionState } from "@/engine/movement/useMovement";

import ChibiGameAvatar from "../avatar/ChibiGameAvatar";
import { getMeshBodyUrl, getMeshShoesUrl, type MeshAppearanceConfig } from "../avatar/meshAppearance";
import type { AvatarGender } from "../avatar/sidekickOptions";
import { DEFAULT_TOON } from "../avatar/toonMaterial";

/** 담을 부위. upperBody 는 이름 단계 전용이다 */
export type PreviewView = "full" | "head" | "hands" | "feet" | "upperBody";

export type PreviewQuality = "low" | "medium" | "high";

// 얼굴까지 확대해 보는 화면이라 딱 떨어지는 명암 계단이 낮은 폴리곤 모서리를 따라 목선에서 톱니로 보인다 — 경계를 조금 푼다.
const PREVIEW_TOON = { ...DEFAULT_TOON, softness: 0.06 };

/** 무대 칸 밖에서 UI 가 덮는 픽셀 — 카메라가 그 뒤로 캐릭터를 숨기지 않는다 */
export interface SafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 바깥(도크 단추)에 넘기는 카메라 손잡이 */
export interface PreviewControls {
  rotate: (radians: number) => void;
  reset: () => void;
}

interface OrbitState {
  yaw: number;
  pitch: number;
  /** 1 = 그 보기의 기본 화면(가장 멀리) · 작을수록 확대 */
  zoom: number;
  /** 확대 중 몸을 따라 위아래로 옮긴 거리(m) — 기준점 위가 + */
  lift: number;
}

const INITIAL_ORBIT: OrbitState = { yaw: -0.3, pitch: 0.06, zoom: 1, lift: 0 };
// 기본 화면보다 멀어질 필요는 없다 — 확대만 한다(미르 11/10). 해랑이 #92 에서 1.5 배까지 밀게 했던 것을 1 로
const MAX_ZOOM = 1;
/**
 * 당기는 한도는 보기마다(해랑 #92) — 전신은 머리~무릎까지, 이미 가까이 보는 부위는 조금만(더 당기면 한 부분만 화면을 덮는다).
 * 손은 두 손을 나란히 봐야 해서 거의 당기지 않는다(당기면 양쪽 손이 잘린다). 확대한 뒤에는 세로로 끌어 몸을 따라 옮긴다
 */
// 머리는 구도를 머리카락 · 어깨까지 넓힌 만큼(11/11) 더 당길 수 있다 — 가장 가까울 때 얼굴 크기는 예전(0.82)과 같다
const MIN_ZOOM: Record<PreviewView, number> = { full: 0.6, upperBody: 0.8, head: 0.65, feet: 0.82, hands: 0.95 };
/**
 * 보기마다 처음 내려다보는 각(라디안) — 머리는 살짝 위에서 봐야 정수리 · 머리 윗면 색이 보인다(미르 11/11 「머리색을 바꿔도
 * 얼굴만 보인다」). 나머지는 처음 각 그대로
 */
const VIEW_PITCH: Partial<Record<PreviewView, number>> = { head: 0.22 };
const startOrbit = (view: PreviewView): OrbitState => ({
  ...INITIAL_ORBIT,
  pitch: VIEW_PITCH[view] ?? INITIAL_ORBIT.pitch,
});

/** 카메라가 매 프레임 남기는 화면 크기 — 끌기 · 가리킨 곳 확대가 화면 px 을 세계 m 로 바꿀 때 쓴다 */
interface ViewMetrics {
  /** 기준점 거리에서 화면 전체 높이가 담는 세계 높이(m) */
  worldHeight: number;
  /** 빈 자리(무대) 가운데의 화면 y(px, 캔버스 위 기준) */
  freeCenterY: number;
  /** 캔버스 높이(px) */
  height: number;
  /** 지금 화면 기준점 높이(옮김 포함) · 그 보기의 기준점 높이(m) */
  focusY: number;
  baseY: number;
  /** 이 값들을 그린 때의 zoom — 한 프레임 안에 휠이 여러 번 와도 그린 때 기준으로 비를 잰다(Codex 06) */
  zoom: number;
}

// 손을 볼 때만 팔을 벌린 자세로 — 허리에 손을 얹은 대기 자세는 손을 가린다.
// 걷기는 팔이 흔들려 손이 이미 다 보이고, 바꾸면 골라 둔 걷기가 멋대로 멈춘다 — 대기일 때만 바꾼다.
function getObservationPose(view: PreviewView, pose: string): string {
  return view === "hands" && pose === "Idle_Loop" ? "A_TPose" : pose;
}

// 보통 dpr 1.25: 정지 프레임 비용 대부분은 그리기가 아니라 투명 캔버스 합성(픽셀 수 비례)이다.
const QUALITY_SETTINGS: Record<PreviewQuality, { dpr: [number, number]; shadowResolution: number; blur: number }> = {
  low: { dpr: [1, 1], shadowResolution: 256, blur: 2.2 },
  medium: { dpr: [1, 1.25], shadowResolution: 512, blur: 2.6 },
  high: { dpr: [1, 2], shadowResolution: 1024, blur: 3.0 },
};

type OutfitKeySource = Pick<MeshAppearanceConfig, "gender" | "top" | "bottom" | "shoes">;

function formatOutfitKey(config: OutfitKeySource): string {
  return `${config.gender}|${config.top}|${config.bottom}|${config.shoes}`;
}

function parseOutfitKey(key: string): OutfitKeySource {
  const [gender, top, bottom, shoes] = key.split("|");
  return { gender: gender as AvatarGender, top: Number(top), bottom: Number(bottom), shoes: Number(shoes) };
}

// ── 다음에 고를 옷을 미리 받아 둔다 ──
// 옷은 전신 GLB(9.5~14.7MB)를 통째로 갈아 끼워 처음 고르는 조합은 몇 초 걸린다. 한 벌을 보여 준 뒤 한가해지면
// 그 성별의 나머지 조합을 조용히 받아 둔다(반대 성별까지는 받지 않는다 — 100MB 를 다 받을 이유가 없다).
// 한 번에 하나씩, 한가할 때만: 한꺼번에 받으면 동시 연결(6개)이 차서 이용자가 누른 옷이 밀린다.
// 작은 신발부터 받아 두면 몸이 오는 동안 짝이 준비된다.
const OUTFIT_COMBOS = [
  { top: -1, bottom: -1 },
  { top: 0, bottom: -1 },
  { top: -1, bottom: 0 },
  { top: 0, bottom: 0 },
];

function runWhenIdle(task: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => task(), { timeout: 6000 });
  else setTimeout(task, 900);
}

function prefetchOtherOutfits(gender: AvatarGender, isAlive: () => boolean, skipKey: string) {
  // 파일 이름은 성별·상의·하의 조합만 본다(신발 번호는 파일을 안 가른다)
  const [skipGender, skipTop, skipBottom] = skipKey.split("|");
  const queue: string[] = [];
  for (const combo of OUTFIT_COMBOS) {
    // 지금 보고 있는 조합은 이미 손에 있다
    if (gender === skipGender && String(combo.top) === skipTop && String(combo.bottom) === skipBottom) continue;
    const config = { gender, ...combo };
    queue.push(getMeshShoesUrl(config), getMeshBodyUrl(config));
  }
  const step = () => {
    if (!isAlive()) return;
    const url = queue.shift();
    if (!url) return;
    try {
      // 받아서 풀어 두기까지 한다(해석 0.5초도 미리). preload 는 끝을 알려 주지 않아 한 개가 오갈 만큼 띄운다.
      useGLTF.preload(url);
    } catch {
      // 미리 받기는 실패해도 화면은 그대로 돈다
    }
    setTimeout(() => runWhenIdle(step), 1200);
  };
  runWhenIdle(step);
}

// 생성 화면에는 플레이어가 없으니 아바타에 「가만히 서 있는」 상태를 준다.
function createStandingState(): PlayerMotionState & { attackSerial: number; attackMotion: string } {
  return {
    position: new THREE.Vector3(),
    footY: 0,
    groundY: 0,
    facing: 0,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    speed: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  };
}

/** 새 착장 GLB 를 먼저 읽고, 다 읽히면 알린다 — 그 전에는 앞 모습을 그대로 보여 준다 */
function ModelWarmup({
  config,
  fileKey,
  onReady,
}: {
  config: OutfitKeySource;
  fileKey: string;
  onReady: (key: string) => void;
}) {
  const bodyUrl = getMeshBodyUrl(config);
  const shoesUrl = getMeshShoesUrl(config);
  useGLTF(bodyUrl);
  useGLTF(shoesUrl);
  useEffect(() => {
    onReady(fileKey);
  }, [onReady, fileKey, bodyUrl, shoesUrl]);
  return null;
}

// 캐릭터 상자는 정점을 훑지 않고 잰다. Box3.setFromObject 는 SkinnedMesh 마다 정점 9.8만 개를 모프·스키닝해
// 옷을 갈아입을 때마다 수백 ms 를 먹는다. 지오메트리 상자(한 번 구우면 GLB 캐시에 남는다)를 세계 행렬로 옮겨 합친다.
// 쉴 때 자세 기준이라 동작에 따라 상자가 흔들리지 않아 카메라용으로 오히려 낫다.
const pieceBox = new THREE.Box3();
function computeGroupBox(group: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return;
    pieceBox.copy(box).applyMatrix4(mesh.matrixWorld);
    target.union(pieceBox);
  });
  return target;
}

function findSkeleton(root: THREE.Object3D): THREE.Skeleton | null {
  const found: { skeleton: THREE.Skeleton | null } = { skeleton: null };
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!found.skeleton && mesh.isSkinnedMesh) found.skeleton = mesh.skeleton;
  });
  return found.skeleton;
}

interface Measurement {
  height: number;
  /** 키 배율을 뺀 기본 키. 키를 줄였을 때 카메라까지 당겨지면 변화가 안 보인다. */
  baseHeight: number;
  head: THREE.Vector3;
  hands: THREE.Vector3;
  handSpan: number;
  feet: THREE.Vector3;
  chest: THREE.Vector3;
  /** 몸 아래 · 위 끝 높이(m) — 확대 중 옮길 수 있는 범위 */
  bottom: number;
  top: number;
  /** 지금 보이는 것 중 가장 높은 곳(머리카락 · 정수리) · 보이는 머리카락 끝(없으면 null) · 어깨선(쇄골) — 머리 보기 구도 */
  headTop: number;
  hairBottom: number | null;
  shoulder: number | null;
}

/** 보이는가 — 자신과 부모가 다 보일 때(골라 두지 않은 머리 · 옷 메시는 숨겨져 있다) */
function isShown(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

const visiblePiece = new THREE.Box3();
/** 보이는 메시만 — 지금 머리 꼭대기 · 머리카락 끝 */
function measureVisibleHead(avatar: THREE.Object3D) {
  let top = -Infinity;
  let hairBottom = Infinity;
  avatar.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isShown(mesh)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return;
    visiblePiece.copy(box).applyMatrix4(mesh.matrixWorld);
    top = Math.max(top, visiblePiece.max.y);
    if (/hair/i.test(mesh.name)) hairBottom = Math.min(hairBottom, visiblePiece.min.y);
  });
  return { top, hairBottom: Number.isFinite(hairBottom) ? hairBottom : null };
}

// 씬에서 캐릭터를 찾아 크기와 주요 부위 위치를 잰다 — 카메라 자리를 정하는 데만 쓴다.
const measuredBox = new THREE.Box3();
function measureCharacter(scene: THREE.Scene, heightScale: number): Measurement | null {
  const found: { avatar: THREE.Object3D | null } = { avatar: null };
  scene.traverse((object) => {
    if (!found.avatar && object.name === "NAJU-chibi-avatar" && object.visible) found.avatar = object;
  });
  const { avatar } = found;
  if (!avatar) return null;
  avatar.updateWorldMatrix(false, true);
  const box = computeGroupBox(avatar, measuredBox);
  if (box.isEmpty() || !Number.isFinite(box.min.y)) return null;
  const height = box.max.y - box.min.y;
  if (!(height > 0.05)) return null;
  const rig = findSkeleton(avatar);
  const bonePosition = (name: string) => {
    const bone = rig?.getBoneByName(name);
    return bone ? new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld) : null;
  };
  const leftHand = bonePosition("hand_l");
  const visibleHead = measureVisibleHead(avatar);
  const rightHand = bonePosition("hand_r");
  return {
    height,
    baseHeight: height / Math.max(0.01, heightScale),
    head: bonePosition("head") ?? new THREE.Vector3(0, height * 0.88, 0),
    hands:
      leftHand && rightHand
        ? leftHand.clone().add(rightHand).multiplyScalar(0.5)
        : new THREE.Vector3(0, height * 0.5, 0),
    handSpan: leftHand && rightHand ? leftHand.distanceTo(rightHand) : height * 0.6,
    feet: new THREE.Vector3(0, box.min.y + height * 0.05, 0),
    chest: bonePosition("spine_03") ?? new THREE.Vector3(0, height * 0.66, 0),
    bottom: box.min.y,
    top: box.max.y,
    headTop: Number.isFinite(visibleHead.top) ? visibleHead.top : box.max.y,
    hairBottom: visibleHead.hairBottom,
    shoulder: bonePosition("clavicle_l")?.y ?? null,
  };
}

interface Framing {
  center: THREE.Vector3;
  height: number;
}

/** 어느 부위를 얼마나 크게 담을지 */
function computeFraming(view: PreviewView, measured: Measurement): Framing {
  const H = measured.baseHeight;
  if (view === "head") {
    // 머리카락까지 다 — 머리 뼈(턱 밑)를 가운데로 담으면 정수리가 잘리고 얼굴만 커서 머리색이 안 보였다(미르 11/11).
    // 위는 보이는 머리 꼭대기, 아래는 어깨선 — 긴 머리면 머리끝까지(가슴께에서 멈춘다)
    const top = measured.headTop + H * 0.03;
    const shoulder = measured.shoulder ?? measured.head.y - H * 0.07;
    const low = Math.max(measured.chest.y, Math.min(shoulder, measured.hairBottom ?? Infinity) - H * 0.02);
    return {
      center: new THREE.Vector3(measured.head.x, (top + low) / 2, measured.head.z),
      height: (top - low) * 1.08,
    };
  }
  // 손은 좌우를 함께 봐야 비교가 된다 — 두 손 사이 거리에 맞춰 물러난다
  if (view === "hands") return { center: measured.hands.clone(), height: Math.max(H * 0.34, measured.handSpan * 1.05) };
  if (view === "feet") return { center: measured.feet.clone(), height: H * 0.26 };
  // 이름 단계 — 가슴만 담으면 머리가 잘려 가슴과 머리 사이를 중심으로 넉넉히 담는다
  if (view === "upperBody") return { center: measured.chest.clone().lerp(measured.head, 0.55), height: H * 0.62 };
  // 전신은 키를 키운 만큼만 더 담는다(줄일 때는 그대로 둬야 작아진 것이 보인다)
  return { center: new THREE.Vector3(0, H * 0.5, 0), height: H * 1.08 * Math.max(1, measured.height / H) };
}

/** 카메라가 위아래로 기울 수 있는 각(라디안). 세로 끌기는 각이 아니라 옮기기라(11/10) 지금은 처음 각(0.06) 그대로 쓴다 */
const MIN_PITCH = -0.4;
const MAX_PITCH = 0.75;
/** 카메라가 내려갈 수 있는 가장 낮은 높이(m) — 바닥 밑에서 올려다보지 않는다 */
const MIN_CAMERA_Y = 0.1;

interface OrbitPlacement {
  center: THREE.Vector3;
  yaw: number;
  distance: number;
  /** 빈 자리 가운데가 화면 가운데에서 떨어진 정도(화면 폭 · 높이 비율) */
  cx: number;
  cy: number;
  /** 카메라 거리에서 화면 전체가 담는 세계 크기 */
  worldWidth: number;
  worldHeight: number;
}

/** 궤도 위 카메라 자리 — 기준점(center)이 화면의 빈 자리 가운데에 오게 카메라와 목표를 같이 민다(시선 방향은 그대로) */
function placeOrbitCamera(
  { center, yaw, distance, cx, cy, worldWidth, worldHeight }: OrbitPlacement,
  elevation: number,
) {
  const forward = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation),
  );
  // forward 는 목표 → 카메라라 시선은 그 반대다. 화면 오른쪽은 cross(위, forward) — 반대로 잡으면 캐릭터가 UI 쪽으로 밀린다.
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const shift = right
    .clone()
    .multiplyScalar(-cx * worldWidth)
    .add(up.clone().multiplyScalar(-cy * worldHeight));
  return {
    position: center.clone().addScaledVector(forward, distance).add(shift),
    lookTarget: center.clone().add(shift),
    up,
  };
}

interface PreviewCameraProps {
  orbit: RefObject<OrbitState>;
  metrics: RefObject<ViewMetrics | null>;
  view: PreviewView;
  heightScale: number;
  safeArea: SafeArea;
  reduceMotion: boolean;
  measureKey: string;
}

// 카메라를 궤도 위에 놓고 UI 를 뺀 빈 자리 한가운데에 캐릭터를 담는다. 패널 폭이 달라져도 머리·손·발이 숨지 않는다.
function PreviewCamera({ orbit, metrics, view, heightScale, safeArea, reduceMotion, measureKey }: PreviewCameraProps) {
  // three 객체는 반응형 값으로 잡지 않고 필요할 때 꺼내 쓴다
  const get = useThree((s) => s.get);
  const current = useRef({ center: new THREE.Vector3(0, 0.9, 0), height: 1.9, isFilled: false });
  const target = useRef<Framing>({ center: new THREE.Vector3(0, 0.9, 0), height: 1.9 });
  const heightScaleRef = useRef(1);
  const safeAreaRef = useRef(safeArea);
  const frameCount = useRef(0);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const fillLight = useRef<THREE.DirectionalLight>(null);
  // 부위를 바꾸면 자세도 바뀐다(손 보기). 고른 순간 한 번만 재면 아직 바뀌기 전 손 좌표를 담아
  // 손이 화면 밖으로 나간다 — 자세가 건너가는 동안 몇 프레임 더 잰다.
  const remeasureFrames = useRef(0);
  /** 몸 아래 · 위 끝 — 보기와 상관없이 늘 잰다(키 · 옷 · 성별이 바뀌어도 옮길 범위가 맞게) */
  const body = useRef({ bottom: 0, top: 1.9 });
  const focus = useRef(new THREE.Vector3());

  useEffect(() => {
    heightScaleRef.current = heightScale;
    // 머리 · 손 · 발 보기도 키를 바꾸면 그 부위가 움직인다 — 잠깐 다시 잰다
    remeasureFrames.current = 40;
  }, [heightScale]);
  useEffect(() => {
    safeAreaRef.current = safeArea;
  }, [safeArea]);

  useEffect(() => {
    const { scene } = get();
    remeasureFrames.current = 40; // 10프레임마다 재니 ≈ 0.7초
    const measured = measureCharacter(scene, heightScaleRef.current);
    if (!measured) return;
    target.current = computeFraming(view, measured);
    if (!current.current.isFilled || reduceMotion) {
      current.current.center.copy(target.current.center);
      current.current.height = target.current.height;
      current.current.isFilled = true;
    }
  }, [view, measureKey, get, reduceMotion]);

  useFrame((_, delta) => {
    const { camera, scene, size } = get();
    const perspective = camera as THREE.PerspectiveCamera;
    const s = current.current;
    frameCount.current += 1;
    if (remeasureFrames.current > 0) remeasureFrames.current -= 1;
    // 몸 끝은 늘, 담을 자리는 전신(키 슬라이더를 따라가야 한다)이거나 다른 부위가 자세 · 키가 건너가는 동안만 다시 잰다
    if (frameCount.current % 10 === 0) {
      const measured = measureCharacter(scene, heightScaleRef.current);
      if (measured) {
        body.current.bottom = measured.bottom;
        body.current.top = measured.top;
      }
      if (measured && (!s.isFilled || view === "full" || remeasureFrames.current > 0)) {
        target.current = computeFraming(view, measured);
        if (!s.isFilled) {
          s.center.copy(target.current.center);
          s.height = target.current.height;
          s.isFilled = true;
        }
      }
    }
    const blend = reduceMotion ? 1 : 1 - Math.exp(-delta * 7);
    s.center.lerp(target.current.center, blend);
    s.height += (target.current.height - s.height) * blend;

    // 1) UI 를 뺀 빈 자리
    const area = safeAreaRef.current;
    const freeWidth = Math.max(160, size.width - area.left - area.right);
    const freeHeight = Math.max(160, size.height - area.top - area.bottom);
    // 2) 빈 자리에 담을 높이 → 화면 전체의 세계 높이 → 거리. 확대 · 축소(zoom)는 거리만 바꾼다
    const fitHeight = s.height * (size.height / freeHeight);
    const distance = (fitHeight / (2 * Math.tan((perspective.fov * Math.PI) / 360))) * orbit.current.zoom;
    // 그 거리에서 화면 전체가 담는 세계 크기 — 4) 의 화면 이동은 이 크기로 재야 한다. zoom 을 빼고 재면 확대할수록
    // 캐릭터가 빈 자리 가운데에서 1/zoom 배 바깥으로 밀려(PC 는 왼쪽 화면 밖으로) 나갔다(미르 11/10 · 해랑 #92 도 같은 고침).
    // 해랑 #92 의 「축소할 때 발밑 붙잡기」는 축소가 없어져(기본 화면까지만) 뺐다
    const worldHeight = fitHeight * orbit.current.zoom;
    const worldWidth = worldHeight * (size.width / size.height);

    // 확대 중 위아래로 옮긴 기준점 — 화면(빈 자리)이 몸 끝 밖으로 나가지 않는 데까지만. 몸이 화면보다 작으면(기본 화면 근처)
    // 그 보기의 기본 구도를 지킨다. 그 보기의 기준점 자체는 늘 허용한다(머리 보기는 기준점이 머리 끝 가까이라)
    const half = (s.height * orbit.current.zoom) / 2;
    const low = body.current.bottom + half;
    const high = body.current.top - half;
    const base = s.center.y;
    const liftRange = low > high ? [base, base] : [Math.min(low, base), Math.max(high, base)];
    const lifted = THREE.MathUtils.clamp(base + orbit.current.lift, liftRange[0], liftRange[1]);
    orbit.current.lift = lifted - base;
    focus.current.set(s.center.x, lifted, s.center.z);
    metrics.current = {
      worldHeight,
      freeCenterY: area.top + freeHeight / 2,
      height: size.height,
      focusY: lifted,
      baseY: base,
      zoom: orbit.current.zoom,
    };

    // 3) 궤도 위 카메라 · 4) 빈 자리 한가운데로 화면 이동
    const placement: OrbitPlacement = {
      center: focus.current,
      yaw: orbit.current.yaw,
      distance,
      cx: (area.left + freeWidth / 2) / size.width - 0.5,
      cy: 0.5 - (area.top + freeHeight / 2) / size.height,
      worldWidth,
      worldHeight,
    };
    let elevation = THREE.MathUtils.clamp(orbit.current.pitch, MIN_PITCH, MAX_PITCH);
    let pose = placeOrbitCamera(placement, elevation);
    // 카메라가 바닥 밑으로 가면(발 보기 · 아래에서 올려다보며 축소) 높이만 눌러 올리지 않고 올려다보는 각을 줄인다 — 높이만 올리면
    // 시선이 틀어져 캐릭터가 빈 자리 가운데에서 옆으로 밀렸다(Codex 01). 높이는 각에 따라 늘기만 해 반씩 좁혀 찾는다
    if (pose.position.y < MIN_CAMERA_Y && placeOrbitCamera(placement, MAX_PITCH).position.y >= MIN_CAMERA_Y) {
      let low = elevation;
      let high = MAX_PITCH;
      for (let i = 0; i < 16; i += 1) {
        const middle = (low + high) / 2;
        if (placeOrbitCamera(placement, middle).position.y < MIN_CAMERA_Y) low = middle;
        else high = middle;
      }
      elevation = high;
      pose = placeOrbitCamera(placement, elevation);
    }
    const { position, lookTarget, up } = pose;

    perspective.position.set(position.x, Math.max(MIN_CAMERA_Y, position.y), position.z);
    perspective.lookAt(lookTarget);
    perspective.near = Math.max(0.05, distance * 0.05);
    perspective.far = distance * 14 + 24;
    perspective.updateProjectionMatrix();

    // 5) 빛 방향은 고정하고 보조광만 카메라를 따라간다 — 전부 붙이면 평평해져 얼굴 굴곡이 사라진다
    if (keyLight.current) {
      keyLight.current.target.position.copy(s.center);
      keyLight.current.target.updateMatrixWorld();
    }
    if (fillLight.current) {
      fillLight.current.position.copy(perspective.position).addScaledVector(up, 0.4);
      fillLight.current.target.position.copy(s.center);
      fillLight.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {/* 주광 — 왼쪽 위 앞. 얼굴과 몸의 굴곡을 만든다 */}
      <directionalLight ref={keyLight} position={[-2.4, 3.4, 2.6]} intensity={1.3} color="#FFF6EA" />
      {/* 윤곽광 — 뒤 오른쪽. 머리·어깨를 배경에서 떼어 낸다 */}
      <directionalLight position={[2.6, 2.2, -3.0]} intensity={0.85} color="#9AD8E8" />
      {/* 보조광 — 카메라를 따라가며 그림자 쪽이 검게 죽지 않을 만큼만 */}
      <directionalLight ref={fillLight} intensity={0.28} color="#CFE6F2" />
      <hemisphereLight args={["#DCEAF5", "#1A2B38", 0.46]} />
      <ambientLight intensity={0.18} />
    </>
  );
}

function VisibilityWatcher({ onChange }: { onChange: (visible: boolean) => void }) {
  useEffect(() => {
    const handleChange = () => onChange(!document.hidden);
    document.addEventListener("visibilitychange", handleChange);
    // 붙이는 사이에 탭이 다시 보이게 됐으면 그 알림을 놓친다 — 뒤 탭에서 열린 화면이 보이는데도 그리기를 멈춘 채(frameloop never)
    // 캐릭터가 안 나왔다(11/10). 붙인 뒤 지금 상태로 한 번 맞춘다
    handleChange();
    return () => document.removeEventListener("visibilitychange", handleChange);
  }, [onChange]);
  return null;
}

// 헤드리스 검사(tools/check-character-creation.mjs)가 씬을 직접 잰다
function CharacterCreationDevHook({ displayKey }: { displayKey: string }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    exposeDevHook("characterCreation", { get, THREE, displayKey });
    return () => {
      if (window.__game) delete window.__game.characterCreation;
    };
  }, [get, displayKey]);
  return null;
}

interface CharacterPreviewProps {
  config: MeshAppearanceConfig;
  view?: PreviewView;
  pose?: string;
  quality?: PreviewQuality;
  safeArea?: SafeArea;
  onControlsReady?: (controls: PreviewControls) => void;
  /** 새 착장 모델을 읽는 동안 true */
  onLoadingChange?: (isLoading: boolean) => void;
}

const DEFAULT_SAFE_AREA: SafeArea = { left: 0, right: 0, top: 0, bottom: 0 };

export default function CharacterPreview({
  config,
  view = "full",
  pose = "Idle_Loop",
  quality = "medium",
  safeArea = DEFAULT_SAFE_AREA,
  onControlsReady,
  onLoadingChange,
}: CharacterPreviewProps) {
  const playerRef = useRef(createStandingState());
  // 카메라 조작값은 여기서 들고, 바깥에는 손잡이만 넘긴다(바깥 ref 를 여기서 바꾸면 추적이 어렵다)
  const orbit = useRef<OrbitState>(startOrbit(view));
  // 「시점 초기화」가 지금 보기의 처음 각으로 돌아가게 — 렌더 중에 ref 를 쓰지 않는다
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const metrics = useRef<ViewMetrics | null>(null);
  /** 휠 · 핀치 한 동작 동안 붙든 몸 높이 — 끌기 · 초기화 · 보기 바꿈 · 손을 대고 뗄 때 버린다(앞 동작 기준점을 다시 쓰면 그사이 옮긴 것이 되돌아가 튄다, Codex 06) */
  const anchor = useRef<{ clientY: number; worldY: number; at: number } | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const fileKey = formatOutfitKey(config);
  const [displayKey, setDisplayKey] = useState(fileKey);
  const [isVisible, setIsVisible] = useState(() => typeof document === "undefined" || !document.hidden);

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  const displayConfig = useMemo(() => ({ ...config, ...parseOutfitKey(displayKey) }), [config, displayKey]);
  const isLoading = fileKey !== displayKey;

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // 보여 줄 한 벌이 붙고 한가해지면 나머지 조합을 하나씩 받는다. 성별이 바뀌면 앞 줄은 멈추고 다시 건다.
  // displayKey 는 지금 보는 조합을 건너뛰는 데만 쓴다 — 바뀌었다고 다시 걸지 않는다.
  const gender = config.gender;
  const readDisplayKey = useEffectEvent(() => displayKey);
  useEffect(() => {
    let isAlive = true;
    prefetchOtherOutfits(gender, () => isAlive, readDisplayKey());
    return () => {
      isAlive = false;
    };
  }, [gender]);

  const zoomMin = MIN_ZOOM[view];

  const handleWarmupReady = useCallback((key: string) => {
    setDisplayKey((previous) => (key === previous ? previous : key));
  }, []);

  useEffect(() => {
    onControlsReady?.({
      rotate: (radians) => {
        orbit.current.yaw += radians;
      },
      reset: () => {
        orbit.current = startOrbit(viewRef.current);
        anchor.current = null;
      },
    });
  }, [onControlsReady]);

  // 보기(전신 · 머리 · 손 · 발)를 바꾸면 그 보기의 기본 화면으로 — 전신에서 당겨 둔 배율 · 옮긴 자리가 머리 · 손 보기에 남으면
  // 너무 가깝다(해랑 #92). 돌린 각은 남긴다
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    orbit.current.zoom = INITIAL_ORBIT.zoom;
    orbit.current.lift = 0;
    orbit.current.pitch = startOrbit(view).pitch;
    anchor.current = null;
  }, [view]);

  /**
   * 화면 y(px)의 몸 높이를 붙든 채 확대 · 축소 — 가리킨 높이로 다가간다(세로만: 몸은 늘 무대 가로 가운데, 돌리는 축이 몸을 벗어나지 않게).
   * 굴리는 동안(커서가 그대로 · 0.4초 안)은 처음 가리킨 몸 높이를 붙든다 — 한 칸마다 다시 재면 확대 초반의 좁은 범위에 잘린 만큼
   * 잃어 발을 가리키고 확대해도 발까지 못 내려갔다
   */
  const zoomAt = useCallback(
    (factor: number, clientY: number | null) => {
      const after = THREE.MathUtils.clamp(orbit.current.zoom * factor, zoomMin, MAX_ZOOM);
      const measured = metrics.current;
      const rect = wrapper.current?.getBoundingClientRect();
      orbit.current.zoom = after;
      if (clientY === null || !measured || !rect || measured.height <= 0) return;
      // 가리킨 점이 빈 자리 가운데에서 아래로 떨어진 정도(화면 높이 비율)
      const below = (clientY - rect.top - measured.freeCenterY) / measured.height;
      const now = performance.now();
      const held = anchor.current;
      if (!held || Math.abs(held.clientY - clientY) > 6 || now - held.at > 400) {
        anchor.current = { clientY, worldY: measured.focusY - below * measured.worldHeight, at: now };
      }
      const target = anchor.current;
      if (!target) return;
      target.at = now;
      // 확대 뒤 그 몸 높이가 다시 커서 아래 오는 기준점 — 몸 끝 밖으로 나가는 만큼은 카메라가 잘라 낸다
      const worldHeightAfter = measured.worldHeight * (after / measured.zoom);
      orbit.current.lift = target.worldY + below * worldHeightAfter - measured.baseY;
    },
    [zoomMin],
  );

  // React 의 onWheel 은 passive 라 preventDefault 가 안 먹는다 — 직접 붙인다
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(event.deltaY * 0.0012), event.clientY);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  const twoFingerDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const twoFingerMiddleY = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? (a.y + b.y) / 2 : null;
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    anchor.current = null;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) pinchDistance.current = twoFingerDistance();
    else dragFrom.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const distance = twoFingerDistance();
      if (pinchDistance.current > 0 && distance > 0) zoomAt(pinchDistance.current / distance, twoFingerMiddleY());
      pinchDistance.current = distance;
      return;
    }
    if (!dragFrom.current) return;
    const dx = event.clientX - dragFrom.current.x;
    const dy = event.clientY - dragFrom.current.y;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    // 가로로 끌면 돌리기, 세로로 끌면 몸을 따라 위아래로 옮기기 — 손가락(커서)에 붙어 따라온다. 기본 화면(확대 전)에서는
    // 옮길 데가 없어 그대로다. 세로 끌기의 뜻은 확대 여부와 상관없이 같다(Codex 05 — 처음 보는 사람이 헷갈리지 않게)
    orbit.current.yaw -= dx * 0.008;
    anchor.current = null;
    const measured = metrics.current;
    if (measured && measured.height > 0)
      orbit.current.lift += (dy / measured.height) * measured.worldHeight * (orbit.current.zoom / measured.zoom);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    anchor.current = null;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = 0;
    // 두 손가락에서 하나를 떼면 남은 손가락 자리에서 다시 끈다 — 처음 누른 자리를 쓰면 화면이 튄다(Codex 05)
    const [remaining] = [...pointers.current.values()];
    dragFrom.current = remaining ? { ...remaining } : null;
  };

  const qualitySettings = QUALITY_SETTINGS[quality] ?? QUALITY_SETTINGS.medium;
  const activePose = getObservationPose(view, pose);
  // 렌더마다 새 객체를 넘기면 값이 그대로여도 아바타의 config 의존 효과가 다시 돈다
  const avatarConfig = useMemo(() => ({ ...displayConfig, motion: activePose }), [displayConfig, activePose]);

  return (
    <div
      ref={wrapper}
      style={wrapperStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      <Canvas
        shadows={false}
        frameloop={isVisible ? "always" : "never"}
        dpr={qualitySettings.dpr}
        camera={{ fov: 30, position: [0, 1, 3.6], near: 0.1, far: 60 }}
        // 캔버스는 투명하다 — 아래 CSS 배경이 화면 전체에 이어져야 한다
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl, scene }) => {
          gl.setClearAlpha(0);
          scene.background = null;
        }}
        style={{ background: "transparent" }}
      >
        <VisibilityWatcher onChange={setIsVisible} />
        <CharacterCreationDevHook displayKey={displayKey} />
        <PreviewCamera
          orbit={orbit}
          metrics={metrics}
          view={view}
          heightScale={displayConfig.heightScale ?? 1}
          safeArea={safeArea}
          reduceMotion={reduceMotion}
          // 머리 모양이 바뀌어도 다시 잰다 — 머리 보기 구도가 머리카락 꼭대기 · 끝을 따른다
          measureKey={`${displayKey}|${displayConfig.hair}`}
        />
        <Suspense fallback={null}>
          <ChibiGameAvatar
            visible
            playerRef={playerRef}
            config={avatarConfig}
            scale={1}
            body="meshy"
            toon={PREVIEW_TOON}
          />
          {/* 접지 그림자 두 장 — 발 밑은 또렷하게, 둘레는 넓고 흐리게(검은 원 한 장을 피한다).
              매 프레임 다시 굽는다(frames=1 이면 걷는 동안 그림자가 멈춘다).
              넓은 쪽은 blur 로 흐려 해상도가 드러나지 않아 반의반만 쓴다 — 그림자 굽기가 정지 프레임 비용의 큰 몫이다. */}
          <ContactShadows
            position={[0, 0.002, 0]}
            opacity={0.5}
            scale={3.2}
            blur={qualitySettings.blur}
            far={1.6}
            resolution={qualitySettings.shadowResolution}
            color="#04080E"
          />
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.24}
            scale={7}
            blur={4.5}
            far={2.4}
            resolution={Math.max(96, Math.round(qualitySettings.shadowResolution / 4))}
            color="#04080E"
          />
        </Suspense>
        <Suspense fallback={null}>
          <ModelWarmup config={config} fileKey={fileKey} onReady={handleWarmupReady} key={fileKey} />
        </Suspense>
      </Canvas>
    </div>
  );
}

const wrapperStyle: CSSProperties = { position: "absolute", inset: 0, touchAction: "none", cursor: "grab" };
