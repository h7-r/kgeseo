// 실제 크기 정하기(10/19) — 공개 GLB 는 파일 단위가 제각각이다(rock/stone21.glb 원래 키 약 30, 사람은 3.6 m 로 씀).
// 에이전트 배치는 GLB 원래 키를 그대로 쓰면 안 된다 → 근거 순서: 사람 manifest 「놓기」 키m > 라이브러리 실제 크기(boundsM) >
// GLB 원래 키(분류 범위 안일 때만) > 분류 기본값. 결과는 늘 분류 범위 안으로 자른다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// [기본 키 m, 최소, 최대] — 파일 폴더·이름으로 고른다(앞 규칙 우선)
const RULES = [
  [/^tree\//, [7, 3, 14], '나무'],
  // 폴더가 아니라 이름으로도 분류(10/20) — lib/ast-terrain-tree-broadleaf-01 같은 나무가 「라이브러리 소품」 범위(최대 6 m)에 걸려
  //   모두 6 m 로 잘려 같은 크기로 서 있었다(미르: 큰 나무 세 그루가 일정하게)
  [/(^|[/_-])(tree|willow|broadleaf|pine)[^/]*\.glb$/i, [7, 3, 14], '나무'],
  [/(^|[/_-])(bush|shrub|foliage)[^/]*\.glb$/i, [1.0, 0.3, 2.5], '덤불·관목'],
  [/^house\//, [4.5, 3, 7], '집'],
  [/^rock\//, [1.0, 0.2, 4], '바위·돌'],
  [/^plant2\//, [0.3, 0.05, 0.8], '들꽃·잔풀'],
  [/^plant\/reed/, [1.4, 0.8, 2.2], '갈대'],
  [/^plant\/(grass|gc)/, [0.5, 0.15, 1.0], '풀'],
  [/^plant\/flower/, [0.4, 0.1, 0.8], '꽃'],
  [/^plant\//, [1.0, 0.3, 2.0], '덤불·관목'],
  [/^prop\//, [1.0, 0.1, 2.5], '생활 소품'],
  [/^khs\//, [0.5, 0.03, 3], '국가유산 소품'],
  [/^(codeprops|lib)\//, [1.0, 0.03, 6], '라이브러리 소품'],
];
const DEFAULT_RULE = [1.0, 0.05, 6];

let humanCache = null;
async function humanHeights(root) {
  if (humanCache) return humanCache;
  const map = new Map();
  try {
    const m = JSON.parse(await readFile(join(root, 'public/_sf_local/manifest.json'), 'utf8'));
    for (const e of m.놓기 || []) for (const f of e.files || (e.file ? [e.file] : [])) if (f && Number.isFinite(e.키m)) map.set(f, [...(map.get(f) || []), e.키m]);
  } catch { /* manifest 없음 */ }
  humanCache = new Map([...map].map(([f, list]) => [f, list.sort((a, b) => a - b)[Math.floor(list.length / 2)]]));
  return humanCache;
}

/** file: _sf_local 아래 경로 · naturalHeightM: GLB 원래 키 · boundsM: 라이브러리 [가로, 키, 깊이] m */
export async function realHeight(root, { file, naturalHeightM = null, boundsM = null }) {
  const rule = RULES.find(([re]) => re.test(file || ''));
  const [base, min, max] = rule ? rule[1] : DEFAULT_RULE;
  const clamp = v => Math.min(max, Math.max(min, v));
  const human = (await humanHeights(root)).get(file);
  if (Number.isFinite(human)) return { heightM: human, range: [min, max], source: '사람 배치 크기' };
  const meta = Array.isArray(boundsM) ? Number(boundsM[1]) : NaN;
  if (Number.isFinite(meta) && meta > 0) return { heightM: +clamp(meta).toFixed(3), range: [min, max], source: '라이브러리 실제 크기' };
  if (Number.isFinite(naturalHeightM) && naturalHeightM >= min && naturalHeightM <= max) return { heightM: +naturalHeightM.toFixed(3), range: [min, max], source: 'GLB 원래 키' };
  return { heightM: base, range: [min, max], source: `${rule ? rule[2] : '기타'} 기본값(GLB 원래 키 ${Number.isFinite(naturalHeightM) ? naturalHeightM.toFixed(1) : '미상'} m 는 범위 밖)` };
}
/** 에이전트 scale(0.7~1.3)을 곱해 범위 안으로 */
export function scaledHeight(real, scale = 1) {
  const s = Number.isFinite(scale) ? Math.min(1.3, Math.max(0.7, scale)) : 1;
  return +Math.min(real.range[1], Math.max(real.range[0], real.heightM * s)).toFixed(3);
}
