import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { runWhenIdle } from "@/lib/idle";
import { BACKDROP_ORIGIN } from "@/lib/layout";
import { clamp01 } from "@/lib/math";
import { PAGE_CHANGE_EVENT } from "@/lib/pageEvents";
import { COLOR } from "@/styles/tokens";

// CSS 로 확대하면 납작한 그림이 커질 뿐이다. 진짜 공간에서 카메라를 z 로 밀어야
// 가까운 것과 먼 것이 다른 속도로 지나가는 시차가 생긴다.
// 글을 읽는 동안 눈이 피로하지 않게, 배경은 있는 줄 알아볼 정도로만 옅게 그린다.

const BACKGROUND = "#030509"; // 페이지 바탕(--color-bg)과 거의 같은 색.
const SKY = "#c5c8cb";

// 스크롤 0~1 이 지나는 통로 길이. 한 화면 굴릴 때 한 칸쯤 가도록 잡았다.
const TUNNEL_LENGTH = 210;
const RING_COUNT = 8;
const SHARD_COUNT = 260;

const canvasStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

const RINGS = Array.from({ length: RING_COUNT }, (_, i) => ({
  z: -(i + 1) * (TUNNEL_LENGTH / RING_COUNT),
  // 반지름이 다 같으면 원기둥으로 보인다. 들쭉날쭉해야 좁아졌다 넓어지는 통로로 읽힌다.
  radius: 6 + Math.sin(i * 1.7) * 3.6,
  tilt: [Math.sin(i * 0.9) * 0.26, Math.cos(i * 1.3) * 0.26, i * 0.4] satisfies THREE.EulerTuple,
  opacity: 0.17 - i * 0.01,
}));

/** 카메라가 통과하는 고리들. 고리를 지나는 순간이 깊이를 가장 분명하게 알려 준다. */
function TunnelRings() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    // 멈춰 있으면 터널이 죽어 보인다.
    if (groupRef.current) groupRef.current.rotation.z += delta * 0.02;
  });

  return (
    <group ref={groupRef}>
      {RINGS.map((ring, i) => (
        <mesh key={i} position={[0, 0, ring.z]} rotation={ring.tilt}>
          {/* 더 가늘면 20 단위만 멀어져도 1px 이 안 돼 사라진다. */}
          <torusGeometry args={[ring.radius, 0.045, 6, 96]} />
          <meshBasicMaterial color={i % 3 === 0 ? SKY : COLOR.arc} transparent opacity={Math.max(0.05, ring.opacity)} />
        </mesh>
      ))}
    </group>
  );
}

/** 낱장 기록의 자리. 장면 모듈을 불러올 때 한 번만 흩어 둔다. */
const SHARD_MATRICES: readonly THREE.Matrix4[] = (() => {
  const dummy = new THREE.Object3D();
  const list: THREE.Matrix4[] = [];
  for (let i = 0; i < SHARD_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    // 가운데는 카메라가 지나는 길이라 비워 둔다.
    const distance = 3.6 + Math.random() * 15;
    dummy.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.75, -Math.random() * TUNNEL_LENGTH);
    dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const size = 0.5 + Math.random() * 0.9;
    dummy.scale.set(size * 0.72, size, 1);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  }
  return list;
})();

/**
 * 통로 벽에 흩어진 낱장 기록. 얇은 판이라 지나갈 때 선↔면으로 뒤집혀 종이처럼 읽힌다.
 * InstancedMesh 라 그리기 호출은 한 번이다.
 */
function Shards() {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.z -= delta * 0.012;
  });

  return (
    <instancedMesh
      ref={(mesh) => {
        meshRef.current = mesh;
        if (!mesh || mesh.userData.instancesPlaced) return;
        SHARD_MATRICES.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.instancesPlaced = true;
      }}
      args={[undefined, undefined, SHARD_COUNT]}
    >
      <boxGeometry args={[1, 1.35, 0.02]} />
      {/* 제 빛으로 환하면 면마다 밝기가 같아 납작해 보인다. 빛을 받아야 입체가 된다. */}
      <meshStandardMaterial
        color="#0f131a"
        emissive="#1e3a8a"
        emissiveIntensity={0.06}
        metalness={0.4}
        roughness={0.55}
        transparent
        opacity={0.45}
        depthWrite={false}
        flatShading
      />
    </instancedMesh>
  );
}

interface WarpGridProps {
  y?: number;
  flipped?: boolean;
}

