/**
 * 나주 PC 멈춤 메뉴 — 조사 중 ESC 로 게임 밖에 나오면 뜬다(미르 11/11 「일시정지를 알리는 표식과 함께 설정 창이 나와야 함. 그 메뉴 안에는
 * 게임종료, 로비로 나가기, 처음부터 다시하기, 다른 지역 이동(기차 안) 등」, 나주입장 05회차 Codex 안).
 *
 *   ❚❚ 일시정지      조사 시간 12:34 (+ 평가 미리 보기면 시간 별 · 직접 청한 도움)
 *   계속하기 · 설정 · 조작(· 평가) 다시 보기
 *   ─ 다른 지역으로(기차) · 로비로 나가기 · 게임 종료
 *   ─ 처음부터 다시(빨강, 한 번 더 묻는다)
 *
 * 설정은 기존 설정 창(소리 · 밝기 · 해상도 · 감도)을 연다 — 닫으면 이 메뉴로 돌아온다(창을 열 때 조작 중이 아니었다, pointerHold).
 * 계속하기는 클릭(몸짓)으로 잠근다. 크롬이 ESC 직후 잠시 거절하면 메뉴에 남아 「한 번 더」를 알린다.
 * 로비 · 기차는 본편과 한 출처에서 돌 때만(canLeaveToLobby). 처음부터 다시는 이 페이지에서 나주 칸을 지우고 새로 연다(restartNajuHere).
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import { EXIT_FAILED_TEXT, exitGame, exitNote } from "@/game/exitGame";
import type { LeaveResult, LeaveToLobbyAction } from "@/game/LeaveToLobby";
import PauseMenu, { type PauseMenuItem, type PauseRunResult } from "@/game/PauseMenu";
import { UI } from "@/game/gameUi";
import { openSurvey, shouldOfferSurvey } from "@/beta/betaSurvey";
import { isGameSaveEnabled } from "@/save/gameSave";

import { helpLog } from "../progress/helpLog";
import { THREE_STAR_MS, formatPlayTime, playClock } from "../progress/playClock";
import { ending } from "../ending/endingState";
import { gut } from "../puzzles/gut/gutState";
import { RATING_PREVIEW } from "./caseStart";
import { leaveToTrain } from "./leaveToLobby";
import { RESTART_FAILED_TEXT, restartNajuCase } from "./restartNaju";

const LOCK_REFUSED_TEXT = "브라우저가 잠시 막았어요 — 한 번 더 눌러 주세요.";

interface NajuPauseMenuProps {
  onResume: () => void;
  /** ESC — 몸짓 없이 돌아가기(다음 클릭 · 키에 마우스가 잠긴다) */
  onEscape: () => void;
  onOpenSettings: () => void;
  onShowGuide: () => void;
  guideLabel: string;
  /** 본편과 한 출처일 때만 — 로비 · 기차로 나간다 */
  leaveAction?: LeaveToLobbyAction;
}

const toRun =
  (leave: (force: boolean) => Promise<LeaveResult>, forceLabel: string) =>
  async (force: boolean): Promise<PauseRunResult> =>
    (await leave(force)) === "left"
      ? { ok: true }
      : {
          ok: false,
          message: "저장하지 못했어요. 연결을 확인하고 다시 해 보거나, 저장 없이 갈 수 있어요.",
          forceLabel,
        };

async function restart(): Promise<PauseRunResult> {
  if (!(await restartNajuCase())) return { ok: false, message: RESTART_FAILED_TEXT };
  return { ok: true };
}

