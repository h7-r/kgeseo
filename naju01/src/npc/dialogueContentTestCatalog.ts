// ⚠ 검사 전용 가상 콘텐츠 — 실제 나주 게임 데이터가 아니다. 단서 · 정답 · 반전 · 대사 모두 지어낸 시험용이며 「가상」 표시를 붙였다.
//   구역 코드(Z1~Z4)만 실제 맵과 같다(ai_input 의 구역이 그 코드라서). 게임 목록(NAJU_DIALOGUE_CATALOG)에 섞지 않는다.
//   씬 9 · 단서 열쇠 「씬9.가상열쇠#1」은 실제 게임에 없는 번호 · 이름이다(실제 씬은 1~5).
import type { DialogueCatalog } from "./dialogueContent";

export const TEST_DIALOGUE_CATALOG: DialogueCatalog = {
  id: "test/가상 (검사 전용 · 실제 데이터 아님)",
  lines: [
    { id: "v.ambient.wind", type: "ambient", text: "(가상) 여기 바람이 차네.", reviewed: true },
    {
      id: "v.ambient.cliff",
      type: "ambient",
      text: "(가상) 절벽 위야, 발밑 조심해.",
      reviewed: true,
      conditions: { zones: ["Z3"] },
    },
    {
      id: "v.ambient.redkey",
      type: "ambient",
      text: "(가상) 그 붉은 열쇠, 어디에 쓰는 걸까.",
      reviewed: true,
      conditions: { requiresClues: ["씬9.가상열쇠#1"] },
    },
    { id: "v.help.slow", type: "help_offer", text: "(가상) 같이 천천히 둘러보자.", reviewed: true },
    { id: "v.help.draft", type: "help_offer", text: "(가상) 검수 전 도움 대사.", reviewed: false },
    { id: "v.hint.box", type: "puzzle_hint", text: "(가상) 상자 번호는 4721이야.", reviewed: true },
  ],
  secrets: [
    { id: "v.clue.redkey", kind: "clue", terms: ["붉은 열쇠", "빨간 열쇠"], revealedBy: { clueKey: "씬9.가상열쇠#1" } },
    { id: "v.answer.box", kind: "answer", terms: ["4721", "사칠이일", "사천칠백이십일"] },
    { id: "v.twist.ferryman", kind: "twist", terms: ["뱃사공이 범인", "사공이 범인"] },
  ],
  claims: [{ id: "v.claim.box", terms: ["상자를 열었", "자물쇠를 풀었"], requiresScene: 9 }],
  knownZones: ["Z1", "Z2", "Z3", "Z4"],
};
