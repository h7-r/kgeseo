// build-trial.mjs — 에이전트 시험(실내)의 08 「방 만들기·배치」를 검수 서버 밖에서 돌린다(비용 0, LLM 없음).
//   node tools/rooms/build-trial.mjs <시험 id>
//   06·07 결과(indoor_plan.json · indoor_selection.json)를 읽어 .local/review/trials/<id>/rooms/ 에 방·뷰어를 만든다.
//   환경 변수: ROOMS_PYTHON(기본 python3) · ROOMS_COMPOSE(compose.mjs 를 다른 곳에서 돌릴 때)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndoor } from '../review/indoorTrial.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id || '')) { console.error('사용법: node tools/rooms/build-trial.mjs <시험 id>'); process.exit(2); }
const trialDirOf = (root, tid) => path.join(root, '.local/review/trials', tid);
const dir = trialDirOf(ROOT, id);
const trial = JSON.parse(await fs.readFile(path.join(dir, 'trial.json'), 'utf8'));
const readJsonOut = async (root, t, name) => { try { return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); } catch { return null; } };
const writeOut = async (root, t, name, text) => fs.writeFile(path.join(dir, name), text);
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const result = await buildIndoor(ROOT, trial, { readJsonOut, writeOut, fail, trialDirOf });
// 원안 비교판(06 그대로, 10/22) — rooms_raw/
try { result.raw = await buildIndoor(ROOT, trial, { readJsonOut, writeOut, fail, trialDirOf }, { raw: true }); } catch (e) { result.rawError = e.message; console.error('원안 비교판 실패:', e.message); }
// 시험 기록의 08 상태도 맞춰 둔다(화면이 결과를 읽게)
const fresh = JSON.parse(await fs.readFile(path.join(dir, 'trial.json'), 'utf8'));
fresh.steps ||= {};
fresh.steps.s08 = { status: 'done', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result, costUsd: 0, provider: 'code', error: null };
fresh.updatedAt = new Date().toISOString();
await fs.writeFile(path.join(dir, 'trial.json'), JSON.stringify(fresh, null, 2));
console.log(JSON.stringify(result));
