/**
 * 벼랑 끝으로 난 발자국 — 4스테이지 뒤 절반(P15).
 *   받침돌 곁에서 아랑사의 발자국이 벼랑 쪽으로 나 있다. 첫 토막만 희끗하게 보이고, 얼마 못 가 마른 흙에 덮여 끊긴다.
 *   끊긴 자리에 귀때동이의 물을 뿌리면 젖은 흙에 눌린 자리가 한 토막씩 드러난다(세 번). 세 번째에 벼랑 끝 바위 틈 —
 *   미끄러진 자국(떨어진 자리)과, 풀숲에서 나와 그 앞에서 멈췄다 달아난 셋(사내 둘 · 여인 하나)의 발자국이 함께 드러난다.
 *   달아난 큰 발자국 하나가 큰 바위와 작은 돌 사이 앞에서 멈췄다 — 거기 아랑사의 주머니가 떨어져 있다.
 *   주머니를 열면 편지 두 장(letters)과 조가비 가락지 한 쌍이 나온다. 여기까지 — 그 뒤(구렁이상 · 틈 · 굿 불)는 EdgeRift 가 맡는다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { assetUrl } from "@/config/env";
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { addHint } from "@/game/hintBox";

import { audio } from "../../scene/immersion/audio";
import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { makeGlowTexture } from "../glowTexture";
import { registerInteractable, showNotice } from "../interaction";
import { inventory } from "../inventory";
import { POUCH_MODEL } from "../itemLooks";
import { loadModel } from "../itemModel";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import { usePrewarm } from "../usePrewarm";
import { CLEFT, EDGE_RELICS, GATHER, SLIP, TRAIL, WATCHERS } from "./cliffShape";
import { cliff } from "./cliffState";
import {
  PRINT_SIZE,
  buildPrints,
  makePrintsMaterial,
  makeWetGroundMaterial,
  standAt,
  walkAlong,
  type Print,
} from "./footprintArt";
import { closeLetters, letterHints, loadLetterFont, openLetters, setPouchCanvas } from "./letters";
import { renderPouchView } from "./pouchView";
import { buildGroundRibbon, floorAt, planar } from "./riteScene";
import { useGroundReady } from "./useGroundReady";

type Point = readonly [number, number];
/** 걷는 발 · 달리는 발 — 보폭과 두 발 사이(미터) */
const WALK = { stride: 0.6, gait: 0.085 };
const RUN = { stride: 1.02, gait: 0.06 };
/** 물이 번지며 한 토막이 드러나는 시간 · 숨어 있던 셋의 발자국이 드러나는 시간(초) */
const REVEAL_SECONDS = 2.8;
const WATCHERS_SECONDS = 5.2;
/** 마지막 토막이 드러난 뒤 셋의 발자국이 뒤따르기까지(초) */
const WATCHERS_DELAY = 2.6;
/** 끼얹은 물이 떨어지는 너비(미터) — 이 안에서 덩어리져 떨어지고 잔물이 튄다 */
const WET_WIDTH = 1.7;
/** 끼얹은 물방울 수 · 다 떨어지는 데 걸리는 시간(초) */
const THROWN_DROPS = 40;
const THROW_SECONDS = 1.1;
/** 안내판이 뜨는 거리(m) */
const PANEL_RANGE = 9;
/** 주머니 — 눕힌 크기(가장 긴 변, 미터) · 아가리가 멈춰 선 발자국 쪽을 보게 돌린 각 */
const POUCH_SIZE = 0.4;
const POUCH_YAW = -1.9;
/** 주머니가 나타나는 데 걸리는 시간(초) */
const POUCH_APPEAR_SECONDS = 0.9;
/** 마지막 물을 뿌린 뒤 숨어 있던 셋의 발자국이 다 드러나 주머니가 나타나기까지(초) */
const TRACED_AFTER = 3.6;

const facingTo = (from: Point, to: Point) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const last = <T,>(list: readonly T[]) => list[list.length - 1];

function meshOf(prints: Print[], wet: number) {
  const material = makePrintsMaterial(wet);
  const mesh = new THREE.Mesh(buildPrints(prints), material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, material };
}

