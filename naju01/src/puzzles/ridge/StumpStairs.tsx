/**
 * 통나무 걸상 — 평상 곁 걸상 다섯 윗면에 그림이 하나씩 새겨져 있다(해 · 달 · 물결 · 새 · 불).
 * 평상 널에 칼로 새긴 그날 밤 이야기(storyBurn)에 해 · 달 · 물결 · 새 · 불이 차례로 나온다.
 * 이야기 차례대로 걸상에 올라서면 [C] 로 꾹 밟을 때마다 새김에 흰빛이 들고, 틀리면 다 꺼진다(처음부터).
 * 바람이 잦아든 뒤에야(장승 고리) 걸상이 흔들리지 않아 디딜 수 있고, 평상 널이 다 타 글이 드러난 뒤에야 차례를 맞출 수 있다.
 * 다 맞히면 남은 바람이 걸상을 들어 올려 돌새 곁에 허공 계단으로 띄운다 — 허공이라 바람에 살짝 까딱인다. 밟고 올라가면 돌새에 손이 닿는다.
 * 걸상 모양은 화면의 「씬2.걸상」을 그대로 빌려 그리고, 원래 것은 숨긴다(걷기 판정도 같이 비운다). 좌표는 미터.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { recall, track } from "../../save/puzzleMemory";
import { playerPose } from "../../movement/playerPose";
import { releasePropColliders } from "../../movement/propColliders";
import { addDynamicSolid, type DynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { registerInteractable, showNotice } from "../interaction";
import { makeToonMaterial } from "../materials";
import { prewarmShaders } from "../prewarm";
import { setPuzzlePanel } from "../puzzlePanel";
import { M, groundY } from "../units";
import { PLATFORM } from "./ridgeShape";
import { ridge, ridgeQuest } from "./ridgeState";
import { STORY_CLOSING, STORY_LINES, createStoryBurn, placeStoryPlane, updateStoryBurn } from "./storyBurn";
import { STUMP_SYMBOLS, makeStumpTopTexture } from "./stumpArt";

/** 이야기 차례 — 해 · 달 · 물결 · 새 · 불 */
const ANSWER = [0, 1, 2, 3, 4];
/** 걸상마다 새긴 그림 — 남(z 작은 쪽)에서 북으로 늘어선 차례에 */
const CARVED = [2, 0, 4, 1, 3];
const STORY = STORY_LINES.join(" / ");
/** 허공 계단 — 두 돌새 사이 서쪽 곁에서 남서로 내려간다. 윗면 높이(땅 위 m) */
const STAIR_TOP = { x: 73.8, z: 21.55 };
const STAIR_STEP = { x: -0.55, z: -0.3 };
const STEP_HEIGHTS = [0.45, 0.85, 1.25, 1.65, 2.05];
const FLY_SECONDS = 2.6;
const FLY_STAGGER = 0.45;
/** 허공 계단의 까딱임 — 높이(m) · 기울기(rad) · 빠르기 */
const SWAY = { lift: 0.035, tilt: 0.022, rate: 0.9 };
/** 걸상 · 평상을 찾기 시작하는 거리(m) */
const SEARCH_RANGE = 25;

interface Stump {
  group: THREE.Group;
  /** 땅 위 처음 자리 · 계단 자리(미터) */
  home: THREE.Vector3;
  stair: THREE.Vector3;
  symbol: number;
  /** 윗면 높이(밑동 기준 m) · 반지름(m) */
  height: number;
  radius: number;
  top: THREE.MeshToonMaterial;
  solid: DynamicSolid;
  /** 새김에 든 빛 0~1 */
  lit: number;
  /** [C] 로 밟은 때 — 살짝 눌렸다 올라온다 */
  pressedAt: number;
}

function createStairs() {
  return {
    stumps: [] as Stump[],
    /** 빌려 온 원래 걸상 메시 — 매 장면 숨긴다 */
    sources: [] as THREE.Mesh[],
    /** 맞힌 걸상 수 */
    progress: 0,
    isPressQueued: false,
    /** 지금 딛고 선 걸상 · 마지막으로 딛고 섰던 걸상과 그때 */
    onNow: -1,
    lastOn: -1,
    lastOnAt: -99,
    solvedAt: -1,
    searchedAt: -99,
    storyTriedAt: -99,
    story: createStoryBurn(),
    told: { press: false, windy: false, burning: false, near: false },
  };
}
type Stairs = ReturnType<typeof createStairs>;

