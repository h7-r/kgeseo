/**
 * 아랑사의 함 열기 — 불탄 평상을 겨눠 함을 올려놓고(E, 바닥에 떨어진 함도 그 자리에서 열 수 있다) 돌새가 준 청동 열쇠를 자물통 구멍에 꽂아 돌리면(E)
 * 열쇠가 들어가 「철컥」 돌고 → 자물통이 빠져 떨어지고 → 뚜껑이 덜컥 열린다.
 * 함 속에는 작은 구렁이상(미르의 구렁이 모형을 줄였다)과 주마등. 열리면 함에서 빛기둥이 위로 쏟아지고 그 빛 속에 그날 밤의 영상이
 * 흐른다(shadowPlay) — 글은 없다. 구렁이상은 넷째 이야기의 조각으로 남긴다.
 * 소지품의 「받는 곳」 규칙을 그대로 쓴다 — 빈손으로 겨눠도 소지품에서 알아서 꺼내 쓴다. 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { assetUrl } from "@/config/env";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { exposeDevHook } from "@/debug/devHooks";
import { gameNow, gameSetTimeout } from "@/engine/input/gameClock";

import { recall, track } from "../../save/puzzleMemory";
import { solidQueries } from "../../movement/solidField";
import { focusCamera } from "../../scene/cameraFocus";
import { audio } from "../../scene/immersion/audio";
import { director } from "../../scene/immersion/director";
import { makeGlowTexture } from "../glowTexture";
import { interactableFor, noticeFor, clearPendingNotices } from "../interaction";
import { ridge, ridgeBox } from "./ridgeState";
import { inventory, registerLeftBehind, useHandItem, useHeldItems, useWorldItems } from "../inventory";
import { createCompressedGltfLoader } from "../../loaders/compressedGlb";
import { M, groundY } from "../units";
import { LID, LOCK_AT, LOCK_LENGTH, buildBoxBase, buildBoxLid, BOX, buildBronzeKey, buildPadlock } from "./lockedBox";
import { bindBoxPhase, type BoxPhase } from "./boxPhase";
import { PLATFORM } from "./ridgeShape";
import {
  SHADOW_PLAY_CAPTIONS,
  SHADOW_PLAY_CUES,
  SHADOW_PLAY_FADE,
  SHADOW_PLAY_SECONDS,
  createShadowPlay,
} from "./shadowPlay";
import { captionAt, setFilmCaption } from "../filmCaption";
import { makeVertexColorMaterial } from "./vertexPaint";

/** 이 퍼즐(장면)의 글 · 물건 — 다른 퍼즐로 넘어가면 여기서 남긴 글은 내린다(interaction noticeFor · interactableFor) */
const showNotice = noticeFor("box");
const registerInteractable = interactableFor("box");

/** 함을 실물보다 조금 크게 — 1인칭에서 자물통이 보이게 */
const BOX_SCALE = 1.5;
const INSERT_SECONDS = 0.8;
const TURN_SECONDS = 0.5;
const DROP_SECONDS = 0.6;
const OPEN_SECONDS = 1.3;
/** 함을 내려놓는 시간 · 뚜껑이 다 열리는 각 */
const PLACE_SECONDS = 0.45;
const LID_OPEN = 1.9;
/** 영상 판 — 함에서 뒤로 물러난 거리 · 판 가운데 높이(함 위, 미터) */
const SCREEN = { behind: 0.9, height: 1.55 };
/** 빛기둥 — 높이(미터) · 밑 · 위 반지름 */
const BEAM = { height: 2.6, bottom: 0.12, top: 1.2 };
/** 구렁이상 — 가장 긴 변(미터). 함 속(0.276 × 0.176, 높이 0.14)에 긴 쪽을 함 길이에 맞춰 눕혀야 뚜껑을 닫아도 들어간다 */
const SERPENT_URL = "/_sf_local/codeprops/serpent.glb";
const SERPENT_SIZE = 0.14;
/** 속에서 새어 나오는 빛 — 바닥에서 띄우는 높이(함 기준 m) · 크기 */
const INNER_GLOW = { lift: 0.05, size: 0.5 };

type Phase = BoxPhase;

