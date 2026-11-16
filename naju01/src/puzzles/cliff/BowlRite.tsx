/**
 * 바위 위 만나던 자리 — 정화수 세 그릇(P14).
 *   엎어진 사발 셋(큰 · 가운데 · 작은)을 주워 독의 빗물을 뜨고, 선바위 앞 바위 위(너럭바위 · 받침돌 둘)에 크기대로 하나씩 올린다.
 *   물에 달이 내려앉으면 달빛이 사발에서 선바위로 튄다. 셋이 다 켜지면 달빛이 선바위에 모여 그 뒤의 밤들을 비춘다(moonClip — 영상 파일).
 *   그림이 깨지며 사발 셋이 조각나고, 쏟아진 물이 흙에 묻힌 귀때동이 쪽으로 흘러 굳은 흙을 씻어 낸다(spill) → 귀때동이를 뽑아 독의 물을 퍼 담는다.
 * 그 물로 발자국을 드러내는 것은 FootTrail 이 맡는다. 반사광은 실제로 잰다(cliffShape.REFLECT_DIR).
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { assetUrl } from "@/config/env";
import { gameNow } from "@/engine/input/gameClock";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";

import { addDynamicSolid } from "../../movement/solidField";
import { recall, track } from "../../save/puzzleMemory";
import { focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { teleportPlayer } from "../cave/caveState";
import { clearPendingNotices, interactableFor, noticeFor } from "../interaction";
import { inventory, type ItemKind } from "../inventory";
import { loadModel } from "../itemModel";
import { setPuzzlePanel } from "../puzzlePanel";
import { M } from "../units";
import { usePrewarm } from "../usePrewarm";
import { BOWLS, BOWL_SIZES, BOWL_WATER, JAR, JUG, JUG_POURS, SEAT, STANDING, type BowlSize } from "./cliffShape";
import { cliff, type SavedCliff } from "./cliffState";
import { MOON_CLIP_CAPTIONS, MOON_CLIP_CUES, MOON_CLIP_FADE, MOON_CLIP_SECONDS } from "./moonClip";
import { useFilmClipLayer } from "../filmClip";
import { captionAt, setFilmCaption } from "../filmCaption";
import {
  MODELS,
  SEAT_TOP,
  STANDING_HALF,
  buildRite,
  fillJar,
  floorAt,
  makeWaterDisc,
  measureHit,
  placeWaterMoon,
  planar,
  topOf,
  waterCenterOf,
  type Rite,
} from "./riteScene";
import { addScoopVessel, buildScoop, startPull, startScoop, updateScoop, type Scoop } from "./scoop";
import { SPILL, buildSpill, fitPieces, measureSpill, updateSpill, type Spill } from "./spill";
import { IS_STAGE4_JUMP, STAGE4_START } from "./stageJump";
import { useGroundReady } from "./useGroundReady";

/** 이 퍼즐(장면)의 글 · 물건 — 다른 퍼즐로 넘어가면 여기서 남긴 글은 내린다(interaction noticeFor · interactableFor) */
const showNotice = noticeFor("bowls");
const registerInteractable = interactableFor("bowls");

const EMPTY_BOWL: Record<BowlSize, ItemKind> = { large: "bowlLarge", medium: "bowlMedium", small: "bowlSmall" };
const DEW_BOWL: Record<BowlSize, ItemKind> = { large: "dewBowlLarge", medium: "dewBowlMedium", small: "dewBowlSmall" };
const ALL_BOWL_KINDS = new Set<string>([...Object.values(EMPTY_BOWL), ...Object.values(DEW_BOWL)]);
const sizeOfDew = (kind: string) => BOWL_SIZES.find((size) => DEW_BOWL[size] === kind) ?? null;

/** 안내판이 뜨는 거리(m) */
const PANEL_RANGE = 8;
/** 세 번째 사발을 올린 뒤 영상이 뜨기까지(초) */
const VISION_DELAY = 1.8;
/** 그림이 깨진 뒤 — 시선이 사발로 옮겨 가는 시간 · 사발이 깨지는 때 · 시선을 놓아주는 때(초). 그 뒤 물길은 붙잡지 않는다 */
const BREAK = { lookIn: 0.5, at: 0.6, free: 1.5 };