/** 윗면 꼭짓점(꼭대기에서 6% 안)의 가운데와 가장 먼 거리 — 모형 좌표에서 돌리고 키운 뒤 잰다(유닛, 밑동 기준 전) */
function measureTop(geometry: THREE.BufferGeometry, quaternion: THREE.Quaternion, scale: THREE.Vector3, maxY: number) {
  const position = geometry.attributes.position;
  const point = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  const threshold = maxY - (geometry.boundingBox!.max.y - geometry.boundingBox!.min.y) * 0.06;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).multiply(scale).applyQuaternion(quaternion);
    if (point.y >= threshold) points.push(point.clone());
  }
  const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(Math.max(1, points.length));
  const radius = points.reduce((best, p) => Math.max(best, Math.hypot(p.x - center.x, p.z - center.z)), 0);
  return { x: center.x, z: center.z, radius: radius || 0.3 * M };
}

/** 화면의 걸상을 빌려 우리 걸상 하나로 — 윗면에 새김 판을 덮고, 땅 · 계단 자리와 걷기 상자를 매긴다 */
function adoptStump(mesh: THREE.Mesh, matrix: THREE.Matrix4, order: number): { stump: Stump; group: THREE.Group } {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const group = new THREE.Group();
  const part = new THREE.Mesh(mesh.geometry, mesh.material);
  part.quaternion.copy(quaternion);
  part.scale.copy(scale);
  part.castShadow = true;
  part.receiveShadow = true;
  group.add(part);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry
    .boundingBox!.clone()
    .applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, scale));
  // 밑동이 원점에 오게
  part.position.y = -box.min.y;
  const height = (box.max.y - box.min.y) / M;
  // 윗면 — 통나무는 위가 좁거나 비뚤어 상자 크기로 재면 새김이 넘친다. 꼭대기 근처 꼭짓점만 모아 가운데와 반지름을 잰다
  const top = measureTop(mesh.geometry, quaternion, scale, box.max.y);
  const radius = top.radius / M;
  const topMaterial = makeToonMaterial("#FFFFFF", {
    map: makeStumpTopTexture(CARVED[order]),
    transparent: true,
    alphaTest: 0.3,
    emissive: new THREE.Color("#FFF8EE"),
    emissiveIntensity: 0,
  });
  const decal = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.8 * M, 24), topMaterial);
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(top.x, (height + 0.004) * M, top.z);
  group.add(decal);
  const home = new THREE.Vector3(position.x / M, groundY(position.x / M, position.z / M), position.z / M);
  group.position.set(home.x * M, home.y * M, home.z * M);
  const step = CARVED.length - 1 - order;
  const stairX = STAIR_TOP.x + STAIR_STEP.x * step;
  const stairZ = STAIR_TOP.z + STAIR_STEP.z * step;
  const solid: DynamicSolid = {
    x: home.x,
    z: home.z,
    yaw: 0,
    halfX: radius * 0.95,
    halfZ: radius * 0.95,
    bottom: home.y - 0.1,
    top: home.y + height,
    enabled: true,
  };
  const stump: Stump = {
    group,
    home,
    stair: new THREE.Vector3(stairX, groundY(stairX, stairZ) + STEP_HEIGHTS[CARVED.length - 1 - step] - height, stairZ),
    symbol: CARVED[order],
    height,
    radius,
    top: topMaterial,
    solid,
    lit: 0,
    pressedAt: -99,
  };
  return { stump, group };
}

