// 사람 작성 01~04 문서에서 "빈 양식"을 뽑는다 — story-trial-1015 실험용.
// 남기는 것: 제목 줄(#), 표 머리줄 + 구분줄, <aside> 표시 줄과 굵은 글씨 이름표, 짧은 굵은 이름표 줄, 구분선(---).
// 버리는 것: 본문, 표 자료 줄, 인용(>) 줄, 목록 줄.
// 예외(보고 대상): '항목|내용' 형태 머리 정보 표는 첫 칸(필드 이름)만 남기고 값은 비운다.
// 이야기 고유 낱말(인물·마을·장소·모티프)은 자리표시로 바꾼다. 원본 파일은 읽기만 한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_DIR = path.join(ROOT, '프로젝트파일/데이터/게임문서');
const OUT_DIR = path.join(ROOT, '.local/experiments/story-trial-1015/input/templates');

export const DOCS = [
  ['01 설화 사실 계약서.md', '01_설화사실계약서.template.md'],
  ['02 지역 테마 시놉시스.md', '02_지역테마시놉시스.template.md'],
  ['03 게임 시나리오 기획서.md', '03_게임시나리오기획서.template.md'],
  ['04 Scene 구성표.md', '04_Scene구성표.template.md'],
];

// 이야기 고유 낱말 → 자리표시 (긴 것부터)
export const SCRUB = [
  ['구렁이와 사랑한 처녀', '[설화 제목]'],
  ['돌아오지 않은 약속', '[에피소드명]'],
  ['엇갈리는 증언', '[Scene 제목]'],
  ['앙암바위의 죽음', '[Scene 제목]'],
  ['지워진 기억', '[Scene 제목]'],
  ['돌아온 이야기', '[Scene 제목]'],
  ['story-naju-01-angam', '[story_id]'],
  ['case-naju-01', '[case_id]'],
  ['NAJU-01', '[MAP_ID]'],
  ['아랑사', '[인물A]'], ['아비사', '[인물B]'],
  ['택촌', '[마을A]'], ['진부촌', '[마을B]'],
  ['구렁이', '[모티프]'], ['씻김굿', '[의례]'],
  ['앙암바위', '[장소]'], ['앙암바우', '[장소]'], ['아망바우', '[장소]'], ['앙암', '[장소]'],
  ['영산포', '[지역]'], ['영산강', '[강]'], ['나주', '[지역]'],
  ['강도윤', '[플레이어 캐릭터]'],
];
// 검사용 — 이 낱말이 양식에 남으면 누출
export const LEAK_WORDS = ['아랑사', '아비사', '택촌', '진부촌', '구렁이', '앙암', '나주', '영산', '씻김굿', '어부', '물고기', '홀아버지', '처녀', '실종', '젊은이', '청년', '무당', '절벽', '약속', '2차 반전', '반전 2', '강도윤', '야외'];

