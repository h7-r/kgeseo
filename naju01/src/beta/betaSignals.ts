/**
 * 게임 쪽(알림 문장 · 동행 · 도움 · 대사 · 판정)에서 베타 기록으로 보내는 신호 — 의존이 없는 얇은 창구.
 * 게임 파일은 이것만 부르고, 실제 기록(najuBeta)이 시작할 때 채운다. 채우기 전 · 참여 코드가 없으면 아무 일도 없다.
 * (gameObserver → najuBeta → gameObserver 순환 가져오기를 피한다)
 */
type Data = Record<string, unknown>;

export interface BetaSignals {
  /** 알림 문장 · 안내판으로 알아챈 틀림 */
  mistake(objective: string, how: string): void;
  /** 숨이 다해 되돌려졌다 */
  sentBack(): void;
  /** 직접 청한 도움 */
  help(phase: "request" | "received" | "answer_seen", kind: string): void;
  /** 동행 서버 턴 */
  npcTurn(phase: "request" | "response" | "error", data: Data): void;
  /** 의뢰 · 설화 근거 대사 */
  story(passage: string, phase: "heard" | "skipped" | "completed", data?: Data): void;
  /** 서버 판정 결과 · 보내지 못한 실패 */
  attempt(objective: string, result: string, source: "server" | "local" | "inferred", data?: Data): void;
  /** 게임이 이미 처리한 실패(저장 · 제출 · 로딩). code 는 정해 둔 값(문장 원문 아님) */
  failure(category: string, code: string, data?: Data): void;
}

const ignore = () => {};

export const betaSignals: BetaSignals = {
  mistake: ignore,
  sentBack: ignore,
  help: ignore,
  npcTurn: ignore,
  story: ignore,
  attempt: ignore,
  failure: ignore,
};
