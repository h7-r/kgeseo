#!/usr/bin/env python3
# build_view.py — 방 세트(rooms_set.json) + 방별 배치 결과 → 뷰어용 json(플레이 시점: 조명·부딪힘·문 이동·상호작용 대상)
#   python3 build_view.py set1/
import json, sys, math
from pathlib import Path
d = Path(sys.argv[1]); S = json.loads((d / "rooms_set.json").read_text()); names = [r["name"] for r in S["rooms"]]
for i, r in enumerate(S["rooms"]):
    rj = json.loads((d / r["json"]).read_text()); pj = json.loads((d / f"place_{r['id']}.json").read_text())
    for q in pj["placements"]: rj["nodes"][q["name"]] = {"role": "prop", "cls": q["cls"]}
    rj["log"] = pj["log"]; rj["keep_clear"] = pj["keep_clear"]
    # 부딪힘: 바닥에 놓인 물건 발자국(받침 위 물건 제외) + 붙박이
    sol = list(rj.get("solids", []))
    for q in pj["placements"]:
        if q.get("on") or q["cls"] in ("wall_low",) or q["dims"][1] < 0.08: continue
        a = math.radians(q.get("rot", 0)); w, dp = q["dims"][0], q["dims"][2]
        hx = abs(math.cos(a)) * w / 2 + abs(math.sin(a)) * dp / 2; hz = abs(math.sin(a)) * w / 2 + abs(math.cos(a)) * dp / 2
        sol.append({"name": q["name"], "rect": [round(q["x"] - hx, 3), round(q["z"] - hz, 3), round(q["x"] + hx, 3), round(q["z"] + hz, 3)], "h": q["dims"][1]})
    rj["solids"] = sol
    # 조명: 방이 닫혀 있으므로 창으로 드는 빛 + 등잔 + 아궁이 불빛 (값은 눈대중 v0)
    L = list(rj.get("lights", [])); D = rj["spec"].get("depth_m", 3.0); K = rj["spec"].get("kan_m", 2.4); W = K * rj["spec"].get("kan_x", 1); Y = rj["floor_y"]
    for o in rj["openings"]:
        if o["type"] not in ("window", "door") or o.get("link"): continue
        u = o.get("kan", 0) * K + K * o.get("at", 0.5) if o["wall"] in ("back", "front") else o.get("at", 0.5) * D
        cy = Y + o.get("sill", 0) + o["h"] / 2
        pos = {"back": (u, cy, 0.45), "front": (u, cy, D - 0.45), "left": (0.45, cy, u), "right": (W - 0.45, cy, u)}[o["wall"]]
        L.append({"kind": "daylight", "name": f"{o['name']} 빛", "pos": [round(v, 3) for v in pos], "color": "#fff3dc", "intensity": round(0.9 * o["w"] * o["h"] + 0.3, 2), "distance": 4.5})
    for q in pj["placements"]:
        if "등잔" in q["name"]: L.append({"kind": "lamp", "name": f"{q['name']} 불", "pos": [q["x"], round(q["y"] + q["dims"][1] + 0.05, 3), q["z"]], "color": "#ffb060", "intensity": 1.3, "distance": 3.6})
    rj["lights"] = L
    goes = []
    for l in S["links"]:
        if l["a"] == r["name"]: goes.append({"door": l["door_a"], "to": l["b"], "tab": names.index(l["b"]), "arrive": l["arrive_in_b"], "step": l["step_m"]})
        if l["b"] == r["name"]: goes.append({"door": l["door_b"], "to": l["a"], "tab": names.index(l["a"]), "arrive": l["arrive_in_a"], "step": l["step_m"]})
    rj["goes"] = goes; rj["set_checks"] = S["checks"] if i == 0 else None
    # 처음 들어설 자리: 앞문 안쪽(없으면 첫 연결 문)
    fd = next((o for o in rj["openings"] if o["type"] == "door" and o["wall"] == "front"), None)
    if fd: u = fd.get("kan", 0) * K + K * fd.get("at", 0.5); rj["entry"] = {"x": round(u, 3), "z": round(D - 0.75, 3), "y": Y, "yaw_deg": 180}
    elif goes: rj["entry"] = next(l for l in S["links"] if r["name"] in (l["a"], l["b"]))["arrive_in_a" if S["links"][0]["a"] == r["name"] else "arrive_in_b"]
    rj["role_name"] = r.get("role", ""); rj["note"] = f"{r.get('role','')} · 바닥 점유율 {pj['floor_cover_pct']}%"
    (d / f"room_{r['id']}_furnished_view.json").write_text(json.dumps(rj, ensure_ascii=False, indent=1))
    print(r["name"], "solids", len(sol), "lights", len(L), "entry", rj.get("entry"))
