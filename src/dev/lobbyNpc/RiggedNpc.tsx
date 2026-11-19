// 뼈대를 붙인 상주쌤 — 대기 중엔 GLB 안의 대기 동작(1번 짝다리 Idle_Contrapposto · 2·3번 Idle_Stand), 대사를 말할 때 꾸미기 창에서 고른 동작을 튼다
// (미르 11/9 「애니메이션 연결」). 뼈대는 flux-test/npc_1107/rig_resident.py 가 붙인 로비 치비와 같은 이름(23개).
//   · 로비 클립(Quaternius · Tripo)은 로비 코드(createClipLibrary)로 리타게팅한다. 리타게팅은 「묶은 자세」(skeleton.pose())를
//     기준으로 삼는데 로비 클립은 T자 기준이라, 팔을 T자로 든 복제 뼈대를 만들어 그 자세를 묶은 자세로 바꿔 넘긴다.
//     쌤 메시는 팔 내린 자세 그대로 묶여 있고(펴지 않아 어깨가 안 망가진다), 만든 클립(뼈 로컬 회전)을 그대로 튼다.
//   · 「안녕 · 미안해 · 고마워 · 알았어」(키패드 인사 1·4·5·6)는 클립이 아니라 치비 전용 손짓 코드라, 여기서는 고개 · 허리만
//     직접 움직인다(끄덕 · 숙이기). 「안녕」은 「말하며 대기」 클립으로 대신한다. 2·3 은 인사와 같은 클립(춤 · 줍기).
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { createClipLibrary, loadTripoSources } from "../../../naju01/src/avatar/chibiClipLibrary";
import { DEFAULT_CORRECTION, TRIPO_CORRECTION } from "../../../naju01/src/avatar/motionCorrection";
import { MOTION_LIBRARY_URL, TRIPO_MOTION_URLS } from "../../../naju01/src/avatar/preparedBody";
import { findFirstSkinnedMesh } from "../../../naju01/src/avatar/rig";
import { teamMotionOf } from "../../../lobby/src/npc/teamGestures";
import { teamMotionSteps } from "../lobbyPreview/emotes";

import { computeNpcFace } from "./npcFace";

/** 대기 동작 — 1번은 짝다리(Idle_Contrapposto), 2·3번은 차렷 그대로(Idle_Stand) — rig_resident.py --idle */
const isIdleClip = (clip: THREE.AnimationClip) => clip.name.startsWith("Idle_");
const FADE = 0.25;

type Procedural = "nod" | "bow";
interface GesturePlan {
  clip: string | null;
  proc: Procedural | null;
  seconds: number;
  /** 반복 클립인가 — 이름(_Loop)이 아니라 동작 목록 값으로(Sword_Idle · A_TPose 는 이름에 _Loop 가 없다, 28회차 Codex) */
  loop: boolean;
}
/** 키패드 인사 → 쌤용 대신 동작 */
const EMOTE_STAND_IN: Record<string, GesturePlan> = {
  "emote:1": { clip: "Quaternius:Idle_Talking_Loop", proc: null, seconds: 2, loop: true },
  "emote:2": { clip: "Dance_Loop", proc: null, seconds: 3, loop: true },
  "emote:3": { clip: "PickUp_Table", proc: null, seconds: 0.9, loop: false },
  "emote:4": { clip: null, proc: "bow", seconds: 1.9, loop: false },
  "emote:5": { clip: null, proc: "nod", seconds: 2, loop: false },
  "emote:6": { clip: null, proc: "nod", seconds: 1.3, loop: false },
};
/**
 * 큰 동작은 폭을 줄여 튼다(뼈마다 쉬는 자세 쪽으로 이만큼만) — 쌤 메시는 재킷 · 바지가 한 겹 껍데기라 다리를 크게 벌리거나
 * 상체를 크게 비틀면 가랑이 · 재킷 밑단이 찢어지듯 늘고 안쪽 면이 드러났다(11/10 미르 「검 휘두를 때 옷이 뒤틀림」).
 * 동작 모양은 그대로, 크기만 줄인다. 1 = 원래대로.
 */
