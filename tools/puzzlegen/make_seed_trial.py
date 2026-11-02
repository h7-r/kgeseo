#!/usr/bin/env python3
"""생성기 답 뼈대(gen_seeds.py)를 「나주 동문다리의 귀신」 실내 시험에 퍼즐 2개로 붙여 새 시험을 만든다 (10/23 v0).

  python3 tools/puzzlegen/make_seed_trial.py --src 510a67b6-511b-4929-b13c-168d7dec1e42 --seeds .local/review/puzzle_seeds/seeds_1023.json
  → .local/review/trials/<새 id>/ 를 만들고 id 를 출력. 원래 시험(--src)은 건드리지 않는다.
  다음: node tools/rooms/build-trial.mjs <새 id>  (08 방·배치·퍼즐 연결 다시 짓기, 비용 0)

- 답(숫자)은 seeds 에서만 가져온다. 이 파일의 문장 틀은 「설화 옷 입히기」를 사람이(Claude) 쓴 v0 — 다음 단계에서 05 에이전트가 같은 일을 하게 한다.
- 공간은 그대로 쓰고 퍼즐 호스트만 기존 물건에 붙인다: 부엌 소반·급히 남긴 쪽지·찬장(대청 → 부엌으로 옮김), 곳간 섬·말·낡은 궤.
"""
import argparse, datetime, json, pathlib, shutil, uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRIALS = ROOT / '.local/review/trials'

def board_text(puz, cells):
    mark = {tuple(c) for c in cells}
    rows = []
    for r, row in enumerate(puz):
        rows.append(' '.join(str(v) if v else ('◎' if (r, c) in mark else '□') for c, v in enumerate(row)))
    return '\n'.join(rows)

def pz_sudoku(s):
    return {
        "puzzle_id": "PZ-09", "scene_id": "scene-03", "title": "흐트러진 산가지 셈판",
        "discoveries": ["RD-S3-G1"], "puzzle_type": "code_input",
        "belief_before": "부엌에는 밤새 기다린 흔적만 있고, 찬장은 왜 잠겼는지 모른다.",
        "how": "소반 위 산가지 셈판과 급히 남긴 쪽지의 셈 규칙을 본다. 빈칸을 채우고 그을린 네 칸의 수를 위 줄부터 찬장의 산가지 자물쇠에 놓는다.",
        "learns": "장인은 밤새 사위를 기다리며 셈판에 시각을 놓아 셌다. 찬장 안에는 손대지 않은 사위 상이 그대로 있다.",
        "clues": [
            {"clue_id": "CL-09-1", "text": "소반 위에 산가지가 흐트러진 셈판이 있다.", "get_by": "inspect", "from": "PZ-09-H1",
             "reveal": {"action": "look", "where": "on", "reaction": "소반 위 셈판에 산가지 몇 묶음이 빠져 칸이 비어 있다. 몇 칸은 등잔 그을음이 앉아 거뭇하다."},
             "carrier": {"kind": "mark", "name": "산가지 셈판"},
             "content": "셈판(가로 넷·세로 넷, 칸마다 산가지 묶음)\n" + board_text(s['puzzle'], s['answer_cells']) + "\n□ 빈칸 · ◎ 그을음이 앉은 빈칸",
             "basis": ["F-10"]},
            {"clue_id": "CL-09-2", "text": "부엌에 급히 남긴 쪽지에 셈 버릇이 적혀 있다.", "get_by": "inspect", "from": "PZ-09-H2",
             "reveal": {"action": "look", "where": "on", "reaction": "부뚜막 곁에 접힌 쪽지가 펼쳐진다."},
             "carrier": {"kind": "note", "name": "급히 남긴 쪽지"},
             "content": "밤 시각은 셈판에 놓아 센다.\n가로 한 줄, 세로 한 줄, 네 귀 네모마다 하나·둘·셋·넷을 한 번씩 놓는다.\n그을린 칸의 셈이 찬장 셈이다.",
             "basis": ["F-10"]},
        ],
        "solve": {"interaction": "input", "at": "PZ-09-H3", "prompt": "그을린 네 칸의 산가지 수를 위 줄부터 놓으시오.", "options": None,
                  "answer": s['answer'],
                  "answer_from": f"쪽지의 규칙(줄·칸·네모마다 1~4 한 번)으로 셈판 빈칸을 채우면 해는 하나뿐이고, ◎ 칸 {s['answer_cells']}을 위 줄부터 읽으면 {s['answer']}.",
                  "required_clue_ids": ["CL-09-1", "CL-09-2"],
                  "device": {"kind": "sangaji", "name": "부엌 찬장 산가지 자물쇠", "on": "PZ-09-H3", "spec": {"digits": 4}}},
        "invented": ["셈판 규칙(4×4, 줄·칸·네모마다 1~4)과 숫자는 게임 장치", "장인이 산가지로 시각을 셌다는 것은 게임 창작(원문은 밤새 기다렸다는 것까지)"],
        "hint_1": "쪽지대로라면 한 줄에 같은 수가 두 번 올 수 없다. 이미 놓인 수가 많은 줄부터 채운다.",
        "hint_2": f"그을린 칸은 위에서부터 {', '.join(s['answer'])}. {s['answer']}를 놓는다.",
        "success_effects": [{"type": "clue_acquired", "target_id": "CL-09-R"}, {"type": "puzzle_completed", "target_id": "PZ-09"}],
        "exit": None, "basis": ["F-10"],
        "logic": "4×4 라틴 방진(2×2 네모 조건 포함) — 생성기가 해가 하나뿐임을 확인함.",
        "difficulty": "medium",
        "host_needs": [
            {"need_id": "PZ-09-H1", "kind": "readable_surface", "what": "산가지 셈판이 놓인 소반", "object_examples": ["소반"], "place_hint": "부엌", "count": 1, "gives": ["CL-09-1"]},
            {"need_id": "PZ-09-H2", "kind": "inspectable_object", "what": "셈 버릇을 적은 쪽지", "object_examples": ["급히 남긴 쪽지"], "place_hint": "부엌", "count": 1, "gives": ["CL-09-2"]},
            {"need_id": "PZ-09-H3", "kind": "answer_device", "what": "산가지 자물쇠로 잠긴 찬장", "object_examples": ["찬장"], "place_hint": "부엌", "count": 1, "gives": []},
        ],
        "status": "draft", "blocked_reason": None,
        "generated_by": {"answer": s['source'], "unique": s['unique'], "dress": "make_seed_trial.py v0 문장 틀(사람 작성)"},
    }

