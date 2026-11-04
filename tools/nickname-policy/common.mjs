// 세 검사가 같이 쓰는 것: 경로, 공용 규칙 파일, 재현되는 난수.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const CACHE = path.join(HERE, ".cache");

export const loadPolicy = () => JSON.parse(fs.readFileSync(path.join(ROOT, "shared/nickname-policy.json"), "utf8"));

/** 고정 시드 난수(선형 합동). 같은 시드면 어느 컴퓨터에서든 같은 입력이 나온다. */
export function seeded(seed) {
  let state = seed >>> 0;
  const next = () => (state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return {
    next,
    pick: (list) => list[Math.floor(next() * list.length)],
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  };
}

export const percent = (part, whole) => (whole ? ((100 * part) / whole).toFixed(3) : "0.000");
