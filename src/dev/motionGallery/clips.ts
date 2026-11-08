// 치비가 쓸 수 있는 동작 전부 — Tripo(public/models/tripo-motions*.glb)와 Quaternius 범용 애니메이션(public/models/vendor/).
// 목록 · 길이(GLB 에서 잰 초) · 이름표는 팀 NPC 대사 동작 목록(lobby/src/npc/teamGestures.ts)에서 가져온다 — 꾸미기 창에서
// 고르는 이름과 이 화면에서 보는 이름이 같게(검토 27회차). 같은 이름(대기 · 걷기 · 조깅)은 출처에 따라 다른 클립이다 —
// source "tripo" 는 Tripo, "sidekick" 은 Quaternius.
import { TEAM_CLIP_MOTIONS } from "../../../lobby/src/npc/teamGestures";

export interface GalleryClip {
  id: string;
  name: string;
  label: string;
  source: "tripo" | "sidekick";
  seconds: number;
  loop: boolean;
}

export const CLIPS: readonly GalleryClip[] = TEAM_CLIP_MOTIONS.map((motion) => ({
  id: motion.id,
  name: motion.clip ?? "",
  label: motion.label,
  source: motion.source === "tripo" ? "tripo" : "sidekick",
  seconds: motion.seconds,
  loop: motion.loop,
}));

/** 대기 자세 후보 — 남자 대기를 고르는 첫 화면. 앞의 둘이 Tripo(지금 쓰는 것·팔짱), 나머지는 Quaternius 의 서 있는 반복 동작 */
export const IDLE_CANDIDATES: readonly string[] = [
  "tripo:Idle_Loop",
  "tripo:Idle_Fold_Loop",
  "q:Idle_Loop",
  "q:Idle_Talking_Loop",
  "q:Idle_Torch_Loop",
  "q:Spell_Simple_Idle_Loop",
  "q:Sword_Idle",
  "q:Pistol_Idle_Loop",
  "q:Crouch_Idle_Loop",
];
