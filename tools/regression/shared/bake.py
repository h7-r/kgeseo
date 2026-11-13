"""probe 실험(exp json) + 그 로그(GOTO/AIM 줄)를 회귀 경로 단계로 옮겨 적는다.
   python3 bake.py <exp.json> <probe.log> <out.json>
   goTo → (mouse, hold) 열거 / aimAt → 보정 이동 셋 + 조준 이동 + run 100 / probe → checkpoint"""
import json, re, sys

exp = json.load(open(sys.argv[1]))
log = open(sys.argv[2]).read().splitlines()
gotos = [l for l in log if l.startswith("GOTO ") and "steps=" in l]
aims = [l for l in log if l.startswith("AIM ")]
ensures = [l for l in log if l.startswith("ENSURE ")]
ei = 0

NAMES = {
    "36": ("36-full-power", "시험반을 맞춰 완전 전원 — 복도 전체 점등"),
    "37": ("37-end-door-unlocked", "끝문 전기 잠금 해제 버튼"),
    "38": ("38-end-door-open", "끝문 열림"),
    "40": ("40-coin-cup-held", "컵 동전을 든 화면"),
    "41": ("41-coffee-dispensed", "커피 자판기 — 동전을 넣고 버튼, 커피가 나온다"),
    "42": ("42-coffee-door-open", "커피 배출구 문 열림"),
    "43": ("43-coffee-cup-held", "커피 컵을 든 화면"),
    "44": ("44-coffee-after-drinking", "커피를 다 마신 뒤"),
    "45": ("45-coin-can-held", "캔 동전을 든 화면"),
    "46": ("46-drink-dispensed-blue", "파란 캔 + 밸브 힌트 쪽지 배출"),
    "47": ("47-drink-cover-open", "음료 배출구 덮개 열림 — 캔과 쪽지"),
    "48": ("48-hint-paper-held", "밸브 힌트 쪽지를 든 화면"),
    "49": ("49-hint-paper-stored", "H — 쪽지를 힌트함에 적어 넣고 바로 보여 줌"),
    "50": ("50-can-held", "파란 캔을 든 화면"),
    "51": ("51-can-finished", "캔을 다 마신 뒤"),
    "52": ("52-hydrant-front", "소화전함 앞"),
    "53": ("53-hydrant-lock-closeup", "소화전 자물쇠 조작 모드(5칸)"),
    "54": ("54-lock-dialed", "자물쇠 벽함:소화전:-20.2,15.2 를 정답 글자로 맞춘 화면(E 직전)"),
    "55": ("55-hydrant-open", "소화전함 문 열림 — 관창·밸브"),
    "56": ("56-panel-open", "배전반 문 열림 — 색 선 셋 · 차단기 여섯(관창은 아직 소화전함에)"),
    "57": ("57-panel-wired", "배전반 선 셋을 제 색에 꽂음 — 이제 소화전함 관창과 배전반 구멍이 빛난다"),
    "58": ("58-panel-switches-up", "차단기 여섯을 모두 올림"),
    "59": ("59-nozzle-held", "회로가 다 살아난 뒤 소화전함에서 관창을 꺼내 든 화면(#134 — 배선 전엔 안 집힌다)"),
    "60": ("60-panel-nozzle-plugged", "관창을 배전반 구멍에 꽂음"),
    "61": ("61-valve-cutscene-start", "밸브 [E] — 자판기 쪽으로 컷신 시작"),
    "62": ("62-valve-cutscene-mid", "컷신 중 — 음료 자판기가 밀려난다"),
    "e63": ("63-valve-cutscene-end", "컷신 끝 — 1인칭 복귀"),
    "e64": ("64-secret-door-view", "자판기가 비켜선 자리 — 본부실로 가는 문"),
    "e65": ("65-lobby-entered", "수사 본부실에 들어선 첫 화면"),
    "e66": ("66-dispatch-card", "본부실 5초 뒤 — 긴급 호출 카드"),
    "67": ("67-dispatch-guide", "E — 카드 닫힘, 임무 목표 + 바닥 화살표"),
    "68": ("68-cabinet-cab0-open", "캐비닛 cab0 서랍 열기"),
    "69": ("69-cabinet-cab1-open", "캐비닛 cab1 서랍 열기"),
    "70": ("70-cabinet-cab2-open", "캐비닛 cab2 서랍 열기"),
    "71": ("71-mug-held-1p", "머그컵을 든 1인칭(본부실은 3인칭으로 들어오므로 67 뒤 V 로 1인칭)"),
    "72": ("72-mug-held-3p", "V — 머그컵을 든 3인칭(팔 IK)"),
    "73": ("73-mug-placed-3p", "3인칭에서 머그 내려놓기"),
    "74": ("74-laptop-held", "노트북(두 손 물건)을 든 1인칭"),
    "75": ("75-chair-dragging", "의자를 끌며 뒤로 걸음"),
    "76": ("76-train-door-approach", "바닥 화살표를 따라 기차 오른쪽 문 앞(문 2.2m)"),
    "77": ("77-train-interior", "기차 안(/train)"),
    "78": ("78-hologram-view", "기차 안 안내판 홀로그램을 겨눠 E — 목적지 창(지역 선택)"),
    "79": ("79-hologram-naju-selected", "창에서 나주를 눌러 선택 — 나주의 전설"),
    "80": ("80-naju-entry-cinematic", "E — 나주 진입 연출(암전·로딩 영상)"),
    "81": ("81-naju-first-screen", "나주(naju01) 첫 화면 — 로딩 영상은 진짜 시간이라 비결정 구간"),
}
EXPECT = {
    "49": ["힌트 메모", "자판기 배출구에서 캔과 함께 나온"],
    "e66": ["긴급 호출", "나주 앙암바위, 왜곡 발생"],
    "67": ["임무 · 나주 앙암바위 왜곡 저지"],
    "72": ["[V] 1인칭"],
    "78": ["지역 선택"],
    "79": ["나주의 전설"],
}
WARN_ONLY = {"81"}