def pz_crypt(c):
    A, B, S = c['addends'][0], c['addends'][1], c['sum']
    given = ''.join(f"{k}은(는) {v}. " for k, v in c['given'].items())
    return {
        "puzzle_id": "PZ-10", "scene_id": "scene-04", "title": "곳간 섬 셈",
        "discoveries": ["RD-S4-G1"], "puzzle_type": "code_input",
        "belief_before": "「이것을 갖고 가면 둘이 먹고 살 수 있다」는 말이 무엇을 가리켰는지 모른다.",
        "how": "섬 꼬리표의 글자 셈과 말 안쪽에 적힌 셈 규칙을 본다. 글자마다 수를 찾아 합을 낡은 궤의 산가지 자물쇠에 놓는다.",
        "learns": "곳간 셈은 맞아떨어지고 궤도 잠긴 그대로다. 그 말이 무엇을 가리켰는지는 여전히 정하지 않는다.",
        "clues": [
            {"clue_id": "CL-10-1", "text": "섬에 매단 꼬리표에 수 대신 곡식 이름으로 셈이 적혀 있다.", "get_by": "inspect", "from": "PZ-10-H1",
             "reveal": {"action": "look", "where": "on", "reaction": "섬 끈에 묶인 꼬리표가 달빛에 드러난다."},
             "carrier": {"kind": "mark", "name": "섬 꼬리표"},
             "content": f"  {A}\n+ {B}\n-----\n {S}", "basis": ["F-07"]},
            {"clue_id": "CL-10-2", "text": "되질하는 말 안쪽에 셈 읽는 법이 적혀 있다.", "get_by": "inspect", "from": "PZ-10-H2",
             "reveal": {"action": "look", "where": "inside", "reaction": "말을 기울이자 안쪽 바닥에 쓴 글씨가 보인다."},
             "carrier": {"kind": "mark", "name": "말 안쪽 글씨"},
             "content": f"같은 글자는 같은 수, 다른 글자는 다른 수. 맨 앞 글자는 0이 아니다. {given}".strip(), "basis": ["F-07"]},
        ],
        "solve": {"interaction": "input", "at": "PZ-10-H3", "prompt": "꼬리표 셈의 합을 산가지로 놓으시오.", "options": None,
                  "answer": c['answer'],
                  "answer_from": f"{A}={c['values'][0]}, {B}={c['values'][1]} 이므로 합 {S}={c['values'][2]}. 생성기가 해가 하나뿐임을 확인함.",
                  "required_clue_ids": ["CL-10-1", "CL-10-2"],
                  "device": {"kind": "sangaji", "name": "곳간 낡은 궤 산가지 자물쇠", "on": "PZ-10-H3", "spec": {"digits": 3}}},
        "invented": ["곡식 이름 글자셈과 숫자는 게임 장치", "곳간 셈을 「이것」과 잇는 것은 게임 창작 — 무엇을 가리켰는지는 정하지 않음"],
        "hint_1": f"두 자리 둘을 더해 세 자리가 되면 맨 앞은 1뿐이다. {S[0]}부터 정한다.",
        "hint_2": f"합은 {c['answer']}. {c['answer']}를 놓는다.",
        "success_effects": [{"type": "clue_acquired", "target_id": "CL-10-R"}, {"type": "puzzle_completed", "target_id": "PZ-10"}],
        "exit": None, "basis": ["F-07"],
        "logic": "두 자리 + 두 자리 = 세 자리 복면산 — 생성기가 해가 하나뿐임을 확인함(필요하면 글자 하나의 값을 실마리로 줌).",
        "difficulty": "medium",
        "host_needs": [
            {"need_id": "PZ-10-H1", "kind": "readable_surface", "what": "꼬리표가 매달린 섬", "object_examples": ["섬"], "place_hint": "곳간", "count": 1, "gives": ["CL-10-1"]},
            {"need_id": "PZ-10-H2", "kind": "readable_surface", "what": "안쪽에 글씨가 있는 말(되)", "object_examples": ["말"], "place_hint": "곳간", "count": 1, "gives": ["CL-10-2"]},
            {"need_id": "PZ-10-H3", "kind": "answer_device", "what": "산가지 자물쇠로 잠긴 궤", "object_examples": ["낡은 궤"], "place_hint": "곳간", "count": 1, "gives": []},
        ],
        "status": "draft", "blocked_reason": None,
        "generated_by": {"answer": c['source'], "unique": c['unique'], "dress": "make_seed_trial.py v0 문장 틀(사람 작성)"},
    }

