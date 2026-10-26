// visualReview.mjs — 09 시각 자기 검수(10/26 미르: 「에셋 선택·배치가 전혀 나아지지 않는다 · 화면에 빛 무늬가 없는데 왜 풀린다고 봤나」)
//   에이전트가 자기 결과를 「눈으로」 본다. 08 이 지은 방을 플레이 화면 그대로 띄워(Playwright) 단서 자리마다 누르기 전·후 사진을 찍고,
//   방마다 둘러보기 사진을 찍는다. 사진 + 단서 글 + 점검표(사람이 짚었던 것들)를 Claude 에게 주고 판정을 받는다.
//   고칠 수 있는 것(에셋 바꾸기 · 살림 빼기)은 09 가 07·08 을 다시 돌려 고치고 다시 본다(최대 2바퀴). 고칠 수 없는 것(단서가 화면에 안 보임)은 「풀 수 없음」으로 남긴다.
import fs from 'node:fs/promises';
import path from 'node:path';

export const CHECKLIST = {
  clue: [
    ['C1', '단서가 말하는 흔적·물건(빛·그림자·발자국과 그 개수·물·피·물건)이 사진에서 실제로 보이는가 — 단서 글에만 있고 화면에 없으면 풀 수 없다'],
    ['C2', '누른 뒤 물건이 실제로 움직였는가(서랍이 열림·이불이 접힘·밀림·뒤집힘) — 누르기 전·후가 같으면 실패'],
    ['C3', '단서 물건(쪽지·서신·조각)이 물건 밑·안·뒤에서 드러났는가 — 공중에 뜸·물건을 뚫음·벽 속·서랍보다 큼은 실패'],
    ['C4', '단서 글이 가리키는 물건 이름과 사진 속 물건이 같은 종류인가(서안이라 했는데 장롱 등)'],
  ],
  room: [
    ['R1', '공중에 뜬 물건, 벽·기둥·다른 물건을 뚫고 들어간 물건'],
    ['R2', '사람이 입은 모양 그대로 굳어 서 있거나 떠 있는 옷'],
    ['R3', '크기가 상식 밖(방석·소반이 사람 키만 함, 그릇이 상만 함)'],
    ['R4', '그 방 쓰임에 안 맞는 물건(부엌 살림이 사랑방에, 마당 가구 평상이 방 안에)'],
    ['R5', '대청(마루) 가운데에 놓인 가구 — 마루 가운데는 비운다'],
    ['R6', '문 앞·통로를 막은 물건'],
    ['R7', '혼자 서 있을 수 없는 긴 물건(빗자루·도리깨·지게)이 서 있음'],
    ['R8', '조선 민가에 어색한 궁궐 재현품·의례용품'],
    ['R9', '둥근 그릇·항아리 위에 다른 물건을 올림'],
    ['R10', '같은 물건이 여러 개 한 줄로 붙은 묶음 에셋'],
  ],
};

const JUDGE_SYSTEM = `너는 지역 설화 방탈출 게임 「왜곡」의 공간 검수 에이전트다. 에이전트가 지은 조선 후기 민가 방을 플레이 화면 사진으로 보고, 사람 검수자가 짚었을 문제를 미리 찾는다.
- 사진에 보이는 것만 판정한다. 단서 글을 믿지 말고 사진과 대조한다.
- 단서 판정(C1~C4): 단서마다 누르기 전(before)·누른 뒤(after) 사진이 있다. after 사진 아래쪽 카드 글은 화면 안내이므로 판정 근거가 아니다.
- 방 판정(R1~R10): 둘러보기 사진과 단서 사진 전체에서 찾는다. 물건 이름은 [놓인 물건] 목록의 이름 그대로 쓴다.
- 고치는 방법(fix): replace_asset(그 물건을 다른 에셋으로) · remove(퍼즐과 상관없는 살림이면 빼기) · none(에셋·배치로 못 고침 — 예: 단서 글이 화면에 그릴 수 없는 것을 말함).
- 확실하지 않으면 문제로 적지 않는다. 사진이 가려져 판정할 수 없으면 judged:false.
JSON 만 답한다: {"clues":[{"clue_id":"CL-..","judged":true,"ok":true,"fails":["C1"],"why":"한 문장","fix":"none|replace_asset","item":"물건 이름"}],"room":[{"check":"R1","item":"물건 이름","why":"한 문장","fix":"replace_asset|remove|none"}]}`;

