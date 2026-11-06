// 인사 6개(키패드 1~6 · 인사창) — 대사와 동작을 한 짝으로. 서버는 번호(1~6)만 주고받고, 화면이 이 표에서 찾는다.
// 동작은 치비가 쓰는 Quaternius 범용 애니메이션(public/models/vendor/, 라이선스 파일 동봉) 이름이다.
// steps 를 차례로 튼다 — 서 있을 때만, 움직이면 끊긴다(naju01/src/avatar/useMotionPlayer.ts 우선순위: 맞기 > 펀치 > 인사).
// 🟡 고른 짝은 치비에서 재생해 본 결과로 바꿀 수 있다(아바타 에이전트 확인 중).
import type { AvatarAction } from "@/engine/avatarLink";

export interface Emote {
  text: string;
  steps: AvatarAction["steps"];
}

export const EMOTES: readonly Emote[] = [
  { text: "안녕하세요!", steps: [{ motion: "Idle_Talking_Loop", seconds: 2.4 }] },
  { text: "반가워요!", steps: [{ motion: "Interact", seconds: 1.4 }] },
  {
    text: "화이팅!",
    steps: [
      { motion: "Jump_Start", seconds: 0.25 },
      { motion: "Jump_Land", seconds: 0.45 },
    ],
  },
  { text: "나주로 출동!", steps: [{ motion: "Spell_Simple_Shoot", seconds: 1.1 }] },
  { text: "신난다~", steps: [{ motion: "Dance_Loop", seconds: 3 }] },
  { text: "잠깐 쉬어 갈게요", steps: [{ motion: "Idle_Talking_Loop", seconds: 2 }] },
];

/** 맞았을 때 — 고개가 뒤로 젖혀지며 아파하는 동작 */
export const HIT_REACTION: AvatarAction["steps"] = [{ motion: "Hit_Head", seconds: 0.9 }];

/** 서버 주먹 이름 → 클립 이름(본편 usePunch 와 같은 클립) */
export const PUNCH_CLIPS = { jab: "Punch_Jab", cross: "Punch_Cross" } as const;
