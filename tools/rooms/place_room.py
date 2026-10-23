#!/usr/bin/env python3
# place_room.py — 실내 배치 규칙 v0 (2026-10-20). 방 정보(room_gen.py 의 .json) + 놓을 물건 목록 → 자리·회전.
#   python3 place_room.py room.json plan.json out_place.json
# 규칙(설화와 무관한 일반 규칙):
#  R1 통로: 문 앞(안쪽 0.9 m)과 문→방 가운데 0.7 m 폭 길은 비운다
#  R2 벽장 앞 0.5 m 는 비운다(열 수 있어야 함)
#  R3 벽 물건(wall)은 등을 벽에 붙이고(틈 2 cm) 앞면이 방 안을 본다. 창 밑이면 창턱 높이보다 낮아야 한다
#  R4 구석 물건(corner)은 벽 구간 끝(구석)부터 찾는다
#  R5 바닥 물건(floor)은 벽에서 0.35 m 이상 떨어진 빈 곳, 방 가운데에 가까운 곳부터
#  R6 올려놓기(on:<id 또는 시렁 이름>)는 받침 윗면 가장자리에서 안쪽으로 물려(3 cm 또는 윗면 치수 8 %) 놓고, 긴 변을 줄 방향으로 눕히며,
#     같은 받침에 여러 개면 한 줄(안 되면 두 줄)로 모아 가운데 정렬한다. 안 들어가는 것은 받침 옆 바닥으로
#  R7 서로 겹치지 않는다(간격 5 cm). 앞쪽(열린 면) 0.45 m 안에는 높이 0.5 m 넘는 것을 두지 않는다(시야)
#  R8 벽 따라 낮게 까는 것(wall_low: 이불 등)은 벽에 붙이되 창 밑도 된다
import json, sys, math, random
import numpy as np, trimesh
from pathlib import Path
random.seed(7)
room = json.load(open(sys.argv[1])); plan = json.load(open(sys.argv[2])); out = Path(sys.argv[3])
BASE = Path(__file__).resolve().parent.parent
W = room["walk"]["x"]; Z = room["walk"]["z"]; FY = room["floor_y"]
Wd = W[1] + W[0]; D = room["spec"]["depth_m"]

def rect(cx, cz, hx, hz): return (cx - hx, cz - hz, cx + hx, cz + hz)
def hit(a, b, m=0.05): return not (a[2] + m <= b[0] or b[2] + m <= a[0] or a[3] + m <= b[1] or b[3] + m <= a[1])
def inside(a, x0=W[0], z0=Z[0], x1=W[1], z1=Z[1], e=0.015): return a[0] >= x0 - e and a[1] >= z0 - e and a[2] <= x1 + e and a[3] <= z1 + e  # 벽에 1 cm 틈으로 붙이면 걷는 범위(벽에서 2 cm)를 살짝 넘는다

# R1·R2 비울 곳
keep = []; doors = []; center = ((W[0] + W[1]) / 2, (Z[0] + Z[1]) / 2)
for k in room.get("keep", []): keep.append((k["why"], tuple(k["rect"])))
for o in room["openings"]:
    n = room["nodes"][o["name"]]; hx, hy, hz = n["hinge"]
    if o["type"] == "door":
        if o["wall"] == "left":  mid = hz + o["w"] / 2; keep.append(("문 앞", (0, mid - o["w"] / 2 - 0.15, 0.9, mid + o["w"] / 2 + 0.15))); door = (0.05, mid)
        if o["wall"] == "right": mid = hz - o["w"] / 2; keep.append(("문 앞", (Wd - 0.9, mid - o["w"] / 2 - 0.15, Wd, mid + o["w"] / 2 + 0.15))); door = (Wd - 0.05, mid)
        if o["wall"] == "back":  mid = hx + o["w"] / 2; keep.append(("문 앞", (mid - o["w"] / 2 - 0.15, 0, mid + o["w"] / 2 + 0.15, 0.9))); door = (mid, 0.05)
        if o["wall"] == "front": mid = hx + o["w"] / 2; keep.append(("문 앞", (mid - o["w"] / 2 - 0.15, D - 0.9, mid + o["w"] / 2 + 0.15, D))); door = (mid, D - 0.05)
        doors.append(door)
        for t in np.linspace(0, 1, 8):  # 문→가운데 길(문마다)
            px = door[0] + (center[0] - door[0]) * t; pz = door[1] + (center[1] - door[1]) * t
            keep.append(("통로", rect(px, pz, 0.3, 0.3)))
    if o["type"] == "closet":
        if o["wall"] == "right": keep.append(("벽장 앞", (Wd - 0.6, hz - o["w"], Wd, hz)))
        if o["wall"] == "left":  keep.append(("벽장 앞", (0, hz, 0.6, hz + o["w"])))
        if o["wall"] == "back":  keep.append(("벽장 앞", (hx, 0, hx + o["w"], 0.6)))