export default function StumpStairs() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const stairs = useMemo(() => createStairs(), []);
  useEffect(
    () =>
      track("ridge.stumps", () =>
        stairs.stumps.length ? { progress: stairs.progress, lit: stairs.stumps.map((stump) => stump.lit) } : undefined,
      ),
    [stairs],
  );
  const removersRef = useRef<(() => void)[]>([]);

  useEffect(
    () => () => {
      removersRef.current.forEach((remove) => remove());
      for (const stump of stairs.stumps) scene.remove(stump.group);
    },
    [scene, stairs],
  );

  /** 화면의 걸상 다섯을 찾아 빌려 그린다 — 원래 것은 숨긴다(숨기면 걷기 격자도 새로 구워 비운다) */
  const borrowStumps = (time: number) => {
    if (stairs.stumps.length || time - stairs.searchedAt < 1) return;
    stairs.searchedAt = time;
    const found: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isMesh || object.name !== "씬2.걸상") return;
      object.updateMatrixWorld(true);
      if (mesh.isInstancedMesh)
        for (let i = 0; i < mesh.count; i++) {
          const matrix = new THREE.Matrix4();
          mesh.getMatrixAt(i, matrix);
          found.push({ mesh, matrix: matrix.premultiply(object.matrixWorld) });
        }
      else found.push({ mesh, matrix: object.matrixWorld.clone() });
    });
    if (found.length < CARVED.length) return;
    // 남(z 작은 쪽)에서 북으로
    found.sort((a, b) => a.matrix.elements[14] - b.matrix.elements[14]);
    found.slice(0, CARVED.length).forEach(({ mesh, matrix }, order) => {
      const { stump, group } = adoptStump(mesh, matrix, order);
      scene.add(group);
      removersRef.current.push(addDynamicSolid(stump.solid));
      releasePropColliders("걸상", stump.home.x, stump.home.z, 0.4);
      stairs.stumps.push(stump);
    });
    // 원래 걸상은 숨긴다 — 같은 모양을 우리가 그린다. 새 새김 재질은 미리 굽는다
    for (const { mesh } of found) mesh.visible = false;
    prewarmShaders(
      gl,
      scene,
      camera,
      stairs.stumps.map((stump) => stump.group),
    );
    stairs.sources = found.map((entry) => entry.mesh);
    // 이어 하기: 밟아 둔 걸상을 되돌린다. 걸상이 생긴 뒤라야 넣을 수 있다.
    const saved = recall<{ progress: number; lit: number[] } | null>("ridge.stumps", null);
    if (saved) {
      stairs.progress = saved.progress;
      stairs.stumps.forEach((stump, k) => {
        stump.lit = saved.lit[k] ?? 0;
      });
    }
  };

  /** 평상 널 위 글 — 평상 가까이에서 1 초에 한 번, 평상 윗면 높이를 위에서 쏴 잰다 */
  const placeStory = (time: number) => {
    if (stairs.story.plane || time - stairs.storyTriedAt < 1) return;
    if (Math.hypot(camera.position.x / M - PLATFORM.x, camera.position.z / M - PLATFORM.z) > SEARCH_RANGE) return;
    stairs.storyTriedAt = time;
    const targets: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && object.visible && object.name.endsWith("평상")) targets.push(object);
    });
    const ray = new THREE.Raycaster(
      new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + 3) * M, PLATFORM.z * M),
      new THREE.Vector3(0, -1, 0),
      0,
      3 * M,
    );
    ray.camera = camera;
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return;
    const plane = placeStoryPlane(stairs.story, hit.point);
    scene.add(plane, stairs.story.flames.points, stairs.story.fireLight);
    removersRef.current.push(() => scene.remove(plane, stairs.story.flames.points, stairs.story.fireLight));
    prewarmShaders(gl, scene, camera, [plane, stairs.story.flames.points]);
  };

  // [C] — 올라선 걸상을 꾹 밟는다(앉기 키와 같다)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyC" && !event.repeat) stairs.isPressQueued = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stairs]);

  useEffect(() => {
    const removeStory = registerInteractable({
      id: "ridge-platform-story",
      position: new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + 0.55) * M, PLATFORM.z * M),
      label: "타다 만 평상 널 살피기",
      radius: 0.8 * M,
      reach: 2.4 * M,
      enabled: () => stairs.story.isDone,
      use: () =>
        showNotice(`불에 그을린 널에 칼로 새긴 글이 드러났다 — 「${STORY}」 그리고 작게, 「${STORY_CLOSING}」`, 10),
    });
    if (import.meta.env.DEV)
      exposeDevHook("najuStumpDev", {
        solve: () => {
          stairs.progress = ANSWER.length;
          for (const stump of stairs.stumps) stump.lit = 1;
          ridgeQuest.set("stairs");
        },
        state: () => ({
          progress: stairs.progress,
          on: stairs.onNow,
          stumps: stairs.stumps.map((stump) => ({
            symbol: STUMP_SYMBOLS[stump.symbol],
            x: stump.home.x,
            z: stump.home.z,
            top: stump.group.position.y / M + stump.height,
            r: stump.radius,
          })),
        }),
      });
    return removeStory;
  }, [stairs]);

  /** 지금 딛고 선 걸상 — 넉넉히: 높이 뛰어 내려앉을 때 가장자리를 딛거나 막 내려앉는 중이어도 */
  const findStumpUnderfoot = (stairs: Stairs) => {
    const px = playerPose.x;
    const pz = playerPose.z;
    const foot = playerPose.footY;
    let on = -1;
    stairs.stumps.forEach((stump, k) => {
      const top = stump.group.position.y / M + stump.height;
      if (
        foot > top - 0.75 &&
        foot < top + 0.4 &&
        Math.hypot(px - stump.group.position.x / M, pz - stump.group.position.z / M) < stump.radius + 0.3
      )
        on = k;
    });
    return on;
  };

  /** [C] 로 밟은 걸상 판정 — 이야기 차례면 빛이 들고, 틀리면 다 꺼진다 */
  const pressStump = (stump: Stump, time: number) => {
    stump.pressedAt = time;
    if (!ridgeQuest.postsSolved) {
      if (!stairs.told.windy) {
        stairs.told.windy = true;
        showNotice(
          "걸상이 바람에 들썩여 디딜 때마다 흔들린다. 새김도 읽을 수가 없다 — 먼저 바람부터 잠재워야겠다.",
          4.5,
        );
      }
      return;
    }
    // 평상 널이 아직 타는 중 — 글이 다 드러나야 차례를 안다
    if (!stairs.story.isDone) {
      if (!stairs.told.burning) {
        stairs.told.burning = true;
        showNotice("새김은 보이는데 차례를 모른다 — 평상 널이 타며 드러나는 글을 먼저 읽자.", 4);
      }
      return;
    }
    // 이미 빛이 든 걸상을 또 밟았다 — 그대로 둔다
    if (stump.lit > 0) return;
    if (stump.symbol === ANSWER[stairs.progress]) {
      stairs.progress++;
      stump.lit = 1;
      audio.play("똑");
      if (stairs.progress === ANSWER.length) {
        stairs.solvedAt = time;
        ridgeQuest.set("stairs");
        audio.play("징");
        director.cue({ 카메라: "흔들림", 세기: 0.18 });
        showNotice(
          "다섯 새김에 흰빛이 다 들자, 남은 바람이 걸상을 하나씩 들어 올린다 — 돌새 곁에 허공 계단이 놓인다!",
          5.5,
        );
      }
    } else if (stairs.progress > 0) {
      stairs.progress = 0;
      for (const other of stairs.stumps) other.lit = 0;
      audio.play("우르릉");
      showNotice("걸상이 덜컹 내려앉으며 새김의 빛이 다 꺼진다. 처음부터 — 평상 널의 이야기 차례대로.", 4);
    }
  };

  /** 걸상 자리 — 땅 위에서 밟히면 4 cm 눌렸다 올라오고, 다 맞히면 차례로 들려 날아가 계단 자리에 뜬다 */
  const placeStumps = (time: number, dt: number) => {
    if (ridgeQuest.stairs && stairs.solvedAt < 0) stairs.solvedAt = time;
    stairs.stumps.forEach((stump, k) => {
      stump.top.emissiveIntensity += (stump.lit * 1.4 - stump.top.emissiveIntensity) * (1 - Math.exp(-dt * 6));
      let x = stump.home.x;
      let y = stump.home.y;
      let z = stump.home.z;
      let hasArrived = stairs.solvedAt < 0;
      if (stairs.solvedAt >= 0) {
        const u = THREE.MathUtils.clamp((time - stairs.solvedAt - 1.2 - k * FLY_STAGGER) / FLY_SECONDS, 0, 1);
        const eased = THREE.MathUtils.smootherstep(u, 0, 1);
        x = THREE.MathUtils.lerp(stump.home.x, stump.stair.x, eased);
        z = THREE.MathUtils.lerp(stump.home.z, stump.stair.z, eased);
        y = THREE.MathUtils.lerp(stump.home.y, stump.stair.y, eased) + Math.sin(eased * Math.PI) * 1.2;
        hasArrived = u >= 1;
        stump.group.rotation.set(Math.sin(eased * Math.PI) * 0.6, Math.sin(eased * Math.PI) * 1.4, 0);
        if (hasArrived) {
          // 허공에 떠 있다 — 바람에 천천히 오르내리고 살짝 기운다(디딤판도 같이)
          const phase = time * SWAY.rate + k * 1.3;
          y += Math.sin(phase) * SWAY.lift;
          stump.group.rotation.set(Math.sin(phase * 0.8) * SWAY.tilt, 0, Math.cos(phase * 0.7 + 1) * SWAY.tilt);
        }
      }
      const press = stairs.solvedAt < 0 ? Math.max(0, 1 - (time - stump.pressedAt) / 0.35) : 0;
      y -= 0.04 * Math.sin(press * Math.PI);
      stump.group.position.set(x * M, y * M, z * M);
      // 날아가는 동안은 막지 않는다(몸에 걸리지 않게), 자리에 서면 디딤판
      Object.assign(stump.solid, { x, z, bottom: y - 0.1, top: y + stump.height, enabled: hasArrived });
    });
  };

  /** 안내판 — 장막 안, 걸상 곁에서 */
  const showPanel = () => {
    const center = stairs.stumps[2].home;
    const distance = Math.hypot(camera.position.x / M - center.x, camera.position.z / M - center.z);
    if (ridge.stage() === "sealed" && ridgeQuest.postsSolved && !ridgeQuest.stairs && distance < 5) {
      if (!stairs.told.near) {
        stairs.told.near = true;
        showNotice(
          "바람이 잦아드니 걸상 윗면의 새김이 보인다 — 해 · 달 · 물결 · 새 · 불. 평상 널이 타며 드러난 글과 맞춰 보자.",
          5,
        );
      }
      setPuzzlePanel("ridge-stumps", {
        title: "통나무 걸상",
        rule: "걸상 다섯 윗면에 그림이 하나씩 새겨져 있다. 불에 탄 평상 널에 드러난 이야기 차례대로 올라서서 [C] 로 꾹 밟는다. 틀리면 처음부터.",
        rows: [{ label: "빛이 든 새김", value: `${stairs.progress} / ${ANSWER.length}` }],
        distance,
      });
    } else setPuzzlePanel("ridge-stumps", null);
  };

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    if (ridge.isAtLeast("sealing")) borrowStumps(time);
    placeStory(time);
    if (ridgeQuest.postsSolved) updateStoryBurn(stairs.story, time, dt, gl, camera);
    if (!stairs.stumps.length) return;
    // 원래 걸상이 다시 보이게 되면(구역 초점 등) 도로 숨긴다
    for (const mesh of stairs.sources) mesh.visible = false;

    const isSealed = ridge.stage() === "sealed";
    const on = findStumpUnderfoot(stairs);
    // 걸상 위에 올라서면 한 번 알려 준다 — 밟기는 [C] 로 꾹
    if (isSealed && ridgeQuest.postsSolved && !ridgeQuest.stairs && on >= 0 && !stairs.told.press) {
      stairs.told.press = true;
      showNotice("걸상 위에 올라섰다. [C] 로 꾹 밟으면 걸상이 눌린다.", 3.5);
    }
    stairs.onNow = on;
    if (on >= 0) {
      stairs.lastOn = on;
      stairs.lastOnAt = time;
    }
    const isPressed = stairs.isPressQueued;
    stairs.isPressQueued = false;
    // 누른 바로 그 장면에 판정이 흔들려도 — 방금까지 서 있던 걸상으로 친다
    const pressedOn = on >= 0 ? on : time - stairs.lastOnAt < 0.4 ? stairs.lastOn : -1;
    if (isSealed && !ridgeQuest.stairs && pressedOn >= 0 && isPressed) pressStump(stairs.stumps[pressedOn], time);

    placeStumps(time, dt);
    showPanel();
  });

  return null;
}
