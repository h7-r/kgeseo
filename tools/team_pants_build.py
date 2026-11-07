# 팀 캐릭터 전용 바지(스키니 청바지 · 통 큰 바지)를 몸 GLB 에서 뽑아 파츠 GLB 로 굽는다(미르 11/8, 검토 22회차 C2).
# 신발처럼 몸 골격에 묶는 따로 된 파츠다(TeamOutfitLayer 가 attachParts 로 붙인다) — 바지 입은 몸 GLB(10~15MB)를 새로
# 굽지 않는다. 바지는 몸 표면(다리 · 골반 웨이트가 큰 면)을 그대로 복제해 만들어서 웨이트 · 모프(다리 두께 · 골반 · 체형)를
# 물려받는다 — 체형 슬라이더를 움직여도 다리를 따라간다. 모양은 법선 방향으로 밀어 낸다:
#   jeans: 다리에 붙게 5mm, 허리에서 발목 위까지
#   baggy: 엉덩이 1.2cm → 밑단 7cm 로 넓히고, 다리 근육 굴곡이 안 보이게 표면을 고르고(라플라시안), 웨이트도 부드럽게 —
#          천이 다리에 딱 붙어 따라가지 않게. 안쪽 허벅지는 덜 밀어 두 다리가 덜 부딪힌다.
# UV 는 다리 둘레를 따라 펴고(이음은 다리 안쪽), 결 무늬 텍스처(회색 — 화면이 하의 색을 곱한다)를 넣는다.
#
#   Blender --background --factory-startup --python tools/team_pants_build.py -- \
#     --glb public/models/meshy-base-male.glb --style jeans --out public/models/team-pants-jeans-base-male.glb
import argparse
import json
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--glb", required=True, help="몸 GLB(하의 없는 base · top 착장)")
parser.add_argument("--style", choices=["jeans", "baggy"], required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--report", help="잰 값을 JSON 으로")
args = parser.parse_args(argv)

STYLE = {
    # hem: 발목 뼈 위 밑단 높이(m) · waist: spine_01 위 허리 높이(m)
    # min_offset: 고른 뒤에도 몸 표면에서 이만큼은 떨어진다(라플라시안 고르기는 표면을 오그라뜨려 몸이 비쳤다)
    "jeans": {"hem": 0.012, "waist": 0.02, "offset_hip": 0.0065, "offset_hem": 0.0065, "min_offset": 0.006, "smooth": 0, "weight_smooth": 0},
    "baggy": {"hem": 0.0, "waist": 0.02, "offset_hip": 0.012, "offset_hem": 0.07, "min_offset": 0.01, "smooth": 14, "weight_smooth": 4},
}[args.style]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = max(
    (o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys and "legThickness" in o.data.shape_keys.key_blocks),
    key=lambda o: len(o.data.vertices),
)


def head(name):
    return arm.matrix_world @ arm.data.bones[name].head_local


# 허리 높이 — spine_01 위. 여자 몸은 속옷 윗선이 더 높아(상의와 바지 사이에 회색 띠가 보였다) 3cm 더 올린다.
# 상의가 있는 몸은 셔츠 밑단(상의 표식 2 의 아래 1%)보다 1.5cm 위까지 — 바지가 셔츠 밑으로 들어가 틈이 안 생긴다
is_female = "female" in body.name.lower()
waist_z = head("spine_01").z + STYLE["waist"] + (0.03 if is_female else 0.0)
tint_attr = body.data.attributes.get("_TINT")
shirt_hem_z = None
if tint_attr and tint_attr.domain == "POINT":
    shirt = [body.matrix_world @ body.data.vertices[i].co for i, d in enumerate(tint_attr.data) if round(d.value) == 2]
    if len(shirt) > 500:
        # 밑단은 앞뒤 높이가 다르다 — 몸통 둘레 16구역마다 가장 낮은 셔츠 정점을 재고, 그중 가장 높은 곳까지 덮는다
        # (가장 낮은 곳 기준이면 등 쪽에 틈이 남았다). 팔(소매)은 빼려고 몸통 가까운 정점만 본다
        centre = head("pelvis")
        lowest = min(p.z for p in shirt)
        sectors = {}
        for p in shirt:
            if p.z > lowest + 0.2 or math.hypot(p.x - centre.x, p.y - centre.y) > 0.25:
                continue
            k = int((math.atan2(p.y - centre.y, p.x - centre.x) + math.pi) / (2 * math.pi) * 16) % 16
            sectors[k] = min(sectors.get(k, p.z), p.z)
        if sectors:
            shirt_hem_z = max(sectors.values())
            waist_z = max(waist_z, shirt_hem_z + 0.012)
thigh_z = head("thigh_l").z
knee_z = head("calf_l").z
ankle = {1: head("foot_l"), -1: head("foot_r")}
hem_z = {side: ankle[side].z + STYLE["hem"] for side in (1, -1)}
# 다리 축(옆 · 앞뒤 자리)을 높이로 잇는다 — UV 둘레 각과 통 큰 바지의 밑단 퍼짐에 쓴다
axis_points = {
    1: [(head("thigh_l").z, head("thigh_l")), (knee_z, head("calf_l")), (ankle[1].z, ankle[1])],
    -1: [(head("thigh_r").z, head("thigh_r")), (head("calf_r").z, head("calf_r")), (ankle[-1].z, ankle[-1])],
}


def leg_axis(side, z):
    pts = axis_points[side]
    if z >= pts[0][0]:
        return pts[0][1]
    for (z0, p0), (z1, p1) in zip(pts, pts[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / max(1e-6, z0 - z1)
            return p0.lerp(p1, t)
    return pts[-1][1]


groups = {g.index: g.name for g in body.vertex_groups}
LEG = {i for i, n in groups.items() if n.startswith(("thigh", "calf"))}
FOOT = {i for i, n in groups.items() if n.startswith(("foot", "ball"))}
PELVIS = {i for i, n in groups.items() if n == "pelvis"}

world = body.matrix_world
selected = set()
for v in body.data.vertices:
    p = world @ v.co
    leg = sum(g.weight for g in v.groups if g.group in LEG)
    pelvis = sum(g.weight for g in v.groups if g.group in PELVIS)
    foot = sum(g.weight for g in v.groups if g.group in FOOT)
    side = 1 if p.x >= 0 else -1
    if leg + pelvis >= 0.5 and foot < 0.25 and hem_z[side] <= p.z <= waist_z:
        selected.add(v.index)

# 고른 정점만으로 된 면을 복제해 새 물체로 — 웨이트 그룹 · 셰이프 키 · 아마추어가 그대로 따라온다
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(body.data)
bm.verts.ensure_lookup_table()
for f in bm.faces:
    f.select_set(all(v.index in selected for v in f.verts))
bmesh.update_edit_mesh(body.data)
bpy.ops.mesh.duplicate()
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
pants = next(o for o in bpy.context.selected_objects if o != body)
pants.name = f"TeamPants_{args.style}"
pants.data.name = pants.name
# 몸에서 온 재질 · 표식은 버린다(화면이 하의 재질을 따로 만든다)
pants.data.materials.clear()
for name in ("_TINT", "_tint"):
    if name in pants.data.attributes:
        pants.data.attributes.remove(pants.data.attributes[name])

# glTF 는 UV · 법선 이음마다 정점을 갈라 둔다 — 같은 자리 정점을 합쳐 바지를 한 덩어리로 잇는다(셰이프 키 · 웨이트는 함께 합쳐진다).
# 그다음 작은 조각(파편)만 버린다 — 가장 큰 연결 덩어리만 남긴다
bm = bmesh.new()
bm.from_mesh(pants.data)
merged_before = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
merged = merged_before - len(bm.verts)
bm.verts.ensure_lookup_table()
bm.verts.index_update()
seen = set()
islands = []
for v in bm.verts:
    if v.index in seen:
        continue
    stack = [v]
    seen.add(v.index)
    island = []
    while stack:
        cur = stack.pop()
        island.append(cur)
        for e in cur.link_edges:
            other = e.other_vert(cur)
            if other.index not in seen:
                seen.add(other.index)
                stack.append(other)
    islands.append(island)
islands.sort(key=len, reverse=True)
dropped = sum(len(i) for i in islands[1:])
for island in islands[1:]:
    bmesh.ops.delete(bm, geom=island, context="VERTS")
# 경계 고리 — 허리(가장 높은 고리) · 밑단(양쪽 가장 낮은 고리)만 열어 두고 나머지(다리 안쪽에 웨이트가 갈려 빠진 구멍)는
# 메운다. 구멍으로 몸이 비쳐 흰 점처럼 보였다. 메우기는 있는 정점으로 면만 만들어 셰이프 키 · 웨이트가 그대로다
bm.verts.ensure_lookup_table()
bm.edges.ensure_lookup_table()
loops = []
seen_edges = set()
for edge in bm.edges:
    if not edge.is_boundary or edge.index in seen_edges:
        continue
    stack = [edge]
    seen_edges.add(edge.index)
    loop_edges = []
    while stack:
        cur = stack.pop()
        loop_edges.append(cur)
        for v in cur.verts:
            for nxt in v.link_edges:
                if nxt.is_boundary and nxt.index not in seen_edges:
                    seen_edges.add(nxt.index)
                    stack.append(nxt)
    verts = {v for e in loop_edges for v in e.verts}
    loops.append({"edges": loop_edges, "verts": verts, "z": sum((world @ v.co).z for v in verts) / len(verts), "x": sum((world @ v.co).x for v in verts) / len(verts)})
waist_loop = max(loops, key=lambda l: l["z"])
hem_loops = [min((l for l in loops if l is not waist_loop and (l["x"] >= 0) == (side > 0)), key=lambda l: l["z"], default=None) for side in (1, -1)]
open_loops = [waist_loop] + [l for l in hem_loops if l]
holes = [l for l in loops if all(l is not o for o in open_loops)]
filled = 0
if holes:
    result = bmesh.ops.holes_fill(bm, edges=[e for l in holes for e in l["edges"]], sides=0)
    filled = len(result.get("faces", []))
bm.verts.index_update()
waist_verts = {v.index for v in waist_loop["verts"]}
hem_verts = {v.index for l in hem_loops if l for v in l["verts"]}
loop_report = {"loops": len(loops), "holes": len(holes), "holeVerts": sum(len(l["verts"]) for l in holes), "filledFaces": filled, "waistVerts": len(waist_verts), "hemVerts": len(hem_verts)}
bm.to_mesh(pants.data)
bm.free()

mesh = pants.data
keys = mesh.shape_keys.key_blocks
basis = keys[0]
count = len(mesh.vertices)
mesh.update()
normals = [Vector(v.normal) for v in mesh.vertices]
positions = [Vector(basis.data[i].co) for i in range(count)]
pw = pants.matrix_world


def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


# 1) 법선 방향으로 밀어 낸다
offsets = []
for i in range(count):
    p = pw @ positions[i]
    side = 1 if p.x >= 0 else -1
    t = (thigh_z - p.z) / max(1e-6, thigh_z - hem_z[side])
    d = STYLE["offset_hip"] + (STYLE["offset_hem"] - STYLE["offset_hip"]) * smoothstep(t)
    n = normals[i]
    if args.style == "baggy":
        # 안쪽 허벅지(다리 가운데 쪽을 보는 면)는 덜 민다
        inward = max(0.0, -n.x * side)
        d *= 1.0 - 0.6 * inward
    offsets.append(n * d)

new_positions = [positions[i] + offsets[i] for i in range(count)]

# 허리 · 밑단 고리를 한 높이로 — 면 단위로 고른 경계는 삼각형 모서리를 따라 톱니처럼 들쭉날쭉했다
inverse_world = pw.inverted()
snapped = 0
for i in range(count):
    if i not in waist_verts and i not in hem_verts:
        continue
    p = pw @ new_positions[i]
    side = 1 if p.x >= 0 else -1
    p.z = waist_z if i in waist_verts else hem_z[side]
    new_positions[i] = inverse_world @ p
    snapped += 1

# 2) 통 큰 바지: 표면 고르기(경계 고리는 고정) — 근육 굴곡이 안 보이게
if STYLE["smooth"]:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    neighbours = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    boundary = [v.is_boundary for v in bm.verts]
    bm.free()
    for _ in range(STYLE["smooth"]):
        nxt = []
        for i in range(count):
            if boundary[i] or not neighbours[i]:
                nxt.append(new_positions[i])
                continue
            avg = sum((new_positions[j] for j in neighbours[i]), Vector()) / len(neighbours[i])
            nxt.append(new_positions[i].lerp(avg, 0.5))
        new_positions = nxt

# 몸 표면에서 최소 거리 지키기 — 원래 자리에서 법선 방향으로 min_offset 보다 안쪽이면 밀어 낸다
pushed = 0
for i in range(count):
    n = normals[i]
    off = (new_positions[i] - positions[i]).dot(n)
    if off < STYLE["min_offset"]:
        new_positions[i] = new_positions[i] + n * (STYLE["min_offset"] - off)
        pushed += 1

# 셰이프 키는 절대 자리를 갖고 있다 — 기본 자리에 더한 만큼 모든 키에 똑같이 더해 모프 차이를 지킨다
for i in range(count):
    delta = new_positions[i] - positions[i]
    for key in keys:
        key.data[i].co = key.data[i].co + delta
mesh.update()

# 다리와 상관없는 셰이프 키(어깨 · 팔 · 손 · 주먹)는 바지에서 차이가 없다 — 버려 파일을 줄인다(화면은 이름으로 옮긴다)
removed_keys = []
for key in list(keys)[1:]:
    if max((key.data[i].co - basis.data[i].co).length for i in range(count)) < 1e-6:
        removed_keys.append(key.name)
        pants.shape_key_remove(key)
keys = mesh.shape_keys.key_blocks
basis = keys[0]

# 3) 웨이트 고르기(통 큰 바지) — 천이 다리 근육을 따라 출렁이지 않게. 이웃 평균으로 섞고 합을 1 로 맞춘다
if STYLE["weight_smooth"]:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    neighbours = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    bm.free()
    weights = [{g.group: g.weight for g in v.groups} for v in mesh.vertices]
    for _ in range(STYLE["weight_smooth"]):
        nxt = []
        for i in range(count):
            mixed = {k: w * 0.5 for k, w in weights[i].items()}
            if neighbours[i]:
                share = 0.5 / len(neighbours[i])
                for j in neighbours[i]:
                    for k, w in weights[j].items():
                        mixed[k] = mixed.get(k, 0.0) + w * share
            else:
                mixed = {k: w for k, w in weights[i].items()}
            # 4개까지만(글TF 영향 수), 합 1
            top = sorted(mixed.items(), key=lambda item: item[1], reverse=True)[:4]
            total = sum(w for _, w in top) or 1.0
            nxt.append({k: w / total for k, w in top})
        weights = nxt
    for group in pants.vertex_groups:
        group.remove(list(range(count)))
    for i, per in enumerate(weights):
        for k, w in per.items():
            if w > 1e-4:
                pants.vertex_groups[k].add([i], w, "REPLACE")

# 4) UV — 다리 둘레 각(이음은 다리 안쪽) × 높이. 결이 고르게 반복되게 둘레 4번 · 높이 1m 에 8번
uv = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
for poly in mesh.polygons:
    us = []
    for li in poly.loop_indices:
        vi = mesh.loops[li].vertex_index
        p = pw @ Vector(basis.data[vi].co)
        side = 1 if p.x >= 0 else -1
        a = leg_axis(side, p.z)
        dx = (p.x - a.x) * side
        dy = p.y - a.y
        angle = math.atan2(dy, dx)  # −π..π, ±π = 다리 안쪽
        us.append((li, (angle + math.pi) / (2 * math.pi) * 4, p.z * 8))
    # 이음을 넘는 면은 한쪽으로 모은다
    values = [u for _, u, _ in us]
    if max(values) - min(values) > 2:
        us = [(li, u + 4 if u < 2 else u, v) for li, u, v in us]
    for li, u, v in us:
        uv.data[li].uv = (u, v)

# 5) 결 무늬 텍스처 — 회색(밝을수록 하의 색이 그대로). jeans = 사선 능직 · baggy = 촘촘한 평직
SIZE = 256
image = bpy.data.images.new(f"{pants.name}_weave", SIZE, SIZE, alpha=False)
rng = random.Random(22)
pixels = [0.0] * (SIZE * SIZE * 4)
for y in range(SIZE):
    for x in range(SIZE):
        if args.style == "jeans":
            twill = 0.07 if ((x + y) // 3) % 2 else 0.0
            value = 0.9 - twill - 0.05 * rng.random()
        else:
            weave = 0.04 if (x // 2 + y // 2) % 2 else 0.0
            value = 0.92 - weave - 0.03 * rng.random()
        k = (y * SIZE + x) * 4
        pixels[k : k + 4] = [value, value, value, 1.0]
image.pixels = pixels
image.pack()
material = bpy.data.materials.new(f"{pants.name}_mat")
material.use_nodes = True
bsdf = material.node_tree.nodes.get("Principled BSDF")
tex = material.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9
material.use_backface_culling = False
mesh.materials.append(material)

# 파츠 표식(화면이 읽는다)
pants["slot"] = "teamPants"
pants["style"] = args.style

bpy.ops.object.select_all(action="DESELECT")
pants.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = pants
bpy.ops.export_scene.gltf(
    filepath=args.out,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=False,
    export_extras=True,
    export_yup=True,
)

report = {
    "glb": args.glb,
    "style": args.style,
    "vertices": len(mesh.vertices),
    "faces": len(mesh.polygons),
    "mergedSeamVertices": merged,
    "snappedBoundary": snapped,
    **loop_report,
    "pushedOut": pushed,
    "removedShapeKeys": removed_keys,
    "droppedFragments": dropped,
    "waistZ": round(waist_z, 4),
    "shirtHemZ": round(shirt_hem_z, 4) if shirt_hem_z is not None else None,
    "hemZ": {k: round(v, 4) for k, v in hem_z.items()},
    "shapeKeys": [k.name for k in keys],
}
print("TEAM_PANTS", json.dumps(report, ensure_ascii=False))
if args.report:
    with open(args.report, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
