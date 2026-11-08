// 팀 NPC 가 대사를 칠 때 고를 수 있는 동작(미르 11/8 「가용한 애니메이션 목록 다 보여주면 돼」, 검토 27회차).
// 꾸미기 창이 대사마다 하나를 고르고(lineGestures), 로비 서버가 그 ID 를 방송하고, 화면이 클립으로 바꿔 튼다.
// 로비 서버 · 개발 서버 저장 창구 · 화면이 같이 쓰므로 아무것도 가져오지 않는다.
//   · emote:1~6 — 키패드 인사 동작(src/dev/lobbyPreview/emotes.ts EMOTES 와 같은 순서, 목소리 없이 동작만)
//   · tripo:이름 · q:이름 — 치비가 틀 수 있는 클립 전부(동작 보기 화면 src/dev/motionGallery/clips.ts 와 같은 목록 · 길이 · 이름표)
// 한 번 쓴 ID 는 바꾸지 않는다(저장 파일에 남는다).

export interface TeamMotion {
  id: string;
  label: string;
  /** 클립 이름(GLB 안 이름) — emote 는 비운다 */
  clip?: string;
  source: "emote" | "tripo" | "q";
  /** 한 번 트는 클립의 길이(초). 반복 클립은 LOOP_PLAY_SECONDS 만큼 */
  seconds: number;
  loop: boolean;
}

/** 반복 클립(춤 · 말하며 대기 …)을 트는 시간 — 인사 「신난다」(춤 3초)와 같다 */
export const LOOP_PLAY_SECONDS = 3;

/** 키패드 인사 6종 — 이름표는 대사 · 동작 */
export const TEAM_EMOTE_MOTIONS: readonly TeamMotion[] = [
  { id: "emote:1", label: "안녕! · 손바닥 보이며 까딱", source: "emote", seconds: 1.6, loop: false },
  { id: "emote:2", label: "신난다! · 좌우로 들썩(춤)", source: "emote", seconds: 3, loop: false },
  { id: "emote:3", label: "비켜! · 줍는 시늉", source: "emote", seconds: 0.9, loop: false },
  { id: "emote:4", label: "미안해. · 고개 · 허리 숙이기", source: "emote", seconds: 1.9, loop: false },
  { id: "emote:5", label: "고마워! · 가슴에 손", source: "emote", seconds: 2, loop: false },
  { id: "emote:6", label: "알았어. · 두 번 끄덕", source: "emote", seconds: 1.3, loop: false },
];

const clip = (source: "tripo" | "q", name: string, label: string, seconds: number, loop: boolean): TeamMotion => ({
  id: `${source}:${name}`,
  label,
  clip: name,
  source,
  seconds,
  loop,
});

/** 치비 클립 전부 — Tripo 4 · Quaternius 43 */
export const TEAM_CLIP_MOTIONS: readonly TeamMotion[] = [
  clip("tripo", "Walk_Loop", "걷기", 2.33, true),
  clip("tripo", "Idle_Loop", "대기 · 허리에 손", 6, true),
  clip("tripo", "Jog_Fwd_Loop", "조깅(달리기)", 1.25, true),
  clip("tripo", "Idle_Fold_Loop", "대기 · 팔짱", 11.25, true),
  clip("q", "A_TPose", "A/T 기본 포즈", 2.5, true),
  clip("q", "Crouch_Fwd_Loop", "앉아 걷기", 2, true),
  clip("q", "Crouch_Idle_Loop", "쪼그려 앉은 대기", 2.93, true),
  clip("q", "Dance_Loop", "춤", 1, true),
  clip("q", "Death01", "사망", 2.4, false),
  clip("q", "Driving_Loop", "운전", 1.67, true),
  clip("q", "Fixing_Kneeling", "무릎 꿇고 수리", 5.2, false),
  clip("q", "Hit_Chest", "가슴 피격", 0.33, false),
  clip("q", "Hit_Head", "머리 피격", 0.43, false),
  clip("q", "Idle_Loop", "대기 · Quaternius 기본", 2.5, true),
  clip("q", "Idle_Talking_Loop", "말하며 대기", 2.93, true),
  clip("q", "Idle_Torch_Loop", "횃불 대기", 1.27, true),
  clip("q", "Interact", "상호작용(손 내밀기)", 2, false),
  clip("q", "Jog_Fwd_Loop", "조깅 · Quaternius", 0.93, true),
  clip("q", "Jump_Land", "점프 착지", 1.27, false),
  clip("q", "Jump_Loop", "점프 공중", 2.5, true),
  clip("q", "Jump_Start", "점프 시작", 1.33, false),
  clip("q", "PickUp_Table", "테이블 물건 줍기", 0.83, false),
  clip("q", "Pistol_Aim_Down", "권총 아래 조준", 0.17, false),
  clip("q", "Pistol_Aim_Neutral", "권총 정면 조준", 0.17, false),
  clip("q", "Pistol_Aim_Up", "권총 위 조준", 0.17, false),
  clip("q", "Pistol_Idle_Loop", "권총 대기", 1.67, true),
  clip("q", "Pistol_Reload", "권총 재장전", 1.67, false),
  clip("q", "Pistol_Shoot", "권총 사격", 0.63, false),
  clip("q", "Punch_Cross", "크로스 펀치", 1, false),
  clip("q", "Punch_Jab", "잽", 0.87, false),
  clip("q", "Push_Loop", "밀기", 2.67, true),
  clip("q", "Roll", "구르기", 1.47, false),
  clip("q", "Sitting_Enter", "앉기 시작", 1.3, false),
  clip("q", "Sitting_Exit", "일어나기", 1.03, false),
  clip("q", "Sitting_Idle_Loop", "앉은 대기", 1.67, true),
  clip("q", "Sitting_Talking_Loop", "앉아서 말하기", 2.93, true),
  clip("q", "Spell_Simple_Enter", "마법 자세 시작", 0.53, false),
  clip("q", "Spell_Simple_Exit", "마법 자세 해제", 0.43, false),
  clip("q", "Spell_Simple_Idle_Loop", "마법 대기", 2.1, true),
  clip("q", "Spell_Simple_Shoot", "마법 발사", 0.5, false),
  clip("q", "Sprint_Loop", "전력 질주", 0.67, true),
  clip("q", "Swim_Fwd_Loop", "전진 수영", 1.33, true),
  clip("q", "Swim_Idle_Loop", "제자리 수영", 3.33, true),
  clip("q", "Sword_Attack", "검 공격", 1.53, false),
  clip("q", "Sword_Idle", "검 대기", 1.67, true),
  clip("q", "Walk_Formal_Loop", "정중한 걷기", 1.33, true),
  clip("q", "Walk_Loop", "걷기 · Quaternius", 1.33, true),
];

const BY_ID = new Map([...TEAM_EMOTE_MOTIONS, ...TEAM_CLIP_MOTIONS].map((motion) => [motion.id, motion]));

export const teamMotionOf = (id: string): TeamMotion | undefined => BY_ID.get(id);
export const isTeamGestureId = (id: unknown): id is string => typeof id === "string" && BY_ID.has(id);

/** 그 동작을 트는 시간(초) — 반복 클립은 LOOP_PLAY_SECONDS */
export function gesturePlaySeconds(id: string): number {
  const motion = BY_ID.get(id);
  if (!motion) return 0;
  return motion.loop ? LOOP_PLAY_SECONDS : motion.seconds;
}

/** 인사 동작이면 그 번호(1~6), 아니면 null */
export function emoteNumberOf(id: string): number | null {
  const match = /^emote:([1-6])$/.exec(id);
  return match ? Number(match[1]) : null;
}
