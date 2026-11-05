/**
 * 진부촌 문 — 두 장승 사이 돌단 · 횃불 · 장승 고리.
 *   궤를 돌단에 올리면(RidgeCart) 뚜껑이 저절로 열리고 안에 낡은 종이(oldPaper) — 장승 이름과 고리 그림을 짚어 준다.
 *   장승마다 머리 고리 · 발 고리가 있고(E 한 번에 한 칸, 네 그림: 해 · 달 · 물결 · 새), 장승 몸에는 이름이 새겨져 있다.
 *   넷을 글대로 맞추면 땅이 울리며 흔들리다가, 고리가 저절로 돌기 시작하고 횃불이 불티를 뿜으며 크게 치솟는다
 *   → 바람이 잦아든다(ridgeQuest.postsSolved). 처음 횃불에는 불꽃 모양이 없다(모형에서 뺀다).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { recall, track } from "../../save/puzzleMemory";
import { addDynamicSolid } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { registerInteractable, showNotice } from "../interaction";
import { makeToonMaterial } from "../materials";
import { prewarmShaders } from "../prewarm";
import { setPuzzlePanel } from "../puzzlePanel";
import { M, groundY } from "../units";
import { buildAltar, makeRingTexture } from "./gateArt";
import { POSTS, SYMBOLS, angleFor, buildPostRings, isSolved, type Ring } from "./gateRings";
import { PAPER_READING, openPaper } from "./oldPaper";
import { ALTAR, GATE, RIDGE_CENTER } from "./ridgeShape";
import { ridge, ridgeQuest, useRidgeQuest } from "./ridgeState";
import { createTorchFire, stripFlame, updateTorchFire } from "./torchFlames";

/** 고리를 맞춘 뒤 땅이 흔들리는 시간(초) — 끝나면 바람이 잦아든다 */
const QUAKE_SECONDS = 3;
/** 맞춘 뒤 고리가 저절로 도는 빠르기(rad/s) — 머리 고리와 발 고리는 반대로 · 손으로 돌릴 때 따라오는 빠르기 */
const SPIN_SPEED = 3.2;
const TURN_SPEED = 7;
/** 안내판이 뜨는 거리(m) · 장승을 재기 시작하는 거리 */
const PANEL_RANGE = 6;
const MEASURE_RANGE = 25;

function createGate() {
  return {
    altar: buildAltar(),
    ringMaterial: makeToonMaterial("#FFFFFF", { map: makeRingTexture() }),
    fire: createTorchFire(),
    rings: [] as Ring[],
    names: [] as THREE.Mesh[],
    /** 고리를 다 맞춘 때(초, performance 시계) — 땅이 흔들리고 나서 바람이 잦아든다 */
    ringsSolvedAt: -1,
    lastQuakeAt: 0,
    /** 횃불 불꽃 밑동(유닛) — 모형을 찾으면 적는다 */
    torchTops: GATE.torches.map(() => null as THREE.Vector3 | null),
    /** 불꽃 뿔을 뺀 횃불 사본 */
    torchCopies: GATE.torches.map(() => null as THREE.Mesh | null),
    /** 문 횃불만 든 인스턴스 무리 — 매 장면 숨긴다 */
    torchMeshes: [] as THREE.InstancedMesh[],
    areTorchesFound: false,
    torchCheckedAt: -99,
    /** 불이 붙은 때 · 크게 타오르기 시작한 때(초, 장면 시계) */
    litAt: -1,
    flaredAt: -1,
    measuredAt: -99,
    toldLid: false,
    toldRings: false,
  };
}
type Gate = ReturnType<typeof createGate>;

/** 고리 넷이 맞물렸다 — 땅이 울리며 흔들리고(QUAKE_SECONDS) 그 뒤 바람이 잦아든다(프레임에서) */
function solveRings(gate: Gate) {
  if (gate.ringsSolvedAt >= 0) return;
  gate.ringsSolvedAt = performance.now() / 1000;
  audio.play("징");
  audio.play("우르릉");
  showNotice("고리 넷이 딸깍 맞물린다 — 발밑에서 땅이 우르르 울린다…", 4);
}