# 기둥: 칸 경계마다 뒷벽에(앞틀이 있으면 양옆 벽 앞뒤에도) 0.2 m 각기둥이 벽 안쪽으로 튀어나온다 → 그 앞 0.13 m 는 비운다
_sp = room["spec"]; _K = _sp.get("kan_m", 2.4); _nx = _sp.get("kan_x", 2)
for _i in range(1, _nx):
    keep.append(("기둥", (_i * _K - 0.14, 0.0, _i * _K + 0.14, 0.14)))
front_band = (W[0], Z[1] - 0.45, W[1], Z[1])

def dims(it):
    # ext(원본 단위 [가로, 키, 깊이])를 주면 그대로 — 압축 GLB(meshopt·KTX2)는 trimesh 가 못 읽는다(10/21)
    if it.get("ext"): e = np.array(it["ext"], float)
    else: s = trimesh.load(BASE / it["file"], force="scene"); e = s.extents.astype(float)
    k = it.get("size")  # ["L", 0.42] 긴 변 맞춤 / ["h", 0.6] 높이 맞춤 / 없음 = 원본 크기(실측 m)
    sc = 1.0
    if k: sc = k[1] / (max(e[0], e[2]) if k[0] == "L" else e[1])
    return e * sc, sc

placed = {}; log = []
def free(r, h, ignore=()):
    if not inside(r): return "방 밖"
    for nm, k in keep:
        if hit(r, k, 0.0): return nm
    if h > 0.5 and hit(r, front_band, 0.0): return "앞쪽 시야"
    for pid, p in placed.items():
        if pid in ignore or p.get("on") or p.get("fixed"): continue
        if hit(r, p["rect"]): return f"{p['name']}와 겹침"
    return None

def try_wall(it, e, corner=False, low=False):
    zones = sorted(room["wall_zones"], key=lambda z: {"back": 0, "left": 1, "right": 2}[z["wall"]] if not it.get("wall") else (0 if z["wall"] == it["wall"] else 1))
    reasons = {}
    for zn in zones:
        a = np.array(zn["from"]); b = np.array(zn["to"]); L = np.linalg.norm(b - a); d = (b - a) / L; nrm = np.array(zn["normal"], float)
        turn = 90 if (e[2] > e[0] * 1.15 and not corner) else 0   # 깊이가 폭보다 크면 돌려서 넓은 면을 벽에
        w_along, depth, h = (e[2], e[0], e[1]) if turn else (e[0], e[2], e[1])
        if not low and h > zn["max_h"] + 1e-6: reasons[zn["wall"]] = "창 밑이라 높이 초과"; continue
        if w_along > L: reasons[zn["wall"]] = "구간이 좁음"; continue
        steps = np.arange(w_along / 2, L - w_along / 2 + 1e-6, 0.05)
        if corner:  # 방 구석(벽 두 개가 만나는 곳)에 가까운 순
            cs = [(W[0], Z[0]), (W[1], Z[0]), (W[0], Z[1]), (W[1], Z[1])]
            steps = sorted(steps, key=lambda u: min(math.hypot(*(a + d * u)[[0, 2]] - np.array(c)) for c in cs))
        elif it.get("center_on_wall"): steps = sorted(steps, key=lambda u: abs(u - L / 2))
        else: steps = sorted(steps, key=lambda u: min(u - w_along / 2, L - u - w_along / 2) + random.random() * 0.05)   # 구간 끝(기둥·구석)에 붙여 긴 빈 벽을 남김
        for u in steps:
            c = a + d * u + nrm * (depth / 2 + 0.01)
            hx_, hz_ = (w_along / 2, depth / 2) if abs(nrm[2]) > 0.5 else (depth / 2, w_along / 2)
            r = rect(c[0], c[2], hx_, hz_); why = free(r, h)
            if why is None:
                rot = {(0, 1): 0, (1, 0): 90, (-1, 0): -90}[(int(round(nrm[0])), int(round(nrm[2])))]
                return dict(x=c[0], z=c[2], y=FY, rot=rot + turn + (random.uniform(-1, 1) if not corner else random.uniform(-20, 20)), rect=r, wall=zn["wall"])
            reasons[zn["wall"]] = why
    return {"fail": reasons}

