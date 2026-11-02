/**
 * 강 밑 물고기 — 네 가지. 은빛 피라미 떼 · 줄무늬 쉬리 · 붕어 · 바닥의 메기.
 * 몸통(물레 깎기) + 꼬리·등·가슴지느러미 + 눈 을 꼭짓점 색으로 칠해 한 덩이로 굽고, 종마다 InstancedMesh 하나.
 * 헤엄은 셰이더 — 꼬리 쪽일수록 좌우로 크게 흔든다(마리마다 위상이 다르다). 움직임은 CPU 에서 목표점을 향해 부드럽게 돈다.
 * 재미 — ① 은빛 떼가 이따금 소용돌이(베이트볼)로 뭉쳐 돌고, 몸을 틀 때마다 은빛이 번쩍인다
 *        ② 사람이 가만히 서 있으면 쉬리 몇 마리가 호기심에 다가와 눈앞에서 맴돌다, 움직이면 흩어진다
 * 사람이 가까이 가면 달아난다 — 그걸로 「물고기 몰기」(재미 퍼즐): 은빛 떼를 돌 고리 안으로 몰아넣으면 진주가 떠오른다.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { createRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { buildBakedRockPrototypes } from "../../models/nature";
import { audio } from "../../scene/immersion/audio";
import { M } from "../fishTrap/shared";
import { showNotice } from "../interaction";
import { inventory } from "../inventory";
import { setPuzzlePanel } from "../puzzlePanel";
import { ritual, useRitualStage } from "../ritual/ritualState";
import { FLOOR_Y, SURFACE_Y, floorY, getUnderwater } from "./caveState";
import { SPECIES, buildFishGeometry } from "./fishLooks";
import { normalizePrototype } from "./seabed";

/** 돌 고리 — 은빛 떼를 몰아넣는 자리 */
const RING = { x: 40.2, z: 65.4, radius: 1.3, need: 12, holdSeconds: 1.2 };
const FLEE_RADIUS = 2.8;
/** 소용돌이 — 이만큼(초)마다 · 이만큼(초) 동안 */
const SWIRL_EVERY = 13;
const SWIRL_SECONDS = 6;
/** 호기심 — 이만큼(초) 가만히 있으면 쉬리가 다가온다 · 다가오는 수 · 눈앞 거리(미터) */
const CURIOUS_AFTER = 2.2;
const CURIOUS_COUNT = 3;
const CURIOUS_DISTANCE = 1.15;
const SCHOOL_FLEE_RADIUS = 3.6;

