// leva-dump 결과 두 개를 견준다.
//
// ① 키로 짝짓기: 「폴더/키」가 같으면 그대로, 매핑 파일이 있으면 기준키→새키로, 둘 다 없으면
//    새 입력의 label 이 기준 키와 같은 것(키를 영어로 바꾸고 한글을 label 로 남기는 리팩터)을 찾는다.
//    매핑 파일: { "keys": {"폴더/키": "새폴더/새키"}, "folders": {"폴더": "새폴더"} } 또는 평평한 {"폴더/키": "새폴더/새키"}
// ② 폴더별 값 다중집합: 키 이름과 무관하게 그 폴더 값들의 모음이 같은가. 폴더 이름이 바뀌었으면 모음이 똑같은 짝을 제안한다.
import fs from "node:fs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function loadMap(mapFile) {
  const map = { keys: {}, folders: {} };
  if (!mapFile) return map;
  const raw = readJson(mapFile);
  if (raw.keys || raw.folders) {
    Object.assign(map.keys, raw.keys ?? {});
    Object.assign(map.folders, raw.folders ?? {});
  } else Object.assign(map.keys, raw);
  return map;
}

const folderOf = (key, inputs) => inputs?.[key]?.folder ?? key.split("/").slice(0, -1).join("/");

function countBag(list) {
  const bag = new Map();
  for (const x of list) bag.set(x, (bag.get(x) ?? 0) + 1);
  return bag;
}

function bagMinus(a, b) {
  const out = [];
  for (const [x, n] of a) for (let i = 0; i < n - (b.get(x) ?? 0); i++) out.push(x);
  return out;
}

function matchKeys(base, next, map) {
  const byLabel = new Map();
  for (const [key, input] of Object.entries(next.inputs ?? {}))
    if (input.label && !input.skipped) byLabel.set(`${input.folder}\u0000${input.label}`, key);

  const result = { changed: [], missing: [], mappedBy: { exact: 0, map: 0, label: 0 } };
  const used = new Set();
  for (const [baseKey, baseValue] of Object.entries(base.values)) {
    const input = base.inputs?.[baseKey] ?? {};
    const folder = input.folder ?? baseKey.split("/").slice(0, -1).join("/");
    const key = input.key ?? baseKey.split("/").at(-1);
    let nextKey = null;
    let how = null;
    if (map.keys[baseKey]) {
      nextKey = map.keys[baseKey];
      how = "map";
    } else {
      const nextFolder = map.folders[folder] ?? folder;
      if (`${nextFolder}/${key}` in next.values) {
        nextKey = `${nextFolder}/${key}`;
        how = nextFolder === folder ? "exact" : "map";
      } else if (byLabel.has(`${nextFolder}\u0000${key}`)) {
        nextKey = byLabel.get(`${nextFolder}\u0000${key}`);
        how = "label";
      }
    }
    if (!nextKey || !(nextKey in next.values)) {
      result.missing.push(baseKey);
      continue;
    }
    used.add(nextKey);
    result.mappedBy[how]++;
    if (JSON.stringify(baseValue) !== JSON.stringify(next.values[nextKey]))
      result.changed.push({ key: baseKey, newKey: nextKey, old: baseValue, new: next.values[nextKey] });
  }
  result.extra = Object.keys(next.values).filter((k) => !used.has(k));
  return result;
}

function compareFolders(base, next, map) {
  const bags = (dump) => {
    const byFolder = {};
    for (const [key, value] of Object.entries(dump.values))
      (byFolder[folderOf(key, dump.inputs)] ??= []).push(JSON.stringify(value));
    for (const folder in byFolder) byFolder[folder].sort();
    return byFolder;
  };
  const baseBags = bags(base);
  const nextBags = bags(next);
  const signature = (list) => list.join("\u0001");
  const foldersBySignature = new Map();
  for (const [folder, list] of Object.entries(nextBags)) {
    const sig = signature(list);
    if (!foldersBySignature.has(sig)) foldersBySignature.set(sig, []);
    foldersBySignature.get(sig).push(folder);
  }

  const result = { same: 0, differ: [], suggestedFolderMap: {} };
  for (const [folder, list] of Object.entries(baseBags)) {
    const nextFolder = map.folders[folder] ?? folder;
    if (nextBags[nextFolder] && signature(nextBags[nextFolder]) === signature(list)) {
      result.same++;
      continue;
    }
    // 같은 이름 폴더가 없을 때만 「이름이 바뀐 짝」을 찾는다
    const candidates = nextBags[nextFolder] ? null : foldersBySignature.get(signature(list));
    if (candidates?.length === 1) {
      result.suggestedFolderMap[folder] = candidates[0];
      result.same++;
      continue;
    }
    const other = nextBags[nextFolder] ?? [];
    const baseCount = countBag(list);
    const nextCount = countBag(other);
    result.differ.push({
      folder,
      newFolder: nextBags[nextFolder] ? nextFolder : null,
      oldCount: list.length,
      newCount: other.length,
      onlyOld: bagMinus(baseCount, nextCount).slice(0, 12),
      onlyNew: bagMinus(nextCount, baseCount).slice(0, 12),
    });
  }
  return result;
}