/** 끝에서 살짝 넘어갔다 돌아온다 — 무거운 뚜껑이 경첩에 걸리는 느낌 */
const easeOutBack = (t: number) => {
  const c = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.2 * c * c * c + 1.2 * c * c;
};
/** 떨어져 두 번 튀는 높이 몫(1 → 0) — 시각은 초 */
function fallHeight(since: number) {
  const fall = 0.32;
  if (since < fall) return 1 - (since / fall) ** 2;
  const bounce = (start: number, length: number, height: number) => {
    const t = (since - start) / length;
    return t >= 0 && t <= 1 ? 4 * t * (1 - t) * height : 0;
  };
  return bounce(fall, 0.2, 0.18) + bounce(fall + 0.2, 0.12, 0.05);
}

function buildBox() {
  const material = makeVertexColorMaterial();
  const root = new THREE.Group();
  root.visible = false;
  root.add(new THREE.Mesh(buildBoxBase(), material));
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, LID.hingeY, LID.hingeZ);
  lidPivot.add(new THREE.Mesh(buildBoxLid(), material));
  root.add(lidPivot);
  const lock = new THREE.Mesh(buildPadlock(), material);
  lock.position.copy(LOCK_AT);
  root.add(lock);
  // 함 속 — 바닥에 앉은 작은 구렁이상 하나뿐(모형은 뒤에 읽어 끼운다)
  const serpent = new THREE.Group();
  serpent.position.set(0, BOX.floor + 0.001, 0);
  root.add(serpent);
  // 빛기둥 — 열리면 함 속에서 위로 쏟아진다. 안쪽이 밝고 위로 갈수록 풀린다
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying float vFacing;
      void main() {
        vHeight = uv.y;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-viewPosition.xyz)));
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform float uTime;
      varying float vHeight;
      varying float vFacing;
      void main() {
        float fade = pow(1.0 - vHeight, 1.4) * smoothstep(0.0, 0.05, vHeight);
        float ray = 0.75 + 0.25 * sin(vHeight * 40.0 - uTime * 6.0);
        gl_FragColor = vec4(1.0, 0.86, 0.6, uStrength * fade * pow(vFacing, 1.6) * ray * 0.55);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM.top, BEAM.bottom, BEAM.height, 28, 1, true).translate(0, BEAM.height / 2 + 0.05, 0),
    beamMaterial,
  );
  beam.visible = false;
  root.add(beam);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: "#FFC27A",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    }),
  );
  glow.scale.setScalar(INNER_GLOW.size);
  glow.position.set(0, BOX.floor + INNER_GLOW.lift, 0);
  root.add(glow);
  // 꽂을 열쇠 — 끝이 −x(자물통 쪽)를 보게 돌려 둔다
  const key = new THREE.Mesh(buildBronzeKey().translate(0, -0.006, 0), material);
  key.rotation.y = Math.PI;
  key.visible = false;
  root.add(key);
  root.scale.setScalar(BOX_SCALE * M);
  return {
    root,
    lidPivot,
    lock,
    key,
    glow,
    serpent,
    beam,
    beamMaterial,
    play: createShadowPlay(),
    restAt: new THREE.Vector3(),
    placeFrom: new THREE.Vector3(),
    lockTarget: new THREE.Vector3(),
    platformTarget: new THREE.Vector3(PLATFORM.x * M, (groundY(PLATFORM.x, PLATFORM.z) + 0.5) * M, PLATFORM.z * M),
  };
}

interface SavedBox {
  phase: Phase;
  restAt: number[];
  yaw: number;
}

