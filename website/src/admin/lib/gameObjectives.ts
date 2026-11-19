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
  // 4 · 5스테이지 — 베타 기록 전용 ID(naju01/src/beta/lateObjectives.ts, 미르 11/16). 굵은 표식 CLIFF · GUT 는 아래 BETA_ONLY_NAMES
  P14: "정화수 세 그릇",
  P15: "끊긴 발자국",
  S4_POUCH: "아랑사의 주머니",
  S4_SERPENT: "구렁이상과 틈",
  S5_RINGS: "소반에 가락지",
  P16: "다섯 횃불",
};

/** 모르는 ID(나중에 생긴 목표)는 ID 그대로. */
export const objectiveName = (id: string): string => OBJECTIVE_NAMES[id] ?? id;

/**
 * 서버로 판정을 보낸 퍼즐의 대표 물건 코드 → 그 퍼즐 목표(naju01/src/progress/najuLocalIds.ts).
 * 베타 기록의 서버 판정(puzzle_attempt · source server)은 목표 ID 대신 이 코드로 남는다 — 표에서 P 번호 줄과 따로 센다.
 */
const SERVER_PUZZLE_OBJECTIVES: Readonly<Record<string, string>> = {
  "clam-holes": "P01",
  "jar-slots": "P03",
  "cave-big-clam": "P07",
  "cave-door": "P09",
};

/** 베타 기록에만 나오는 목표 밖 ID — 끝 두 단계(najuBeta) · 이야기가 화면에 뜬 기록(story_exposure) */
const BETA_ONLY_NAMES: Readonly<Record<string, string>> = {
  CLIFF: "바위 위",
  GUT: "굿판",
  opening: "오프닝 영상",
  abisa_request: "아비사 의뢰",
  abisa_backstory: "아비사 옛이야기",
  ending_film: "엔딩 필름",
};

/**
 * 베타 기록 화면의 목표 칸 — 코드 옆 괄호에 한글(미르 11/16). 서버 판정 코드는 어느 퍼즐인지 P 번호와 함께.
 * 모르는 코드 · 「(목표 없음)」은 그대로.
 */
export function betaObjectiveLabel(id: string): string {
  const puzzle = SERVER_PUZZLE_OBJECTIVES[id];
  if (puzzle) return `${id} (${puzzle} ${objectiveName(puzzle)} · 서버 판정)`;
  const name = OBJECTIVE_NAMES[id] ?? BETA_ONLY_NAMES[id];
  return name ? `${id} (${name})` : id;
}

export const STAGE_NAMES: Readonly<Record<number, string>> = {
  1: "나루터",
  2: "바위 아래 · 물굴",
  3: "증언 능선",
  4: "바위 위",
  5: "굿판",
};

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
  // 코드 이름은 서버 계약 그대로(admin_api_v0.2_phase2.md, 미르 11/17) — 탈퇴 기능은 있고(#177) 월별 집계만 아직이다
  withdrawal_not_implemented: "탈퇴 집계 전",
  suspension_not_implemented: "정지 기능 전",
  no_completed_run: "시작과 사건 완주(풀려남 · 새벽)가 모두 기록된 회차 없음",
  memory_only: "서버 메모리에만 있어 집계 전",
  not_stored: "기록하지 않음",
  ip_not_stored: "IP 를 기록하지 않음",
};

export const unavailableReason = (code: string | undefined): string =>
  code ? (UNAVAILABLE_REASONS[code] ?? code) : "원천 없음";
