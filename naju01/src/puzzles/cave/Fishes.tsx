/**
 * 강 밑 물고기 — 네 가지. 은빛 피라미 떼 · 줄무늬 쉬리 · 붕어 · 바닥의 메기.
 * 몸통(물레 깎기) + 꼬리·등·가슴지느러미 + 눈 을 꼭짓점 색으로 칠해 한 덩이로 굽고, 종마다 InstancedMesh 하나.
 * 헤엄은 셰이더 — 꼬리 쪽일수록 좌우로 크게 흔든다(마리마다 위상이 다르다). 움직임은 CPU 에서 목표점을 향해 부드럽게 돈다.
 * 은빛 떼는 이따금 소용돌이(베이트볼)로 뭉쳐 돌고 몸을 틀 때마다 은빛이 번쩍인다.
 * 사람이 가만히 서 있으면 쉬리 몇 마리가 호기심에 다가와 눈앞에서 맴돌다, 움직이면 흩어진다.
 * 사람이 가까이 가면 달아난다 — 그걸로 「물고기 몰기」(재미 퍼즐): 은빛 떼를 돌 고리 안으로 몰아넣으면 진주가 떠오른다.
 * 물에 든 뒤 한 번은 은빛 떼가 사람에게 몰려와 몸을 휘감고 돈다 — 화면이 같이 돌고 물살에 몸이 밀린다(놀래 주기).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { createRandom } from "@/engine/random";

import { recall, remember } from "../../save/puzzleMemory";
import { playerPush } from "../../movement/playerPush";
import { buildBakedRockPrototypes } from "../../models/nature";
import { audio } from "../../scene/immersion/audio";
import { showNotice } from "../interaction";
import { inventory } from "../inventory";
import { makeToonMaterial } from "../materials";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import { FLOOR_Y, SURFACE_Y, floorY, getUnderwater, stirSand, useCaveShown } from "./caveState";
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
/** 휘감기 — 물에 든 지 이만큼(초) 지나 떼가 이 거리(미터) 안에 있으면 몰려온다 · 휘감고 도는 시간 · 도는 반지름 · 화면이 도는 빠르기(rad/s) · 미는 힘(m/s) */
const SWARM = { after: 7, within: 11, seconds: 4.2, radius: 1.15, spin: 1.5, push: 0.45 };
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** 헤엄 셰이더 — 꼬리 쪽(−x)일수록 좌우(z)로 크게. 마리마다 위상(aPhase)이 다르다 */
function makeFishMaterial(freq: number, time: THREE.IUniform<number>) {
  const material = makeToonMaterial("#FFFFFF", { vertexColors: true, side: THREE.DoubleSide });
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
  const isShown = useCaveShown();
  const { camera } = useThree();
  const ringHold = useRef(0);
  const ringCount = useRef(0);
  const ringDoneRef = useRef(recall("fishes.ringDone", false));
  /** 사람이 가만히 있은 시간 · 지난 자리 */
  const stillFor = useRef(0);
  const lastSpot = useRef(new THREE.Vector3());
  /** 휘감기 — 물에 든 시간 · 단계 · 시작한 때 · 도는 방향 */
  const swarm = useRef({
    underwaterFor: 0,
    phase: "idle" as "idle" | "approach" | "spin" | "done",
    startedAt: 0,
    turn: 1,
  });

  const world = useMemo(() => {
    const random = createRandom(6103);
    const time = { value: 0 };
    const meshes = SPECIES.map((species) => {
      const geometry = buildFishGeometry(species);
      const phases = new Float32Array(species.count);
      for (let i = 0; i < species.count; i++) phases[i] = random() * Math.PI * 2;
      geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
      const mesh = new THREE.InstancedMesh(geometry, makeFishMaterial(species.freq, time), species.count);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      // 은빛 번쩍임 — 마리마다 밝기(instanceColor)
      for (let i = 0; i < species.count; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      return mesh;
    });
    const fishes: Fish[] = [];
    SPECIES.forEach((species, k) => {
      for (let i = 0; i < species.count; i++) {
        const x = THREE.MathUtils.lerp(species.region.x[0], species.region.x[1], random());
        const z = THREE.MathUtils.lerp(species.region.z[0], species.region.z[1], random());
        const y = THREE.MathUtils.lerp(species.yMin, species.yMax, random());
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
    const school = {
      pos: new THREE.Vector3(47, FLOOR_Y + 2.2, 65),
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(47, FLOOR_Y + 2.2, 65),
      until: 0,
    };
    const rocks = buildBakedRockPrototypes().map(normalizePrototype);
    const ringStones: { x: number; z: number; size: number; yaw: number; variant: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      ringStones.push({
        x: RING.x + Math.cos(a) * (RING.radius + 0.25),
        z: RING.z + Math.sin(a) * (RING.radius + 0.25),
        size: 0.32 + random() * 0.2,
        yaw: random() * 6.3,
        variant: i % rocks.length,
      });
    }
    const stone = makeToonMaterial("#6A7574", { vertexColors: true });
    return { time, meshes, fishes, school, random, rocks, ringStones, stone };
  }, []);
  useEffect(
    () => () => {
      world.meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      });
      world.rocks.forEach((geometry) => geometry.dispose());
      world.stone.dispose();
    },
    [world],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuFishDev", {
      inRing: () => ringCount.current,
      herd: () => {
        // 떼를 고리 위로 옮겨 놓는다(검사용)
        world.school.pos.set(RING.x, FLOOR_Y + 1.8, RING.z);
        world.school.target.copy(world.school.pos);
        world.fishes.forEach((fish) => {
          if (fish.species === 0)
            fish.pos.set(RING.x + fish.offset.x * 0.5, FLOOR_Y + 1.8 + fish.offset.y, RING.z + fish.offset.z * 0.5);
        });
      },
      isRingDone: () => ringDoneRef.current,
      swarm: () => swarm.current.phase,
      /** 바로 몰려오게 */
      swarmNow: () => {
        swarm.current.underwaterFor = 99;
      },
    });
  }, [world]);
  useEffect(() => () => setPuzzlePanel("cave-ring", null), []);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const turn = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), []);
  const lookMatrix = useMemo(() => new THREE.Matrix4(), []);
  const scratch = useMemo(
    () => ({
      dir: new THREE.Vector3(),
      away: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      zero: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      color: new THREE.Color(),
      spin: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    if (!isShown) return;
    const dt = Math.min(rawDt, 0.05);
    const time = performance.now() / 1000;
    world.time.value = time;
    const { fishes, school, random } = world;
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

    // ── 휘감기 — 한 번, 물에 든 지 좀 지나서. 몰려와 몸을 빙 두르고 돌며 화면을 돌리고 밀어낸다 ──
    const swarmState = swarm.current;
    swarmState.underwaterFor = underwater ? swarmState.underwaterFor + dt : 0;
    const dsx0 = school.pos.x - px;
    const dsz0 = school.pos.z - pz;
    const dist0 = Math.hypot(dsx0, dsz0);
    if (swarmState.phase === "idle" && underwater && swarmState.underwaterFor > SWARM.after && dist0 < SWARM.within) {
      swarmState.phase = "approach";
      swarmState.turn = Math.random() < 0.5 ? -1 : 1;
      swarmState.startedAt = time;
    }
    if (swarmState.phase === "approach") {
      school.target.set(px, py - 0.1, pz);
      school.vel.lerp(dir.subVectors(school.target, school.pos).normalize().multiplyScalar(2.6), Math.min(1, dt * 2.5));
      if (dist0 < 1.4 || time - swarmState.startedAt > 7) {
        swarmState.phase = "spin";
        swarmState.startedAt = time;
        audio.play("우르릉");
        stirSand(0.8);
        showNotice("은빛 떼가 몸을 휘감고 돈다 — 물살에 몸이 밀린다!", 4);
      }
    }
    const isSwirling = swarmState.phase === "spin";
    if (isSwirling) {
      const since = time - swarmState.startedAt;
      const angle = since * 2.2 * swarmState.turn;
      school.pos.set(px + Math.cos(angle) * SWARM.radius, py - 0.15, pz + Math.sin(angle) * SWARM.radius);
      school.target.copy(school.pos);
      school.vel.set(0, 0, 0);
      // 화면이 떼를 따라 돌고, 몸은 떼 반대쪽으로 밀린다 — 끝으로 갈수록 잦아든다
      const strength = Math.min(1, since / 0.6) * Math.min(1, (SWARM.seconds - since) / 1.2);
      camera.quaternion.premultiply(
        scratch.spin.setFromAxisAngle(UP_AXIS, SWARM.spin * swarmState.turn * strength * dt),
      );
      playerPush.x = -Math.cos(angle) * SWARM.push * strength;
      playerPush.z = -Math.sin(angle) * SWARM.push * strength;
      stirSand(dt * 0.3);
      if (since > SWARM.seconds) swarmState.phase = "done";
    }

    // ── 떼 중심 — 어슬렁 + 사람 피하기 ──
    school.until -= dt;
    const schoolRegion = SPECIES[0].region;
    const dsx = school.pos.x - px;
    const dsz = school.pos.z - pz;
    const schoolDist = Math.hypot(dsx, dsz);
    if (swarmState.phase === "approach" || isSwirling) {
      // 몰려오는 동안은 사람을 피하지도, 어슬렁거리지도 않는다
    } else if (underwater && schoolDist < SCHOOL_FLEE_RADIUS) {
      const k = (1 - schoolDist / SCHOOL_FLEE_RADIUS) * 1.5 + 0.4;
      school.target.set(
        school.pos.x + (dsx / (schoolDist || 1)) * 3,
        school.pos.y,
        school.pos.z + (dsz / (schoolDist || 1)) * 3,
      );
      school.until = 0.4;
      school.vel.x += ((dsx / (schoolDist || 1)) * k - school.vel.x) * Math.min(1, dt * 3);
      school.vel.z += ((dsz / (schoolDist || 1)) * k - school.vel.z) * Math.min(1, dt * 3);
    } else {
      if (school.until <= 0) {
        school.until = 4 + random() * 5;
        school.target.set(
          THREE.MathUtils.lerp(schoolRegion.x[0], schoolRegion.x[1], random()),
          THREE.MathUtils.lerp(SPECIES[0].yMin, SPECIES[0].yMax, random()),
          THREE.MathUtils.lerp(schoolRegion.z[0], schoolRegion.z[1], random()),
        );
      }
      dir.subVectors(school.target, school.pos);
      const d = dir.length();
      if (d > 0.3) dir.multiplyScalar(0.35 / d);
      else dir.set(0, 0, 0);
      school.vel.lerp(dir, Math.min(1, dt * 1.2));
    }
    school.pos.addScaledVector(school.vel, dt);
    if (!isSwirling) {
      school.pos.x = THREE.MathUtils.clamp(school.pos.x, schoolRegion.x[0], schoolRegion.x[1]);
      school.pos.z = THREE.MathUtils.clamp(school.pos.z, schoolRegion.z[0], schoolRegion.z[1]);
      school.pos.y = THREE.MathUtils.clamp(school.pos.y, SPECIES[0].yMin, SPECIES[0].yMax);
    }

    // ── 마리마다 ──
    const counts = SPECIES.map(() => 0);
    let inRing = 0;
    let curiousLeft = CURIOUS_COUNT;
    for (const fish of fishes) {
      const species = SPECIES[fish.species];
      fish.until -= dt;
      const dxp = fish.pos.x - px;
      const dzp = fish.pos.z - pz;
      const dp = Math.hypot(dxp, dzp, (fish.pos.y - py) * 0.5);
      if (species.school) {
        if (fish.until <= 0) {
          fish.until = 2 + random() * 3;
          const angle = random() * Math.PI * 2;
          const r = 0.3 + random() * 1.1;
          fish.offset.set(Math.cos(angle) * r, (random() - 0.5) * 0.9, Math.sin(angle) * r);
        }
        fish.target.copy(school.pos).add(fish.offset);
        if (isSwirling) {
          // 사람을 둘러싼 고리 — 떼 가운데가 아니라 사람을 축으로 촘촘히 돈다
          const a = Math.atan2(fish.offset.z, fish.offset.x) + time * 2.2 * swarm.current.turn;
          const r = SWARM.radius * (0.7 + Math.hypot(fish.offset.x, fish.offset.z) * 0.35);
          fish.target.set(px + Math.cos(a) * r, py - 0.3 + fish.offset.y * 0.8, pz + Math.sin(a) * r);
        } else if (swirl > 0.02) {
          // 베이트볼 — 떼 가운데를 축으로 빙글빙글, 위아래로 길쭉한 기둥처럼 뭉친다
          const a = Math.atan2(fish.offset.z, fish.offset.x) + time * 1.6;
          const r = 0.45 + Math.hypot(fish.offset.x, fish.offset.z) * 0.35;
          away.set(school.pos.x + Math.cos(a) * r, school.pos.y + fish.offset.y * 1.6, school.pos.z + Math.sin(a) * r);
          fish.target.lerp(away, swirl);
        }
      } else if (fish.species === 1 && isCurious && curiousLeft > 0 && dp < 14) {
        // 호기심 — 눈앞 조금 아래에서 맴돈다
        curiousLeft--;
        const k = CURIOUS_COUNT - curiousLeft;
        const a = time * 0.7 + k * 2.1;
        fish.target.set(
          px + scratch.forward.x * CURIOUS_DISTANCE + Math.cos(a) * 0.35,
          py - 0.02 + Math.sin(time * 1.3 + k) * 0.12,
          pz + scratch.forward.z * CURIOUS_DISTANCE + Math.sin(a) * 0.35,
        );
        fish.until = 0.5;
      } else if (underwater && dp < FLEE_RADIUS && !(fish.species === 1 && isCurious)) {
        away.set(dxp, 0, dzp).normalize();
        fish.target.set(fish.pos.x + away.x * 3.5, fish.pos.y + (random() - 0.5) * 0.4, fish.pos.z + away.z * 3.5);
        fish.until = 1.2;
      } else if (fish.until <= 0 || fish.pos.distanceTo(fish.target) < 0.4) {
        fish.until = 3 + random() * 5;
        fish.target.set(
          THREE.MathUtils.lerp(species.region.x[0], species.region.x[1], random()),
          THREE.MathUtils.lerp(species.yMin, species.yMax, random()),
          THREE.MathUtils.lerp(species.region.z[0], species.region.z[1], random()),
        );
      }
      // 영역 밖 목표는 안으로(휘감는 동안은 사람 둘레 그대로)
      if (!(species.school && isSwirling)) {
        fish.target.x = THREE.MathUtils.clamp(fish.target.x, species.region.x[0], species.region.x[1]);
        fish.target.z = THREE.MathUtils.clamp(fish.target.z, species.region.z[0], species.region.z[1]);
      }
      fish.target.y = THREE.MathUtils.clamp(
        fish.target.y,
        Math.max(species.yMin, floorY(fish.target.x, fish.target.z) + 0.2),
        species.yMax,
      );
      dir.subVectors(fish.target, fish.pos);
      const d = dir.length();
      const speed =
        species.speed *
        (dp < FLEE_RADIUS && !species.school && !isCurious ? 2.2 : 1) *
        (species.school && schoolDist < SCHOOL_FLEE_RADIUS ? 1.8 : 1) *
        (species.school ? 1 + swirl * 1.2 : 1) *
        (species.school && (isSwirling || swarmState.phase === "approach") ? 2.4 : 1);
      if (d > 0.05) dir.multiplyScalar(speed / d);
      fish.vel.lerp(dir, Math.min(1, dt * (species.school ? 2.2 : 1.4)));
      fish.pos.addScaledVector(fish.vel, dt);
      fish.pos.y = Math.max(fish.pos.y, floorY(fish.pos.x, fish.pos.z) + 0.15);
      fish.pos.y = Math.min(fish.pos.y, SURFACE_Y - 0.3);
      // 자세 — 머리(+x)가 가는 쪽
      const speedNow = fish.vel.length();
      if (speedNow > 0.02) {
        lookMatrix.lookAt(zero, fish.vel, up);
        quaternion.setFromRotationMatrix(lookMatrix).multiply(turn);
      }
      scale.setScalar(species.size * M);
      matrix.compose(fish.pos.clone().multiplyScalar(M), quaternion, scale);
      const index = counts[fish.species]++;
      world.meshes[fish.species].setMatrixAt(index, matrix);
      if (species.school) {
        // 은빛 번쩍 — 몸을 틀어 옆구리가 빛을 받을 때(돌아가는 동안 더 자주)
        const glint = Math.max(0, Math.sin(time * (2.2 + swirl * 4) + index * 1.37)) ** 12 * (0.6 + swirl * 1.4);
        scratch.color.setScalar(1 + glint * 1.8);
        world.meshes[fish.species].setColorAt(index, scratch.color);
      }
      if (fish.species === 0 && Math.hypot(fish.pos.x - RING.x, fish.pos.z - RING.z) < RING.radius) inRing++;
    }
    world.meshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    ringCount.current = inRing;

    // ── 돌 고리 — 열두 마리가 1.2초 들어와 있으면 진주 ──
    if (!ringDoneRef.current) {
      ringHold.current = inRing >= RING.need ? ringHold.current + dt : 0;
      if (ringHold.current >= RING.holdSeconds) {
        ringDoneRef.current = true;
        remember("fishes.ringDone", true);
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
        rows: [
          {
            label: "고리 안",
            value: ringDoneRef.current ? "진주가 떠올랐다" : `${inRing} / ${RING.need} 마리`,
            ok: ringDoneRef.current || inRing >= RING.need,
          },
        ],
      });
  });

  if (!isShown) return null;
  return (
    <>
      {world.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
      <group scale={M}>
        {/* 돌 고리 — 작은 바위 여덟 */}
        {world.ringStones.map((stone, i) => (
          <mesh
            key={i}
            geometry={world.rocks[stone.variant]}
            material={world.stone}
            position={[stone.x, floorY(stone.x, stone.z) - 0.04, stone.z]}
            rotation={[0, stone.yaw, 0]}
            scale={[stone.size, stone.size * 0.8, stone.size]}
            castShadow
          />
        ))}
      </group>
    </>
  );
}