const REST_NAME: Record<BowlSize, string> = {
  large: "너럭바위",
  medium: "받침돌",
  small: "작은 받침돌",
};
const REST_TEXT: Record<BowlSize, string> = {
  large: "너럭바위. 윗면이 넓고 판판하다 — 셋 중 가장 큰 받침이다.",
  medium: "받침돌. 윗면이 판판하다 — 사발 하나 올리기 알맞다.",
  small: "작은 받침돌. 조그만 사발 하나 겨우 오를 만하다.",
};

/** 걷는 지형이 준비된 뒤에 깐다 */
export default function BowlRite() {
  const ground = useGroundReady();
  return ground ? <BowlRiteScene key={ground} /> : null;
}

function BowlRiteScene() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const rite = useMemo(() => buildRite(), []);
  const spill = useMemo(() => buildSpill(rite), [rite]);
  const scoop = useMemo(() => buildScoop(), []);
  const vision = useRef({ time: -1, fired: new Set<number>() });
  // 영상 판은 후처리 뒤에 따로 그린다(먹선이 둘레에 네모를 긋지 않게)
  useFilmClipLayer(rite.play);
  /** 사발이 깨진 뒤 흐른 시간(초) — 안 깨졌으면 −1 */
  const brokenFor = useRef(-1);
  const pending = useRef<{ at: number; run: () => void }[]>([]);
  const told = useRef({ arrived: false });
  /** ?stage=4 로 들어왔으면 시작 자리 옮기기가 끝난 뒤 바위 위로 데려간다(초) */
  const jumpAt = useRef(IS_STAGE4_JUMP ? 1.5 : -1);

  /** 퍼즐이 진행을 바꾸는 동작들 — 겨냥 · 프레임 · 개발 손잡이가 같이 쓴다 */
  const actions = useMemo(() => {
    const later = (seconds: number, run: () => void) => pending.current.push({ at: gameNow() / 1000 + seconds, run });

    /** 물 담은 사발을 제 받침에 올린다. 셋이 다 오르면 잠깐 뒤 달빛이 모인다 */
    const placeBowl = (index: number) => {
      const placed = cliff.state().placed.map((value, i) => value || i === index);
      cliff.update({ placed });
      rite.bowls[index].ripple = 1;
      rite.play.prepare();
      audio.play("사기");
      const count = placed.filter(Boolean).length;
      if (count < 3) {
        showNotice(
          count === 1
            ? "사발을 받침에 올렸다. 물이 잔잔해지자 달이 내려앉는다 — 달빛 한 줄기가 선바위로 튄다."
            : "두 번째 달이 떴다. 선바위에 달빛 둘이 맺혔다 — 하나가 더 남았다.",
          4.5,
        );
        return;
      }
      showNotice("세 물에 달이 셋. 선바위에 맺힌 달빛이 서로 번져 하나가 된다.", 4);
      later(VISION_DELAY, startVision);
    };

    /** 달빛이 선바위에 모였다 — 그 뒤의 밤들이 비친다 */
    const startVision = () => {
      if (cliff.stage() !== "idle") return;
      cliff.advance("vision");
      vision.current = { time: 0, fired: new Set() };
      // 영상 앞의 글은 거둔다 — 자막 동안 줄을 섰다가 영상이 끝난 뒤 뒤늦게 이어 나왔다
      clearPendingNotices();
      rite.play.mesh.visible = true;
      focusCamera({
        id: "cliff-vision",
        target: rite.play.mesh.position,
        hold: MOON_CLIP_SECONDS - 0.9,
        turnIn: 0.9,
        turnOut: 0.8,
        zoom: 0.78,
        replace: true,
      });
    };

    /** 그림이 깨졌다 — 시선이 사발로 옮겨 가고, 사발 셋이 조각나며 물이 흘러내린다 */
    const breakBowls = () => {
      vision.current.time = -1;
      setFilmCaption(null);
      rite.play.stop();
      rite.play.mesh.visible = false;
      cliff.advance("flowing");
      const bowlsAt = new THREE.Vector3();
      rite.bowls.forEach((bowl) => bowlsAt.addScaledVector(bowl.restAt, 1 / rite.bowls.length));
      focusCamera({
        id: "cliff-break",
        target: bowlsAt,
        hold: BREAK.free - BREAK.lookIn,
        turnIn: BREAK.lookIn,
        turnOut: 0.5,
        replace: true,
      });
      later(BREAK.at, () => {
        if (brokenFor.current < 0) brokenFor.current = 0;
        audio.play("깨짐");
        audio.play("첨벙");
        director.cue({ 카메라: "흔들림", 세기: 0.1 });
        showNotice("쩍 — 사발 셋이 한꺼번에 깨진다. 쏟아진 물이 받침에서 떨어져 땅을 적시며 흘러간다.", 4.5, {
          fleeting: true,
        });
      });
      const settled = BREAK.at + SPILL.flow;
      later(settled, () => {
        cliff.advance("loose");
        audio.play("단서");
        showNotice("물이 귀때동이 둘레의 굳은 흙을 씻어 낸다. 둔덕이 풀려 둘레가 파였다 — 이제 뽑힐 것 같다.", 5);
      });
      later(settled + 5.5, () => showNotice("구렁이가 올라온 벼랑 끝 바위 틈 — 아랑사가 떨어진 그 자리다.", 6));
      later(settled + 13, () =>
        showNotice("받침돌 곁에서 발자국이 벼랑 쪽으로 나 있다. 얼마 못 가 끊긴다 — 마른 흙에 덮였다.", 6),
      );
    };

    const pullJug = () => {
      if (!inventory.add("emptyJug")) {
        showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 뽑자.", 3.2, { urgent: true, fleeting: true });
        return;
      }
      cliff.update({ jugTaken: true });
      startPull(scoop, "emptyJug", rite.jug.position, rite.jug.rotation);
      audio.play("첨벙");
      showNotice("귀때동이가 진흙에서 쑥 빠진다. 부리가 있어 물을 한곳에 뿌리기 좋다 — 독에서 물을 퍼 담자.", 5);
    };

    return { later, placeBowl, startVision, breakBowls, pullJug };
  }, [rite, scoop]);

  usePrewarm(rite.root, spill.root, scoop.root);

  useEffect(() => {
    scene.add(rite.root, spill.root, scoop.root);
    // 깨진 사발 조각은 자르는 면으로 나눈다
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    return () => {
      scene.remove(rite.root, spill.root, scoop.root);
      rite.play.dispose();
      gl.localClippingEnabled = previous;
    };
  }, [scene, gl, rite, spill, scoop]);

  // 이어 하기 — 깨진 사발은 깨진 채로
  useEffect(() => {
    const saved = recall<SavedCliff | null>("cliff", null);
    if (saved) cliff.restore(saved);
    if (cliff.isAtLeast("flowing")) brokenFor.current = 999;
    return track("cliff", () => cliff.state());
  }, []);

  useRiteModels(rite, spill, scoop);
  useRiteColliders();

  useEffect(() => {
    const removers = [
      // 엎어진 사발 셋
      ...rite.bowls.map((bowl, index) =>
        registerInteractable({
          id: `cliff-bowl-${bowl.size}`,
          position: bowl.startTarget,
          label: `엎어진 ${BOWLS[bowl.size].name} 줍기`,
          isPickup: true,
          radius: 0.32 * M,
          reach: 2.4 * M,
          enabled: () => !cliff.state().taken[index],
          use: () => {
            if (!inventory.add(EMPTY_BOWL[bowl.size])) {
              showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 줍자.", 3.2, {
                urgent: true,
                fleeting: true,
              });
              return;
            }
            const taken = cliff.state().taken.map((value, i) => value || i === index);
            cliff.update({ taken });
            audio.play("단서");
            showNotice(
              taken.every(Boolean)
                ? "흰 사발 셋 — 크고, 가운데고, 작다. 굽이 다 닳았다. 누가 밤마다 여기서 썼다."
                : `${BOWLS[bowl.size].name}. 굽이 닳았다 — 누가 여기 두고 오래 썼다. 비어 있다.`,
              4,
            );
          },
        }),
      ),
      // 받침 셋 — 크기가 맞는 물 사발만 얹힌다
      ...rite.bowls.map((bowl, index) =>
        registerInteractable({
          id: `cliff-rest-${bowl.size}`,
          position: bowl.restTarget,
          label: REST_NAME[bowl.size],
          radius: 0.36 * M,
          reach: 2.5 * M,
          enabled: () => cliff.stage() === "idle" && !cliff.state().placed[index],
          handLabel: (kind) => {
            if (!ALL_BOWL_KINDS.has(kind)) return null;
            const fits = DEW_BOWL[bowl.size];
            // 맞는 사발이 소지품에 있으면 그것을 먼저 쓴다. 손에 든 것은 안 맞아도 올려 보게 둔다(안 맞는다고 일러 준다)
            if (kind === fits || inventory.hand()?.kind === kind) return "받침에 사발 올리기";
            return inventory.has(fits) ? null : "받침에 사발 올리기";
          },
          receive: (kind) => {
            const size = sizeOfDew(kind);
            if (!size) {
              showNotice("빈 사발이다. 물이 없으면 달이 비치지 않는다 — 독에 빗물이 고여 있다.", 4, {
                urgent: true,
                fleeting: true,
              });
              return false;
            }
            if (size !== bowl.size) {
              const isBigger = BOWLS[size].diameter > bowl.diameter;
              showNotice(
                isBigger
                  ? "받침에 비해 사발이 크다. 기우뚱해 물이 쏟아지겠다 — 더 큰 바위에 맞겠다."
                  : "받침에 비해 사발이 작다. 물낯이 낮아 달빛이 선바위를 비껴간다 — 더 작은 돌에 맞겠다.",
                4.5,
                { urgent: true, fleeting: true },
              );
              return false;
            }
            actions.placeBowl(index);
          },
          use: () => showNotice(REST_TEXT[bowl.size], 4),
        }),
      ),
      registerInteractable({
        id: "cliff-jar",
        position: rite.jarTarget,
        label: "빗물이 고인 독",
        radius: 0.45 * M,
        reach: 2.4 * M,
        handLabel: (kind) => {
          if (BOWL_SIZES.some((size) => EMPTY_BOWL[size] === kind)) return "독에서 사발에 물 뜨기";
          return kind === "emptyJug" ? "독에서 귀때동이에 물 퍼 담기" : null;
        },
        receive: (kind) => {
          const dip = () => audio.play("첨벙");
          if (kind === "emptyJug") {
            if (!inventory.add("waterJug")) return false;
            cliff.update({ pours: JUG_POURS });
            startScoop(scoop, kind, { at: rite.jarWaterAt, radius: rite.jarWaterRadius }, dip);
            showNotice("귀때동이에 독의 물을 그득 퍼 담았다. 세 번은 뿌릴 수 있다.", 4);
            return undefined;
          }
          const size = BOWL_SIZES.find((entry) => EMPTY_BOWL[entry] === kind);
          if (!size || !inventory.add(DEW_BOWL[size])) return false;
          startScoop(scoop, kind, { at: rite.jarWaterAt, radius: rite.jarWaterRadius }, dip);
          showNotice(`${BOWLS[size].name} 가득 빗물을 떴다. 물낯에 달이 어른거린다.`, 3.5);
          return undefined;
        },
        use: () =>
          showNotice(
            cliff.isAtLeast("flowing")
              ? "독에 빗물이 그득하다. 물낯에 달이 떠 있다."
              : "독에 빗물이 그득하다. 물낯에 달이 떠 있다 — 사발로 뜰 수 있겠다.",
            3.5,
          ),
      }),
      registerInteractable({
        id: "cliff-jug",
        position: rite.jugTarget,
        label: "흙에 묻힌 귀때동이",
        radius: 0.36 * M,
        reach: 2.4 * M,
        // 사발의 물이 흙을 풀기 전에는 손댈 수 없다
        enabled: () => cliff.isAtLeast("loose") && !cliff.state().jugTaken,
        use: () => actions.pullJug(),
      }),
      registerInteractable({
        id: "cliff-standing",
        position: rite.standingTarget,
        label: "선바위",
        radius: 0.7 * M,
        reach: 3.2 * M,
        enabled: () => cliff.stage() !== "vision",
        use: () =>
          showNotice(
            cliff.isAtLeast("flowing")
              ? "달빛이 걷힌 선바위. 그 밤들을 다 지켜본 바위다."
              : "사람 키를 넘는 선바위. 넓은 면이 강 쪽 달을 마주 본다 — 받침 셋이 이 바위 앞에 한 줄로 놓였다.",
            5,
          ),
      }),
      registerInteractable({
        id: "cliff-seat",
        position: rite.seatTarget,
        label: "너럭바위",
        radius: 0.45 * M,
        reach: 2.2 * M,
        enabled: () => cliff.state().taken[1],
        use: () => showNotice("오래 앉아 닳은 자리가 둘. 하나는 강을, 하나는 그 곁을 본다.", 4),
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [rite, actions, scoop]);

  const water = useMemo(() => new THREE.Vector3(), []);
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
    const state = cliff.state();

    if (jumpAt.current >= 0) {
      jumpAt.current -= dt;
      if (jumpAt.current < 0) {
        teleportPlayer(STAGE4_START.x, STAGE4_START.z, STAGE4_START.heading);
        showNotice("바위 위. 시공간 틈을 지나 그 밤 아랑사가 오른 절벽 꼭대기에 섰다.", 5);
      }
    }

    const distance = Math.hypot(camera.position.x / M - SEAT.x, camera.position.z / M - SEAT.z);
    if (!told.current.arrived && state.stage === "idle" && distance < 6) {
      told.current.arrived = true;
      showNotice(
        "선바위 앞에 너럭바위와 받침돌 둘이 한 줄로 놓였다. 둘레에 엎어진 사발 셋, 빗물이 고인 독 — 누군가 밤마다 여기 왔다.",
        6.5,
      );
    }
    updatePanel(state.stage === "idle" && distance < PANEL_RANGE ? distance : null);

    // 깨짐 — 조각이 흩어지고 물이 쏟아진다
    if (brokenFor.current >= 0) brokenFor.current += dt;
    const isBroken = brokenFor.current >= 0;

    rite.bowls.forEach((bowl, index) => {
      const isTaken = state.taken[index];
      const isPlaced = state.placed[index];
      const hasWater = isPlaced && !isBroken;
      bowl.group.visible = !isTaken || isPlaced;
      if (isPlaced) {
        bowl.group.position.copy(bowl.restAt);
        bowl.group.rotation.set(0, 0, 0);
      } else {
        // 엎어져 있다 — 굽이 위로
        bowl.group.position.copy(bowl.startAt).setY(bowl.startAt.y + bowl.diameter * 0.6 * M);
        bowl.group.rotation.set(Math.PI, index * 1.3, 0.07);
      }
      bowl.whole.visible = !isBroken;
      bowl.water.visible = hasWater || (isPlaced && brokenFor.current < 0.35 && brokenFor.current >= 0);
      (bowl.water.material as THREE.MeshBasicMaterial).opacity =
        0.94 * (brokenFor.current < 0 ? 1 : Math.max(0, 1 - brokenFor.current / 0.35));

      // 달빛 — 하늘에서 사발로, 사발에서 선바위로
      bowl.lit += ((hasWater ? 1 : 0) - bowl.lit) * Math.min(1, dt * (hasWater ? 1.4 : 5));
      bowl.ripple = Math.max(0, bowl.ripple - dt * 1.2);
      const steady = bowl.lit * (1 - bowl.ripple * 0.6);
      const isLit = bowl.lit > 0.01;
      bowl.moonbeam.mesh.visible = isLit;
      bowl.reflect.mesh.visible = isLit;
      bowl.glow.visible = isLit;
      waterCenterOf(bowl, water);
      if (isLit) {
        bowl.moonbeam.mesh.position.copy(water);
        bowl.moonbeam.material.uniforms.uStrength.value = steady;
        bowl.moonbeam.material.uniforms.uTime.value = time;
        bowl.reflect.mesh.position.copy(water);
        bowl.reflect.mesh.scale.y = bowl.hitAt.distanceTo(water);
        bowl.reflect.material.uniforms.uStrength.value = steady;
        bowl.reflect.material.uniforms.uTime.value = time;
        bowl.glow.position.copy(bowl.hitAt).addScaledVector(rite.normal, 0.06 * M);
        const flicker = 0.78 + 0.14 * Math.sin(time * 2.1 + index * 2.4) + 0.08 * Math.sin(time * 5.3 + index);
        bowl.glow.material.opacity = steady * flicker * (state.stage === "vision" ? 0.16 : 0.3);
      }
      placeWaterMoon(bowl.moon, water, bowl.diameter * BOWL_WATER.radius, camera, hasWater ? 1 - bowl.ripple * 0.7 : 0);
    });

    // 독 물낯의 달
    placeWaterMoon(rite.jarMoon, rite.jarWaterAt, rite.jarWaterRadius, camera, 0.9);

    // 깨진 조각 · 쏟아진 물 · 풀리는 흙
    const soaked = updateSpill(spill, brokenFor.current, time, { gl, camera });
    updateScoop(scoop, dt, time, gl, camera);
    rite.jug.visible = !state.jugTaken;
    // 흙이 풀리면 귀때동이가 살짝 떠오르며 기운다
    rite.jug.position.y = (floorAt(JUG.x, JUG.z) - JUG.buried * (1 - soaked * 0.45)) * M;
    rite.jug.rotation.z = -0.14 - soaked * 0.12 + (soaked > 0 && soaked < 1 ? Math.sin(time * 14) * 0.02 : 0);

    // 그 뒤의 밤들
    const v = vision.current;
    if (v.time >= 0) {
      // 영상이 틀어지고 있으면 영상의 시각이 기준 — 자막 · 소리 · 끝이 그림과 어긋나지 않게
      v.time = rite.play.draw(v.time + dt);
      const t = v.time;
      // 자막 — 컷마다 한 줄, 영상 시각에 맞춰
      setFilmCaption(captionAt(MOON_CLIP_CAPTIONS, t));
      rite.play.material.opacity =
        THREE.MathUtils.smootherstep(t, 0.2, 1.0) *
        (1 - THREE.MathUtils.smootherstep(t, MOON_CLIP_SECONDS - MOON_CLIP_FADE, MOON_CLIP_SECONDS));
      for (const cue of MOON_CLIP_CUES) {
        if (t < cue.at || v.fired.has(cue.at)) continue;
        v.fired.add(cue.at);
        audio.play(cue.sound);
        if (cue.shake) {
          director.cue({ 카메라: "흔들림", 세기: cue.shake });
          rite.bowls.forEach((bowl) => (bowl.ripple = 1));
        }
      }
      if (t >= MOON_CLIP_SECONDS) actions.breakBowls();
    }
  });

  /** 안내판 — 가까이 있을 때만. distance 가 null 이면 내린다 */
  const updatePanel = (distance: number | null) => {
    if (distance === null) {
      setPuzzlePanel("cliff-bowls", null);
      return;
    }
    const state = cliff.state();
    setPuzzlePanel("cliff-bowls", {
      title: "정화수 세 그릇",
      rule: "엎어진 사발 셋에 독의 빗물을 떠, 선바위 앞 바위 위에 하나씩 올린다. 큰 사발은 큰 바위에, 작은 사발은 작은 돌에. 물에 달이 내려앉으면 달빛이 선바위로 튄다.",
      rows: BOWL_SIZES.map((size, index) => ({
        label: BOWLS[size].name,
        value: state.placed[index]
          ? "달이 떴다"
          : inventory.has(DEW_BOWL[size]) || inventory.hand()?.kind === DEW_BOWL[size]
            ? "물을 떴다"
            : state.taken[index]
              ? "비어 있다"
              : "엎어져 있다",
        ok: state.placed[index],
      })),
      distance,
    });
  };

  // 영상 도중에 이 장면이 내려가도 자막이 남지 않게(남으면 다른 알림이 계속 줄을 선다)
  useEffect(() => () => setFilmCaption(null), []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("najuCliffDev", {
      state: () => cliff.state(),
      /** 사발 셋을 다 주운 것으로 치고 물 사발을 받침에 올린다(0 큰 · 1 가운데 · 2 작은) */
      place: (index: number) => {
        cliff.update({ taken: cliff.state().taken.map((value, i) => value || i === index) });
        actions.placeBowl(index);
      },
      vision: () => actions.startVision(),
      skipVision: () => {
        if (vision.current.time >= 0) vision.current.time = MOON_CLIP_SECONDS;
      },
      /** 영상 없이 바로 사발을 깨고 귀때동이를 푼다 */
      loosen: () => {
        cliff.update({ taken: [true, true, true], placed: [true, true, true] });
        if (cliff.stage() === "idle") cliff.advance("vision");
        actions.breakBowls();
        brokenFor.current = SPILL.flow - 0.5;
      },
      spots: () => ({
        starts: rite.bowls.map((bowl) => bowl.startTarget.clone().divideScalar(M)),
        rests: rite.bowls.map((bowl) => bowl.restTarget.clone().divideScalar(M)),
        hits: rite.bowls.map((bowl) => bowl.hitAt.clone().divideScalar(M)),
        jar: rite.jarTarget.clone().divideScalar(M),
        jug: rite.jugTarget.clone().divideScalar(M),
        screen: rite.play.mesh.position.clone().divideScalar(M),
      }),
      reset: () => {
        cliff.reset();
        brokenFor.current = -1;
        vision.current.time = -1;
        rite.play.mesh.visible = false;
      },
    });
  }, [rite, actions]);

  return null;
}