function buildTrail() {
  const root = new THREE.Group();
  root.name = "cliff.footTrail";

  // 아랑사의 발자국 — 토막마다 판 하나. 첫 토막은 마른 흙에 희끗하게 남아 처음부터 보인다
  const segments = TRAIL.map((path, k) => {
    const prints = walkAlong(path, PRINT_SIZE.arang, { ...WALK, tile: "sandal", from: k === 0 ? 0.2 : WALK.stride });
    if (k === TRAIL.length - 1) {
      // 마지막 발 — 뒤꿈치가 벼랑 밖으로 길게 미끄러졌다
      const length = Math.hypot(SLIP.to[0] - SLIP.from[0], SLIP.to[1] - SLIP.from[1]);
      prints.push({
        x: (SLIP.from[0] + SLIP.to[0]) / 2,
        z: (SLIP.from[1] + SLIP.to[1]) / 2,
        heading: facingTo(SLIP.from, SLIP.to),
        length,
        width: 0.2,
        tile: "skid",
        isLeft: false,
      });
    }
    const group = meshOf(prints, k === 0 ? 0 : 1);
    root.add(group.mesh);
    let length = 0;
    for (let i = 1; i < path.length; i++)
      length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const wetMaterial = makeWetGroundMaterial(length, WET_WIDTH / 2, k * 17.3);
    const wet = new THREE.Mesh(buildGroundRibbon(path, WET_WIDTH), wetMaterial);
    wet.renderOrder = 1;
    wet.visible = k > 0;
    root.add(wet);
    const [endX, endZ] = last(path);
    return { ...group, wetMaterial, end: planar(endX, endZ, 0.08), reveal: k === 0 ? 1 : 0, startedAt: -1 };
  });

  // 숨어 있던 셋 — 풀숲에서 걸어 나와, 벼랑 끝 앞에 멈춰 섰다가, 앞꿈치로 달아났다
  const watchers = WATCHERS.map((watcher) => {
    const size = watcher.kind === "man" ? PRINT_SIZE.man : PRINT_SIZE.woman;
    const tile = watcher.kind === "man" ? "sandal" : "small";
    const prints = [
      ...walkAlong([watcher.hide, watcher.reach], size, { ...WALK, tile }),
      ...standAt(watcher.reach, facingTo(watcher.reach, SLIP.from), size, tile),
      ...walkAlong([watcher.reach, ...watcher.flee], size, { ...RUN, tile: "toe" }),
    ];
    if (watcher.away) {
      // 달아나다 바위 사이 앞에서 멈춰 섰다 — 두 발이 깊다 — 그리고 다시 달아났다
      const stop = last(watcher.flee);
      prints.push(
        ...standAt(stop, facingTo(stop, [CLEFT.x, CLEFT.z]), size, tile),
        ...walkAlong([stop, ...watcher.away], size, { ...RUN, tile: "toe" }),
      );
    }
    const group = meshOf(prints, 1);
    root.add(group.mesh);
    return group;
  });

  // 주머니 — 바위 틈 어귀의 흙바닥에 떨어져 있다. 모형은 뒤에 끼운다(useEffect)
  const pouch = new THREE.Group();
  pouch.position.copy(planar(CLEFT.x, CLEFT.z, 0.02));
  pouch.rotation.set(-1.25, POUCH_YAW, 0.12, "YXZ");
  pouch.scale.setScalar(M);
  pouch.visible = false;
  // 셋이 모여 섰던 자리 — 세 번째 물이 여기에도 끼얹어진다
  let gatherLength = 0;
  for (let i = 1; i < GATHER.length; i++)
    gatherLength += Math.hypot(GATHER[i][0] - GATHER[i - 1][0], GATHER[i][1] - GATHER[i - 1][1]);
  const gatherMaterial = makeWetGroundMaterial(gatherLength, WET_WIDTH / 2, 71.3);
  const gatherWet = new THREE.Mesh(buildGroundRibbon(GATHER, WET_WIDTH), gatherMaterial);
  gatherWet.renderOrder = 1;
  root.add(gatherWet);
  const glint = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: "#DCE6FF",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  glint.position.copy(planar(CLEFT.x, CLEFT.z, 0.2));
  glint.scale.setScalar(0.7 * M);
  root.add(pouch, glint);

  // 끼얹는 물방울
  const drops = makeGlowPoints(THROWN_DROPS, { additive: true, softness: 1.4 });
  drops.points.visible = false;
  root.add(drops.points);

  return {
    root,
    segments,
    watchers,
    pouch,
    glint,
    gatherMaterial,
    drops,
    dropSeeds: Float32Array.from({ length: THROWN_DROPS * 2 }, () => Math.random()),
    /** 겨누는 자리 — 발자국이 끊긴 자리(드러난 만큼 옮겨 간다) · 바위 사이 · 벼랑 끝 짚신 · 댕기 · 떨어진 자리 */
    endTarget: segments[0].end.clone(),
    cleftTarget: planar(CLEFT.x, CLEFT.z, 0.14),
    shoeTarget: planar(EDGE_RELICS.shoe.x, EDGE_RELICS.shoe.z, 0.06),
    ribbonTarget: planar(EDGE_RELICS.ribbon.x, EDGE_RELICS.ribbon.z, 0.06),
    slipTarget: planar(SLIP.from[0], SLIP.from[1] + 0.4, 0.05),
  };
}