export default function NajuPauseMenu({
  onResume,
  onEscape,
  onOpenSettings,
  onShowGuide,
  guideLabel,
  leaveAction,
}: NajuPauseMenuProps) {
  // 계속하기를 브라우저가 거절했다(ESC 직후 · 창 밖 초점) — 메뉴에 남아 알린다
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const handleError = () => setNotice(LOCK_REFUSED_TEXT);
    document.addEventListener("pointerlockerror", handleError);
    return () => document.removeEventListener("pointerlockerror", handleError);
  }, []);
  const isSaving = isGameSaveEnabled();

  const groups: PauseMenuItem[][] = [
    [
      {
        id: "resume",
        label: "계속하기",
        onSelect: () => {
          setNotice(null);
          onResume();
        },
      },
      { id: "settings", label: "설정", onSelect: onOpenSettings },
      { id: "guide", label: guideLabel, onSelect: onShowGuide },
      // 굿을 끝낸 판 — 엔딩(필름 → 클리어 화면)을 다시 본다. 감상만(퍼즐 · 보고 · 보상 되풀이 없음).
      // 끝 연출이 아직 도는 중(새벽이 온 뒤 필름이 열리기 전)에는 숨긴다 — 연출의 예약 · 카메라 고정이 남는다(Codex 리뷰)
      ...(gut.stage() === "dawn" && ending.phase() === "off"
        ? [{ id: "ending", label: "엔딩 다시 보기", onSelect: ending.openFilm }]
        : []),
      // 베타 — 끝내기 전 중단 설문(1분). 굿을 풀기 전 · 참여 코드 · 폼 주소가 있고 아직 열지 않았을 때만
      ...(gut.stage() !== "released" && gut.stage() !== "dawn" && shouldOfferSurvey("exit")
        ? [{ id: "beta_exit", label: "베타 설문 — 그만두는 이유(1분)", onSelect: () => void openSurvey("exit", "pause_menu") }]
        : []),
    ],
    [
      ...(leaveAction
        ? [
            {
              id: "train",
              label: "다른 지역으로(기차)",
              confirm: {
                question: "기차로 가서 다른 지역을 고를까요?",
                note: isSaving
                  ? "지금까지 한 조사는 저장돼요. 기차 목적지 창에서 이어서 할 수 있어요."
                  : "로그인하지 않아 지금까지 한 것은 저장되지 않아요.",
                confirmLabel: "기차로 가기",
                busyText: isSaving ? "저장하고 기차로 가는 중…" : "기차로 가는 중…",
                run: toRun(leaveToTrain, "그래도 가기"),
              },
            },
            {
              id: "lobby",
              label: "로비로 나가기",
              confirm: {
                question: "로비로 나갈까요?",
                note: leaveAction.note,
                confirmLabel: "나가기",
                busyText: isSaving ? "저장하고 로비로 가는 중…" : "로비로 가는 중…",
                run: toRun((force) => leaveAction.leave(force), "그래도 나가기"),
              },
            },
          ]
        : []),
      {
        id: "exit",
        label: "게임 종료",
        confirm: {
          question: "게임을 끝낼까요?",
          note: exitNote("case"),
          confirmLabel: "끝내기",
          busyText: isSaving ? "저장하고 끝내는 중…" : "끝내는 중…",
          run: async (force) =>
            (await exitGame(force)) === "left"
              ? { ok: true }
              : { ok: false, message: EXIT_FAILED_TEXT, forceLabel: "저장하지 않고 끝내기" },
        },
      },
    ],
    [
      {
        id: "restart",
        label: "처음부터 다시",
        isDanger: true,
        confirm: {
          question: "이번 나주 조사의 진행 · 시간 · 도움 기록을 지우고 처음부터 다시 할까요?",
          note: isSaving ? "지운 기록은 되돌릴 수 없어요." : "로그인하지 않아 저장된 진행은 없어요. 이 판을 처음부터 새로 시작해요.",
          confirmLabel: "처음부터 다시",
          isDanger: true,
          busyText: isSaving ? "기록을 지우는 중…" : "처음으로 돌아가는 중…",
          run: restart,
        },
      },
    ],
  ];

  return (
    <PauseMenu
      status={<CaseStatus />}
      notice={notice}
      groups={groups}
      onEscape={onEscape}
      footer="Esc 계속하기 · Enter · 클릭 고르기 · ↑↓ 옮기기 · P 설정"
    />
  );
}

/** 조사 시간(+ 평가 미리 보기면 시간 별 · 직접 청한 도움) */
function CaseStatus() {
  useSyncExternalStore(playClock.subscribe, playClock.version, playClock.version);
  useSyncExternalStore(helpLog.subscribe, helpLog.version, helpLog.version);
  const elapsed = playClock.elapsed();
  const isFinal = playClock.isFinal();
  const isOver = elapsed > THREE_STAR_MS;
  const isRating = RATING_PREVIEW !== "off";
  return (
    <>
      <div style={timeRowStyle}>
        <span>{isFinal ? "조사 완료" : "조사 시간"}</span>
        <b style={timeStyle}>{formatPlayTime(elapsed)}</b>
      </div>
      {isRating && !isFinal && (
        <div>
          {isOver ? (
            <>
              20분을 넘겨 시간 평가는 최대 <Stars n={2} />
            </>
          ) : (
            <>
              20분 이내 완료 시 시간 평가 <Stars n={3} />
            </>
          )}
        </div>
      )}
      {isRating && (
        <div>
          직접 청한 도움 {helpLog.asked()}회{helpLog.isAnswerSeen() ? " · 정답 확인함" : ""}
        </div>
      )}
    </>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`별 ${n}개`} style={starStyle}>
      {"★".repeat(n)}
    </span>
  );
}

const timeRowStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 };
const timeStyle: CSSProperties = {
  font: `600 18px/1 "IBM Plex Mono", ui-monospace, monospace`,
  color: UI.text,
  letterSpacing: ".04em",
  fontVariantNumeric: "tabular-nums",
};
const starStyle: CSSProperties = { color: "#e9c46a", letterSpacing: ".06em" };
