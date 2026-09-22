# 구워 둔 몸 GLB 에 피부/의상 정점 표식(_tint)을 넣고, 짧은 머리의 뒷선을 내려 뒤통수를 덮는다.
#
#   Blender --background --factory-startup --python naju01/도구/meshy_mark_tint.py -- \
#     --glb public/models/meshy-both-male.glb --out public/models/meshy-both-male.glb [--hair-nape 0.16]
#
# _tint: 0 = 그대로, 1 = 피부색 곱함, 2 = 의상색 곱함(툰재질.js 가 읽는다). 몸과 옷이 한 메시라
# 재질로는 못 가르고, 런타임 텍스처 추정은 아틀라스 여백이 살빛이라 실패했다(툰재질.js 주석).
# 여기서는 면마다 UV 중심의 텍스처 색을 HSV 로 보고(흰 옷·검은 옷 vs 살빛), 뼈 영역으로
# 손·발·머리·아랫팔·종아리는 살로 못박은 뒤, 정점은 이웃 면의 다수결로 정한다.
import argparse
import colorsys
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--hair-nape", type=float, default=0.0,
                    help="짧은 머리(variant 0) 뒤쪽 아랫부분을 이 비율만큼 아래로 늘린다(0 = 안 함)")
parser.add_argument("--jpeg", type=int, default=85)
# 상의 밑단을 이만큼(m) 올려 반바지로 칠한다(텍스처에서 밑단 띠를 반바지 색으로). 골반이 위로
# 올라가 보인다. 몸·옷이 한 메시라 기하는 못 자르고 색만 바꾼다.
parser.add_argument("--shirt-shorten", type=float, default=0.0)
# 상의(밝은 옷) 정점의 허벅지 웨이트를 골반으로 옮긴다. 자동 웨이트가 상의 밑단을 살처럼 허벅지에 묶어,
# 걸을 때 앞 밑단은 앞다리를 따라 올라가고 뒤 밑단은 뒷다리를 따라 내려와 구부정해 보였다.
parser.add_argument("--shirt-to-pelvis", action="store_true")
# 옷/살 경계가 삼각형 한가운데를 지나는 면을 다수결 색으로 통째로 칠한다. 텍스처 보간으로 검정이 살 쪽으로
# 번지고, 다리가 움직여 삼각형이 늘어나면 번짐이 커졌다(반바지 밑단 뒤쪽). 경계를 삼각형 변에 맞춘다.
parser.add_argument("--sharpen-hem", action="store_true")
parser.add_argument("--fix-crossleg", action="store_true", help="한쪽 허벅지 0.8 이상 정점의 반대쪽 허벅지 웨이트를 지운다")
# 고관절 둘레 골반↔허벅지 웨이트를 넓게(관절 위 3cm ~ 아래 9cm) 다시 편다. 자동 웨이트는 4cm 안에서 급하게
# 넘어가 다리를 앞으로 들면 앞쪽 살이 접히며 면이 깨져 보였다.
parser.add_argument("--smooth-hip", action="store_true")
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
body = next(o for o in bpy.data.objects if o.type == "MESH" and o.get("chibi_part") == "body")

