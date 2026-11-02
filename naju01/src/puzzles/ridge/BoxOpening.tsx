/**
 * 아랑사의 함 열기 — 증언 능선 평상에 함을 올려놓고(E), 돌새가 준 청동 열쇠를 자물통 끝 구멍에 꽂아 돌리면(E)
 *   열쇠가 들어가 「철컥」 돌고 → 자물통이 빠져 평상에 떨어지고 → 뚜껑이 열려 접힌 편지가 보인다.
 * 소지품의 「받는 곳」 규칙을 그대로 쓴다 — 빈손으로 겨눠도 소지품에서 알아서 꺼내 쓴다.
 * 편지 내용은 대화·서사 담당 몫이라 여기서는 「아랑사가 아비사에게 쓴 편지」라는 것까지만 보여 준다.
 * 좌표는 미터, 그리는 것은 유닛(M 배).
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { TOON_GRADIENT } from "@/engine/toon";

import { solidQueries } from "../../movement/solidField";
import { audio } from "../../scene/immersion/audio";
import { M, groundY } from "../fishTrap/shared";
import { registerInteractable, showNotice } from "../interaction";
import { inventory, useHeldItems } from "../inventory";
import { LID, LOCK_AT, LOCK_LENGTH, buildBoxBase, buildBoxLid, buildBronzeKey, buildLetter, buildPadlock } from "./lockedBox";

/** 평상 가운데(edits.json 「씬2.평상」 고침 자리) */
const PLATFORM = { x: 74.03, z: 16.65 };
/** 함을 실물보다 조금 크게 — 1인칭에서 자물통이 보이게 */
const BOX_SCALE = 1.5;
const INSERT_SECONDS = 0.8;
const TURN_SECONDS = 0.5;
const DROP_SECONDS = 0.6;
const OPEN_SECONDS = 1.1;

type Phase = "none" | "placed" | "unlocking" | "open";

function createRig() {
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT });
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
  const letter = new THREE.Mesh(buildLetter(), material);
  root.add(letter);
  // 꽂을 열쇠 — 끝이 −x(자물통 쪽)를 보게 돌려 둔다
  const key = new THREE.Mesh(buildBronzeKey().translate(0, -0.006, 0), material);
  key.rotation.y = Math.PI;
  key.visible = false;
  root.add(key);
  root.scale.setScalar(BOX_SCALE * M);
  return { root, lidPivot, lock, key, letter, lockTarget: new THREE.Vector3(), platformTarget: new THREE.Vector3() };
}

