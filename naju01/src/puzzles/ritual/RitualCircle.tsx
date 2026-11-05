/**
 * 기우제 — 돌탑 마법진 → 빛나는 소반에 제물 셋 → 빛기둥 · 폭우 → 물이 차오른다.
 * 소반 둘레 땅에 돌탑 자리(홈) 여섯만 새겨져 있다. 돌탑을 [E] 로 끌어 홈에 놓으면 돌 수와 눈금 수가 같을 때 빛이 든다.
 * 여섯이 다 맞으면 마법진이 그려지고 소반이 빛난다. 손에 든 제물 셋을 올리면 빛이 하늘로 솟고 비가 쏟아지다 물이 차오른다.
 * 물 위에 뜬 돌 넷(FloatingStones)을 다 건지면 강물이 갈라지고, 물굴에서 돌아오면 물이 빠진다.
 * 카메라는 건드리지 않는다 — 번개 · 비 · 바람만 연출 큐로 건다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { recall, remember, track } from "../../save/puzzleMemory";
import { audio } from "../../scene/immersion/audio";
import { director, setZoneRainGate } from "../../scene/immersion/director";
import { CORRIDOR, getPartOpenness } from "../cave/caveState";
import { registerInteractable, setKeyInterceptor, showNotice } from "../interaction";
import { ITEMS, type ItemKind } from "../inventory";
import { buildItemLooks } from "../itemLooks";
import { jarPuzzle } from "../jars/jarState";
import { makgeolliBottle } from "../makgeolli/makgeolliState";
import { prewarmShaders } from "../prewarm";
import { M, groundY } from "../units";
import { createCairns, disposeCairns, updateCairns, type Cairn } from "./cairnRig";
import {
  CARVED_COLOR,
  CIRCLE_CENTER,
  GLOW_COLOR,
  HANJA_BANDS,
  NODES,
  buildCircleLines,
  buildHanjaBand,
  buildNodeMark,
  makeHanjaTexture,
  makeRevealMaterial,
} from "./magicCircle";
import { buildRitualEffects, partRiverSheets } from "./ritualEffects";
import { getWaterLevel, ritual, setStormRain, setWaterLevel, useRitualStage } from "./ritualState";
import { createBoatRock, createRopeFlutter } from "./scenePatches";

const OFFERINGS: ItemKind[] = ["lightFish", "rice", "makgeolli"];
/** 이어 하기 시계의 시작값(초). 지나간 연출이 모두 끝난 뒤로 잡는다 */
const RESUME_CLOCK = 1000;

/** 소반 상판 높이(미터) — 씬5 소반(키 0.38) */
const TABLE_TOP = 0.38;
/** 놓았을 때 이 거리(미터) 안의 빈 홈으로 빨려 든다 */
const SNAP_RADIUS = 0.7;
/** 마법진이 다 그려지는 시간(초) */
const DRAW_SECONDS = 5.5;
/** 빛기둥이 솟는 시간 · 높이(미터) */
const PILLAR_SECONDS = 1.6;
const PILLAR_HEIGHT = 70;
/** 빛기둥이 솟은 뒤 물이 차기 시작하기까지 · 차오르는 시간(초) · 높이(미터) */
const FLOOD_DELAY = 4;
const FLOOD_SECONDS = 14;
const FLOOD_LEVEL = 0.7;
/** 폭우가 이만큼(초) 쏟아진 뒤 잦아든다 — 그 뒤는 평소 비 */
const STORM_SECONDS = 40;
/** 물굴에서 돌아온 뒤 물이 빠지는 시간(초) */
const DRAIN_SECONDS = 10;
/** 번개 셋 — 기둥이 다 솟은 뒤 치는 때(초) */
const STRIKE_TIMES = [PILLAR_SECONDS, PILLAR_SECONDS + 2.2, PILLAR_SECONDS + 5];