# ── 옷이 있을 수 있는 뼈 영역(그 밖은 무조건 살) ─────────────────────
옷뼈 = {"pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05",
        "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "thigh_l", "thigh_r"}


def 기본색이미지(material):
    if not material or not material.use_nodes:
        return None
    bsdf = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        link = next((l for l in bsdf.inputs["Base Color"].links), None)
        if link and link.from_node.type == "TEX_IMAGE":
            return link.from_node.image
    return next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


def 표식넣기(obj):
    me = obj.data
    image = 기본색이미지(me.materials[0] if me.materials else None)
    if image is None:
        print("TINT_SKIP 텍스처 없음", obj.name)
        return
    w, h = image.size
    px = np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)
    uv = me.uv_layers.active.data
    groups = {g.index: g.name for g in obj.vertex_groups}
    # 정점의 지배 뼈
    dominant = []
    for v in me.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        dominant.append(groups.get(best.group, "") if best else "")
    face_cloth = np.zeros(len(me.polygons), dtype=bool)
    for poly in me.polygons:
        # 면의 정점이 하나라도 옷 영역 밖 뼈면 살로 본다.
        if any(dominant[i] not in 옷뼈 for i in poly.vertices):
            continue
        us = [uv[li].uv for li in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        x = int(min(w - 1, max(0, (cu % 1.0) * w)))
        y = int(min(h - 1, max(0, (cv % 1.0) * h)))
        r, g, b = px[y, x, :3]
        hh, ss, vv = colorsys.rgb_to_hsv(float(r), float(g), float(b))
        흰옷 = vv > 0.72 and ss < 0.14
        검은옷 = vv < 0.30
        face_cloth[poly.index] = 흰옷 or 검은옷
    # 정점 = 이웃 면 다수결, 그리고 한 번 더 이웃 정점 다수결로 점을 지운다.
    vert_faces = [[] for _ in me.vertices]
    for poly in me.polygons:
        for i in poly.vertices:
            vert_faces[i].append(poly.index)
    tint = np.array([2.0 if (vf and face_cloth[vf].mean() >= 0.5) else 1.0 for vf in vert_faces], dtype=np.float32)
    neighbors = [set() for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    smoothed = tint.copy()
    for i, ns in enumerate(neighbors):
        if not ns:
            continue
        vals = tint[list(ns)]
        cloth = (vals == 2.0).mean()
        if cloth > 0.7:
            smoothed[i] = 2.0
        elif cloth < 0.3:
            smoothed[i] = 1.0
    attr = me.attributes.get("_tint") or me.attributes.new("_tint", "FLOAT", "POINT")
    attr.data.foreach_set("value", smoothed.tolist())
    print(f"TINT_OK {obj.name} cloth_verts={(smoothed == 2.0).sum()}/{len(smoothed)}")

    if args.shirt_to_pelvis:
        # 정점 밝기 = 이웃 면의 텍스처 값 평균. 밝으면 상의, 어두우면 반바지.
        face_val = np.zeros(len(me.polygons), dtype=np.float32)
        for poly in me.polygons:
            us = [uv[li].uv for li in poly.loop_indices]
            x = int(min(w - 1, max(0, (sum(u.x for u in us) / len(us) % 1.0) * w)))
            y = int(min(h - 1, max(0, (sum(u.y for u in us) / len(us) % 1.0) * h)))
            face_val[poly.index] = max(px[y, x, :3])
        gi = {g.name: g.index for g in obj.vertex_groups}
        pelvis = obj.vertex_groups.get("pelvis")
        thighs = [gi[n] for n in ("thigh_l", "thigh_r", "thigh_twist_01_l", "thigh_twist_01_r") if n in gi]
        M = obj.matrix_world
        # 상의 = 반바지 허리선 위의 옷 정점. 밝기만 보면 반바지 밑단 경계 정점(옆 살이 밝다)까지 상의로
        # 오인해 골반에 묶여, 다리가 움직일 때 밑단이 톱니처럼 찢어졌다(실제로 그랬다).
        dark_tops = [(M @ v.co).z for v in me.vertices
                     if smoothed[v.index] == 2.0 and vert_faces[v.index] and face_val[vert_faces[v.index]].mean() < 0.5]
        # 허리선 6cm 아래까지는 상의로 본다(1.5cm 로 두니 허리선 밑 상의 정점이 허벅지에 남아 뒤 허리선에
        # 계단 홈이 생겼다). 반바지 밑단은 허리선 18cm 아래라 걸리지 않는다.
        shirt_floor = (max(dark_tops) - 0.06) if dark_tops else -1.0
        moved = 0
        for v in me.vertices:
            if smoothed[v.index] != 2.0 or not vert_faces[v.index]:
                continue
            if face_val[vert_faces[v.index]].mean() < 0.5:
                continue  # 반바지 — 다리를 따라야 한다
            if (M @ v.co).z < shirt_floor:
                continue  # 허리선 아래 = 반바지 밑단 경계
            wt = sum(g.weight for g in v.groups if g.group in thighs)
            if wt <= 0:
                continue
            for gidx in thighs:
                obj.vertex_groups[gidx].remove([v.index])
            pelvis.add([v.index], wt, "ADD")
            moved += 1
        print(f"SHIRT_PELVIS_OK moved={moved}")

        # 반바지 허리띠도 골반을 따른다. 상의만 골반에 묶으면 상의/반바지 경계 삼각형이 늘어나 흑백 경계가
        # 톱니처럼 번졌다. 반바지 윗부분 4cm 는 골반, 그 아래 6cm 는 골반→허벅지로 서서히 넘긴다.
        M = obj.matrix_world
        dark_top = max(((M @ v.co).z for v in me.vertices
                        if smoothed[v.index] == 2.0 and vert_faces[v.index] and face_val[vert_faces[v.index]].mean() < 0.5), default=None)
        band = 0
        if dark_top is not None:
            for v in me.vertices:
                if smoothed[v.index] != 2.0 or not vert_faces[v.index] or face_val[vert_faces[v.index]].mean() >= 0.5:
                    continue
                z = (M @ v.co).z
                t = (dark_top - z - 0.04) / 0.06  # 0 = 허리띠 아래 4cm, 1 = 10cm
                frac = 1.0 if t <= 0 else (0.0 if t >= 1 else 1.0 - t)
                if frac <= 0:
                    continue
                wt = sum(g.weight for g in v.groups if g.group in thighs)
                if wt <= 0:
                    continue
                for gidx in thighs:
                    g = next((g for g in v.groups if g.group == gidx), None)
                    if g:
                        obj.vertex_groups[gidx].add([v.index], g.weight * (1 - frac), "REPLACE")
                pelvis.add([v.index], wt * frac, "ADD")
                band += 1
        print(f"WAISTBAND_OK top={dark_top} verts={band}")

    # 반대쪽 다리 웨이트 누수 제거 — 왼다리 정점에 오른 허벅지가 2% 섞여 있으면 오른다리가 크게 나갈 때
    # 반바지 밑단이 끌려가 색이 바깥으로 번진다. 한쪽 허벅지가 0.8 이상이면 반대쪽은 지우고 정규화한다.
    gi = {g.name: g.index for g in obj.vertex_groups}
    pairs = [(gi.get("thigh_l"), gi.get("thigh_r"), gi.get("thigh_twist_01_r")), (gi.get("thigh_r"), gi.get("thigh_l"), gi.get("thigh_twist_01_l"))]
    fixed = 0
    for v in (me.vertices if args.fix_crossleg else []):
        wmap = {g.group: g.weight for g in v.groups}
        for mine, other, other_tw in pairs:
            if mine is None or wmap.get(mine, 0) < 0.8:
                continue
            leak = wmap.get(other, 0) + (wmap.get(other_tw, 0) if other_tw is not None else 0)
            if leak <= 0:
                continue
            for gidx in (other, other_tw):
                if gidx is not None and gidx in wmap:
                    obj.vertex_groups[gidx].remove([v.index])
            obj.vertex_groups[mine].add([v.index], wmap[mine] + leak, "REPLACE")
            fixed += 1
    print(f"CROSSLEG_OK fixed={fixed}")

    if args.smooth_hip:
        rig = obj.parent
        M = obj.matrix_world
        gi = {g.name: g.index for g in obj.vertex_groups}
        pel = gi.get("pelvis")
        done = 0
        for side in ("l", "r"):
            th, tw = gi.get(f"thigh_{side}"), gi.get(f"thigh_twist_01_{side}")
            oth = gi.get(f"thigh_{'r' if side == 'l' else 'l'}")
            if th is None or pel is None:
                continue
            hip = rig.matrix_world @ rig.data.bones[f"thigh_{side}"].head_local
            knee = rig.matrix_world @ rig.data.bones[f"calf_{side}"].head_local
            axis = (knee - hip).normalized()
            for v in me.vertices:
                p = M @ v.co
                if (p - hip).length > 0.16:
                    continue
                wmap = {g.group: g.weight for g in v.groups}
                mine = wmap.get(th, 0) + (wmap.get(tw, 0) if tw is not None else 0) + wmap.get(pel, 0)
                if mine < 0.85 or wmap.get(oth, 0) > 0.05:
                    continue  # 사타구니(양쪽 허벅지 섞임)나 다른 뼈 영역은 두지 않는다
                d = (p - hip).dot(axis)
                t = min(1.0, max(0.0, (d + 0.03) / 0.12))
                t = t * t * (3 - 2 * t)
                obj.vertex_groups[th].add([v.index], mine * t, "REPLACE")
                obj.vertex_groups[pel].add([v.index], mine * (1 - t), "REPLACE")
                if tw is not None and tw in wmap:
                    obj.vertex_groups[tw].remove([v.index])
                done += 1
        print(f"SMOOTH_HIP_OK verts={done}")

    if args.shirt_shorten > 0:
        상의줄이기(obj, image, px, uv, dominant, face_cloth, smoothed, args.shirt_shorten)
    if args.sharpen_hem:
        경계선명하게(obj, image, px, uv)


def 삼각형칠하기(px, w, h, pts, col):
    for k in range(1, len(pts) - 1):
        tri = [pts[0], pts[k], pts[k + 1]]
        xs = [p[0] for p in tri]
        ys = [p[1] for p in tri]
        x0, x1 = max(0, int(min(xs)) - 1), min(w - 1, int(max(xs)) + 1)
        y0, y1 = max(0, int(min(ys)) - 1), min(h - 1, int(max(ys)) + 1)
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = tri
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / det
        l2 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / det
        l3 = 1 - l1 - l2
        eps = -0.5
        mask = (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
        px[y0:y1 + 1, x0:x1 + 1, :3][mask] = col


def 경계선명하게(obj, image, px, uv):
    """반바지 밑단을 텍셀 단위로 다시 그린다. 텍셀마다 3D 높이를 구해(면 안 무게중심 보간) 밑단선 위는
    반바지색, 아래는 살색으로 칠한다 — 경계가 삼각형 배치와 무관하게 매끈한 선이 된다.
    (면 단위로 칠했더니 UV 가 길쭉한 면에서 줄무늬가 생겼다.)"""
    me = obj.data
    w, h = image.size
    M = obj.matrix_world
    zs = np.array([(M @ v.co).z for v in me.vertices])
    xs = np.array([(M @ v.co).x for v in me.vertices])
    # 1) 허벅지 구간 면을 텍셀로 펼쳐 (텍셀 → z, x, 원래 밝기) 를 모은다.
    ys_ = np.array([(M @ v.co).y for v in me.vertices])
    tex_z = np.full((h, w), np.nan, dtype=np.float32)
    tex_x = np.full((h, w), np.nan, dtype=np.float32)
    tex_y = np.full((h, w), np.nan, dtype=np.float32)
    for poly in me.polygons:
        pz = [zs[i] for i in poly.vertices]
        if max(pz) < 0.36 or min(pz) > 0.62:
            continue
        pts = [(uv[li].uv.x % 1.0 * w, uv[li].uv.y % 1.0 * h) for li in poly.loop_indices]
        vz = [zs[i] for i in poly.vertices]
        vx = [xs[i] for i in poly.vertices]
        vy = [ys_[i] for i in poly.vertices]
        for k in range(1, len(pts) - 1):
            tri = [pts[0], pts[k], pts[k + 1]]
            tz = [vz[0], vz[k], vz[k + 1]]
            tx = [vx[0], vx[k], vx[k + 1]]
            ty = [vy[0], vy[k], vy[k + 1]]
            x0, x1 = max(0, int(min(p[0] for p in tri)) - 1), min(w - 1, int(max(p[0] for p in tri)) + 1)
            y0, y1 = max(0, int(min(p[1] for p in tri)) - 1), min(h - 1, int(max(p[1] for p in tri)) + 1)
            if x1 < x0 or y1 < y0:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = tri
            det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            if abs(det) < 1e-9:
                continue
            l1 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / det
            l2 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / det
            l3 = 1 - l1 - l2
            eps = -0.35  # 삼각형 사이 틈(이음새 텍셀)까지 덮는다
            mask = (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
            Z = l1 * tz[0] + l2 * tz[1] + l3 * tz[2]
            Xw = l1 * tx[0] + l2 * tx[1] + l3 * tx[2]
            Yw = l1 * ty[0] + l2 * ty[1] + l3 * ty[2]
            sub_z = tex_z[y0:y1 + 1, x0:x1 + 1]
            sub_x = tex_x[y0:y1 + 1, x0:x1 + 1]
            sub_y = tex_y[y0:y1 + 1, x0:x1 + 1]
            sub_z[mask] = Z[mask]
            sub_x[mask] = Xw[mask]
            sub_y[mask] = Yw[mask]
    have = ~np.isnan(tex_z)
    if not have.any():
        print("SHARPEN_SKIP")
        return
    bright = px[..., :3].max(axis=2)
    dark = have & (bright < 0.3)
    light = have & (bright >= 0.3)
    if not dark.any() or not light.any():
        print("SHARPEN_SKIP no boundary")
        return
    # 2) 밑단선: 다리마다(x 부호), 다리 둘레 각도 구간(16개)마다 어두운 텍셀 비율이 50% 아래로 떨어지는
    #    높이를 밑단으로 본다(어두운 z 의 하위 백분위는 번진 텍셀에 끌려 너무 낮게 잡혔다). 구간 사이는 각도로
    #    연속 보간해 계단이 생기지 않게 한다. 밑단이 수평이 아니어도(앞이 낮은 반바지) 따라간다.
    NB = 16
    SLICE = 0.005
    hem = {}
    for side, sel in (("l", tex_x > 0), ("r", tex_x <= 0)):
        d = dark & sel
        lt = light & sel
        if not d.any():
            hem[side] = None
            continue
        cx, cy = float(np.mean(tex_x[d])), float(np.mean(tex_y[d]))
        ang = np.arctan2(tex_y - cy, tex_x - cx)  # -pi..pi
        binf = (ang + np.pi) / (2 * np.pi) * NB
        bins = binf.astype(int).clip(0, NB - 1)
        z_top = float(np.percentile(tex_z[d], 97))
        z_bot = float(np.nanmin(tex_z[have & sel]))
        edges = np.arange(z_bot, z_top + SLICE, SLICE)
        overall = None
        per = []
        for b in range(NB):
            db = d & (bins == b)
            lb = lt & (bins == b)
            hd, _ = np.histogram(tex_z[db], bins=edges)
            hl, _ = np.histogram(tex_z[lb], bins=edges)
            tot = hd + hl
            found = None
            for i in range(len(hd) - 1, -1, -1):  # 위에서 아래로
                if tot[i] < 20:
                    continue
                if hd[i] / tot[i] < 0.5:
                    found = edges[i + 1]
                    break
            per.append(found)
        valid = [v for v in per if v is not None]
        if not valid:
            hem[side] = None
            continue
        overall = float(np.median(valid))
        per = [v if v is not None else overall for v in per]
        per = [(per[(b - 1) % NB] + 2 * per[b] + per[(b + 1) % NB]) / 4 for b in range(NB)]
        # 각도 연속 보간(구간 중심 사이 선형, 둘레로 순환)
        t = binf - 0.5
        b0 = np.floor(t).astype(int) % NB
        b1 = (b0 + 1) % NB
        f = (t - np.floor(t)).astype(np.float32)
        per_a = np.array(per, dtype=np.float32)
        hz = per_a[b0] * (1 - f) + per_a[b1] * f
        hem[side] = (per, hz)
    dark_col = np.median(px[dark][:, :3], axis=0)
    lowest = min((min(v[0]) for v in hem.values() if v), default=None)
    skin_col = np.median(px[light & (tex_z < lowest)][:, :3], axis=0) if (lowest is not None and (light & (tex_z < lowest)).any()) else np.median(px[light][:, :3], axis=0)
    painted = 0
    for side, sel in (("l", tex_x > 0), ("r", tex_x <= 0)):
        if hem[side] is None:
            continue
        per, hz = hem[side]
        # 밑단 위 3cm ~ 아래 8cm 를 다시 그린다(번진 검정은 밑단 아래 몇 cm 까지 내려와 있었다).
        band = have & sel & (tex_z < hz + 0.03) & (tex_z > hz - 0.08)
        above = band & (tex_z >= hz)
        below = band & (tex_z < hz)
        px[above, :3] = dark_col
        px[below, :3] = skin_col
        painted += int(band.sum())
    hem = {k: (round(min(v[0]), 3), round(max(v[0]), 3)) if v else None for k, v in hem.items()}
    image.pixels.foreach_set(px.ravel())
    image.pack()
    print(f"SHARPEN_OK hem(min,max)={hem} texels={painted}")


def 상의줄이기(obj, image, px, uv, dominant, face_cloth, tint, height):
    """반바지 허리선 위 `height` 만큼의 상의 띠를 텍스처에서 반바지 색으로 칠한다."""
    me = obj.data
    w, h = image.size
    M = obj.matrix_world
    z = [(M @ v.co).z for v in me.vertices]
    # 반바지 = 골반·허벅지 뼈 영역의 어두운 옷 면. 허리선은 그 정점 높이의 95%.
    dark = []
    shorts_cols = []
    for poly in me.polygons:
        if not face_cloth[poly.index]:
            continue
        if not all(dominant[i] in {"pelvis", "thigh_l", "thigh_r"} for i in poly.vertices):
            continue
        us = [uv[li].uv for li in poly.loop_indices]
        x = int(min(w - 1, max(0, (sum(u.x for u in us) / len(us) % 1.0) * w)))
        y = int(min(h - 1, max(0, (sum(u.y for u in us) / len(us) % 1.0) * h)))
        r, g, b = px[y, x, :3]
        if max(r, g, b) < 0.30:
            dark.extend(z[i] for i in poly.vertices)
            shorts_cols.append((float(r), float(g), float(b)))
    if not dark:
        print("SHIRT_SKIP 반바지를 못 찾음")
        return
    dark.sort()
    waist = dark[int(len(dark) * 0.95)]
    col = np.median(np.array(shorts_cols), axis=0)
    band_hi = waist + height
    팔뼈 = {"upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "clavicle_l", "clavicle_r"}
    painted = 0
    for poly in me.polygons:
        if not any(tint[i] == 2.0 for i in poly.vertices):
            continue
        if any(dominant[i] in 팔뼈 for i in poly.vertices):
            continue
        # 허리선+높이 아래의 밝은(상의) 옷 면은 전부 — 옆·뒤 밑단은 허벅지 뼈에 물려 있어
        # 뼈로 고르면 빠진다. 밑단 경계 면은 살 표식이 섞여 있어 정점 하나라도 옷이면 칠한다.
        if min(z[i] for i in poly.vertices) > band_hi + 0.005:
            continue
        if min(z[i] for i in poly.vertices) < waist - 0.06:
            continue  # 반바지 아래 허벅지
        us = [uv[li].uv for li in poly.loop_indices]
        x = int(min(w - 1, max(0, (sum(u.x for u in us) / len(us) % 1.0) * w)))
        y = int(min(h - 1, max(0, (sum(u.y for u in us) / len(us) % 1.0) * h)))
        if max(px[y, x, :3]) < 0.30:
            continue  # 이미 반바지
        # 면의 UV 삼각형을 채운다(1픽셀 여유).
        pts = [(uv[li].uv.x % 1.0 * w, uv[li].uv.y % 1.0 * h) for li in poly.loop_indices]
        for k in range(1, len(pts) - 1):
            tri = [pts[0], pts[k], pts[k + 1]]
            xs = [p[0] for p in tri]
            ys = [p[1] for p in tri]
            x0, x1 = max(0, int(min(xs)) - 1), min(w - 1, int(max(xs)) + 1)
            y0, y1 = max(0, int(min(ys)) - 1), min(h - 1, int(max(ys)) + 1)
            if x1 < x0 or y1 < y0:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = tri
            det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            if abs(det) < 1e-9:
                continue
            l1 = ((bx - X) * (cy - Y) - (cx - X) * (by - Y)) / det
            l2 = ((cx - X) * (ay - Y) - (ax - X) * (cy - Y)) / det
            l3 = 1 - l1 - l2
            eps = -0.5  # 살짝 바깥까지 — 이음새 방지
            mask = (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
            px[y0:y1 + 1, x0:x1 + 1, :3][mask] = col
        painted += 1
    image.pixels.foreach_set(px.ravel())
    image.pack()
    print(f"SHIRT_OK waist={waist:.3f} band=+{height} faces={painted} color={[round(c, 2) for c in col]}")


def 뒷머리내리기(obj, ratio):
    me = obj.data
    pts = [v.co.copy() for v in me.vertices]
    crown = max(p.z for p in pts)
    bottom = min(p.z for p in pts)
    ys = [p.y for p in pts]
    cy = (min(ys) + max(ys)) / 2
    radius = (max(ys) - min(ys)) / 2
    # 정수리 쪽까지 같이 내리면 뒤통수 윗부분 머리가 두개골 안으로 들어가 살이 머리 위로 비친다
    # (실제로 그랬다). 머리 높이의 아래 절반에서만, 아래로 갈수록 세게 늘린다.
    mid = crown - (crown - bottom) * 0.5
    moved = 0
    # 셰이프키가 있으면 내보내기는 키 데이터를 쓴다 — 정점과 모든 키를 같이 옮긴다.
    targets = [me.vertices] + ([kb.data for kb in me.shape_keys.key_blocks] if me.shape_keys else [])
    for i, p in enumerate(pts):
        back = min(1.0, max(0.0, (p.y - cy) / radius))  # 뒤(+y)일수록 1
        low = min(1.0, max(0.0, (mid - p.z) / (mid - bottom)))  # 아래일수록 1
        w = back * back * low * low
        if w <= 0:
            continue
        dz = p.z - mid
        for t in targets:
            t[i].co.z = mid + dz * (1 + ratio * w)
            t[i].co.y += 0.006 * w  # 늘리면서 살짝 바깥으로 — 두피 안으로 파고들지 않게
        moved += 1
    print(f"HAIR_NAPE_OK {obj.name} moved={moved} ratio={ratio}")


표식넣기(body)
if args.hair_nape > 0:
    for o in bpy.data.objects:
        if o.type == "MESH" and o.get("slot") == "hair" and int(o.get("variant", -1)) == 0:
            뒷머리내리기(o, args.hair_nape)

rig = body.parent
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
bpy.ops.object.select_all(action="DESELECT")
for o in (rig, *meshes):
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=args.out, export_format="GLB", use_selection=True, export_animations=False,
    export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False, export_apply=False,
    export_extras=True, export_attributes=True, export_image_format="JPEG", export_jpeg_quality=args.jpeg,
)
print("MARK_OK", args.out)