// 저장소 kgeseo.leva.v1 은 키 이름이 바뀔 수 있어 폴더 수·값 수만 견준다
function storedCounts(dump) {
  const stored = dump.localStorage?.["kgeseo.leva.v1"];
  if (!stored || typeof stored !== "object") return null;
  const values = Object.values(stored).reduce(
    (n, x) => n + (x && typeof x === "object" ? Object.keys(x).length : 1),
    0,
  );
  return { folders: Object.keys(stored).length, values };
}

export function compareLeva(base, next, mapFile) {
  const map = loadMap(mapFile);
  const keys = matchKeys(base, next, map);
  return {
    counts: { old: Object.keys(base.values).length, new: Object.keys(next.values).length },
    changed: keys.changed,
    missing: keys.missing,
    extra: keys.extra,
    mappedBy: keys.mappedBy,
    folders: compareFolders(base, next, map),
    stored: {
      old: storedCounts(base),
      new: storedCounts(next),
      oldPan: base.localStorage?.["kgeseo.leva.팀기준판"],
      newPan: next.localStorage?.["kgeseo.leva.팀기준판"],
    },
  };
}

export function printLeva(leva, trunc) {
  const { counts, mappedBy, changed, missing, extra, folders, stored } = leva;
  console.log(
    `\nLeva: 기준 ${counts.old}개 · 새 ${counts.new}개 · 짝지음(같은키 ${mappedBy.exact} / 매핑 ${mappedBy.map} / label ${mappedBy.label})`,
  );
  console.log(
    `  값이 다름 ${changed.length} · 기준에만 ${missing.length} · 새것에만 ${extra.length} · ` +
      `폴더 다중집합 같음 ${folders.same} / 다름 ${folders.differ.length}`,
  );
  for (const c of changed.slice(0, 15))
    console.log(
      `    ≠ ${c.key}${c.newKey !== c.key ? " → " + c.newKey : ""}: ` +
        `${trunc(JSON.stringify(c.old), 60)} → ${trunc(JSON.stringify(c.new), 60)}`,
    );
  for (const k of missing.slice(0, 15)) console.log(`    − ${k}`);
  for (const k of extra.slice(0, 15)) console.log(`    + ${k}`);
  for (const f of folders.differ.slice(0, 10)) {
    const renamed = f.newFolder && f.newFolder !== f.folder ? " → " + f.newFolder : "";
    console.log(
      `    폴더 ${f.folder}${renamed}: ${f.oldCount} → ${f.newCount}개, ` +
        `기준에만 ${JSON.stringify(f.onlyOld.slice(0, 4))} 새것에만 ${JSON.stringify(f.onlyNew.slice(0, 4))}`,
    );
  }
  const suggested = Object.entries(folders.suggestedFolderMap);
  if (suggested.length) {
    const shown = suggested
      .slice(0, 6)
      .map(([a, b]) => `${a}→${b}`)
      .join(", ");
    console.log(
      `  (폴더 이름이 바뀐 것 같은 짝 ${suggested.length}개 — 값 모음이 똑같다: ${shown}${suggested.length > 6 ? " …" : ""})`,
    );
  }
  console.log(
    `  저장소 kgeseo.leva.v1: 기준 ${JSON.stringify(stored.old)} · 새 ${JSON.stringify(stored.new)} · ` +
      `팀기준판 ${stored.oldPan} → ${stored.newPan}`,
  );
}

export const levaProblemCount = (leva) => leva.changed.length + leva.missing.length + leva.extra.length;
