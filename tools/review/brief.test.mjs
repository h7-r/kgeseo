import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { briefBlockers, briefContentHash, currentBrief, decideBriefItem, locateQuote, storeBrief, validateBrief } from './brief.mjs';

const project = {
  id: 'p1',
  revision: 3,
  sourceText: '택촌에 사는 아랑사라는 어부가\n고기잡이를 하는데 건너편에서 소리가 들렸다.',
  synopsis: '아랑사는 진부촌의 어부로, 매일 밤 절벽에 올랐다.',
  sceneNotes: '씬 1: 나루터에서 그물을 고친다.',
};

test('인용 위치 — 공백 차이만 허용', () => {
  assert.equal(locateQuote(project.sourceText, '아랑사라는 어부가 고기잡이를'), project.sourceText.indexOf('아랑사'));
  assert.equal(locateQuote(project.sourceText, '아랑사는 어부'), -1);
});

test('카드 검사 — 원문에 없는 인용은 뺀다', () => {
  const out = validateBrief(project, {
    docs: [{ doc: 'A', summary: ['아랑사는 택촌 어부'] }],
    items: [
      { doc: 'B', kind: 'conflict', severity: 'high', quote: '아랑사는 진부촌의 어부로', against: { doc: 'A', quote: '택촌에 사는 아랑사라는 어부가' }, why: '마을이 바뀌었다' },
      { doc: 'B', kind: 'invented', severity: 'low', quote: '매일 밤 절벽에 오른다', why: '지어낸 인용' },
      { doc: 'Z', kind: 'gap', quote: 'x', why: 'y' },
    ],
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].against.verified, true);
  assert.equal(out.rejected.length, 2);
  assert.equal(out.docs.length, 3);
});

test('저장 · 판정 · 승인 막기 · 내용 바뀌면 옛 카드', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brief-'));
  const checked = validateBrief(project, { docs: [], items: [{ doc: 'B', kind: 'conflict', severity: 'high', quote: '아랑사는 진부촌의 어부로', why: '마을' }] });
  await storeBrief(dir, project, { createdAt: 'now', ...checked });
  let { brief, contentHash } = await currentBrief(dir, project);
  assert.equal(briefBlockers(brief)[0].code, 'brief_pending');
  await assert.rejects(decideBriefItem(dir, project, { contentHash, itemId: 'c01', decision: 'issue', reviewer: '미르' }), /한 줄/);
  await decideBriefItem(dir, project, { contentHash, itemId: 'c01', decision: 'issue', note: '택촌으로 고칠 것', reviewer: '미르' });
  ({ brief } = await currentBrief(dir, project));
  assert.equal(briefBlockers(brief)[0].code, 'brief_issue');
  await decideBriefItem(dir, project, { contentHash, itemId: 'c01', decision: 'ok', reviewer: '미르' });
  ({ brief } = await currentBrief(dir, project));
  assert.equal(briefBlockers(brief).length, 0);
  const changed = { ...project, synopsis: project.synopsis + ' 고침' };
  assert.notEqual(briefContentHash(changed), contentHash);
  const now = await currentBrief(dir, changed);
  assert.equal(now.brief, null);
  assert.equal(now.stale, 1);
  await assert.rejects(decideBriefItem(dir, changed, { contentHash, itemId: 'c01', decision: 'ok', reviewer: '미르' }), /옛 내용/);
});
