/**
 * 팀 · 시험 계정 — 「베타 기록」 화면이 기본으로 빼는 계정(11/13 미르, 11/16 더함).
 * - 11/13: 그날 오전까지 쌓인 기록(16계정) 가운데 실제 참가 한 판(1계정)만 남기고 나머지 15계정.
 * - 11/16: 베타 중 확인된 팀 · 시험 계정 3개(기록 있음)와, 아직 기록은 없지만 팀 · 시험 계정인 10개(나중에 들어와도 빠지게).
 *   운영 DB 의 테스트 계정 표시(is_test, 회원 통계용 — 미르가 서버에서 켬)와 같은 계정이다. 관리자 API 회원 목록에
 *   is_test 가 없어(베타 중 서버 변경 없음) 이 화면은 이 목록으로 뺀다.
 * 관리자는 「관리자 계정 기록 빼기」가 따로 뺀다. 그 뒤 새 시험 계정은 화면의 「뺄 계정」 칸에 적거나 여기 참가 번호를 더한다.
 * 공개 저장소라 계정 id · 이메일 · 닉네임 대신 참가 번호(계정 id 의 FNV 지문 — betaReport.ts shortKey)만 적는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { shortKey } from "./betaReport.ts";

export const TEST_ACCOUNT_KEYS: ReadonlySet<string> = new Set([
  // 11/13 — 베타 전 기록이 있던 팀 · 시험 계정 15
  "6102B853",
  "C3706E7C",
  "6CE980AB",
  "CD888396",
  "F1D1F2A3",
  "949CFB24",
  "E3B44768",
  "47636A49",
  "EC27936D",
  "417AC5F5",
  "681F9D04",
  "AAEAC117",
  "6B9059D7",
  "331D7D8A",
  "A8D8201C",
  // 11/16 — 베타 중 기록이 있는 팀 · 시험 계정 3
  "D02FC149",
  "5F4540F0",
  "8F68B2BB",
  // 11/16 — 아직 기록은 없는 팀 · 시험 계정 10
  "ABC305D1",
  "073E35C3",
  "E36640D9",
  "6F8D4819",
  "6951F30A",
  "C6CF7A2F",
  "988E9622",
  "11382BD0",
  "6D693BE8",
  "75590FBB",
]);

/** 계정 id 가운데 참가 번호가 keys 에 든 것 — 화면은 기록의 app_user_id 를 넘긴다 */
export function testAccountsIn(
  accountIds: Iterable<string | null | undefined>,
  keys: ReadonlySet<string> = TEST_ACCOUNT_KEYS,
): Set<string> {
  const found = new Set<string>();
  for (const id of accountIds) if (id && !found.has(id) && keys.has(shortKey(id))) found.add(id);
  return found;
}
