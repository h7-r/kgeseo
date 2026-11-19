// 인사(키패드 1~6 · 인사창) — 대사와 동작을 한 짝으로. 서버는 번호(1~6)만 주고받고, 화면이 이 표에서 찾는다.
// 동작은 치비가 쓰는 Quaternius 범용 애니메이션(public/models/vendor/, 라이선스 파일 동봉) 이름이다.
// steps 를 차례로 튼다 — 서 있을 때만, 움직이면 끊긴다(naju01/src/avatar/useMotionPlayer.ts 우선순위: 맞기 > 펀치 > 인사).
import type { AvatarAction } from "@/engine/avatarLink";
import { GESTURE_BASE_MOTION, GESTURES, QUATERNIUS_PREFIX } from "@/naju";

import { gesturePlaySeconds, TEAM_CLIP_MOTIONS, teamMotionOf } from "../../../lobby/src/npc/teamGestures";

import type { VoiceKind } from "./voices";

export interface Emote {
  text: string;
  steps: AvatarAction["steps"];
  /** 동작과 같이 나오는 목소리(음성 모음집 — voices.ts, 2026-11-07) */
  voice: VoiceKind;
}

/** 절차 손짓 한 단계(그 성별 대기 위에 덮어쓴다 — naju01/src/avatar/gestures.ts) */
const gesture = (name: string): AvatarAction["steps"] => [
  { motion: GESTURE_BASE_MOTION, seconds: GESTURES[name]?.seconds ?? 1.5, gesture: name },
];

// 2026-11-07 미르가 고르기 화면(emote-gallery.html · gesture-gallery.html)에서 보고 고른 여섯.
// 문구는 목소리(음성 모음집)와 맞췄다 — 「안녕」→「안녕!」, 「신난다~」→「신난다!」(미르 11/7).
export const EMOTES: readonly Emote[] = [
  // 손바닥을 보이며 어깨 높이로 들고 까딱(「손 내밀기」에서 바꿈 — 미르 11/7 「안녕은 손바닥 보이며 흔들어야」)
  { text: "안녕!", steps: gesture("waveSmall"), voice: "greet" },
  // 좌우로 들썩(1초 × 3)
  { text: "신난다!", steps: [{ motion: "Dance_Loop", seconds: 3 }], voice: "joy" },
  // 허리 높이로 손을 뻗어 줍는 시늉
  { text: "비켜!", steps: [{ motion: "PickUp_Table", seconds: 0.9 }], voice: "move" },
  // 고개·허리 살짝 숙이기
  { text: "미안해.", steps: gesture("sorryBow"), voice: "sorry" },
  // 가슴(심장 쪽)에 손을 얹고 고개 끄덕
  { text: "고마워!", steps: gesture("thanksChest"), voice: "thanks" },
  // 고개 두 번 끄덕
  { text: "알았어.", steps: gesture("okNod"), voice: "ok" },
];

/** 맞았을 때 — 가슴을 맞은 듯 상체·고개가 뒤로 젖혀졌다 돌아온다(0.33초 클립을 0.55배속). 키패드 인사가 아니다 */
export const HIT_REACTION: AvatarAction["steps"] = [{ motion: "Hit_Chest", seconds: 0.6, speed: 0.55 }];
/** 맞은 사람 머리 위에 잠깐 뜨는 말 */
export const HIT_LINE = "윽!";
export const HIT_LINE_MS = 1200;

/**
 * 주먹 목소리 — 「죽어라!」(음성 모음집의 위협 대사). **베타 테스트 이벤트**(미르 11/7: 「베타 때는 이벤트로 넣어라」 —
 * 박람회는 로비를 안 쓴다). 빌드 값 VITE_LOBBY_EVENT_PUNCH_VOICE=0 이면 끈다(이벤트 끝). 매번이면 시끄러워 사람마다
 * PUNCH_VOICE_EVERY_MS 에 한 번(연타의 첫 주먹).
 */
export const PUNCH_VOICE_EVENT = import.meta.env.VITE_LOBBY_EVENT_PUNCH_VOICE !== "0";
export const PUNCH_VOICE: VoiceKind | null = PUNCH_VOICE_EVENT ? "threat" : null;
export const PUNCH_VOICE_EVERY_MS = 4000;
/** 점프 목소리(「헛!」) — 내 점프만(남의 점프 동작은 아직 안 보인다), 이 간격에 한 번 */
export const JUMP_VOICE_EVERY_MS = 1200;

/** 서버 주먹 이름 → 클립 이름(본편 usePunch 와 같은 클립) */
export const PUNCH_CLIPS = { jab: "Punch_Jab", cross: "Punch_Cross" } as const;

// 팀 NPC 대사 동작(꾸미기 창에서 고른 클립, 검토 27회차) → 트는 단계. 클립 이름은 Tripo 가 먼저 잡으므로(chibiClipLibrary
// clipFor) Tripo 와 이름이 겹치는 Quaternius 클립(대기 · 걷기 · 조깅)만 접두사를 붙인다 — 나머지는 인사 · 게임이 쓰는 이름과
// 같게 둬야 같은 리타깃 캐시 · 반복 판정(이름 끝 _Loop · A_TPose · Sword_Idle) · 발바닥 명단을 그대로 탄다.
// 속도 1 을 적어 두면 걷기류 클립의 「실제 이동 속도에 맞춘 재생 속도」를 건너뛴다(ChibiGameAvatar — 제자리라 0.45배로 느려진다).
const TRIPO_CLIPS = new Set(
  TEAM_CLIP_MOTIONS.filter((motion) => motion.source === "tripo").map((motion) => motion.clip),
);

export function teamMotionSteps(id: unknown): AvatarAction["steps"] | null {
  if (typeof id !== "string") return null;
  const motion = teamMotionOf(id);
  if (!motion?.clip || motion.source === "emote") return null;
  const name =
    motion.source === "q" && TRIPO_CLIPS.has(motion.clip) ? `${QUATERNIUS_PREFIX}${motion.clip}` : motion.clip;
  return [{ motion: name, seconds: gesturePlaySeconds(id), speed: 1 }];
}
