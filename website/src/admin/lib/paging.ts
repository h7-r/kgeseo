/**
 * offset 방식 목록을 이어 받을 때 쓰는 병합. "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 * 넘기는 사이 새 항목이 생기면 한 항목이 두 쪽에 나올 수 있어 이미 받은 id 는 뺀다(관리자 API v0.2 §2.3).
 */
export function appendUnique<T>(list: readonly T[], more: readonly T[], idOf: (item: T) => string): T[] {
  const seen = new Set(list.map(idOf));
  const merged = [...list];
  for (const item of more) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }
  return merged;
}