export default function BoxOpening() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const box = useMemo(() => buildBox(), []);
  const phase = useRef<Phase>("none");
  // 쓸 일 끝난 열쇠 · 함 치우기가 읽는다
  useEffect(
    () =>
      bindBoxPhase(
        () => phase.current,
        () => box.lockTarget,
      ),
    [box],
  );
  const startedAt = useRef(0);
  /** 내려놓은 뒤 흐른 시간(초 · 음수면 다 놓였다) · 그림자 재생 시간 */
  const placeTime = useRef(-1);
  /** 함이 옮겨져 자물통 자리를 다시 재야 한다 — 첫 프레임에도 잰다 */
  const isLockStale = useRef(true);
  const playTime = useRef(-1);
  const cuesFired = useRef(new Set<number>());
  const told = useRef({ hint: false, unlocked: false });
  /** 함 속 구렁이상을 꺼냈나 — 4스테이지(바위 위)에서 쓴다 */
  const serpentTaken = useRef(recall("ridge.serpentTaken", false));
  const held = useHeldItems();
  const hand = useHandItem();
  const worldItems = useWorldItems();

  useEffect(() => {
    scene.add(box.root, box.play.mesh);
    return () => {
      scene.remove(box.root, box.play.mesh);
    };
  }, [scene, box]);

  // 구렁이상 — 미르의 구렁이 모형을 손바닥만 하게 줄여 함 바닥에 앉힌다
  useEffect(() => {
    let isAlive = true;
    createCompressedGltfLoader().load(
      assetUrl(SERPENT_URL),
      (gltf) => {
        if (!isAlive) return;
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const extent = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -bounds.min.y, -center.z);
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = true;
        });
        const holder = new THREE.Group();
        holder.add(model);
        holder.scale.setScalar(SERPENT_SIZE / (Math.max(extent.x, extent.y, extent.z) || 1));
        box.serpent.add(holder);
      },
      undefined,
      (error) => console.warn("[BoxOpening] 구렁이 모형을 못 읽었다:", error),
    );
    return () => {
      isAlive = false;
    };
  }, [box]);

  /** 열쇠를 꽂기 시작한다 */
  const startUnlock = useRef(() => {
    phase.current = "unlocking";
    startedAt.current = gameNow() / 1000;
    box.key.visible = true;
    audio.play("똑");
  });

  /** 함을 이 자리(유닛)에 — 손에서 내려와 놓이고, 자물통이 플레이어 쪽을 본다 */
  const placeBox = useRef((position: THREE.Vector3) => {
    box.restAt.copy(position);
    box.placeFrom.copy(camera.position).lerp(position, 0.45);
    box.root.position.copy(box.placeFrom);
    box.root.rotation.y = Math.atan2(camera.position.x - position.x, camera.position.z - position.z);
    box.root.visible = true;
    phase.current = "placed";
    placeTime.current = 0;
    box.play.prepare();
    showNotice("함을 내려놓았다. 청동 자물통 끝에 열쇠 구멍이 있다. 열쇠가 없으면 [E] 로 다시 챙긴다.", 4);
  });

  // 이어 하기: 내려놓은 함을 그 자리에 되돌린다. 열던 중인 함은 여는 장면부터 다시 본다(열쇠는 이미 썼다).
  useEffect(() => {
    const saved = recall<SavedBox | null>("ridge.box", null);
    if (saved && saved.phase !== "none") {
      box.restAt.fromArray(saved.restAt);
      box.root.position.copy(box.restAt);
      box.root.rotation.y = saved.yaw;
      box.root.visible = true;
      box.play.prepare();
      phase.current = "placed";
      placeTime.current = -1;
      isLockStale.current = true;
      if (saved.phase === "done") {
        // 다 본 함은 뚜껑이 열린 채 놓여 있다. 영상과 조작 묶임을 되풀이하지 않는다.
        phase.current = "done";
        box.lidPivot.rotation.x = -LID_OPEN;
        box.lock.visible = false;
      } else if (saved.phase !== "placed") startUnlock.current();
    }
    box.serpent.visible = !serpentTaken.current;
    ridgeBox.isEmptied = serpentTaken.current;
    const untrackSerpent = track("ridge.serpentTaken", () => serpentTaken.current);
    const untrackBox = track("ridge.box", (): SavedBox => ({
      phase: phase.current,
      restAt: box.restAt.toArray(),
      yaw: box.root.rotation.y,
    }));
    return () => {
      untrackSerpent();
      untrackBox();
    };
  }, [box]);

  /** 내려놓은 함을 도로 챙긴다 — 다시 평상이나 다른 자리에 놓을 수 있다. 칸이 없으면 false */
  const takeBackBox = useRef(() => {
    if (phase.current !== "placed" || !inventory.add("letterBox")) return false;
    phase.current = "none";
    placeTime.current = -1;
    box.root.visible = false;
    return true;
  });
  useEffect(() => registerLeftBehind(() => void takeBackBox.current()), []);

  // 땅에 내려놓은 함 — 줍는 물건 대신 열 수 있는 함으로 바꿔 놓는다(평상까지 돌아가지 않아도 열린다)
  useEffect(() => {
    if (phase.current !== "none") return;
    const dropped = worldItems.find((item) => item.kind === "letterBox");
    if (!dropped) return;
    inventory.removeFromWorld(dropped.uid);
    placeBox.current(dropped.position);
  }, [worldItems]);

  // 열쇠와 함이 둘 다 손에 들어오면 한 번 일러 준다 — 손에 꺼내 든 것도 센다(소지품만 보면 든 채로는 안 일렀다, Codex 01)
  useEffect(() => {
    const kinds = new Set([...held, ...(hand ? [hand] : [])].map((item) => item.kind));
    if (!told.current.hint && kinds.has("bronzeKey") && kinds.has("letterBox") && phase.current === "none") {
      told.current.hint = true;
      // 허공 E 는 소지품 넣기라 「꺼내 내려놓기」가 아니다 — 평상에 올리는 길만 알린다
      showNotice("청동 열쇠와 아랑사의 함 — 불탄 평상을 겨누고 E 로 함을 올린 뒤, 자물통을 겨눠 열어 보자.", 5);
    }
  }, [held, hand]);

  useEffect(() => {
    const hasBox = () => inventory.has("letterBox") || inventory.hand()?.kind === "letterBox";
    const removePlatform = registerInteractable({
      id: "ridge-platform",
      position: box.platformTarget,
      label: "평상에 함 올려놓기",
      radius: 0.9 * M,
      reach: 2.6 * M,
      // 열쇠를 얻기 전엔 평상 글을 읽는 자리다 — 함을 가졌다고 그 겨냥을 가로채면 안 된다
      enabled: () => phase.current === "none" && hasBox() && ridge.isAtLeast("circling"),
      handLabel: (kind) => (kind === "letterBox" && phase.current === "none" ? "평상에 함 올려놓기" : null),
      receive: () => {
        // 함 앞(자물통)이 플레이어 쪽을 보게
        const ground = groundY(PLATFORM.x, PLATFORM.z);
        const deck = solidQueries.current?.supportAt(PLATFORM.x, PLATFORM.z, ground + 1.2) ?? -Infinity;
        const top = deck > ground ? deck : ground + 0.35;
        placeBox.current(new THREE.Vector3(PLATFORM.x * M, top * M, PLATFORM.z * M));
      },
      use: () => showNotice("평상 — 무언가 올려놓기 좋은 높이다.", 2.5),
    });
    const removeLock = registerInteractable({
      id: "ridge-box-lock",
      position: box.lockTarget,
      label: "아랑사의 함 줍기",
      isPickup: true,
      radius: 0.4 * M,
      reach: 2.4 * M,
      enabled: () => phase.current === "placed",
      handLabel: (kind) => (kind === "bronzeKey" ? "열쇠로 자물통 열기" : null),
      receive: () => startUnlock.current(),
      use: () => {
        if (!takeBackBox.current()) {
          showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 줍자.");
          return;
        }
        audio.play("단서");
        showNotice("함을 다시 챙겼다. 청동 자물통이 단단히 채워져 있어 맞는 열쇠가 있어야 열린다.", 3.5);
      },
    });
    // 다 본 함 — 바닥의 구렁이상을 꺼낸다
    const serpentTarget = new THREE.Vector3();
    const removeSerpent = registerInteractable({
      id: "ridge-box-serpent",
      position: serpentTarget,
      label: "구렁이상 꺼내기",
      isPickup: true,
      radius: 0.35 * M,
      reach: 2.4 * M,
      enabled: () => {
        if (phase.current !== "done" || serpentTaken.current) return false;
        serpentTarget.copy(box.root.position).setY(box.root.position.y + 0.15 * M);
        return true;
      },
      use: () => {
        if (!inventory.add("serpentFigure")) {
          showNotice("소지품과 손이 다 찼다. 손에 든 것을 내려놓고 다시 꺼내자.");
          return;
        }
        serpentTaken.current = true;
        ridgeBox.isEmptied = true;
        box.serpent.visible = false;
        audio.play("단서");
        showNotice("손바닥만 한 구렁이상 — 똬리를 틀고 고개를 들었다. 어부의 함에 왜 이것이.", 4.5);
      },
    });
    return () => {
      removePlatform();
      removeLock();
      removeSerpent();
    };
  }, [box, camera]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    // 겨눌 자물통 자리 — 함이 움직이는 동안과 옮겨진 직후에만 잰다
    if (placeTime.current >= 0 || isLockStale.current) {
      isLockStale.current = false;
      box.root.updateMatrixWorld(true);
      box.lockTarget.copy(LOCK_AT).applyMatrix4(box.root.matrixWorld);
    }

    // 내려놓기 — 손에서 내려와 쿵 놓이고 살짝 흔들린다
    if (placeTime.current >= 0) {
      placeTime.current += dt;
      const t = Math.min(1, placeTime.current / PLACE_SECONDS);
      box.root.position.lerpVectors(box.placeFrom, box.restAt, t * t);
      const settle = Math.max(0, placeTime.current - PLACE_SECONDS);
      box.root.rotation.z = settle < 0.3 ? Math.sin(settle * 26) * 0.03 * (1 - settle / 0.3) : 0;
      if (t >= 1 && settle === 0) audio.play("똑");
      if (settle >= 0.3) {
        placeTime.current = -1;
        box.root.rotation.z = 0;
        isLockStale.current = true;
      }
    }
    if (phase.current === "play") updatePlay(dt, frame.clock.elapsedTime);
    // 다 본 함 — 꺼내기 전까지 속이 은은히 밝아 밤에도 구렁이상이 보인다
    if (phase.current === "done") (box.glow.material as THREE.SpriteMaterial).opacity = serpentTaken.current ? 0 : 0.35;
    if (phase.current !== "unlocking") return;

    const elapsed = gameNow() / 1000 - startedAt.current;
    const lockEnd = LOCK_AT.x + LOCK_LENGTH / 2;
    // 열쇠가 구멍으로 들어간다 — 구멍을 찾느라 끝에서 한 번 멈칫한다
    const reach = THREE.MathUtils.smootherstep(elapsed, 0, INSERT_SECONDS * 0.55) * 0.6;
    const seat = THREE.MathUtils.smootherstep(elapsed, INSERT_SECONDS * 0.65, INSERT_SECONDS) * 0.4;
    box.key.position.set(lockEnd + 0.16 - (reach + seat) * 0.1, LOCK_AT.y, LOCK_AT.z);
    // 돌린다 — 뻑뻑하다가 철컥 넘어간다
    const turnStart = INSERT_SECONDS;
    const turnT = THREE.MathUtils.clamp((elapsed - turnStart) / TURN_SECONDS, 0, 1);
    const turn = turnT ** 3;
    box.key.rotation.set(turn * (Math.PI / 2), Math.PI, 0);
    if (turnT >= 1 && !told.current.unlocked) {
      told.current.unlocked = true;
      audio.play("단서");
      director.cue({ 카메라: "흔들림", 세기: 0.08 });
      // 그 순간에 — 앞에 기다리는 글이 있어도 밀어낸다(틈 해설 뒤에 줄 서서 영상이 끝난 뒤에야 떴다, 미르 11/10)
      showNotice("철컥 — 자물통이 풀렸다.", 2.5, { urgent: true });
    }
    // 자물통이 고리에서 빠져 떨어져 튄다(열쇠도 함께)
    const dropStart = turnStart + TURN_SECONDS + 0.25;
    const dropSince = elapsed - dropStart;
    if (dropSince > 0) {
      const slide = Math.min(1, dropSince / 0.12) * 0.05;
      const height = LOCK_AT.y * fallHeight(Math.max(0, dropSince - 0.1)) + 0.014;
      const roll = Math.min(1, dropSince / 0.6);
      box.lock.position.set(LOCK_AT.x + slide + roll * 0.02, height, LOCK_AT.z + 0.02 + roll * 0.05);
      box.lock.rotation.z = roll * 0.7;
      box.key.position.set(lockEnd + 0.06 + slide + roll * 0.02, height, LOCK_AT.z + 0.02 + roll * 0.05);
    }
    // 뚜껑 — 덜컥 조금 들렸다가 한 박자 쉬고, 무겁게 젖혀진다
    const openStart = dropStart + DROP_SECONDS + 0.2;
    const openT = (elapsed - openStart) / OPEN_SECONDS;
    const crack = THREE.MathUtils.smoothstep(openT, 0, 0.14) * 0.16;
    const swing = openT > 0.28 ? easeOutBack((openT - 0.28) / 0.72) * (LID_OPEN - 0.16) : 0;
    box.lidPivot.rotation.x = -(crack + swing);
    if (openT >= 1) startPlay();
  });

  /** 뚜껑이 다 열렸다 — 빛기둥이 솟고 그 위 빛 속에 영상이 선다. 시선이 그쪽으로 간다 */
  const startPlay = () => {
    phase.current = "play";
    playTime.current = 0;
    // 영상 앞의 글은 거둔다 — 자막 동안 줄을 섰다가 영상이 끝난 뒤 뒤늦게 이어 나오지 않게
    clearPendingNotices();
    cuesFired.current.clear();
    const away = new THREE.Vector3(box.root.position.x - camera.position.x, 0, box.root.position.z - camera.position.z);
    if (away.lengthSq() < 1) camera.getWorldDirection(away).setY(0);
    away.normalize();
    const { mesh } = box.play;
    mesh.position.copy(box.root.position).addScaledVector(away, SCREEN.behind * M);
    mesh.position.y += SCREEN.height * M;
    mesh.rotation.y = Math.atan2(-away.x, -away.z);
    mesh.visible = true;
    box.beam.visible = true;
    audio.play("징");
    focusCamera({
      id: "box-shadow-play",
      target: mesh.position,
      hold: SHADOW_PLAY_SECONDS - 1.3,
      turnIn: 0.8,
      turnOut: 0.7,
      zoom: 0.82,
      replace: true,
    });
  };

  /** 재생 한 프레임 — 함 속이 밝아지며 빛기둥이 솟고, 영상이 끝나면 빛이 함으로 가라앉는다 */
  const updatePlay = (dt: number, time: number) => {
    playTime.current += Math.min(dt, 1 / 30);
    const t = playTime.current;
    box.play.draw(t);
    // 자막 — 컷마다 한 줄, 영상 시각에 맞춰
    setFilmCaption(captionAt(SHADOW_PLAY_CAPTIONS, t));
    // 끝에는 빛이 천천히 약해지고 영상도 함께 옅어진다
    const dim = 1 - THREE.MathUtils.smootherstep(t, SHADOW_PLAY_SECONDS - SHADOW_PLAY_FADE, SHADOW_PLAY_SECONDS);
    const rise = THREE.MathUtils.smootherstep(t, 0, 0.9) * dim;
    const light = rise * (0.9 + 0.1 * Math.sin(time * 9));
    (box.glow.material as THREE.SpriteMaterial).opacity = light;
    box.beamMaterial.uniforms.uStrength.value = light;
    box.beamMaterial.uniforms.uTime.value = time;
    // 영상이 비치는 동안 판도 빛 따라 서서히
    box.play.material.opacity = THREE.MathUtils.smootherstep(t, 0.2, 1.0) * dim;
    for (const cue of SHADOW_PLAY_CUES) {
      if (t < cue.at || cuesFired.current.has(cue.at)) continue;
      cuesFired.current.add(cue.at);
      audio.play(cue.sound);
      if (cue.shake) director.cue({ 카메라: "흔들림", 세기: cue.shake });
    }
    if (t < SHADOW_PLAY_SECONDS) return;
    phase.current = "done";
    setFilmCaption(null);
    box.play.mesh.visible = false;
    box.beam.visible = false;
    (box.glow.material as THREE.SpriteMaterial).opacity = 0;
    // 화면이 다 돌아온 뒤에 — 영상(12.4 s)이 화면 고정(돌아보기 · 머물기 · 풀기 12.6 s)보다 조금 먼저 끝나 [E] 안내가 조작보다 먼저 떴다(Codex 01)
    gameSetTimeout(() => showNotice("함 바닥에 작은 구렁이상 하나가 남아 있다. [E] 로 꺼낸다.", 5), 500);
  };

  // 영상 도중에 이 장면이 내려가도 자막이 남지 않게(남으면 다른 알림이 계속 줄을 선다)
  useEffect(() => () => setFilmCaption(null), []);

  useEffect(() => {
    if (import.meta.env.DEV)
      exposeDevHook("najuBoxDev", {
        phase: () => phase.current,
        lock: () => box.lockTarget.clone(),
        /** 함을 발 앞에 놓는다 — 검사용 */
        place: (position: THREE.Vector3) => placeBox.current(position),
        unlock: () => startUnlock.current(),
      });
  }, [box]);

  return null;
}