export default function RitualCircle() {
  const stage = useRitualStage();
  const { scene, gl, camera } = useThree();
  const ropeFlutter = useMemo(() => createRopeFlutter(), []);
  const boatRock = useMemo(() => createBoatRock(), []);

  // 2구역 날씨 — 처음엔 비 없이 밝은 한낮. 기우제로 빛기둥이 솟으면 흐려지며 비가 온다(그 뒤로 쭉)
  useEffect(() => {
    setZoneRainGate("Z2", () => ritual.isAtLeast("rising"));
    return () => setZoneRainGate("Z2", null);
  }, []);

  const cairnRig = useMemo(() => createCairns(), []);
  const cairns = cairnRig.cairns;

  const circle = useMemo(() => {
    const lines = buildCircleLines();
    const nodeMarks = NODES.map((_, k) => buildNodeMark(k));
    const carved = new THREE.MeshBasicMaterial({
      color: CARVED_COLOR,
      transparent: true,
      // 홈 · 正 획은 살짝만 — 바닥에 옅게 새긴 정도
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const linesGlow = makeRevealMaterial();
    // 맞춘 자리 표식 빛 — 마법진 선보다 한결 연하게(돌 수를 셀 수 있을 만큼만)
    const nodeGlows = NODES.map(() => {
      const material = makeRevealMaterial();
      material.uniforms.uColor.value.copy(GLOW_COLOR).multiplyScalar(0.62);
      return material;
    });
    const hanja = HANJA_BANDS.map(({ text, inner, outer, reveal }) => {
      const texture = makeHanjaTexture(text);
      return {
        geometry: buildHanjaBand(inner, outer, text.length, reveal),
        texture,
        material: makeRevealMaterial(texture),
      };
    });
    return { lines, nodeMarks, carved, linesGlow, nodeGlows, hanja };
  }, []);

  const effects = useMemo(() => buildRitualEffects(), []);

  // 제상 위 제물 — 올린 것만 보인다
  const looks = useMemo(() => buildItemLooks(), []);
  const offeringMeshes = useMemo(
    () =>
      OFFERINGS.map((kind, i) => {
        const mesh = new THREE.Mesh(looks[kind].geometry, looks[kind].material);
        const x = CIRCLE_CENTER.x + (i - 1) * 0.2;
        const z = CIRCLE_CENTER.z;
        mesh.position.set(x * M, (groundY(x, z) + TABLE_TOP + looks[kind].lift) * M, z * M);
        mesh.scale.setScalar(M * 0.8);
        mesh.visible = false;
        return mesh;
      }),
    [looks],
  );

  // 빛기둥 · 물 · 제물은 기우제 때 처음 보인다 — 그 순간 셰이더를 굽느라 멈추지 않게 불러올 때 미리 굽는다.
  // 공양을 시작할 때 한 번 더(그사이 장면이 바뀌었을 수 있다). 빗줄기(StormRain · 날씨 비)도 같이
  const isOffering = stage === "offering";
  useEffect(() => {
    const warm = () =>
      prewarmShaders(gl, scene, camera, [
        effects.pillar,
        effects.water,
        effects.glowSprite,
        ...effects.riverSheets,
        ...offeringMeshes,
        scene.getObjectByName("immersion.rain"),
        scene.getObjectByName("immersion.splash"),
        scene.getObjectByName("immersion.drips"),
        scene.getObjectByName("ritual.stormRain"),
      ]);
    const timer = window.setTimeout(warm, isOffering ? 0 : 2500);
    return () => window.clearTimeout(timer);
  }, [gl, scene, camera, effects, offeringMeshes, isOffering]);

  useEffect(
    () => () => {
      disposeCairns(cairnRig);
      circle.lines.dispose();
      circle.nodeMarks.forEach((geometry) => geometry.dispose());
      circle.carved.dispose();
      circle.linesGlow.dispose();
      circle.nodeGlows.forEach((material) => material.dispose());
      for (const band of circle.hanja) {
        band.geometry.dispose();
        band.texture.dispose();
        band.material.dispose();
      }
      effects.dispose();
      for (const look of Object.values(looks)) {
        look.geometry.dispose();
        look.material.dispose();
      }
    },
    [cairnRig, circle, effects, looks],
  );

  // 진행 — 렌더와 무관한 값이라 ref 로 둔다
  const draggingRef = useRef<number | null>(null);
  const offeredRef = useRef(
    new Set<ItemKind>(ritual.isAtLeast("rising") ? OFFERINGS : recall<ItemKind[]>("ritual.offered", [])),
  );
  // 이어 하기: 지나간 연출은 다 끝난 때로 시작한다. 음수 시각은 「아직」이라 시계를 앞당겨 둔다.
  const [resume] = useState(() => {
    const stage = ritual.stage();
    const isFlooded = ritual.isAtLeast("flooded") && stage !== "cleared";
    return {
      clock: stage === "cairns" ? 0 : RESUME_CLOCK,
      // 그리거나 솟는 중이었다면 그 연출은 처음부터 다시 돈다.
      drawAt: ritual.isAtLeast("offering") ? 0 : stage === "drawing" ? RESUME_CLOCK : -1,
      riseAt: isFlooded ? 0 : stage === "rising" ? RESUME_CLOCK : -1,
      clearedAt: stage === "cleared" ? 0 : -1,
      strikes: isFlooded ? STRIKE_TIMES.length + 1 : 0,
    };
  });
  const clockRef = useRef(resume.clock);
  const drawAtRef = useRef(resume.drawAt);
  const riseAtRef = useRef(resume.riseAt);
  const drainAtRef = useRef(-1);
  const clearedAtRef = useRef(resume.clearedAt);
  const strikesRef = useRef(resume.strikes);

  // 돌탑 자리와 올린 제물을 저장본에서 되돌린다.
  useEffect(() => {
    const isSolved = ritual.stage() !== "cairns";
    const nodes = recall<(number | null)[]>("ritual.cairnNodes", []);
    cairns.forEach((cairn, index) => {
      const node = isSolved ? NODES.findIndex((entry) => entry.notches === cairn.stones) : (nodes[index] ?? null);
      if (node === null || node < 0) return;
      cairn.node = node;
      cairn.position.set(NODES[node].x, 0, NODES[node].z);
      cairn.isLit = NODES[node].notches === cairn.stones;
    });
    offeredRef.current.forEach((kind) => {
      offeringMeshes[OFFERINGS.indexOf(kind)].visible = true;
    });
    return track("ritual.cairnNodes", () => cairns.map((cairn) => cairn.node));
  }, [cairns, offeringMeshes]);

  useEffect(() => {
    /** 돌탑 하나가 홈에 맞았다 — 다 맞으면 마법진을 그린다 */
    const light = (cairn: Cairn) => {
      cairn.isLit = true;
      if (cairns.every((entry) => entry.isLit)) {
        drawAtRef.current = clockRef.current + 0.6;
        ritual.draw();
      }
    };
    const release = () => {
      const index = draggingRef.current;
      draggingRef.current = null;
      setKeyInterceptor(null);
      if (index === null) return;
      const cairn = cairns[index];
      // 가장 가까운 빈 홈으로 빨려 든다
      let best = -1;
      let bestDistance = SNAP_RADIUS;
      NODES.forEach((node, k) => {
        if (cairns.some((entry) => entry !== cairn && entry.node === k)) return;
        const distance = Math.hypot(node.x - cairn.position.x, node.z - cairn.position.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = k;
        }
      });
      audio.play("똑");
      if (best < 0) return;
      cairn.node = best;
      cairn.position.set(NODES[best].x, 0, NODES[best].z);
      if (NODES[best].notches === cairn.stones) light(cairn);
      else {
        cairn.wobble = 1;
        showNotice("홈에 새긴 눈금 수와 돌 수가 맞지 않는다.", 2.6);
      }
    };
    const grab = (index: number) => {
      draggingRef.current = index;
      cairns[index].node = null;
      // 끄는 동안 [E] 는 내려놓기 하나뿐 — 겨눈 다른 것이 받지 않게 먼저 가로챈다
      setKeyInterceptor(() => {
        release();
        return true;
      });
      audio.play("똑");
    };
    const offer = (kind: string) => {
      offeredRef.current.add(kind as ItemKind);
      remember("ritual.offered", [...offeredRef.current]);
      offeringMeshes[OFFERINGS.indexOf(kind as ItemKind)].visible = true;
      audio.play("단서");
      if (offeredRef.current.size < OFFERINGS.length) {
        showNotice(`제물을 올렸다. (${offeredRef.current.size}/${OFFERINGS.length})`, 2.4);
        return;
      }
      riseAtRef.current = clockRef.current;
      strikesRef.current = 0;
      ritual.rise();
    };
    /** 막걸리를 챙기고 항아리 퍼즐을 푼 뒤에야 돌탑이 움직인다 */
    const tryGrab = (index: number) => {
      if (makgeolliBottle.isTaken() && jarPuzzle.stage() === "open") {
        grab(index);
        return;
      }
      cairns[index].wobble = Math.max(cairns[index].wobble, 0.3);
      audio.play("똑");
      showNotice(
        makgeolliBottle.isTaken()
          ? "돌탑이 땅에 박힌 듯 꿈쩍도 않는다. 장독대 항아리 쪽에서 아직 무언가 기다린다."
          : "돌탑이 땅에 박힌 듯 꿈쩍도 않는다. 먼저 물가의 배를 둘러보자.",
        4,
      );
    };

    const disposers = [
      ...cairns.map((cairn, index) =>
        registerInteractable({
          id: `ritual-cairn-${index}`,
          position: cairn.center,
          label: "돌탑 끌기",
          radius: 0.35 * M,
          reach: 2.8 * M,
          enabled: () => ritual.stage() === "cairns" && !cairn.isLit && draggingRef.current === null,
          use: () => tryGrab(index),
        }),
      ),
      registerInteractable({
        id: "ritual-table",
        position: new THREE.Vector3(
          CIRCLE_CENTER.x * M,
          (groundY(CIRCLE_CENTER.x, CIRCLE_CENTER.z) + TABLE_TOP + 0.1) * M,
          CIRCLE_CENTER.z * M,
        ),
        label: "소반 살펴보기",
        radius: 0.45 * M,
        reach: 2.8 * M,
        enabled: () => draggingRef.current === null,
        use: () => {
          const now = ritual.stage();
          if (now === "cairns") showNotice("소반 둘레 땅에 무언가 새겨져 있다. 돌탑이 설 자리 같다.", 3.2);
          else if (now === "offering") showNotice("소반이 빛난다. 제물을 손에 들고 올리자. [I]", 3);
        },
        handLabel: (kind) =>
          ritual.stage() === "offering" &&
          OFFERINGS.includes(kind as ItemKind) &&
          !offeredRef.current.has(kind as ItemKind)
            ? `${ITEMS[kind as ItemKind].name} 소반에 올리기`
            : null,
        receive: offer,
      }),
    ];
    if (import.meta.env.DEV)
      exposeDevHook("najuRitualDev", {
        grab,
        release,
        moveTo: (x: number, z: number) => {
          const index = draggingRef.current;
          if (index !== null) cairns[index].position.set(x, 0, z);
        },
        solve: () =>
          cairns.forEach((cairn) => {
            const k = NODES.findIndex((node) => node.notches === cairn.stones);
            cairn.node = k;
            cairn.position.set(NODES[k].x, 0, NODES[k].z);
            if (!cairn.isLit) light(cairn);
          }),
        offer,
      });
    return () => {
      disposers.forEach((dispose) => dispose());
      setKeyInterceptor(null);
    };
  }, [cairns, offeringMeshes]);

  /** 빛기둥 · 번개 · 폭우 · 물 — 제물이 다 오른 뒤부터 매 프레임 */
  const updateFlood = (time: number) => {
    const since = time - riseAtRef.current;
    const grow = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(since / PILLAR_SECONDS, 0, 1), 0, 1);
    const fade = 1 - THREE.MathUtils.clamp((since - 7) / 4, 0, 1);
    effects.pillar.visible = fade > 0;
    effects.pillar.scale.y = Math.max(0.001, grow * PILLAR_HEIGHT * M);
    effects.pillarMaterials.forEach((material, i) => (material.opacity = (i === 0 ? 0.9 : 0.25) * fade));
    // 둘레 빛무리 — 기둥과 같이 커졌다가 같이 잦아든다. 숨 쉬듯 일렁인다
    const breathe = 1 + 0.08 * Math.sin(time * 2.3);
    effects.glowSprite.visible = fade > 0 && grow > 0.01;
    effects.glowSprite.scale.setScalar((2.5 + 9 * grow) * breathe * fade * M);
    effects.glowSprite.material.opacity = 0.55 * fade;
    effects.glowLight.intensity = 7 * grow * fade * breathe;
    // 기둥이 다 솟으면 번개 셋과 함께 비가 미친 듯이 쏟아진다
    while (strikesRef.current < STRIKE_TIMES.length && since >= STRIKE_TIMES[strikesRef.current]) {
      if (strikesRef.current === 0) {
        director.cue({ 날씨: "비", 세기: 1, 초: STORM_SECONDS + 5 });
        director.cue({ 바람: 2.6, 초: STORM_SECONDS });
        audio.setStorm(1);
        setStormRain(1);
        audio.play("우르릉");
      }
      director.cue({ 날씨: "번개", 세기: 1 });
      strikesRef.current += 1;
    }
    // 폭우가 다하면 평소 비로 잦아든다(물은 그대로)
    if (since > PILLAR_SECONDS + STORM_SECONDS && strikesRef.current === STRIKE_TIMES.length) {
      audio.setStorm(0);
      setStormRain(0);
      strikesRef.current += 1;
    }
    const flood = THREE.MathUtils.clamp((since - FLOOD_DELAY) / FLOOD_SECONDS, 0, 1);
    let level = THREE.MathUtils.lerp(-0.05, FLOOD_LEVEL, THREE.MathUtils.smoothstep(flood, 0, 1));
    partRiverSheets(effects.riverSheets, CORRIDOR.halfWidth * getPartOpenness());
    // 석실 물건을 얻어 강가로 돌아오면 물이 빠진다
    if (stage === "cleared" && drainAtRef.current < 0) {
      drainAtRef.current = time;
      audio.setStorm(0);
      setStormRain(0);
      showNotice("물이 빠지기 시작한다.", 3);
    }
    if (drainAtRef.current >= 0) {
      const drained = THREE.MathUtils.clamp((time - drainAtRef.current) / DRAIN_SECONDS, 0, 1);
      level = THREE.MathUtils.lerp(FLOOD_LEVEL, -0.05, THREE.MathUtils.smoothstep(drained, 0, 1));
    }
    const isWet = flood > 0 && level > -0.04;
    effects.water.visible = isWet;
    effects.water.position.y = level * M;
    setWaterLevel(isWet ? level : -1);
    if (flood >= 1 && stage === "rising") {
      ritual.flood();
      showNotice("물이 허리 아래까지 차올랐다. 물 위에 흰빛을 두른 돌 넷이 떠 있다 — 다 건지면 강물이 갈라진다.", 5);
    }
  };

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const time = (clockRef.current += dt);

    // 금줄 천자락 — 마법진이 그려지기 시작하면 바람이 일어 펄럭인다
    ropeFlutter.tryPatch(scene, time);
    const windTarget = ritual.isAtLeast("drawing") ? (ritual.isAtLeast("rising") ? 1.6 : 1) : 0;
    const { uRopeWind, uRopeTime } = ropeFlutter.uniforms;
    uRopeWind.value += (windTarget - uRopeWind.value) * Math.min(1, dt * 0.8);
    uRopeTime.value = time;

    // 나룻배 — 물이 배 밑보다 0.15 m 넘게 차면 떠올라 까딱인다
    boatRock.tryPatch(scene, time);
    const level = getWaterLevel();
    const lift = Math.max(0, level - 0.15);
    const rock =
      level > 0.1
        ? Math.min(1, (level - 0.1) / 0.3) * (ritual.isAtLeast("rising") && !ritual.isAtLeast("cleared") ? 1 : 0.4)
        : 0;
    const { uBoatLift, uBoatRock, uBoatTime } = boatRock.uniforms;
    uBoatLift.value += (lift * M - uBoatLift.value) * Math.min(1, dt * 2);
    uBoatRock.value += (rock - uBoatRock.value) * Math.min(1, dt * 1.5);
    uBoatTime.value = time;

    // 돌탑 — 물굴에서 돌아온 그 순간부터 떨어진다(물 빠짐 셈과 따로 — 늦지 않게)
    if (clearedAtRef.current < 0 && ritual.stage() === "cleared") clearedAtRef.current = time;
    updateCairns(cairns, {
      camera,
      dragging: draggingRef.current,
      time,
      dt,
      riseAt: riseAtRef.current,
      clearedAt: clearedAtRef.current,
      glowColor: GLOW_COLOR,
    });
    circle.nodeGlows.forEach((material, k) => {
      const isLit = cairns.some((cairn) => cairn.node === k && cairn.isLit);
      const target = isLit ? 1.05 : 0;
      material.uniforms.uProgress.value += (target - material.uniforms.uProgress.value) * (1 - Math.exp(-dt * 2.5));
      material.uniforms.uTime.value = time;
    });

    // 마법진이 그려진다 → 소반이 빛난다
    const progress =
      drawAtRef.current < 0 ? 0 : THREE.MathUtils.clamp((time - drawAtRef.current) / DRAW_SECONDS, 0, 1.05);
    for (const material of [circle.linesGlow, ...circle.hanja.map((band) => band.material)]) {
      material.uniforms.uProgress.value = progress;
      material.uniforms.uTime.value = time;
    }
    if (stage === "drawing" && progress >= 1.05) {
      ritual.ready();
      audio.play("징");
      showNotice("빛이 소반으로 모였다. 제물을 올리자.", 3.4);
    }
    const tableLevel = THREE.MathUtils.clamp((progress - 0.85) / 0.2, 0, 1);
    effects.tableGlow.material.opacity = tableLevel * (stage === "flooded" ? 0.15 : 0.55 + 0.2 * Math.sin(time * 3));

    if (riseAtRef.current >= 0) updateFlood(time);
  });

  const carvedMarks = circle.nodeMarks.map((geometry, k) => (
    <group key={k}>
      <mesh geometry={geometry} material={circle.carved} renderOrder={1} />
      <mesh geometry={geometry} material={circle.nodeGlows[k]} renderOrder={2} />
    </group>
  ));

  // 물굴에서 돌아오면 마법진은 사라진다
  const isCircleGone = stage === "cleared";
  return (
    <group>
      {!isCircleGone && <mesh geometry={circle.lines} material={circle.linesGlow} renderOrder={2} />}
      {!isCircleGone &&
        circle.hanja.map((band, index) => (
          <mesh key={index} geometry={band.geometry} material={band.material} renderOrder={2} />
        ))}
      {!isCircleGone && carvedMarks}
      {cairns.map((cairn, index) => (
        <primitive key={index} object={cairn.group} />
      ))}
      {offeringMeshes.map((mesh, index) => (
        <primitive key={index} object={mesh} />
      ))}
      {!isCircleGone && <primitive object={effects.tableGlow} />}
      <primitive object={effects.pillar} />
      <primitive object={effects.glowSprite} />
      <primitive object={effects.glowLight} />
      <primitive object={effects.water} />
    </group>
  );
}
