// 캐릭터 생성 화면의 3D 무대.
// 캔버스는 투명하고 배경은 그 아래 CSS 가 화면 끝까지 그린다 — 헤더·패널 뒤로도 같은 공간이 이어진다.
// 게임과 같은 렌더러(ChibiGameAvatar)·모델·툰 재질을 쓰고, 여기서는 관찰용 카메라·빛·모델 교체 대기만 얹는다.
import {
  Suspense,
  useCallback,
  useEffect,
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
import { meshBodyUrl, meshShoesUrl, type MeshAppearanceConfig } from "../avatar/meshAppearance";
import type { AvatarGender } from "../avatar/sidekickOptions";
import { DEFAULT_TOON } from "../avatar/toonMaterial";
import type { PreviewQuality, PreviewView } from "./previewViews";

// 얼굴까지 확대해 보는 화면이라 딱 떨어지는 명암 계단이 낮은 폴리곤 모서리를 따라 목선에서 톱니로 보였다 — 경계를 조금 푼다.
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
  zoom: number;
}

const INITIAL_ORBIT: OrbitState = { yaw: -0.3, pitch: 0.06, zoom: 1 };

// 손을 볼 때만 팔을 벌린 자세로 — 허리에 손을 얹은 대기 자세는 손을 가린다.
// 걷기는 팔이 흔들려 손이 이미 다 보이고, 바꾸면 골라 둔 걷기가 멋대로 멈춘다 — 대기일 때만 바꾼다.
function observationPose(view: PreviewView, pose: string): string {
  return view === "hands" && pose === "Idle_Loop" ? "A_TPose" : pose;
}

// 보통 dpr 1.25: 정지 프레임 비용 대부분이 그리기가 아니라 투명 캔버스 합성(픽셀 수 비례)이었다(dpr 1 이면 15.7ms 빠짐).
const QUALITY_SETTINGS: Record<PreviewQuality, { dpr: [number, number]; shadowResolution: number; blur: number }> = {
  low: { dpr: [1, 1], shadowResolution: 256, blur: 2.2 },
  medium: { dpr: [1, 1.25], shadowResolution: 512, blur: 2.6 },
  high: { dpr: [1, 2], shadowResolution: 1024, blur: 3.0 },
};

type OutfitKeySource = Pick<MeshAppearanceConfig, "gender" | "top" | "bottom" | "shoes">;

function makeFileKey(config: OutfitKeySource): string {
  return `${config.gender}|${config.top}|${config.bottom}|${config.shoes}`;
}

function parseFileKey(key: string): OutfitKeySource {
  const [gender, top, bottom, shoes] = key.split("|");
  return { gender: gender as AvatarGender, top: Number(top), bottom: Number(bottom), shoes: Number(shoes) };
}

// ── 다음에 고를 옷을 미리 받아 둔다 ──
// 옷은 전신 GLB(9.5~14.7MB)를 통째로 갈아 끼워 처음 고르는 조합은 몇 초 걸렸다. 한 벌을 보여 준 뒤 한가해지면
// 그 성별의 나머지 조합을 조용히 받아 둔다(반대 성별까지는 받지 않는다 — 100MB 를 다 받을 이유가 없다).
// 한 번에 하나씩, 한가할 때만: 여덟 개를 한꺼번에 받았더니 동시 연결(6개)이 차서 이용자가 누른 옷이 3.0초 밀렸다.
// 작은 신발부터 받아 두면 몸이 오는 동안 짝이 준비된다.
const OUTFIT_COMBOS = [
  { top: -1, bottom: -1 },
  { top: 0, bottom: -1 },
  { top: -1, bottom: 0 },
  { top: 0, bottom: 0 },
];

function whenIdle(task: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => task(), { timeout: 6000 });
  else setTimeout(task, 900);
}