/** 모형 — 미르 라이브러리(국가유산청 CC BY 4.0). 다 놓인 뒤 받침 윗면 · 달빛이 닿는 자리 · 영상 판 자리를 잰다 */
function useRiteModels(rite: Rite, spill: Spill, scoop: Scoop) {
  useEffect(() => {
    let isAlive = true;
    const put = (url: string, size: number, x: number, z: number, yaw: number) =>
      loadModel(assetUrl(url), size).then((source) => {
        if (!isAlive || !source) return null;
        const copy = source.clone(true);
        copy.traverse((node) => {
          node.castShadow = true;
          node.receiveShadow = true;
        });
        copy.position.copy(planar(x, z));
        copy.rotation.y = yaw;
        copy.scale.multiplyScalar(M);
        rite.root.add(copy);
        copy.updateMatrixWorld(true);
        return copy;
      });

    void put(MODELS.jar, JAR.size, JAR.x, JAR.z, 0.4).then((jar) => {
      if (jar) fillJar(rite, jar);
    });
    void loadModel(assetUrl(MODELS.jug), JUG.size).then((source) => {
      if (!isAlive || !source) return;
      rite.jug.add(source.clone(true));
      addScoopVessel(scoop, "emptyJug", source);
    });
    // 사발 — 온전한 것 하나와, 깨졌을 때 조각으로 쓸 것들
    rite.bowls.forEach((bowl, index) => {
      void loadModel(assetUrl(MODELS.bowl), bowl.diameter).then((source) => {
        if (!isAlive || !source) return;
        bowl.whole.add(source.clone(true));
        fitPieces(spill, index, source);
        // 물 뜨는 손짓에 쓸 사발 — 물을 담으면 물낯이 보인다
        addScoopVessel(
          scoop,
          EMPTY_BOWL[bowl.size],
          source,
          makeWaterDisc(bowl.diameter * BOWL_WATER.radius, bowl.diameter * BOWL_WATER.height),
        );
      });
    });

    const medium = BOWLS.medium;
    const small = BOWLS.small;
    void Promise.all([
      put(MODELS.standing, STANDING.height, STANDING.x, STANDING.z, STANDING.yaw),
      put(MODELS.seat, SEAT.size, SEAT.x, SEAT.z, SEAT.yaw),
      put(MODELS.stoneMedium, medium.stone, medium.rest.x, medium.rest.z, 0.9),
      put(MODELS.stoneSmall, small.stone, small.rest.x, small.rest.z, 2.2),
    ]).then(([rock, seat, stoneMedium, stoneSmall]) => {
      if (!isAlive) return;
      const supports = [seat, stoneMedium, stoneSmall];
      rite.bowls.forEach((bowl, index) => {
        const spec = BOWLS[bowl.size];
        // 받침 윗면 — 사발 굽이 살짝 앉는다
        const top = supports[index] ? topOf(supports[index], spec.rest.x, spec.rest.z) : null;
        if (top !== null) bowl.restAt.setY(top - 0.012 * M);
        bowl.restTarget.copy(bowl.restAt).setY(bowl.restAt.y + 0.06 * M);
        // 엎어진 자리 — 가운데 사발은 너럭바위 위에 엎어져 있다
        const lying = seat ? topOf(seat, spec.start.x, spec.start.z) : null;
        if (lying !== null && lying > bowl.startAt.y) bowl.startAt.setY(lying);
        bowl.startTarget.copy(bowl.startAt).setY(bowl.startAt.y + bowl.diameter * 0.35 * M);
        measureHit(rite, bowl, rock);
      });
      measureSpill(spill, supports);
      // 영상 판 — 세 달빛이 맺힌 자리 한가운데, 바위 앞에 뜬다
      const center = new THREE.Vector3();
      rite.bowls.forEach((bowl) => center.add(bowl.hitAt));
      rite.play.mesh.position.copy(center.multiplyScalar(1 / rite.bowls.length)).addScaledVector(rite.normal, 0.45 * M);
      rite.play.mesh.rotation.y = STANDING.yaw;
    });
    return () => {
      isAlive = false;
    };
  }, [rite, spill, scoop]);
}