export default function BoxOpening() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const rig = useMemo(() => createRig(), []);
  const phase = useRef<Phase>("none");
  const startedAt = useRef(0);
  const told = useRef({ hint: false, unlocked: false, opened: false });
  const held = useHeldItems();

  useEffect(() => {
    scene.add(rig.root);
    return () => {
      scene.remove(rig.root);
    };
  }, [scene, rig]);

  // 열쇠와 함이 둘 다 손에 들어오면 한 번 일러 준다
  useEffect(() => {
    const kinds = new Set(held.map((item) => item.kind));
    if (!told.current.hint && kinds.has("bronzeKey") && kinds.has("letterBox") && phase.current === "none") {
      told.current.hint = true;
      showNotice("청동 열쇠와 아랑사의 함 — 평상에 함을 올려놓고 자물통을 열어 보자.", 5);
    }
  }, [held]);

  useEffect(() => {
    const hasBox = () => inventory.has("letterBox") || inventory.hand()?.kind === "letterBox";
    const removePlatform = registerInteractable({
      id: "ridge-platform",
      position: rig.platformTarget,
      label: "평상에 함 올려놓기",
      radius: 0.9 * M,
      reach: 2.6 * M,
      enabled: () => phase.current === "none" && hasBox(),
      handLabel: (kind) => (kind === "letterBox" && phase.current === "none" ? "평상에 함 올려놓기" : null),
      receive: () => {
        // 함 앞(자물통)이 플레이어 쪽을 보게
        const ground = groundY(PLATFORM.x, PLATFORM.z);
        const deck = solidQueries.current?.supportAt(PLATFORM.x, PLATFORM.z, ground + 1.2) ?? -Infinity;
        const top = deck > ground ? deck : ground + 0.35;
        rig.root.position.set(PLATFORM.x * M, top * M, PLATFORM.z * M);
        rig.root.rotation.y = Math.atan2(camera.position.x - rig.root.position.x, camera.position.z - rig.root.position.z);
        rig.root.visible = true;
        phase.current = "placed";
        audio.play("똑");
        showNotice("평상 위에 함을 올려놓았다. 자물통 오른쪽 끝에 열쇠 구멍이 있다.", 4);
      },
      use: () => showNotice("평상 — 무언가 올려놓기 좋은 높이다.", 2.5),
    });
    const removeLock = registerInteractable({
      id: "ridge-box-lock",
      position: rig.lockTarget,
      label: "자물통",
      radius: 0.4 * M,
      reach: 2.4 * M,
      enabled: () => phase.current === "placed",
      handLabel: (kind) => (kind === "bronzeKey" ? "열쇠로 자물통 열기" : null),
      receive: () => {
        phase.current = "unlocking";
        startedAt.current = performance.now() / 1000;
        rig.key.visible = true;
        audio.play("똑");
      },
      use: () => showNotice("청동 자물통이 단단히 채워져 있다. 맞는 열쇠가 있어야 한다.", 3),
    });
    return () => {
      removePlatform();
      removeLock();
    };
  }, [rig, camera]);

  useFrame(() => {
    // 겨눌 자리 — 평상 가운데 · 자물통
    const ground = groundY(PLATFORM.x, PLATFORM.z);
    rig.platformTarget.set(PLATFORM.x * M, (ground + 0.5) * M, PLATFORM.z * M);
    rig.root.updateMatrixWorld(true);
    rig.lockTarget.copy(LOCK_AT).applyMatrix4(rig.root.matrixWorld);
    if (phase.current !== "unlocking") return;

    const t = performance.now() / 1000 - startedAt.current;
    const lockEnd = LOCK_AT.x + LOCK_LENGTH / 2;
    // ① 열쇠가 구멍으로 들어간다
    const insert = THREE.MathUtils.smootherstep(t, 0, INSERT_SECONDS);
    rig.key.position.set(lockEnd + 0.16 - insert * 0.1, LOCK_AT.y, LOCK_AT.z);
    // ② 돌린다 — 철컥
    const turnStart = INSERT_SECONDS;
    const turn = THREE.MathUtils.smootherstep(t, turnStart, turnStart + TURN_SECONDS);
    rig.key.rotation.set(turn * (Math.PI / 2), Math.PI, 0);
    if (turn >= 1 && !told.current.unlocked) {
      told.current.unlocked = true;
      audio.play("단서");
      showNotice("철컥 — 자물통이 풀렸다.", 2.5);
    }
    // ③ 자물통이 빠져 평상에 떨어진다(열쇠도 함께)
    const dropStart = turnStart + TURN_SECONDS + 0.2;
    const drop = THREE.MathUtils.clamp((t - dropStart) / DROP_SECONDS, 0, 1);
    if (drop > 0) {
      const slide = Math.min(1, drop * 2) * 0.05;
      const fall = Math.max(0, drop - 0.4) / 0.6;
      rig.lock.position.set(LOCK_AT.x + slide, LOCK_AT.y - fall * fall * LOCK_AT.y, LOCK_AT.z + 0.02 + fall * 0.04);
      rig.lock.rotation.z = fall * 0.6;
      rig.key.position.set(lockEnd + 0.06 + slide, LOCK_AT.y - fall * fall * LOCK_AT.y, LOCK_AT.z + 0.02 + fall * 0.04);
    }
    // ④ 뚜껑이 열린다
    const openStart = dropStart + DROP_SECONDS + 0.2;
    const open = THREE.MathUtils.smootherstep(t, openStart, openStart + OPEN_SECONDS);
    rig.lidPivot.rotation.x = -open * 1.9;
    rig.letter.position.y = open * 0.012;
    if (open >= 1) {
      phase.current = "open";
      if (!told.current.opened) {
        told.current.opened = true;
        audio.play("징");
        showNotice("뚜껑을 열자 접힌 편지 한 장이 보인다 — 아랑사가 아비사에게 쓴 것이다.", 6);
      }
    }
  });

  return null;
}