export default function GateAltar() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  useRidgeQuest();
  const gate = useMemo(() => {
    const created = createGate();
    // 시각은 페이지 시작부터 세므로 0 이면 흔들림이 끝난 뒤다.
    if (ridgeQuest.postsSolved) created.ringsSolvedAt = 0;
    // 궤를 이미 올렸으면 뚜껑이 열리는 안내를 다시 띄우지 않는다.
    created.toldLid = ridgeQuest.chestOnAltar;
    return created;
  }, []);
  useEffect(
    () => track("ridge.ringSymbols", () => (gate.rings.length ? gate.rings.map((ring) => ring.symbol) : undefined)),
    [gate],
  );

  useEffect(() => {
    const { altar, fire } = gate;
    altar.position.set(ALTAR.x * M, groundY(ALTAR.x, ALTAR.z) * M, ALTAR.z * M);
    altar.rotation.y = Math.atan2(RIDGE_CENTER.x - ALTAR.x, RIDGE_CENTER.z - ALTAR.z);
    scene.add(altar, fire.flames.points, fire.sparks.points, ...fire.lights);
    // 불꽃 · 불티는 궤를 올려야 처음 보인다 — 셰이더를 미리 굽는다
    const warm = window.setTimeout(
      () => prewarmShaders(gl, scene, camera, [fire.flames.points, fire.sparks.points]),
      3400,
    );
    const removeSolid = addDynamicSolid({
      x: ALTAR.x,
      z: ALTAR.z,
      yaw: altar.rotation.y,
      halfX: 0.5,
      halfZ: 0.4,
      bottom: groundY(ALTAR.x, ALTAR.z) - 0.4,
      top: groundY(ALTAR.x, ALTAR.z) + ALTAR.top,
      enabled: true,
    });
    return () => {
      window.clearTimeout(warm);
      scene.remove(altar, fire.flames.points, fire.sparks.points, ...fire.lights);
      for (const ring of gate.rings) scene.remove(ring.mesh);
      for (const name of gate.names) scene.remove(name);
      for (const copy of gate.torchCopies) if (copy) scene.remove(copy);
      removeSolid();
    };
  }, [scene, gate, gl, camera]);

  /** 장승을 재서 고리 · 이름을 단다 — 문 가까이 왔을 때 1 초에 한 번, 다 재면 다시 안 본다 */
  const measurePosts = (time: number) => {
    if (gate.rings.length || time - gate.measuredAt < 1) return;
    if (Math.hypot(camera.position.x / M - GATE.center.x, camera.position.z / M - GATE.center.z) > MEASURE_RANGE)
      return;
    gate.measuredAt = time;
    const postRings = buildPostRings(scene, camera, gate.ringMaterial);
    if (!postRings) return;
    gate.rings = postRings.rings;
    gate.names = postRings.names;
    // 이어 하기: 맞춰 둔 그림을 되돌린다. 다 맞았는데 진행 전에 나갔다면 여기서 이어 간다.
    const savedSymbols = recall<number[]>("ridge.ringSymbols", []);
    gate.rings.forEach((ring, k) => {
      if (savedSymbols[k] === undefined) return;
      ring.symbol = savedSymbols[k];
      ring.target = angleFor(ring.front, ring.symbol);
      ring.angle = ring.target;
    });
    if (savedSymbols.length && !ridgeQuest.postsSolved && isSolved(gate.rings)) solveRings(gate);
    // 방금 만든 고리 · 이름판 — 첫 프레임에 굽느라 멈추지 않게
    prewarmShaders(gl, scene, camera, [...postRings.rings.map((ring) => ring.mesh), ...postRings.names]);
  };

  /**
   * 문 양옆 횃불 — 화면의 횃불(인스턴스 무리)에서 그 자리만 숨기고, 불꽃 뿔을 뺀 사본을 그 자리에 세운다.
   * 0.3 초에 한 번 찾고, 찾은 무리는 매 장면 숨긴다(구역 초점이 도로 보이게 해도 깜박이지 않게)
   */
  const hideTorches = (time: number) => {
    if (!gate.areTorchesFound && time - gate.torchCheckedAt > 0.3) {
      gate.torchCheckedAt = time;
      const matrix = new THREE.Matrix4();
      const at = new THREE.Vector3();
      scene.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh || !object.name.replace(/^AI허브:/, "").startsWith("소품.횃불")) return;
        mesh.updateMatrixWorld(true);
        // 이 무리의 인스턴스가 전부 문 횃불이면 통째로 숨긴다
        const full = mesh.userData.fullSet as { matrices: Float32Array; n: number } | undefined;
        const count = full ? full.n : mesh.count;
        let mine = 0;
        for (let i = 0; i < count; i++) {
          if (full) matrix.fromArray(full.matrices, i * 16);
          else mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld);
          at.setFromMatrixPosition(matrix).divideScalar(M);
          const k = GATE.torches.findIndex((torch) => Math.hypot(torch.x - at.x, torch.z - at.z) < 0.6);
          if (k < 0) continue;
          mine++;
          if (!gate.torchCopies[k] && !object.name.endsWith("·원경")) {
            const { geometry, top } = stripFlame(mesh.geometry);
            const copy = new THREE.Mesh(geometry, mesh.material);
            matrix.decompose(copy.position, copy.quaternion, copy.scale);
            copy.castShadow = true;
            scene.add(copy);
            copy.updateMatrixWorld(true);
            gate.torchCopies[k] = copy;
            gate.torchTops[k] = new THREE.Vector3(0, top, 0).applyMatrix4(copy.matrixWorld);
          }
        }
        if (mine > 0 && mine === count) gate.torchMeshes.push(mesh);
      });
      gate.areTorchesFound = gate.torchTops.every(Boolean);
    }
    for (const mesh of gate.torchMeshes) mesh.visible = false;
  };

  // 고리 돌리기 — E 한 번에 한 칸(90°). 고리는 장승이 선 뒤에 생기므로 생길 때까지 기다렸다 등록한다
  useEffect(() => {
    const removers: (() => void)[] = [];
    const timer = setInterval(() => {
      if (!gate.rings.length || removers.length) return;
      gate.rings.forEach((ring, i) =>
        removers.push(
          registerInteractable({
            id: `ridge-post-ring-${i}`,
            position: ring.touch,
            label: `${POSTS[ring.post].name} ${ring.slot === 0 ? "머리" : "발"} 고리 돌리기`,
            highlight: () => ring.mesh,
            radius: 0.3 * M,
            reach: 2.6 * M,
            enabled: () => ridge.stage() === "sealed" && gate.ringsSolvedAt < 0,
            use: () => {
              if (!ridgeQuest.chestOnAltar) {
                showNotice("고리가 꿈쩍도 않는다 — 두 장승 사이 돌단이 비어 있다. 무언가 올려야 하는 듯하다.", 3.5);
                return;
              }
              ring.symbol = (ring.symbol + 1) % SYMBOLS.length;
              ring.target -= Math.PI / 2;
              audio.play("똑");
              if (isSolved(gate.rings)) solveRings(gate);
            },
          }),
        ),
      );
    }, 500);
    const removeLid = registerInteractable({
      id: "ridge-chest-lid",
      position: new THREE.Vector3(ALTAR.x * M, (groundY(ALTAR.x, ALTAR.z) + ALTAR.top + 0.45) * M, ALTAR.z * M),
      label: "궤 속 낡은 종이 읽기",
      radius: 0.35 * M,
      reach: 2.4 * M,
      enabled: () => ridgeQuest.chestOnAltar && !ridge.isAtLeast("rift"),
      use: () => openPaper(),
    });
    return () => {
      clearInterval(timer);
      removers.forEach((remove) => remove());
      removeLid();
    };
  }, [gate]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuGateDev", {
      solvePosts: () => {
        for (const ring of gate.rings) {
          ring.symbol = POSTS[ring.post].answer[ring.slot];
          ring.target = angleFor(ring.front, ring.symbol);
        }
        solveRings(gate);
      },
      rings: () => gate.rings.map((ring) => SYMBOLS[ring.symbol]),
    });
  }, [gate]);

  /** 맞춘 뒤 — 땅이 점점 세게 흔들리다 멎으면 바람이 잦아든다 */
  const quake = (time: number) => {
    if (gate.ringsSolvedAt < 0 || ridgeQuest.postsSolved) return;
    const progress = (performance.now() / 1000 - gate.ringsSolvedAt) / QUAKE_SECONDS;
    if (time - gate.lastQuakeAt > 0.45) {
      gate.lastQuakeAt = time;
      director.cue({ 카메라: "흔들림", 세기: 0.12 + 0.3 * Math.min(1, progress) });
    }
    if (progress >= 1) {
      ridgeQuest.set("postsSolved");
      audio.play("전환");
      showNotice(
        "고리가 저절로 돌기 시작하자 문 양옆 횃불에 불이 붙어 미친 듯 타오른다 — 불던 바람이 잠잠해진다.",
        5.5,
      );
    }
  };

  const turnRings = (dt: number) => {
    for (const ring of gate.rings) {
      if (ridgeQuest.postsSolved) {
        // 저절로 돈다 — 머리 고리와 발 고리가 서로 반대로
        ring.target += (ring.slot === 0 ? 1 : -1) * SPIN_SPEED * dt;
        ring.angle = ring.target;
      } else ring.angle += (ring.target - ring.angle) * (1 - Math.exp(-dt * TURN_SPEED));
      ring.mesh.rotation.y = ring.angle;
    }
  };

  /** 안내판 — 궤를 올린 뒤 문 가까이에서, 고리를 맞추기 전까지 */
  const showPanel = () => {
    const distance = Math.hypot(camera.position.x / M - GATE.center.x, camera.position.z / M - GATE.center.z);
    const isPuzzling =
      ridge.stage() === "sealed" && ridgeQuest.chestOnAltar && gate.ringsSolvedAt < 0 && gate.rings.length > 0;
    if (!isPuzzling || distance >= PANEL_RANGE) {
      setPuzzlePanel("ridge-posts", null);
      return;
    }
    if (!gate.toldRings) {
      gate.toldRings = true;
      showNotice(
        "두 장승에 머리 고리 · 발 고리가 끼워져 있다. 장승 몸에는 이름이 새겨져 있다 — 궤 속 종이와 맞춰 보자.",
        4.5,
      );
    }
    setPuzzlePanel("ridge-posts", {
      title: "장승 고리",
      rule: `궤 속 종이 — 「${PAPER_READING}」 장승마다 머리 고리 · 발 고리를 [E] 로 돌려 그 그림을 앞으로 맞춘다.`,
      rows: gate.rings.map((ring) => ({
        label: `${POSTS[ring.post].name} · ${ring.slot === 0 ? "머리" : "발"}`,
        value: SYMBOLS[ring.symbol],
      })),
      distance,
    });
  };

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = frame.clock.elapsedTime;
    hideTorches(time);
    measurePosts(time);
    quake(time);
    turnRings(dt);

    if (ridgeQuest.chestOnAltar && !gate.toldLid) {
      gate.toldLid = true;
      audio.play("단서");
      showNotice("궤를 돌단에 올리자 뚜껑이 삐걱 열린다. 안에 낡은 종이가 있다 — [E] 로 꺼내 읽자.", 5);
    }
    // 불은 고리를 맞춘 뒤에야 — 횃불이 나타나며 바로 크게 타오른다. 치솟는 순간 한 번 확 솟았다가 크게 타오르는 채로
    if (ridgeQuest.postsSolved && gate.flaredAt < 0) {
      gate.flaredAt = time;
      gate.litAt = time;
    }
    const lit = gate.litAt < 0 ? 0 : THREE.MathUtils.smoothstep(time - gate.litAt, 0, 0.5);
    const big = gate.flaredAt < 0 ? 0 : THREE.MathUtils.smoothstep(time - gate.flaredAt, 0, 1.5);
    const flare =
      gate.flaredAt < 0 ? 0 : Math.exp(-(time - gate.flaredAt) * 1.2) * Math.min(1, (time - gate.flaredAt) * 4);
    updateTorchFire(gate.fire, gate.torchTops, time, { lit, big, flare }, gate.areTorchesFound, gl, frame.camera);

    showPanel();
  });

  return null;
}
