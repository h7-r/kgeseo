// renderViewer.mjs — 실내 방 뷰어 HTML = 지금의 viewer_template.html + 그 시험의 데이터(10/26)
//   10/26 미르: 고친 뒤에도 예전 시험(97ba1ffa 등)에서 이불이 그대로 떠 있었다 — 08 을 돌린 그때의 템플릿이 index.html 에 굳어 있었다.
//   이제 서버가 index.html 을 줄 때마다 지금 템플릿에 데이터를 끼워 만든다 → 뷰어를 고치면 모든 시험에 바로 반영된다.
const KEYS = [['SC', '/*SCENES*/[]'], ['PZ', '/*PUZZLES*/[]'], ['BK', '/*BAKED*/{}'], ['ITEMS', '/*ITEMS*/[]'], ['TRIAL', '/*TRIAL*/{}']];
const enc = (v, esc = true) => { const s = JSON.stringify(v); return esc ? s.replace(/</g, '\\u003c') : s; };

// 원문 방언 풀어 쓰기(dialect_gloss.json) — 화면에 나오는 퍼즐·장면 글에만
export function glossData(d, gloss) {
  const rules = (gloss?.rules || []).map(r => [new RegExp(r.from, 'g'), r.to]);
  if (!rules.length) return d;
  const fix = v => typeof v === 'string' ? rules.reduce((t, [re, to]) => t.replace(re, to), v) : Array.isArray(v) ? v.map(fix) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v;
  return { ...d, SC: fix(d.SC), PZ: fix(d.PZ) };
}

export function renderViewer(tpl, d, gloss = null) {
  if (gloss) d = glossData(d, gloss);
  let html = tpl;
  for (const [k, mark] of KEYS) html = html.replace(mark, () => enc(d[k] ?? (mark.endsWith('{}') ? {} : []), k !== 'BK'));
  return html;
}

// 예전 index.html 에서 데이터만 꺼낸다 — `const SC=` 뒤의 JSON 값을 괄호·문자열을 따라 끝까지 읽는다
function readValue(s, i) {
  const open = s[i]; if (open !== '[' && open !== '{') return null;
  let depth = 0, str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') { depth--; if (!depth) return s.slice(i, j + 1); }
  }
  return null;
}
export function extractViewerData(html) {
  const d = {};
  for (const [k] of KEYS) {
    const m = html.indexOf(`const ${k}=`); if (m < 0) return null;
    const raw = readValue(html, m + `const ${k}=`.length); if (raw == null) return null;
    try { d[k] = JSON.parse(raw); } catch { return null; }
  }
  return d;
}