function startPrefetch(gender: AvatarGender, isAlive: () => boolean, skipKey: string) {
  // 파일 이름은 성별·상의·하의 조합만 본다(신발 번호는 파일을 안 가른다)
  const [skipGender, skipTop, skipBottom] = skipKey.split("|");
  const queue: string[] = [];
  for (const combo of OUTFIT_COMBOS) {
    // 지금 보고 있는 조합은 이미 손에 있다
    if (gender === skipGender && String(combo.top) === skipTop && String(combo.bottom) === skipBottom) continue;
    const config = { gender, ...combo };
    queue.push(meshShoesUrl(config), meshBodyUrl(config));
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
    setTimeout(() => whenIdle(step), 1200);
  };
  whenIdle(step);
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

/** 새 착장 GLB 를 먼저 읽고, 다 읽히면 알린다 — 그 전에는 예전 모습을 그대로 보여 준다 */
function ModelWarmup({
  config,
  fileKey,
  onReady,
}: {
  config: OutfitKeySource;
  fileKey: string;
  onReady: (key: string) => void;
}) {
  const bodyUrl = meshBodyUrl(config);
  const shoesUrl = meshShoesUrl(config);
  useGLTF(bodyUrl);
  useGLTF(shoesUrl);
  useEffect(() => {
    onReady(fileKey);
  }, [onReady, fileKey, bodyUrl, shoesUrl]);
  return null;
}

// 캐릭터 상자는 정점을 훑지 않고 잰다. Box3.setFromObject 는 SkinnedMesh 마다 정점 9.8만 개를 모프·스키닝해
// 옷을 갈아입을 때마다 576ms 를 먹었다. 지오메트리 상자(한 번 구우면 GLB 캐시에 남는다)를 세계 행렬로 옮겨 합친다.
// 쉴 때 자세 기준이라 동작에 따라 상자가 흔들리지 않아 카메라용으로 오히려 낫다.
const pieceBox = new THREE.Box3();
function groupBox(group: THREE.Object3D, target: THREE.Box3): THREE.Box3 {
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
  const box = groupBox(avatar, measuredBox);
  if (box.isEmpty() || !Number.isFinite(box.min.y)) return null;
  const height = box.max.y - box.min.y;
  if (!(height > 0.05)) return null;
  const rig = findSkeleton(avatar);
  const bonePosition = (name: string) => {
    const bone = rig?.getBoneByName(name);
    return bone ? new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld) : null;
  };
  const leftHand = bonePosition("hand_l");
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
  };
}

interface Framing {
  center: THREE.Vector3;
  height: number;
}

/** 어느 부위를 얼마나 크게 담을지 */
function frameFor(view: PreviewView, measured: Measurement): Framing {
  const H = measured.baseHeight;
  if (view === "head") return { center: measured.head.clone(), height: H * 0.3 };
  // 손은 좌우를 함께 봐야 비교가 된다 — 두 손 사이 거리에 맞춰 물러난다
  if (view === "hands") return { center: measured.hands.clone(), height: Math.max(H * 0.34, measured.handSpan * 1.05) };
  if (view === "feet") return { center: measured.feet.clone(), height: H * 0.26 };
  // 이름 단계 — 가슴만 담으면 머리가 잘려 가슴과 머리 사이를 중심으로 넉넉히 담는다
  if (view === "upperBody") return { center: measured.chest.clone().lerp(measured.head, 0.55), height: H * 0.62 };
  // 전신은 키를 키운 만큼만 더 담는다(줄일 때는 그대로 둬야 작아진 것이 보인다)
  return { center: new THREE.Vector3(0, H * 0.5, 0), height: H * 1.08 * Math.max(1, measured.height / H) };
}

interface PreviewCameraProps {
  orbit: RefObject<OrbitState>;
  view: PreviewView;
  heightScale: number;
  safeArea: SafeArea;
  reduceMotion: boolean;
  measureKey: string;
}

