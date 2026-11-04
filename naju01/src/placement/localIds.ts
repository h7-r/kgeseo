/**
 * 게시 게이트(`backend/app/services/idmap_validation.py` `_local_id_issues`)에 넘길 나주 로컬 ID 목록.
 * idmap 의 `local` 값이 나주 코드에 실제로 있는지 대조하는 데 쓴다 — 목록에 없는 값은 게이트가 막는다.
 *
 * 다섯 종류만 만든다(게이트가 받는 열쇠와 같다):
 *   zones · navigation · blockers — 도면 상수(`plan/sitePlan.ts` ZONES · PATHS · BLOCKERS)의 code
 *   scenes  — 장면 번호(`SCENE_TITLES` 의 열쇠, 문자열)
 *   objects — 배치 키 `<무리 이름>#<번호>`. 실제로 그려진 인스턴스 번호(`InstanceGroup.batches[].ids`)를 그대로 쓴다.
 *             손 편집(지움 · 더함)을 얹은 뒤의 번호이고, 연출(`scene/immersion/director.ts`)이 단서를 세는 키와 같다.
 *
 * 값을 지어내지 않는다. 같은 키가 둘이면(번호 충돌) 목록을 믿을 수 없으므로 문제로 돌려준다 — 부르는 쪽이 멈춘다.
 * `registerInteractable` id(`cave-jar` 등 코드로 만든 물건)는 idmap 이 받는 형식이 아니라 여기 넣지 않는다.
 * 이 파일은 타입만 가져온다(node --test 로 바로 돈다).
 */

export const LOCAL_ID_KINDS = ["zones", "navigation", "blockers", "objects", "scenes"] as const;
export type LocalIdKind = (typeof LOCAL_ID_KINDS)[number];
export type LocalIdList = Record<LocalIdKind, string[]>;

interface Coded {
  readonly code: string;
}

export interface LocalIdGroup {
  readonly groupId: string;
  readonly batches: readonly { readonly ids: ArrayLike<number> }[];
}

export interface LocalIdSources {
  zones: readonly Coded[];
  paths: readonly Coded[];
  blockers: readonly Coded[];
  sceneNumbers: readonly (string | number)[];
  groups: readonly LocalIdGroup[];
}

export interface LocalIdResult {
  list: LocalIdList;
  /** 무리별 인스턴스 수(번호 범위 확인용) */
  objectCounts: Record<string, number>;
  /** 목록을 믿을 수 없게 하는 문제. 비어 있어야 쓴다 */
  problems: string[];
}

export const objectKey = (groupId: string, id: number) => `${groupId}#${id}`;

/** 정렬 · 중복 확인. 중복이면 문제로 남기고 값은 한 번만 넣는다 */
function unique(kind: LocalIdKind, values: Iterable<string>, problems: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value === "") {
      problems.push(`${kind}:empty`);
      continue;
    }
    if (seen.has(value)) problems.push(`${kind}:duplicate:${value}`);
    seen.add(value);
  }
  return [...seen].sort();
}

export function collectLocalIds(sources: LocalIdSources): LocalIdResult {
  const problems: string[] = [];
  const objectCounts: Record<string, number> = {};
  const objects: string[] = [];
  const groupIds = new Set<string>();
  for (const group of sources.groups) {
    if (groupIds.has(group.groupId)) problems.push(`objects:duplicate_group:${group.groupId}`);
    groupIds.add(group.groupId);
    let count = 0;
    for (const batch of group.batches) {
      for (let i = 0; i < batch.ids.length; i++) {
        const id = batch.ids[i];
        if (!Number.isInteger(id) || id < 0) {
          problems.push(`objects:invalid_id:${group.groupId}#${String(id)}`);
          continue;
        }
        objects.push(objectKey(group.groupId, id));
        count += 1;
      }
    }
    objectCounts[group.groupId] = (objectCounts[group.groupId] ?? 0) + count;
  }
  const list: LocalIdList = {
    zones: unique(
      "zones",
      sources.zones.map((zone) => zone.code),
      problems,
    ),
    navigation: unique(
      "navigation",
      sources.paths.map((path) => path.code),
      problems,
    ),
    blockers: unique(
      "blockers",
      sources.blockers.map((blocker) => blocker.code),
      problems,
    ),
    objects: unique("objects", objects, problems),
    scenes: unique("scenes", sources.sceneNumbers.map(String), problems),
  };
  for (const kind of LOCAL_ID_KINDS) if (list[kind].length === 0) problems.push(`${kind}:none`);
  return { list, objectCounts, problems };
}