/** 08 이 지은 방을 띄워 사진을 찍는다. 반환: [{room, name, shots:[{tag, file}], clues:[{clue_id, node, before, after}]}] */
export async function shoot(root, trialId, { origin = process.env.REVIEW_ORIGIN || 'http://127.0.0.1:5180', outDir }) {
  const { chromium } = await import('playwright');
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await page.goto(`${origin}/__review/trials/${trialId}/rooms/index.html?shoot=${Date.now()}`);
    await page.waitForFunction(() => window.__pz && window.__pz.walk && window.__pz.walk(), null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    const stage = (await page.$('.stage canvas')) || (await page.$('canvas'));
    const clip = await stage.boundingBox();
    const snap = async file => { await page.evaluate(() => { const h = document.getElementById('hint'); if (h) h.style.visibility = 'hidden'; const o = document.getElementById('hold'); if (o) o.style.visibility = 'hidden'; }); await page.screenshot({ path: file, type: 'jpeg', quality: 72, clip }); await page.evaluate(() => { const o = document.getElementById('hold'); if (o) o.style.visibility = ''; }); };
    const plan = await page.evaluate(() => {
      const P = window.__pz, SO = ['combine_clues', 'select', 'input', 'solve'];
      const rooms = [...new Set(P.PZ.flatMap(p => p.hosts.flatMap(h => h.at.map(a => a.room))))];
      const clues = P.PZ.flatMap(p => p.clues.filter(c => !SO.includes(c.get_by)).map(c => { const h = p.hosts.find(h => h.need_id === c.from); const at = h && h.at[0]; return at ? { clue_id: c.id, puzzle: p.id, room: at.room, node: at.node, text: c.text, content: c.content, reveal: c.reveal, carrier: c.carrier } : null; }).filter(Boolean));
      return { rooms, clues, nRooms: document.querySelectorAll('[data-room],.tabs button').length };
    });
    const roomIdx = [...new Set([0, 1, 2, 3, ...plan.rooms])].filter(i => i < 8);
    const out = [];
    for (const ri of roomIdx) {
      const ok = await page.evaluate(async ri => { const P = window.__pz; try { P.show(ri); } catch { return false; } await new Promise(r => setTimeout(r, 1500)); for (let k = 0; k < 20 && !(P.walk && P.walk()); k++) await new Promise(r => setTimeout(r, 400)); await new Promise(r => setTimeout(r, 4000)); return P.room() === ri; }, ri);
      if (!ok) continue;
      const R = { room: ri, name: '', shots: [], clues: [] };
      // 둘러보기 — 방 네 구석에서 반대쪽을 본다
      const w = await page.evaluate(() => window.__pz.walk());
      if (w) {
        const [x0, x1] = w.x, [z0, z1] = w.z; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        for (const [k, [x, z]] of [[x0 + 0.2, z1 - 0.2], [x1 - 0.2, z1 - 0.2], [x1 - 0.2, z0 + 0.2], [x0 + 0.2, z0 + 0.2]].entries()) {
          await page.evaluate(([x, z, cx, cz]) => window.__pz.rayDbg(x, z, cx + (cx - x) * 0.3, 0.6, cz + (cz - z) * 0.3), [x, z, cx, cz]);
          await page.waitForTimeout(500); const f = path.join(outDir, `r${ri}_view${k}.jpg`); await snap(f); R.shots.push({ tag: `둘러보기 ${k + 1}`, file: f });
        }
      }
      for (const c of plan.clues.filter(c => c.room === ri)) {
        const a = await page.evaluate(n => window.__pz.aim(n), c.node);
        await page.waitForTimeout(400);
        const before = path.join(outDir, `r${ri}_${c.clue_id}_a.jpg`); await snap(before);
        await page.evaluate(n => { window.__pz.hit(n); }, c.node);
        await page.waitForTimeout(1600);
        const after = path.join(outDir, `r${ri}_${c.clue_id}_b.jpg`); await snap(after);
        await page.evaluate(() => { const b = document.querySelector('#holdOk'); if (b) b.click(); });
        await page.waitForTimeout(300);
        R.clues.push({ ...c, aim: a, before, after });
      }
      out.push(R);
    }
    return { rooms: out, errors: errs };
  } finally { await browser.close(); }
}

/** 방 하나를 판정한다 — 사진은 jpeg base64, 단서 글·놓인 물건 이름과 함께 */
export async function judgeRoom({ llm, root, trial, step, room, items }) {
  const img = async f => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await fs.readFile(f)).toString('base64') } });
  const content = [{ type: 'text', text: [`[방] ${room.name || `방 ${room.room + 1}`}`, `[놓인 물건] ${items.join(' · ')}`, '[점검표 — 단서]', ...CHECKLIST.clue.map(([k, t]) => `${k} ${t}`), '[점검표 — 방]', ...CHECKLIST.room.map(([k, t]) => `${k} ${t}`)].join('\n') }];
  for (const s of room.shots) { content.push({ type: 'text', text: `— ${s.tag}` }); content.push(await img(s.file)); }
  for (const c of room.clues) {
    content.push({ type: 'text', text: `— 단서 ${c.clue_id} · 누르는 물건 「${c.node}」 · 몸짓 ${c.reveal?.action || '-'}(${c.reveal?.where || '-'}) · 단서 물건 ${c.carrier?.kind || '-'} 「${c.carrier?.name || ''}」\n  글: ${c.text}\n  보이는 것(단서 내용): ${c.content || ''}` });
    content.push({ type: 'text', text: 'before' }); content.push(await img(c.before));
    content.push({ type: 'text', text: 'after' }); content.push(await img(c.after));
  }
  const text = await llm(root, trial, step, { system: JUDGE_SYSTEM, user: content });
  return text;
}