def try_floor(it, e):
    m = 0.35; best = None
    for x in np.arange(W[0] + m + e[0] / 2, W[1] - m - e[0] / 2 + 1e-6, 0.05):
        for z in np.arange(Z[0] + m + e[2] / 2, Z[1] - 0.2 - e[2] / 2 + 1e-6, 0.05):
            r = rect(x, z, e[0] / 2, e[2] / 2)
            if free(r, e[1]) is None:
                tgt = it.get("near"); 
                sc = math.hypot(x - center[0], z - center[1]) if not tgt else math.hypot(x - placed[tgt]["x"], z - placed[tgt]["z"])
                sc += random.random() * 0.15
                if best is None or sc < best[0]: best = (sc, x, z, r)
    if not best: return {"fail": {"바닥": "빈 곳 없음"}}
    return dict(x=best[1], z=best[2], y=FY, rot=random.uniform(-15, 15), rect=best[3])

def pack_on(sup, group):
    """같은 받침 위 물건들을 한꺼번에 — 가장자리 안쪽으로 물리고 줄 맞춰 모은다."""
    sp = placed.get(sup)
    if not sp: return {it["id"]: {"fail": {"올려놓기": f"받침 {sup} 없음"}} for it, e in group}
    if sp.get("kind") == "pot_seat":   # 솥 자리: 가운데에 하나, 솥 높이의 35 %를 부뚜막에 묻음
        it, e = group[0]; cx, cz = (sp["rect"][0] + sp["rect"][2]) / 2, (sp["rect"][1] + sp["rect"][3]) / 2
        res = {it["id"]: dict(x=cx, z=cz, y=sp["y"] - 0.35 * e[1], rot=random.uniform(-10, 10), rect=rect(cx, cz, e[0] / 2, e[2] / 2), on=sup)}
        for it2, _ in group[1:]: res[it2["id"]] = {"fail": {"올려놓기": "솥 자리에는 하나만"}}
        return res
    r0 = sp["rect"]; tw, td = r0[2] - r0[0], r0[3] - r0[1]
    ix = max(0.03, 0.08 * tw); iz = max(0.03, 0.08 * td)
    inner = (r0[0] + ix, r0[1] + iz, r0[2] - ix, r0[3] - iz); iw, idp = inner[2] - inner[0], inner[3] - inner[1]
    along_x = iw >= idp; Lmax, Dmax = (iw, idp) if along_x else (idp, iw)
    gap = 0.03; res = {}; todo = []
    for it, e in group:
        a, b = (e[0], e[2]) if along_x else (e[2], e[0]); r90 = 0
        if b > a and a <= Dmax: a, b, r90 = b, a, 90      # 긴 변을 줄 방향으로
        if b > Dmax and a <= Dmax: a, b, r90 = b, a, 90 - r90
        todo.append((it, (a, b), r90))
    # 큰 것부터 줄에 채운다(최대 두 줄)
    todo.sort(key=lambda t: -t[1][0] * t[1][1]); rows = [[]]; widths = [0.0]; R90 = {t[0]["id"]: t[2] for t in todo}
    for it, (a, b), _r in todo:
        if b > Dmax: res[it["id"]] = {"fail": {"올려놓기": f"{sp['name']} 윗면보다 큼"}}; continue
        for ri in range(len(rows)):
            if widths[ri] + (gap if rows[ri] else 0) + a <= Lmax: rows[ri].append((it, a, b)); widths[ri] += (gap if len(rows[ri]) > 1 else 0) + a; break
        else:
            if len(rows) < 2 and sum(max(x[2] for x in r) for r in rows if r) + gap + b <= Dmax: rows.append([(it, a, b)]); widths.append(a)
            else: res[it["id"]] = {"fail": {"올려놓기": "윗면에 자리 없음"}}
    rows = [r for r in rows if r]; depth_tot = sum(max(x[2] for x in r) for r in rows) + gap * (len(rows) - 1)
    cxi = (inner[0] + inner[2]) / 2; czi = (inner[1] + inner[3]) / 2; dcur = -depth_tot / 2
    for r, wsum in zip(rows, [w for w in widths if w > 0]):
        rd = max(x[2] for x in r); ucur = -wsum / 2
        for it, a, b in r:
            u = ucur + a / 2 + random.uniform(-0.01, 0.01); v = dcur + rd / 2 + random.uniform(-0.01, 0.01)
            cx, cz = (cxi + u, czi + v) if along_x else (cxi + v, czi + u)
            hx, hz = (a / 2, b / 2) if along_x else (b / 2, a / 2)
            res[it["id"]] = dict(x=cx, z=cz, y=sp["y"] + sp["h"], rot=sp["rot"] + R90[it["id"]] + random.uniform(-5, 5), rect=rect(cx, cz, hx, hz), on=sup)
            ucur += a + gap
        dcur += rd + gap
    return res

