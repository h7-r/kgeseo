/**
 * 다시 접속했을 때 어디서 시작하나(미르 11/10 「튜토리얼 재접속 정리」).
 *
 *   본부실에 들어선 적 없음(저장 단계 tutorial) → 튜토리얼을 처음부터. 위치 · 단계 · 힌트함 · 퍼즐 · 연출 모두 처음으로, 외형은 남긴다
 *   본부실에 들어선 뒤(headquarters · train · naju) → 로비(본부실)에서. 비밀 복도 문은 닫혀 있다
 *   저장 없음(처음 · 로그인 안 함) → 지금처럼 처음부터(오프닝도 튼다)
 *
 * 튜토리얼이 「끝났다」의 기준은 본부실 첫 진입이다 — 튜토리얼 완료 안내(isFinished)는 차단기 스위치 뒤에 켜지고 그 뒤에도
 * 자판기 · 소화전 · 배전반이 남아 있어, 그것으로 로비를 열면 남은 복도 퍼즐을 건너뛴다(Codex 계획 검토 · 미르 11/10 권장안).
 * 위치 · 단계만 이어 주던 옛 이어 하기는 힌트함 · 퍼즐이 저장되지 않아 반쯤만 복원됐다 — 이어 주지 않는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import type { GameStage } from "./gameSave.ts";
import { isLobbyStage } from "./lobbyEntry.ts";

/** 이번 접속의 시작 — 처음 · 튜토리얼 처음부터 다시 · 튜토리얼 뒤(로비) */
export type ResumeKind = "new" | "restartTutorial" | "afterTutorial";

/** 튜토리얼에서만 쓰던 저장 칸. 처음부터 다시 할 때 넣지 않는다(다음 저장 때 새 값으로 덮인다) */
export const TUTORIAL_SECTIONS: readonly string[] = [
  "main.tutorial",
  "main.inventory",
  "main.stationPose",
  "main.trainPose",
];

/** 본부실 서쪽 벽(비밀 복도와 맞닿은 벽)의 x — station/layout/dimensions 의 HEADQUARTERS_MIN_X 와 같다 */
const HEADQUARTERS_WEST_X = -20;
/** 벽에서 이만큼 안쪽이어야 본부실 안으로 본다(문턱에 걸친 자리는 아니다) */
const INSIDE_MARGIN = 0.5;

interface SavedPose {
  position?: unknown;
}

/** 저장된 역 자리가 본부실 안인가 — 튜토리얼 중에는 문(자판기)에 막혀 이 안에 설 수 없다 */
export function isInsideHeadquarters(pose: SavedPose | null | undefined): boolean {
  const position = pose?.position;
  if (!Array.isArray(position) || typeof position[0] !== "number") return false;
  return position[0] > HEADQUARTERS_WEST_X + INSIDE_MARGIN;
}

export interface ResumeEvidence {
  /** 저장 단계(로그인하지 않았거나 저장이 없으면 null) */
  stage: GameStage | null;
  /** 저장된 역 자리 */
  stationPose?: SavedPose | null;
  /** 기차 안 자리가 저장돼 있다 — 기차는 본부실에서만 탄다 */
  hasTrainPose?: boolean;
  /** 나주에 들어간 적이 있다 */
  hasNajuProgress?: boolean;
}

/**
 * 저장으로 이번 시작을 정한다. 단계가 tutorial 이어도 본부실 · 기차 · 나주 흔적이 있으면 튜토리얼 뒤로 본다 —
 * 예전 판은 본부실에서 새로 고침하면 단계가 tutorial 로 내려가 적히기도 했다(본부실 진입이 저장되지 않았다)
 */
export function resumeKindFor({ stage, stationPose, hasTrainPose, hasNajuProgress }: ResumeEvidence): ResumeKind {
  if (isLobbyStage(stage)) return "afterTutorial";
  if (stage === null) return "new";
  if (hasTrainPose || hasNajuProgress || isInsideHeadquarters(stationPose)) return "afterTutorial";
  return stage === "tutorial" ? "restartTutorial" : "new";
}

/**
 * 오프닝 시네마틱을 다시 틀지 않는다 — 저장 단계가 있으면(캐릭터를 만든 뒤) 짧은 로딩 영상만.
 * 처음 들어오는 사람(저장 없음 · 로그인 안 함)은 지금처럼 오프닝을 튼다
 */
export const skipsOpening = (stage: GameStage | null): boolean => stage !== null;
