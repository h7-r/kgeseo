import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { runWhenIdle } from "@/lib/idle";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";

import AngamCliff, { CLIFF_TEXTURE_URL } from "./AngamCliff";
import { MistBanks } from "./Atmosphere";
import FinishPass from "./FinishPass";
import { followHomeScroll } from "./homeScroll";
import { journeyInput, sampleJourney } from "./journey";
import { Ridges, Sky } from "./Landscape";
import { NAJU_PROPS_URL, useNajuProps } from "./najuProps";
import SealFragments from "./SealFragments";
import Sites from "./Sites";
import { storyAt, type StoryState } from "./story";
import Water from "./Water";
import { createSharedUniforms, PALETTE, type SharedUniforms } from "./world";

// 「왜곡」 — 강가의 평범한 지금 건물들이 왜곡에 휩쓸려 옛 나루의 모습과 뒤섞이고, 세계가 게임 모습으로 굳고,
// 앙암 앞에서 봉인 조각이 맞물려 흔들림이 멎는다. 홈을 내려가는 동안 카메라가 강을 따라 미끄러진다(story.ts).

// 장면 코드를 받는 즉시 절벽 그림·게임 모형도 받기 시작한다. 셰이더를 굽는 동안 같이 내려온다.
useLoader.preload(THREE.TextureLoader, CLIFF_TEXTURE_URL);
useLoader.preload(GLTFLoader, NAJU_PROPS_URL);

interface Quality {
  dpr: number;
  samples: number;
  reflectionScale: number;
}

// 느린 기기는 PerformanceMonitor 가 한 단씩 내린다. 지오메트리는 그대로 두고 픽셀 수만 줄인다.
const QUALITY_TIERS: readonly Quality[] = [
  { dpr: 0.75, samples: 0, reflectionScale: 0.25 },
  { dpr: 0.9, samples: 0, reflectionScale: 0.28 },
  // 늘 그리는 배경이라 dpr 1 위로는 올리지 않는다 — 고밀도 화면에서 MSAA 를 얹은 단계는 60 장을 못 지켰다.
  { dpr: 1, samples: 0, reflectionScale: 0.3 },
];
const START_TIER = QUALITY_TIERS.length - 1;

const canvasStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

// 캔버스는 마우스를 받지 않는다(pointer-events: none). 창에서 직접 듣는다.
const pointer = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
}

interface CameraRigProps {
  reducedMotion: boolean;
  sky: RefObject<THREE.Mesh | null>;
  uniforms: SharedUniforms;
  story: StoryState;
  /** 카메라가 실제로 선 진행도 — 강가 자리들이 같은 값을 읽는다. */
  progress: { value: number };
}

/**
 * 진행도를 따라가는 카메라. 스크롤을 홱 넘겨도 미끄러지듯 따라가고, 마우스엔 고개만 살짝 돌린다.
 * 이야기(왜곡·과거·게임)도 카메라가 실제로 선 자리의 진행도로 정한다 — 화면과 이야기가 어긋나지 않게.
 */
function CameraRig({ reducedMotion, sky, uniforms, story, progress }: CameraRigProps) {
  const { camera } = useThree();
  const progressRef = useRef(-1);
  const position = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const lean = useRef({ x: 0, y: 0 });

  // 다른 쪽에 다녀오면 진행도가 처음으로 돌아간다. 거슬러 날아가지 않게 바로 붙인다.
  useEffect(() => {
    const snap = () => {
      progressRef.current = -1;
    };
    window.addEventListener(PAGE_CHANGE_EVENT, snap);
    return () => window.removeEventListener(PAGE_CHANGE_EVENT, snap);
  }, []);

  // 다른 것들보다 먼저(-1) — 이 프레임의 카메라·이야기 값을 정해 둔다.
  useFrame((_, delta) => {
    const goal = journeyInput.progress;
    const step = Math.min(delta, 0.1);
    progressRef.current =
      progressRef.current < 0 || reducedMotion
        ? goal
        : progressRef.current + (goal - progressRef.current) * (1 - Math.exp(-step * 2.6));
    sampleJourney(progressRef.current, position, target);

    progress.value = progressRef.current;
    storyAt(progressRef.current, story);
    uniforms.uDistort.value = story.distort;
    uniforms.uGame.value = story.game;

    if (!reducedMotion) {
      lean.current.x += (pointer.x - lean.current.x) * (1 - Math.exp(-step * 2));
      lean.current.y += (pointer.y - lean.current.y) * (1 - Math.exp(-step * 2));
      position.x += lean.current.x * 0.7;
      position.y -= lean.current.y * 0.35;
      target.x += lean.current.x * 2.2;
      target.y -= lean.current.y * 1.2;
    }
    camera.position.copy(position);
    camera.lookAt(target);
    // 왜곡이 짙을수록 세계가 미세하게 기운다.
    if (!reducedMotion) camera.rotateZ(Math.sin(uniforms.uTime.value * 0.7) * 0.012 * story.distort);
    sky.current?.position.copy(camera.position);
  }, -1);

  return null;
}