/**
 * 물결처럼 휘는 격자 — 이름 "왜곡" 을 그대로 그린 것. 흘러가는 격자가 속도의 기준도 된다.
 * 물결은 정점 셰이더에서 계산해 CPU 가 매 프레임 꼭짓점을 고쳐 올려 보내지 않게 한다.
 */
function WarpGrid({ y = -7, flipped = false }: WarpGridProps) {
  const waveUniform = useMemo(() => ({ value: 0 }), []);
  useFrame(({ clock }) => {
    waveUniform.value = clock.getElapsedTime() * 0.35;
  });
  const injectWave = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWave = waveUniform;
      shader.vertexShader =
        /* glsl */ `uniform float uWave;\n` +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>\n transformed.z = sin(position.x * 0.12 + uWave) * 1.1 + sin(position.y * 0.09 - uWave * 0.8) * 0.9;`,
        );
    },
    [waveUniform],
  );

  return (
    <mesh position={[0, y, -TUNNEL_LENGTH / 2]} rotation={[flipped ? Math.PI / 2 : -Math.PI / 2, 0, 0]}>
      <planeGeometry args={[70, TUNNEL_LENGTH + 80, 40, 40]} />
      <meshBasicMaterial color={COLOR.arc} wireframe transparent opacity={0.075} onBeforeCompile={injectWave} />
    </mesh>
  );
}

/** 아주 가까운 먼지 층. 조금만 움직여도 크게 흘러 시차를 강조한다. */
const NEAR_DUST_COUNT = 500;
const NEAR_DUST_POSITIONS = (() => {
  const values = new Float32Array(NEAR_DUST_COUNT * 3);
  for (let i = 0; i < NEAR_DUST_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 2 + Math.random() * 16;
    values[i * 3] = Math.cos(angle) * distance;
    values[i * 3 + 1] = Math.sin(angle) * distance * 0.8;
    values[i * 3 + 2] = -Math.random() * TUNNEL_LENGTH;
  }
  return values;
})();

function NearDust() {
  const positions = NEAR_DUST_POSITIONS;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color={SKY} transparent opacity={0.26} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/**
 * 소실점을 BACKDROP_ORIGIN 으로 옮긴다.
 * 캔버스를 밀면 반대쪽에 빈 띠가 생기고 키우면 칠할 픽셀이 늘어난다. setViewOffset 은 둘 다 없다.
 */
function VanishingPointShift() {
  const { camera, size } = useThree();

  useEffect(() => {
    const { width, height } = size;
    if (!width || !height) return undefined;
    camera.setViewOffset(
      width,
      height,
      width * (0.5 - BACKDROP_ORIGIN.x),
      height * (0.5 - BACKDROP_ORIGIN.y),
      width,
      height,
    );
    camera.updateProjectionMatrix();
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, size]);

  return null;
}

// useFrame 안에서 scrollHeight 를 읽으면 강제 레이아웃이 날 수 있어, 크기가 바뀔 때만 다시 잰다.
const scrollExtent = { value: 0, dirty: true };
if (typeof window !== "undefined") {
  const markDirty = () => {
    scrollExtent.dirty = true;
  };
  window.addEventListener("resize", markDirty);
  window.addEventListener(PAGE_CHANGE_EVENT, markDirty);
  new ResizeObserver(markDirty).observe(document.documentElement);
}

function getScrollProgress(): number {
  if (scrollExtent.dirty) {
    scrollExtent.value = document.documentElement.scrollHeight - window.innerHeight;
    scrollExtent.dirty = false;
  }
  const end = scrollExtent.value;
  return end <= 0 ? 0 : clamp01(window.scrollY / end);
}

const MAX_CAMERA_SPEED = 22; // 초당 단위. 스크롤 막대를 홱 끌어도 화면이 휙 날아가지 않게 자른다.

/** 스크롤에 물린 카메라. 위치는 스크롤이, 바라보는 방향은 마우스가 정한다. */
function ScrollCamera({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera } = useThree();
  // 쪽을 옮기면 스크롤이 순간 0 이 된다. 관성으로 따라가면 통로를 거꾸로 날아가므로 한 번에 붙인다.
  const shouldSnapRef = useRef(false);
  useEffect(() => {
    const handlePageChange = () => {
      shouldSnapRef.current = true;
    };
    window.addEventListener(PAGE_CHANGE_EVENT, handlePageChange);
    return () => window.removeEventListener(PAGE_CHANGE_EVENT, handlePageChange);
  }, []);
  const lookAtRef = useRef(new THREE.Vector3(0, 0, -20));
  const lookGoalRef = useRef(new THREE.Vector3());

  useFrame(({ pointer }, delta) => {
    if (reducedMotion) return;

    const targetZ = -getScrollProgress() * TUNNEL_LENGTH;
    if (shouldSnapRef.current) {
      shouldSnapRef.current = false;
      camera.position.z = targetZ;
    }
    // 늘 한 박자 늦게 따라오되, 한 프레임에 갈 거리는 속도 한도로 자른다(delta 를 곱해 기기마다 같게).
    const step = (targetZ - camera.position.z) * 0.035;
    const limit = MAX_CAMERA_SPEED * delta;
    camera.position.z += Math.max(-limit, Math.min(limit, step));

    // 몸이 아니라 고개를 돌려야 둘러보는 느낌이 난다. 이쪽도 천천히 따라오게 한다.
    const lookAt = lookAtRef.current;
    lookAt.lerp(lookGoalRef.current.set(pointer.x * 2.6, pointer.y * 1.8, camera.position.z - 20), 0.05);
    camera.lookAt(lookAt);
  });

  return null;
}

/**
 * frameloop 가 "never" 로 시작하면 가장 비싼 셰이더가 첫 스크롤 프레임에 컴파일돼 멈칫한다.
 * 붙자마자 한가할 때 미리 컴파일하고, 첫 그리기는 다음 한가한 틈으로 떼어 긴 작업을 쪼갠다.
 */
function ShaderPrewarm() {
  const { gl, scene, camera, invalidate } = useThree();

  useEffect(() => {
    gl.debug.checkShaderErrors = !import.meta.env.PROD; // 배포에선 동기 로그 조회를 뺀다.
    let disposed = false;
    let cancelRender: (() => void) | null = null;
    const compile = () => {
      gl.compileAsync(scene, camera)
        .then(() => {
          if (disposed) return;
          cancelRender = runWhenIdle(
            () => {
              if (disposed) return;
              gl.render(scene, camera);
              invalidate();
            },
            1500,
            300,
          );
        })
        .catch(() => {});
    };
    const cancelCompile = runWhenIdle(compile, 1500, 300);
    return () => {
      disposed = true;
      cancelCompile();
      cancelRender?.();
    };
  }, [gl, scene, camera, invalidate]);

  return null;
}

interface DeepSpaceSceneProps {
  visible?: boolean;
  reducedMotion?: boolean;
}

/** 페이지 뒤에 깔리는 깊은 공간. 스크롤하면 카메라가 통로 안으로 날아간다. */
export default function DeepSpaceScene({ visible = true, reducedMotion = false }: DeepSpaceSceneProps) {
  return (
    <Canvas
      // 옅고 안개에 묻힌 장식이라 dpr 1·antialias 끔으로도 겉보기가 같고, 스크롤 중 끊기는 프레임이 크게 준다.
      dpr={1}
      camera={{ position: [0, 0, 0], fov: 62, near: 0.1, far: 260 }}
      frameloop={visible && !reducedMotion ? "always" : "never"}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      style={canvasStyle}
    >
      {/* 안개가 깊이를 만든다. 진할수록 먼 것이 일찍 녹아 눈이 덜 피로하다. */}
      <fogExp2 attach="fog" args={[BACKGROUND, 0.032]} />

      {/* 면끼리 밝기 차이가 나야 다면체가 다면체로 보인다 — 주변광을 낮추고 방향광 대비를 키운다. */}
      <ambientLight intensity={0.16} />
      <directionalLight position={[8, 6, 3]} intensity={1.4} color={SKY} />
      <directionalLight position={[-7, -4, -2]} intensity={0.6} color="#737782" />
      {/* 카메라 앞을 비춰 가까이 오는 것이 먼저 밝아진다. */}
      <pointLight position={[0, 0, 4]} intensity={14} distance={30} decay={1.7} color={COLOR.arc} />

      <TunnelRings />
      {/* 바닥과 천장으로 위아래를 감싸야 통로 안으로 읽힌다. */}
      <WarpGrid y={-7} />
      <WarpGrid y={8.5} flipped />
      <Shards />
      <NearDust />
      <VanishingPointShift />
      <ScrollCamera reducedMotion={reducedMotion} />
      <ShaderPrewarm />
    </Canvas>
  );
}
