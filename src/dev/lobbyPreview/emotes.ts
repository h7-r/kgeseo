// 인사(키패드 1~3 · 인사창) — 대사와 동작을 한 짝으로. 서버는 번호(1~3)만 주고받고, 화면이 이 표에서 찾는다.
// 동작은 치비가 쓰는 Quaternius 범용 애니메이션(public/models/vendor/, 라이선스 파일 동봉) 이름이다.
// steps 를 차례로 튼다 — 서 있을 때만, 움직이면 끊긴다(naju01/src/avatar/useMotionPlayer.ts 우선순위: 맞기 > 펀치 > 인사).
import type { AvatarAction } from "@/engine/avatarLink";

import type { VoiceKind } from "./voices";

export interface Emote {
  text: string;
  steps: AvatarAction["steps"];
  /** 동작과 같이 나오는 목소리(음성 모음집 — voices.ts, 2026-11-07) */
  voice: VoiceKind;
}

// 2026-11-07 미르가 고르기 화면(emote-gallery.html)에서 보고 고른 셋. 4~6 은 비워 둔다.
export const EMOTES: readonly Emote[] = [
  // 한 팔을 앞으로 내밀었다 거둠
  { text: "안녕", steps: [{ motion: "Interact", seconds: 1.8 }], voice: "greet" },
  // 좌우로 들썩(1초 × 3)
  { text: "신난다~", steps: [{ motion: "Dance_Loop", seconds: 3 }], voice: "joy" },
  // 허리 높이로 손을 뻗어 줍는 시늉
  { text: "비켜!", steps: [{ motion: "PickUp_Table", seconds: 0.9 }], voice: "move" },
];

/** 맞았을 때 — 가슴을 맞은 듯 상체·고개가 뒤로 젖혀졌다 돌아온다(0.33초 클립을 0.55배속). 키패드 인사가 아니다 */
export const HIT_REACTION: AvatarAction["steps"] = [{ motion: "Hit_Chest", seconds: 0.6, speed: 0.55 }];
/** 맞은 사람 머리 위에 잠깐 뜨는 말 */
export const HIT_LINE = "윽!";
export const HIT_LINE_MS = 1200;

/**
 * 주먹 목소리 — 「죽어라!」(음성 모음집의 위협 대사). 매번이면 시끄러워 사람마다 이 간격에 한 번(연타의 첫 주먹).
 * Codex(검토 15회차)는 박람회 관객까지 생각하면 위협성이 강하다고 비추천 — 미르 판단. 「헛!」 으로 바꾸려면 "jump", 끄려면 null.
 */
export const PUNCH_VOICE: VoiceKind | null = "threat";
export const PUNCH_VOICE_EVERY_MS = 4000;
/** 점프 목소리(「헛!」) — 내 점프만(남의 점프 동작은 아직 안 보인다), 이 간격에 한 번 */
export const JUMP_VOICE_EVERY_MS = 1200;

/** 서버 주먹 이름 → 클립 이름(본편 usePunch 와 같은 클립) */
export const PUNCH_CLIPS = { jab: "Punch_Jab", cross: "Punch_Cross" } as const;
