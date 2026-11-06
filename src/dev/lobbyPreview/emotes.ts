// 인사 6개(키패드 1~6 · 인사창) — 대사와 동작을 한 짝으로. 서버는 번호(1~6)만 주고받고, 화면이 이 표에서 찾는다.
// 동작은 치비가 쓰는 Quaternius 범용 애니메이션(public/models/vendor/, 라이선스 파일 동봉) 이름이다.
// steps 를 차례로 튼다 — 서 있을 때만, 움직이면 끊긴다(naju01/src/avatar/useMotionPlayer.ts 우선순위: 맞기 > 펀치 > 인사).
import type { AvatarAction } from "@/engine/avatarLink";
import { UNITS_PER_METER } from "@/engine/movement/constants";

export interface Emote {
  text: string;
  steps: AvatarAction["steps"];
}

// 고른 짝(2026-11-06 아바타 에이전트가 치비 남녀에서 재생해 본 결과, 그림: scratchpad/avatar-fix/renders/emote-*.png).
// 모든 클립이 제자리다(골반 수평 이동 없음). 끝이 있는 클립은 마지막 자세에 멈추므로 쓸 구간까지만 튼다.
export const EMOTES: readonly Emote[] = [
  // 가슴 앞 손짓(한 바퀴)
  { text: "안녕하세요!", steps: [{ motion: "Idle_Talking_Loop", seconds: 2.9 }] },
  // 한 팔을 앞으로 내밀었다 거둠(악수 청하기)
  { text: "반가워요!", steps: [{ motion: "Interact", seconds: 1.8 }] },
  // 웅크렸다 뛰어오름 → 착지. 클립은 몸이 안 떠서 20cm 들어 올린다
  {
    text: "화이팅!",
    steps: [
      { motion: "Jump_Start", seconds: 0.45, lift: 0.2 * UNITS_PER_METER },
      { motion: "Jump_Land", seconds: 1 },
    ],
  },
  // 팔을 들어 앞을 가리킴(Shoot 하나만 쓰면 팔 뻗은 자세에서 바로 시작한다)
  {
    text: "나주로 출동!",
    steps: [
      { motion: "Spell_Simple_Enter", seconds: 0.53 },
      { motion: "Spell_Simple_Shoot", seconds: 0.5 },
    ],
  },
  // 좌우로 들썩(1초 × 3)
  { text: "신난다~", steps: [{ motion: "Dance_Loop", seconds: 3 }] },
  // 무릎 짚고 쪼그림 — 쓰러지기(Death01)는 일어나는 동작이 없고 바닥에 묻혀 뺐다(Codex 09·에이전트)
  { text: "아이고, 지친다…", steps: [{ motion: "Crouch_Idle_Loop", seconds: 2 }] },
];

/** 맞았을 때 — 0초에 고개가 가장 젖혀졌다 돌아온다. 0.43초라 0.7배속으로 늘인다 */
export const HIT_REACTION: AvatarAction["steps"] = [{ motion: "Hit_Head", seconds: 0.62, speed: 0.7 }];

/** 서버 주먹 이름 → 클립 이름(본편 usePunch 와 같은 클립) */
export const PUNCH_CLIPS = { jab: "Punch_Jab", cross: "Punch_Cross" } as const;