/** 걷는 지형이 준비된 뒤에 깐다 */
export default function FootTrail() {
  const ground = useGroundReady();
  return ground ? <FootTrailScene key={ground} /> : null;
}

function FootTrailScene() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const trail = useMemo(() => buildTrail(), []);
  /** 숨어 있던 셋의 발자국이 드러난 정도(0~1) · 드러나기 시작한 뒤 흐른 시간(초, −1 이면 아직) */
  const watchers = useRef({ reveal: 0, time: -1 });
  const pending = useRef<{ at: number; run: () => void }[]>([]);
  /** 끼얹는 중인 물 — 흐른 시간(초) · 떨어지는 토막 · 부리 자리(유닛). 안 끼얹으면 null */
  const thrown = useRef<{ time: number; segment: number; from: THREE.Vector3 } | null>(null);

  const actions = useMemo(() => {
    const later = (seconds: number, run: () => void) => pending.current.push({ at: gameNow() / 1000 + seconds, run });

    /** 끊긴 자리에 물을 뿌린다 — 다음 토막이 드러난다. 앞 토막이 아직 번지는 중이면 false */
    const pour = () => {
      const now = cliff.state();
      const next = now.revealed + 1;
      const previous = trail.segments[now.revealed];
      if (next >= trail.segments.length || now.pours <= 0 || previous.reveal < 0.95) return false;
      cliff.update({ revealed: next, pours: now.pours - 1 });
      trail.segments[next].startedAt = 0;
      audio.play("물뿌림");
      // 귀때동이 부리에서 물이 날아간다 — 눈 아래 오른쪽에서 새 토막을 따라 떨어진다
      const forward = camera.getWorldDirection(new THREE.Vector3());
      thrown.current = {
        time: 0,
        segment: next,
        from: camera.position
          .clone()
          .addScaledVector(forward, 0.45 * M)
          .add(new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(0.18 * M))
          .setY(camera.position.y - 0.4 * M),
      };
      // 다 쓴 귀때동이는 손을 떠난다
      if (now.pours - 1 <= 0) {
        if (inventory.hand()?.kind === "waterJug") inventory.releaseHand();
        else inventory.consume("waterJug");
      }
      if (next === 1)
        showNotice(
          "물이 마른 흙에 스민다. 젖은 자리에 눌린 자국이 달빛을 받는다 — 큰 짚신 발자국이 벼랑 쪽으로 이어진다.",
          5.5,
        );
      else if (next === 2)
        showNotice("발자국이 곧게 간다. 걸음이 고르다 — 서두르지 않았다. 밤마다 가던 길을 그날도 걸었다.", 5.5);
      else {
        watchers.current.time = -WATCHERS_DELAY;
        showNotice("발자국이 벼랑 끝 바위 틈에서 멎는다. 마지막 자국이 길게 미끄러졌다 — 여기서 떨어졌다.", 6);
        later(TRACED_AFTER, () => {
          cliff.advance("traced");
          audio.play("단서");
          showNotice(
            "곁에 다른 발자국이 셋. 큰 것 둘, 작은 것 하나 — 풀숲에서 나와 그 앞에서 멈췄다가, 돌아서 달아났다.",
            6.5,
          );
        });
        later(TRACED_AFTER + 7, () =>
          showNotice(
            "달아난 큰 발자국 하나가 바위 사이 앞에서 깊게 찍혔다. 거기서 한 번 멈춰 섰다 — 무엇을 하려고.",
            6.5,
          ),
        );
      }
      return true;
    };

    /** 주머니 속을 다 보고 접었다 — 편지는 힌트함에, 가락지 한 쌍은 소지품에 */
    const finish = () => {
      letterHints().forEach((hint) => addHint(hint));
      if (cliff.isAtLeast("done")) return;
      inventory.add("shellRings");
      cliff.advance("done");
      audio.play("단서");
      showNotice(
        "주머니에서 나온 것은 편지 두 장과 조가비 가락지 한 쌍. 그 밤 건네려던 것 — 끝내 건네지 못했다. 편지는 [H] 힌트함에 넣었다.",
        7,
      );
      later(7.5, () =>
        showNotice("둘째 장은 낱말이 이상한 데서 꺾인다. 첫째 장이 이른 대로 읽으면 — 아랑사가 숨겨 둔 말이 있다.", 7),
      );
      later(15.5, () =>
        showNotice(
          "그 말을 읽었다면, 아랑사의 함에 왜 구렁이상이 들어 있었는지 알 것이다. 구렁이는 아랑사가 떨어진 바로 그 틈에서 올라왔다.",
          8,
        ),
      );
    };

    /** 바위 사이에서 주머니를 꺼낸다 */
    const takePouch = () => {
      if (!inventory.add("arangPouch")) {
        showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 꺼내자.");
        return;
      }
      cliff.advance("found");
      audio.play("단서");
      showNotice(
        "바위 사이에 삼베 주머니가 떨어져 있다. 귀퉁이에 물고기 하나 — 아랑사의 표시다. 달아나던 사내가 여기 던지고 갔다.",
        5,
      );
      later(2.2, () => openLetters(finish));
    };

    return { later, pour, finish, takePouch };
  }, [trail, camera]);

  usePrewarm(trail.root);

  useEffect(() => {
    scene.add(trail.root);
    // 편지 글씨와 주머니 속 그림은 주머니를 줍기 한참 전에 마련해 둔다
    void loadLetterFont()
      .then(() => renderPouchView(gl))
      .then((canvas) => canvas && setPouchCanvas(canvas));
    return () => {
      scene.remove(trail.root);
    };
  }, [scene, trail, gl]);

  // 주머니 모형 — 미르 라이브러리(국가유산청 CC BY 4.0)의 끈 달린 주머니. 바랜 삼베 빛으로 밝혀 밤에도 보이게 한다
  useEffect(() => {
    let isAlive = true;
    void loadModel(assetUrl(POUCH_MODEL), POUCH_SIZE).then((source) => {
      if (!isAlive || !source) return;
      const copy = source.clone(true);
      copy.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const hemp = (mesh.material as THREE.MeshStandardMaterial).clone();
        hemp.color.setRGB(3.6, 3.1, 2.3);
        // 제 무늬 그대로 조금 빛나게 — 밤 흙바닥에서 테두리만 남지 않도록
        hemp.emissive?.set("#6A5C40");
        hemp.emissiveMap = hemp.map;
        mesh.material = hemp;
        mesh.castShadow = true;
      });
      trail.pouch.add(copy);
    });
    return () => {
      isAlive = false;
    };
  }, [trail]);

  // 이어 하기 — 드러난 토막은 드러난 채로. 편지를 읽다 만 채였으면 다시 편다
  useEffect(() => {
    const now = cliff.state();
    trail.segments.forEach((segment, k) => {
      if (k <= now.revealed) segment.reveal = 1;
    });
    if (cliff.isAtLeast("traced")) watchers.current = { reveal: 1, time: WATCHERS_SECONDS };
    if (now.stage === "found") actions.later(1.5, () => openLetters(actions.finish));
    return () => closeLetters();
  }, [trail, actions]);

  useEffect(() => {
    const removers = [
      registerInteractable({
        id: "cliff-trail-end",
        position: trail.endTarget,
        label: "발자국이 끊긴 자리",
        radius: 0.6 * M,
        reach: 2.8 * M,
        keepHand: true,
        // 사발의 물이 흙을 풀어 귀때동이가 드러난 뒤에야 쓴다
        enabled: () => cliff.isAtLeast("loose") && cliff.state().revealed < trail.segments.length - 1,
        handLabel: (kind) => (kind === "waterJug" ? "끊긴 자리에 물 뿌리기" : null),
        receive: () => actions.pour(),
        use: () => showNotice("발자국이 여기서 끊겼다. 마른 흙이 덮었다 — 물을 뿌리면 눌린 자리가 드러날 것이다.", 4.5),
      }),
      registerInteractable({
        id: "cliff-cleft",
        position: trail.cleftTarget,
        label: "바위 사이",
        radius: 0.45 * M,
        reach: 2.6 * M,
        enabled: () => cliff.stage() === "traced",
        use: () => actions.takePouch(),
      }),
      registerInteractable({
        id: "cliff-shoe",
        position: trail.shoeTarget,
        label: "짚신 한 짝",
        radius: 0.3 * M,
        reach: 2.4 * M,
        use: () =>
          showNotice(
            cliff.isAtLeast("traced")
              ? "미끄러진 자국 곁에 벗겨져 남은 짚신 한 짝. 신코 안쪽에 물고기가 새겨져 있다 — 나루터 통발에 걸려 올라온 것과 한 켤레다."
              : "벼랑 끝 바위 틈에 짚신 한 짝이 놓여 있다. 신코 안쪽에 물고기가 새겨져 있다.",
            5.5,
          ),
      }),
      registerInteractable({
        id: "cliff-ribbon",
        position: trail.ribbonTarget,
        label: "붉은 댕기",
        radius: 0.3 * M,
        reach: 2.4 * M,
        use: () =>
          showNotice(
            cliff.isAtLeast("traced")
              ? "바위 밑에 끼인 붉은 댕기. 달아난 작은 발자국 곁이다 — 숨어 있던 셋 가운데 여인의 것이다."
              : "바위 밑에 붉은 댕기가 끼어 있다. 누가 흘리고 갔다.",
            5,
          ),
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [trail, actions]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const time = clock.elapsedTime;
    const nowSeconds = gameNow() / 1000;
    // 때가 된 일을 치른다 — 치르는 일이 새 일을 걸 수 있어, 먼저 목록에서 빼고 나서 부른다
    const due = pending.current.filter((job) => job.at <= nowSeconds);
    if (due.length) {
      pending.current = pending.current.filter((job) => job.at > nowSeconds);
      due.forEach((job) => job.run());
    }
    const now = cliff.state();

    // 토막 — 물이 번지는 대로 발자국이 차례로 드러난다
    trail.segments.forEach((segment, k) => {
      if (segment.startedAt >= 0) {
        segment.startedAt += dt;
        segment.reveal = Math.min(1, segment.startedAt / REVEAL_SECONDS);
        if (segment.reveal >= 1) segment.startedAt = -1;
      }
      segment.material.uniforms.uReveal.value = segment.reveal;
      segment.material.uniforms.uTime.value = time;
      segment.wetMaterial.uniforms.uReveal.value = k === 0 ? 0 : segment.reveal;
    });
    // 세 번째 물은 셋이 모여 섰던 자리에도 떨어진다 — 길보다 조금 늦게 번진다
    trail.gatherMaterial.uniforms.uReveal.value = THREE.MathUtils.clamp(last(trail.segments).reveal * 1.5 - 0.3, 0, 1);
    trail.endTarget.copy(trail.segments[Math.min(now.revealed, trail.segments.length - 1)].end);

    // 끼얹은 물 — 방울방울 날아가 토막을 따라 차례로 떨어진다
    const throwing = thrown.current;
    trail.drops.points.visible = !!throwing;
    if (throwing) {
      throwing.time += dt;
      const isLast = throwing.segment === TRAIL.length - 1;
      for (let i = 0; i < THROWN_DROPS; i++) {
        // 마지막 물은 반은 길로, 반은 셋이 모여 섰던 자리로 날아간다
        const path = isLast && i % 2 === 1 ? GATHER : TRAIL[throwing.segment];
        const order = i / THROWN_DROPS;
        const flight = 0.38 + 0.25 * trail.dropSeeds[i * 2];
        const u = THREE.MathUtils.clamp((throwing.time - order * (THROW_SECONDS - 0.6)) / flight, 0, 1);
        // 떨어질 자리 — 토막 앞쪽부터 뒤쪽으로, 길 옆으로 조금씩 흩어진다
        const along = order * (path.length - 1) * 0.85;
        const index = Math.min(path.length - 2, Math.floor(along));
        const t = along - index;
        const side = (trail.dropSeeds[i * 2 + 1] - 0.5) * WET_WIDTH * 0.7;
        const toX = THREE.MathUtils.lerp(path[index][0], path[index + 1][0], t) + side;
        const toZ = THREE.MathUtils.lerp(path[index][1], path[index + 1][1], t) + side * 0.4;
        trail.drops.position.setXYZ(
          i,
          THREE.MathUtils.lerp(throwing.from.x, toX * M, u),
          THREE.MathUtils.lerp(throwing.from.y, floorAt(toX, toZ) * M, u * u) + Math.sin(Math.PI * u) * 0.3 * M,
          THREE.MathUtils.lerp(throwing.from.z, toZ * M, u),
        );
        trail.drops.size.setX(i, (0.03 + 0.03 * trail.dropSeeds[i * 2]) * M);
        trail.drops.alpha.setX(i, u > 0 && u < 1 ? 0.85 : 0);
        trail.drops.color.setXYZ(i, 0.6, 0.72, 1.0);
      }
      trail.drops.commit();
      trail.drops.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
      if (throwing.time > THROW_SECONDS + 0.4) thrown.current = null;
    }

    // 숨어 있던 셋 — 마지막 토막 뒤에 한꺼번에, 걸어 나온 차례대로
    const w = watchers.current;
    if (w.time < WATCHERS_SECONDS && (w.time >= 0 || w.time > -WATCHERS_DELAY - 0.01) && now.revealed >= 3) {
      w.time += dt;
      w.reveal = THREE.MathUtils.clamp(w.time / WATCHERS_SECONDS, 0, 1);
    }
    trail.watchers.forEach((group) => {
      group.mesh.visible = w.reveal > 0;
      group.material.uniforms.uReveal.value = w.reveal;
      group.material.uniforms.uTime.value = time;
    });

    // 주머니 — 발자국을 끝까지 드러낸 뒤에야 바위 사이에 나타난다. 흙먼지가 걷히듯 떠올라 희미하게 빛난다
    const isHidden = now.stage === "traced";
    const shown = isHidden ? THREE.MathUtils.smoothstep(cliff.elapsed(), 0, POUCH_APPEAR_SECONDS) : 0;
    trail.pouch.visible = isHidden;
    trail.pouch.scale.setScalar(M * shown);
    (trail.glint.material as THREE.SpriteMaterial).opacity = shown * (0.34 + 0.16 * Math.sin(time * 2.4));

    updatePanel(camera);
  });

  /** 안내판 — 물을 뿌릴 수 있게 된 뒤, 끊긴 자리 가까이에서 */
  const updatePanel = (viewer: THREE.Camera) => {
    const now = cliff.state();
    const target = now.stage === "traced" ? trail.cleftTarget : trail.endTarget;
    const distance = Math.hypot(viewer.position.x - target.x, viewer.position.z - target.z) / M;
    const isTracing = now.stage === "loose" && now.jugTaken;
    if ((!isTracing && now.stage !== "traced") || distance > PANEL_RANGE) {
      setPuzzlePanel("cliff-trail", null);
      return;
    }
    setPuzzlePanel(
      "cliff-trail",
      isTracing
        ? {
            title: "끊긴 발자국",
            rule: "발자국이 끊긴 자리에 귀때동이의 물을 뿌리면, 젖은 흙에 눌린 자리가 드러난다. 드러난 끝으로 가서 다시 뿌린다.",
            rows: [
              { label: "드러난 길", value: `${now.revealed} / 3`, ok: now.revealed >= 3 },
              {
                label: "남은 물",
                value: inventory.has("waterJug") || inventory.hand()?.kind === "waterJug" ? `${now.pours}번` : "비었다",
              },
            ],
            distance,
          }
        : {
            title: "떨어진 자리",
            rule: "벼랑 끝 둘레의 발자국을 살핀다. 달아난 발자국이 멈춰 선 자리 — 바위 사이에 무언가 있다.",
            distance,
          },
    );
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuTrailDev", {
      /** 귀때동이 없이 한 토막을 드러낸다 */
      pour: () => {
        if (cliff.state().pours <= 0) cliff.update({ pours: 1 });
        trail.segments.forEach((segment, k) => {
          if (k <= cliff.state().revealed) segment.reveal = 1;
        });
        return actions.pour();
      },
      takePouch: () => actions.takePouch(),
      closeLetters: () => closeLetters(),
      spots: () => ({
        end: trail.endTarget.clone().divideScalar(M),
        cleft: trail.cleftTarget.clone().divideScalar(M),
        shoe: trail.shoeTarget.clone().divideScalar(M),
        slip: trail.slipTarget.clone().divideScalar(M),
      }),
    });
  }, [trail, actions]);

  return null;
}