# 방에 붙은 받침(시렁 등)
for sf in room.get("surfaces", []):
    placed[sf["name"]] = dict(name=sf["name"], rect=tuple(sf["rect"]), y=sf["y"], h=0.0, rot=0.0, x=(sf["rect"][0] + sf["rect"][2]) / 2, z=(sf["rect"][1] + sf["rect"][3]) / 2, fixed=True, kind=sf.get("kind"))

def record(it, p, e, sc, cls):
    if "fail" in p: log.append({"id": it["id"], "name": it["name"], "result": "못 놓음", "why": p["fail"]}); return
    p.update(id=it["id"], name=it["name"], file=it["file"], scale=sc, h=float(e[1]), cls=cls, dims=np.round(e, 3).tolist())
    placed[it["id"]] = p
    log.append({"id": it["id"], "name": it["name"], "result": "놓음" + (" (받침 대신 옆 바닥)" if p.get("fallback") else ""), "where": p.get("wall") or ("위: " + (placed[p["on"]]["name"]) if p.get("on") else "바닥"), "pos": [round(float(p["x"]), 2), round(float(p["y"]), 2), round(float(p["z"]), 2)]})

FIT = json.load(open(Path(__file__).resolve().parent / "room_fit.json")) if (Path(__file__).resolve().parent / "room_fit.json").exists() else {"rules": []}
role = plan.get("room_role") or room.get("spec", {}).get("role")
if role:
    keepit = []
    for it in plan["items"]:
        bad = next((r for r in FIT["rules"] if any(k in it["name"] for k in r["match"]) and role not in r["rooms"]), None)
        if bad: log.append({"id": it["id"], "name": it["name"], "result": "뺌 — 방 성격과 안 맞음", "why": {"규칙": f"{'/'.join(bad['match'])} → {', '.join(bad['rooms'])}에만 ({bad.get('why','')})"}})
        else: keepit.append(it)
    plan["items"] = keepit
D_ = {it["id"]: dims(it) for it in plan["items"]}
ORDER = {"wall": 0, "wall_low": 1, "corner": 2, "floor": 3}   # 큰 가구(벽)부터, 이부자리·바닥 물건은 나중
base_items = sorted([it for it in plan["items"] if not it["cls"].startswith("on:")], key=lambda it: (ORDER.get(it["cls"], 9), -np.prod(D_[it["id"]][0][[0, 2]])))
for it in base_items:
    e, sc = D_[it["id"]]; cls = it["cls"]
    p = {"wall": lambda: try_wall(it, e), "wall_low": lambda: try_wall(it, e, low=True), "corner": lambda: try_wall(it, e, corner=True), "floor": lambda: try_floor(it, e)}[cls]()
    if "fail" in p and cls == "wall_low":   # 이부자리처럼 낮게 까는 것은 벽에 못 붙이면 방바닥 빈 곳에
        f0 = p["fail"]; p = try_floor(it, e); p["fallback"] = f0
    record(it, p, e, sc, cls)
sups = []
for it in plan["items"]:
    if it["cls"].startswith("on:") and it["cls"][3:] not in sups: sups.append(it["cls"][3:])
for sup in sups:  # 받침 위의 받침(이불 위 베개 등)도 순서대로
    grp = [(it, D_[it["id"]][0]) for it in plan["items"] if it["cls"] == f"on:{sup}"]
    res_ = pack_on(sup, grp)
    for it, e in grp:
        p = res_[it["id"]]
        if "fail" in p: f0 = p["fail"]; p = try_floor({**it, "near": sup} if sup in placed and not placed[sup].get("fixed") else it, e); p["fallback"] = f0
        record(it, p, e, D_[it["id"]][1], it["cls"])
cover = sum((p["rect"][2] - p["rect"][0]) * (p["rect"][3] - p["rect"][1]) for p in placed.values() if not p.get("on") and not p.get("fixed")) / ((W[1] - W[0]) * (Z[1] - Z[0]))
print("바닥 점유율", round(cover * 100, 1), "%")
res = {"room": sys.argv[1], "floor_cover_pct": round(cover * 100, 1), "placements": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in p.items() if k != "rect"} for p in placed.values() if not p.get("fixed")],
       "keep_clear": [{"why": n, "rect": [round(v, 2) for v in r]} for n, r in keep if n != "통로"] + [{"why": "통로", "path": [[round(dr[0], 2), round(dr[1], 2)], [round(center[0], 2), round(center[1], 2)]], "width": 0.6} for dr in doors], "log": log}
out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
for l in log: print(l)