// 제목 H(수준 n)부터 같은/상위 수준 다음 제목 전까지 지우는 정규식
const block = (title, lvl) => new RegExp(`\\n${'#'.repeat(lvl)} ${title.replace(/[[\]()]/g, '\\$&')}[^\\n]*\\n[\\s\\S]*?(?=\\n#{1,${lvl}} )`, 'g');
const POST = {
  '02 지역 테마 시놉시스.md': [
    [block('2차 반전', 2), '\n', '02: 「2차 반전」 블록 삭제(반전 수 누출 방지)'],
    [/## 1차 반전/, '## n차 반전 (반전 수만큼 반복)', '02: 「1차 반전」→「n차 반전」'],
    [block('[인물A]', 2), '\n', '02: §11 인물별 블록을 하나로 접음(인물 이름·수 누출 방지)'],
    [block('[마을B] 젊은이들', 2), '\n', '02: §11 「[마을B] 젊은이들」 블록 삭제'],
    [/## \[인물B\]/, '## [주요 인물] (인물마다 반복)', '02: 「## 아비사」→「## [주요 인물]」'],
    [/### \[인물B\]의 마지막 상태/, '### [핵심 인물]의 마지막 상태', '02: 「아비사의 마지막 상태」→「[핵심 인물]의 마지막 상태」'],
  ],
  '03 게임 시나리오 기획서.md': [
    [block('반전 2', 3), '\n', '03: 「반전 2」 블록 삭제(반전 수 누출 방지)'],
    [/### 반전 1/, '### 반전 n (반전 수만큼 반복)', '03: 「반전 1」→「반전 n」'],
  ],
  '04 Scene 구성표.md': [
    [/## 0\.4 단일 대형 야외 맵 — `\[MAP_ID\]`/, '## 0.4 맵 정의 — `[MAP_ID]`', '04: 「0.4 단일 대형 야외 맵」→「0.4 맵 정의」(공간 결정 누출 방지)'],
    [/## 0\.5 MVP 공간 구현 원칙 — 실제 3D \+ 경량 중·원경 혼합/, '## 0.5 공간 구현 원칙', '04: 0.5 제목의 구현 결정 문구 삭제'],
    [/\n\*\*핵심 퍼즐 없음\*\*\n/, '\n', '04: Scene 1의 「핵심 퍼즐 없음」 줄 삭제(내용)'],
    [/### 강물·산·마을의 기본 처리 원칙/, '### 배경 요소의 기본 처리 원칙', '04: 「강물·산·마을」 제목 일반화'],
    [/\| 단계 \| 같은 야외 맵에서 달라지는 것 \|/, '| 단계 | 같은 맵에서 달라지는 것 |', '04: 0.7 표 머리 일반화'],
  ],
};

const isSep = (l) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

export function scrub(text, log) {
  let out = text;
  for (const [a, b] of SCRUB) {
    if (out.includes(a)) { log?.add(`${a} → ${b}`); out = out.split(a).join(b); }
  }
  return out;
}

export function blankTemplate(md, name, log = new Set()) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inAside = false;
  let kvTable = false;
  let lastSceneSeen = 0;
  let skipScene = false;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    // 04: Scene 양식은 첫 Scene 하나만 남긴다(Scene 수 누출 방지)
    if (/^#\s+Scene\b/.test(l)) {
      lastSceneSeen++;
      if (lastSceneSeen > 1) { skipScene = true; log.add('04: 2번째 이후 Scene 양식 생략(Scene 수 누출 방지)'); continue; }
      out.push('# Scene [nn] — [Scene 제목]   ← Scene 수만큼 이 양식을 반복');
      continue;
    }
    if (skipScene) continue;
    if (/^<aside>/.test(l)) { inAside = true; out.push('<aside>'); continue; }
    if (/^<\/aside>/.test(l)) { inAside = false; out.push('</aside>', ''); continue; }
    if (inAside) {
      const m = l.match(/^\s*(\*\*[^*]+\*\*)/);
      if (m) out.push(m[1] + ':');
      else if (/^\s*\p{Extended_Pictographic}\s*$/u.test(l)) out.push(l.trim());
      continue;
    }
    if (/^#{1,6}\s/.test(l)) { kvTable = false; out.push('', l); continue; }
    if (/^---\s*$/.test(l)) { out.push('', '---'); continue; }
    if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const h = cells(l).map(plain);
      kvTable = h.length === 2 && /^(항목|필드)$/.test(h[0]);
      out.push('', l, lines[i + 1]);
      i++;
      continue;
    }
    if (isRow(l)) {
      if (kvTable) {
        const k = plain(cells(l)[0]);
        if (k.length <= 30) { out.push(`| ${k} |  |`); log.add('항목|내용 표: 필드 이름(첫 칸)만 남김'); }
      }
      continue;
    }
    kvTable = false;
    // 짧은 굵은 이름표 줄(예: **역할**, **진입 전**) — 문장(마침표·따옴표)은 버린다
    const b = l.match(/^\s*\*\*([^*]{1,24})\*\*\s*[:：]?/);
    if (b && !/[.。"“”‘’?!]/.test(b[1])) { out.push('', `**${b[1].trim()}**`); continue; }
  }
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  text = scrub(text, log);
  // 문서별 후처리 — 개수(인물 수·반전 수)와 설계 결정이 양식으로 새지 않게 한다
  for (const [re, rep, note] of POST[name] || []) {
    if (re.test(text)) { text = text.replace(re, rep); log.add(note); }
  }
  text = text.replace(/ ?[🟢🟡🔴]/gu, '');
  return text.replace(/\n{3,}/g, '\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {};
  for (const [src, dst] of DOCS) {
    const log = new Set();
    const md = fs.readFileSync(path.join(SRC_DIR, src), 'utf8');
    const t = blankTemplate(md, src, log);
    const leaks = LEAK_WORDS.filter((w) => t.includes(w));
    fs.writeFileSync(path.join(OUT_DIR, dst), `<!-- AI 시험 생성본 — 원본 아님 (story-trial-1015) · 빈 양식: ${src} 에서 제목·표 머리만 추출 -->\n` + t);
    report[dst] = { scrubbed: [...log], leaks, lines: t.split('\n').length };
  }
  fs.writeFileSync(path.join(OUT_DIR, '_scrub_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
