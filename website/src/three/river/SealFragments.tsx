import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { journeyInput } from "./journey";
import { SEAL_PIECES, type StoryState } from "./story";
import type { SharedUniforms } from "./world";

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// 봉인 조각 — 풀어야 할 단서들. 지역·시나리오 구간에선 카메라 둘레를 떠다니다가, 앙암 앞에서 하나씩 날아가
// 페이지의 앙암 사진 원(data-seal-anchor) 둘레에 맞물린다. 맞물릴 때마다 왜곡이 한 칸 걷힌다(story.ts).
// 고리는 카메라 앞 일정한 거리에 화면 자리를 맞춰 세운다 — 그래서 원이 스크롤로 올라가면 고리도 같이 올라간다.

const ARC = (Math.PI * 2) / SEAL_PIECES;
const GAP = 0.06;
/** 토막의 안쪽 반지름(바깥은 1). 얇아야 사진 원을 가리지 않고 테처럼 두른다. */
const PIECE_INNER = 0.86;
const PIECE_MIDDLE = (PIECE_INNER + 1) / 2;

/** 고리 한 토막(반지름 1). 두께를 줘야 돌 때 면이 빛을 받아 조각으로 읽힌다. */
function createPieceGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const from = -ARC / 2 + GAP;
  const to = ARC / 2 - GAP;
  shape.absarc(0, 0, 1, from, to, false);
  shape.absarc(0, 0, PIECE_INNER, to, from, true);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 1,
    curveSegments: 24,
  });
  // 토막 한가운데를 원점으로 — 떠다닐 때 제자리에서 돌고, 맞물릴 땐 고리 반지름만큼 밀어 놓는다.
  geometry.translate(-PIECE_MIDDLE, 0, -0.035);
  return geometry;
}

const VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position + vec3(${PIECE_MIDDLE.toFixed(2)}, 0.0, 0.0);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uLock;
  uniform float uFlash;
  uniform float uSeed;
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

  // 고리 띠에 새긴 글자 — 칸마다 획(세로·가로·점)을 난수로 골라 옛 부적 글씨처럼 보이게 한다.
  float runes(vec2 polar) {
    float cells = 22.0;
    float u = polar.x * cells;
    vec2 cell = vec2(floor(u), uSeed);
    vec2 f = vec2(fract(u), (polar.y - ${PIECE_INNER.toFixed(2)}) / ${(1 - PIECE_INNER).toFixed(2)});
    if (f.y < 0.0 || f.y > 1.0) return 0.0;
    float w = 0.045;
    float ink = 0.0;
    ink += step(0.4, hash(cell)) * step(abs(f.x - 0.5), w);
    ink += step(0.5, hash(cell + 1.3)) * step(abs(f.y - 0.3), w) * step(abs(f.x - 0.5), 0.3);
    ink += step(0.5, hash(cell + 2.7)) * step(abs(f.y - 0.72), w) * step(abs(f.x - 0.5), 0.3);
    ink += step(0.7, hash(cell + 4.1)) * step(length(f - vec2(0.25, 0.5)), 0.09);
    return clamp(ink, 0.0, 1.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vView);
    float facing = abs(dot(n, view));
    vec2 polar = vec2(atan(vLocal.y, vLocal.x) / 6.2831853 + 0.5, length(vLocal.xy));
    float rune = runes(polar) * step(0.03, abs(vLocal.z));

    vec3 stone = vec3(0.06, 0.09, 0.16) * (0.6 + 0.4 * facing);
    // 아직 풀리지 않은 조각은 글자가 희미하게 떨리고, 맞물리면 하얗게 달아오른다.
    float pulse = 0.55 + 0.45 * sin(uTime * 3.0 + uSeed * 5.0);
    vec3 glow = mix(vec3(0.42, 0.53, 0.86) * pulse, vec3(0.92, 0.96, 1.0) * 1.8, uLock);
    // 떠다니는 동안에도 테두리가 푸르게 타 어둠 속 파편이 아니라 빛나는 조각으로 읽힌다.
    vec3 col = stone + glow * rune * (1.1 + uLock) + vec3(0.42, 0.56, 0.95) * (pow(1.0 - facing, 2.0) * 1.2 + 0.12);
    col += vec3(0.8, 0.9, 1.0) * uFlash * 1.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface SealFragmentsProps {
  uniforms: SharedUniforms;
  story: StoryState;
  /** 맞물린 순간 마무리 패스에 넘길 번쩍임(0~1, 서서히 꺼진다). */
  lockPulse: { value: number };
  /** 봉인 고리의 화면 자리(0~1, 아래 기준) — 충격파가 여기서 퍼진다. */
  lockCenter: THREE.Vector2;
}

/** 고리를 세우는 카메라 앞 거리. 장면 산들보다 가까워야 가려지지 않는다. */
const SEAL_DISTANCE = 30;
/** 사진 원보다 조금 바깥에 두른다. */
const SEAL_MARGIN = 1.1;

export default function SealFragments({ uniforms, story, lockPulse, lockCenter }: SealFragmentsProps) {
  const { camera } = useThree();
  const geometry = useMemo(() => createPieceGeometry(), []);
  const pieces = useMemo(
    () =>
      Array.from({ length: SEAL_PIECES }, (_, i) => ({
        material: new THREE.ShaderMaterial({
          uniforms: {
            uTime: uniforms.uTime,
            uLock: { value: 0 },
            uFlash: { value: 0 },
            uSeed: { value: i * 3.17 },
          },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
        }),
        // 카메라 시야 가장자리에 흩어진 자리(카메라 기준: 오른쪽, 위, 앞).
        drift: new THREE.Vector3(
          (i % 2 ? 1 : -1) * (5.5 + (i % 3) * 1.4),
          ((i * 37) % 5) * 0.9 - 1.6,
          -(11 + (i % 4) * 2.2),
        ),
        locked: false,
      })),
    [uniforms],
  );
  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  const scratch = useMemo(
    () => ({
      position: new THREE.Vector3(),
      slot: new THREE.Vector3(),
      center: new THREE.Vector3(),
      slotQuat: new THREE.Quaternion(),
      spin: new THREE.Quaternion(),
      quat: new THREE.Quaternion(),
      tumble: new THREE.Euler(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const time = uniforms.uTime.value;
    const shown = story.fragments;
    lockPulse.value *= Math.exp(-delta * 3.5);
    // 봉인 자리: 페이지 원의 화면 자리 → 카메라 앞 SEAL_DISTANCE 의 월드 자리와 반지름.
    const anchor = journeyInput.sealAnchor;
    const halfHeight = SEAL_DISTANCE * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    const aspect = (camera as THREE.PerspectiveCamera).aspect;
    scratch.center
      .set((anchor.x * 2 - 1) * halfHeight * aspect, (1 - anchor.y * 2) * halfHeight, -SEAL_DISTANCE)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    const radius = anchor.radius * 2 * halfHeight * SEAL_MARGIN;
    lockCenter.set(anchor.x, 1 - anchor.y);
    pieces.forEach((piece, i) => {
      const group = groupRefs.current[i];
      if (!group) return;
      const lock = THREE.MathUtils.clamp(story.seal - i, 0, 1);
      group.visible = shown > 0.01;
      if (!group.visible) return;

      // 떠 있는 자리 — 카메라를 따라오며 천천히 흔들린다.
      scratch.position.copy(piece.drift);
      scratch.position.y += Math.sin(time * 0.6 + i) * 0.35;
      scratch.position.applyQuaternion(camera.quaternion).add(camera.position);
      // 봉인 자리
      const angle = i * ARC + Math.PI / 2;
      const reach = radius * PIECE_MIDDLE;
      scratch.slot
        .set(Math.cos(angle) * reach, Math.sin(angle) * reach, 0)
        .applyQuaternion(camera.quaternion)
        .add(scratch.center);
      const travel = lock * lock * (3 - 2 * lock);
      group.position.lerpVectors(scratch.position, scratch.slot, travel);

      scratch.tumble.set(time * 0.4 + i, time * 0.3 + i * 2, time * 0.2);
      scratch.quat.setFromEuler(scratch.tumble);
      const slotQuat = scratch.slotQuat.copy(camera.quaternion).multiply(scratch.spin.setFromAxisAngle(Z_AXIS, angle));
      group.quaternion.slerpQuaternions(scratch.quat, slotQuat, travel);
      // 멀리 날아가도 보이도록 날아가는 만큼 키운다. 나타날 땐 0 에서 자라난다.
      group.scale.setScalar(THREE.MathUtils.lerp(1.1, radius, travel) * shown);

      const material = piece.material;
      material.uniforms.uLock.value = travel;
      const justLocked = lock >= 1 && !piece.locked;
      if (justLocked) lockPulse.value = 1;
      piece.locked = lock >= 1;
      material.uniforms.uFlash.value = piece.locked ? lockPulse.value * 0.5 : 0;
    });
  });

  return (
    <>
      {pieces.map((piece, i) => (
        <group
          key={i}
          ref={(group) => {
            groupRefs.current[i] = group;
          }}
        >
          <mesh geometry={geometry} material={piece.material} renderOrder={7} />
        </group>
      ))}
    </>
  );
}
