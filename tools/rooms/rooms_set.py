#!/usr/bin/env python3
# rooms_set.py — 독립된 방 여러 개 + 방 사이 연결 정보(개연성 검사 포함) v0 (2026-10-20)
#   python3 rooms_set.py set_spec.json out_dir/
# 게임은 방 하나씩만 불러와 문으로 이동한다(미르 10/20). 그래서 방은 각자 완전한 공간(벽 네 면·천장)으로 따로 만들고,
# 이어 붙이지 않는다. 대신 "이 문 → 저 방의 저 문"과 도착 위치를 기록하고, 연결이 말이 되는지 검사한다.
import json, sys, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import room_gen as RG
OPP = {"left": "right", "right": "left", "back": "front", "front": "back"}
hs = json.load(open(sys.argv[1])); out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
R = {r["name"]: r for r in hs["rooms"]}
for r in hs["rooms"]: r["spec"].setdefault("openings", [])
# 1) 연결 문을 양쪽 방에 넣는다 — a 쪽 벽과 b 쪽 벽은 마주 보는 면(오른쪽↔왼쪽 등)
for l in hs["links"]:
    a, b = R[l["a"]], R[l["b"]]; wa = l["wall_a"]; wb = OPP[wa]; nm = f"{l['a']}↔{l['b']}"
    ya = a["spec"].get("floor_lift", 0.45); yb = b["spec"].get("floor_lift", 0.45)
    for r, w, step in ((a, wa, yb - ya), (b, wb, ya - yb)):
        o = {"wall": w, "type": "door", "w": l["w"], "h": l["h"], "sill": round(max(0.0, step), 3), "link": nm, "at": l.get("at", 0.5)}
        if w in ("back", "front"): o["kan"] = l.get("kan", 0)
        r["spec"]["openings"].append(o)
    l["name"] = nm
info = {"name": hs["name"], "rooms": [], "links": [], "checks": []}
door_of = {}
for r in hs["rooms"]:
    RG.MATS.clear(); scene, ri = RG.build(r["spec"])
    f = out / f"room_{r['id']}.glb"; scene.export(f, include_normals=True); f.with_suffix(".json").write_text(json.dumps(ri, ensure_ascii=False, indent=1))
    sp = r["spec"]; K = sp.get("kan_m", 2.4); W = K * sp.get("kan_x", 1); D = sp.get("depth_m", 3.0)
    for o in ri["openings"]:
        if o.get("link"):
            u = o["kan"] * K + K * o.get("at", 0.5) if o["wall"] in ("back", "front") else o.get("at", 0.5) * D
            pos, yaw = {"left": ((0.75, u), 90), "right": ((W - 0.75, u), -90), "back": ((u, 0.75), 0), "front": ((u, D - 0.75), 180)}[o["wall"]]
            door_of[(r["name"], o["link"])] = {"door": o["name"], "wall": o["wall"], "u": round(u, 3), "arrive": {"x": round(pos[0], 3), "z": round(pos[1], 3), "y": ri["floor_y"], "yaw_deg": yaw}}
    info["rooms"].append({"name": r["name"], "id": r["id"], "glb": f.name, "json": f.with_suffix(".json").name, "W": W, "D": D, "floor_y": ri["floor_y"], "role": r.get("role", "")})
    print(f.name, f"{f.stat().st_size/1e6:.2f}MB")
# 2) 연결 기록 + 개연성 검사
def chk(ok, what, detail): info["checks"].append({"ok": bool(ok), "what": what, "detail": detail})
for l in hs["links"]:
    A = door_of.get((l["a"], l["name"])); B = door_of.get((l["b"], l["name"]))
    ya = R[l["a"]]["spec"].get("floor_lift", 0.45); yb = R[l["b"]]["spec"].get("floor_lift", 0.45)
    info["links"].append({"name": l["name"], "a": l["a"], "b": l["b"], "door_a": A["door"], "door_b": B["door"], "arrive_in_b": B["arrive"], "arrive_in_a": A["arrive"], "step_m": round(abs(ya - yb), 2)})
    chk(OPP[A["wall"]] == B["wall"], f"{l['name']} 문 방향", f"{l['a']} {A['wall']} ↔ {l['b']} {B['wall']}")
    Da = R[l["a"]]["spec"].get("depth_m", 3.0); Db = R[l["b"]]["spec"].get("depth_m", 3.0)
    if A["wall"] in ("left", "right"): chk(abs(Da - Db) < 0.31 and abs(A["u"] - B["u"]) < 0.3, f"{l['name']} 맞닿은 벽 길이·문 위치", f"깊이 {Da}/{Db} m, 문 위치 {A['u']}/{B['u']} m")
    chk(abs(ya - yb) <= 0.45, f"{l['name']} 문턱 높이", f"{abs(ya - yb):.2f} m (0.45 m 이하)")
    top_a = ya + R[l["a"]]["spec"].get("wall_h", 2.3); top_b = yb + R[l["b"]]["spec"].get("wall_h", 2.3)
    chk(abs(top_a - top_b) < 0.21, f"{l['name']} 벽 윗선", f"{top_a:.2f} / {top_b:.2f} m (같은 지붕 아래)")
# 집 단위 상식(설화와 무관): 부엌은 아궁이로 데우는 방과 붙어 있다
for rule in hs.get("adjacency_rules", []):
    pairs = {frozenset((l["a"], l["b"])) for l in hs["links"]}
    chk(frozenset(rule["pair"]) in pairs, f"붙어 있어야 함: {' ↔ '.join(rule['pair'])}", rule.get("why", ""))
# 3) 모든 방이 바깥(앞문)이나 다른 방으로 닿는가
reach = {hs["rooms"][0]["name"]}; ch = True
while ch:
    ch = False
    for l in hs["links"]:
        if (l["a"] in reach) != (l["b"] in reach): reach |= {l["a"], l["b"]}; ch = True
chk(len(reach) == len(hs["rooms"]), "모든 방이 이어짐", f"{len(reach)}/{len(hs['rooms'])}")
(out / "rooms_set.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
for c in info["checks"]: print(("🟢" if c["ok"] else "🔴"), c["what"], "—", c["detail"])