/** 충돌 — 너럭바위는 밟고 서고, 선바위 · 받침돌 · 독은 막기만 한다 */
function useRiteColliders() {
  useEffect(() => {
    const solid = (x: number, z: number, yaw: number, halfX: number, halfZ: number, height: number, walkable = false) =>
      addDynamicSolid({
        x,
        z,
        yaw,
        halfX,
        halfZ,
        bottom: floorAt(x, z) - 0.2,
        top: floorAt(x, z) + height,
        enabled: true,
        walkable,
      });
    const medium = BOWLS.medium;
    const small = BOWLS.small;
    const removers = [
      solid(SEAT.x, SEAT.z, SEAT.yaw, 0.78, 0.48, SEAT_TOP, true),
      solid(STANDING.x, STANDING.z, STANDING.yaw, STANDING_HALF.x, STANDING_HALF.z, STANDING.height),
      solid(JAR.x, JAR.z, 0, 0.3, 0.3, JAR.size),
      solid(medium.rest.x, medium.rest.z, 0, medium.stone * 0.36, medium.stone * 0.3, 0.4),
      solid(small.rest.x, small.rest.z, 0, small.stone * 0.36, small.stone * 0.36, 0.35),
    ];
    return () => removers.forEach((remove) => remove());
  }, []);
}
