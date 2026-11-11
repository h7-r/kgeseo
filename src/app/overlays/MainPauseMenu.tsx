/**
 * 본편(튜토리얼 · 로비) 멈춤 메뉴 — ESC 로 게임 밖에 나오면 「[T] 로 돌아간다」 안내 대신 뜬다(미르 11/11 「튜토랑 로비에는 그냥 종료,
 * 사운드 설정 이런 것만」, 나주입장 08회차 Codex). 계속하기 · 설정(소리 · 밝기 · 해상도 · 감도) · 조작 보기 · 게임 종료.
 * 조작 보기는 로비에도 둔다 — 다시 접속한 사람이 키를 다시 볼 곳이 없다(08회차 Codex). 튜토리얼에는 F1(안내 숨기기)을 더한다.
 * 기차 안은 마우스를 풀어 홀로그램을 겨누는 곳이라 띄우지 않는다(App). 처음 [T] 전에는 튜토리얼 첫 단계가 T 를 알려 줘 띄우지 않는다.
 */
import PauseMenu, { ControlRows, type PauseMenuItem } from "@/game/PauseMenu";
import { EXIT_FAILED_TEXT, exitGame, exitNote } from "@/game/exitGame";
import { isGameSaveEnabled } from "@/save/gameSave";

type Place = "tutorial" | "lobby";

/** 조작표 — 키는 실제 코드(useMovement · useGameKeys · TutorialPanel)와 같게 */
const CONTROLS = [
  [["W", "A", "S", "D"], "이동"],
  [["Shift"], "누른 채 달리기"],
  [["마우스"], "둘러보기"],
  [["Space"], "점프"],
  [["C"], "앉기 · 일어서기"],
  [["E"], "살펴보기 · 집기 · 쓰기"],
  [["V"], "1인칭 · 3인칭 바꾸기"],
  [["I"], "소지품"],
  [["H"], "힌트함"],
  [["P"], "설정"],
  [["T"], "게임으로 돌아가기"],
  [["Esc"], "창 닫기 · 일시정지"],
] as const;
const TUTORIAL_CONTROLS = [...CONTROLS, [["F1"], "튜토리얼 안내 숨기기 · 보기"]] as const;

export default function MainPauseMenu({
  place,
  onResume,
  onOpenSettings,
}: {
  place: Place;
  onResume: () => void;
  onOpenSettings: () => void;
}) {
  const items: PauseMenuItem[][] = [
    [
      { id: "resume", label: "계속하기", onSelect: onResume },
      { id: "settings", label: "설정", onSelect: onOpenSettings },
      {
        id: "controls",
        label: "조작 보기",
        page: { title: "조작", content: <ControlRows rows={place === "tutorial" ? TUTORIAL_CONTROLS : CONTROLS} /> },
      },
    ],
    [
      {
        id: "exit",
        label: "게임 종료",
        confirm: {
          question: "게임을 끝낼까요?",
          note: exitNote(place),
          confirmLabel: "끝내기",
          busyText: isGameSaveEnabled() ? "저장하고 끝내는 중…" : "끝내는 중…",
          run: async (force) =>
            (await exitGame(force)) === "left"
              ? { ok: true }
              : { ok: false, message: EXIT_FAILED_TEXT, forceLabel: "저장하지 않고 끝내기" },
        },
      },
    ],
  ];
  return <PauseMenu groups={items} onEscape={onResume} footer="Esc 계속하기 · Enter · 클릭 고르기 · ↑↓ 옮기기" />;
}
