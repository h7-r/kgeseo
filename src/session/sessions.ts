// PRD 의 S0~S9 와 1:1. 문자열을 흩어 쓰면 오타 하나로 조용히 안 넘어가서 상수로 묶는다(USR-110).
export const SESSIONS = {
  /** 진행 상태를 받아오는 아주 짧은 순간 */
  boot: "boot",
  landing: "S0",
  account: "S1",
  characterCreation: "S2",
  opening: "S3",
  lobby: "S4",
  trainingRoom: "S5",
  caseSelect: "S6",
  game: "S7",
  ending: "S8",
  result: "S9",
} as const;

export type Session = (typeof SESSIONS)[keyof typeof SESSIONS];

/** 화면 구석 표시·로그용 이름 */
export const SESSION_NAMES: Record<Session, string> = {
  [SESSIONS.boot]: "부팅",
  [SESSIONS.landing]: "S0 메인",
  [SESSIONS.account]: "S1 계정 · 동의",
  [SESSIONS.characterCreation]: "S2 캐릭터 생성",
  [SESSIONS.opening]: "S3 오프닝",
  [SESSIONS.lobby]: "S4 로비",
  [SESSIONS.trainingRoom]: "S5 훈련실",
  [SESSIONS.caseSelect]: "S6 케이스 선택",
  [SESSIONS.game]: "S7 게임 플레이",
  [SESSIONS.ending]: "S8 엔딩",
  [SESSIONS.result]: "S9 결과 · 현장 안내",
};

// 튜토리얼 게이트(전역-003)가 막는 세션. 훈련실 자체는 막으면 안 된다.
const CASE_SESSIONS = new Set<Session>([SESSIONS.caseSelect, SESSIONS.game]);

export const isCaseSession = (session: Session) => CASE_SESSIONS.has(session);
