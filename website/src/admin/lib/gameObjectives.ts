/**
 * 나주 사건 목표(퍼즐 · 걸음) 이름표와 스테이지 이름 — 서버 `stats/game` 은 ID 만 주고 이름은 화면이 붙인다.
 * `naju01/src/dialogue/objectives.ts` 의 이름을 옮겼다. 정답 값은 두지 않는다. "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

const OBJECTIVE_NAMES: Readonly<Record<string, string>> = {
  P01: "조개 숨구멍",
  P02: "통발 고르기",
  "P02-2": "떨리는 줄",
  S1_FIRE: "화톳불",
  S1_SMOKE: "연기 화살표",
  P03: "장독대 항아리",
  S2_BOTTLE: "술병",
  P05: "돌탑과 마법진",
  S2_OFFER: "제물",
  S2_STONES: "물에 뜬 돌",
  S2_ENTER: "물굴 들어가기",
  C_JAR: "엎어진 독",
  P07: "진주 빛 잇기",
  P08: "물고기 굴",
  P09: "물레 고리문",
  P10: "석실 받침",
  C_SOCKET: "바위 홈",
  S3_GO: "증언 능선",
  P11: "지게와 궤",
  P12: "장승 고리",
  P13: "통나무 걸상",
  "P13-2": "돌새",
  S3_SCALE: "눈물 자국",
  S3_KEY: "청동 열쇠와 함",
  S3_RIFT: "시공간 틈",
};

/** 모르는 ID(나중에 생긴 목표)는 ID 그대로. */
export const objectiveName = (id: string): string => OBJECTIVE_NAMES[id] ?? id;

export const STAGE_NAMES: Readonly<Record<number, string>> = { 1: "나루터", 2: "바위 아래 · 물굴", 3: "증언 능선" };

export const stageName = (stage: number): string =>
  `스테이지 ${stage} · ${STAGE_NAMES[stage] ?? ""}`.replace(/ · $/, "");

export const JUDGE_LABELS: Readonly<Record<string, string>> = { server: "서버", screen: "화면", step: "걸음" };

export const judgeLabel = (judge: string): string => JUDGE_LABELS[judge] ?? judge;

/** 게임 진입 깔때기(stage_reached phase) 이름 */
const FUNNEL_LABELS: Readonly<Record<string, string>> = {
  character_open: "캐릭터 생성 시작",
  character_done: "캐릭터 생성 완료",
  headquarters: "본부실 진입",
  naju_ready: "나주 로딩 끝",
  naju_controllable: "나주 조작 가능",
};

export const funnelLabel = (phase: string): string => FUNNEL_LABELS[phase] ?? phase;

/** 서버 action · unavailable 이유 코드를 사람 말로. 모르는 코드는 원문 */
const UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
  lobby_metrics_not_connected: "로비 집계 연결 전",
  no_time_series_source: "분 단위 기록 원천 없음",
  withdrawal_not_implemented: "탈퇴 기능 전",
  suspension_not_implemented: "정지 기능 전",
  no_completed_run: "새벽까지 간 회차 없음",
  memory_only: "서버 메모리에만 있어 집계 전",
  not_stored: "기록하지 않음",
  ip_not_stored: "IP 를 기록하지 않음",
};

export const unavailableReason = (code: string | undefined): string =>
  code ? (UNAVAILABLE_REASONS[code] ?? code) : "원천 없음";
