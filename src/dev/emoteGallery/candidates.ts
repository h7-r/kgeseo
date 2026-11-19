// 인사 후보 — 동작(치비가 트는 클립 단계)과 어울리는 대사 후보. 고르는 화면(EmoteGallery)이 쓴다.
// 고정: 미르가 남기기로 한 두 개(반가워요=Interact, 신난다=Dance_Loop). 나머지는 기존 Quaternius 동작에 대사를 바꿔 붙인 것과
// 아바타 에이전트가 우리 뼈에 맞춰 만든 새 인사 동작(Emote_…, 도착하면 추가).
import type { AvatarAction } from "@/engine/avatarLink";
import { UNITS_PER_METER } from "@/engine/movement/constants";

export interface EmoteCandidate {
  id: string;
  /** 동작 이름(화면 표시) */
  label: string;
  steps: AvatarAction["steps"];
  lines: readonly string[];
  /** 미르가 남기기로 한 것 */
  fixed?: boolean;
  /** 새로 만든 동작(아바타 에이전트) */
  isNew?: boolean;
}

export const CANDIDATES: readonly EmoteCandidate[] = [
  {
    id: "interact",
    label: "손 내밀기",
    steps: [{ motion: "Interact", seconds: 1.8 }],
    lines: ["반가워요!"],
    fixed: true,
  },
  { id: "dance", label: "들썩들썩", steps: [{ motion: "Dance_Loop", seconds: 3 }], lines: ["신난다~"], fixed: true },
  {
    id: "talk",
    label: "말하는 손짓",
    steps: [{ motion: "Idle_Talking_Loop", seconds: 2.9 }],
    lines: ["그거 들었어요?", "제 얘기 좀 들어 보세요"],
  },
  {
    id: "point",
    label: "앞을 가리키기",
    steps: [
      { motion: "Spell_Simple_Enter", seconds: 0.53 },
      { motion: "Spell_Simple_Shoot", seconds: 0.6 },
    ],
    lines: ["저기 봐요!", "저쪽이에요!"],
  },
  {
    id: "hop",
    label: "제자리 점프",
    steps: [
      { motion: "Jump_Start", seconds: 0.45, lift: 0.2 * UNITS_PER_METER },
      { motion: "Jump_Land", seconds: 1 },
    ],
    lines: ["앗싸!", "좋았어!"],
  },
  {
    id: "crouch",
    label: "무릎 짚고 쪼그리기",
    steps: [{ motion: "Crouch_Idle_Loop", seconds: 2 }],
    lines: ["잠깐 쉬어요…", "다리 아파…"],
  },
  {
    id: "kneel",
    label: "무릎 꿇고 살피기",
    steps: [{ motion: "Fixing_Kneeling", seconds: 4.4 }],
    lines: ["단서 찾는 중…", "이것 좀 볼게요"],
  },
  {
    id: "pickup",
    label: "줍는 시늉",
    steps: [{ motion: "PickUp_Table", seconds: 0.9 }],
    lines: ["어? 이게 뭐지?", "주웠다!"],
  },
  {
    id: "focus",
    label: "기 모으기",
    steps: [
      { motion: "Spell_Simple_Enter", seconds: 0.53 },
      { motion: "Spell_Simple_Idle_Loop", seconds: 1.8 },
    ],
    lines: ["집중…", "기를 모으는 중"],
  },
  {
    id: "torch",
    label: "높이 들기",
    steps: [{ motion: "Idle_Torch_Loop", seconds: 2.2 }],
    lines: ["따라오세요!", "이쪽으로!"],
  },
  {
    id: "ouch",
    label: "가슴 맞은 척",
    steps: [{ motion: "Hit_Chest", seconds: 0.6, speed: 0.55 }],
    lines: ["윽!", "아야!"],
  },
];

/** 키패드 1~6 자리의 처음 값 — 미르가 남긴 둘만 채운다 */
export const INITIAL_SLOTS: readonly ({ id: string; line: string } | null)[] = [
  null,
  { id: "interact", line: "반가워요!" },
  null,
  null,
  { id: "dance", line: "신난다~" },
  null,
];