/** 헤엄 셰이더 — 꼬리 쪽(−x)일수록 좌우(z)로 크게. 마리마다 위상(aPhase)이 다르다 */
function makeFishMaterial(freq: number, time: THREE.IUniform<number>) {
  const material = new THREE.MeshToonMaterial({ color: "#FFFFFF", vertexColors: true, gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          float w = clamp((0.2 - position.x) / 0.7, 0.0, 1.0);
          float wave = sin(uTime * ${freq.toFixed(1)} + aPhase - position.x * 5.0);
          transformed.z += wave * (0.11 * w * w + 0.012);
        }`,
      );
  };
  material.customProgramCacheKey = () => `fish-${freq}`;
  return material;
}

interface Fish {
  species: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  until: number;
  offset: THREE.Vector3;
}

export default function Fishes() {
  const stage = useRitualStage();
  const isShown = ritual.isAtLeast("parted") && stage !== "cleared";
  const { camera } = useThree();
  const ringHold = useRef(0);
  const ringCount = useRef(0);
  const ringDoneRef = useRef(false);
  /** 사람이 가만히 있은 시간 · 지난 자리 */
  const stillFor = useRef(0);
  const lastSpot = useRef(new THREE.Vector3());

  const built = useMemo(() => {
    const random = createRandom(6103);
    const time = { value: 0 };
    const meshes = SPECIES.map((s) => {
      const geometry = buildFishGeometry(s);
      const phases = new Float32Array(s.count);
      for (let i = 0; i < s.count; i++) phases[i] = random() * Math.PI * 2;
      geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
      const mesh = new THREE.InstancedMesh(geometry, makeFishMaterial(s.freq, time), s.count);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      // 은빛 번쩍임 — 마리마다 밝기(instanceColor)
      for (let i = 0; i < s.count; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      return mesh;
    });
    const fishes: Fish[] = [];
    SPECIES.forEach((s, k) => {
      for (let i = 0; i < s.count; i++) {
        const x = THREE.MathUtils.lerp(s.region.x[0], s.region.x[1], random());
        const z = THREE.MathUtils.lerp(s.region.z[0], s.region.z[1], random());
        const y = THREE.MathUtils.lerp(s.yMin, s.yMax, random());
        const angle = random() * Math.PI * 2;
        const r = 0.3 + random() * 1.1;
        fishes.push({
          species: k,
          pos: new THREE.Vector3(x, y, z),
          vel: new THREE.Vector3(),
          target: new THREE.Vector3(x, y, z),
          until: random() * 3,
          offset: new THREE.Vector3(Math.cos(angle) * r, (random() - 0.5) * 0.8, Math.sin(angle) * r),
        });
      }
    });
    // 떼 중심 — 방 가운데쯤에서 어슬렁거린다
    const school = { pos: new THREE.Vector3(47, FLOOR_Y + 2.2, 65), vel: new THREE.Vector3(), target: new THREE.Vector3(47, FLOOR_Y + 2.2, 65), until: 0 };
    const rocks = buildBakedRockPrototypes().map(normalizePrototype);
    const ringStones: { x: number; z: number; size: number; yaw: number; variant: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      ringStones.push({ x: RING.x + Math.cos(a) * (RING.radius + 0.25), z: RING.z + Math.sin(a) * (RING.radius + 0.25), size: 0.32 + random() * 0.2, yaw: random() * 6.3, variant: i % rocks.length });
    }
    const stone = new THREE.MeshToonMaterial({ color: "#6A7574", vertexColors: true, gradientMap: TOON_GRADIENT });
    return { time, meshes, fishes, school, random, rocks, ringStones, stone };
  }, []);
  useEffect(
    () => () => {
      built.meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      });
      built.rocks.forEach((g) => g.dispose());
      built.stone.dispose();
    },
    [built],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFishDev", {
      inRing: () => ringCount.current,
      herd: () => {
        // 떼를 고리 위로 옮겨 놓는다(검사용)
        built.school.pos.set(RING.x, FLOOR_Y + 1.8, RING.z);
        built.school.target.copy(built.school.pos);
        built.fishes.forEach((f) => {
          if (f.species === 0) f.pos.set(RING.x + f.offset.x * 0.5, FLOOR_Y + 1.8 + f.offset.y, RING.z + f.offset.z * 0.5);
        });
      },
      isRingDone: () => ringDoneRef.current,
    });
  }, [built]);
  useEffect(() => () => setPuzzlePanel("cave-ring", null), []);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const turn = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), []);
  const lookMatrix = useMemo(() => new THREE.Matrix4(), []);
  const scratch = useMemo(() => ({ dir: new THREE.Vector3(), away: new THREE.Vector3(), scale: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), zero: new THREE.Vector3(), forward: new THREE.Vector3(), color: new THREE.Color() }), []);

  useFrame((_, rawDt) => {
    if (!isShown) return;
    const dt = Math.min(rawDt, 0.05);
    const time = performance.now() / 1000;
    built.time.value = time;
    const { fishes, school, random } = built;
    const px = camera.position.x / M;
    const py = camera.position.y / M;
    const pz = camera.position.z / M;
    const underwater = getUnderwater();
    const { dir, away, scale, up, zero } = scratch;
    // 소용돌이 — 0~1(들어가고 나오는 몫)
    const cycle = time % SWIRL_EVERY;
    const swirl = cycle < SWIRL_SECONDS ? Math.sin((cycle / SWIRL_SECONDS) * Math.PI) : 0;
    // 가만히 서 있나
    const moved = lastSpot.current.distanceTo(camera.position) / M;
    lastSpot.current.copy(camera.position);
    stillFor.current = moved < 0.01 ? stillFor.current + dt : 0;
    const isCurious = underwater && stillFor.current > CURIOUS_AFTER;
    camera.getWorldDirection(scratch.forward);

    // ── 떼 중심 — 어슬렁 + 사람 피하기 ──
    school.until -= dt;
    const schoolRegion = SPECIES[0].region;
    const dsx = school.pos.x - px;
    const dsz = school.pos.z - pz;
    const schoolDist = Math.hypot(dsx, dsz);
    if (underwater && schoolDist < SCHOOL_FLEE_RADIUS) {
      const k = (1 - schoolDist / SCHOOL_FLEE_RADIUS) * 1.5 + 0.4;
      school.target.set(school.pos.x + (dsx / (schoolDist || 1)) * 3, school.pos.y, school.pos.z + (dsz / (schoolDist || 1)) * 3);
      school.until = 0.4;
      school.vel.x += (((dsx / (schoolDist || 1)) * k) - school.vel.x) * Math.min(1, dt * 3);
      school.vel.z += (((dsz / (schoolDist || 1)) * k) - school.vel.z) * Math.min(1, dt * 3);
    } else {
      if (school.until <= 0) {
        school.until = 4 + random() * 5;
        school.target.set(THREE.MathUtils.lerp(schoolRegion.x[0], schoolRegion.x[1], random()), THREE.MathUtils.lerp(SPECIES[0].yMin, SPECIES[0].yMax, random()), THREE.MathUtils.lerp(schoolRegion.z[0], schoolRegion.z[1], random()));
      }
      dir.subVectors(school.target, school.pos);
      const d = dir.length();
      if (d > 0.3) dir.multiplyScalar(0.35 / d);
      else dir.set(0, 0, 0);
      school.vel.lerp(dir, Math.min(1, dt * 1.2));
    }
    school.pos.addScaledVector(school.vel, dt);
    school.pos.x = THREE.MathUtils.clamp(school.pos.x, schoolRegion.x[0], schoolRegion.x[1]);
    school.pos.z = THREE.MathUtils.clamp(school.pos.z, schoolRegion.z[0], schoolRegion.z[1]);
    school.pos.y = THREE.MathUtils.clamp(school.pos.y, SPECIES[0].yMin, SPECIES[0].yMax);

    // ── 마리마다 ──
    const counts = SPECIES.map(() => 0);
    let inRing = 0;
    let curiousLeft = CURIOUS_COUNT;
    for (const f of fishes) {
      const s = SPECIES[f.species];
      f.until -= dt;
      const dxp = f.pos.x - px;
      const dzp = f.pos.z - pz;
      const dp = Math.hypot(dxp, dzp, (f.pos.y - py) * 0.5);
      if (s.school) {
        if (f.until <= 0) {
          f.until = 2 + random() * 3;
          const angle = random() * Math.PI * 2;
          const r = 0.3 + random() * 1.1;
          f.offset.set(Math.cos(angle) * r, (random() - 0.5) * 0.9, Math.sin(angle) * r);
        }
        f.target.copy(school.pos).add(f.offset);
        if (swirl > 0.02) {
          // 베이트볼 — 떼 가운데를 축으로 빙글빙글, 위아래로 길쭉한 기둥처럼 뭉친다
          const a = Math.atan2(f.offset.z, f.offset.x) + time * 1.6;
          const r = 0.45 + Math.hypot(f.offset.x, f.offset.z) * 0.35;
          away.set(school.pos.x + Math.cos(a) * r, school.pos.y + f.offset.y * 1.6, school.pos.z + Math.sin(a) * r);
          f.target.lerp(away, swirl);
        }
      } else if (f.species === 1 && isCurious && curiousLeft > 0 && dp < 14) {
        // 호기심 — 눈앞 조금 아래에서 맴돈다
        curiousLeft--;
        const k = CURIOUS_COUNT - curiousLeft;
        const a = time * 0.7 + k * 2.1;
        f.target.set(
          px + scratch.forward.x * CURIOUS_DISTANCE + Math.cos(a) * 0.35,
          py - 0.02 + Math.sin(time * 1.3 + k) * 0.12,
          pz + scratch.forward.z * CURIOUS_DISTANCE + Math.sin(a) * 0.35,
        );
        f.until = 0.5;
      } else if (underwater && dp < FLEE_RADIUS && !(f.species === 1 && isCurious)) {
        away.set(dxp, 0, dzp).normalize();
        f.target.set(f.pos.x + away.x * 3.5, f.pos.y + (random() - 0.5) * 0.4, f.pos.z + away.z * 3.5);
        f.until = 1.2;
      } else if (f.until <= 0 || f.pos.distanceTo(f.target) < 0.4) {
        f.until = 3 + random() * 5;
        f.target.set(THREE.MathUtils.lerp(s.region.x[0], s.region.x[1], random()), THREE.MathUtils.lerp(s.yMin, s.yMax, random()), THREE.MathUtils.lerp(s.region.z[0], s.region.z[1], random()));
      }
      // 영역 밖 목표는 안으로
      f.target.x = THREE.MathUtils.clamp(f.target.x, s.region.x[0], s.region.x[1]);
      f.target.z = THREE.MathUtils.clamp(f.target.z, s.region.z[0], s.region.z[1]);
      f.target.y = THREE.MathUtils.clamp(f.target.y, Math.max(s.yMin, floorY(f.target.x, f.target.z) + 0.2), s.yMax);
      dir.subVectors(f.target, f.pos);
      const d = dir.length();
      const speed = s.speed * (dp < FLEE_RADIUS && !s.school && !isCurious ? 2.2 : 1) * (s.school && schoolDist < SCHOOL_FLEE_RADIUS ? 1.8 : 1) * (s.school ? 1 + swirl * 1.2 : 1);
      if (d > 0.05) dir.multiplyScalar(speed / d);
      f.vel.lerp(dir, Math.min(1, dt * (s.school ? 2.2 : 1.4)));
      f.pos.addScaledVector(f.vel, dt);
      f.pos.y = Math.max(f.pos.y, floorY(f.pos.x, f.pos.z) + 0.15);
      f.pos.y = Math.min(f.pos.y, SURFACE_Y - 0.3);
      // 자세 — 머리(+x)가 가는 쪽
      const speedNow = f.vel.length();
      if (speedNow > 0.02) {
        lookMatrix.lookAt(zero, f.vel, up);
        quaternion.setFromRotationMatrix(lookMatrix).multiply(turn);
      }
      scale.setScalar(s.size * M);
      matrix.compose(f.pos.clone().multiplyScalar(M), quaternion, scale);
      const index = counts[f.species]++;
      built.meshes[f.species].setMatrixAt(index, matrix);
      if (s.school) {
        // 은빛 번쩍 — 몸을 틀어 옆구리가 빛을 받을 때(돌아가는 동안 더 자주)
        const glint = Math.max(0, Math.sin(time * (2.2 + swirl * 4) + index * 1.37)) ** 12 * (0.6 + swirl * 1.4);
        scratch.color.setScalar(1 + glint * 1.8);
        built.meshes[f.species].setColorAt(index, scratch.color);
      }
      if (f.species === 0 && Math.hypot(f.pos.x - RING.x, f.pos.z - RING.z) < RING.radius) inRing++;
    }
    built.meshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    ringCount.current = inRing;

    // ── 돌 고리 — 열두 마리가 1.2초 들어와 있으면 진주 ──
    if (!ringDoneRef.current) {
      ringHold.current = inRing >= RING.need ? ringHold.current + dt : 0;
      if (ringHold.current >= RING.holdSeconds) {
        ringDoneRef.current = true;
        audio.play("징");
        showNotice("물고기 떼가 돌 고리 안에 모였다 — 모래가 들썩이며 진주가 떠올랐다.", 5);
        inventory.spawn("pearl", new THREE.Vector3(RING.x * M, (floorY(RING.x, RING.z) + 0.02) * M, RING.z * M));
      }
    }
    const dr = Math.hypot(px - RING.x, pz - RING.z);
    if (dr > 4.5 || !underwater) setPuzzlePanel("cave-ring", null);
    else
      setPuzzlePanel("cave-ring", {
        distance: dr,
        title: "돌 고리 — 물고기 몰기",
        rule: "은빛 물고기 떼는 사람을 피해 달아난다.\n떼의 반대쪽에서 다가가 돌 고리 안으로 몰아 보자. 열두 마리가 들어오면 모래에서 뭔가 떠오른다. (안 풀어도 된다)",
        rows: [{ label: "고리 안", value: ringDoneRef.current ? "진주가 떠올랐다" : `${inRing} / ${RING.need} 마리`, ok: ringDoneRef.current || inRing >= RING.need }],
      });
  });

  if (!isShown) return null;
  return (
    <>
      {built.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
      <group scale={M}>
        {/* 돌 고리 — 작은 바위 여덟 */}
        {built.ringStones.map((r, i) => (
          <mesh key={i} geometry={built.rocks[r.variant]} material={built.stone} position={[r.x, floorY(r.x, r.z) - 0.04, r.z]} rotation={[0, r.yaw, 0]} scale={[r.size, r.size * 0.8, r.size]} castShadow />
        ))}
      </group>
    </>
  );
}