out = []
gi = ai = 0
for step in exp:
    op = step["op"]
    if op == "goTo":
        line = gotos[gi]; gi += 1
        tag = line.split()[1]
        if step.get("door"):
            assert tag == "door", (line, step)
        elif "id" in step:
            assert tag == step["id"], (line, step)
        else:
            assert json.loads(tag) == [float(v) for v in step["to"]], (line, step)
        pairs = json.loads(re.search(r"steps=(\[.*?\]) eye=", line).group(1))
        codes = ["KeyW", "ShiftLeft"] if step.get("run") else ["KeyW"]
        for mdx, ms in pairs:
            if mdx:
                out.append({"op": "mouse", "dx": mdx, "dy": 0, "after": 50})
            out.append({"op": "hold", "codes": codes, "ms": ms, "after": 100})
        if step.get("id") == "coinPickup:cup":
            out.append({"op": "checkpoint", "name": "39-vending-area", "desc": "자판기 구역 — 컵 동전 앞", "expect": []})
    elif op in ("aimAt", "aimPoint"):
        line = aims[ai]; ai += 1
        m = re.match(r"AIM (\S+) → moves=(\[.*?\]) ", line)
        assert m and m.group(1) == (step["id"] if op == "aimAt" else "point"), (line, step)
        w = re.search(r"waited=(\d+)", line)
        for _ in range(int(w.group(1)) if w else 0):
            out.append({"op": "run", "ms": 300})
        for mdx, mdy in json.loads(m.group(2)):
            out += [{"op": "mouse", "dx": mdx, "dy": mdy, "after": 50}, {"op": "run", "ms": 100}]
    elif op == "ensureOpen":
        line = ensures[ei]; ei += 1
        assert line.split()[1] == step["door"], (line, step)
        t = re.search(r"tries=(\d+)", line)
        for _ in range(int(t.group(1)) if t else (1 if "OPENED" in line else 0)):
            aline = aims[ai]; ai += 1
            m = re.match(r"AIM (\S+) → moves=(\[.*?\]) ", aline)
            assert m and m.group(1) == step["cabinet"], (aline, step)
            for mdx, mdy in json.loads(m.group(2)):
                out += [{"op": "mouse", "dx": mdx, "dy": mdy, "after": 50}, {"op": "run", "ms": 100}]
            out += [{"op": "key", "code": "KeyE", "after": 800}, {"op": "run", "ms": 800}]
    elif op == "probe":
        name, desc = NAMES[step["name"]]
        cp = {"op": "checkpoint", "name": name, "desc": desc, "expect": EXPECT.get(step["name"], [])}
        if step["name"] in WARN_ONLY:
            cp["warnOnly"] = True
        out.append(cp)
    else:
        out.append(step)
assert gi == len(gotos) and ai == len(aims) and ei == len(ensures), (gi, len(gotos), ai, len(aims), ei, len(ensures))
json.dump(out, open(sys.argv[3], "w"), ensure_ascii=False, indent=2)
print("baked", len(out), "steps;", gi, "goTo;", ai, "aimAt")