// 카메라를 궤도 위에 놓고 UI 를 뺀 빈 자리 한가운데에 캐릭터를 담는다. 패널 폭이 달라져도 머리·손·발이 숨지 않는다.
function PreviewCamera({ orbit, view, heightScale, safeArea, reduceMotion, measureKey }: PreviewCameraProps) {
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
  // 손이 화면 밖으로 나갔다 — 자세가 건너가는 동안 몇 프레임 더 잰다.
  const remeasureFrames = useRef(0);

  useEffect(() => {
    heightScaleRef.current = heightScale;
  }, [heightScale]);
  useEffect(() => {
    safeAreaRef.current = safeArea;
  }, [safeArea]);

  useEffect(() => {
    const { scene } = get();
    remeasureFrames.current = 40; // 10프레임마다 재니 ≈ 0.7초
    const measured = measureCharacter(scene, heightScaleRef.current);
    if (!measured) return;
    target.current = frameFor(view, measured);
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
    // 전신은 키 슬라이더를 따라가야 해서 늘, 다른 부위는 자세가 건너가는 동안만 다시 잰다
    if ((!s.isFilled || view === "full" || remeasureFrames.current > 0) && frameCount.current % 10 === 0) {
      const measured = measureCharacter(scene, heightScaleRef.current);
      if (measured) {
        target.current = frameFor(view, measured);
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
    // 2) 빈 자리에 담을 높이 → 화면 전체의 세계 높이 → 거리
    const worldHeight = s.height * (size.height / freeHeight);
    const distance = (worldHeight / (2 * Math.tan((perspective.fov * Math.PI) / 360))) * orbit.current.zoom;
    const worldWidth = worldHeight * (size.width / size.height);

    // 3) 궤도 위 카메라
    const { yaw, pitch } = orbit.current;
    const elevation = THREE.MathUtils.clamp(pitch, -0.4, 0.75);
    const forward = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    const position = s.center.clone().addScaledVector(forward, distance);
    // 4) 빈 자리 한가운데로 화면을 옮긴다(카메라와 목표를 같이 밀면 시선 방향은 그대로다)
    const cx = (area.left + freeWidth / 2) / size.width - 0.5;
    const cy = 0.5 - (area.top + freeHeight / 2) / size.height;
    // forward 는 목표 → 카메라라 시선은 그 반대다. 화면 오른쪽은 cross(위, forward) — 반대로 잡으면 캐릭터가 UI 쪽으로 밀린다.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const shift = right
      .clone()
      .multiplyScalar(-cx * worldWidth)
      .add(up.clone().multiplyScalar(-cy * worldHeight));
    const lookTarget = s.center.clone().add(shift);
    position.add(shift);

    perspective.position.set(position.x, Math.max(0.1, position.y), position.z);
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
  const orbit = useRef<OrbitState>({ ...INITIAL_ORBIT });
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const fileKey = makeFileKey(config);
  const [displayKey, setDisplayKey] = useState(fileKey);
  const [isVisible, setIsVisible] = useState(() => typeof document === "undefined" || !document.hidden);

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  const displayConfig = useMemo(() => ({ ...config, ...parseFileKey(displayKey) }), [config, displayKey]);
  const isLoading = fileKey !== displayKey;

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // 보여 줄 한 벌이 붙고 한가해지면 나머지 조합을 하나씩 받는다. 성별이 바뀌면 옛 줄은 멈추고 다시 건다.
  const gender = config.gender;
  useEffect(() => {
    let isAlive = true;
    startPrefetch(gender, () => isAlive, displayKey);
    return () => {
      isAlive = false;
    };
    // displayKey 는 지금 보고 있는 것을 건너뛰는 데만 쓴다 — 바뀔 때마다 다시 걸 필요는 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender]);

  const handleWarmupReady = useCallback((key: string) => {
    setDisplayKey((previous) => (key === previous ? previous : key));
  }, []);

  useEffect(() => {
    onControlsReady?.({
      rotate: (radians) => {
        orbit.current.yaw += radians;
      },
      reset: () => {
        orbit.current = { ...INITIAL_ORBIT };
      },
    });
  }, [onControlsReady]);

  const zoomBy = useCallback((factor: number) => {
    orbit.current.zoom = THREE.MathUtils.clamp(orbit.current.zoom * factor, 0.45, 2.2);
  }, []);

  // React 의 onWheel 은 passive 라 preventDefault 가 안 먹는다 — 직접 붙인다
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(Math.exp(event.deltaY * 0.0012));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [zoomBy]);

  const twoFingerDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
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
      if (pinchDistance.current > 0 && distance > 0) zoomBy(pinchDistance.current / distance);
      pinchDistance.current = distance;
      return;
    }
    if (!dragFrom.current) return;
    const dx = event.clientX - dragFrom.current.x;
    const dy = event.clientY - dragFrom.current.y;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    orbit.current.yaw -= dx * 0.008;
    orbit.current.pitch = THREE.MathUtils.clamp(orbit.current.pitch + dy * 0.005, -0.4, 0.75);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = 0;
    if (pointers.current.size === 0) dragFrom.current = null;
  };

  const qualitySettings = QUALITY_SETTINGS[quality] ?? QUALITY_SETTINGS.medium;
  const activePose = observationPose(view, pose);
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
          view={view}
          heightScale={displayConfig.heightScale ?? 1}
          safeArea={safeArea}
          reduceMotion={reduceMotion}
          measureKey={displayKey}
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
              넓은 쪽은 blur 로 흐려 해상도가 드러나지 않아 반의반으로 줄였다 — 둘이 정지 프레임의 25~30% 를 먹었다. */}
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
