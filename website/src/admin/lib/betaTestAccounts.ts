/**
 * 베타 전 시험 계정(11/13 미르) — 「베타 기록」 화면이 기본으로 빼는 계정.
 * 11/13 오전까지 쌓인 기록(16계정) 가운데 실제 참가 한 판(1계정)만 남기고, 나머지 15계정은 팀 · 시험 계정으로 본다.
 * 베타 중 새로 만든 시험 계정은 여기 없다 — 화면의 「뺄 계정」 칸에 적거나 이 목록에 참가 번호를 더한다.
 * 공개 저장소라 계정 id · 이메일 대신 참가 번호(계정 id 의 FNV 지문 — betaReport.ts shortKey)만 적는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { shortKey } from "./betaReport.ts";

export const PRE_BETA_TEST_KEYS: ReadonlySet<string> = new Set([
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
]);

/** 계정 id 가운데 참가 번호가 keys 에 든 것 — 화면은 기록의 app_user_id 를 넘긴다 */
export function testAccountsIn(
  accountIds: Iterable<string | null | undefined>,
  keys: ReadonlySet<string> = PRE_BETA_TEST_KEYS,
): Set<string> {
  const found = new Set<string>();
  for (const id of accountIds) if (id && !found.has(id) && keys.has(shortKey(id))) found.add(id);
  return found;
}