const BIG_MOTION_AMOUNT: Record<string, number> = {
  Sword_Attack: 0.6,
  Punch_Cross: 0.6,
  Punch_Jab: 0.6,
  Roll: 0.5,
  Death01: 0.5,
};
const amountOf = (clipName: string) => BIG_MOTION_AMOUNT[clipName.replace(/^Quaternius:/, "")] ?? 1;

/** 고른 동작이 없을 때(「무작위 인사」 · 모르는 ID) — 고개 끄덕 */
const FALLBACK: GesturePlan = { clip: null, proc: "nod", seconds: 1.3, loop: false };

export function gesturePlanOf(id: string): GesturePlan {
  const standIn = EMOTE_STAND_IN[id];
  if (standIn) return standIn;
  const step = teamMotionSteps(id)?.[0];
  return step ? { clip: step.motion, proc: null, seconds: step.seconds ?? 2, loop: teamMotionOf(id)?.loop ?? false } : FALLBACK;
}

/** 팔을 T자로 든 복제 뼈대 — 그 자세를 「묶은 자세」로 바꿔 리타게팅 기준으로 쓴다 */
function makeTPoseRig(scene: THREE.Object3D) {
  const rig = cloneSkinned(scene);
  const skin = findFirstSkinnedMesh(rig);
  if (!skin) return null;
  // 복제 뼈대는 원본과 boneInverses 배열을 같이 쓴다(Skeleton.clone) — 그대로 다시 계산하면 화면의 쌤 묶음까지 T 로 바뀐다
  skin.skeleton.boneInverses = [];
  rig.updateMatrixWorld(true);
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  for (const [side, sx] of [["l", 1], ["r", -1]] as const) {
    const chain = ["upperarm", "lowerarm", "hand"].map((n) => skin.skeleton.getBoneByName(`${n}_${side}`));
    if (chain.some((b) => !b)) continue;
    const want = new THREE.Vector3(sx, 0, 0); // 캐릭터 왼쪽 = +X(glTF, 얼굴 +Z)
    // 마디마다 「다음 관절로 가는 방향」을 수평 바깥으로 — 위 마디부터(아래 마디는 위 마디를 따라 움직인다)
    chain.forEach((b, i) => {
      const bone = b!;
      const next = chain[i + 1];
      rig.updateMatrixWorld(true);
      const from = wp(bone);
      const dir = next ? wp(next).sub(from) : from.clone().sub(wp(bone.parent!));
      const turn = new THREE.Quaternion().setFromUnitVectors(dir.normalize(), want);
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(turn.multiply(world)));
    });
  }
  rig.updateMatrixWorld(true);
  skin.skeleton.calculateInverses(); // 이 T 자세가 이 복제본의 「묶은 자세」 — skeleton.pose() 가 여기로 돌아온다
  return { rig, skin };
}

export interface RiggedSay {
  /** 몇 번째 말하기인지(바뀌면 동작 시작) */
  serial: number;
  /** 그 대사의 동작 ID(teamGestures), "" = 무작위 인사 */
  gesture: string;
}

