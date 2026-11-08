/**
 * P03 장독대 — 서버로 보내는 답의 모양. 정답은 들어 있지 않다(서버 server.json 에만).
 * 자리 0~5(왼쪽부터)에 놓인 항아리 번호(처음 놓인 차례 0~5)를 쉼표로 잇는다. 예: 자리 순서 [2,0,1,…] → "2,0,1,…"
 * 서버는 공백을 지우고 비교한다(backend normalize_answer) — 쉼표 사이 공백은 넣지 않는다.
 */
export const JAR_COUNT = 6;

export function jarOrderAnswer(order: readonly number[]): string {
  if (order.length !== JAR_COUNT || new Set(order).size !== JAR_COUNT)
    throw new Error("jar order must place each of the six jars once");
  if (!order.every((jar) => Number.isInteger(jar) && jar >= 0 && jar < JAR_COUNT))
    throw new Error("jar order must use jar numbers 0-5");
  return order.join(",");
}