/**
 * 셰이더를 첫 프레임에 컴파일하면 히어로가 걷히는 순간 멈칫한다. 붙자마자 한가할 때 미리 컴파일하고
 * 한 장을 그려 반사·마무리 버퍼까지 데워 둔다(frameloop 가 never 여도 advance 는 그린다).
 * 끝나면 onPrewarmed 로 알린다(RiverScene 이 바깥에 「준비됨」을 알린다).
 */
function ShaderPrewarm({ onPrewarmed }: { onPrewarmed: () => void }) {
  const { gl, scene, camera, advance } = useThree();

  useEffect(() => {
    let disposed = false;
    let cancelDraw: (() => void) | null = null;
    const cancelCompile = runWhenIdle(
      () => {
        gl.compileAsync(scene, camera)
          .then(() => {
            if (disposed) return;
            cancelDraw = runWhenIdle(
              () => {
                if (disposed) return;
                advance(performance.now());
                onPrewarmed();
              },
              1500,
              300,
            );
          })
          .catch(() => {});
      },
      1500,
      300,
    );
    return () => {
      disposed = true;
      cancelCompile();
      cancelDraw?.();
    };
  }, [gl, scene, camera, advance, onPrewarmed]);

  return null;
}

/** 홈 스크롤을 진행도로 옮긴다. 바뀔 때마다 한 장 다시 그리게 알려 frameloop 가 demand 일 때(동작 줄이기)도 따라온다. */
function FollowHomeScroll() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => followHomeScroll(invalidate), [invalidate]);
  return null;
}

/** 그린 프레임마다 시각을 남긴다 — 그리기가 멈췄는지 RiverScene 의 감시가 본다. */
function Heartbeat({ beat }: { beat: { current: number } }) {
  useFrame(() => {
    beat.current = performance.now();
  });
  return null;
}

interface WorldProps {
  quality: Quality;
  visible: boolean;
  reducedMotion: boolean;
  followHome: boolean;
  onPrewarmed: () => void;
  beat: { current: number };
}

function World({ quality, visible, reducedMotion, followHome, onPrewarmed, beat }: WorldProps) {
  const uniforms = useMemo(() => createSharedUniforms(), []);
  const story = useMemo<StoryState>(() => ({ distort: 0, game: 0, seal: 0, fragments: 0 }), []);
  const progress = useMemo(() => ({ value: 0 }), []);
  const lockPulse = useMemo(() => ({ value: 0 }), []);
  const lockCenter = useMemo(() => new THREE.Vector2(0.5, 0.5), []);
  const skyRef = useRef<THREE.Mesh>(null);
  const pixelRatio = useThree((state) => state.viewport.dpr);

  useFrame((_, delta) => {
    if (!reducedMotion) uniforms.uTime.value += Math.min(delta, 0.1);
  });

  return (
    <>
      <Sky uniforms={uniforms} skyRef={skyRef} />
      <Ridges uniforms={uniforms} />
      <Water uniforms={uniforms} reflectionScale={quality.reflectionScale} />
      <Suspense fallback={null}>
        <AngamCliff uniforms={uniforms} />
        <RiverSites uniforms={uniforms} progress={progress} pixelRatio={pixelRatio} />
      </Suspense>
      <MistBanks uniforms={uniforms} count={12} />
      <SealFragments uniforms={uniforms} story={story} lockPulse={lockPulse} lockCenter={lockCenter} />

      <CameraRig
        reducedMotion={Boolean(reducedMotion)}
        sky={skyRef}
        uniforms={uniforms}
        story={story}
        progress={progress}
      />
      {/* 쉬는 동안(다른 쪽·히어로가 덮음)엔 스크롤을 듣지 않는다. */}
      {followHome && visible && <FollowHomeScroll />}
      <FinishPass
        uniforms={uniforms}
        lockPulse={lockPulse}
        lockCenter={lockCenter}
        samples={quality.samples}
        animated={!reducedMotion}
      />
      <ShaderPrewarm onPrewarmed={onPrewarmed} />
      <Heartbeat beat={beat} />
    </>
  );
}

interface RiverSitesProps {
  uniforms: SharedUniforms;
  progress: { value: number };
  pixelRatio: number;
}

/** 게임 모형 묶음을 받아 강가 자리들을 세운다(받는 동안은 비워 둔다). */
function RiverSites({ uniforms, progress, pixelRatio }: RiverSitesProps) {
  const props = useNajuProps();
  return <Sites uniforms={uniforms} props={props} progress={progress} pixelRatio={pixelRatio} />;
}