# (방, 물건 이름) → 붙일 퍼즐 호스트
HOSTS = {('r3', '소반'): 'PZ-09-H1', ('r3', '급히 남긴 쪽지'): 'PZ-09-H2', ('r3', '찬장'): 'PZ-09-H3',
         ('r4', '섬'): 'PZ-10-H1', ('r4', '말'): 'PZ-10-H2', ('r4', '낡은 궤'): 'PZ-10-H3'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--seeds', required=True)
    a = ap.parse_args()
    seeds = json.loads(pathlib.Path(a.seeds).read_text(encoding='utf-8'))
    src = TRIALS / a.src
    nid = str(uuid.uuid4()); dst = TRIALS / nid
    shutil.copytree(src, dst)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    t = json.loads((dst / 'trial.json').read_text(encoding='utf-8'))
    t.update(id=nid, createdAt=now, updatedAt=now, title=f"나주 동문다리의 귀신 — 생성기 퍼즐 시험(복면산·스도쿠, {datetime.date.today():%m/%d})",
             derivedFrom=a.src, seeds={'file': str(pathlib.Path(a.seeds)), 'version': seeds.get('version'), 'seed': seeds.get('seed')})
    (t.get('steps') or {}).pop('s08', None)
    (dst / 'trial.json').write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding='utf-8')

    plan = json.loads((dst / 'indoor_plan.json').read_text(encoding='utf-8'))
    hit = set()
    for cnt in plan['contents']:
        if cnt['name_ko'] == '찬장' and cnt['room'] == 'r2': cnt['room'] = 'r3'  # 찬장은 부엌 살림(대청은 벽 가구만)
        k = (cnt['room'], cnt['name_ko'])
        if k in HOSTS and k not in hit:
            cnt['serves'] = list(dict.fromkeys((cnt.get('serves') or []) + [HOSTS[k]])); hit.add(k)
    missing = [k for k in HOSTS if k not in hit]
    if missing: raise SystemExit(f'공간 계획에 없는 물건: {missing}')
    (dst / 'indoor_plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding='utf-8')

    doc = json.loads((dst / 'puzzle.json').read_text(encoding='utf-8'))
    doc['puzzles'] = [p for p in doc['puzzles'] if p['puzzle_id'] not in ('PZ-09', 'PZ-10')]
    i3 = max(i for i, p in enumerate(doc['puzzles']) if p['scene_id'] == 'scene-03')
    doc['puzzles'].insert(i3 + 1, pz_sudoku(seeds['sudoku4']))
    doc['puzzles'].append(pz_crypt(seeds['crypt22']))
    (dst / 'puzzle.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
    print(nid)

if __name__ == '__main__':
    main()
