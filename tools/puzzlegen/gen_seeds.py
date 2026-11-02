#!/usr/bin/env python3
"""퍼즐 「답 뼈대」 생성기 (10/23 v0) — 답은 코드가 만들고, 정답이 하나뿐인지 코드가 확인한다.
LLM 은 이 뼈대를 설화 단서로 「옷 입히는」 일만 한다(답을 지어내지 않음).

  ~/mrg_venv/bin/python tools/puzzlegen/gen_seeds.py --seed 42 --out .local/review/puzzle_seeds/seeds_1023.json

만드는 것
- sudoku4 : 4×4 산가지 셈판. 다국어 Reasoning Gym mini_sudoku 로 판을 만들고, 우리 풀이기로 해가 하나인지 다시 센다.
            빈칸 중 줄마다 한 칸씩 4칸을 「답 칸」으로 골라 위→아래로 읽은 4자리를 자물쇠 답으로 쓴다.
- crypt22 : 두 자리 + 두 자리 = 세 자리 글자셈. Reasoning Gym 원본은 해가 여럿일 수 있어(유일성 검사 없음) 우리 코드로 만들고
            모든 두 자리 쌍을 대입해 해가 정확히 하나인 것만 고른다(여럿이면 글자 하나의 값을 실마리로 주고 다시 센다). 답 = 합(세 자리).
"""
import argparse, itertools, json, pathlib, random

def sudoku_solutions(board, limit=2):
    """4×4 스도쿠 해 개수(limit 까지만 셈)."""
    b = [row[:] for row in board]; sols = []
    def ok(r, c, v):
        if v in b[r] or v in (b[i][c] for i in range(4)): return False
        br, bc = r // 2 * 2, c // 2 * 2
        return all(b[i][j] != v for i in range(br, br + 2) for j in range(bc, bc + 2))
    def go():
        for r in range(4):
            for c in range(4):
                if b[r][c] == 0:
                    for v in range(1, 5):
                        if ok(r, c, v):
                            b[r][c] = v; go(); b[r][c] = 0
                            if len(sols) >= limit: return
                    return
        sols.append([row[:] for row in b])
    go(); return sols

def make_sudoku(seed, empty):
    import reasoning_gym
    ds = reasoning_gym.create_dataset('mini_sudoku', size=20, seed=seed, languages='ko', min_empty=empty, max_empty=empty)
    rng = random.Random(seed)
    for i, x in enumerate(ds):
        puz = [[int(v) for v in row] for row in x['metadata']['puzzle']]
        sols = sudoku_solutions(puz)
        if len(sols) != 1: continue
        sol = sols[0]
        cells = []
        for r in range(4):
            blanks = [c for c in range(4) if puz[r][c] == 0]
            if not blanks: break
            cells.append([r, rng.choice(blanks)])
        if len(cells) != 4: continue
        code = ''.join(str(sol[r][c]) for r, c in cells)
        assert ds.score_answer(answer=x['answer'], entry=x) == 1.0
        return {'kind': 'sudoku4', 'source': f'multilingual reasoning_gym mini_sudoku seed={seed} index={i} empty={empty}',
                'puzzle': puz, 'solution': sol, 'answer_cells': cells, 'answer': code,
                'unique': True, 'answer_rule': '답 칸(줄마다 한 칸)을 위 줄부터 읽은 4자리'}
    raise SystemExit('조건에 맞는 스도쿠를 못 찾음 — seed 를 바꾸세요')

def crypt_solutions(a, b, s, fixed=None, limit=2):
    """두 자리 + 두 자리 = 세 자리 글자셈의 해를 센다(모든 두 자리 쌍을 대입 — 빠르고 빠짐없음)."""
    fixed = fixed or {}; sols = []
    for x in range(10, 100):
        for y in range(10, 100):
            z = x + y
            if z < 100: continue
            m, used, okk = {}, {}, True
            for w, n in ((a, x), (b, y), (s, z)):
                for ch, d in zip(w, str(n)):
                    d = int(d)
                    if m.get(ch, d) != d or used.get(d, ch) != ch: okk = False; break
                    m[ch] = d; used[d] = ch
                if not okk: break
            if okk and all(m.get(k) == v for k, v in fixed.items()):
                sols.append(m)
                if len(sols) >= limit: return sols
    return sols

def make_crypt(seed, symbols):
    rng = random.Random(seed)
    for _ in range(5000):
        x, y = rng.randint(10, 99), rng.randint(10, 99)
        z = x + y
        if z < 100 or len(set(str(z))) < 3 or '0' in str(z): continue  # 답이 100·111 처럼 뻔하지 않게
        ds = sorted(set(f'{x}{y}{z}'))
        if not 4 <= len(ds) <= len(symbols): continue
        pool = symbols[:]; rng.shuffle(pool)
        d2s = dict(zip(ds, pool))
        A, B, S = (''.join(d2s[c] for c in str(n)) for n in (x, y, z))
        mapping = {d2s[d]: int(d) for d in ds}
        given = {}
        if len(crypt_solutions(A, B, S)) != 1:
            # 해가 여럿이면 「글자 하나의 값」을 쪽지로 알려 준다(방탈출에서 흔한 실마리) — 그래도 하나가 아니면 버린다
            for ch in sorted(mapping, key=lambda k: -(A + B + S).count(k)):
                if ch == S[0]: continue  # 맨 앞 1 은 스스로 알아내게
                if len(crypt_solutions(A, B, S, {ch: mapping[ch]})) == 1: given = {ch: mapping[ch]}; break
            if not given: continue
        return {'kind': 'crypt22', 'source': f'gen_seeds.py crypt22 seed={seed}', 'addends': [A, B], 'sum': S,
                'mapping': mapping, 'given': given, 'values': [x, y, z], 'answer': str(z), 'unique': True,
                'answer_rule': '합(세 자리)'}
    raise SystemExit('해가 하나뿐인 글자셈을 못 찾음 — seed 를 바꾸세요')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--empty', type=int, default=8, help='스도쿠 빈칸 수(쉬움 6~8)')
    ap.add_argument('--symbols', default='쌀,콩,팥,조,깨,밀', help='글자셈에 쓸 글자(쉼표)')
    ap.add_argument('--out', default='.local/review/puzzle_seeds/seeds.json')
    a = ap.parse_args()
    seeds = {'version': 'gen_seeds v0 (10/23)', 'seed': a.seed,
             'sudoku4': make_sudoku(a.seed, a.empty), 'crypt22': make_crypt(a.seed, a.symbols.split(','))}
    out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(seeds, ensure_ascii=False, indent=1), encoding='utf-8')
    s, c = seeds['sudoku4'], seeds['crypt22']
    print('스도쿠 판:'); [print('  ', ' '.join(str(v) if v else '_' for v in row)) for row in s['puzzle']]
    print(f"  답 칸 {s['answer_cells']} → 답 {s['answer']} (해 1개 확인)")
    print(f"글자셈: {c['addends'][0]} + {c['addends'][1]} = {c['sum']}  주어진 값 {c['given'] or '없음'} → 답 {c['answer']} (해 1개 확인, 실제 {c['values']})")
    print('저장:', out.resolve())

if __name__ == '__main__':
    main()