/** 뼈대 쌤 모델 — root · 원래 키 · 발 높이(묶은 자세)를 돌려준다(ResidentNpcs 가 크기 · 자리를 맞춘다) */
export function useRiggedNpc({ url, headFrac, faceBack, say }: { url: string; headFrac: number; faceBack: number; say: RiggedSay | null }) {
  const gltf = useGLTF(url);
  const motion = useGLTF(MOTION_LIBRARY_URL);
  const tripoGltfs = useGLTF(TRIPO_MOTION_URLS);

  const model = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    const skin = findFirstSkinnedMesh(root)!;
    // 얼굴 가중치 · 툰 구 중심(굳은 모델과 같은 계산) — 원본 지오메트리를 건드리지 않게 복제해 단다
    skin.geometry = skin.geometry.clone();
    const face = computeNpcFace(skin.geometry, headFrac, faceBack);
    skin.geometry.setAttribute("_face", new THREE.BufferAttribute(face.face, 1));
    skin.userData.npcHeadCentre = face.sphereCentre;
    root.traverse((o) => {
      // TRELLIS 메시는 면 방향이 군데군데 뒤집혀 있다 — 양면
      if (o instanceof THREE.Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.side = THREE.DoubleSide));
      o.frustumCulled = false; // 뼈로 움직이면 묶은 자세 경계 상자를 벗어난다
    });
    // 크기 · 발 높이는 묶은 자세(차렷) 기준 — 짝다리 대기는 디딤발을 같은 바닥에 굽는다(rig_resident.py)
    const rawHeight = face.height;
    const footY = skin.geometry.boundingBox!.min.y;

    const mixer = new THREE.AnimationMixer(skin);
    const idleClip = gltf.animations.find(isIdleClip) ?? null;
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const t = makeTPoseRig(gltf.scene);
    const source = cloneSkinned(motion.scene);
    const sourceSkin = findFirstSkinnedMesh(source);
    const library =
      t && sourceSkin
        ? createClipLibrary({
            retargetModel: t.rig,
            retargetSkin: t.skin,
            source,
            sourceSkin,
            motionGltf: motion,
            tripo: loadTripoSources(tripoGltfs),
            // 치비 체형 보정은 끈다(그 몸에 맞춘 값)
            correction: { ...DEFAULT_CORRECTION, enabled: false },
            tripoValues: { ...TRIPO_CORRECTION, enabled: false },
            outerKey: `resident:${url}`,
          })
        : null;
    // 발 접지 — 로비 클립은 회전만 옮겨 골반 높이가 그대로라 무릎을 굽히는 동작(검 휘두르기 · 앉기)에서 발이 떴다.
    // 발 · 발가락 뼈 중 가장 낮은 것이 묶은 자세 높이에 오도록 root 뼈를 위아래로 옮긴다(뼈대 공간 = root 의 부모 공간).
    const rootBone = skin.skeleton.getBoneByName("root") ?? null;
    const feet = ["foot_l", "foot_r", "ball_l", "ball_r"]
      .map((n) => skin.skeleton.getBoneByName(n))
      .filter((b): b is THREE.Bone => !!b);
    root.updateMatrixWorld(true);
    const lowestFoot = () => {
      const space = rootBone?.parent;
      if (!space) return 0;
      const v = new THREE.Vector3();
      return Math.min(...feet.map((b) => space.worldToLocal(b.getWorldPosition(v)).y));
    };
    const restFoot = lowestFoot();
    // 폭 줄인 클립 — 뼈 로컬 회전을 묶은 자세(차렷 · 팔 내림) 쪽으로 slerp. 트랙 이름은 `.bones[x].quaternion` 또는 `x.quaternion`
    const restLocal = new Map(skin.skeleton.bones.map((b) => [b.name, b.quaternion.clone()]));
    const damped = new Map<string, THREE.AnimationClip>();
    const dampClip = (clip: THREE.AnimationClip, amount: number) => {
      const key = `${clip.name}|${amount}`;
      const hit = damped.get(key);
      if (hit) return hit;
      const out = clip.clone();
      const q = new THREE.Quaternion();
      out.tracks.forEach((track) => {
        const m = /^(?:\.bones\[([^\]]+)\]|([^.]+))\.quaternion$/.exec(track.name);
        const rest = m ? restLocal.get(m[1] ?? m[2] ?? "") : undefined;
        if (!rest) return;
        const v = track.values;
        for (let i = 0; i < v.length; i += 4) {
          q.fromArray(v, i);
          rest.clone().slerp(q, amount).toArray(v, i);
        }
      });
      damped.set(key, out);
      return out;
    };
    return { root, skin, rawHeight, footY, mixer, idle, library, rootBone, lowestFoot, restFoot, dampClip };
  }, [gltf, motion, tripoGltfs, url, headFrac, faceBack]);

  const playing = useRef<{ action: THREE.AnimationAction | null; proc: Procedural | null; started: number; until: number } | null>(null);
  const clock = useRef(0);
  /**
   * 믹서 뒤에 손댄 값(절차 동작의 고개 · 허리 회전, 접지용 root 높이) — 믹서는 값이 안 바뀌면 다시 쓰지 않아(PropertyMixer)
   * 다음 프레임 믹서 전에 직접 되돌려야 쌓이지 않는다
   */
  const undo = useRef<(() => void)[]>([]);

  // 대기 시작 · 정리 — 정리에서 uncacheRoot 는 하지 않는다: 개발 모드(StrictMode)는 효과를 한 번 껐다 다시 켜는데, 그때 바인딩이
  // 지워지면 메모에 든 대기 동작이 죽은 채로 남아 play() 가 터진다(_cacheIndex). 모델이 바뀌면 믹서째 버려진다.
  useEffect(() => {
    const { mixer, idle } = model;
    // 개발 확인용: 콘솔에서 믹서 · 클립 상태를 본다(배포 빌드에서는 빠진다)
    if (import.meta.env.DEV) ((window as unknown as { __npcRig?: Record<string, unknown> }).__npcRig ??= {})[url] = { model, playing };
    playing.current = null;
    idle?.reset().play();
    return () => {
      mixer.stopAllAction();
      // 쌤마다 복제한 지오메트리(얼굴 가중치를 단 것)의 GPU 버퍼를 내린다 — <primitive> 는 자동으로 해제하지 않아 기차를 오갈 때마다
      // 쌓였다(35회차 Codex). 개발 모드가 효과를 껐다 켜도 다음 그리기에서 다시 올라가니 안전하다. 재질은 applyToon · applyOutline 이 정리
      model.skin.geometry.dispose();
      model.skin.skeleton.dispose(); // 뼈 텍스처(외곽선 껍데기도 같은 뼈대) — 다시 그리면 렌더러가 새로 만든다(36회차)
    };
  }, [model, url]);

  useEffect(() => {
    if (!say) return;
    const { mixer, idle, library } = model;
    const plan = gesturePlanOf(say.gesture);
    const base = plan.clip && library ? library.clipFor(plan.clip) : null;
    const amount = plan.clip ? amountOf(plan.clip) : 1;
    const clip = base && amount < 1 ? model.dampClip(base, amount) : base;
    const prev = playing.current?.action ?? null;
    let action: THREE.AnimationAction | null = null;
    if (clip) {
      action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(plan.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.play();
      const from = prev && prev !== action ? prev : idle;
      if (from) action.crossFadeFrom(from, FADE, false);
    } else if (prev && idle) {
      // 앞 동작이 아직이면 대기로 돌려 놓고 절차 동작을 얹는다
      idle.reset().play();
      idle.crossFadeFrom(prev, FADE, false);
    }
    playing.current = { action, proc: plan.proc, started: clock.current, until: clock.current + plan.seconds };
  }, [say, model]);

  useFrame((_, delta) => {
    const { mixer, idle, skin, root } = model;
    const dt = Math.min(delta, 0.1);
    clock.current += dt;
    undo.current.forEach((fn) => fn());
    undo.current = [];
    const p = playing.current;
    if (p && clock.current >= p.until) {
      // 끝 — 짝다리 대기로 돌아간다
      if (p.action && idle) {
        idle.reset().play();
        idle.crossFadeFrom(p.action, FADE, false);
      }
      playing.current = null;
    }
    mixer.update(dt);
    // 접지 — 동작 비중만큼(대기는 굽을 때 이미 디딤발을 바닥에 맞췄다)
    const { rootBone, lowestFoot, restFoot } = model;
    const gestureWeight = idle ? 1 - idle.getEffectiveWeight() : 1;
    if (rootBone && gestureWeight > 0.001) {
      const before = rootBone.position.y;
      rootBone.position.y += (restFoot - lowestFoot()) * gestureWeight;
      undo.current.push(() => {
        rootBone.position.y = before;
      });
    }
    const cur = playing.current;
    if (!cur?.proc) return;
    // 절차 동작 — 캐릭터 옆축(로컬 +X) 둘레로 앞으로 숙인다
    const t = clock.current - cur.started;
    const len = Math.max(0.1, cur.until - cur.started);
    const env = Math.sin(Math.min(1, t / len) * Math.PI);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const tilt = (name: string, angle: number) => {
      const bone = skin.skeleton.getBoneByName(name);
      if (!bone?.parent || angle === 0) return;
      const before = bone.quaternion.clone();
      undo.current.push(() => bone.quaternion.copy(before));
      const axis = side.clone().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    };
    if (cur.proc === "nod") tilt("head", Math.max(0, Math.sin((t / len) * Math.PI * 4)) * 0.3 * env);
    if (cur.proc === "bow") {
      tilt("spine_02", 0.35 * env);
      tilt("head", 0.25 * env);
    }
  });

  return model;
}