interface RiverSceneProps {
  visible?: boolean;
  reducedMotion?: boolean;
  /** true 면 홈 스크롤을 직접 읽는다. 시험 화면은 끄고 journeyInput 을 손으로 쓴다. */
  followHome?: boolean;
  /**
   * 화면을 맡을 수 있는지 — 셰이더를 굽고 첫 장을 그리면 true. WebGL 문맥을 잃거나, 떼어지거나,
   * 그려야 할 때 그리기가 멈추면 false. 바깥(SiteBackdrop)은 false 면 구역 바탕을 원래대로 돌린다.
   */
  onReadyChange?: (ready: boolean) => void;
}

/** 그려야 하는데 이만큼(ms) 프레임이 없으면 멈춘 것으로 본다. */
const STALL_LIMIT = 2500;

export default function RiverScene({
  visible = true,
  reducedMotion = false,
  followHome = true,
  onReadyChange,
}: RiverSceneProps) {
  const [tier, setTier] = useState(START_TIER);
  const beat = useRef(0);
  const readyRef = useRef(false);
  const lostRef = useRef(false);
  const notifyRef = useRef(onReadyChange);
  useEffect(() => {
    notifyRef.current = onReadyChange;
  }, [onReadyChange]);
  const report = useCallback((ready: boolean) => {
    if (readyRef.current === ready) return;
    readyRef.current = ready;
    notifyRef.current?.(ready);
  }, []);
  const handlePrewarmed = useCallback(() => {
    if (!lostRef.current) report(true);
  }, [report]);

  // 떼어지면(쪽을 떠남·개발 중 모듈 교체로 다시 붙음) 바로 「준비 안 됨」 — 새 장면이 다시 구울 때까지 바탕을 돌려 둔다.
  useEffect(() => () => report(false), [report]);

  // 그려야 하는데 프레임이 끊겼으면 바탕을 돌려 두고, 다시 그리기 시작하면 장면으로 돌아온다.
  // 동작 줄이기(스크롤할 때만 그림)와 탭이 숨은 동안은 프레임이 없는 게 정상이라 보지 않는다.
  useEffect(() => {
    if (!visible || reducedMotion) return undefined;
    const since = performance.now();
    const timer = window.setInterval(() => {
      if (lostRef.current || document.visibilityState !== "visible") return;
      const last = Math.max(beat.current, since);
      if (performance.now() - last > STALL_LIMIT) report(false);
      else if (beat.current > since) report(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [visible, reducedMotion, report]);
  const quality = QUALITY_TIERS[tier];
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;

  return (
    <Canvas
      dpr={Math.min(quality.dpr, Math.max(1, devicePixelRatio))}
      camera={{ fov: 46, near: 0.5, far: 4000, position: [0, 20, 46] }}
      // 동작 줄이기는 스크롤로 자리가 바뀔 때만 한 장씩 그린다.
      frameloop={!visible ? "never" : reducedMotion ? "demand" : "always"}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.debug.checkShaderErrors = !import.meta.env.PROD;
        gl.setClearColor(PALETTE.zenith, 1);
        // GPU 가 문맥을 거둬 가면(드라이버 재시작·자원 부족) 캔버스는 비어 버린다. 곧바로 바탕을 돌린다.
        gl.domElement.addEventListener("webglcontextlost", () => {
          lostRef.current = true;
          report(false);
        });
      }}
      style={canvasStyle}
    >
      {/* 기본 상한(60)은 60Hz 화면에서 넘을 수 없어 한 번 내려가면 못 올라온다. 상한을 주사율 바로 아래로,
          하한은 넉넉히 높여 「55장쯤에서 버티는」 단계에 머물지 않게 한다. */}
      <PerformanceMonitor
        bounds={(refreshRate) => [refreshRate * 0.88, refreshRate * 0.97]}
        // 0.2초씩 여덟 번(1.6초)을 보고 판단한다 — 항상 그리는 배경이라 느린 기기에서 빨리 물러나야 한다.
        ms={200}
        iterations={8}
        onDecline={() => setTier((value) => Math.max(0, value - 1))}
        onIncline={() => setTier((value) => Math.min(QUALITY_TIERS.length - 1, value + 1))}
        // 오르내림을 세 번 넘게 반복하면 거기서 멈춘다(뒤집힘 수에는 오름도 들어간다 — 그때 화질을 깎지 않는다).
        flipflops={3}
      />
      <World
        quality={quality}
        visible={visible}
        reducedMotion={reducedMotion}
        followHome={followHome}
        onPrewarmed={handlePrewarmed}
        beat={beat}
      />
    </Canvas>
  );
}
