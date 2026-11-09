/**
 * FE 가 감지한 상황 → 서버에 보낼 상황 코드(계약 v0.4.16 §2 · §3 · §9).
 *
 * 계약: FE 는 상황을 감지해 auto 턴의 `situation: { code, zone_id?, value? }` 로 보내기만 한다. 말할지 · 무슨 말을 할지 ·
 * 횟수 · 쿨다운은 BE 가 정한다. 퍼즐은 P번호가 아니라 `focus_object_id`(퍼즐 대표 Object)로 서버가 찾는다.
 *
 * 코드 열한 개는 계약 v0.4.16 §9 로 확정됐다(쿨다운 · 분량 같은 숫자만 조정 중). FE 상황과 코드를 잇는 곳은 여기 하나다.
 * 서버가 판정하는 퍼즐의 실수 · 진전 없음 · 풀림은 보내지 않는다 — 기존 퍼즐 자동 개입(v0.4.7)이 맡는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { SERVER_JUDGED, type Stage } from "./objectives.ts";
import type { Situation } from "./situations.ts";

/** 계약 v0.4.16 §9 의 상황 코드 — 겹칠 때 앞서는 차례대로. 뜻과 감지 현황은 docs/naju/NPC_상황분류표_1106.md */
export type SituationCode =
  /** 물속 숨이 기준 아래로 처음 떨어짐 */
  | "BREATH_LOW"
  /** 숨이 다하거나 빠져서 되돌려짐 */
  | "SENT_BACK"
  /** 필요한 물건 없이 다음 자리에 옴 */
  | "ITEM_MISSING"
  /** 가진 물건을 내려놓고 멀어짐 */
  | "ITEM_LEFT_BEHIND"
  /** 보상 물건을 안 줍고 다음 구역으로 감 */
  | "ITEM_NOT_PICKED"
  /** 같은 실수를 거듭함 — 화면 판정 퍼즐 · 판정 없는 걸음만 */
  | "REPEATED_MISTAKE"
  /** 목표 구역에서 오래 벗어남 */
  | "OFF_OBJECTIVE"
  /** 오래 진전이 없음 — 화면 판정 퍼즐 · 판정 없는 걸음만 */
  | "NO_PROGRESS"
  /** 걸음 자리에 처음 도착 */
  | "STEP_ARRIVED"
  /** 걸음 · 화면 판정 퍼즐이 풀림 */
  | "STEP_DONE"
  /** 한동안 조용함(잡담) */
  | "QUIET";

export interface SituationPayload {
  code: SituationCode;
  /** 수치가 있는 상황만 — 남은 숨(초) · 누적 실수 · 머문 시간(초) · 되돌려진 횟수 */
  value?: number;
  /**
   * 잡담(QUIET)일 때 지금 있는 구역 — 서버가 그 구역의 잡담을 고르게 한다. 계약은 QUIET 에 `zone_id` 를 꼭 싣게 한다.
   * FE 구역 이름(dock · rock · cave · ridge)이지 서버의 zone_id 가 아니다. 대응표가 나오면 zone_id 로 바꿔 싣는다.
   */
  zone?: Stage;
}

const CODE_OF: Record<Situation["kind"], SituationCode> = {
  breath: "BREATH_LOW",
  sentBack: "SENT_BACK",
  astray: "OFF_OBJECTIVE",
  missing: "ITEM_MISSING",
  dropped: "ITEM_LEFT_BEHIND",
  unpicked: "ITEM_NOT_PICKED",
  stuck: "NO_PROGRESS",
  wrong: "REPEATED_MISTAKE",
  // 시간 초과 · 가만히 있음은 「진전 없음」과 대사가 같아 한 코드로 보낸다(value 로 머문 시간을 싣는다)
  overtime: "NO_PROGRESS",
  idle: "NO_PROGRESS",
  arrive: "STEP_ARRIVED",
  solved: "STEP_DONE",
  chatter: "QUIET",
};

/** 서버가 판정하는 퍼즐에서는 보내지 않는 상황 — 실수 · 진전 없음(시간 초과 · 가만히 있음 포함) · 풀림 */
const LEFT_TO_SERVER = new Set<Situation["kind"]>(["wrong", "stuck", "overtime", "idle", "solved"]);

/**
 * 감지한 상황을 서버에 보낼 모양으로. 보내지 않을 상황이면 null.
 * zone_id · focus_object_id 는 대응표(idmap)가 확정된 뒤 보내는 쪽에서 붙인다 — 그때까지 잡담의 구역만 FE 이름(zone)으로 싣는다.
 * value 는 계약이 「선택」으로 둔 수치다 — 상황이 재서 가진 값이 있을 때만 싣는다. 되돌려짐은 몇 번째인지가 곧 그 값이다.
 *
 * 겹칠 때의 차례는 판정(situations.ts)이 맡는다 — 한 번에 가장 앞선 하나만 내므로 여기서는 받은 것을 그대로 옮긴다.
 */
export function toSituationPayload(situation: Situation, value?: number): SituationPayload | null {
  if (LEFT_TO_SERVER.has(situation.kind) && situation.objective && SERVER_JUDGED.has(situation.objective)) return null;
  const payload: SituationPayload = { code: CODE_OF[situation.kind] };
  const amount = value ?? (situation.kind === "sentBack" ? situation.step + 1 : undefined);
  if (amount !== undefined) payload.value = Math.round(amount);
  if (situation.kind === "chatter") payload.zone = situation.zone;
  return payload;
}

export const SITUATION_CODES = CODE_OF;

/** 계약 v0.4.16 §2 의 요청 모양 — `situation: { code, zone_id?, value? }` 그대로. FE 구역 이름(zone)은 싣지 않는다 */
export interface SituationRequest {
  code: SituationCode;
  zone_id?: string;
  value?: number;
}

/**
 * 보낼 모양으로 옮긴다. 계약에 없는 필드(FE 구역 이름 zone)는 빼고, zone_id 는 대응표(11/9)가 그 구역의 Zone ID 를 줄 때만 싣는다.
 * 늘 새 객체를 만든다 — 보내는 쪽(sendFrozen)이 처음 만든 본문을 얼려 재전송에 그대로 쓴다(§8-6).
 */
export function toSituationRequest(
  payload: SituationPayload,
  zoneIdOf: (stage: Stage) => string | null = () => null,
): SituationRequest {
  const request: SituationRequest = { code: payload.code };
  const zoneId = payload.zone ? zoneIdOf(payload.zone) : null;
  if (zoneId) request.zone_id = zoneId;
  if (payload.value !== undefined) request.value = payload.value;
  return request;
}
