/**
 * 두 번째 구역(바위 아래) 어부 셋 대사 · 길잡이 — **초안**(이야기팀 승인 전, 미르가 화면 보고 정한다 · 11/9).
 * 기획 근거: 04 Scene 구성표 Scene 02 「엇갈리는 증언」(366~569행) · U-03(젊은이들 세부 설정은 창작 가능 범위).
 *  - 필수 발견: 진부촌 어른은 택촌의 아랑사를 거의 모른다 · 젊은이들은 이름을 알고 불편해한다 ·
 *    사건 당일 증언이 셋으로 어긋난다(혼자 바위 쪽으로 / 다른 사람들과 함께 / 그날 본 적 없다).
 *  - 셋이 같은 때 · 같은 길을 두고 말하게 「그날 해 질 녘 · 바위로 오르는 길」로 맞춘다 — 기준이 다르면 셋 다 참일 수 있다(Codex 06회차).
 *  - 어른의 「여럿과 함께」 목격이 아랑사와 이어지게, 무리 속에서 그 이름을 부르는 소리를 들었다고 한다(얼굴 · 이름은 그때 처음).
 *  - 하지 않는 것: 아랑사의 죽음 · 누가 거짓을 말했는지(Scene 03 으로 넘긴다) · 퍼즐의 답(수 · 차례 · 쓰임).
 *  - 셋의 말을 다 들었다고 모순을 확인한 것으로 치지 않는다(P01 증언 대조 퍼즐은 아직 없다).
 * 늙은 어부는 하오체, 젊은 둘은 해요체.
 */
import { RAIN_REASON } from "../../story/storyVariants";
import type { StoryLine } from "../firstScene/storyTalk";

export type FisherId = "fisher" | "fisher2" | "fisher3";
type Voice = "elder" | "young";

export interface FisherScript {
  name: string;
  voice: Voice;
  /** 처음 — 증언. 끊기면 다음에 그 줄부터 */
  first: StoryLine[];
  /** 다시 말 걸면 — 지금 단계 길잡이 한 줄 뒤에 증언을 한 줄로 다시 */
  recap: StoryLine;
}

/** lookAt 은 "rock"(앙암바위 쪽) 하나만 쓴다 */
export const FISHER_SCRIPTS: Record<FisherId, FisherScript> = {
  fisher3: {
    name: "늙은 어부",
    voice: "elder",
    first: [
      { text: "아랑사라… 강 건너 택촌 사람을 이 늙은이가 어찌 알겠소. 얼굴도 모르오." },
      { text: "다만 그날 해 질 녘, 우리 마을 젊은 것들이 몰려 바위로 오르는 길을 가는 걸 봤소.", lookAt: "rock" },
      { text: "그 틈에서 누가 '아랑사' 하고 부르는 소리가 났지. 그 이름을 들은 건 그때뿐이오." },
      { text: "젊은 것들이 요새 통 말이 없어. 무슨 일이 있긴 있었던 모양이오.", isDown: true },
    ],
    recap: {
      text: "그날 해 질 녘, 젊은 것들이 몰려 바위로 오르는데 그 틈에서 '아랑사' 하고 부르는 소리가 났소.",
      lookAt: "rock",
    },
  },
  fisher: {
    name: "젊은 어부",
    voice: "young",
    first: [
      { text: "…조사 나오신 분이에요? 우린 그냥 고기 잡는 사람들이에요." },
      { text: "아랑사요? …그 이름은 왜 꺼내세요.", isDown: true },
      { text: "그날 해 질 녘에 그 사람이 혼자 바위로 오르는 길을 가는 걸 봤어요. 혼자였어요. 분명히.", lookAt: "rock" },
      { text: "더 할 말 없어요." },
    ],
    recap: { text: "그날 해 질 녘에 그 사람 혼자 바위로 오르는 길을 갔어요. 혼자였다니까요.", lookAt: "rock" },
  },
  fisher2: {
    name: "그물 멘 어부",
    voice: "young",
    first: [
      { text: "택촌 아랑사요? 이름이야 알죠. 이 근방 젊은 사람치고 모르는 사람 없어요." },
      { text: "근데 그날 해 질 녘엔 제가 바위로 오르는 길목에서 그물을 손보고 있었거든요.", lookAt: "rock" },
      { text: "그 사람은 지나가지 않았어요. 그날은 아예 못 봤어요." },
      { text: "…아비사 그 처자 일이라면, 저한테는 묻지 마세요.", isDown: true },
    ],
    recap: { text: "그날 해 질 녘엔 제가 길목에 있었는데, 그 사람은 지나가지 않았어요.", lookAt: "rock" },
  },
};

/** 바위 아래 진행 단계 — 길잡이 한 줄을 고른다 */
export type RockStep = "fire" | "bottle" | "jars" | "rice" | "cairns" | "offering" | "floats" | "parted" | "done";

/**
 * 단계별 길잡이(답은 말하지 않는다 — 어디를 보라 · 무엇을 만질 수 있다까지, Codex 06회차로 돌탑 · 소반 · 떠오른 돌은 낮췄다).
 * 술병 · 장독은 조작 안내까지, 돌탑 · 소반은 「살펴보라」만, 떠오른 돌은 쓰임을 말하지 않는다.
 */
const STEP_HINTS: Record<RockStep, Record<Voice, string>> = {
  fire: {
    elder: "나루터 화톳불이 꺼졌다더군. 그 일부터 보고 오시오.",
    young: "나루터 화톳불 일부터 보고 오세요.",
  },
  bottle: {
    elder: "부서진 배 둘레에 술병이 흩어져 있소. 성한 게 하나쯤 남았을 게요.",
    young: "부서진 배 근처에 술병이 굴러다녀요. 안 깨진 게 있을지도요.",
  },
  jars: {
    elder: "비가 오면 독마다 우는 소리가 다르지. 독은 들어서 옮길 수 있소.",
    young: "장독마다 빗소리가 달라요. 독은 들어서 옮길 수 있어요.",
  },
  rice: {
    elder: "열린 독 안을 확인해 보시오.",
    young: "열린 독 안을 들여다보세요.",
  },
  cairns: {
    elder: "돌탑과 둘레 자리를 찬찬히 살펴보시오.",
    young: "돌탑이랑 둘레 자리를 잘 살펴보세요.",
  },
  offering: {
    // 기우제의 까닭 — Claude · Codex 안이 갈려 미르가 화면에서 고른다(story/storyVariants ?rain=why)
    elder:
      RAIN_REASON === "why"
        ? "강에서 사람을 잃으면 저리 상을 차리고 비를 청한다는 말을 들었소. 큰물이 져야 강이 삼킨 것을 내놓는다고."
        : "그 소반 말이오? 누가 차렸는지는 모르오. 둘레에 남은 흔적부터 살펴보시오.",
    young: "소반 둘레를 잘 살펴보세요.",
  },
  floats: {
    elder: "물 위로 돌이 떠올랐소. 건져 두시오.",
    young: "물 위에 돌이 떠 있어요. 건져 두세요.",
  },
  parted: {
    elder: "물길이 갈라졌소. 그 아래로 내려가 보시오.",
    young: "물길이 갈라졌어요. 내려가 보세요.",
  },
  done: {
    elder: "여기 일은 다 끝난 듯하오.",
    young: "여긴 이제 다 된 것 같아요.",
  },
};

export const stepHint = (id: FisherId, step: RockStep): StoryLine => ({
  text: STEP_HINTS[step][FISHER_SCRIPTS[id].voice],
});
